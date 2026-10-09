'use strict';
/*
 * Selbsttest für den HA-Simulator. Startet den Server NICHT selbst – vorher z. B.:
 *   node tool/ha-simulator/server.js            (echter Haushalt, falls haushalt.json da ist, sonst fiktiv)
 *   HA_SIM_HAUSHALT=fiktiv node tool/ha-simulator/server.js
 *   HA_SIM_TOKEN_TTL_S=8 node tool/ha-simulator/server.js --extras   (prüft auch den Token-Ablauf)
 * Dann: node tool/ha-simulator/selbsttest.js
 * Ausgabe je Prüfung ✓ / ✗ (○ = im aktuellen Haushalt nicht prüfbar). Exit-Code ≠ 0 bei Fehlern.
 * Die Ausgabe nennt bewusst keine Entitäts-IDs (der echte Haushalt ist privat).
 */
const http = require('http');
const WebSocket = require('ws');

const BASIS = (process.env.HA_SIM_URL || 'http://localhost:8124').replace(/\/$/, '');
const TOKEN = process.env.HA_SIM_TOKEN || 'tafel-sim-token';
const WS_URL = BASIS.replace(/^http/, 'ws') + '/api/websocket';
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}\+00:00$/;

let anzahlOk = 0;
let anzahlFehler = 0;
let anzahlSkip = 0;

function pruefe(name, ok, detail) {
  if (ok) {
    anzahlOk++;
    console.log('✓ ' + name);
  } else {
    anzahlFehler++;
    console.log('✗ ' + name + (detail ? ' – ' + detail : ''));
  }
  return !!ok;
}
function skip(name, grund) {
  anzahlSkip++;
  console.log('○ ' + name + ' (übersprungen: ' + grund + ')');
}
const schlafe = ms => new Promise(r => setTimeout(r, ms));

// ───────── HTTP (Rohpfad, damit „..“ wirklich gesendet wird) ─────────
function holen(pfad, opt) {
  opt = opt || {};
  const u = new URL(BASIS);
  return new Promise((ok, nein) => {
    const req = http.request({ host: u.hostname, port: u.port, path: pfad, method: opt.method || 'GET', headers: opt.headers || {} }, res => {
      const teile = [];
      res.on('data', c => teile.push(c));
      res.on('end', () => {
        const text = Buffer.concat(teile).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (err) { json = null; }
        ok({ status: res.statusCode, kopf: res.headers, text: text, json: json });
      });
    });
    req.on('error', nein);
    if (opt.body !== undefined) req.write(opt.body);
    req.end();
  });
}
const postJson = (pfad, daten) => holen(pfad, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(daten || {}) });
const postForm = (pfad, felder) => holen(pfad, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(felder).toString() });

// ───────── WebSocket-Client ─────────
class Client {
  constructor() {
    this.id = 0;
    this.offen = new Map();
    this.ereignisse = [];
    this.arrayFrames = 0;
    this.warter = [];
    this.geschlossen = false;
  }

  verbinde(token) {
    return new Promise((ok, nein) => {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;
      let phase = 'start';
      const zeit = setTimeout(() => nein(new Error('Zeitüberschreitung beim Verbinden')), 5000);
      ws.on('error', err => { if (phase !== 'fertig') { clearTimeout(zeit); nein(err); } });
      ws.on('close', () => {
        this.geschlossen = true;
        if (this.beimSchliessen) this.beimSchliessen();
      });
      ws.on('message', roh => {
        const daten = JSON.parse(roh.toString());
        if (Array.isArray(daten)) this.arrayFrames++;
        for (const m of (Array.isArray(daten) ? daten : [daten])) {
          if (m.type === 'auth_required') {
            phase = 'auth';
            ws.send(JSON.stringify({ type: 'auth', access_token: token }));
          } else if (m.type === 'auth_ok' || m.type === 'auth_invalid') {
            phase = 'fertig';
            clearTimeout(zeit);
            ok(m);
          } else if (m.type === 'result' || m.type === 'pong') {
            const w = this.offen.get(m.id);
            if (w) { this.offen.delete(m.id); w(m); }
          } else if (m.type === 'event') {
            this.ereignisse.push(m);
            if (this.ereignisse.length > 5000) this.ereignisse.splice(0, 1000);
            this.warter = this.warter.filter(w => !w(m));
          }
        }
      });
    });
  }

  sende(msg, ohneId) {
    if (!ohneId) msg = Object.assign({ id: ++this.id }, msg);
    else if (msg.id > this.id) this.id = msg.id;
    return new Promise((ok, nein) => {
      const t = setTimeout(() => { this.offen.delete(msg.id); nein(new Error('keine Antwort auf ' + msg.type)); }, 8000);
      this.offen.set(msg.id, m => { clearTimeout(t); ok(m); });
      this.ws.send(JSON.stringify(msg));
    });
  }

  dienst(domain, service, daten, ziel, extra) {
    const msg = Object.assign({ type: 'call_service', domain: domain, service: service }, extra || {});
    if (daten) msg.service_data = daten;
    if (ziel) msg.target = ziel;
    return this.sende(msg);
  }

  // Auf Ereignisse warten, bis pruef(alle bisherigen) true liefert
  warte(pruef, ms) {
    return new Promise(ok => {
      const gesammelt = [];
      let fertig = false;
      const ende = setTimeout(() => { if (!fertig) { fertig = true; ok({ ok: false, ereignisse: gesammelt }); } }, ms || 3000);
      this.warter.push(m => {
        if (fertig) return true;
        gesammelt.push(m);
        if (pruef(gesammelt, m)) {
          fertig = true;
          clearTimeout(ende);
          ok({ ok: true, ereignisse: gesammelt });
          return true;
        }
        return false;
      });
    });
  }

