'use strict';
/*
 * Die „Welt“ des Simulators: Registries (Areas, Geräte, Entitäten), Zustände,
 * Ereignisse (state_changed usw.), begrenzter Verlauf und Ziel-Auflösung wie in HA.
 */
const { jetzt, iso, ulid, hexId, uuidAus, gleich, alsListe } = require('./werkzeuge');

const MAX_HISTORIE = 5000;          // höchstens so viele Verlaufspunkte je Entität (begrenzt den Speicher)
// Diese Attribute stehen in HA immer am Ende (Reihenfolge wie Entity._async_write_ha_state)
const ATTR_ENDE = ['unit_of_measurement', 'attribution', 'device_class', 'entity_picture', 'icon', 'friendly_name', 'supported_features'];
const ENTITAETS_KATEGORIEN = ['config', 'diagnostic'];

// Zustand → JSON-Text wie HA (Ergebnis wird am Objekt zwischengespeichert)
function zustandJson(s) {
  if (!s._json) {
    s._json = JSON.stringify({
      entity_id: s.entity_id,
      state: s.state,
      attributes: s.attributes,
      last_changed: iso(s.lc),
      last_reported: iso(s.lr),
      last_updated: iso(s.lu),
      context: s.context
    });
  }
  return s._json;
}

// Kompaktes Format für subscribe_entities (wie State.as_compressed_state)
function kompakterZustand(s) {
  const c = {
    s: s.state,
    a: s.attributes,
    c: (s.context.parent_id || s.context.user_id) ? s.context : s.context.id,
    lc: s.lc
  };
  if (s.lu !== s.lc) c.lu = s.lu;
  return c;
}

// Unterschied zweier Zustände für subscribe_entities (wie _state_diff in HA)
function zustandsDiff(alt, neu) {
  const plus = {};
  const diff = { '+': plus };
  if (alt.state !== neu.state) plus.s = neu.state;
  if (alt.lc !== neu.lc) plus.lc = neu.lc;
  else if (alt.lu !== neu.lu) plus.lu = neu.lu;
  if (alt.context.id !== neu.context.id) {
    if (neu.context.parent_id || neu.context.user_id) plus.c = neu.context;
    else plus.c = neu.context.id;
  }
  if (!gleich(alt.attributes, neu.attributes)) {
    const a = {};
    let geaendert = false;
    for (const k of Object.keys(neu.attributes)) {
      if (!gleich(alt.attributes[k], neu.attributes[k])) { a[k] = neu.attributes[k]; geaendert = true; }
    }
    if (geaendert) plus.a = a;
    const entfernt = Object.keys(alt.attributes).filter(k => !Object.prototype.hasOwnProperty.call(neu.attributes, k));
    if (entfernt.length) diff['-'] = { a: entfernt };
  }
  return diff;
}

class Welt {
  constructor(haushalt) {
    this.zustaende = new Map();
    this.historie = new Map();
    this.hoerer = new Set();
    this.benutzerId = hexId('benutzer-julian');
    this.startZeit = jetzt();
    this.aufbewahrungSek = 26 * 3600; // ältere Punkte werden verworfen (bis auf den letzten davor)
    this.baueRegistries(haushalt);
  }

