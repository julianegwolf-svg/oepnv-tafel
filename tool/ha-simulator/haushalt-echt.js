'use strict';
/*
 * Baut den ECHTEN Haushalt aus der privaten Datei haushalt.json (Struktur-Export aus Julians HA,
 * gitignored) und – falls vorhanden – den Automationen aus automations.echt.yaml.
 * Alles geschieht zur Laufzeit; in dieser (eingecheckten) Datei stehen keine echten IDs oder Namen.
 * Zustände sind erfunden (der Export enthält keine).
 *
 * mitExtras() ergänzt fiktive Domänen aus haushalt.js (Thermostate, Fenster/Tür, Waschmaschine,
 * Saugroboter, Steckdosen mit Leistung, Sonos/TV, Skripte/Helfer), damit generischer Code testbar bleibt.
 */
const fs = require('fs');
const { parseYaml } = require('./yaml.js');
const fiktiv = require('./haushalt.js');
const { hexId } = require('./werkzeuge');

const HERSTELLER = ['Signify Netherlands B.V.', 'IKEA of Sweden', 'Apple', 'Met.no', 'Google Inc.', 'Sonos', 'Bosch', 'AVM', 'LUMI', 'Roborock', 'Shelly', 'Amazon', 'Samsung', 'Xiaomi'];

function normalisiere(name) {
  return String(name || '').toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
}

function trenneModell(text) {
  text = String(text || '').trim();
  for (const h of HERSTELLER) if (text.indexOf(h + ' ') === 0) return { hersteller: h, modell: text.slice(h.length + 1) };
  const i = text.indexOf(' ');
  if (i > 0) return { hersteller: text.slice(0, i), modell: text.slice(i + 1) };
  return { hersteller: text || null, modell: text || null };
}

// Lampen-Fähigkeiten aus dem Modelltext ableiten
function lampenArt(modell, plattform) {
  const m = String(modell || '');
  const matter = plattform === 'matter';
  if (/\bRoom\b|\bZone\b/.test(m)) return null;
  if (/color|colour|Extended color|\bCWS\b|RGB/i.test(m)) return { farbe: !matter, matter: matter, farbig: true };
  if (/ambiance|\bWS\b|white spectrum|tunable|Color temperature/i.test(m)) return { matter: matter, ws: true };
  if (/white/i.test(m)) return { matter: matter, nurHelligkeit: true };
  return { matter: matter, ws: true };
}

// Klima-Profil aus dem Raumnamen raten
function klimaFuer(name) {
  const n = normalisiere(name);
  if (/bad/.test(n)) return { temp: 21.2, feuchte: 63, basisTemp: 21, basisFeuchte: 60, amplitude: 0.5, besonders: 'dusche' };
  if (/schlaf|bed/.test(n)) return { temp: 18.8, feuchte: 55, basisTemp: 18.4, basisFeuchte: 52, amplitude: 0.5, besonders: 'nachtfeuchte' };
  if (/kuch|kitchen/.test(n)) return { temp: 20.6, feuchte: 51, basisTemp: 20.2, basisFeuchte: 50, amplitude: 0.8 };
  if (/buro|office|arbeit/.test(n)) return { temp: 20.3, feuchte: 45, basisTemp: 19.8, basisFeuchte: 45, amplitude: 0.7 };
  if (/flur|diele|hall/.test(n)) return { temp: 19.6, feuchte: null, basisTemp: 19.3, basisFeuchte: null, amplitude: 0.4 };
  return { temp: 21.4, feuchte: 47, basisTemp: 20.6, basisFeuchte: 47, amplitude: 0.6 };
}

const SENSOR_ARTEN_NACH_KLASSE = { temperature: 'temperatur', humidity: 'feuchte', battery: 'batterie', power: 'leistung', energy: 'energie', illuminance: 'helligkeit', signal_strength: 'signal', voltage: 'spannung' };

