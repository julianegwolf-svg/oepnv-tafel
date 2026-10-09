'use strict';
/*
 * Verhalten des Haushalts: Lampen + Hue-Gruppen + Szenen, Heizungen und Raumklima,
 * Medien, Steckdosen/Strom, Sauger, Waschmaschine, Personen, Bewegung, Sonne, Wetter,
 * Einkaufsliste, Skripte und Automationen. Alle Zustände werden über welt.setze() geschrieben.
 * Funktioniert für den fiktiven wie für den echten Haushalt (alles über die Haushalt-Beschreibung).
 */
const {
  jetzt, iso, isoSekunden, ortsStunde, zufall, rauschen, runde, begrenze, zufallsToken, hexId
} = require('./werkzeuge');
const farben = require('./farben');
const { erzeugeKurve } = require('./historie');

const EFFEKTE_FARBE = ['off', 'candle', 'fire', 'prism', 'sparkle', 'opal', 'glisten', 'underwater', 'cosmos', 'sunbeam', 'enchant'];
const EFFEKTE_WEISS = ['off', 'candle', 'fire'];
const WASCH_ZUSTAENDE = ['inactive', 'ready', 'delayedstart', 'run', 'pause', 'actionrequired', 'finished', 'error', 'aborting'];
const LUEFTER = ['off', 'quiet', 'balanced', 'turbo', 'max', 'max_plus', 'custom'];
const SAUGER_FEATURES = 4 | 8 | 16 | 32 | 64 | 256 | 512 | 1024 | 4096 | 8192;
const HEIMAT = { lat: 53.073, lon: 8.887 };
const WOCHENTAGE = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FARB_SCHLUESSEL = ['color_temp_kelvin', 'xy_color', 'hs_color', 'rgb_color', 'color_name'];
const HELL_SCHLUESSEL = ['brightness_pct', 'brightness', 'brightness_step_pct', 'brightness_step'];
const APP_INHALTE = {
  'Netflix': { titel: 'Dark', typ: 'tvshow' },
  'YouTube': { titel: 'Werder Bremen – Highlights', typ: 'video' },
  'Disney+': { titel: 'Andor', typ: 'tvshow' },
  'ARD Mediathek': { titel: 'Tatort', typ: 'video' },
  'ZDFmediathek': { titel: 'heute journal', typ: 'video' },
  'Apple TV': { titel: 'Severance', typ: 'tvshow' },
  'Musik': { titel: 'Blinding Lights', typ: 'music' }
};