  // ───────── Registries aus haushalt.js im HA-Format aufbauen ─────────
  baueRegistries(h) {
    const t0 = Math.floor(this.startZeit) - 86400 * 200; // „vor 200 Tagen angelegt“
    this.bereiche = h.BEREICHE.map((b, i) => ({
      aliases: [],
      area_id: b.id,
      created_at: t0 + i * 60,
      floor_id: null,
      humidity_entity_id: b.feuchte || null,
      icon: b.icon,
      labels: [],
      modified_at: t0 + 86400 * 30,
      name: b.name,
      picture: null,
      temperature_entity_id: b.temperatur || null
    }));
    this.bereichIds = new Set(this.bereiche.map(b => b.area_id));

    this.konfigEintraege = new Map(); // plattform → config_entry_id
    const eintragFuer = plattform => {
      if (!this.konfigEintraege.has(plattform)) this.konfigEintraege.set(plattform, hexId('config-entry-' + plattform).slice(0, 26).toUpperCase());
      return this.konfigEintraege.get(plattform);
    };

    this.geraetIdNachSchluessel = new Map();
    Object.keys(h.GERAETE).forEach(k => this.geraetIdNachSchluessel.set(k, hexId('geraet-' + k)));
    this.geraete = [];
    this.geraetNachId = new Map();
    Object.keys(h.GERAETE).forEach((k, i) => {
      const g = h.GERAETE[k];
      const typ = h.TYPEN[g[2]];
      const ce = eintragFuer(typ.plattform);
      const eintrag = {
        area_id: g[1],
        configuration_url: typ.plattform === 'hue' ? 'https://192.168.178.40' : null,
        config_entries: [ce],
        config_entries_subentries: { [ce]: [null] },
        connections: typ.zigbee ? [['zigbee', hexId(k).slice(0, 16).replace(/(..)(?!$)/g, '$1:')]] : [],
        created_at: t0 + 3600 + i * 120,
        disabled_by: null,
        entry_type: typ.entry_type || null,
        hw_version: null,
        id: this.geraetIdNachSchluessel.get(k),
        identifiers: [[typ.plattform, typ.plattform === 'hue' || typ.plattform === 'matter' ? uuidAus('id-' + k) : hexId('id-' + k).slice(0, 12)]],
        labels: [],
        manufacturer: typ.hersteller,
        model: typ.modell,
        model_id: typ.model_id || null,
        modified_at: t0 + 86400 * 40 + i * 60,
        name_by_user: null,
        name: g[0],
        primary_config_entry: ce,
        serial_number: null,
        sw_version: typ.sw || null,
        via_device_id: typ.via ? this.geraetIdNachSchluessel.get(typ.via) : null
      };
      this.geraete.push(eintrag);
      this.geraetNachId.set(eintrag.id, eintrag);
    });

    this.eintraege = [];
    this.eintragNachId = new Map();
    for (const e of h.ENTITAETEN) {
      if (e.ohneRegistry) continue;
      const domain = e.entity_id.split('.')[0];
      const geraetId = e.geraet ? this.geraetIdNachSchluessel.get(e.geraet) : null;
      const geraet = geraetId ? this.geraetNachId.get(geraetId) : null;
      const plattform = e.plattform || (e.geraet ? h.TYPEN[h.GERAETE[e.geraet][2]].plattform : domain);
      const eintrag = {
        area_id: e.bereich || null,
        categories: {},
        config_entry_id: geraet ? geraet.primary_config_entry : null,
        config_subentry_id: null,
        created_at: t0 + 7200,
        device_id: geraetId,
        disabled_by: e.deaktiviert ? 'user' : null,
        entity_category: e.kategorie || null,
        entity_id: e.entity_id,
        has_entity_name: !!geraet && e.hatName !== false,
        hidden_by: e.versteckt ? 'user' : null,
        icon: e.icon || null,
        id: hexId('entitaet-' + e.entity_id),
        labels: [],
        modified_at: t0 + 86400 * 50,
        name: null,
        options: e.optionen || {},
        original_icon: null,
        original_name: e.name === undefined ? null : e.name,
        platform: plattform,
        translation_key: e.tk || null,
        unique_id: e.unique_id || (plattform === 'hue' || plattform === 'matter' ? uuidAus('uid-' + e.entity_id) : hexId('uid-' + e.entity_id).slice(0, 20) + '-' + domain)
      };
      this.eintraege.push(eintrag);
      this.eintragNachId.set(eintrag.entity_id, eintrag);
    }
  }

  // Kompakte Liste wie config/entity_registry/list_for_display (ohne deaktivierte)
  anzeigeListe() {
    const entities = [];
    for (const e of this.eintraege) {
      if (e.disabled_by) continue;
      const d = { ei: e.entity_id, pl: e.platform };
      if (e.area_id) d.ai = e.area_id;
      d.lb = e.labels.slice();
      if (e.device_id) d.di = e.device_id;
      if (e.icon) d.ic = e.icon;
      if (e.translation_key) d.tk = e.translation_key;
      if (e.entity_category) d.ec = ENTITAETS_KATEGORIEN.indexOf(e.entity_category);
      if (e.hidden_by) d.hb = true;
      if (e.has_entity_name) d.hn = true;
      const name = e.name || e.original_name;
      if (name) d.en = name;
      const sensorOpt = e.options && e.options.sensor;
      if (sensorOpt && sensorOpt.suggested_display_precision !== undefined) d.dp = sensorOpt.suggested_display_precision;
      entities.push(d);
    }
    return { entity_categories: { 0: 'config', 1: 'diagnostic' }, entities: entities };
  }

  // friendly_name wie HA: Registry-Name > Gerätename + Entitätsname > Entitätsname
  freundlicherName(eintrag) {
    if (eintrag.name) return eintrag.name;
    if (eintrag.has_entity_name && eintrag.device_id) {
      const g = this.geraetNachId.get(eintrag.device_id);
      const geraetName = g ? (g.name_by_user || g.name) : null;
      if (!eintrag.original_name) return geraetName;
      return geraetName ? geraetName + ' ' + eintrag.original_name : eintrag.original_name;
    }
    return eintrag.original_name;
  }

