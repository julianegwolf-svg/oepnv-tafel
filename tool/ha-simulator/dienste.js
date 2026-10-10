'use strict';
/*
 * Services (Aktionen) wie in Home Assistant: Schema-Prüfung, Ziel-Auflösung (entity/device/area),
 * Feature-Prüfung, Fehlercodes (not_found, invalid_format, service_validation_error, home_assistant_error).
 */
const { iso, jetzt, hexId } = require('./werkzeuge');
const { LUEFTER } = require('./modelle');

class HAFehler extends Error {
  constructor(code, message, extra) {
    super(message);
    this.code = code;
    this.extra = extra || null;
  }
}

const ZIEL_FELDER = ['entity_id', 'device_id', 'area_id', 'floor_id', 'label_id'];

// Feldtypen: zahl, ganz, text, bool, liste, objekt, beliebig
function f(typ, opt) {
  return Object.assign({ typ: typ }, opt || {});
}

function invalid(nachricht) {
  return new HAFehler('invalid_format', nachricht);
}

function pruefeWert(name, wert, def) {
  const ort = " for dictionary value @ data['" + name + "']";
  let w = wert;
  if (def.typ === 'zahl' || def.typ === 'ganz') {
    if (typeof w === 'string' && w.trim() !== '' && !isNaN(Number(w))) w = Number(w);
    if (typeof w !== 'number' || isNaN(w) || typeof w === 'boolean') throw invalid('expected ' + (def.typ === 'ganz' ? 'int' : 'float') + ort);
    if (def.typ === 'ganz') w = Math.trunc(w);
    if (def.min !== undefined && w < def.min) throw invalid('value must be at least ' + def.min + ort);
    if (def.max !== undefined && w > def.max) throw invalid('value must be at most ' + def.max + ort);
  } else if (def.typ === 'text') {
    if (typeof w === 'number') w = String(w);
    if (typeof w !== 'string') throw invalid('expected str' + ort);
    if (def.werte && def.werte.indexOf(w) === -1) throw invalid('value must be one of [' + def.werte.map(x => "'" + x + "'").join(', ') + ']' + ort);
  } else if (def.typ === 'bool') {
    if (w === 'true' || w === 'on' || w === 1) w = true;
    if (w === 'false' || w === 'off' || w === 0) w = false;
    if (typeof w !== 'boolean') throw invalid('expected boolean' + ort);
  } else if (def.typ === 'liste') {
    if (!Array.isArray(w)) {
      if (def.einzelnErlaubt && (typeof w === 'string')) w = [w];
      else throw invalid('expected list' + ort);
    }
    if (def.laenge && w.length !== def.laenge) throw invalid('length of value must be exactly ' + def.laenge + ort);
    if (def.zahlen) {
      w = w.map(x => Number(x));
      if (w.some(x => isNaN(x))) throw invalid('expected float' + ort);
      if (def.min !== undefined && w.some(x => x < def.min)) throw invalid('value must be at least ' + def.min + ort);
      if (def.max !== undefined && w.some(x => x > def.max)) throw invalid('value must be at most ' + def.max + ort);
    }
  } else if (def.typ === 'objekt') {
    if (!w || typeof w !== 'object' || Array.isArray(w)) throw invalid('expected dict' + ort);
  }
  return w;
}

class Dienste {
  constructor(welt, sim) {
    this.welt = welt;
    this.sim = sim;
    this.tabelle = new Map();
    this.registriereAlle();
  }

  def(domain, service, opt) {
    this.tabelle.set(domain + '.' + service, Object.assign({ domain: domain, service: service, felder: {}, entitaet: false, antwort: 'nein' }, opt));
  }