  schliessen() {
    try { this.ws.close(); } catch (err) { /* egal */ }
  }
}

function stateChanged(m) {
  return m.event && m.event.event_type === 'state_changed' ? m.event.data : null;
}

async function main() {
  console.log('HA-Simulator-Selbsttest gegen ' + BASIS);
  const st0 = await holen('/sim/status').catch(() => null);
  if (!st0 || st0.status !== 200) {
    console.log('✗ Simulator nicht erreichbar – zuerst „node tool/ha-simulator/server.js“ starten');
    process.exit(2);
  }
  const info = st0.json;
  console.log('  Haushalt: ' + info.haushalt + (info.extras ? ' + Extras' : '') + ', ' + info.entitaeten + ' Entitäten, Token-TTL ' + info.token_ttl_s + ' s');
  await postJson('/sim/szenario/reset');

  // ── Anmeldung per WebSocket ──
  const falsch = new Client();
  const r1 = await falsch.verbinde('falscher-token');
  pruefe('ungültiger Token → auth_invalid', r1.type === 'auth_invalid' && r1.message === 'Invalid access token or password');
  await schlafe(200);
  pruefe('… und Verbindung wird geschlossen', falsch.geschlossen);

  const c = new Client();
  const r2 = await c.verbinde(TOKEN);
  pruefe('gültiger Token → auth_ok mit ha_version', r2.type === 'auth_ok' && /^\d{4}\.\d+\.\d+$/.test(r2.ha_version));
  const sf = await c.sende({ type: 'supported_features', features: { coalesce_messages: 1 } });
  pruefe('supported_features (coalesce_messages) → success', sf.success === true);

  // ── Zustände ──
  const gs = await c.sende({ type: 'get_states' });
  const zustaende = gs.result || [];
  const nachId = new Map(zustaende.map(s => [s.entity_id, s]));
  if (info.haushalt === 'fiktiv') pruefe('get_states liefert > 60 Entitäten', zustaende.length > 60, String(zustaende.length));
  else pruefe('get_states liefert alle Entitäten des Haushalts', zustaende.length === info.entitaeten && zustaende.length > 20, String(zustaende.length));
  const bsp = zustaende[0] || {};
  pruefe('State-Format wie HA (Schlüssel, ISO-Zeiten mit +00:00, ULID-Kontext)',
    ['entity_id', 'state', 'attributes', 'last_changed', 'last_reported', 'last_updated', 'context'].every(k => k in bsp) &&
    ISO.test(bsp.last_changed) && ISO.test(bsp.last_updated) && bsp.context && /^[0-9A-Z]{26}$/.test(bsp.context.id));

  const cfg = await c.sende({ type: 'get_config' });
  pruefe('get_config (Zuhause, °C, Europe/Berlin, RUNNING)', cfg.success && cfg.result.location_name === 'Zuhause' && cfg.result.unit_system.temperature === '°C' &&
    cfg.result.time_zone === 'Europe/Berlin' && cfg.result.state === 'RUNNING' && Array.isArray(cfg.result.components));
  const sv = await c.sende({ type: 'get_services' });
  pruefe('get_services enthält light.turn_on, scene.create, todo.add_item', sv.success && sv.result.light && sv.result.light.turn_on && sv.result.scene.create && sv.result.todo.add_item);

  // ── Registries ──
  const ar = await c.sende({ type: 'config/area_registry/list' });
  const dr = await c.sende({ type: 'config/device_registry/list' });
  const er = await c.sende({ type: 'config/entity_registry/list' });
  const bereiche = ar.result || [];
  const geraete = dr.result || [];
  const eintraege = er.result || [];
  pruefe('area_registry: Räume mit area_id/name/icon/aliases/labels', bereiche.length === info.bereiche && bereiche.some(b => b.area_id === 'wohnzimmer') &&
    bereiche.every(b => 'area_id' in b && 'name' in b && 'icon' in b && Array.isArray(b.aliases) && Array.isArray(b.labels) && 'floor_id' in b && 'picture' in b));
  pruefe('device_registry: Geräte mit id/area_id/manufacturer/model/name/via_device_id', geraete.length > 5 &&
    geraete.every(g => typeof g.id === 'string' && 'area_id' in g && 'manufacturer' in g && 'model' in g && 'name_by_user' in g && 'via_device_id' in g && g.disabled_by === null));
  pruefe('entity_registry: Einträge vollständig (inkl. original_icon, options, labels)', eintraege.length === info.registry_entitaeten &&
    eintraege.every(e => ['entity_id', 'id', 'unique_id', 'device_id', 'area_id', 'platform', 'name', 'original_name', 'has_entity_name', 'hidden_by', 'disabled_by', 'entity_category', 'icon', 'original_icon'].every(k => k in e) && Array.isArray(e.labels) && typeof e.options === 'object'));
  const geraetNachId = new Map(geraete.map(g => [g.id, g]));
  const bereichVon = id => {
    const e = eintraege.find(x => x.entity_id === id);
    if (!e) return null;
    if (e.area_id) return e.area_id;
    const g = e.device_id ? geraetNachId.get(e.device_id) : null;
    return g ? g.area_id : null;
  };
  pruefe('die meisten Entitäten mit Gerät haben area_id null (Raum kommt vom Gerät)', eintraege.filter(e => e.device_id && e.area_id === null).length > eintraege.filter(e => e.device_id && e.area_id).length);
  if (info.haushalt === 'fiktiv') {
    pruefe('Entität mit eigener area_id ≠ Geräte-Area vorhanden', eintraege.some(e => e.area_id && e.device_id && geraetNachId.get(e.device_id).area_id && geraetNachId.get(e.device_id).area_id !== e.area_id));
    const versteckt = eintraege.find(e => e.hidden_by === 'user');
    const deaktiviert = eintraege.find(e => e.disabled_by === 'user');
    pruefe('versteckte Entität (hidden_by user) im Registry', !!versteckt);
    pruefe('deaktivierte Entität im Registry, aber nicht in get_states', !!deaktiviert && !nachId.has(deaktiviert.entity_id));
  }
  pruefe('Kategorie-Entitäten (diagnostic/config) vorhanden', eintraege.some(e => e.entity_category === 'diagnostic' || e.entity_category === 'config'));
  const anz = await c.sende({ type: 'config/entity_registry/list_for_display' });
  const ad = anz.result || {};
  pruefe('list_for_display: Format {entity_categories, entities[ei,pl,lb,…]}', ad.entity_categories && ad.entity_categories['0'] === 'config' && ad.entity_categories['1'] === 'diagnostic' &&
    Array.isArray(ad.entities) && ad.entities.every(x => typeof x.ei === 'string' && typeof x.pl === 'string' && Array.isArray(x.lb)));
  pruefe('list_for_display: ohne deaktivierte, ec/hb/hn korrekt', ad.entities.length === eintraege.filter(e => !e.disabled_by).length &&
    ad.entities.every(x => {
      const e = eintraege.find(y => y.entity_id === x.ei);
      return e && (e.entity_category ? x.ec === ['config', 'diagnostic'].indexOf(e.entity_category) : !('ec' in x)) && (!!e.hidden_by === !!x.hb) && (!!e.has_entity_name === !!x.hn) && (e.area_id ? x.ai === e.area_id : !('ai' in x));
    }));

  // ── Events + Licht per Area ──
  const sub = await c.sende({ type: 'subscribe_events', event_type: 'state_changed' });
  pruefe('subscribe_events state_changed → success', sub.success === true);
  const lichterWz = eintraege.filter(e => e.entity_id.indexOf('light.') === 0 && !e.hidden_by && !e.entity_category && bereichVon(e.entity_id) === 'wohnzimmer' &&
    nachId.has(e.entity_id) && nachId.get(e.entity_id).state !== 'unavailable').map(e => e.entity_id);
  await c.dienst('light', 'turn_on', { brightness: 150 }, { area_id: 'wohnzimmer' });
  await schlafe(150);
  const arraysVorher = c.arrayFrames;
  const wartenAus = c.warte(alle => lichterWz.every(id => alle.some(m => { const d = stateChanged(m); return d && d.entity_id === id && d.new_state.state === 'off'; })), 3000);
  const aus = await c.dienst('light', 'turn_off', null, { area_id: 'wohnzimmer' });
  const ausErgebnis = await wartenAus;
  pruefe('light.turn_off mit target.area_id → success mit context', aus.success && aus.result && aus.result.context && aus.result.response === null);
  pruefe('… state_changed für alle Wohnzimmer-Lampen (' + lichterWz.length + ')', ausErgebnis.ok && lichterWz.length >= 2);
  const gruppe = lichterWz.find(id => nachId.get(id).attributes.is_hue_group);
  pruefe('… inklusive Hue-Raumgruppe (is_hue_group, hue_type room, lights, entity_id)', !!gruppe && nachId.get(gruppe).attributes.hue_type === 'room' &&
    Array.isArray(nachId.get(gruppe).attributes.lights) && Array.isArray(nachId.get(gruppe).attributes.entity_id));
  const einAus = ausErgebnis.ereignisse.map(stateChanged).find(d => d && d.new_state.state === 'off' && !d.new_state.attributes.is_hue_group);
  pruefe('… ausgeschaltete Lampe: brightness/color_mode null', !!einAus && einAus.new_state.attributes.brightness === null && einAus.new_state.attributes.color_mode === null);
  pruefe('… Events gebündelt als JSON-Array (coalesce)', c.arrayFrames > arraysVorher);

  // ── brightness_step_pct auf alle Lampen ──
  const lampe = Array.from(nachId.values()).find(s => s.entity_id.indexOf('light.') === 0 && !s.attributes.is_hue_group && s.state !== 'unavailable' && s.attributes.supported_color_modes);
  await c.dienst('light', 'turn_on', { brightness: 128 }, { entity_id: lampe.entity_id });
  const wartenStufe = c.warte(alle => alle.some(m => { const d = stateChanged(m); return d && d.entity_id === lampe.entity_id && d.new_state.attributes.brightness === 77; }), 3000);
  const stufe = await c.dienst('light', 'turn_on', { brightness_step_pct: -20 }, { entity_id: 'all' });
  pruefe('light.turn_on brightness_step_pct −20 mit entity_id all (128 → 77)', stufe.success && (await wartenStufe).ok);
  const wartenAlleAus = c.warte(alle => alle.some(m => { const d = stateChanged(m); return d && d.entity_id === lampe.entity_id && d.new_state.state === 'off'; }), 3000);
  const alleAus = await c.dienst('light', 'turn_off', null, { entity_id: 'all' });
  pruefe('light.turn_off mit entity_id all', alleAus.success && (await wartenAlleAus).ok);

  // ── Hue-Szene ──
  const szene = Array.from(nachId.values()).find(s => s.entity_id.indexOf('scene.') === 0 && s.attributes.group_name && bereichVon(s.entity_id));
  if (szene) {
    pruefe('Hue-Szene hat group_name/name/is_dynamic/brightness/speed', 'name' in szene.attributes && 'is_dynamic' in szene.attributes && 'brightness' in szene.attributes && 'speed' in szene.attributes && szene.attributes.group_type === 'room');
    const wartenSzene = c.warte(alle => alle.some(m => { const d = stateChanged(m); return d && d.entity_id === szene.entity_id && ISO.test(d.new_state.state); }) &&
      alle.some(m => { const d = stateChanged(m); return d && d.entity_id.indexOf('light.') === 0 && d.new_state.state === 'on'; }), 3000);
    const sz = await c.dienst('scene', 'turn_on', null, { entity_id: szene.entity_id });
    pruefe('scene.turn_on → Szenen-State = ISO-Zeit, Lampen des Raums an', sz.success && (await wartenSzene).ok);
  } else {
    skip('scene.turn_on', 'keine Hue-Szene mit Raum');
  }

  // ── scene.create (Schnappschuss) und Wiederherstellen ──
  await c.dienst('light', 'turn_on', { brightness: 200, color_temp_kelvin: 3000 }, { entity_id: lampe.entity_id });
  const istWeiss = lampe.attributes.supported_color_modes.indexOf('color_temp') !== -1;
  const wartenNeu = c.warte(alle => alle.some(m => { const d = stateChanged(m); return d && d.entity_id === 'scene.selbsttest_vorher' && d.old_state === null; }), 3000);
  const cr = await c.dienst('scene', 'create', { scene_id: 'selbsttest_vorher', snapshot_entities: [lampe.entity_id] });
  pruefe('scene.create mit snapshot_entities → neue Szene (state_changed mit old_state null)', cr.success && (await wartenNeu).ok);
  await c.dienst('light', 'turn_on', { brightness: 30 }, { entity_id: lampe.entity_id });
  const wartenZurueck = c.warte(alle => alle.some(m => {
    const d = stateChanged(m);
    return d && d.entity_id === lampe.entity_id && d.new_state.state === 'on' && d.new_state.attributes.brightness === 200 && (!istWeiss || d.new_state.attributes.color_temp_kelvin === 3000);
  }), 3000);
  await c.dienst('scene', 'turn_on', null, { entity_id: 'scene.selbsttest_vorher' });
  pruefe('scene.turn_on der erstellten Szene stellt Helligkeit/Farbtemperatur exakt wieder her', (await wartenZurueck).ok);
  const cr2 = await c.dienst('scene', 'create', { scene_id: 'selbsttest_dict', entities: { [lampe.entity_id]: { state: 'off' } } });
  pruefe('scene.create mit entities-Dict', cr2.success);
  const ohne = await c.dienst('scene', 'create', { scene_id: 'selbsttest_leer' });
  pruefe('scene.create ohne entities/snapshot_entities → invalid_format', !ohne.success && ohne.error.code === 'invalid_format');

  // ── Klima ──
  const heizung = Array.from(nachId.values()).find(s => s.entity_id.indexOf('climate.') === 0);
  if (heizung) {
    const wartenSoll = c.warte(alle => alle.some(m => { const d = stateChanged(m); return d && d.entity_id === heizung.entity_id && d.new_state.attributes.temperature === 23.5; }), 3000);
    const ct = await c.dienst('climate', 'set_temperature', { temperature: 23.5 }, { entity_id: heizung.entity_id });
    pruefe('climate.set_temperature 23.5 → Event mit temperature 23.5', ct.success && (await wartenSoll).ok);
    const zuViel = await c.dienst('climate', 'set_temperature', { temperature: 40 }, { entity_id: heizung.entity_id });
    pruefe('climate.set_temperature 40 → service_validation_error', !zuViel.success && zuViel.error.code === 'service_validation_error');
    pruefe('climate-Attribute (hvac_modes, hvac_action, preset_modes, min/max_temp, target_temp_step)', ['hvac_modes', 'hvac_action', 'preset_modes', 'min_temp', 'max_temp', 'target_temp_step', 'current_temperature'].every(k => k in heizung.attributes));
  } else {
    skip('climate.set_temperature', 'keine Heizung (mit --extras starten)');
  }

  // ── Medien ──
  const VOL = 4;
  const PLAY_MEDIA = 512;
  const spieler = Array.from(nachId.values()).filter(s => s.entity_id.indexOf('media_player.') === 0 && s.state !== 'unavailable');
  const mitLautstaerke = spieler.find(s => s.attributes.supported_features & VOL);
  if (mitLautstaerke) {
    if (mitLautstaerke.state === 'off') await c.dienst('media_player', 'turn_on', null, { entity_id: mitLautstaerke.entity_id });
    const wartenVol = c.warte(alle => alle.some(m => { const d = stateChanged(m); return d && d.entity_id === mitLautstaerke.entity_id && d.new_state.attributes.volume_level === 0.35; }), 3000);
    const vs = await c.dienst('media_player', 'volume_set', { volume_level: 0.35 }, { entity_id: mitLautstaerke.entity_id });
    pruefe('media_player.volume_set 0.35', vs.success && (await wartenVol).ok);
  } else {
    skip('media_player.volume_set', 'kein Player mit VOLUME_SET');
  }
  const mitPlay = spieler.find(s => s.attributes.supported_features & PLAY_MEDIA);
  let cover = null;
  if (mitPlay) {
    const url80 = 'https://streams.80s80s.de/web/mp3-192/streams.80s80s.de/';
    const wartenRadio = c.warte(alle => alle.some(m => { const d = stateChanged(m); if (d && d.entity_id === mitPlay.entity_id && d.new_state.attributes.media_title === '80s80s') { cover = d.new_state.attributes.entity_picture; return true; } return false; }), 3000);
    const pm = await c.dienst('media_player', 'play_media', { media_content_id: url80, media_content_type: 'music' }, { entity_id: mitPlay.entity_id });
    pruefe('media_player.play_media (80s80s-URL) → media_title „80s80s“, playing', pm.success && (await wartenRadio).ok);
    const fehltTyp = await c.dienst('media_player', 'play_media', { media_content_id: url80 }, { entity_id: mitPlay.entity_id });
    pruefe('play_media ohne media_content_type → invalid_format', !fehltTyp.success && fehltTyp.error.code === 'invalid_format');
  } else {
    skip('media_player.play_media', 'kein Player mit PLAY_MEDIA');
  }
  if (cover) {
    const bild = await holen(cover);
    pruefe('Cover-SVG über /api/media_player_proxy abrufbar', bild.status === 200 && /image\/svg\+xml/.test(bild.kopf['content-type']) && bild.text.indexOf('<svg') !== -1);
    const ohneToken = await holen(cover.split('?')[0]);
    pruefe('Cover ohne token → 401', ohneToken.status === 401);
  } else {
    skip('Cover-SVG', 'kein Cover');
  }

  // ── Verlauf ──
  const sensor = Array.from(nachId.values()).find(s => s.entity_id.indexOf('sensor.') === 0 && (s.attributes.device_class === 'humidity' || s.attributes.device_class === 'temperature') && s.state !== 'unavailable');
  if (sensor) {
    const start = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const h1 = await c.sende({ type: 'history/history_during_period', start_time: start, entity_ids: [sensor.entity_id], minimal_response: true, no_attributes: false, significant_changes_only: false });
    const reihe = h1.success ? h1.result[sensor.entity_id] : null;
    pruefe('history: kompaktes Format, erster Eintrag {s,a,lu}, weitere {s,lu}', !!reihe && reihe.length > 20 && typeof reihe[0].s === 'string' && typeof reihe[0].a === 'object' &&
      typeof reihe[0].lu === 'number' && reihe.slice(1).every(e => !('a' in e) && typeof e.lu === 'number'), reihe ? reihe.length + ' Punkte' : (h1.error && h1.error.message));
    pruefe('history: 24 h erzeugter Verlauf (älteste Punkte ~24 h alt, aufsteigend)', !!reihe && (Date.now() / 1000 - reihe[0].lu) > 20 * 3600 && reihe.every((e, i) => i === 0 || e.lu >= reihe[i - 1].lu));
    const h2 = await c.sende({ type: 'history/history_during_period', start_time: start, entity_ids: [sensor.entity_id], minimal_response: false, no_attributes: true });
    pruefe('history mit no_attributes → keine „a“-Felder', h2.success && h2.result[sensor.entity_id].every(e => !('a' in e)));
    const h3 = await c.sende({ type: 'history/history_during_period', start_time: 'kein-datum', entity_ids: [sensor.entity_id] });
    pruefe('history mit ungültiger start_time → invalid_start_time', !h3.success && h3.error.code === 'invalid_start_time');
  } else {
    skip('history', 'kein Temperatur-/Feuchtesensor');
  }

  // ── Wochen-Verlauf + Logbuch ──
  if (info.verlauf_wochen > 0) {
    const vor3Wochen = new Date(Date.now() - 21 * 86400 * 1000).toISOString();
    const person = Array.from(nachId.values()).find(s => s.entity_id.indexOf('person.') === 0);
    const hp = person ? await c.sende({ type: 'history/history_during_period', start_time: vor3Wochen, entity_ids: [person.entity_id], minimal_response: true, no_attributes: true }) : null;
    const reiheP = hp && hp.success ? hp.result[person.entity_id] : null;
    pruefe('history über 3 Wochen: Person mit Werktag-/Wochenend-Wechseln', !!reiheP && reiheP.length > 25 && (Date.now() / 1000 - reiheP[0].lu) > 20 * 86400, reiheP ? reiheP.length + ' Punkte' : 'keine');
    const lb = await c.sende({ type: 'logbook/get_events', start_time: new Date(Date.now() - 7 * 86400 * 1000).toISOString() });
    const eintraege7 = lb.success ? lb.result : [];
    pruefe('logbook/get_events: chronologisch, when als Unix-Sekunden', eintraege7.length > 20 && eintraege7.every((e, i) => typeof e.when === 'number' && (i === 0 || e.when >= eintraege7[i - 1].when)));
    const ausloesungen = eintraege7.filter(e => e.message && e.entity_id.indexOf('automation.') === 0);
    if (Array.from(nachId.keys()).some(id => id.indexOf('automation.') === 0)) {
      pruefe('logbook: Automationen mit name/message „triggered by …“/source/context_id', ausloesungen.length >= 5 && ausloesungen.every(e => e.name && /^triggered by /.test(e.message) && e.source && e.context_id));
      pruefe('logbook: Lichtwechsel tragen den Auslöser (context_event_type automation_triggered)', eintraege7.some(e => e.entity_id.indexOf('light.') === 0 && e.context_event_type === 'automation_triggered' && e.context_entity_id));
    }
    pruefe('logbook: keine kontinuierlichen Sensoren (Temperatur/Leistung)', !eintraege7.some(e => { const s = nachId.get(e.entity_id); return s && e.entity_id.indexOf('sensor.') === 0 && (s.attributes.unit_of_measurement || s.attributes.state_class); }));
    if (person) {
      const lbP = await c.sende({ type: 'logbook/get_events', start_time: new Date(Date.now() - 7 * 86400 * 1000).toISOString(), entity_ids: [person.entity_id] });
      pruefe('logbook mit entity_ids filtert (Personen-Wechsel)', lbP.success && lbP.result.length >= 6 && lbP.result.every(e => e.entity_id === person.entity_id && (e.state === 'home' || e.state === 'not_home')));
    }
  } else {
    skip('Wochen-Verlauf/Logbuch', 'HA_SIM_WOCHEN=0');
  }

  // ── Protokoll-Details ──
  const pong = await c.sende({ type: 'ping' });
  pruefe('ping → pong', pong.type === 'pong');
  const doppelt = await c.sende({ id: 1, type: 'ping' }, true);
  pruefe('alte id → id_reuse', doppelt.success === false && doppelt.error.code === 'id_reuse');
  const unbekannt = await c.sende({ type: 'gibt_es_nicht' });
  pruefe('unbekannter Befehl → unknown_command', unbekannt.success === false && unbekannt.error.code === 'unknown_command');
  const keinDienst = await c.dienst('light', 'zaubern', null, { entity_id: lampe.entity_id });
  pruefe('unbekannter Service → not_found', keinDienst.success === false && keinDienst.error.code === 'not_found');
  const exklusiv = await c.dienst('light', 'turn_on', { color_temp_kelvin: 3000, rgb_color: [255, 0, 0] }, { entity_id: lampe.entity_id });
  pruefe('light.turn_on mit color_temp_kelvin + rgb_color → invalid_format (wie HA)', !exklusiv.success && exklusiv.error.code === 'invalid_format');

  // ── subscribe_entities ──
  const anzahlJetzt = ((await c.sende({ type: 'get_states' })).result || []).length;
  const se = await c.sende({ type: 'subscribe_entities' });
  await schlafe(200);
  const erstes = c.ereignisse.find(m => m.id === se.id && m.event.a);
  pruefe('subscribe_entities → erstes Event mit allen Entitäten (kompakt)', se.success && !!erstes && Object.keys(erstes.event.a).length === anzahlJetzt,
    erstes ? Object.keys(erstes.event.a).length + ' statt ' + anzahlJetzt : 'kein Event');
  const wartenDiff = c.warte(alle => alle.some(m => m.id === se.id && m.event.c && m.event.c[lampe.entity_id]), 3000);
  await c.dienst('light', 'toggle', null, { entity_id: lampe.entity_id });
  pruefe('subscribe_entities → Änderung als „c“-Diff', (await wartenDiff).ok);
  await c.sende({ type: 'unsubscribe_events', subscription: se.id });

  // ── Einkaufsliste ──
  const todo = Array.from(nachId.values()).find(s => s.entity_id.indexOf('todo.') === 0);
  if (todo) {
    const tl = await c.sende({ type: 'todo/item/list', entity_id: todo.entity_id });
    pruefe('todo/item/list → items mit uid/summary/status', tl.success && tl.result.items.length >= 5 && tl.result.items.every(i => i.uid && i.summary && (i.status === 'needs_action' || i.status === 'completed')));
    const ts = await c.sende({ type: 'todo/item/subscribe', entity_id: todo.entity_id });
    const wartenTodo = c.warte(alle => alle.some(m => m.id === ts.id && m.event.items && m.event.items.some(i => i.summary === 'Selbsttest-Milch')), 3000);
    const add = await c.dienst('todo', 'add_item', { item: 'Selbsttest-Milch' }, { entity_id: todo.entity_id });
    pruefe('todo.add_item → Event über todo/item/subscribe', add.success && ts.success && (await wartenTodo).ok);
    const upd = await c.dienst('todo', 'update_item', { item: 'Selbsttest-Milch', status: 'completed' }, { entity_id: todo.entity_id });
    const gi = await c.dienst('todo', 'get_items', null, { entity_id: todo.entity_id }, { return_response: true });
    pruefe('todo.update_item + get_items (return_response)', upd.success && gi.success && gi.result.response[todo.entity_id].items.some(i => i.summary === 'Selbsttest-Milch' && i.status === 'completed'));
    const rm = await c.dienst('todo', 'remove_item', { item: 'Selbsttest-Milch' }, { entity_id: todo.entity_id });
    const rm2 = await c.dienst('todo', 'remove_item', { item: 'Selbsttest-Milch' }, { entity_id: todo.entity_id });
    pruefe('todo.remove_item (zweites Mal → service_validation_error)', rm.success && !rm2.success && rm2.error.code === 'service_validation_error');
    const giOhne = await c.dienst('todo', 'get_items', null, { entity_id: todo.entity_id });
    pruefe('todo.get_items ohne return_response → service_validation_error', !giOhne.success && giOhne.error.code === 'service_validation_error');
    await c.sende({ type: 'unsubscribe_events', subscription: ts.id });
  } else {
    skip('todo', 'keine Liste');
  }

  // ── Automationen / Skripte ──
  const automation = Array.from(nachId.values()).find(s => s.entity_id.indexOf('automation.') === 0);
  if (automation) {
    const vorher = automation.attributes.last_triggered;
    const wartenAuto = c.warte(alle => alle.some(m => { const d = stateChanged(m); return d && d.entity_id === automation.entity_id && d.new_state.attributes.last_triggered && d.new_state.attributes.last_triggered !== vorher; }), 3000);
    const tr = await c.dienst('automation', 'trigger', null, { entity_id: automation.entity_id });
    pruefe('automation.trigger → last_triggered aktualisiert', tr.success && (await wartenAuto).ok);
  } else {
    skip('automation.trigger', 'keine Automation');
  }
  const skript = Array.from(nachId.values()).find(s => s.entity_id.indexOf('script.') === 0);
  if (skript) {
    const wartenSkript = c.warte(alle => alle.some(m => { const d = stateChanged(m); return d && d.entity_id === skript.entity_id && d.new_state.state === 'on'; }) &&
      alle.some(m => { const d = stateChanged(m); return d && d.entity_id === skript.entity_id && d.new_state.state === 'off'; }), 4000);
    const sk = await c.dienst('script', 'turn_on', null, { entity_id: skript.entity_id });
    pruefe('script.turn_on → kurz „on“, dann „off“', sk.success && (await wartenSkript).ok);
  } else {
    skip('script.turn_on', 'kein Skript (mit --extras starten)');
  }

  // ── Steuer-API ──
  const wartenSim = c.warte(alle => alle.some(m => { const d = stateChanged(m); return d && d.entity_id === lampe.entity_id && d.new_state.attributes.selbsttest === 1; }), 3000);
  const ps = await postJson('/sim/state', { entity_id: lampe.entity_id, attributes: { selbsttest: 1 } });
  pruefe('/sim/state setzt Attribut und feuert Event', ps.status === 200 && (await wartenSim).ok);
  const szenarien = (await holen('/sim/szenarien')).json || [];
  let szenarienOk = true;
  const szenarienFehler = [];
  for (const name of szenarien) {
    if (name === 'reset') continue;
    const r = await postJson('/sim/szenario/' + name);
    if (r.status !== 200 && r.status !== 409) { szenarienOk = false; szenarienFehler.push(name + ':' + r.status); }
  }
  pruefe('alle Szenarien laufen (' + szenarien.length + ', 409 = im Haushalt nicht vorhanden)', szenarien.length >= 15 && szenarienOk, szenarienFehler.join(', '));
  await postJson('/sim/szenario/reset');
  const st = await holen('/sim/status');
  pruefe('/sim/status mit Verbindungen, Nachrichten, Speicher', st.status === 200 && st.json.verbindungen_authentifiziert >= 1 && st.json.nachrichten_gesendet > 0 && st.json.speicher && st.json.speicher.heapUsed > 0);

  // ── HTTP ──
  const idx = await holen('/local/tafel/index.html?v=84');
  pruefe('/local/tafel/index.html wird ausgeliefert (text/html, no-store)', idx.status === 200 && /text\/html/.test(idx.kopf['content-type']) && idx.kopf['cache-control'] === 'no-store');
  const gesperrt = ['/local/tafel/../.git/config', '/local/tafel/.git/config', '/local/tafel/%2e%2e/.git/config', '/local/tafel/..%2f.git%2fconfig',
    '/local/tafel/tool/package.json', '/local/tafel/tool/ha-simulator/haushalt.json', '/local/tafel/belege/x.png', '/local/tafel/.gitignore'];
  const antworten = await Promise.all(gesperrt.map(p => holen(p)));
  pruefe('Path-Traversal, .git, versteckte Dateien, tool/, belege/ → 404', antworten.every(r => r.status === 404), antworten.map(r => r.status).join(','));
  const wurzel = await holen('/');
  pruefe('/ → Redirect auf /local/tafel/index.html', wurzel.status === 302 && wurzel.kopf.location === '/local/tafel/index.html');
  const api0 = await holen('/api/');
  const api1 = await holen('/api/', { headers: { Authorization: 'Bearer ' + TOKEN } });
  pruefe('GET /api/ ohne Token 401, mit Token „API running.“', api0.status === 401 && api1.status === 200 && api1.json.message === 'API running.');

  // ── Login-Ablauf ──
  const clientId = BASIS + '/';
  const redirect = BASIS + '/local/tafel/index.html';
  const lf = await postJson('/auth/login_flow', { client_id: clientId, handler: ['homeassistant', null], redirect_uri: redirect });
  pruefe('POST /auth/login_flow → Formular (username/password)', lf.status === 200 && lf.json.type === 'form' && lf.json.step_id === 'init' && lf.json.data_schema.map(x => x.name).join() === 'username,password');
  const lfFalsch = await postJson('/auth/login_flow/' + lf.json.flow_id, { client_id: clientId, username: 'tafel', password: 'falsch' });
  pruefe('falsches Passwort → errors.base invalid_auth', lfFalsch.json.type === 'form' && lfFalsch.json.errors.base === 'invalid_auth');
  const lfFremd = await postJson('/auth/login_flow/' + lf.json.flow_id, { client_id: 'http://fremd.example/', username: 'tafel', password: 'tafel-passwort' });
  pruefe('falsche client_id → 400', lfFremd.status === 400);
  const lfOk = await postJson('/auth/login_flow/' + lf.json.flow_id, { client_id: clientId, username: 'tafel', password: 'tafel-passwort' });
  pruefe('richtiges Passwort → create_entry mit Code', lfOk.json.type === 'create_entry' && typeof lfOk.json.result === 'string');
  const tk = await postForm('/auth/token', { grant_type: 'authorization_code', code: lfOk.json.result, client_id: clientId });
  pruefe('POST /auth/token (authorization_code) → access_token, refresh_token, expires_in', tk.status === 200 && tk.json.access_token && tk.json.refresh_token && tk.json.token_type === 'Bearer' && tk.json.expires_in === info.token_ttl_s);
  const tkNochmal = await postForm('/auth/token', { grant_type: 'authorization_code', code: lfOk.json.result, client_id: clientId });
  pruefe('Code nur einmal gültig', tkNochmal.status === 400);
  const loginClient = new Client();
  const la = await loginClient.verbinde(tk.json.access_token);
  pruefe('WebSocket-auth mit Access-Token aus dem Login → auth_ok', la.type === 'auth_ok');
  const cu = await loginClient.sende({ type: 'auth/current_user' });
  pruefe('auth/current_user → angemeldeter Benutzer', cu.success && cu.result.name === 'tafel');
  const apiLogin = await holen('/api/', { headers: { Authorization: 'Bearer ' + tk.json.access_token } });
  pruefe('GET /api/ mit Access-Token → 200', apiLogin.status === 200);
  const rf = await postForm('/auth/token', { grant_type: 'refresh_token', refresh_token: tk.json.refresh_token, client_id: clientId });
  const neuClient = new Client();
  const rfWs = rf.status === 200 ? await neuClient.verbinde(rf.json.access_token) : null;
  pruefe('Refresh → neues Access-Token funktioniert', rf.status === 200 && rf.json.access_token && !rf.json.refresh_token && rfWs && rfWs.type === 'auth_ok');
  neuClient.schliessen();
  // MFA
  const mf = await postJson('/auth/login_flow', { client_id: clientId, handler: ['homeassistant', null], redirect_uri: redirect });
  const mf1 = await postJson('/auth/login_flow/' + mf.json.flow_id, { client_id: clientId, username: 'mfa-test', password: 'mfa-passwort' });
  pruefe('MFA-Konto → zweiter Schritt step_id „mfa“ mit Feld code', mf1.json.type === 'form' && mf1.json.step_id === 'mfa' && mf1.json.data_schema[0].name === 'code');
  const mf2 = await postJson('/auth/login_flow/' + mf.json.flow_id, { client_id: clientId, code: '000000' });
  pruefe('falscher MFA-Code → errors.base invalid_code', mf2.json.type === 'form' && mf2.json.errors.base === 'invalid_code');
  const mf3 = await postJson('/auth/login_flow/' + mf.json.flow_id, { client_id: clientId, code: '123456' });
  pruefe('richtiger MFA-Code → create_entry', mf3.json.type === 'create_entry' && typeof mf3.json.result === 'string');
  // Widerruf
  const geschlossenNachWiderruf = new Promise(r => { loginClient.beimSchliessen = r; setTimeout(r, 2000); });
  const rv = await postForm('/auth/token', { action: 'revoke', token: tk.json.refresh_token });
  await geschlossenNachWiderruf;
  pruefe('Widerruf (action=revoke) → 200, offene Verbindung des Tokens wird getrennt', rv.status === 200 && loginClient.geschlossen);
  const rfNach = await postForm('/auth/token', { grant_type: 'refresh_token', refresh_token: tk.json.refresh_token, client_id: clientId });
  pruefe('Refresh nach Widerruf → 400 invalid_grant', rfNach.status === 400 && rfNach.json.error === 'invalid_grant');
  const nachWiderruf = new Client();
  const nw = await nachWiderruf.verbinde(rf.json.access_token);
  pruefe('Access-Token eines widerrufenen Refresh-Tokens → auth_invalid', nw.type === 'auth_invalid');
  // alle widerrufen
  const tk2 = await postForm('/auth/token', { grant_type: 'authorization_code', code: mf3.json.result, client_id: clientId });
  const alleWeg = await holen('/sim/tokens-widerrufen', { method: 'POST' });
  const rfWeg = await postForm('/auth/token', { grant_type: 'refresh_token', refresh_token: tk2.json.refresh_token, client_id: clientId });
  pruefe('/sim/tokens-widerrufen → Refresh-Tokens ungültig', alleWeg.status === 200 && alleWeg.json.widerrufen >= 1 && rfWeg.status === 400);
  // Ablauf
  if (info.token_ttl_s <= 15) {
    const lf3 = await postJson('/auth/login_flow', { client_id: clientId, handler: ['homeassistant', null], redirect_uri: redirect });
    const ok3 = await postJson('/auth/login_flow/' + lf3.json.flow_id, { client_id: clientId, username: 'tafel', password: 'tafel-passwort' });
    const tk3 = await postForm('/auth/token', { grant_type: 'authorization_code', code: ok3.json.result, client_id: clientId });
    console.log('  … warte ' + (info.token_ttl_s + 1) + ' s auf Token-Ablauf');
    await schlafe((info.token_ttl_s + 1) * 1000);
    const abgelaufen = new Client();
    const ab = await abgelaufen.verbinde(tk3.json.access_token);
    pruefe('abgelaufenes Access-Token → auth_invalid', ab.type === 'auth_invalid');
    const rf3 = await postForm('/auth/token', { grant_type: 'refresh_token', refresh_token: tk3.json.refresh_token, client_id: clientId });
    const frisch = new Client();
    const fr = rf3.status === 200 ? await frisch.verbinde(rf3.json.access_token) : null;
    pruefe('… nach Refresh wieder auth_ok', !!fr && fr.type === 'auth_ok');
    frisch.schliessen();
  } else {
    skip('Token-Ablauf', 'Server mit HA_SIM_TOKEN_TTL_S=8 starten, um den Ablauf zu prüfen');
  }

  // ── Trennen und Pause ──
  const getrennt = new Promise(r => { c.beimSchliessen = r; setTimeout(r, 3000); });
  const tr = await holen('/sim/trennen', { method: 'POST' });
  await getrennt;
  pruefe('/sim/trennen → Verbindung wird geschlossen', tr.status === 200 && c.geschlossen);
  await holen('/sim/pause?sekunden=2', { method: 'POST' });
  const waehrend = new Client();
  let abgewiesen = false;
  try {
    await waehrend.verbinde(TOKEN);
  } catch (err) {
    abgewiesen = true;
  }
  pruefe('/sim/pause → neue Verbindungen werden abgewiesen', abgewiesen);
  await schlafe(2300);
  const danach = new Client();
  const dn = await danach.verbinde(TOKEN);
  pruefe('… nach der Pause wieder auth_ok', dn.type === 'auth_ok');
  danach.schliessen();
  await postJson('/sim/szenario/reset');

  console.log('\n' + anzahlOk + ' ✓, ' + anzahlFehler + ' ✗' + (anzahlSkip ? ', ' + anzahlSkip + ' ○' : ''));
  process.exit(anzahlFehler ? 1 : 0);
}

main().catch(err => {
  console.log('✗ Abbruch: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