  // Raum einer Entität: eigene area_id, sonst die des Geräts
  bereichVon(entityId) {
    const e = this.eintragNachId.get(entityId);
    if (!e) return null;
    if (e.area_id) return e.area_id;
    if (e.device_id) {
      const g = this.geraetNachId.get(e.device_id);
      return g ? g.area_id : null;
    }
    return null;
  }

  kontext(eltern, benutzerId) {
    return { id: ulid(), parent_id: eltern ? eltern.id : null, user_id: benutzerId || null };
  }

  zustand(id) {
    return this.zustaende.get(id) || null;
  }

  // Attribute in HA-Reihenfolge bringen, friendly_name/icon aus der Registry ergänzen
  ordneAttribute(entityId, attribute) {
    const eintrag = this.eintragNachId.get(entityId);
    const quelle = Object.assign({}, attribute);
    if (eintrag) {
      const name = this.freundlicherName(eintrag);
      if (name) quelle.friendly_name = name;
      if (eintrag.icon) quelle.icon = eintrag.icon;
    }
    const ergebnis = {};
    for (const k of Object.keys(quelle)) {
      if (ATTR_ENDE.indexOf(k) === -1) ergebnis[k] = quelle[k];
    }
    for (const k of ATTR_ENDE) {
      if (Object.prototype.hasOwnProperty.call(quelle, k) && quelle[k] !== undefined) ergebnis[k] = quelle[k];
    }
    return ergebnis;
  }

  // Zustand schreiben. Feuert state_changed nur, wenn sich Zustand oder Attribute ändern.
  // optionen.zeit: Zeitpunkt vorgeben (nur beim Start), optionen.lc: last_changed vorgeben
  setze(entityId, state, attribute, kontext, optionen) {
    optionen = optionen || {};
    const eintrag = this.eintragNachId.get(entityId);
    if (eintrag && eintrag.disabled_by) return false; // deaktivierte Entitäten haben keinen Zustand
    state = String(state);
    if (state.length > 255) state = state.slice(0, 255);
    const attrs = this.ordneAttribute(entityId, attribute || {});
    const alt = this.zustaende.get(entityId) || null;
    let t = optionen.zeit || jetzt();
    let vorPunkt = null;
    if (!alt) {
      // Startzustand nie vor den erzeugten Verlauf legen; gleicher Zustand → last_changed übernehmen
      const l = this.historie.get(entityId);
      vorPunkt = l && l.length ? l[l.length - 1] : null;
      if (vorPunkt && vorPunkt.lu >= t) t = Math.min(jetzt(), vorPunkt.lu + 1);
    }
    if (alt && alt.state === state && gleich(alt.attributes, attrs)) {
      alt.lr = t;
      alt._json = null;
      return false;
    }
    const ctx = kontext || this.kontext();
    const neu = {
      entity_id: entityId,
      state: state,
      attributes: attrs,
      lc: (alt && alt.state === state) ? alt.lc : ((vorPunkt && vorPunkt.s === state) ? vorPunkt.lc : (optionen.lc || t)),
      lu: t,
      lr: t,
      context: ctx,
      _json: null
    };
    this.zustaende.set(entityId, neu);
    this.merkeHistorie(neu, alt || (vorPunkt ? { state: vorPunkt.s } : null));
    this.feuere('state_changed', { entity_id: entityId, old_state: alt, new_state: neu }, ctx, t);
    return true;
  }

  // Entität entfernen (z. B. scene.delete) – feuert state_changed mit new_state null
  entferne(entityId, kontext) {
    const alt = this.zustaende.get(entityId);
    if (!alt) return false;
    this.zustaende.delete(entityId);
    this.historie.delete(entityId);
    const ctx = kontext || this.kontext();
    this.feuere('state_changed', { entity_id: entityId, old_state: alt, new_state: null }, ctx, jetzt());
    return true;
  }

  // ───────── Ereignisse ─────────
  abonniere(fn) {
    this.hoerer.add(fn);
    return () => this.hoerer.delete(fn);
  }

  feuere(typ, daten, kontext, zeit) {
    const ereignis = {
      event_type: typ,
      data: daten,
      origin: 'LOCAL',
      time_fired: zeit || jetzt(),
      context: kontext || this.kontext(),
      _json: null
    };
    for (const fn of Array.from(this.hoerer)) {
      try {
        fn(ereignis);
      } catch (err) {
        console.error('[welt] Fehler in Ereignis-Hörer:', err);
      }
    }
    return ereignis;
  }