function ladeEchtenHaushalt(jsonPfad, yamlPfad, log) {
  const roh = JSON.parse(fs.readFileSync(jsonPfad, 'utf8'));
  const { sensor, binaer, statisch, lampe } = fiktiv.BAUSTEINE;

  const BEREICHE = (roh.areas || []).map(a => ({ id: a.area_id, name: a.name, icon: a.icon || null, temperatur: null, feuchte: null }));
  const areaNachName = new Map(BEREICHE.map(b => [b.name, b.id]));
  const bereichVonName = name => (name ? (areaNachName.get(name) || null) : null);

  // ── Geräte: nach Name + Modell gruppieren ──
  const TYPEN = {};
  const GERAETE = {};
  const geraetSchluessel = new Map();
  let nr = 0;
  for (const e of roh.entities) {
    if (!e.device) continue;
    const k = e.device + '|' + (e.model || '');
    if (!geraetSchluessel.has(k)) {
      const schluessel = 'g' + (nr++);
      geraetSchluessel.set(k, schluessel);
      const hm = trenneModell(e.model);
      const istRaum = / Room$/.test(e.model || '') || e.model === 'Room';
      TYPEN['t_' + schluessel] = {
        hersteller: hm.hersteller, modell: istRaum ? 'Room' : hm.modell, model_id: null, sw: null, plattform: e.platform,
        entry_type: e.platform === 'met' ? 'service' : null
      };
      GERAETE[schluessel] = [e.device, bereichVonName(e.area), 't_' + schluessel];
    } else {
      const g = GERAETE[geraetSchluessel.get(k)];
      if (!g[1] && e.area) g[1] = bereichVonName(e.area);
    }
  }
  // Hue-Geräte hängen an der Bridge
  const bridge = Object.keys(GERAETE).find(k => /Hue Bridge/.test(TYPEN[GERAETE[k][2]].modell || ''));
  if (bridge) Object.keys(GERAETE).forEach(k => { if (k !== bridge && TYPEN[GERAETE[k][2]].plattform === 'hue') TYPEN[GERAETE[k][2]].via = bridge; });

  // ── Automationen aus YAML ──
  let yamlListe = [];
  if (yamlPfad && fs.existsSync(yamlPfad)) {
    try {
      yamlListe = parseYaml(fs.readFileSync(yamlPfad, 'utf8')) || [];
    } catch (err) {
      log('automations.echt.yaml nicht lesbar: ' + err.message);
    }
  }
  const findeAutomation = (entityId, name) => yamlListe.find(a => a.alias === name) ||
    yamlListe.find(a => entityId === 'automation.' + fiktiv.slug(String(a.alias || '').replace(/[–—]/g, '-')));

  // ── Entitäten ──
  const ENTITAETEN = [];
  const AUTOMATIONEN = {};
  const TODO = {};
  const szenenNachGeraet = new Map();
  const KLIMA = {};
  BEREICHE.forEach(b => { KLIMA[b.id] = klimaFuer(b.name); });
  const tracker = roh.entities.filter(e => e.entity_id.indexOf('device_tracker.') === 0).map(e => e.entity_id);
  let personNr = 0;
  let medienNr = 0;

  for (const e of roh.entities) {
    const id = e.entity_id;
    const domain = id.split('.')[0];
    const geraet = e.device ? geraetSchluessel.get(e.device + '|' + (e.model || '')) : null;
    const raum = geraet ? GERAETE[geraet][1] : bereichVonName(e.area);
    const name = e.name === undefined ? null : e.name;
    const basis = { entity_id: id, geraet: geraet, name: name, plattform: e.platform };
    if (!geraet) basis.unique_id = hexId('uid-' + id).slice(0, 26);
    const h = parseInt(hexId(id).slice(0, 6), 16);

    if (domain === 'light') {
      const art = lampenArt(e.model, e.platform);
      if (!art) {
        ENTITAETEN.push(Object.assign(basis, { art: 'gruppe', modell: { raum: raum } }));
      } else {
        const an = h % 3 !== 0;
        const opt = Object.assign({ an: an, bri: 70 + h % 170, kelvin: 2200 + (h % 6) * 150 }, art);
        if (art.farbig && h % 2 === 0) { if (art.matter) opt.hs = [20 + h % 40, 60]; else opt.xy = [0.5267, 0.4133]; }
        const l = lampe(id, geraet, opt);
        l.plattform = e.platform;
        ENTITAETEN.push(l);
      }
    } else if (domain === 'scene') {
      const vorgabe = fiktiv.szenenVorgabe(name);
      ENTITAETEN.push(Object.assign(basis, { art: 'szene', modell: Object.assign({ raum: raum, name: name, gruppenName: geraet ? GERAETE[geraet][0] : null }, vorgabe) }));
      if (geraet) {
        const liste = szenenNachGeraet.get(geraet) || [];
        if (liste.indexOf(name) === -1) liste.push(name);
        szenenNachGeraet.set(geraet, liste);
      }
    } else if (domain === 'select' && e.platform === 'hue') {
      ENTITAETEN.push(Object.assign(basis, { art: 'szenenauswahl', modell: { raum: raum, optionen: null, geraet: geraet } }));
    } else if (domain === 'switch') {
      const konfig = e.platform === 'hue' && /automation/i.test(name || '');
      ENTITAETEN.push(Object.assign(statisch(id, geraet, name, 'on', {}, { art: 'schalter_einfach' }), { plattform: e.platform, kategorie: konfig ? 'config' : null }, geraet ? {} : { unique_id: basis.unique_id }));
    } else if (domain === 'binary_sensor') {
      const dc = e.device_class;
      if (dc === 'motion' || dc === 'occupancy' || dc === 'presence') ENTITAETEN.push(Object.assign(binaer(id, geraet, name, dc, false), { plattform: e.platform }));
      else if (dc === 'window' || dc === 'door' || dc === 'opening') ENTITAETEN.push(Object.assign(binaer(id, geraet, name, dc, false, { modell: dc === 'window' ? { raum: raum, fenster: true } : null }), { plattform: e.platform }));
      else ENTITAETEN.push(Object.assign(statisch(id, geraet, name, 'off', dc ? { device_class: dc } : {}), { plattform: e.platform }));
    } else if (domain === 'sensor') {
      const sa = SENSOR_ARTEN_NACH_KLASSE[e.device_class];
      if ((sa === 'temperatur' || sa === 'feuchte') && raum) {
        const k = KLIMA[raum];
        const wert = sa === 'temperatur' ? k.temp : (k.feuchte === null ? 50 : k.feuchte);
        if (sa === 'feuchte' && k.feuchte === null) { k.feuchte = 50; k.basisFeuchte = 50; }
        ENTITAETEN.push(Object.assign(sensor(id, geraet, name, sa, wert, { modell: { raum: raum, groesse: sa === 'temperatur' ? 'temp' : 'feuchte' } }), { plattform: e.platform }));
        const b = BEREICHE.find(x => x.id === raum);
        if (sa === 'temperatur' && b && !b.temperatur) b.temperatur = null; // in HA nur gesetzt, wenn der Nutzer es wählt
      } else if (sa) {
        const startwert = { batterie: 60 + h % 40, helligkeit: 2 + h % 20, leistung: 0, energie: 10 + h % 90, signal: -60, spannung: 230 }[sa];
        ENTITAETEN.push(Object.assign(sensor(id, geraet, name, sa, startwert), { plattform: e.platform }));
      } else {
        const attrs = {};
        if (e.unit) attrs.unit_of_measurement = e.unit;
        if (e.device_class) attrs.device_class = e.device_class;
        ENTITAETEN.push(Object.assign(statisch(id, geraet, name, 'unknown', attrs), { plattform: e.platform }));
      }
    } else if (domain === 'media_player') {
      const homepod = /HomePod/i.test(e.model || '');
      const typ = e.platform === 'sonos' ? 'sonos' : (homepod ? 'homepod' : 'appletv');
      const vorlage = fiktiv.ENTITAETEN.find(x => x.art === 'medien' && x.modell.typ === typ);
      const modell = Object.assign({}, vorlage.modell, { zustand: medienNr === 0 ? 'paused' : 'idle', titel: medienNr === 0 ? 4 : null, position: 64 });
      medienNr++;
      ENTITAETEN.push(Object.assign(basis, { art: 'medien', modell: modell }));
    } else if (domain === 'remote') {
      ENTITAETEN.push(Object.assign(statisch(id, geraet, name, 'off', { activity_list: null, supported_features: 0 }, { art: 'fernbedienung' }), { plattform: e.platform }));
    } else if (domain === 'person') {
      ENTITAETEN.push(Object.assign(basis, { art: 'person', unique_id: fiktiv.slug(name || id.split('.')[1]), modell: { zustand: 'home', tracker: tracker[personNr++] || null } }));
    } else if (domain === 'device_tracker') {
      ENTITAETEN.push(Object.assign(basis, { art: 'tracker', modell: { zustand: 'home' } }));
    } else if (domain === 'todo') {
      ENTITAETEN.push(Object.assign(basis, { art: 'todo' }));
      TODO[id] = fiktiv.TODO['todo.einkaufsliste'];
    } else if (domain === 'automation') {
      const a = findeAutomation(id, name);
      basis.unique_id = a && a.id ? String(a.id) : basis.unique_id;
      ENTITAETEN.push(Object.assign(basis, { art: 'automation', modell: { an: true } }));
      if (a) {
        AUTOMATIONEN[id] = {
          id: String(a.id || ''), alias: a.alias, mode: a.mode || 'single',
          triggers: a.triggers || a.trigger || [], conditions: a.conditions || a.condition || [], actions: a.actions || a.action || []
        };
      }
    } else if (domain === 'weather') {
      ENTITAETEN.push(Object.assign(basis, { art: 'wetter' }));
    } else if (domain === 'tag') {
      ENTITAETEN.push(Object.assign(statisch(id, null, name, 'unknown', { tag_id: fiktiv.slug(name || 'tag') + '-' + hexId(id).slice(0, 8), last_scanned_by_device_id: null }), { plattform: 'tag', unique_id: basis.unique_id }));
    } else if (domain === 'notify') {
      ENTITAETEN.push(Object.assign(statisch(id, geraet, name, 'unknown', { supported_features: 0 }), { plattform: e.platform }));
    } else {
      ENTITAETEN.push(Object.assign(statisch(id, geraet, name, 'unknown', {}), { plattform: e.platform }, geraet ? {} : { unique_id: basis.unique_id }));
    }
  }

  // Szenenauswahl: Optionen = Szenen desselben Hue-Raum-Geräts (sonst Standardliste)
  for (const e of ENTITAETEN) {
    if (e.art !== 'szenenauswahl') continue;
    const liste = szenenNachGeraet.get(e.modell.geraet);
    e.modell.optionen = liste && liste.length ? liste.slice() : ['Relax', 'Read', 'Concentrate', 'Energize', 'Nightlight'];
  }
  ENTITAETEN.push({ entity_id: 'zone.home', geraet: null, art: 'zone', ohneRegistry: true });

  return {
    NAME: 'echt',
    BEREICHE, TYPEN, GERAETE, SENSORARTEN: fiktiv.SENSORARTEN, ENTITAETEN, SZENEN_ZULETZT: {},
    PLAYLIST: fiktiv.PLAYLIST, SENDER: fiktiv.SENDER, MP: fiktiv.MP, KLIMA, PRESETS: fiktiv.PRESETS, ZEITPLAN: fiktiv.ZEITPLAN,
    SKRIPTE: {}, AUTOMATIONEN, BEWEGUNGSLICHT: null, TODO, SZENARIEN: fiktiv.SZENARIEN,
    LOCKER_AUTOMATIONEN: true
  };
}