const berlinTag = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', weekday: 'short' });
function wochentag(sek) {
  return berlinTag.format(new Date(sek * 1000)).slice(0, 3).toLowerCase();
}
function zeitInStunden(text) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(text || ''));
  return m ? Number(m[1]) + Number(m[2]) / 60 + Number(m[3] || 0) / 3600 : null;
}
function dauerInSekunden(d) {
  if (typeof d === 'number') return d;
  if (typeof d === 'string') {
    const t = zeitInStunden(d);
    return t === null ? Number(d) || 0 : t * 3600;
  }
  if (d && typeof d === 'object') return (d.days || 0) * 86400 + (d.hours || 0) * 3600 + (d.minutes || 0) * 60 + (d.seconds || 0) + (d.milliseconds || 0) / 1000;
  return 0;
}
function liste(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

class Simulation {
  constructor(welt, haushalt, optionen) {
    this.welt = welt;
    this.h = haushalt;
    this.opt = optionen || {};
    this.dienste = null;           // wird von server.js gesetzt
    this.timer = new Set();        // laufende Timeouts (werden bei reset/stop geräumt)
    this.intervalle = [];
    this.bewegungsTimer = new Map();
    this.erstellteSzenen = new Map();
    this.todoHoerer = new Set();
    this.ausloeseLog = [];         // Logbuch: automation_triggered (erzeugt + live), begrenzt
    this.kontextInfo = new Map();  // Kontext-ID → Logbuch-Zusatz (wer hat geschaltet), begrenzt
    this.verlaufInfo = null;
    this.letzterTick = jetzt();
    this.letzteZeitMinute = null;
    this.ids = new Set(haushalt.ENTITAETEN.map(e => e.entity_id));
    this.log = this.opt.log || function () {};
  }

  hat(id) {
    return this.ids.has(id) && !!this.welt.zustand(id);
  }

  // ───────────────────────── Start / Reset ─────────────────────────
  starte() {
    this.initialisiere(true);
    this.welt.abonniere(e => this.reagiere(e));
    const tickMs = this.opt.tickMs || 5000;
    this.intervalle.push(setInterval(() => this.tick(), tickMs));
    this.intervalle.push(setInterval(() => this.schreibeSonne(), 300000));
    this.intervalle.push(setInterval(() => this.schreibeWetter(false), 1800000));
    this.intervalle.push(setInterval(() => this.zeitAusloeser(), 20000));
    this.planeZufallsbewegung();
  }

  stoppe() {
    this.intervalle.forEach(i => clearInterval(i));
    this.intervalle = [];
    this.raeumeTimer();
  }

  raeumeTimer() {
    for (const t of this.timer) clearTimeout(t);
    this.timer.clear();
    this.bewegungsTimer.clear();
  }

  // setTimeout mit Buchführung (damit nichts liegen bleibt)
  spaeter(ms, fn) {
    const t = setTimeout(() => {
      this.timer.delete(t);
      try {
        fn();
      } catch (err) {
        console.error('[sim] Fehler im Timer:', err);
      }
    }, ms);
    this.timer.add(t);
    return t;
  }

  abbrechen(t) {
    if (t) {
      clearTimeout(t);
      this.timer.delete(t);
    }
  }

  warte(sekunden) {
    return new Promise(fertig => this.spaeter(sekunden * 1000, fertig));
  }

  reset() {
    this.raeumeTimer();
    const ctx = this.welt.kontext();
    for (const id of Array.from(this.erstellteSzenen.keys())) this.welt.entferne(id, ctx);
    this.erstellteSzenen.clear();
    this.initialisiere(false);
    this.planeZufallsbewegung();
  }

  // Alle Modelle aus der Haushalt-Beschreibung aufbauen und Zustände schreiben
  initialisiere(beimStart) {
    const w = this.welt;
    const h = this.h;
    const t = jetzt();
    const vorher = (minMin, maxMin) => beimStart ? { zeit: t - zufall(minMin * 60, maxMin * 60) } : undefined;

    this.lampen = new Map();
    this.gruppen = new Map();
    this.gruppeVonRaum = new Map();
    this.szenen = new Map();
    this.szenenAuswahl = new Map();
    this.heizungen = new Map();
    this.raeume = new Map();
    this.medien = new Map();
    this.steckdosen = new Map();
    this.dynamik = new Map();
    this.automationen = new Map();
    this.fensterVonRaum = new Map();
    this.raumsensoren = [];
    this.todos = new Map();
    this.remoteVonMedien = new Map();
    this.wetterId = null;

    for (const e of h.ENTITAETEN) {
      const c = e.modell || {};
      if (e.art === 'lampe') {
        const farbmodus = c.farbe ? 'xy' : ((c.matter && (c.farbig || c.hs)) ? 'hs' : null);
        this.lampen.set(e.entity_id, {
          id: e.entity_id, matter: !!c.matter, nurHelligkeit: !!c.nurHelligkeit, farbmodus: c.nurHelligkeit ? null : farbmodus,
          minK: c.matter ? 2202 : 2000, maxK: c.matter ? 4000 : 6535,
          an: !!c.an, bri: c.bri || 200,
          modus: c.nurHelligkeit ? 'brightness' : (c.xy && farbmodus === 'xy' ? 'xy' : (c.hs && farbmodus === 'hs' ? 'hs' : 'color_temp')),
          kelvin: c.kelvin || 2700, xy: (c.xy || [0.4573, 0.4100]).slice(), hs: (c.hs || [30, 70]).slice(),
          verfuegbar: !c.nichtErreichbar, effekt: null, dynamisch: false
        });
      } else if (e.art === 'szene') {
        this.szenen.set(e.entity_id, Object.assign({ speed: 0.6 }, c));
      } else if (e.art === 'szenenauswahl') {
        this.szenenAuswahl.set(c.raum, { id: e.entity_id, optionen: c.optionen || [] });
      } else if (e.art === 'heizung') {
        this.heizungen.set(e.entity_id, { id: e.entity_id, raum: c.raum, modus: c.modus, soll: c.soll, preset: c.preset, aktion: null });
      } else if (e.art === 'medien') {
        this.medien.set(e.entity_id, {
          id: e.entity_id, cfg: c, zustand: c.zustand, titel: c.titel, position: c.position, positionZeit: t,
          lautstaerke: c.lautstaerke, stumm: false, quelle: null, radio: null, app: null, geraet: e.geraet,
          token: zufallsToken(32), cache: zufallsToken(8), shuffle: false, repeat: 'off', contentId: null
        });
      } else if (e.art === 'steckdose') {
        const objekt = e.entity_id.split('.')[1];
        this.steckdosen.set(e.entity_id, {
          id: e.entity_id, an: !!c.an, energie: c.energie, profil: c.profil, seit: t - 3600,
          leistungId: 'sensor.' + objekt + '_leistung', energieId: 'sensor.' + objekt + '_energie', leistung: 0
        });
      } else if (e.art === 'automation') {
        this.automationen.set(e.entity_id, { an: c.an !== false, zuletzt: null, eintragId: e.unique_id, cfg: (h.AUTOMATIONEN || {})[e.entity_id] || null, laeuft: 0 });
      } else if (e.art === 'binaer' && c.fenster) {
        const l = this.fensterVonRaum.get(c.raum) || [];
        l.push(e.entity_id);
        this.fensterVonRaum.set(c.raum, l);
      } else if (e.art === 'raumsensor') {
        this.raumsensoren.push({ id: e.entity_id, raum: c.raum, groesse: c.groesse, versatz: c.versatz || 0 });
      } else if (e.art === 'todo') {
        const start = (h.TODO || {})[e.entity_id] || [];
        this.todos.set(e.entity_id, start.map((x, i) => ({ summary: x[0], uid: hexId(e.entity_id + '-' + i + '-' + x[0]), status: x[1] })));
      } else if (e.art === 'wetter' && !this.wetterId) {
        this.wetterId = e.entity_id;
      }
    }
    // Fernbedienung ↔ Mediaplayer desselben Geräts
    for (const e of h.ENTITAETEN) {
      if (e.art !== 'fernbedienung' || !e.geraet) continue;
      for (const m of this.medien.values()) if (m.geraet === e.geraet) this.remoteVonMedien.set(m.id, e.entity_id);
    }

    // Hue-Gruppen: Mitglieder = Hue-Lampen (nicht Matter) im selben Raum
    for (const e of h.ENTITAETEN) {
      if (e.art !== 'gruppe') continue;
      const raum = e.modell.raum;
      const mitglieder = Array.from(this.lampen.values()).filter(l => !l.matter && raum && w.bereichVon(l.id) === raum).map(l => l.id);
      this.gruppen.set(e.entity_id, { id: e.entity_id, raum: raum, mitglieder: mitglieder });
      if (raum) this.gruppeVonRaum.set(raum, e.entity_id);
    }

    // Räume (für alle Areas mit Klima-Profil)
    Object.keys(h.KLIMA).forEach(raum => {
      const k = h.KLIMA[raum];
      const heizung = Array.from(this.heizungen.values()).find(x => x.raum === raum);
      this.raeume.set(raum, {
        raum: raum, temp: k.temp, feuchte: k.feuchte, basisTemp: k.basisTemp, basisFeuchte: k.basisFeuchte,
        amplitude: k.amplitude, besonders: k.besonders || null, heizung: heizung ? heizung.id : null,
        fenster: this.fensterVonRaum.get(raum) || []
      });
    });
    for (const hz of this.heizungen.values()) {
      if (!this.raeume.has(hz.raum)) this.raeume.set(hz.raum, { raum: hz.raum, temp: 20, feuchte: null, basisTemp: 20, basisFeuchte: null, amplitude: 0.5, besonders: null, heizung: hz.id, fenster: [] });
    }

    // Mehrwöchigen Verlauf nur beim Start erzeugen (vor den Startzuständen)
    if (beimStart && this.opt.wochen > 0) {
      const { erzeugeWochen } = require('./wochen');
      this.verlaufInfo = erzeugeWochen(this, this.opt.wochen, t);
    }

    this.sauger = { zustand: 'docked', akku: 100, luefter: 'balanced', seit: t, fehler: null };
    this.wasch = { zustand: 'run', start: t - 600 / 0.7 * 0.3, ende: t + 600 };
    this.stromGesamt = 0;
    this.zaehlerstand = 18452.318;

    // ── Zustände schreiben ──
    for (const e of h.ENTITAETEN) {
      const id = e.entity_id;
      switch (e.art) {
        case 'statisch':
        case 'sensor':
        case 'binaer':
        case 'helfer':
        case 'fernbedienung':
        case 'schalter_einfach':
        case 'zahl':
          w.setze(id, e.start.state, e.start.attributes, null, vorher(10, 900));
          break;
        case 'raumsensor': {
          const rs = this.raumsensoren.find(x => x.id === id);
          const raum = this.raeume.get(rs.raum);
          const attrs = e.start.attributes;
          if (beimStart && raum) {
            const ende = t - zufall(60, 400);
            const temp = rs.groesse === 'temp';
            const kurve = erzeugeKurve({
              ende: ende, endwert: Number(e.start.state),
              basis: temp ? raum.basisTemp + rs.versatz : (raum.basisFeuchte || 50),
              amplitude: temp ? raum.amplitude : 3, spitzeStunde: temp ? 17 : 5,
              rauschen: temp ? 0.06 : 0.5, besonders: raum.besonders, groesse: rs.groesse,
              min: temp ? undefined : 25, max: temp ? undefined : 95
            });
            this.belegeVerlauf(id, kurve, 1, attrs);
            w.setze(id, e.start.state, attrs, null, { zeit: ende });
          } else {
            w.setze(id, e.start.state, attrs);
          }
          break;
        }
        default:
          break;
      }
    }
    for (const l of this.lampen.values()) this.schreibeLampe(l.id, null, vorher(20, 240));
    for (const g of this.gruppen.keys()) this.schreibeGruppe(g, null, vorher(20, 240));
    for (const [id, sz] of this.szenen) {
      const minuten = (h.SZENEN_ZULETZT || {})[id];
      const state = minuten ? iso(t - minuten * 60) : 'unknown';
      w.setze(id, state, this.szenenAttribute(sz), null, beimStart ? { zeit: t - (minuten || 1440) * 60 } : undefined);
    }
    for (const sa of this.szenenAuswahl.values()) w.setze(sa.id, 'unknown', { options: sa.optionen.slice() }, null, vorher(60, 600));
    for (const e of h.ENTITAETEN) {
      if (e.art === 'szene_ha') w.setze(e.entity_id, 'unknown', { entity_id: Object.keys(e.modell.entities), id: e.modell.id }, null, vorher(600, 1400));
    }
    for (const hz of this.heizungen.values()) {
      hz.aktion = this.berechneAktion(hz, true);
      this.schreibeHeizung(hz.id, null, vorher(30, 300));
    }
    for (const m of this.medien.values()) {
      this.schreibeMedien(m.id, null, vorher(1, 30));
      const r = this.remoteVonMedien.get(m.id);
      if (r && w.zustand(r)) w.setze(r, m.zustand === 'off' ? 'off' : 'on', w.zustand(r).attributes, null, vorher(1, 30));
    }
    for (const s of this.steckdosen.values()) this.schreibeSteckdose(s, null, vorher(30, 600), 0);
    this.schreibeStromGesamt(beimStart);
    this.schreibeSauger(null, vorher(30, 120));
    this.schreibeWaschmaschine(null, vorher(10, 20));
    for (const e of h.ENTITAETEN) {
      if (e.art === 'person') this.schreibePerson(e.entity_id, e.modell.zustand, null, vorher(60, 400));
      else if (e.art === 'tracker') this.schreibeTracker(e.entity_id, e.modell.zustand, null, vorher(60, 400));
      else if (e.art === 'skript') {
        const alt = w.zustand(e.entity_id);
        w.setze(e.entity_id, 'off', { last_triggered: beimStart ? iso(t - zufall(3600, 86400)) : (alt ? alt.attributes.last_triggered : null), mode: 'single', current: 0 }, null, vorher(60, 1400));
      } else if (e.art === 'automation') this.schreibeAutomation(e.entity_id, null, vorher(600, 1400));
      else if (e.art === 'todo') this.schreibeTodo(e.entity_id, null, vorher(60, 600));
    }
    this.schreibeZone();
    this.schreibeSonne();
    this.schreibeWetter(true);
  }

  // Erzeugte Kurve als Verlauf hinterlegen (nur Wertwechsel, wie der Recorder)
  belegeVerlauf(id, kurve, stellen, attrs) {
    const geordnet = this.welt.ordneAttribute(id, attrs);
    const punkte = [];
    let letzter = null;
    for (const p of kurve) {
      const s = p.v.toFixed(stellen);
      if (s === letzter) continue;
      punkte.push({ s: s, a: geordnet, lu: p.t, lc: p.t, nurAttr: false });
      letzter = s;
    }
    this.welt.historieVorbelegen(id, punkte);
  }

  // Entitäten suchen (für Szenarien): { domain, deviceClass:[], raumName:/re/, ausser:/re/, nurLampen }
  finde(f) {
    const ergebnis = [];
    for (const [id, s] of this.welt.zustaende) {
      if (f.domain && id.split('.')[0] !== f.domain) continue;
      if (f.deviceClass && f.deviceClass.indexOf(s.attributes.device_class) === -1) continue;
      if (f.ausser && f.ausser.test(id)) continue;
      if (f.nurLampen && (this.gruppen.has(id) || !this.lampen.has(id) || !this.lampen.get(id).verfuegbar)) continue;
      if (f.raumName) {
        const b = this.welt.bereichVon(id);
        const bereich = b ? this.welt.bereiche.find(x => x.area_id === b) : null;
        if (!bereich || !f.raumName.test(bereich.name)) continue;
      }
      ergebnis.push(id);
    }
    return ergebnis;
  }

  fensterMitHeizung(bevorzugt) {
    const paare = [];
    for (const hz of this.heizungen.values()) {
      const r = this.raeume.get(hz.raum);
      for (const f of (r ? r.fenster : [])) paare.push({ fenster: f, heizung: hz.id, raum: hz.raum });
    }
    const name = raum => { const b = this.welt.bereiche.find(x => x.area_id === raum); return b ? b.name : ''; };
    paare.sort((a, b) => (bevorzugt.test(name(b.raum)) ? 1 : 0) - (bevorzugt.test(name(a.raum)) ? 1 : 0));
    return paare;
  }

  // ───────────────────────── Reaktionen auf Ereignisse ─────────────────────────
  reagiere(e) {
    if (e.event_type !== 'state_changed') return;
    const d = e.data;
    const id = d.entity_id;
    const neu = d.new_state;
    const alt = d.old_state;
    const bl = this.h.BEWEGUNGSLICHT;
    if (bl && id === bl.sensor && neu) this.bewegungslicht(neu.state, alt ? alt.state : null, e.context);
    if (id.indexOf('person.') === 0) this.schreibeZone();
    if (id === 'binary_sensor.waschmaschine_tuer' && neu && neu.state === 'on' && this.wasch.zustand === 'finished') {
      this.wasch.zustand = 'ready';
      this.schreibeWaschmaschine(this.welt.kontext(e.context));
    }
    const remote = this.remoteVonMedien.get(id);
    if (remote && neu) {
      const r = this.welt.zustand(remote);
      if (r) this.welt.setze(remote, neu.state === 'off' || neu.state === 'unavailable' ? neu.state : 'on', r.attributes, this.welt.kontext(e.context));
    }
    // Zustands-Auslöser der Automationen
    if (neu) {
      for (const [aid, a] of this.automationen) {
        if (!a.an || !a.cfg) continue;
        for (const t of liste(a.cfg.triggers)) {
          const art = t.trigger || t.platform;
          if (art !== 'state') continue;
          if (liste(t.entity_id).indexOf(id) === -1) continue;
          if (t.attribute) continue;
          if (alt && alt.state === neu.state) continue;
          if (t.to !== undefined && t.to !== null && liste(t.to).indexOf(neu.state) === -1) continue;
          if (t.from !== undefined && t.from !== null && (!alt || liste(t.from).indexOf(alt.state) === -1)) continue;
          this.automationAusloesen(aid, e.context, false, 'state of ' + id);
          break;
        }
      }
    }
  }

  // Zeit-Auslöser (trigger: time, at: HH:MM:SS) – einmal pro Minute prüfen
  zeitAusloeser() {
    const t = jetzt();
    const h = ortsStunde(t);
    const minute = Math.floor(h * 60);
    if (minute === this.letzteZeitMinute) return;
    this.letzteZeitMinute = minute;
    for (const [aid, a] of this.automationen) {
      if (!a.an || !a.cfg) continue;
      for (const tr of liste(a.cfg.triggers)) {
        if ((tr.trigger || tr.platform) !== 'time') continue;
        for (const at of liste(tr.at)) {
          const z = zeitInStunden(at);
          if (z !== null && Math.floor(z * 60) === minute) this.automationAusloesen(aid, null, false, 'time');
        }
      }
    }
  }

  bewegungslicht(neu, alt, triggerKontext) {
    const bl = this.h.BEWEGUNGSLICHT;
    const a = this.automationen.get(bl.automation);
    if (!a || !a.an) return;
    if (neu === 'on' && alt !== 'on') {
      this.abbrechen(this.bewegungsAusTimer);
      const ctx = this.welt.kontext(triggerKontext);
      a.zuletzt = jetzt();
      this.schreibeAutomation(bl.automation, ctx);
      const stunde = ortsStunde(jetzt());
      const nacht = stunde >= 22 || stunde < 6.5;
      this.lichtDienst(bl.lampen, 'an', nacht ? { brightness: 40, color_temp_kelvin: 2200 } : { brightness: 200, color_temp_kelvin: 3000 }, ctx);
    } else if (neu === 'off' && alt === 'on') {
      this.abbrechen(this.bewegungsAusTimer);
      this.bewegungsAusTimer = this.spaeter(bl.ausNachSekunden * 1000, () => {
        const s = this.welt.zustand(bl.sensor);
        if (s && s.state === 'off' && a.an) this.lichtDienst(bl.lampen, 'aus', {}, this.welt.kontext());
      });
    }
  }

  // ───────────────────────── Lampen ─────────────────────────
  lichtAttribute(l) {
    const a = {};
    if (!l.nurHelligkeit) {
      a.min_color_temp_kelvin = l.minK;
      a.max_color_temp_kelvin = l.maxK;
    }
    const effekte = !l.matter && !l.nurHelligkeit;
    if (effekte) a.effect_list = l.farbmodus ? EFFEKTE_FARBE.slice() : EFFEKTE_WEISS.slice();
    a.supported_color_modes = l.nurHelligkeit ? ['brightness'] : (l.farbmodus ? ['color_temp', l.farbmodus] : ['color_temp']);
    const features = l.matter ? 32 : (effekte ? 44 : 40);
    if (!l.verfuegbar) {
      a.supported_features = features;
      return a;
    }
    if (effekte) a.effect = l.an ? (l.effekt || 'off') : null;
    a.color_mode = l.an ? l.modus : null;
    a.brightness = l.an ? l.bri : null;
    if (!l.nurHelligkeit) {
      a.color_temp_kelvin = (l.an && l.modus === 'color_temp') ? l.kelvin : null;
      Object.assign(a, this.farbwerte(l.an ? l : null));
    }
    if (!l.matter) {
      a.mode = 'normal';
      a.dynamics = l.dynamisch ? 'dynamic_palette' : 'none';
    }
    a.supported_features = features;
    return a;
  }

  farbwerte(l) {
    if (!l || l.modus === 'brightness') return { hs_color: null, rgb_color: null, xy_color: null };
    let rgb;
    let hs;
    let xy;
    if (l.modus === 'color_temp') {
      rgb = farben.kelvinZuRgb(l.kelvin);
      hs = farben.rgbZuHs(rgb);
      xy = farben.rgbZuXy(rgb);
    } else if (l.modus === 'xy') {
      xy = l.xy.slice();
      rgb = farben.xyZuRgb(xy);
      hs = farben.rgbZuHs(rgb);
    } else {
      hs = l.hs.slice();
      rgb = farben.hsZuRgb(hs);
      xy = farben.rgbZuXy(rgb);
    }
    return { hs_color: hs, rgb_color: rgb, xy_color: xy };
  }

  lampenName(id) {
    const e = this.welt.eintragNachId.get(id);
    return e ? this.welt.freundlicherName(e) : id;
  }

  schreibeLampe(id, ctx, opt) {
    const l = this.lampen.get(id);
    const state = l.verfuegbar ? (l.an ? 'on' : 'off') : 'unavailable';
    return this.welt.setze(id, state, this.lichtAttribute(l), ctx, opt);
  }

  gruppeIstAn(g) {
    return g.mitglieder.some(id => {
      const l = this.lampen.get(id);
      return l.verfuegbar && l.an;
    });
  }

  schreibeGruppe(gid, ctx, opt) {
    const w = this.gruppenWerte(gid, id => this.lampen.get(id));
    return this.welt.setze(gid, w.state, w.a, ctx, opt);
  }

  // Zustand + Attribute einer Hue-Gruppe aus (beliebigen) Lampenzuständen berechnen
  gruppenWerte(gid, holeLampe) {
    const g = this.gruppen.get(gid);
    const ms = g.mitglieder.map(holeLampe);
    const verf = ms.filter(l => l.verfuegbar);
    const an = verf.filter(l => l.an);
    const farbig = ms.some(l => l.farbmodus);
    const nurHell = ms.length > 0 && ms.every(l => l.nurHelligkeit);
    const a = {};
    if (!nurHell) {
      a.min_color_temp_kelvin = 2000;
      a.max_color_temp_kelvin = 6535;
    }
    a.supported_color_modes = nurHell ? ['brightness'] : (farbig ? ['color_temp', 'xy'] : ['color_temp']);
    const erste = an.find(l => !l.nurHelligkeit) || an[0] || null;
    a.color_mode = erste ? (nurHell ? 'brightness' : (erste.modus === 'color_temp' || erste.modus === 'brightness' ? 'color_temp' : 'xy')) : null;
    a.brightness = an.length ? Math.round(an.reduce((s, l) => s + l.bri, 0) / an.length) : null;
    if (!nurHell) {
      const farbQuelle = erste && erste.modus !== 'brightness' ? erste : (erste ? { modus: 'color_temp', kelvin: 2700 } : null);
      a.color_temp_kelvin = farbQuelle && farbQuelle.modus === 'color_temp' ? farbQuelle.kelvin : null;
      Object.assign(a, this.farbwerte(farbQuelle));
    }
    a.is_hue_group = true;
    const szenenNamen = [];
    for (const sz of this.szenen.values()) if (sz.raum === g.raum && szenenNamen.indexOf(sz.name) === -1) szenenNamen.push(sz.name);
    a.hue_scenes = szenenNamen;
    a.hue_type = 'room';
    a.lights = ms.map(l => this.lampenName(l.id));
    a.entity_id = g.mitglieder.slice();
    a.dynamics = this.dynamik.has(g.raum) ? 'dynamic_palette' : 'none';
    a.supported_features = 40;
    const state = ms.length && verf.length === 0 ? 'unavailable' : (an.length ? 'on' : 'off');
    return { state: state, a: a };
  }

  // Einzelne Lampe ändern (ohne zu schreiben). art: 'an' | 'aus' | 'toggle'
  lampeAnwenden(id, art, d) {
    const l = this.lampen.get(id);
    if (!l || !l.verfuegbar) return false;
    if (art === 'toggle') art = l.an ? 'aus' : 'an';
    if (art === 'aus') {
      l.an = false;
      l.effekt = null;
      return true;
    }
    let bri = null;
    if (d.brightness !== undefined) bri = d.brightness;
    else if (d.brightness_pct !== undefined) bri = Math.round(d.brightness_pct * 255 / 100);
    else if (d.brightness_step !== undefined) bri = (l.an ? l.bri : 0) + d.brightness_step;
    else if (d.brightness_step_pct !== undefined) bri = (l.an ? l.bri : 0) + Math.round(d.brightness_step_pct * 255 / 100);
    if (bri !== null && bri <= 0) {
      // wie HA: Helligkeit 0 bedeutet ausschalten
      l.an = false;
      l.effekt = null;
      return true;
    }
    if (bri !== null) l.bri = begrenze(Math.round(bri), 1, 255);
    if (!l.nurHelligkeit) {
      if (d.color_temp_kelvin !== undefined) {
        l.modus = 'color_temp';
        l.kelvin = begrenze(Math.round(d.color_temp_kelvin), l.minK, l.maxK);
      } else {
        let rgb = null;
        let xy = null;
        let hs = null;
        if (d.xy_color) xy = [Number(d.xy_color[0]), Number(d.xy_color[1])];
        else if (d.hs_color) hs = [Number(d.hs_color[0]), Number(d.hs_color[1])];
        else if (d.rgb_color) rgb = d.rgb_color.map(Number);
        else if (d.color_name) rgb = farben.FARBNAMEN[d.color_name];
        if (xy || hs || rgb) {
          if (!xy) xy = farben.rgbZuXy(rgb || farben.hsZuRgb(hs));
          if (l.farbmodus === 'xy') {
            l.modus = 'xy';
            l.xy = [runde(xy[0], 4), runde(xy[1], 4)];
          } else if (l.farbmodus === 'hs') {
            l.modus = 'hs';
            l.hs = hs ? [runde(hs[0], 3), runde(hs[1], 3)] : farben.rgbZuHs(rgb || farben.xyZuRgb(xy));
          } else {
            // Weiß-Lampe: Farbe wird wie in HA in eine Farbtemperatur umgerechnet
            l.modus = 'color_temp';
            l.kelvin = begrenze(farben.xyZuKelvin(xy), l.minK, l.maxK);
          }
        }
      }
    }
    if (d.effect !== undefined && !l.matter && !l.nurHelligkeit) l.effekt = d.effect === 'off' || d.effect === 'None' ? null : d.effect;
    l.an = true;
    return true;
  }

  /*
   * Licht-Service auf eine Liste von light.*-IDs anwenden (Lampen und Hue-Gruppen).
   * Gruppen schalten ihre Mitglieder; sind alle Mitglieder ohnehin adressiert, wird die
   * Gruppe übersprungen (sonst würde z. B. brightness_step doppelt wirken).
   */
  lichtDienst(ids, art, daten, ctx) {
    const idSet = new Set(ids);
    const betroffen = new Set();
    for (const id of ids) {
      const g = this.gruppen.get(id);
      if (g) {
        const mitglieder = g.mitglieder.filter(m => this.lampen.get(m).verfuegbar);
        if (!mitglieder.length || mitglieder.every(m => idSet.has(m))) continue;
        let gArt = art;
        if (art === 'toggle') gArt = this.gruppeIstAn(g) ? 'aus' : 'an';
        let gDaten = daten;
        if (gArt === 'an' && (daten.brightness_step !== undefined || daten.brightness_step_pct !== undefined)) {
          const an = mitglieder.map(m => this.lampen.get(m)).filter(l => l.an);
          const basis = an.length ? an.reduce((s, l) => s + l.bri, 0) / an.length : 0;
          const schritt = daten.brightness_step !== undefined ? daten.brightness_step : Math.round(daten.brightness_step_pct * 255 / 100);
          gDaten = Object.assign({}, daten, { brightness: Math.round(basis + schritt) });
          delete gDaten.brightness_step;
          delete gDaten.brightness_step_pct;
          if (gDaten.brightness <= 0) gArt = 'aus';
        }
        for (const m of mitglieder) {
          if (idSet.has(m)) continue;
          if (this.lampeAnwenden(m, gArt, gDaten)) betroffen.add(m);
        }
      } else if (this.lampen.has(id)) {
        if (this.lampeAnwenden(id, art, daten)) betroffen.add(id);
      }
    }
    this.schreibeLampenUndGruppen(betroffen, ctx, true);
  }

  schreibeLampenUndGruppen(betroffen, ctx, dynamikBeenden) {
    const gruppen = new Set();
    for (const id of betroffen) {
      const l = this.lampen.get(id);
      if (dynamikBeenden && l.dynamisch) l.dynamisch = false;
      this.schreibeLampe(id, ctx);
      for (const [gid, g] of this.gruppen) if (g.mitglieder.indexOf(id) !== -1) gruppen.add(gid);
    }
    for (const gid of gruppen) {
      if (dynamikBeenden) this.dynamik.delete(this.gruppen.get(gid).raum);
      this.schreibeGruppe(gid, ctx);
    }
  }

  // ───────────────────────── Szenen ─────────────────────────
  szenenAttribute(sz) {
    const bereich = this.h.BEREICHE.find(b => b.id === sz.raum);
    return {
      group_name: sz.gruppenName || (bereich ? bereich.name : null),
      group_type: 'room',
      name: sz.name,
      speed: sz.speed,
      brightness: runde(sz.bri / 255 * 100, 2),
      is_dynamic: !!sz.dynamisch
    };
  }

  // Szenen-Vorgabe auf die Hue-Lampen eines Raums anwenden
  vorgabeAnwenden(raum, sz, opt, ctx) {
    const gid = this.gruppeVonRaum.get(raum);
    const mitglieder = gid ? this.gruppen.get(gid).mitglieder : [];
    const dynamisch = (!!sz.dynamisch && opt.dynamic !== false) || opt.dynamic === true;
    const betroffen = new Set();
    let farbIndex = 0;
    for (const lid of mitglieder) {
      const l = this.lampen.get(lid);
      if (!l.verfuegbar) continue;
      l.an = true;
      l.effekt = null;
      l.bri = opt.brightness !== undefined ? begrenze(Math.round(opt.brightness), 1, 255) : sz.bri;
      if (l.nurHelligkeit) {
        l.modus = 'brightness';
      } else if (l.farbmodus === 'xy' && (sz.farben || sz.farbe)) {
        l.modus = 'xy';
        l.xy = (sz.farben ? sz.farben[farbIndex++ % sz.farben.length] : sz.farbe).slice();
      } else {
        l.modus = 'color_temp';
        l.kelvin = begrenze(sz.kelvin, l.minK, l.maxK);
      }
      l.dynamisch = dynamisch && l.farbmodus === 'xy';
      betroffen.add(lid);
    }
    if (dynamisch && sz.farben) this.dynamik.set(raum, sz);
    else this.dynamik.delete(raum);
    this.schreibeLampenUndGruppen(betroffen, ctx, false);
  }

  // Hue-Szene aktivieren (scene.turn_on / hue.activate_scene / select)
  szeneAktivieren(id, ctx, opt) {
    opt = opt || {};
    const sz = this.szenen.get(id);
    if (!sz) return false;
    this.vorgabeAnwenden(sz.raum, sz, opt, ctx);
    this.welt.setze(id, iso(jetzt()), this.szenenAttribute(sz), ctx);
    const auswahl = this.szenenAuswahl.get(sz.raum);
    if (auswahl) {
      const s = this.welt.zustand(auswahl.id);
      this.welt.setze(auswahl.id, sz.name, s ? s.attributes : {}, ctx);
    }
    return true;
  }

  // select.*_szene: Option wählen → passende Szene des Raums (oder Vorgabe nach Name)
  szeneWaehlen(selectId, option, ctx) {
    let raum = null;
    for (const [r, sa] of this.szenenAuswahl) if (sa.id === selectId) raum = r;
    if (raum === null) return false;
    for (const [sid, sz] of this.szenen) {
      if (sz.raum === raum && sz.name === option) return this.szeneAktivieren(sid, ctx);
    }
    this.vorgabeAnwenden(raum, Object.assign({ name: option }, require('./haushalt.js').szenenVorgabe(option)), {}, ctx);
    const s = this.welt.zustand(selectId);
    this.welt.setze(selectId, option, s ? s.attributes : {}, ctx);
    return true;
  }

  // Gespeicherte Zustände wiederherstellen (scene.create / scene.apply / HA-Szenen)
  reproduziere(ziele, ctx) {
    const lichtAn = [];
    for (const id of Object.keys(ziele)) {
      const z = ziele[id];
      const domain = id.split('.')[0];
      const state = z.state;
      const a = z.attributes || {};
      if (domain === 'light') {
        if (state === 'off') this.lichtDienst([id], 'aus', {}, ctx);
        else if (state === 'on') {
          const d = {};
          if (typeof a.brightness === 'number') d.brightness = a.brightness;
          const modus = a.color_mode;
          if ((modus === 'color_temp' || !modus) && typeof a.color_temp_kelvin === 'number') d.color_temp_kelvin = a.color_temp_kelvin;
          else if ((modus === 'xy' || !modus) && Array.isArray(a.xy_color)) d.xy_color = a.xy_color;
          else if ((modus === 'hs' || !modus) && Array.isArray(a.hs_color)) d.hs_color = a.hs_color;
          else if (Array.isArray(a.rgb_color)) d.rgb_color = a.rgb_color;
          lichtAn.push([id, d]);
        }
      } else if (domain === 'switch') {
        if (state === 'on' || state === 'off') this.schalterSetzen(id, state === 'on', ctx);
      } else if (domain === 'input_boolean' || domain === 'automation') {
        if (state === 'on' || state === 'off') this.einfachSchalten(id, state === 'on', ctx);
      } else if (domain === 'climate') {
        if (this.heizungen.has(id) && ['off', 'heat', 'auto'].indexOf(state) !== -1) {
          const aend = { modus: state };
          if (typeof a.temperature === 'number' && state !== 'auto') aend.soll = a.temperature;
          if (a.preset_mode !== undefined && state !== 'off') aend.preset = a.preset_mode;
          this.heizungSetzen(id, aend, ctx, true);
        }
      } else if (domain === 'media_player') {
        this.medienReproduzieren(id, state, a, ctx);
      } else {
        this.log('scene: Wiederherstellen für ' + domain + ' nicht unterstützt');
      }
    }
    for (const eintrag of lichtAn) this.lichtDienst([eintrag[0]], 'an', eintrag[1], ctx);
  }

  // ───────────────────────── Heizungen & Raumklima ─────────────────────────
  sollWert(hz) {
    if (hz.modus === 'auto') {
      const h = ortsStunde(jetzt());
      const z = this.h.ZEITPLAN;
      return h >= z.tagVon && h < z.tagBis ? z.tag : z.nacht;
    }
    return hz.soll;
  }

  presetWert(hz) {
    if (hz.modus === 'off') return null;
    if (hz.modus === 'auto') return this.sollWert(hz) === this.h.ZEITPLAN.tag ? 'comfort' : 'eco';
    return hz.preset;
  }

  berechneAktion(hz, frisch) {
    if (hz.modus === 'off') return 'off';
    const r = this.raeume.get(hz.raum);
    const soll = this.sollWert(hz);
    if (frisch || hz.aktion === 'off' || hz.aktion === null) return r.temp < soll - 0.05 ? 'heating' : 'idle';
    if (hz.aktion === 'heating') return r.temp >= soll + 0.2 ? 'idle' : 'heating';
    return r.temp < soll - 0.2 ? 'heating' : 'idle';
  }

  schreibeHeizung(id, ctx, opt) {
    const hz = this.heizungen.get(id);
    const r = this.raeume.get(hz.raum);
    const a = {
      hvac_modes: ['off', 'heat', 'auto'],
      min_temp: 5,
      max_temp: 30,
      target_temp_step: 0.5,
      preset_modes: ['eco', 'comfort', 'boost'],
      current_temperature: runde(r.temp, 1),
      temperature: hz.modus === 'off' ? null : this.sollWert(hz),
      hvac_action: hz.aktion,
      preset_mode: this.presetWert(hz),
      supported_features: 401
    };
    return this.welt.setze(id, hz.modus, a, ctx, opt);
  }

  // aend: { modus, soll, preset } – alles optional
  heizungSetzen(id, aend, ctx, ohneAuto) {
    const hz = this.heizungen.get(id);
    if (!hz) return;
    if (aend.modus !== undefined) hz.modus = aend.modus;
    if (aend.preset !== undefined) {
      hz.preset = aend.preset;
      if (aend.preset && this.h.PRESETS[aend.preset] !== undefined && aend.soll === undefined) hz.soll = this.h.PRESETS[aend.preset];
      if (aend.preset && aend.modus === undefined && hz.modus !== 'heat') hz.modus = 'heat';
    }
    if (aend.soll !== undefined) {
      hz.soll = aend.soll;
      if (!ohneAuto && aend.modus === undefined && hz.modus !== 'heat') hz.modus = 'heat';
      if (aend.preset === undefined) {
        const passend = Object.keys(this.h.PRESETS).find(k => this.h.PRESETS[k] === aend.soll);
        hz.preset = passend || null;
      }
    }
    hz.aktion = this.berechneAktion(hz, true);
    this.schreibeHeizung(id, ctx);
  }

  // Ein Tick für alle Räume: Temperatur zieht zum Ziel, Feuchte schwankt gelegentlich
  tickRaeume(dt, t) {
    const w = this.welt;
    const stunde = ortsStunde(t);
    for (const r of this.raeume.values()) {
      // von außen gesetzte Werte (POST /sim/state, Szenarien) übernehmen
      for (const rs of this.raumsensoren) {
        if (rs.raum !== r.raum) continue;
        const s = w.zustand(rs.id);
        const v = s ? parseFloat(s.state) : NaN;
        if (isNaN(v)) continue;
        if (rs.groesse === 'temp' && Math.abs(v - (r.temp + rs.versatz)) > 0.051) r.temp = v - rs.versatz;
        if (rs.groesse === 'feuchte' && r.feuchte !== null && Math.abs(v - r.feuchte) > 0.051) r.feuchte = v;
      }
      const offen = r.fenster.some(id => {
        const s = w.zustand(id);
        return s && s.state === 'on';
      });
      const hz = r.heizung ? this.heizungen.get(r.heizung) : null;
      const heizt = hz && hz.aktion === 'heating';
      let ziel = r.basisTemp + r.amplitude * Math.cos(2 * Math.PI * (stunde - 17) / 24);
      let rate = 0.0015;
      if (heizt) {
        ziel = this.sollWert(hz) + 0.6;
        rate = 0.008;
      }
      if (offen) {
        ziel = heizt ? this.sollWert(hz) - 2.5 : 15;
        rate = 0.004;
      }
      r.temp += begrenze(ziel - r.temp, -rate * dt, rate * dt) + rauschen(0.012 * Math.sqrt(dt / 5));
      if (r.feuchte !== null) {
        let fz = r.basisFeuchte;
        if (r.besonders === 'nachtfeuchte' && (stunde >= 23 || stunde < 7)) fz += 8;
        if (offen) fz = Math.min(fz, 50);
        r.feuchte += (fz - r.feuchte) * Math.min(1, 0.0006 * dt);
        // echte Sensoren melden die Feuchte nur gelegentlich (Schwelle), nicht bei jedem Takt
        if (Math.random() < 0.12 * dt / 5) r.feuchte += rauschen(0.5);
        r.feuchte = begrenze(r.feuchte, 20, 99);
      }
      for (const rs of this.raumsensoren) {
        if (rs.raum !== r.raum) continue;
        const s = w.zustand(rs.id);
        if (!s || s.state === 'unavailable') continue;
        const wert = rs.groesse === 'temp' ? (r.temp + rs.versatz).toFixed(1) : (r.feuchte === null ? s.state : r.feuchte.toFixed(1));
        w.setze(rs.id, wert, s.attributes);
      }
      if (hz) {
        hz.aktion = this.berechneAktion(hz, false);
        this.schreibeHeizung(hz.id);
      }
    }
  }

  // ───────────────────────── Medien ─────────────────────────
  aktuellesMedium(m) {
    if (m.zustand === 'off' || m.zustand === 'idle' || m.zustand === 'unavailable') return null;
    if (m.radio) return { titel: m.radio.name, kuenstler: m.radio.kuenstler || null, album: null, dauer: null, contentId: m.radio.url, typ: m.radio.typ || 'music', kanal: m.radio.kanal || null };
    if (m.app) {
      const inhalt = APP_INHALTE[m.app] || { titel: m.app, typ: 'video' };
      return { titel: inhalt.titel, kuenstler: null, album: null, dauer: 2700, contentId: null, typ: inhalt.typ, kanal: null };
    }
    if (m.titel === null || m.titel === undefined) return null;
    const p = this.h.PLAYLIST[m.titel % this.h.PLAYLIST.length];
    return { titel: p.titel, kuenstler: p.kuenstler, album: p.album, dauer: p.dauer, contentId: m.contentId || ('spotify:track:' + hexId(p.titel).slice(0, 22)), typ: 'music', kanal: null };
  }

  aktuellePosition(m) {
    if (m.zustand === 'playing') return m.position + (jetzt() - m.positionZeit);
    return m.position;
  }

  schreibeMedien(id, ctx, opt) {
    const m = this.medien.get(id);
    if (!m) return false;
    if (m.zustand === 'unavailable') return this.welt.setze(id, 'unavailable', { device_class: m.cfg.device_class, supported_features: m.cfg.features }, ctx, opt);
    const MP = this.h.MP;
    const f = m.cfg.features;
    const a = {};
    if (m.cfg.quellen) a.source_list = m.cfg.quellen.slice();
    const medium = this.aktuellesMedium(m);
    if (m.zustand !== 'off') {
      if (m.lautstaerke !== null && m.lautstaerke !== undefined) a.volume_level = m.lautstaerke;
      if (f & MP.VOLUME_MUTE) a.is_volume_muted = m.stumm;
      if (medium) {
        if (medium.contentId) a.media_content_id = medium.contentId;
        a.media_content_type = medium.typ;
        if (medium.dauer) {
          a.media_duration = medium.dauer;
          a.media_position = Math.floor(m.position);
          a.media_position_updated_at = iso(m.positionZeit);
        }
        a.media_title = medium.titel;
        if (medium.kuenstler) a.media_artist = medium.kuenstler;
        if (medium.album) a.media_album_name = medium.album;
        if (medium.kanal) a.media_channel = medium.kanal;
      }
      if (m.app) {
        a.app_id = 'com.' + m.app.toLowerCase().replace(/[^a-z]/g, '') + '.app';
        a.app_name = m.app;
      }
      if (m.quelle) a.source = m.quelle;
      if (f & MP.SHUFFLE_SET) a.shuffle = m.shuffle;
      if (f & MP.REPEAT_SET) a.repeat = m.repeat;
      if (m.cfg.typ === 'sonos') {
        a.group_members = [id];
        if (medium && !m.radio) {
          a.queue_position = (m.titel % this.h.PLAYLIST.length) + 1;
          a.queue_size = this.h.PLAYLIST.length;
        }
      }
    }
    a.device_class = m.cfg.device_class;
    if (medium) a.entity_picture = '/api/media_player_proxy/' + id + '?token=' + m.token + '&cache=' + m.cache;
    a.supported_features = f;
    return this.welt.setze(id, m.zustand, a, ctx, opt);
  }

  positionMerken(m) {
    m.position = this.aktuellePosition(m);
    m.positionZeit = jetzt();
  }

  titelWechsel(m, richtung) {
    const n = this.h.PLAYLIST.length;
    m.titel = ((m.titel === null ? 0 : m.titel) + richtung + n) % n;
    m.position = 0;
    m.positionZeit = jetzt();
    m.cache = zufallsToken(8);
    m.contentId = null;
  }

  medienAktion(id, service, d, ctx) {
    const m = this.medien.get(id);
    if (!m || m.zustand === 'unavailable') return;
    switch (service) {
      case 'turn_on':
        if (m.zustand === 'off') m.zustand = 'idle';
        break;
      case 'turn_off':
        this.positionMerken(m);
        m.zustand = 'off';
        m.app = null;
        break;
      case 'toggle':
        return this.medienAktion(id, m.zustand === 'off' ? 'turn_on' : 'turn_off', d, ctx);
      case 'media_play':
        if (m.zustand === 'off') return;
        if (m.titel === null && !m.radio && !m.app) m.titel = 0;
        m.positionZeit = jetzt();
        m.zustand = 'playing';
        break;
      case 'media_pause':
        if (m.zustand !== 'playing') return;
        this.positionMerken(m);
        m.zustand = 'paused';
        break;
      case 'media_play_pause':
        return this.medienAktion(id, m.zustand === 'playing' ? 'media_pause' : 'media_play', d, ctx);
      case 'media_stop':
        if (m.zustand === 'off') return;
        m.zustand = 'idle';
        m.titel = null;
        m.radio = null;
        m.app = null;
        m.quelle = null;
        m.position = 0;
        break;
      case 'media_next_track':
        if (m.radio || m.zustand === 'off' || m.zustand === 'idle') return;
        this.titelWechsel(m, 1);
        break;
      case 'media_previous_track':
        if (m.radio || m.zustand === 'off' || m.zustand === 'idle') return;
        if (this.aktuellePosition(m) > 5) {
          m.position = 0;
          m.positionZeit = jetzt();
        } else {
          this.titelWechsel(m, -1);
        }
        break;
      case 'media_seek':
        m.position = Math.max(0, Number(d.seek_position));
        m.positionZeit = jetzt();
        break;
      case 'volume_set':
        m.lautstaerke = runde(begrenze(Number(d.volume_level), 0, 1), 2);
        break;
      case 'volume_up':
      case 'volume_down':
        if (m.lautstaerke === null || m.lautstaerke === undefined) return;
        m.lautstaerke = runde(begrenze(m.lautstaerke + (service === 'volume_up' ? 1 : -1) * m.cfg.schritt, 0, 1), 2);
        break;
      case 'volume_mute':
        m.stumm = !!d.is_volume_muted;
        break;
      case 'select_source':
        if (m.cfg.typ === 'appletv') {
          m.app = d.source;
          m.zustand = 'playing';
          m.position = 0;
          m.positionZeit = jetzt();
          m.cache = zufallsToken(8);
        } else {
          m.quelle = d.source;
          m.radio = { name: d.source, url: null, typ: 'music' };
          m.zustand = 'playing';
          m.cache = zufallsToken(8);
        }
        break;
      case 'play_media': {
        const cid = String(d.media_content_id);
        const sender = this.h.SENDER[cid];
        if (/^https?:\/\//.test(cid) || sender) {
          m.radio = { name: sender || 'Radio-Stream', url: cid, typ: 'music', kanal: sender || null };
          m.titel = null;
        } else {
          m.radio = null;
          m.titel = Math.floor(Math.random() * this.h.PLAYLIST.length);
          m.contentId = cid;
          m.position = 0;
        }
        m.app = null;
        m.quelle = null;
        m.zustand = 'playing';
        m.positionZeit = jetzt();
        m.cache = zufallsToken(8);
        break;
      }
      case 'shuffle_set':
        m.shuffle = !!d.shuffle;
        break;
      case 'repeat_set':
        m.repeat = d.repeat;
        break;
      default:
        return;
    }
    this.schreibeMedien(id, ctx);
  }

  medienReproduzieren(id, state, a, ctx) {
    const m = this.medien.get(id);
    if (!m) return;
    if (state === 'off') this.medienAktion(id, 'turn_off', {}, ctx);
    else if (state === 'playing') this.medienAktion(id, 'media_play', {}, ctx);
    else if (state === 'paused') this.medienAktion(id, 'media_pause', {}, ctx);
    else if (state === 'idle' || state === 'on') this.medienAktion(id, m.zustand === 'off' ? 'turn_on' : 'media_stop', {}, ctx);
    if (typeof a.volume_level === 'number' && m.lautstaerke !== null) this.medienAktion(id, 'volume_set', { volume_level: a.volume_level }, ctx);
    if (typeof a.is_volume_muted === 'boolean') this.medienAktion(id, 'volume_mute', { is_volume_muted: a.is_volume_muted }, ctx);
  }

  tickMedien() {
    const t = jetzt();
    for (const m of this.medien.values()) {
      if (m.zustand !== 'playing') continue;
      const medium = this.aktuellesMedium(m);
      if (!medium || !medium.dauer) continue;
      const pos = this.aktuellePosition(m);
      if (pos >= medium.dauer) {
        if (m.app) {
          m.zustand = 'idle';
          m.app = null;
        } else {
          this.titelWechsel(m, 1);
        }
        this.schreibeMedien(m.id);
      } else if (t - m.positionZeit >= 30) {
        // Position wie echte Integrationen nur gelegentlich melden (Client rechnet dazwischen hoch)
        this.positionMerken(m);
        this.schreibeMedien(m.id);
      }
    }
  }

  // ───────────────────────── Steckdosen & Strom ─────────────────────────
  leistungVon(s, t) {
    if (!s.an) return 0;
    switch (s.profil) {
      case 'kaffee': return (t - s.seit) < 90 ? 1250 + rauschen(30) : 2.5 + rauschen(0.4);
      case 'kuehlschrank': return Math.floor(t / 600) % 3 === 0 ? 82 + rauschen(4) : 1.2 + rauschen(0.2);
      case 'schreibtisch': return 85 + rauschen(6);
      case 'fernseher': {
        const tv = this.welt.zustand('media_player.wohnzimmer_fernseher');
        return tv && tv.state !== 'off' ? 112 + rauschen(5) : 0.6 + rauschen(0.1);
      }
      default: return 10 + rauschen(1);
    }
  }

  schreibeSteckdose(s, ctx, opt, dt) {
    const w = this.welt;
    const t = jetzt();
    s.leistung = Math.max(0, this.leistungVon(s, t));
    s.energie += s.leistung * (dt || 0) / 3600000;
    w.setze(s.id, s.an ? 'on' : 'off', {}, ctx, opt);
    const sl = w.zustand(s.leistungId);
    if (sl) w.setze(s.leistungId, s.leistung.toFixed(1), sl.attributes, null, opt);
    const se = w.zustand(s.energieId);
    if (se) w.setze(s.energieId, s.energie.toFixed(3), se.attributes, null, opt);
  }

  schalterSetzen(id, an, ctx) {
    const s = this.steckdosen.get(id);
    if (s) {
      if (an && !s.an) s.seit = jetzt();
      s.an = an;
      this.schreibeSteckdose(s, ctx, undefined, 0);
    } else {
      this.einfachSchalten(id, an, ctx);
    }
  }

  // Einfache an/aus-Entität (Helfer, Hue-/Sonos-Schalter, Automationen)
  einfachSchalten(id, an, ctx) {
    const s = this.welt.zustand(id);
    if (!s) return;
    if (id.indexOf('automation.') === 0) {
      const a = this.automationen.get(id);
      if (a) a.an = an;
      this.schreibeAutomation(id, ctx);
      return;
    }
    this.welt.setze(id, an ? 'on' : 'off', s.attributes, ctx);
  }

  schreibeStromGesamt(beimStart) {
    if (!this.ids.has('sensor.stromverbrauch_wohnung')) return;
    const w = this.welt;
    let summe = 145 + rauschen(8);
    for (const s of this.steckdosen.values()) summe += s.leistung;
    for (const l of this.lampen.values()) if (l.verfuegbar && l.an) summe += 2 + l.bri / 255 * 7;
    for (const m of this.medien.values()) if (m.zustand === 'playing') summe += m.cfg.typ === 'sonos' ? 28 : (m.cfg.typ === 'appletv' ? 6 : 3);
    if (this.ids.has('sensor.waschmaschine_betriebszustand') && this.wasch.zustand === 'run') {
      summe += this.waschFortschritt() < 25 ? 1950 + rauschen(60) : 180 + rauschen(40);
    }
    if (this.ids.has('vacuum.saugi') && this.sauger.zustand === 'docked' && this.sauger.akku < 100) summe += 25;
    this.stromGesamt = summe;
    const attrs = { state_class: 'measurement', unit_of_measurement: 'W', device_class: 'power' };
    const opt = beimStart ? { zeit: jetzt() - zufall(5, 30) } : undefined;
    if (beimStart) {
      const kurve = erzeugeKurve({ ende: opt.zeit, endwert: summe, basis: 330, amplitude: 110, spitzeStunde: 19, rauschen: 55, besonders: null, groesse: 'leistung', min: 120 });
      this.belegeVerlauf('sensor.stromverbrauch_wohnung', kurve, 0, attrs);
    }
    w.setze('sensor.stromverbrauch_wohnung', summe.toFixed(0), attrs, null, opt);
  }

  // ───────────────────────── Sauger ─────────────────────────
  schreibeSauger(ctx, opt) {
    if (!this.ids.has('vacuum.saugi')) return;
    const v = this.sauger;
    const akku = Math.round(v.akku);
    const laedt = v.zustand === 'docked' && akku < 100;
    const stufe = Math.min(100, Math.round(akku / 10) * 10);
    let icon = 'mdi:battery' + (laedt ? '-charging' : '') + (stufe >= 100 ? (laedt ? '-100' : '') : (stufe <= 0 ? '-outline' : '-' + stufe));
    if (laedt && stufe <= 0) icon = 'mdi:battery-charging-outline';
    const status = {
      docked: akku < 100 ? 'Charging' : 'Charging complete', cleaning: 'Cleaning', returning: 'Returning home',
      paused: 'Paused', idle: 'Idle', error: 'Error'
    }[v.zustand] || v.zustand;
    this.welt.setze('vacuum.saugi', v.zustand, {
      fan_speed_list: LUEFTER.slice(), battery_level: akku, battery_icon: icon, fan_speed: v.luefter,
      status: status, supported_features: SAUGER_FEATURES
    }, ctx, opt);
    const b = this.welt.zustand('sensor.saugi_batterie');
    if (b) this.welt.setze('sensor.saugi_batterie', String(akku), b.attributes, ctx, opt);
  }

  saugerAktion(service, d, ctx) {
    const v = this.sauger;
    switch (service) {
      case 'start':
      case 'clean_spot':
        v.zustand = 'cleaning';
        v.fehler = null;
        v.seit = jetzt();
        break;
      case 'pause':
        if (v.zustand === 'cleaning' || v.zustand === 'returning') v.zustand = 'paused';
        break;
      case 'stop':
        if (v.zustand !== 'docked') v.zustand = 'idle';
        break;
      case 'return_to_base':
        if (v.zustand !== 'docked') {
          v.zustand = 'returning';
          v.seit = jetzt();
        }
        break;
      case 'set_fan_speed':
        v.luefter = d.fan_speed;
        break;
      default:
        return;
    }
    this.schreibeSauger(ctx);
  }

  saugerFehler() {
    this.sauger.zustand = 'error';
    this.sauger.fehler = 'main_brush_jammed';
    this.schreibeSauger();
  }

  tickSauger(dt) {
    if (!this.ids.has('vacuum.saugi')) return;
    const v = this.sauger;
    const t = jetzt();
    const vorher = v.zustand + Math.round(v.akku);
    if (v.zustand === 'cleaning') {
      v.akku = Math.max(0, v.akku - dt / 6);
      if (t - v.seit > 180 || v.akku <= 15) {
        v.zustand = 'returning';
        v.seit = t;
      }
    } else if (v.zustand === 'returning') {
      v.akku = Math.max(0, v.akku - dt / 12);
      if (t - v.seit > 20) {
        v.zustand = 'docked';
        v.seit = t;
      }
    } else if (v.zustand === 'docked') {
      v.akku = Math.min(100, v.akku + dt / 10);
    }
    if (vorher !== v.zustand + Math.round(v.akku)) this.schreibeSauger();
  }

  // ───────────────────────── Waschmaschine ─────────────────────────
  waschFortschritt() {
    const w = this.wasch;
    if (w.zustand === 'finished') return 100;
    if (w.zustand !== 'run' && w.zustand !== 'pause') return null;
    return begrenze(Math.floor((jetzt() - w.start) / (w.ende - w.start) * 100), 0, 99);
  }

  schreibeWaschmaschine(ctx, opt) {
    if (!this.ids.has('sensor.waschmaschine_betriebszustand')) return;
    const w = this.wasch;
    const fortschritt = this.waschFortschritt();
    this.welt.setze('sensor.waschmaschine_betriebszustand', w.zustand, { options: WASCH_ZUSTAENDE.slice(), device_class: 'enum' }, ctx, opt);
    this.welt.setze('sensor.waschmaschine_programmfortschritt', fortschritt === null ? 'unknown' : String(fortschritt), { unit_of_measurement: '%' }, ctx, opt);
    this.welt.setze('sensor.waschmaschine_programmende', w.zustand === 'run' || w.zustand === 'pause' ? isoSekunden(w.ende) : 'unknown', { device_class: 'timestamp' }, ctx, opt);
  }

  waschmaschine(art) {
    if (!this.ids.has('sensor.waschmaschine_betriebszustand')) throw new Error('Im Haushalt gibt es keine Waschmaschine (evtl. mit --extras starten)');
    const t = jetzt();
    if (art === 'start') {
      this.wasch = { zustand: 'run', start: t, ende: t + 600 };
      const tuer = this.welt.zustand('binary_sensor.waschmaschine_tuer');
      if (tuer && tuer.state === 'on') this.welt.setze('binary_sensor.waschmaschine_tuer', 'off', tuer.attributes);
    } else if (art === 'fertig') {
      this.wasch.zustand = 'finished';
    }
    this.schreibeWaschmaschine();
    return 'Waschmaschine: ' + this.wasch.zustand;
  }

  tickWaschmaschine() {
    const w = this.wasch;
    if (w.zustand === 'run' && jetzt() >= w.ende) w.zustand = 'finished';
    if (w.zustand === 'run' || w.zustand === 'finished') this.schreibeWaschmaschine();
  }

  // ───────────────────────── Personen, Zone, Bewegung, Tags ─────────────────────────
  ortFuer(zustand, id) {
    if (zustand === 'home') return { lat: HEIMAT.lat + 0.00003, lon: HEIMAT.lon - 0.00002, gps: 12 };
    if (id.indexOf('alex') !== -1) return { lat: 53.0793, lon: 8.8017, gps: 18 };
    return { lat: 53.0838, lon: 8.8136, gps: 25 };
  }

  schreibePerson(id, zustand, ctx, opt) {
    const e = this.h.ENTITAETEN.find(x => x.entity_id === id);
    const tracker = e && e.modell ? e.modell.tracker : null;
    const ort = this.ortFuer(zustand, id);
    this.welt.setze(id, zustand, {
      editable: true, id: e ? e.unique_id : id.split('.')[1], device_trackers: tracker ? [tracker] : [], latitude: ort.lat, longitude: ort.lon,
      gps_accuracy: ort.gps, source: tracker, user_id: hexId('benutzer-' + id)
    }, ctx, opt);
  }

  schreibeTracker(id, zustand, ctx, opt) {
    const ort = this.ortFuer(zustand, id);
    this.welt.setze(id, zustand, {
      source_type: 'gps', battery_level: 40 + parseInt(hexId(id).slice(0, 2), 16) % 50, latitude: ort.lat, longitude: ort.lon,
      gps_accuracy: ort.gps, altitude: 12, course: -1, speed: 0, vertical_accuracy: 5
    }, ctx, opt);
  }

  person(id, zustand) {
    const e = this.h.ENTITAETEN.find(x => x.entity_id === id);
    if (!e) return;
    const ctx = this.welt.kontext();
    if (e.modell && e.modell.tracker && this.welt.zustand(e.modell.tracker)) this.schreibeTracker(e.modell.tracker, zustand, ctx);
    this.schreibePerson(id, zustand, ctx);
  }

  schreibeZone() {
    if (!this.ids.has('zone.home')) return;
    const daheim = [];
    for (const [id, s] of this.welt.zustaende) if (id.indexOf('person.') === 0 && s.state === 'home') daheim.push(id);
    this.welt.setze('zone.home', String(daheim.length), {
      latitude: HEIMAT.lat, longitude: HEIMAT.lon, radius: 100, passive: false, persons: daheim,
      editable: true, icon: 'mdi:home', friendly_name: 'Zuhause'
    });
  }

  bewegung(id, sekunden) {
    const s = this.welt.zustand(id);
    if (!s) return;
    this.abbrechen(this.bewegungsTimer.get(id));
    this.welt.setze(id, 'on', s.attributes);
    const t = this.spaeter(sekunden * 1000, () => {
      this.bewegungsTimer.delete(id);
      const jetztS = this.welt.zustand(id);
      if (jetztS) this.welt.setze(id, 'off', jetztS.attributes);
    });
    this.bewegungsTimer.set(id, t);
  }

  // Bewegungsmelder lösen zufällig aus (nur wenn jemand zu Hause ist; Flur-Melder öfter)
  planeZufallsbewegung() {
    const melder = this.finde({ domain: 'binary_sensor', deviceClass: ['motion', 'occupancy', 'presence'] });
    const bl = this.h.BEWEGUNGSLICHT;
    for (const id of melder) {
      const haupt = bl && bl.sensor === id;
      const runde_ = () => {
        const daheim = this.finde({ domain: 'person' }).some(p => this.welt.zustand(p).state === 'home');
        if (daheim || haupt) this.bewegung(id, haupt ? 30 : zufall(20, 90));
        this.spaeter((haupt ? zufall(120, 360) : zufall(90, 420)) * 1000, runde_);
      };
      this.spaeter((haupt ? zufall(60, 240) : zufall(20, 180)) * 1000, runde_);
    }
  }

  nichtErreichbar(id) {
    const l = this.lampen.get(id);
    if (l) {
      l.verfuegbar = false;
      this.schreibeLampenUndGruppen(new Set([id]), null, false);
      return;
    }
    const m = this.medien.get(id);
    if (m) {
      m.zustand = 'unavailable';
      this.schreibeMedien(id);
      return;
    }
    this.welt.setze(id, 'unavailable', {});
  }

  tagScannen(id) {
    const s = this.welt.zustand(id);
    if (!s) throw new Error('Tag ' + id + ' gibt es nicht');
    const ctx = this.welt.kontext();
    this.welt.setze(id, iso(jetzt()), Object.assign({}, s.attributes, { last_scanned_by_device_id: null }), ctx);
    this.welt.feuere('tag_scanned', { tag_id: s.attributes.tag_id, name: s.attributes.friendly_name, device_id: null }, ctx);
  }

  // ───────────────────────── Einkaufsliste (todo) ─────────────────────────
  schreibeTodo(id, ctx, opt) {
    const items = this.todos.get(id) || [];
    const offen = items.filter(i => i.status === 'needs_action').length;
    this.welt.setze(id, String(offen), { supported_features: 15 }, ctx, opt);
    for (const fn of Array.from(this.todoHoerer)) {
      try {
        fn(id, items);
      } catch (err) {
        console.error('[sim] todo-Hörer:', err);
      }
    }
  }

  todoEintrag(id, item) {
    const items = this.todos.get(id) || [];
    return items.find(i => i.uid === item) || items.find(i => i.summary === item) || null;
  }

  // ───────────────────────── Logbuch ─────────────────────────
  merkeKontext(id, info) {
    this.kontextInfo.set(id, info);
    if (this.kontextInfo.size > 6000) this.kontextInfo.delete(this.kontextInfo.keys().next().value);
  }

  merkeAusloesung(id, zeit, quelle, ctx) {
    const name = this.lampenName(id);
    const nachricht = 'triggered by ' + quelle;
    this.ausloeseLog.push({ when: zeit, name: name, message: nachricht, source: quelle, entity_id: id, context_id: ctx.id });
    if (this.ausloeseLog.length > 4000) this.ausloeseLog.splice(0, this.ausloeseLog.length - 4000);
    this.merkeKontext(ctx.id, {
      context_event_type: 'automation_triggered', context_domain: 'automation', context_entity_id: id,
      context_entity_id_name: name, context_message: nachricht, context_source: quelle, context_name: name
    });
  }

  ergaenzeKontext(eintrag, c) {
    if (!c) return;
    if (c.user_id) eintrag.context_user_id = c.user_id;
    const info = this.kontextInfo.get(c.id) || (c.parent_id ? this.kontextInfo.get(c.parent_id) : null);
    if (info && info.context_entity_id !== eintrag.entity_id) Object.assign(eintrag, info);
  }

  /*
   * logbook/get_events wie HA: Zustandswechsel (ohne kontinuierliche Sensoren, ohne reine Attribut-Änderungen)
   * plus „automation triggered“-Einträge, chronologisch. when = Unix-Sekunden (Float).
   */
  logbuch(start, ende, entityIds) {
    const filter = entityIds && entityIds.length ? new Set(entityIds) : null;
    const aus = [];
    for (const [id, l] of this.welt.historie) {
      if (filter && !filter.has(id)) continue;
      let vorher = null;
      for (const e of l) {
        if (e.nurAttr) continue;
        if (id.indexOf('sensor.') === 0 && e.a && (e.a.unit_of_measurement !== undefined || e.a.state_class !== undefined)) break;
        if (e.s === vorher) continue;
        const erster = vorher === null;
        vorher = e.s;
        if (erster || e.lu < start || e.lu > ende) continue;
        const eintrag = { when: e.lu, state: e.s, entity_id: id };
        this.ergaenzeKontext(eintrag, e.c);
        aus.push(eintrag);
      }
    }
    for (const a of this.ausloeseLog) {
      if (a.when < start || a.when > ende) continue;
      if (filter && !filter.has(a.entity_id)) continue;
      aus.push(Object.assign({}, a));
    }
    aus.sort((x, y) => x.when - y.when);
    return aus;
  }

  // ───────────────────────── Skripte & Automationen ─────────────────────────
  schreibeAutomation(id, ctx, opt) {
    const a = this.automationen.get(id);
    this.welt.setze(id, a.an ? 'on' : 'off', {
      id: a.cfg && a.cfg.id ? a.cfg.id : a.eintragId, last_triggered: a.zuletzt ? iso(a.zuletzt) : null, mode: (a.cfg && a.cfg.mode) || 'single', current: a.laeuft
    }, ctx, opt);
  }

  // Automation ausführen (Auslöser oder automation.trigger). Läuft im Hintergrund weiter.
  // quelle wie im HA-Logbuch: „state of tag.x“, „time“, „action automation.trigger“
  automationAusloesen(id, elternKontext, ohneBedingung, quelle) {
    const grund = quelle;
    const a = this.automationen.get(id);
    if (!a) return false;
    const modus = (a.cfg && a.cfg.mode) || 'single';
    if (a.laeuft && modus === 'single') {
      this.log(id + ': läuft bereits (mode: single)');
      return false;
    }
    if (!ohneBedingung && a.cfg && !this.bedingungenErfuellt(a.cfg.conditions)) {
      this.log(id + ': Bedingungen nicht erfüllt (' + grund + ')');
      return false;
    }
    const ctx = this.welt.kontext(elternKontext);
    a.zuletzt = jetzt();
    a.laeuft++;
    this.schreibeAutomation(id, ctx);
    this.merkeAusloesung(id, a.zuletzt, quelle, ctx);
    this.log(id + ': ausgelöst (' + grund + ')');
    const aktionen = a.cfg ? a.cfg.actions : [];
    this.fuehreAus(aktionen, ctx, id, { locker: !!this.h.LOCKER_AUTOMATIONEN }).then(() => {
      a.laeuft = Math.max(0, a.laeuft - 1);
      if (this.automationen.get(id) === a) this.schreibeAutomation(id, ctx);
    });
    return true;
  }

  bedingungenErfuellt(bedingungen) {
    for (const b of liste(bedingungen)) if (!this.bedingung(b)) return false;
    return true;
  }

  bedingung(b) {
    if (typeof b === 'string') return true; // Template-Kurzform
    const art = b.condition;
    const t = jetzt();
    if (art === 'and') return this.bedingungenErfuellt(b.conditions);
    if (art === 'or') return liste(b.conditions).some(x => this.bedingung(x));
    if (art === 'not') return !liste(b.conditions).some(x => this.bedingung(x));
    if (art === 'time') {
      const h = ortsStunde(t);
      if (b.weekday && liste(b.weekday).indexOf(wochentag(t)) === -1) return false;
      const nach = b.after !== undefined ? zeitInStunden(b.after) : null;
      const vor = b.before !== undefined ? zeitInStunden(b.before) : null;
      if (nach !== null && vor !== null && nach > vor) return h >= nach || h < vor;
      if (nach !== null && h < nach) return false;
      if (vor !== null && h >= vor) return false;
      return true;
    }
    if (art === 'state') {
      return liste(b.entity_id).every(id => {
        const s = this.welt.zustand(id);
        return s && liste(b.state).map(String).indexOf(s.state) !== -1;
      });
    }
    if (art === 'numeric_state') {
      return liste(b.entity_id).every(id => {
        const s = this.welt.zustand(id);
        const v = s ? parseFloat(s.state) : NaN;
        if (isNaN(v)) return false;
        if (b.above !== undefined && !(v > Number(b.above))) return false;
        if (b.below !== undefined && !(v < Number(b.below))) return false;
        return true;
      });
    }
    const m = /^([a-z_]+)\.is_(on|off)$/.exec(art || '');
    if (m) {
      const r = this.welt.loeseZielAuf(b.target || {}, [m[1]]);
      const zustaende = r.ids.map(id => this.welt.zustand(id).state).filter(s => s === 'on' || s === 'off');
      if (!zustaende.length) return false;
      const alle = b.options && b.options.behavior === 'all';
      return alle ? zustaende.every(s => s === m[2]) : zustaende.some(s => s === m[2]);
    }
    if (art === 'template') {
      this.log('Bedingung „template“ kann der Simulator nicht auswerten – gilt als erfüllt');
      return true;
    }
    this.log('Bedingung „' + art + '“ unbekannt – gilt als erfüllt');
    return true;
  }

  // Aktionsfolge im HA-Format ausführen (action/service, delay, condition, if, choose, sequence, parallel, stop)
  async fuehreAus(aktionen, ctx, quelle, opt) {
    opt = opt || {};
    for (const a of liste(aktionen)) {
      if (!a || typeof a !== 'object') continue;
      if (a.enabled === false) continue;
      try {
        if (a.action || a.service || a.scene) {
          const name = a.action || a.service || 'scene.turn_on';
          const teile = String(name).split('.');
          let daten = Object.assign({}, a.data || {}, a.data_template || {});
          const ziel = a.target ? Object.assign({}, a.target) : (a.scene ? { entity_id: a.scene } : null);
          if (a.entity_id && !ziel) daten.entity_id = a.entity_id;
          try {
            await this.dienste.aufrufen(teile[0], teile[1], daten, ziel, { kontext: ctx, returnResponse: !!a.response_variable });
          } catch (err) {
            if (opt.locker && err.code === 'invalid_format' && /exclusion/.test(err.message)) {
              // In echtem HA scheitert diese Aktion (mehrere Farb-/Helligkeitsangaben gleichzeitig).
              // Der Simulator behält jeweils nur die erste Angabe, damit die Wirkung sichtbar bleibt.
              this.log(quelle + ': ' + name + ' hat sich ausschließende Felder (' + err.message + ') – echtes HA würde hier abbrechen; Simulator nimmt jeweils die erste Angabe');
              daten = Object.assign({}, daten);
              [FARB_SCHLUESSEL, HELL_SCHLUESSEL].forEach(gruppe => {
                const vorhanden = gruppe.filter(k => daten[k] !== undefined);
                vorhanden.slice(1).forEach(k => delete daten[k]);
              });
              await this.dienste.aufrufen(teile[0], teile[1], daten, ziel, { kontext: ctx, returnResponse: !!a.response_variable });
            } else {
              throw err;
            }
          }
        } else if (a.delay !== undefined) {
          await this.warte(dauerInSekunden(a.delay));
        } else if (a.condition) {
          if (!this.bedingung(a)) {
            this.log(quelle + ': Bedingung nicht erfüllt – Ablauf endet');
            return;
          }
        } else if (a.if) {
          const ok = liste(a.if).every(b => this.bedingung(b));
          await this.fuehreAus(ok ? a.then : a.else, ctx, quelle, opt);
        } else if (a.choose) {
          const zweig = liste(a.choose).find(z => liste(z.conditions).every(b => this.bedingung(b)));
          await this.fuehreAus(zweig ? zweig.sequence : a.default, ctx, quelle, opt);
        } else if (a.sequence || a.parallel) {
          await this.fuehreAus(a.sequence || a.parallel, ctx, quelle, opt);
        } else if (a.stop !== undefined) {
          return;
        } else if (a.event) {
          this.welt.feuere(a.event, a.event_data || {}, this.welt.kontext(ctx));
        } else {
          this.log(quelle + ': Aktion ' + Object.keys(a).join(',') + ' wird nicht simuliert');
        }
      } catch (err) {
        this.log(quelle + ': Aktion fehlgeschlagen (' + (err.code || '') + ' ' + err.message + ') – Ablauf endet');
        return;
      }
    }
  }

  // Skript ausführen: „on“, Aktionen nacheinander, dann „off“. Promise endet nach Ablauf.
  skriptStarten(id, ctx) {
    const s = this.welt.zustand(id);
    const aktionen = (this.h.SKRIPTE || {})[id];
    if (!s || !aktionen) return Promise.resolve();
    if (s.state === 'on') {
      this.log(id + ': läuft bereits (mode: single)');
      return Promise.resolve();
    }
    const attrs = Object.assign({}, s.attributes, { last_triggered: iso(jetzt()), current: 1 });
    this.welt.setze(id, 'on', attrs, ctx);
    return this.warte(0.3)
      .then(() => this.fuehreAus(aktionen, ctx, id, {}))
      .then(() => this.warte(0.6))
      .then(() => {
        const jetztS = this.welt.zustand(id);
        this.welt.setze(id, 'off', Object.assign({}, jetztS ? jetztS.attributes : attrs, { current: 0 }), ctx);
      });
  }

  // ───────────────────────── Sonne & Wetter ─────────────────────────
  sonnenstand(sek) {
    const rad = Math.PI / 180;
    const d = sek / 86400 + 2440587.5 - 2451545.0;
    const g = (357.529 + 0.98560028 * d) * rad;
    const q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
    const e = (23.439 - 0.00000036 * d) * rad;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    const lst = gmst + HEIMAT.lon / 15;
    const ha = (lst * 15) * rad - ra;
    const lat = HEIMAT.lat * rad;
    const elev = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
    let az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha)) / rad;
    az = (az + 360) % 360;
    return { elevation: elev / rad, azimuth: az };
  }

  schreibeSonne() {
    if (!this.ids.has('sun.sun')) return;
    const t = jetzt();
    const jetztStand = this.sonnenstand(t);
    const naechste = { aufgang: null, untergang: null, morgen: null, abend: null, mittag: null, mitternacht: null };
    let vorher = jetztStand.elevation;
    let maxE = -99;
    let minE = 99;
    for (let i = 1; i <= 1440; i++) {
      const ts = t + i * 60;
      const e = this.sonnenstand(ts).elevation;
      if (!naechste.aufgang && vorher < -0.833 && e >= -0.833) naechste.aufgang = ts;
      if (!naechste.untergang && vorher >= -0.833 && e < -0.833) naechste.untergang = ts;
      if (!naechste.morgen && vorher < -6 && e >= -6) naechste.morgen = ts;
      if (!naechste.abend && vorher >= -6 && e < -6) naechste.abend = ts;
      if (e > maxE) { maxE = e; naechste.mittag = ts; }
      if (e < minE) { minE = e; naechste.mitternacht = ts; }
      vorher = e;
    }
    const steigend = this.sonnenstand(t + 60).elevation > jetztStand.elevation;
    this.welt.setze('sun.sun', jetztStand.elevation > -0.833 ? 'above_horizon' : 'below_horizon', {
      next_dawn: iso(naechste.morgen), next_dusk: iso(naechste.abend), next_midnight: iso(naechste.mitternacht),
      next_noon: iso(naechste.mittag), next_rising: iso(naechste.aufgang), next_setting: iso(naechste.untergang),
      elevation: runde(jetztStand.elevation, 2), azimuth: runde(jetztStand.azimuth, 2), rising: steigend
    });
  }

  schreibeWetter(beimStart) {
    if (!this.wetterId) return;
    const s = this.welt.zustand(this.wetterId);
    const temp = s ? s.attributes.temperature + rauschen(0.4) : 9.4;
    const zustaende = ['cloudy', 'partlycloudy', 'rainy', 'cloudy'];
    const zustand = beimStart ? 'cloudy' : zustaende[Math.floor(Math.random() * zustaende.length)];
    this.welt.setze(this.wetterId, zustand, {
      temperature: runde(temp, 1), dew_point: runde(temp - 2.1, 1), temperature_unit: '°C', humidity: 86,
      cloud_coverage: 82.8, uv_index: 0, pressure: 1011.6, pressure_unit: 'hPa', wind_bearing: 236.4,
      wind_speed: 14.8, wind_speed_unit: 'km/h', visibility_unit: 'km', precipitation_unit: 'mm',
      attribution: 'Weather forecast from met.no, delivered by the Norwegian Meteorological Institute.',
      supported_features: 3
    }, null, beimStart ? { zeit: jetzt() - 600 } : undefined);
  }

  wettervorhersage(id, typ) {
    const s = this.welt.zustand(id);
    const basis = s ? s.attributes.temperature : 10;
    const ergebnis = [];
    const t0 = Math.floor(jetzt() / 3600) * 3600;
    const anzahl = typ === 'hourly' ? 24 : (typ === 'twice_daily' ? 14 : 7);
    for (let i = 0; i < anzahl; i++) {
      const ts = typ === 'hourly' ? t0 + (i + 1) * 3600 : (typ === 'twice_daily' ? t0 + i * 43200 : t0 + i * 86400);
      const eintrag = {
        condition: ['cloudy', 'partlycloudy', 'rainy', 'sunny'][(i * 7 + 3) % 4],
        datetime: isoSekunden(ts),
        wind_bearing: 220 + i * 3, cloud_coverage: 60 + (i * 13) % 40,
        temperature: runde(basis + (typ === 'hourly' ? Math.sin(i / 24 * Math.PI * 2) * 3 : 4 - i * 0.3), 1),
        wind_speed: 12 + i % 5, precipitation: (i % 3) * 0.4, humidity: 80 - i
      };
      if (typ !== 'hourly') eintrag.templow = runde(basis - 3 - i * 0.2, 1);
      if (typ === 'twice_daily') eintrag.is_daytime = i % 2 === 0;
      ergebnis.push(eintrag);
    }
    return ergebnis;
  }

  // ───────────────────────── Externes Setzen (/sim/state) ─────────────────────────
  // Interne Modelle an einen von außen gesetzten Zustand anpassen
  uebernimm(id) {
    const s = this.welt.zustand(id);
    if (!s) return;
    const a = s.attributes;
    const l = this.lampen.get(id);
    if (l) {
      l.verfuegbar = s.state !== 'unavailable';
      if (s.state === 'on' || s.state === 'off') l.an = s.state === 'on';
      if (typeof a.brightness === 'number') l.bri = a.brightness;
      if (typeof a.color_temp_kelvin === 'number' && !l.nurHelligkeit) { l.kelvin = a.color_temp_kelvin; l.modus = 'color_temp'; }
      for (const [gid, g] of this.gruppen) if (g.mitglieder.indexOf(id) !== -1) this.schreibeGruppe(gid);
      return;
    }
    const st = this.steckdosen.get(id);
    if (st) { st.an = s.state === 'on'; return; }
    const hz = this.heizungen.get(id);
    if (hz) {
      if (['off', 'heat', 'auto'].indexOf(s.state) !== -1) hz.modus = s.state;
      if (typeof a.temperature === 'number') hz.soll = a.temperature;
      if (typeof a.current_temperature === 'number') this.raeume.get(hz.raum).temp = a.current_temperature;
      return;
    }
    const m = this.medien.get(id);
    if (m) {
      m.zustand = s.state;
      if (typeof a.volume_level === 'number') m.lautstaerke = a.volume_level;
      return;
    }
    if (id === 'vacuum.saugi') {
      this.sauger.zustand = s.state;
      if (typeof a.battery_level === 'number') this.sauger.akku = a.battery_level;
      return;
    }
    if (id === 'sensor.waschmaschine_betriebszustand' && WASCH_ZUSTAENDE.indexOf(s.state) !== -1) {
      this.wasch.zustand = s.state;
      return;
    }
    const au = this.automationen.get(id);
    if (au) au.an = s.state === 'on';
  }

  // ───────────────────────── Takt ─────────────────────────
  tick() {
    const t = jetzt();
    const dt = begrenze(t - this.letzterTick, 0, 60);
    this.letzterTick = t;
    try {
      this.tickRaeume(dt, t);
      for (const s of this.steckdosen.values()) this.schreibeSteckdose(s, null, undefined, dt);
      this.schreibeStromGesamt(false);
      this.zaehlerstand += this.stromGesamt * dt / 3600000;
      const z = this.welt.zustand('sensor.stromzaehler_zaehlerstand');
      if (z) this.welt.setze(z.entity_id, this.zaehlerstand.toFixed(3), z.attributes);
      this.tickMedien();
      this.tickWaschmaschine();
      this.tickSauger(dt);
      this.tickDynamik();
    } catch (err) {
      console.error('[sim] Fehler im Takt:', err);
    }
  }

  // Dynamische Hue-Szenen: Farblampen wandern langsam durch die Palette
  tickDynamik() {
    for (const [raum, sz] of this.dynamik) {
      if (Math.random() > 0.35) continue;
      const gid = this.gruppeVonRaum.get(raum);
      if (!gid || !sz.farben) continue;
      const kandidaten = this.gruppen.get(gid).mitglieder.map(id => this.lampen.get(id)).filter(l => l.dynamisch && l.an && l.verfuegbar);
      if (!kandidaten.length) continue;
      const l = kandidaten[Math.floor(Math.random() * kandidaten.length)];
      l.xy = sz.farben[Math.floor(Math.random() * sz.farben.length)].slice();
      this.schreibeLampe(l.id);
      this.schreibeGruppe(gid);
    }
  }
}

module.exports = { Simulation, LUEFTER, WASCH_ZUSTAENDE, dauerInSekunden, zeitInStunden, wochentag };