  // Ereignis → JSON-Text (einmal je Ereignis, für alle Verbindungen)
  ereignisJson(e) {
    if (!e._json) {
      let daten;
      if (e.event_type === 'state_changed') {
        daten = '{"entity_id":' + JSON.stringify(e.data.entity_id) +
          ',"old_state":' + (e.data.old_state ? zustandJson(e.data.old_state) : 'null') +
          ',"new_state":' + (e.data.new_state ? zustandJson(e.data.new_state) : 'null') + '}';
      } else {
        daten = JSON.stringify(e.data);
      }
      e._json = '{"event_type":' + JSON.stringify(e.event_type) + ',"data":' + daten +
        ',"origin":"LOCAL","time_fired":"' + iso(e.time_fired) + '","context":' + JSON.stringify(e.context) + '}';
    }
    return e._json;
  }

  // ───────── Verlauf ─────────
  merkeHistorie(neu, alt) {
    let liste = this.historie.get(neu.entity_id);
    if (!liste) {
      liste = [];
      this.historie.set(neu.entity_id, liste);
    }
    liste.push({ s: neu.state, a: neu.attributes, lu: neu.lu, lc: neu.lc, nurAttr: !!alt && alt.state === neu.state, c: neu.context });
    if (liste.length > MAX_HISTORIE) liste.splice(0, liste.length - MAX_HISTORIE);
    const grenze = neu.lu - this.aufbewahrungSek;
    let n = 0;
    while (n < liste.length - 1 && liste[n + 1].lu < grenze) n++;
    if (n > 0) liste.splice(0, n);
  }

  // Erzeugte Verlaufspunkte vor den ersten echten Zustand legen (nur beim Start)
  historieVorbelegen(entityId, punkte) {
    const liste = this.historie.get(entityId) || [];
    this.historie.set(entityId, punkte.concat(liste).slice(-MAX_HISTORIE));
  }

  // ───────── Ziel-Auflösung wie async_extract_referenced_entity_ids ─────────
  // Rückgabe: { ids: [...], explizit: Set } – nur existierende Entitäten der passenden Domains.
  // Über Gerät/Area werden versteckte und Kategorie-Entitäten (config/diagnostic) NICHT erfasst.
  loeseZielAuf(daten, domains, nurRegistry) {
    const explizit = new Set();
    let alle = false;
    for (const id of alsListe(daten.entity_id)) {
      if (id === 'all') alle = true;
      else explizit.add(id.toLowerCase());
    }
    const geraete = new Set(alsListe(daten.device_id));
    const bereiche = new Set(alsListe(daten.area_id));
    const etagen = alsListe(daten.floor_id);
    if (etagen.length) {
      for (const b of this.bereiche) if (b.floor_id && etagen.indexOf(b.floor_id) !== -1) bereiche.add(b.area_id);
    }
    const labels = new Set(alsListe(daten.label_id));
    const indirekt = new Set();
    if (geraete.size || bereiche.size || labels.size) {
      for (const e of this.eintraege) {
        if (e.disabled_by || e.entity_category || e.hidden_by) continue;
        let treffer = false;
        if (e.device_id && geraete.has(e.device_id)) treffer = true;
        if (!treffer && bereiche.size) {
          if (e.area_id) treffer = bereiche.has(e.area_id);
          else if (e.device_id) {
            const g = this.geraetNachId.get(e.device_id);
            treffer = !!g && !!g.area_id && bereiche.has(g.area_id);
          }
        }
        if (!treffer && labels.size && e.labels.some(l => labels.has(l))) treffer = true;
        if (treffer) indirekt.add(e.entity_id);
      }
    }
    const passt = id => !domains || domains.indexOf(id.split('.')[0]) !== -1;
    const ids = [];
    const existiert = id => nurRegistry ? (this.eintragNachId.has(id) && !this.eintragNachId.get(id).disabled_by) : this.zustaende.has(id);
    if (alle) {
      const quelle = nurRegistry ? this.eintraege.filter(e => !e.disabled_by).map(e => e.entity_id) : Array.from(this.zustaende.keys());
      for (const id of quelle) if (passt(id)) ids.push(id);
    } else {
      const kandidaten = new Set(Array.from(explizit).concat(Array.from(indirekt)));
      for (const id of kandidaten) if (passt(id) && existiert(id)) ids.push(id);
    }
    return { ids: ids, explizit: explizit, alle: alle };
  }
}

module.exports = { Welt, zustandJson, kompakterZustand, zustandsDiff };