// Fiktive Domänen in den echten Haushalt einhängen (Räume per Name zuordnen)
function mitExtras(H) {
  const F = fiktiv;
  const zuordnung = {};
  for (const fb of F.BEREICHE) {
    const n = normalisiere(fb.name);
    const treffer = H.BEREICHE.find(b => normalisiere(b.name) === n) ||
      H.BEREICHE.find(b => { const m = normalisiere(b.name); return m.indexOf(n) === 0 || n.indexOf(m) === 0; });
    if (treffer) zuordnung[fb.id] = treffer.id;
  }
  const benutzt = new Set();
  const geraete = new Set(F.EXTRAS_GERAETE);
  const entitaeten = F.ENTITAETEN.filter(e => (e.geraet && geraete.has(e.geraet)) || (!e.geraet && F.EXTRAS_ARTEN.indexOf(e.art) !== -1));
  const raumVon = id => {
    if (!id) return id;
    if (!zuordnung[id]) {
      // Raum fehlt im echten Haushalt (z. B. Flur) → als fiktiven Raum ergänzen
      const fb = F.BEREICHE.find(b => b.id === id);
      if (!H.BEREICHE.find(b => b.id === id)) H.BEREICHE.push(Object.assign({}, fb, { temperatur: null, feuchte: null }));
      zuordnung[id] = id;
    }
    benutzt.add(zuordnung[id]);
    return zuordnung[id];
  };
  for (const k of F.EXTRAS_GERAETE) {
    const g = F.GERAETE[k];
    H.GERAETE['x_' + k] = [g[0], raumVon(g[1]), 'x_' + g[2]];
    H.TYPEN['x_' + g[2]] = Object.assign({}, F.TYPEN[g[2]], { via: null });
  }
  const tiefKopie = o => JSON.parse(JSON.stringify(o));
  for (const e of entitaeten) {
    const kopie = Object.assign({}, e, { geraet: e.geraet ? 'x_' + e.geraet : null });
    if (kopie.bereich) kopie.bereich = raumVon(kopie.bereich);
    if (kopie.modell && kopie.modell.raum) kopie.modell = Object.assign({}, kopie.modell, { raum: raumVon(kopie.modell.raum) });
    if (H.ENTITAETEN.find(x => x.entity_id === kopie.entity_id)) continue;
    H.ENTITAETEN.push(kopie);
  }
  // Klima der betroffenen Räume aus dem fiktiven Haushalt übernehmen (Startwerte passen zu den Heizungen)
  for (const fid of Object.keys(zuordnung)) {
    const echt = zuordnung[fid];
    if (F.KLIMA[fid]) {
      const vorher = H.KLIMA[echt];
      H.KLIMA[echt] = Object.assign({}, F.KLIMA[fid], { feuchte: vorher && vorher.feuchte !== null ? vorher.feuchte : F.KLIMA[fid].feuchte });
      if (H.KLIMA[echt].feuchte !== null && H.KLIMA[echt].basisFeuchte === null) H.KLIMA[echt].basisFeuchte = 50;
    }
  }
  // Skripte mit umgeschriebenen Area-IDs
  const umschreiben = wert => {
    if (Array.isArray(wert)) return wert.map(umschreiben);
    if (wert && typeof wert === 'object') {
      const o = {};
      for (const k of Object.keys(wert)) o[k] = k === 'area_id' ? (Array.isArray(wert[k]) ? wert[k].map(a => zuordnung[a] || a) : (zuordnung[wert[k]] || wert[k])) : umschreiben(wert[k]);
      return o;
    }
    return wert;
  };
  H.SKRIPTE = umschreiben(tiefKopie(F.SKRIPTE));
  H.EXTRAS = true;
  return H;
}

module.exports = { ladeEchtenHaushalt, mitExtras, normalisiere };
