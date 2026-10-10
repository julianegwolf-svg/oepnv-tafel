'use strict';
/*
 * Home-Assistant-Simulator für die SmartTafel.
 *
 *   node tool/ha-simulator/server.js [--extras]
 *
 * Bietet auf EINEM Port (Standard 8124):
 *   - WebSocket /api/websocket  (HA-WebSocket-API, Format wie HA 2025/2026)
 *   - /local/tafel/<pfad>       (Repo-Dateien, wie /config/www/tafel/ in HA)
 *   - /auth/login_flow, /auth/token (Anmeldung wie HA, mit Ablauf/Refresh/Widerruf)
 *   - /api/, /api/media_player_proxy/<entity_id> (Cover als SVG)
 *   - /sim/…                     (Steuer-API für Tests, nur von localhost)
 *
 * Umgebungsvariablen: PORT, HA_SIM_HOST, HA_SIM_TOKEN, HA_SIM_TICK_MS, HA_SIM_CHAOS_S, HA_SIM_LATENZ_MS,
 * HA_SIM_LEISE=1, HA_SIM_EXTRAS=1, HA_SIM_HAUSHALT (Pfad zu haushalt.json oder „fiktiv“),
 * HA_SIM_TOKEN_TTL_S, HA_SIM_KONTEN, HA_SIM_WOCHEN. Details: README.md
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const querystring = require('querystring');
const WebSocket = require('ws');

const { jetzt, iso, parseZeit } = require('./werkzeuge');
const { Welt, zustandJson, kompakterZustand, zustandsDiff } = require('./welt');
const { Simulation } = require('./modelle');
const { Dienste, HAFehler } = require('./dienste');
const { Anmeldung } = require('./auth');
const historie = require('./historie');
const { coverSvg } = require('./cover');

// ───────────────────────── Einstellungen ─────────────────────────
const HA_VERSION = '2026.10.0';
const PORT = Number(process.env.PORT || 8124);
const HOST = process.env.HA_SIM_HOST || null;
const TOKEN = process.env.HA_SIM_TOKEN || 'tafel-sim-token';
const TICK_MS = Math.max(200, Number(process.env.HA_SIM_TICK_MS || 5000));
const CHAOS_S = Number(process.env.HA_SIM_CHAOS_S || 0);
const LATENZ_MS = Math.max(0, Number(process.env.HA_SIM_LATENZ_MS || 0));
const LEISE = process.env.HA_SIM_LEISE === '1';
const EXTRAS = process.argv.indexOf('--extras') !== -1 || process.env.HA_SIM_EXTRAS === '1';
const TOKEN_TTL_S = Math.max(5, Number(process.env.HA_SIM_TOKEN_TTL_S || 1800));
const KONTEN = process.env.HA_SIM_KONTEN || 'tafel:tafel-passwort,mfa-test:mfa-passwort:123456';
const WOCHEN = Math.max(0, Math.min(12, Number(process.env.HA_SIM_WOCHEN === undefined ? 4 : process.env.HA_SIM_WOCHEN)));
const WURZEL = path.resolve(__dirname, '..', '..');
const STANDARD_JSON = path.join(__dirname, 'haushalt.json');
const STANDARD_YAML = path.join(__dirname, 'automations.echt.yaml');
const MAX_WARTESCHLANGE = 4096;

function zeitText() {
  return new Date().toTimeString().slice(0, 8);
}
function log(text) {
  if (!LEISE) console.log('[' + zeitText() + '] ' + text);
}
function warnung(text) {
  console.warn('[' + zeitText() + '] ⚠ ' + text);
}

// ───────────────────────── Haushalt wählen ─────────────────────────
function ladeHaushalt() {
  const wahl = process.env.HA_SIM_HAUSHALT || '';
  if (wahl === 'fiktiv') return require('./haushalt.js');
  const jsonPfad = wahl ? path.resolve(wahl) : STANDARD_JSON;
  if (fs.existsSync(jsonPfad)) {
    const echt = require('./haushalt-echt.js');
    const yamlPfad = path.join(path.dirname(jsonPfad), 'automations.echt.yaml');
    let H = echt.ladeEchtenHaushalt(jsonPfad, fs.existsSync(yamlPfad) ? yamlPfad : STANDARD_YAML, log);
    if (EXTRAS) H = echt.mitExtras(H);
    return H;
  }
  if (wahl) warnung('Haushalt-Datei ' + wahl + ' nicht gefunden – nutze den fiktiven Haushalt');
  return require('./haushalt.js');
}

const H = ladeHaushalt();
const welt = new Welt(H);
const sim = new Simulation(welt, H, { tickMs: TICK_MS, log: log, wochen: WOCHEN });
const dienste = new Dienste(welt, sim);
sim.dienste = dienste;
const anmeldung = new Anmeldung({ langzeitToken: TOKEN, konten: KONTEN, ttlSekunden: TOKEN_TTL_S, log: log });
sim.starte();

const startZeit = Date.now();
const statistik = { gesendet: 0, empfangen: 0, frames: 0, verbindungenGesamt: 0, abgewiesen: 0 };
const verbindungen = new Set();
let verbindungsNr = 0;
let pauseBis = 0;

// ───────────────────────── Senden ─────────────────────────
function sende(v, text) {
  if (v.ws.readyState !== WebSocket.OPEN) return;
  statistik.gesendet++;
  if (!v.coalesce) {
    statistik.frames++;
    v.ws.send(text);
    return;
  }
  v.schlange.push(text);
  if (v.schlange.length > MAX_WARTESCHLANGE) {
    warnung('Verbindung ' + v.nr + ': Client kommt nicht hinterher (' + v.schlange.length + ' Nachrichten) – trenne');
    v.schlange = [];
    v.ws.terminate();
    return;
  }
  if (!v.flushGeplant) {
    v.flushGeplant = true;
    setImmediate(() => leere(v));
  }
}

// Gebündelt senden: mehrere Nachrichten als JSON-Array in einem Frame (coalesce_messages)
function leere(v) {
  v.flushGeplant = false;
  const teile = v.schlange;
  v.schlange = [];
  if (!teile.length || v.ws.readyState !== WebSocket.OPEN) return;
  statistik.frames++;
  v.ws.send(teile.length === 1 ? teile[0] : '[' + teile.join(',') + ']');
}

function ergebnis(v, id, result) {
  sende(v, '{"id":' + id + ',"type":"result","success":true,"result":' + (result === undefined ? 'null' : JSON.stringify(result)) + '}');
}
function ergebnisRoh(v, id, jsonText) {
  sende(v, '{"id":' + id + ',"type":"result","success":true,"result":' + jsonText + '}');
}
function fehler(v, id, code, message, extra) {
  const err = Object.assign({ code: code, message: message }, extra || {});
  sende(v, JSON.stringify({ id: id, type: 'result', success: false, error: err }));
}
function ereignis(v, aboId, ereignisJson) {
  sende(v, '{"id":' + aboId + ',"type":"event","event":' + ereignisJson + '}');
}

// ───────────────────────── Ereignisse verteilen ─────────────────────────
welt.abonniere(e => {
  if (!verbindungen.size) return;
  let entitaetsNachricht;
  for (const v of verbindungen) {
    if (!v.auth) continue;
    for (const [aboId, abo] of v.abos) {
      if (abo.art === 'events') {
        if (abo.typ === null || abo.typ === e.event_type) ereignis(v, aboId, welt.ereignisJson(e));
      } else if (abo.art === 'entities' && e.event_type === 'state_changed') {
        const id = e.data.entity_id;
        if (abo.ids && !abo.ids.has(id)) continue;
        if (entitaetsNachricht === undefined) {
          const alt = e.data.old_state;
          const neu = e.data.new_state;
          let inhalt;
          if (!neu) inhalt = { r: [id] };
          else if (!alt) inhalt = { a: { [id]: kompakterZustand(neu) } };
          else inhalt = { c: { [id]: zustandsDiff(alt, neu) } };
          entitaetsNachricht = JSON.stringify(inhalt);
        }
        ereignis(v, aboId, entitaetsNachricht);
      }
    }
  }
});

sim.todoHoerer.add((entityId, items) => {
  let text = null;
  for (const v of verbindungen) {
    for (const [aboId, abo] of v.abos) {
      if (abo.art !== 'todo' || abo.entityId !== entityId) continue;
      if (text === null) text = JSON.stringify({ items: items });
      ereignis(v, aboId, text);
    }
  }
});

anmeldung.widerrufHoerer.add(refreshId => {
  for (const v of verbindungen) {
    if (v.auth && v.auth.refreshId === refreshId) {
      log('Verbindung ' + v.nr + ': Refresh-Token widerrufen – trenne');
      v.ws.close();
    }
  }
});

// ───────────────────────── WebSocket-Befehle ─────────────────────────
function pflicht(m, feld, typ) {
  if (m[feld] === undefined || m[feld] === null) throw new HAFehler('invalid_format', "required key not provided @ data['" + feld + "']. Got None");
  if (typ === 'string' && typeof m[feld] !== 'string') throw new HAFehler('invalid_format', "expected str for dictionary value @ data['" + feld + "']. Got " + JSON.stringify(m[feld]));
  if (typ === 'liste' && !Array.isArray(m[feld])) throw new HAFehler('invalid_format', "expected list for dictionary value @ data['" + feld + "']. Got " + JSON.stringify(m[feld]));
  return m[feld];
}

function nurSchluessel(m, erlaubt) {
  for (const k of Object.keys(m)) {
    if (k === 'id' || k === 'type') continue;
    if (erlaubt.indexOf(k) === -1) throw new HAFehler('invalid_format', "extra keys not allowed @ data['" + k + "']. Got " + JSON.stringify(m[k]));
  }
}

function komponenten() {
  const s = new Set(['api', 'auth', 'config', 'default_config', 'frontend', 'history', 'http', 'logbook', 'person', 'recorder', 'scene', 'script', 'automation', 'websocket_api', 'zone', 'homeassistant', 'onboarding', 'system_health']);
  for (const e of welt.eintraege) {
    const domain = e.entity_id.split('.')[0];
    s.add(domain);
    s.add(e.platform);
    if (e.platform !== domain) s.add(domain + '.' + e.platform);
  }
  return Array.from(s).sort();
}

const BEFEHLE = {
  supported_features(v, m) {
    const f = m.features || {};
    v.coalesce = f.coalesce_messages === 1 || f.coalesce_messages === true;
    ergebnis(v, m.id, null);
  },
  ping(v, m) {
    sende(v, '{"id":' + m.id + ',"type":"pong"}');
  },
  get_states(v, m) {
    nurSchluessel(m, []);
    const teile = [];
    for (const s of welt.zustaende.values()) teile.push(zustandJson(s));
    ergebnisRoh(v, m.id, '[' + teile.join(',') + ']');
  },
  get_config(v, m) {
    ergebnis(v, m.id, {
      allowlist_external_dirs: ['/media', '/config/www'], allowlist_external_urls: [], components: komponenten(),
      config_dir: '/config', config_source: 'storage', country: 'DE', currency: 'EUR', debug: false, elevation: 5,
      external_url: null, internal_url: null, language: 'de', latitude: 53.073, location_name: 'Zuhause', longitude: 8.887,
      radius: 100, recovery_mode: false, safe_mode: false, state: 'RUNNING', time_zone: 'Europe/Berlin',
      unit_system: { length: 'km', accumulated_precipitation: 'mm', area: 'm²', mass: 'g', pressure: 'Pa', temperature: '°C', volume: 'L', wind_speed: 'm/s' },
      version: HA_VERSION, whitelist_external_dirs: ['/media', '/config/www']
    });
  },
  get_services(v, m) {
    ergebnis(v, m.id, dienste.liste());
  },
  'auth/current_user'(v, m) {
    const b = v.auth.benutzer;
    const konto = anmeldung.konten.get(b.name);
    ergebnis(v, m.id, {
      id: b.id, name: b.name, is_owner: !!b.is_owner, is_admin: !!b.is_admin,
      credentials: [{ auth_provider_type: 'homeassistant', auth_provider_id: null }],
      mfa_modules: [{ id: 'totp', name: 'Authenticator app', enabled: !!(konto && konto.mfa) }]
    });
  },
  'config/area_registry/list'(v, m) {
    ergebnis(v, m.id, welt.bereiche);
  },
  'config/floor_registry/list'(v, m) {
    ergebnis(v, m.id, []);
  },
  'config/label_registry/list'(v, m) {
    ergebnis(v, m.id, []);
  },
  'config/device_registry/list'(v, m) {
    ergebnis(v, m.id, welt.geraete);
  },
  'config/entity_registry/list'(v, m) {
    ergebnis(v, m.id, welt.eintraege);
  },
  'config/entity_registry/list_for_display'(v, m) {
    ergebnis(v, m.id, welt.anzeigeListe());
  },
  'config/entity_registry/get'(v, m) {
    const id = pflicht(m, 'entity_id', 'string');
    const e = welt.eintragNachId.get(id);
    if (!e) throw new HAFehler('not_found', 'Entity not found');
    const s = welt.zustand(id);
    ergebnis(v, m.id, Object.assign({}, e, {
      aliases: [], capabilities: null, device_class: null, original_device_class: s ? (s.attributes.device_class || null) : null
    }));
  },
  subscribe_events(v, m) {
    if (m.event_type !== undefined && typeof m.event_type !== 'string') throw new HAFehler('invalid_format', "expected str for dictionary value @ data['event_type']");
    v.abos.set(m.id, { art: 'events', typ: m.event_type || null });
    ergebnis(v, m.id, null);
  },
  unsubscribe_events(v, m) {
    const abo = pflicht(m, 'subscription');
    if (!v.abos.delete(abo)) throw new HAFehler('not_found', 'Subscription not found.');
    ergebnis(v, m.id, null);
  },
  subscribe_entities(v, m) {
    const ids = m.entity_ids ? new Set(pflicht(m, 'entity_ids', 'liste')) : null;
    v.abos.set(m.id, { art: 'entities', ids: ids });
    ergebnis(v, m.id, null);
    const a = {};
    for (const s of welt.zustaende.values()) if (!ids || ids.has(s.entity_id)) a[s.entity_id] = kompakterZustand(s);
    ereignis(v, m.id, JSON.stringify({ a: a }));
  },
  async call_service(v, m) {
    nurSchluessel(m, ['domain', 'service', 'service_data', 'target', 'return_response']);
    const domain = pflicht(m, 'domain', 'string');
    const service = pflicht(m, 'service', 'string');
    if (m.target !== undefined && (typeof m.target !== 'object' || Array.isArray(m.target) || m.target === null)) throw new HAFehler('invalid_format', "expected dict for dictionary value @ data['target']");
    const r = await dienste.aufrufen(domain, service, m.service_data, m.target, { benutzer: v.auth.benutzer.id, returnResponse: m.return_response === true });
    log('call_service ' + domain + '.' + service + ' (Verbindung ' + v.nr + ')');
    ergebnis(v, m.id, { context: r.kontext, response: r.antwort });
  },
  fire_event(v, m) {
    const typ = pflicht(m, 'event_type', 'string');
    const ctx = welt.kontext(null, v.auth.benutzer.id);
    welt.feuere(typ, m.event_data || {}, ctx);
    ergebnis(v, m.id, { context: ctx });
  },
  'history/history_during_period'(v, m) {
    nurSchluessel(m, ['start_time', 'end_time', 'entity_ids', 'include_start_time_state', 'significant_changes_only', 'minimal_response', 'no_attributes']);
    const startText = pflicht(m, 'start_time', 'string');
    const ids = pflicht(m, 'entity_ids', 'liste');
    const start = parseZeit(startText);
    if (start === null) throw new HAFehler('invalid_start_time', 'Invalid start_time');
    let ende = jetzt();
    if (m.end_time !== undefined && m.end_time !== null) {
      ende = parseZeit(m.end_time);
      if (ende === null) throw new HAFehler('invalid_end_time', 'Invalid end_time');
    }
    if (start > jetzt()) {
      ergebnis(v, m.id, {});
      return;
    }
    ergebnis(v, m.id, historie.abfrage(welt, {
      start: start, ende: ende, ids: ids.map(String),
      minimal: m.minimal_response === true, ohneAttribute: m.no_attributes === true,
      nurSignifikant: m.significant_changes_only !== false, mitStartzustand: m.include_start_time_state !== false
    }));
  },
  'logbook/get_events'(v, m) {
    nurSchluessel(m, ['start_time', 'end_time', 'entity_ids', 'context_id']);
    const start = parseZeit(pflicht(m, 'start_time', 'string'));
    if (start === null) throw new HAFehler('invalid_start_time', 'Invalid start_time');
    let ende = jetzt();
    if (m.end_time !== undefined && m.end_time !== null) {
      ende = parseZeit(m.end_time);
      if (ende === null) throw new HAFehler('invalid_end_time', 'Invalid end_time');
    }
    if (start > jetzt()) {
      ergebnis(v, m.id, []);
      return;
    }
    if (m.entity_ids !== undefined && !Array.isArray(m.entity_ids)) throw new HAFehler('invalid_format', "expected list for dictionary value @ data['entity_ids']");
    ergebnis(v, m.id, sim.logbuch(start, ende, m.entity_ids || null));
  },
  'todo/item/list'(v, m) {
    const id = pflicht(m, 'entity_id', 'string');
    if (!sim.todos.has(id)) throw new HAFehler('not_found', 'Entity not found');
    ergebnis(v, m.id, { items: sim.todos.get(id).map(i => Object.assign({}, i)) });
  },
  'todo/item/subscribe'(v, m) {
    const id = pflicht(m, 'entity_id', 'string');
    if (!sim.todos.has(id)) throw new HAFehler('invalid_entity_id', 'To-do list entity not found: ' + id);
    v.abos.set(m.id, { art: 'todo', entityId: id });
    ergebnis(v, m.id, null);
    ereignis(v, m.id, JSON.stringify({ items: sim.todos.get(id) }));
  },
  'todo/item/move'(v, m) {
    const id = pflicht(m, 'entity_id', 'string');
    const uid = pflicht(m, 'uid', 'string');
    const items = sim.todos.get(id);
    if (!items) throw new HAFehler('not_found', 'Entity not found');
    const i = items.findIndex(x => x.uid === uid);
    if (i === -1) throw new HAFehler('failed', 'Item ' + uid + ' not found');
    const [eintrag] = items.splice(i, 1);
    const vorher = m.previous_uid ? items.findIndex(x => x.uid === m.previous_uid) : -1;
    if (m.previous_uid && vorher === -1) {
      items.splice(i, 0, eintrag);
      throw new HAFehler('failed', 'Item ' + m.previous_uid + ' not found');
    }
    items.splice(vorher + 1, 0, eintrag);
    sim.schreibeTodo(id, welt.kontext(null, v.auth.benutzer.id));
    ergebnis(v, m.id, null);
  }
};

function behandleBefehl(v, msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.id !== 'number' || !Number.isInteger(msg.id) || msg.id < 0 || typeof msg.type !== 'string') {
    fehler(v, msg && typeof msg === 'object' && typeof msg.id === 'number' ? msg.id : 0, 'invalid_format', 'Message incorrectly formatted.');
    return;
  }
  if (msg.id <= v.letzteId) {
    fehler(v, msg.id, 'id_reuse', 'Identifier values have to increase.');
    return;
  }
  v.letzteId = msg.id;
  const befehl = BEFEHLE[msg.type];
  if (!befehl) {
    fehler(v, msg.id, 'unknown_command', 'Unknown command.');
    return;
  }
  let ergebnisVersprechen;
  try {
    ergebnisVersprechen = befehl(v, msg);
  } catch (err) {
    fehlerMelden(v, msg, err);
    return;
  }
  if (ergebnisVersprechen && typeof ergebnisVersprechen.then === 'function') {
    ergebnisVersprechen.catch(err => fehlerMelden(v, msg, err));
  }
}

function fehlerMelden(v, msg, err) {
  if (err instanceof HAFehler) {
    if (msg.type === 'call_service') log('call_service ' + msg.domain + '.' + msg.service + ' → ' + err.code + ': ' + err.message);
    fehler(v, msg.id, err.code, err.message, err.extra);
  } else {
    warnung('Fehler bei ' + msg.type + ': ' + (err && err.stack ? err.stack : err));
    fehler(v, msg.id, 'unknown_error', 'Unknown error');
  }
}

// ───────────────────────── Verbindungen ─────────────────────────
function behandleText(v, text) {
  statistik.empfangen++;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch (err) {
    if (!v.auth) {
      sende(v, JSON.stringify({ type: 'auth_invalid', message: 'Auth message incorrectly formatted: Received invalid JSON.' }));
    } else {
      warnung('Verbindung ' + v.nr + ': ungültiges JSON – trenne (wie HA)');
    }
    v.ws.close();
    return;
  }
  if (!v.auth) {
    if (!msg || msg.type !== 'auth' || (typeof msg.access_token !== 'string' && typeof msg.api_password !== 'string')) {
      sende(v, JSON.stringify({ type: 'auth_invalid', message: 'Auth message incorrectly formatted: expected an access_token' }));
      v.ws.close();
      return;
    }
    const pruefung = anmeldung.pruefe(msg.access_token);
    if (!pruefung) {
      log('Verbindung ' + v.nr + ': auth_invalid');
      sende(v, JSON.stringify({ type: 'auth_invalid', message: 'Invalid access token or password' }));
      setTimeout(() => v.ws.close(), 20);
      return;
    }
    v.auth = pruefung;
    clearTimeout(v.authTimer);
    sende(v, JSON.stringify({ type: 'auth_ok', ha_version: HA_VERSION }));
    log('Verbindung ' + v.nr + ': auth_ok (' + pruefung.benutzer.name + ')');
    return;
  }
  if (Array.isArray(msg)) msg.forEach(einzel => behandleBefehl(v, einzel));
  else behandleBefehl(v, msg);
}

function neueVerbindung(ws, req) {
  const v = {
    nr: ++verbindungsNr, ws: ws, auth: null, letzteId: 0, abos: new Map(), coalesce: false,
    schlange: [], flushGeplant: false, timer: new Set(), lebendig: true
  };
  verbindungen.add(v);
  statistik.verbindungenGesamt++;
  log('Verbindung ' + v.nr + ' geöffnet (' + (req.socket.remoteAddress || '?') + ')');
  sende(v, JSON.stringify({ type: 'auth_required', ha_version: HA_VERSION }));
  v.authTimer = setTimeout(() => {
    if (!v.auth) {
      log('Verbindung ' + v.nr + ': keine Anmeldung binnen 10 s – trenne');
      ws.close();
    }
  }, 10000);
  ws.on('message', (daten, binaer) => {
    const text = binaer ? daten.toString('utf8') : daten.toString();
    if (LATENZ_MS > 0) {
      const t = setTimeout(() => {
        v.timer.delete(t);
        behandleText(v, text);
      }, LATENZ_MS);
      v.timer.add(t);
    } else {
      behandleText(v, text);
    }
  });
  ws.on('pong', () => { v.lebendig = true; });
  ws.on('error', () => {});
  ws.on('close', () => {
    clearTimeout(v.authTimer);
    for (const t of v.timer) clearTimeout(t);
    v.timer.clear();
    v.abos.clear();
    v.schlange = [];
    verbindungen.delete(v);
    log('Verbindung ' + v.nr + ' geschlossen');
  });
}

function alleTrennen() {
  let n = 0;
  for (const v of verbindungen) {
    v.ws.terminate();
    n++;
  }
  return n;
}

const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false, maxPayload: 16 * 1024 * 1024 });
wss.on('connection', neueVerbindung);

// Herzschlag wie aiohttp (heartbeat=55): tote Verbindungen abräumen
setInterval(() => {
  for (const v of verbindungen) {
    if (!v.lebendig) {
      v.ws.terminate();
      continue;
    }
    v.lebendig = false;
    try {
      v.ws.ping();
    } catch (err) {
      v.ws.terminate();
    }
  }
}, 55000);

if (CHAOS_S > 0) {
  const chaos = () => {
    setTimeout(() => {
      const n = alleTrennen();
      if (n) log('Chaos: ' + n + ' Verbindung(en) getrennt');
      chaos();
    }, CHAOS_S * 1000 * (0.5 + Math.random()));
  };
  chaos();
}

// ───────────────────────── HTTP ─────────────────────────
const TYPEN = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4'
};
const GESPERRT_OBEN = new Set(['tool', 'belege', 'node_modules']);

function antwortText(res, status, text, kopf) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, kopf || {}));
  res.end(text);
}
function antwortJson(res, status, daten, kopf) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, kopf || {}));
  res.end(daten === null ? '' : JSON.stringify(daten));
}

function istLokal(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function leseKoerper(req, grenze) {
  return new Promise((ok, nein) => {
    const teile = [];
    let laenge = 0;
    req.on('data', c => {
      laenge += c.length;
      if (laenge > grenze) {
        nein(new Error('zu groß'));
        req.destroy();
        return;
      }
      teile.push(c);
    });
    req.on('end', () => ok(Buffer.concat(teile).toString('utf8')));
    req.on('error', nein);
  });
}

function bearerPruefen(req) {
  const kopf = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(kopf);
  return m ? anmeldung.pruefe(m[1].trim()) : null;
}

// /local/tafel/<pfad> → Repo-Datei (sicher gegen Path-Traversal, keine versteckten/gesperrten Ordner)
function statischeDatei(req, res, rohPfad) {
  let rel;
  try {
    rel = decodeURIComponent(rohPfad);
  } catch (err) {
    antwortText(res, 400, '400: Bad Request');
    return;
  }
  const teile = rel.split('/');
  const verboten = rel === '' || rel.indexOf('\0') !== -1 || rel.indexOf('\\') !== -1 ||
    teile.some(t => t === '' || t === '.' || t === '..' || t[0] === '.') ||
    GESPERRT_OBEN.has(teile[0]) || teile.indexOf('node_modules') !== -1;
  if (verboten) {
    antwortText(res, 404, '404: Not Found');
    return;
  }
  const voll = path.resolve(WURZEL, rel);
  if (voll.indexOf(WURZEL + path.sep) !== 0) {
    antwortText(res, 404, '404: Not Found');
    return;
  }
  fs.realpath(voll, (err, echt) => {
    if (err || echt.indexOf(WURZEL + path.sep) !== 0) {
      antwortText(res, 404, '404: Not Found');
      return;
    }
    const echtRel = path.relative(WURZEL, echt).split(path.sep);
    if (GESPERRT_OBEN.has(echtRel[0]) || echtRel.some(t => t[0] === '.')) {
      antwortText(res, 404, '404: Not Found');
      return;
    }
    fs.stat(echt, (err2, st) => {
      if (err2 || !st.isFile()) {
        antwortText(res, 404, '404: Not Found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPEN[path.extname(echt).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-store'
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(echt).on('error', () => res.destroy()).pipe(res);
    });
  });
}

function cover(req, res, url, entityId) {
  const m = sim.medien.get(entityId);
  if (!m) {
    antwortText(res, 404, '404: Not Found');
    return;
  }
  const token = url.searchParams.get('token');
  if (!(token && token === m.token) && !bearerPruefen(req)) {
    antwortText(res, 401, '401: Unauthorized');
    return;
  }
  const medium = sim.aktuellesMedium(m);
  if (!medium) {
    antwortText(res, 404, '404: Not Found');
    return;
  }
  const svg = coverSvg(medium.titel, medium.kuenstler || medium.kanal || (m.radio ? 'Live' : ''));
  res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, max-age=3600', 'Content-Length': Buffer.byteLength(svg) });
  res.end(req.method === 'HEAD' ? undefined : svg);
}

function corsKopf(req) {
  return req.headers.origin ? { 'Access-Control-Allow-Origin': req.headers.origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' } : {};
}

async function anmeldeRoute(req, res, url) {
  const p = url.pathname;
  if (p === '/auth/providers' && req.method === 'GET') {
    antwortJson(res, 200, { providers: [{ name: 'Home Assistant Local', id: null, type: 'homeassistant' }], preselect_remember_me: false });
    return;
  }
  if (p === '/auth/token') {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, Object.assign({ 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }, corsKopf(req)));
      res.end();
      return;
    }
    if (req.method !== 'POST') return antwortText(res, 405, '405: Method Not Allowed');
    const roh = await leseKoerper(req, 65536);
    const typ = req.headers['content-type'] || '';
    let felder = {};
    if (/json/.test(typ)) {
      try { felder = JSON.parse(roh || '{}'); } catch (err) { felder = {}; }
    } else {
      felder = querystring.parse(roh);
    }
    const r = anmeldung.token(felder);
    if (r.json === null) {
      res.writeHead(r.status, Object.assign({ 'Cache-Control': 'no-store' }, corsKopf(req)));
      res.end();
    } else {
      antwortJson(res, r.status, r.json, Object.assign({ Pragma: 'no-cache' }, corsKopf(req)));
    }
    return;
  }
  if (p === '/auth/login_flow' && req.method === 'POST') {
    let body;
    try { body = JSON.parse((await leseKoerper(req, 65536)) || '{}'); } catch (err) { return antwortJson(res, 400, { message: 'Invalid JSON.' }); }
    const r = anmeldung.flowStarten(body);
    antwortJson(res, r.status, r.json);
    return;
  }
  const m = /^\/auth\/login_flow\/([A-Za-z0-9]+)$/.exec(p);
  if (m) {
    if (req.method === 'DELETE') {
      const r = anmeldung.flowAbbrechen(m[1]);
      antwortJson(res, r.status, r.json);
      return;
    }
    if (req.method !== 'POST') return antwortText(res, 405, '405: Method Not Allowed');
    let body;
    try { body = JSON.parse((await leseKoerper(req, 65536)) || '{}'); } catch (err) { return antwortJson(res, 400, { message: 'Invalid JSON.' }); }
    const r = anmeldung.flowSchritt(m[1], body);
    antwortJson(res, r.status, r.json);
    return;
  }
  antwortText(res, 404, '404: Not Found');
}

function status() {
  let abos = 0;
  let authentifiziert = 0;
  for (const v of verbindungen) {
    abos += v.abos.size;
    if (v.auth) authentifiziert++;
  }
  let punkte = 0;
  for (const l of welt.historie.values()) punkte += l.length;
  return {
    ha_version: HA_VERSION,
    haushalt: H.NAME,
    extras: !!H.EXTRAS,
    uptime_s: Math.round((Date.now() - startZeit) / 1000),
    verbindungen_offen: verbindungen.size,
    verbindungen_authentifiziert: authentifiziert,
    verbindungen_gesamt: statistik.verbindungenGesamt,
    verbindungen_abgewiesen: statistik.abgewiesen,
    subscriptions: abos,
    nachrichten_gesendet: statistik.gesendet,
    nachrichten_empfangen: statistik.empfangen,
    frames_gesendet: statistik.frames,
    entitaeten: welt.zustaende.size,
    registry_entitaeten: welt.eintraege.length,
    bereiche: welt.bereiche.length,
    geraete: welt.geraete.length,
    historie_punkte: punkte,
    verlauf_wochen: WOCHEN,
    logbuch_ausloesungen: sim.ausloeseLog.length,
    sim_timer: sim.timer.size,
    refresh_tokens: Array.from(anmeldung.refreshTokens.values()).filter(r => !r.widerrufen).length,
    pause_bis: pauseBis > Date.now() ? new Date(pauseBis).toISOString() : null,
    tick_ms: TICK_MS,
    latenz_ms: LATENZ_MS,
    chaos_s: CHAOS_S || null,
    token_ttl_s: TOKEN_TTL_S,
    speicher: process.memoryUsage()
  };
}

async function steuerRoute(req, res, url) {
  if (!istLokal(req)) return antwortJson(res, 403, { fehler: 'Steuer-API nur von localhost' });
  const p = url.pathname;
  if (p === '/sim/status' && req.method === 'GET') return antwortJson(res, 200, status());
  if (p === '/sim/szenarien' && req.method === 'GET') return antwortJson(res, 200, Object.keys(H.SZENARIEN));
  if (req.method !== 'POST') return antwortJson(res, 405, { fehler: 'POST erwartet' });
  if (p === '/sim/trennen') {
    const n = alleTrennen();
    log('Steuer-API: ' + n + ' Verbindung(en) hart getrennt');
    return antwortJson(res, 200, { getrennt: n });
  }
  if (p === '/sim/pause') {
    const s = Math.max(0, Math.min(3600, Number(url.searchParams.get('sekunden') || 10)));
    pauseBis = Date.now() + s * 1000;
    const n = alleTrennen();
    log('Steuer-API: „HA-Neustart“ – ' + s + ' s keine Verbindungen (' + n + ' getrennt)');
    return antwortJson(res, 200, { pause_sekunden: s, getrennt: n });
  }
  if (p === '/sim/tokens-widerrufen') {
    const n = anmeldung.alleWiderrufen();
    log('Steuer-API: ' + n + ' Refresh-Token(s) widerrufen');
    return antwortJson(res, 200, { widerrufen: n });
  }
  if (p === '/sim/state') {
    let body;
    try { body = JSON.parse((await leseKoerper(req, 262144)) || '{}'); } catch (err) { return antwortJson(res, 400, { fehler: 'JSON erwartet' }); }
    if (!body || typeof body.entity_id !== 'string' || !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(body.entity_id)) return antwortJson(res, 400, { fehler: 'entity_id fehlt/ungültig' });
    const alt = welt.zustand(body.entity_id);
    if (!alt && body.state === undefined) return antwortJson(res, 400, { fehler: 'state fehlt' });
    const attrs = Object.assign({}, alt ? alt.attributes : {}, body.attributes || {});
    welt.setze(body.entity_id, body.state === undefined ? alt.state : body.state, attrs, welt.kontext());
    sim.uebernimm(body.entity_id);
    return antwortJson(res, 200, JSON.parse(zustandJson(welt.zustand(body.entity_id))));
  }
  // Registry ändern wie in der HA-Oberfläche (Raum wechseln, umbenennen,
  // ausblenden) – feuert entity_registry_updated wie HA (action "update",
  // changes = alte Werte) und schreibt den Zustand neu (friendly_name).
  // Body: { entity_id, area_id?, name?, hidden? }
  if (p === '/sim/registry') {
    let body;
    try { body = JSON.parse((await leseKoerper(req, 65536)) || '{}'); } catch (err) { return antwortJson(res, 400, { fehler: 'JSON erwartet' }); }
    const e = body && typeof body.entity_id === 'string' ? welt.eintragNachId.get(body.entity_id) : null;
    if (!e) return antwortJson(res, 404, { fehler: 'Entität nicht in der Registry' });
    if (body.area_id !== undefined && body.area_id !== null && !welt.bereichIds.has(body.area_id)) return antwortJson(res, 400, { fehler: 'Unbekannte area_id' });
    const changes = {};
    if (body.area_id !== undefined) { changes.area_id = e.area_id; e.area_id = body.area_id; }
    if (body.name !== undefined) { changes.name = e.name; e.name = body.name || null; }
    if (body.hidden !== undefined) { changes.hidden_by = e.hidden_by; e.hidden_by = body.hidden ? 'user' : null; }
    e.modified_at = Date.now() / 1000;
    welt.feuere('entity_registry_updated', { action: 'update', entity_id: e.entity_id, changes: changes }, welt.kontext());
    const z = welt.zustand(e.entity_id);
    if (z) welt.setze(e.entity_id, z.state, z.attributes, welt.kontext());
    log('Registry: ' + e.entity_id + ' geändert (' + Object.keys(changes).join(', ') + ')');
    return antwortJson(res, 200, { ok: true, entity_id: e.entity_id, area_id: e.area_id, name: e.name, hidden_by: e.hidden_by });
  }
  const sz = /^\/sim\/szenario\/([a-z0-9-]+)$/.exec(p);
  if (sz) {
    const fn = H.SZENARIEN[sz[1]];
    if (!fn) return antwortJson(res, 404, { fehler: 'Unbekanntes Szenario', szenarien: Object.keys(H.SZENARIEN) });
    const parameter = {};
    url.searchParams.forEach((wert, schluessel) => { parameter[schluessel] = wert; });
    try {
      const ergebnisText = await fn(simSchnittstelle, parameter);
      log('Szenario ' + sz[1] + ': ' + (ergebnisText || 'ok'));
      return antwortJson(res, 200, { ok: true, szenario: sz[1], ergebnis: ergebnisText || null });
    } catch (err) {
      return antwortJson(res, 409, { ok: false, szenario: sz[1], fehler: err.message });
    }
  }
  return antwortJson(res, 404, { fehler: 'Unbekannt' });
}

// Was Szenarien benutzen dürfen
const simSchnittstelle = {
  finde: f => sim.finde(f),
  fensterMitHeizung: re => sim.fensterMitHeizung(re),
  setze(id, state, attrs) {
    const alt = welt.zustand(id);
    if (!alt) throw new Error(id + ' gibt es nicht');
    welt.setze(id, state, Object.assign({}, alt.attributes, attrs || {}), welt.kontext());
    sim.uebernimm(id);
  },
  dienst: (domain, service, daten) => dienste.aufrufen(domain, service, daten, null, {}),
  waschmaschine: art => sim.waschmaschine(art),
  bewegung: (id, s) => sim.bewegung(id, s),
  person: (id, z) => sim.person(id, z),
  nichtErreichbar: id => sim.nichtErreichbar(id),
  saugerFehler: () => sim.saugerFehler(),
  tagScannen: id => sim.tagScannen(id),
  reset: () => sim.reset()
};

async function anfrage(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (err) {
    antwortText(res, 400, '400: Bad Request');
    return;
  }
  const p = url.pathname;
  try {
    if (p === '/' || p === '/local/tafel' || p === '/local/tafel/') {
      res.writeHead(302, { Location: '/local/tafel/index.html', 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    // Rohpfad (nicht normalisiert) prüfen, damit „..“ nicht vom URL-Parser weggerechnet wird
    const rohPfad = req.url.split('?')[0];
    if (rohPfad.indexOf('/local/tafel/') === 0) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return antwortText(res, 405, '405: Method Not Allowed');
      statischeDatei(req, res, rohPfad.slice('/local/tafel/'.length));
      return;
    }
    if (p.indexOf('/sim/') === 0) return await steuerRoute(req, res, url);
    if (pauseBis > Date.now() && (p.indexOf('/api/') === 0 || p.indexOf('/auth/') === 0)) {
      antwortText(res, 503, '503: Service Unavailable');
      return;
    }
    if (p.indexOf('/auth/') === 0) return await anmeldeRoute(req, res, url);
    if (p === '/api/' || p === '/api') {
      if (!bearerPruefen(req)) return antwortText(res, 401, '401: Unauthorized');
      return antwortJson(res, 200, { message: 'API running.' });
    }
    const mp = /^\/api\/media_player_proxy\/([a-z0-9_]+\.[a-z0-9_]+)$/.exec(p);
    if (mp && (req.method === 'GET' || req.method === 'HEAD')) return cover(req, res, url, mp[1]);
    antwortText(res, 404, '404: Not Found');
  } catch (err) {
    warnung('HTTP-Fehler bei ' + p + ': ' + (err && err.message));
    if (!res.headersSent) antwortText(res, 500, '500: Internal Server Error');
    else res.destroy();
  }
}

function upgrade(req, socket, kopf) {
  const p = (req.url || '').split('?')[0];
  if (p !== '/api/websocket') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
    return;
  }
  if (pauseBis > Date.now()) {
    statistik.abgewiesen++;
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, kopf, ws => wss.emit('connection', ws, req));
}

// Standard: nur localhost (IPv4 + IPv6). Für das iPad im WLAN: HA_SIM_HOST=0.0.0.0
const server = [];
function lausche(host) {
  const s = http.createServer(anfrage);
  s.on('upgrade', upgrade);
  s.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e) { /* egal */ } });
  s.on('error', err => {
    if (host === '::1' && (err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT')) return;
    warnung('Server ' + host + ':' + PORT + ' – ' + err.message);
    if (err.code === 'EADDRINUSE') process.exit(1);
  });
  s.listen(PORT, host);
  server.push(s);
}
if (HOST) lausche(HOST);
else {
  lausche('127.0.0.1');
  lausche('::1');
}

console.log('HA-Simulator ' + HA_VERSION + ' läuft: http://localhost:' + PORT + '/local/tafel/index.html');
console.log('  WebSocket: ws://localhost:' + PORT + '/api/websocket  ·  Haushalt: ' + H.NAME + (H.EXTRAS ? ' + Extras' : '') +
  ' (' + welt.zustaende.size + ' Entitäten, ' + welt.bereiche.length + ' Räume)  ·  Takt ' + TICK_MS + ' ms' +
  (LATENZ_MS ? '  ·  Latenz ' + LATENZ_MS + ' ms' : '') + (CHAOS_S ? '  ·  Chaos alle ~' + CHAOS_S + ' s' : ''));
console.log('  Token: ' + (process.env.HA_SIM_TOKEN ? 'aus HA_SIM_TOKEN' : 'Standard-Token (siehe README)') + '  ·  Steuer-API: http://localhost:' + PORT + '/sim/status');

function beenden() {
  log('Beende …');
  sim.stoppe();
  for (const v of verbindungen) v.ws.terminate();
  server.forEach(s => s.close());
  setTimeout(() => process.exit(0), 200).unref();
}
process.on('SIGINT', beenden);
process.on('SIGTERM', beenden);