  // get_services: { domain: { service: { name, description, fields, target?, response? } } }
  liste() {
    const aus = {};
    for (const d of this.tabelle.values()) {
      if (!aus[d.domain]) aus[d.domain] = {};
      const fields = {};
      for (const k of Object.keys(d.felder)) {
        const fd = d.felder[k];
        const selektor = fd.typ === 'zahl' || fd.typ === 'ganz' ? { number: { min: fd.min, max: fd.max } } :
          (fd.typ === 'bool' ? { boolean: {} } : (fd.werte ? { select: { options: fd.werte } } : (fd.typ === 'objekt' ? { object: {} } : { text: {} })));
        fields[k] = { required: !!fd.pflicht, selector: selektor };
        if (fd.beispiel !== undefined) fields[k].example = fd.beispiel;
      }
      const eintrag = { name: d.name || d.service.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), description: d.beschreibung || '', fields: fields };
      if (d.entitaet) eintrag.target = { entity: [{ domain: d.domains || [d.domain] }] };
      if (d.antwort !== 'nein') eintrag.response = { optional: d.antwort === 'optional' };
      aus[d.domain][d.service] = eintrag;
    }
    return aus;
  }

  hatDienst(domain, service) {
    return this.tabelle.has(domain + '.' + service);
  }

  pruefe(def, daten) {
    if (def.frei) return daten;
    const aus = {};
    for (const k of Object.keys(daten)) {
      if (ZIEL_FELDER.indexOf(k) !== -1) {
        if (!def.entitaet && !def.zielErlaubt) throw invalid("extra keys not allowed @ data['" + k + "']");
        aus[k] = daten[k];
        continue;
      }
      const fd = def.felder[k];
      if (!fd) throw invalid("extra keys not allowed @ data['" + k + "']");
      aus[k] = pruefeWert(k, daten[k], fd);
    }
    for (const k of Object.keys(def.felder)) {
      if (def.felder[k].pflicht && aus[k] === undefined) throw invalid("required key not provided @ data['" + k + "']");
    }
    for (const gruppe of (def.exklusiv || [])) {
      const vorhanden = gruppe.felder.filter(k => aus[k] !== undefined);
      if (vorhanden.length > 1) throw invalid("two or more values in the same group of exclusion '" + gruppe.name + "' @ data[<" + gruppe.name + '>]');
    }
    if (def.mindestensEins && !def.mindestensEins.some(k => aus[k] !== undefined)) {
      throw invalid('must contain at least one of ' + def.mindestensEins.join(', ') + '.');
    }
    return aus;
  }

  /*
   * Service aufrufen. daten = service_data, ziel = target ({entity_id|device_id|area_id…}).
   * optionen: { kontext, benutzer, returnResponse, ohneEreignis }
   * Rückgabe: { kontext, antwort }
   */
  async aufrufen(domain, service, daten, ziel, optionen) {
    const opt = optionen || {};
    domain = String(domain || '').toLowerCase();
    service = String(service || '').toLowerCase();
    const def = this.tabelle.get(domain + '.' + service);
    if (!def) {
      throw new HAFehler('not_found', 'Action ' + domain + '.' + service + ' not found.', {
        translation_key: 'service_not_found', translation_placeholders: { domain: domain, service: service }, translation_domain: 'homeassistant'
      });
    }
    const kontext = opt.kontext || this.welt.kontext(null, opt.benutzer || null);
    if (!opt.kontext && this.sim.merkeKontext) {
      this.sim.merkeKontext(kontext.id, { context_event_type: 'call_service', context_domain: domain, context_service: service });
    }
    if (daten !== undefined && daten !== null && (typeof daten !== 'object' || Array.isArray(daten))) throw invalid('expected dict for dictionary value @ data');
    const alle = Object.assign({}, daten || {});
    if (ziel && typeof ziel === 'object') {
      for (const k of ZIEL_FELDER) if (ziel[k] !== undefined) alle[k] = ziel[k];
    }
    const geprueft = this.pruefe(def, alle);
    if (opt.returnResponse && def.antwort === 'nein') {
      throw new HAFehler('service_validation_error', "An action which does not return responses can't be called with return_response=True", {
        translation_key: 'service_does_not_support_response', translation_placeholders: { return_response: 'return_response=True' }, translation_domain: 'homeassistant'
      });
    }
    if (!opt.returnResponse && def.antwort === 'nur') {
      throw new HAFehler('service_validation_error', 'The action requires responses and must be called with return_response=True', {
        translation_key: 'service_lacks_response_request', translation_placeholders: { return_response: 'return_response=True' }, translation_domain: 'homeassistant'
      });
    }
    if (!opt.ohneEreignis) this.welt.feuere('call_service', { domain: domain, service: service, service_data: alle }, kontext);
    let ids = null;
    let explizit = null;
    if (def.entitaet) {
      const r = this.welt.loeseZielAuf(geprueft, def.domains === null ? null : (def.domains || [domain]));
      explizit = r.explizit;
      ids = r.ids.filter(id => {
        const s = this.welt.zustand(id);
        return s && s.state !== 'unavailable';
      });
      if (def.benoetigt) ids = this.pruefeFeatures(ids, explizit, def);
    }
    const nurDaten = {};
    for (const k of Object.keys(geprueft)) if (ZIEL_FELDER.indexOf(k) === -1 || def.frei) nurDaten[k] = geprueft[k];
    const antwort = await def.aus({ daten: nurDaten, alleDaten: geprueft, ids: ids, explizit: explizit, kontext: kontext, returnResponse: !!opt.returnResponse, domain: domain, service: service });
    return { kontext: kontext, antwort: opt.returnResponse ? (antwort === undefined ? null : antwort) : null };
  }

  // Wie ServiceNotSupported: explizit genannte Entitäten ohne passendes Feature → Fehler, sonst still überspringen
  pruefeFeatures(ids, explizit, def) {
    const ok = [];
    for (const id of ids) {
      const s = this.welt.zustand(id);
      const features = s.attributes.supported_features || 0;
      if (features & def.benoetigt) {
        ok.push(id);
      } else if (explizit.has(id)) {
        throw new HAFehler('service_validation_error', 'Entity ' + id + ' does not support action ' + def.domain + '.' + def.service, {
          translation_key: 'service_not_supported', translation_placeholders: { entity_id: id, domain: def.domain, service: def.service }, translation_domain: 'homeassistant'
        });
      }
    }
    return ok;
  }

  registriereAlle() {
    const sim = this.sim;
    const welt = this.welt;
    const MP = sim.h.MP;

    // ── light ──
    const lichtFelder = {
      transition: f('zahl', { min: 0, max: 6553 }), brightness: f('ganz', { min: 0, max: 255 }), brightness_pct: f('zahl', { min: 0, max: 100 }),
      brightness_step: f('ganz', { min: -255, max: 255 }), brightness_step_pct: f('zahl', { min: -100, max: 100 }),
      color_temp_kelvin: f('ganz', { min: 1 }), hs_color: f('liste', { laenge: 2, zahlen: true }), rgb_color: f('liste', { laenge: 3, zahlen: true, min: 0, max: 255 }),
      xy_color: f('liste', { laenge: 2, zahlen: true, min: 0, max: 1 }), color_name: f('text'), effect: f('text'), flash: f('text', { werte: ['short', 'long'] }),
      profile: f('text'), white: f('ganz', { min: 0, max: 255 })
    };
    const lichtExklusiv = [
      { name: 'Color descriptors', felder: ['color_temp_kelvin', 'hs_color', 'rgb_color', 'xy_color', 'color_name', 'profile', 'white'] },
      { name: 'brightness', felder: ['brightness', 'brightness_pct', 'brightness_step', 'brightness_step_pct'] }
    ];
    const pruefeFarbname = a => {
      if (a.daten.color_name !== undefined && !require('./farben').FARBNAMEN[a.daten.color_name]) throw invalid('Invalid color name');
    };
    this.def('light', 'turn_on', { entitaet: true, felder: lichtFelder, exklusiv: lichtExklusiv, aus: a => { pruefeFarbname(a); sim.lichtDienst(a.ids, 'an', a.daten, a.kontext); } });
    this.def('light', 'turn_off', { entitaet: true, felder: { transition: lichtFelder.transition, flash: lichtFelder.flash }, aus: a => sim.lichtDienst(a.ids, 'aus', {}, a.kontext) });
    this.def('light', 'toggle', { entitaet: true, felder: lichtFelder, exklusiv: lichtExklusiv, aus: a => { pruefeFarbname(a); sim.lichtDienst(a.ids, 'toggle', a.daten, a.kontext); } });

    // ── switch / input_boolean / remote / number / select ──
    for (const domain of ['switch', 'input_boolean']) {
      this.def(domain, 'turn_on', { entitaet: true, aus: a => a.ids.forEach(id => sim.schalterSetzen(id, true, a.kontext)) });
      this.def(domain, 'turn_off', { entitaet: true, aus: a => a.ids.forEach(id => sim.schalterSetzen(id, false, a.kontext)) });
      this.def(domain, 'toggle', { entitaet: true, aus: a => a.ids.forEach(id => sim.schalterSetzen(id, welt.zustand(id).state !== 'on', a.kontext)) });
    }
    this.def('input_boolean', 'reload', { aus: () => null });
    // ── input_datetime (Helfer, z. B. Wecklicht der Tafel) ──
    this.def('input_datetime', 'set_datetime', {
      entitaet: true,
      felder: { datetime: f('text'), date: f('text'), time: f('text'), timestamp: f('zahl') },
      aus: a => a.ids.forEach(id => {
        const alt = welt.zustand(id);
        let text = a.daten.datetime;
        if (!text && a.daten.date) text = a.daten.date + ' ' + (a.daten.time || '00:00:00');
        if (!text && a.daten.timestamp !== undefined) {
          const d = new Date(a.daten.timestamp * 1000);
          const t = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d);
          text = t.replace(',', '');
        }
        const w = require('./zusatz-yaml.js').datetimeAttribute(text, alt ? alt.attributes : {});
        if (!w) throw invalid('Invalid datetime specified: ' + text + " for dictionary value @ data['datetime']");
        welt.setze(id, w.state, w.attributes, a.kontext);
      })
    });
    this.def('input_datetime', 'reload', { aus: () => null });
    const fernbedienungMedien = id => {
      for (const [mid, rid] of sim.remoteVonMedien) if (rid === id) return mid;
      return null;
    };
    this.def('remote', 'turn_on', { entitaet: true, felder: { activity: f('text') }, aus: a => a.ids.forEach(id => { const m = fernbedienungMedien(id); if (m) sim.medienAktion(m, 'turn_on', {}, a.kontext); }) });
    this.def('remote', 'turn_off', { entitaet: true, felder: { activity: f('text') }, aus: a => a.ids.forEach(id => { const m = fernbedienungMedien(id); if (m) sim.medienAktion(m, 'turn_off', {}, a.kontext); }) });
    this.def('remote', 'toggle', { entitaet: true, aus: a => a.ids.forEach(id => { const m = fernbedienungMedien(id); if (m) sim.medienAktion(m, 'toggle', {}, a.kontext); }) });
    this.def('remote', 'send_command', { entitaet: true, felder: { command: f('beliebig', { pflicht: true }), device: f('text'), num_repeats: f('ganz'), delay_secs: f('zahl'), hold_secs: f('zahl') }, aus: () => null });
    this.def('number', 'set_value', {
      entitaet: true, felder: { value: f('zahl', { pflicht: true }) },
      aus: a => a.ids.forEach(id => {
        const s = welt.zustand(id);
        if (a.daten.value < s.attributes.min || a.daten.value > s.attributes.max) {
          throw new HAFehler('service_validation_error', 'Value ' + a.daten.value + ' for ' + id + ' is outside valid range ' + s.attributes.min + ' - ' + s.attributes.max);
        }
        welt.setze(id, String(a.daten.value), s.attributes, a.kontext);
      })
    });
    const auswahl = (a, wahl) => a.ids.forEach(id => {
      const s = welt.zustand(id);
      const optionen = s.attributes.options || [];
      const option = wahl(optionen, s.state);
      if (optionen.indexOf(option) === -1) {
        throw new HAFehler('service_validation_error', 'Option ' + option + ' is not valid for ' + id + '. Valid options are: ' + optionen.join(', '), {
          translation_key: 'not_valid_option', translation_domain: 'select', translation_placeholders: { entity_id: id, option: option, options: optionen.join(', ') }
        });
      }
      if (!sim.szeneWaehlen(id, option, a.kontext)) welt.setze(id, option, s.attributes, a.kontext);
    });
    this.def('select', 'select_option', { entitaet: true, felder: { option: f('text', { pflicht: true }) }, aus: a => auswahl(a, () => a.daten.option) });
    this.def('select', 'select_first', { entitaet: true, aus: a => auswahl(a, o => o[0]) });
    this.def('select', 'select_last', { entitaet: true, aus: a => auswahl(a, o => o[o.length - 1]) });
    this.def('select', 'select_next', { entitaet: true, felder: { cycle: f('bool') }, aus: a => auswahl(a, (o, s) => o[Math.min(o.length - 1, o.indexOf(s) + 1)] || o[0]) });
    this.def('select', 'select_previous', { entitaet: true, felder: { cycle: f('bool') }, aus: a => auswahl(a, (o, s) => o[Math.max(0, o.indexOf(s) - 1)] || o[0]) });

    // ── scene / hue ──
    this.def('scene', 'turn_on', {
      entitaet: true, felder: { transition: f('zahl', { min: 0, max: 6553 }) },
      aus: a => a.ids.forEach(id => this.szeneEinschalten(id, a.kontext, {}))
    });
    this.def('scene', 'apply', {
      felder: { entities: f('objekt', { pflicht: true }), transition: f('zahl', { min: 0, max: 6553 }) },
      aus: a => sim.reproduziere(this.szenenZiele(a.daten.entities), a.kontext)
    });
    this.def('scene', 'create', {
      felder: { scene_id: f('text', { pflicht: true }), entities: f('objekt'), snapshot_entities: f('liste', { einzelnErlaubt: true }) },
      mindestensEins: ['entities', 'snapshot_entities'],
      aus: a => this.szeneErstellen(a.daten, a.kontext)
    });
    this.def('scene', 'delete', {
      entitaet: true,
      aus: a => a.ids.forEach(id => {
        if (!sim.erstellteSzenen.has(id)) {
          throw new HAFehler('service_validation_error', 'The scene ' + id + ' is not created with action `scene.create`', {
            translation_key: 'entity_not_dynamically_created', translation_domain: 'homeassistant', translation_placeholders: { entity_id: id }
          });
        }
        sim.erstellteSzenen.delete(id);
        welt.entferne(id, a.kontext);
      })
    });
    this.def('scene', 'reload', { aus: () => null });
    this.def('hue', 'activate_scene', {
      entitaet: true, domains: ['scene'],
      felder: { transition: f('zahl', { min: 0, max: 3600 }), dynamic: f('bool'), speed: f('zahl', { min: 0, max: 100 }), brightness: f('zahl', { min: 1, max: 255 }) },
      aus: a => a.ids.forEach(id => {
        if (!sim.szenen.has(id)) return;
        sim.szeneAktivieren(id, a.kontext, { dynamic: a.daten.dynamic, brightness: a.daten.brightness });
      })
    });

    // ── climate ──
    const heizungen = a => a.ids.filter(id => sim.heizungen.has(id));
    const pruefeModus = (id, modus) => {
      const modi = welt.zustand(id).attributes.hvac_modes;
      if (modi.indexOf(modus) === -1) {
        throw new HAFehler('service_validation_error', 'HVAC mode ' + modus + ' is not valid. Valid HVAC modes are: ' + modi.join(', '), {
          translation_key: 'not_valid_hvac_mode', translation_domain: 'climate', translation_placeholders: { mode: modus, modes: modi.join(', ') }
        });
      }
    };
    this.def('climate', 'set_temperature', {
      entitaet: true,
      felder: { temperature: f('zahl'), target_temp_high: f('zahl'), target_temp_low: f('zahl'), hvac_mode: f('text') },
      mindestensEins: ['temperature', 'target_temp_high', 'target_temp_low'],
      aus: a => heizungen(a).forEach(id => {
        const s = welt.zustand(id).attributes;
        const t = a.daten.temperature;
        if (t === undefined) {
          throw new HAFehler('service_validation_error', 'Set temperature action was used with the target temperature low/high parameter but the entity does not support it', {
            translation_key: 'missing_target_temperature_range_entity_feature', translation_domain: 'climate'
          });
        }
        if (t < s.min_temp || t > s.max_temp) {
          throw new HAFehler('service_validation_error', 'Provided temperature ' + t.toFixed(1) + ' is not valid. Accepted range is ' + s.min_temp + ' to ' + s.max_temp + '.', {
            translation_key: 'temp_out_of_range', translation_domain: 'climate',
            translation_placeholders: { check_temp: String(t), min_temp: String(s.min_temp), max_temp: String(s.max_temp) }
          });
        }
        if (a.daten.hvac_mode !== undefined) pruefeModus(id, a.daten.hvac_mode);
        sim.heizungSetzen(id, { soll: Math.round(t * 2) / 2, modus: a.daten.hvac_mode }, a.kontext);
      })
    });
    this.def('climate', 'set_hvac_mode', {
      entitaet: true, felder: { hvac_mode: f('text', { pflicht: true }) },
      aus: a => heizungen(a).forEach(id => { pruefeModus(id, a.daten.hvac_mode); sim.heizungSetzen(id, { modus: a.daten.hvac_mode }, a.kontext); })
    });
    this.def('climate', 'set_preset_mode', {
      entitaet: true, felder: { preset_mode: f('text', { pflicht: true }) },
      aus: a => heizungen(a).forEach(id => {
        const presets = welt.zustand(id).attributes.preset_modes;
        if (presets.indexOf(a.daten.preset_mode) === -1) {
          throw new HAFehler('service_validation_error', 'Preset mode ' + a.daten.preset_mode + ' is not valid. Valid preset modes are: ' + presets.join(', '), {
            translation_key: 'not_valid_preset_mode', translation_domain: 'climate', translation_placeholders: { mode: a.daten.preset_mode, modes: presets.join(', ') }
          });
        }
        sim.heizungSetzen(id, { preset: a.daten.preset_mode }, a.kontext);
      })
    });
    this.def('climate', 'turn_on', { entitaet: true, aus: a => heizungen(a).forEach(id => { if (sim.heizungen.get(id).modus === 'off') sim.heizungSetzen(id, { modus: 'heat' }, a.kontext); }) });
    this.def('climate', 'turn_off', { entitaet: true, aus: a => heizungen(a).forEach(id => sim.heizungSetzen(id, { modus: 'off' }, a.kontext)) });
    this.def('climate', 'toggle', { entitaet: true, aus: a => heizungen(a).forEach(id => sim.heizungSetzen(id, { modus: sim.heizungen.get(id).modus === 'off' ? 'heat' : 'off' }, a.kontext)) });

    // ── media_player ──
    const medien = (service, benoetigt, felder, extra) => {
      this.def('media_player', service, Object.assign({
        entitaet: true, benoetigt: benoetigt, felder: felder || {},
        aus: a => a.ids.forEach(id => sim.medienAktion(id, service, a.daten, a.kontext))
      }, extra || {}));
    };
    medien('turn_on', MP.TURN_ON);
    medien('turn_off', MP.TURN_OFF);
    medien('toggle', MP.TURN_ON | MP.TURN_OFF);
    medien('volume_up', MP.VOLUME_SET | MP.VOLUME_STEP);
    medien('volume_down', MP.VOLUME_SET | MP.VOLUME_STEP);
    medien('volume_set', MP.VOLUME_SET, { volume_level: f('zahl', { pflicht: true, min: 0, max: 1 }) });
    medien('volume_mute', MP.VOLUME_MUTE, { is_volume_muted: f('bool', { pflicht: true }) });
    medien('media_play_pause', MP.PLAY | MP.PAUSE);
    medien('media_play', MP.PLAY);
    medien('media_pause', MP.PAUSE);
    medien('media_stop', MP.STOP);
    medien('media_next_track', MP.NEXT_TRACK);
    medien('media_previous_track', MP.PREVIOUS_TRACK);
    medien('media_seek', MP.SEEK, { seek_position: f('zahl', { pflicht: true, min: 0 }) });
    medien('play_media', MP.PLAY_MEDIA, {
      media_content_id: f('text'), media_content_type: f('text'), media: f('objekt'), enqueue: f('text', { werte: ['add', 'next', 'play', 'replace'] }), announce: f('bool'), extra: f('objekt')
    }, {
      aus: a => {
        const d = Object.assign({}, a.daten);
        if (d.media) {
          d.media_content_id = d.media.media_content_id;
          d.media_content_type = d.media.media_content_type;
        }
        if (d.media_content_id === undefined) throw invalid("required key not provided @ data['media_content_id']");
        if (d.media_content_type === undefined) throw invalid("required key not provided @ data['media_content_type']");
        a.ids.forEach(id => sim.medienAktion(id, 'play_media', d, a.kontext));
      }
    });
    medien('select_source', MP.SELECT_SOURCE, { source: f('text', { pflicht: true }) }, {
      aus: a => a.ids.forEach(id => {
        const quellen = welt.zustand(id).attributes.source_list || [];
        if (quellen.indexOf(a.daten.source) === -1) {
          throw new HAFehler('service_validation_error', 'Source ' + a.daten.source + ' is not available for ' + id + '. Valid sources are: ' + quellen.join(', '));
        }
        sim.medienAktion(id, 'select_source', a.daten, a.kontext);
      })
    });
    medien('shuffle_set', MP.SHUFFLE_SET, { shuffle: f('bool', { pflicht: true }) });
    medien('repeat_set', MP.REPEAT_SET, { repeat: f('text', { pflicht: true, werte: ['off', 'all', 'one'] }) });
    medien('clear_playlist', MP.CLEAR_PLAYLIST);
    medien('join', MP.GROUPING, { group_members: f('liste', { pflicht: true, einzelnErlaubt: true }) }, { aus: () => null });
    medien('unjoin', MP.GROUPING, {}, { aus: () => null });

    // ── vacuum ──
    const sauger = (service, felder, extra) => this.def('vacuum', service, Object.assign({
      entitaet: true, felder: felder || {}, aus: a => a.ids.forEach(() => sim.saugerAktion(service, a.daten, a.kontext))
    }, extra || {}));
    sauger('start');
    sauger('pause');
    sauger('stop');
    sauger('return_to_base');
    sauger('clean_spot');
    sauger('locate', {}, { aus: () => null });
    sauger('set_fan_speed', { fan_speed: f('text', { pflicht: true }) }, {
      aus: a => a.ids.forEach(id => {
        if (LUEFTER.indexOf(a.daten.fan_speed) === -1) {
          throw new HAFehler('service_validation_error', 'Fan speed ' + a.daten.fan_speed + ' is not valid. Valid fan speeds are: ' + LUEFTER.join(', '));
        }
        sim.saugerAktion('set_fan_speed', a.daten, a.kontext);
      })
    });
    sauger('send_command', { command: f('text', { pflicht: true }), params: f('beliebig') }, { aus: () => null });

    // ── script ──
    this.def('script', 'turn_on', {
      entitaet: true, felder: { variables: f('objekt') },
      aus: a => { a.ids.forEach(id => { sim.skriptStarten(id, a.kontext); }); }
    });
    this.def('script', 'turn_off', { entitaet: true, aus: () => null });
    this.def('script', 'toggle', { entitaet: true, aus: a => { a.ids.forEach(id => { if (welt.zustand(id).state === 'off') sim.skriptStarten(id, a.kontext); }); } });
    this.def('script', 'reload', { aus: () => null });
    for (const id of Object.keys(sim.h.SKRIPTE || {})) {
      if (!sim.ids.has(id)) continue;
      const objekt = id.split('.')[1];
      // Direktaufruf script.<name>: wartet bis zum Ende (wie HA), Antwort optional
      this.def('script', objekt, { frei: true, antwort: 'optional', aus: a => sim.skriptStarten(id, a.kontext).then(() => (a.returnResponse ? {} : null)) });
    }

    // ── automation ──
    this.def('automation', 'turn_on', { entitaet: true, aus: a => a.ids.forEach(id => sim.einfachSchalten(id, true, a.kontext)) });
    this.def('automation', 'turn_off', { entitaet: true, felder: { stop_actions: f('bool') }, aus: a => a.ids.forEach(id => sim.einfachSchalten(id, false, a.kontext)) });
    this.def('automation', 'toggle', { entitaet: true, aus: a => a.ids.forEach(id => sim.einfachSchalten(id, welt.zustand(id).state !== 'on', a.kontext)) });
    this.def('automation', 'trigger', {
      entitaet: true, felder: { skip_condition: f('bool') },
      aus: a => a.ids.forEach(id => sim.automationAusloesen(id, a.kontext, a.daten.skip_condition !== false, 'action automation.trigger'))
    });
    this.def('automation', 'reload', { aus: () => null });

    // ── todo ──
    const todoListe = id => sim.todos.get(id) || [];
    const nichtGefunden = item => new HAFehler('service_validation_error', 'Unable to find To-do item: ' + item, {
      translation_key: 'item_not_found', translation_domain: 'todo', translation_placeholders: { item: item }
    });
    this.def('todo', 'add_item', {
      entitaet: true, felder: { item: f('text', { pflicht: true }), due_date: f('text'), due_datetime: f('text'), description: f('text') },
      aus: a => a.ids.forEach(id => {
        if (!a.daten.item.trim()) throw invalid("length of value must be at least 1 for dictionary value @ data['item']");
        todoListe(id).push({ summary: a.daten.item, uid: hexId(id + jetzt() + Math.random()), status: 'needs_action' });
        sim.schreibeTodo(id, a.kontext);
      })
    });
    this.def('todo', 'update_item', {
      entitaet: true, felder: { item: f('text', { pflicht: true }), rename: f('text'), status: f('text', { werte: ['needs_action', 'completed'] }), due_date: f('text'), due_datetime: f('text'), description: f('text') },
      mindestensEins: ['rename', 'status', 'due_date', 'due_datetime', 'description'],
      aus: a => a.ids.forEach(id => {
        const eintrag = sim.todoEintrag(id, a.daten.item);
        if (!eintrag) throw nichtGefunden(a.daten.item);
        if (a.daten.rename !== undefined) eintrag.summary = a.daten.rename;
        if (a.daten.status !== undefined) eintrag.status = a.daten.status;
        sim.schreibeTodo(id, a.kontext);
      })
    });
    this.def('todo', 'remove_item', {
      entitaet: true, felder: { item: f('liste', { pflicht: true, einzelnErlaubt: true }) },
      aus: a => a.ids.forEach(id => {
        const items = todoListe(id);
        const weg = a.daten.item.map(x => {
          const e = sim.todoEintrag(id, x);
          if (!e) throw nichtGefunden(x);
          return e;
        });
        sim.todos.set(id, items.filter(i => weg.indexOf(i) === -1));
        sim.schreibeTodo(id, a.kontext);
      })
    });
    this.def('todo', 'remove_completed_items', {
      entitaet: true,
      aus: a => a.ids.forEach(id => { sim.todos.set(id, todoListe(id).filter(i => i.status !== 'completed')); sim.schreibeTodo(id, a.kontext); })
    });
    this.def('todo', 'get_items', {
      entitaet: true, antwort: 'nur', felder: { status: f('liste', { einzelnErlaubt: true }) },
      aus: a => {
        const aus = {};
        a.ids.forEach(id => {
          const status = a.daten.status || ['needs_action', 'completed'];
          aus[id] = { items: todoListe(id).filter(i => status.indexOf(i.status) !== -1).map(i => Object.assign({}, i)) };
        });
        return aus;
      }
    });

    // ── weather ──
    this.def('weather', 'get_forecasts', {
      entitaet: true, antwort: 'nur', felder: { type: f('text', { pflicht: true, werte: ['daily', 'hourly', 'twice_daily'] }) },
      aus: a => {
        const aus = {};
        a.ids.forEach(id => { aus[id] = { forecast: sim.wettervorhersage(id, a.daten.type) }; });
        return aus;
      }
    });

    // ── notify / persistent_notification / tts / update / homeassistant ──
    this.def('notify', 'send_message', { entitaet: true, felder: { message: f('text', { pflicht: true }), title: f('text') }, aus: () => null });
    this.def('notify', 'notify', { felder: { message: f('text', { pflicht: true }), title: f('text'), target: f('beliebig'), data: f('beliebig') }, aus: () => null });
    this.def('persistent_notification', 'create', {
      felder: { message: f('text', { pflicht: true }), title: f('text'), notification_id: f('text') },
      aus: a => { welt.feuere('persistent_notifications_updated', {}, a.kontext); }
    });
    this.def('persistent_notification', 'dismiss', { felder: { notification_id: f('text', { pflicht: true }) }, aus: () => null });
    this.def('persistent_notification', 'dismiss_all', { aus: () => null });
    this.def('tts', 'speak', {
      entitaet: true, felder: { media_player_entity_id: f('liste', { pflicht: true, einzelnErlaubt: true }), message: f('text', { pflicht: true }), cache: f('bool'), language: f('text'), options: f('objekt') },
      aus: () => null
    });
    this.def('update', 'install', { entitaet: true, felder: { version: f('text'), backup: f('bool') }, aus: () => null });
    this.def('update', 'skip', { entitaet: true, aus: () => null });
    this.def('homeassistant', 'update_entity', { entitaet: true, domains: null, aus: () => null });
    this.def('homeassistant', 'reload_all', { aus: () => null });
    this.def('homeassistant', 'check_config', { aus: () => null });
    for (const service of ['turn_on', 'turn_off', 'toggle']) {
      this.def('homeassistant', service, {
        entitaet: true, domains: null,
        aus: async a => {
          // wie HA: nach Domain gruppieren und <domain>.<service> aufrufen (nur Domains, die das können)
          const nachDomain = {};
          for (const id of a.ids) {
            const d = id.split('.')[0];
            if (d === 'homeassistant' || d === 'group') continue;
            if (!this.hatDienst(d, service)) continue;
            (nachDomain[d] = nachDomain[d] || []).push(id);
          }
          for (const d of Object.keys(nachDomain)) {
            const def = this.tabelle.get(d + '.' + service);
            if (!def.entitaet) continue;
            let ids = nachDomain[d];
            if (def.benoetigt) ids = ids.filter(id => (welt.zustand(id).attributes.supported_features || 0) & def.benoetigt);
            if (!ids.length) continue;
            await this.aufrufen(d, service, { entity_id: ids }, null, { kontext: a.kontext });
          }
        }
      });
    }
  }

  szenenZiele(entities) {
    const ziele = {};
    for (const id of Object.keys(entities || {})) {
      const v = entities[id];
      if (v && typeof v === 'object') {
        const attrs = Object.assign({}, v);
        delete attrs.state;
        ziele[id] = { state: String(v.state), attributes: attrs };
      } else {
        ziele[id] = { state: String(v), attributes: {} };
      }
    }
    return ziele;
  }

  szeneEinschalten(id, kontext, opt) {
    const sim = this.sim;
    if (sim.szenen.has(id)) return sim.szeneAktivieren(id, kontext, opt);
    let ziele = sim.erstellteSzenen.get(id) || null;
    if (!ziele) {
      const e = sim.h.ENTITAETEN.find(x => x.entity_id === id && x.art === 'szene_ha');
      if (e) ziele = this.szenenZiele(e.modell.entities);
    }
    if (!ziele) return false;
    sim.reproduziere(ziele, kontext);
    const s = this.welt.zustand(id);
    this.welt.setze(id, iso(jetzt()), s ? s.attributes : {}, kontext);
    return true;
  }

  // scene.create: neue Szene aus entities/snapshot_entities (überschreibt nur selbst erstellte)
  szeneErstellen(d, kontext) {
    if (!/^[a-z0-9_]+$/.test(d.scene_id)) throw invalid("invalid slug " + d.scene_id + " (try " + d.scene_id.toLowerCase().replace(/[^a-z0-9]+/g, '_') + ") for dictionary value @ data['scene_id']");
    const id = 'scene.' + d.scene_id;
    const vorhanden = this.welt.zustand(id);
    if (vorhanden && !this.sim.erstellteSzenen.has(id)) {
      this.sim.log('scene.create: ' + id + ' existiert bereits und wurde nicht per scene.create angelegt – ignoriert (wie HA)');
      return;
    }
    const ziele = this.szenenZiele(d.entities);
    for (const eid of (d.snapshot_entities || [])) {
      const s = this.welt.zustand(eid);
      if (!s) {
        this.sim.log('scene.create: ' + eid + ' existiert nicht');
        continue;
      }
      ziele[eid] = { state: s.state, attributes: JSON.parse(JSON.stringify(s.attributes)) };
    }
    this.sim.erstellteSzenen.set(id, ziele);
    this.welt.setze(id, vorhanden ? vorhanden.state : 'unknown', { entity_id: Object.keys(ziele), friendly_name: d.scene_id }, kontext);
  }
}

module.exports = { Dienste, HAFehler };
