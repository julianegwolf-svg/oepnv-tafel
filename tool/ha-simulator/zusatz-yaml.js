'use strict';
/*
 * Zusätzliche Automationen und Helfer für Proben (Sitzung 7, Wecklicht):
 *   HA_SIM_AUTOMATIONEN=pfad   Liste wie automations.yaml – laufen wie
 *                              Julians eigene (entity_id aus dem alias)
 *   HA_SIM_HELFER=input_datetime.wecklicht,…   Helfer anlegen (Zustand
 *                              "unknown", bis jemand ihn setzt)
 */
const fs = require('fs');
const { parseYaml } = require('./yaml.js');
const { haSlug } = require('./szenen-yaml.js');

function ladeZusatz(H, opt, log) {
  H.AUTOMATIONEN = H.AUTOMATIONEN || {};
  if (opt.automationen) {
    let liste = [];
    try {
      liste = parseYaml(fs.readFileSync(opt.automationen, 'utf8')) || [];
    } catch (err) {
      log('Zusatz-Automationen nicht lesbar: ' + err.message);
    }
    for (const a of liste) {
      if (!a || !a.alias) continue;
      const id = 'automation.' + haSlug(a.alias);
      if (H.ENTITAETEN.find(e => e.entity_id === id)) continue;
      H.ENTITAETEN.push({ entity_id: id, geraet: null, name: a.alias, art: 'automation', plattform: 'automation', unique_id: String(a.id || id), modell: { an: true } });
      H.AUTOMATIONEN[id] = {
        id: String(a.id || ''), alias: a.alias, mode: a.mode || 'single',
        triggers: a.triggers || a.trigger || [], conditions: a.conditions || a.condition || [], actions: a.actions || a.action || []
      };
      log('Zusatz-Automation: ' + id);
    }
  }
  for (const id of String(opt.helfer || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const domain = id.split('.')[0];
    if (H.ENTITAETEN.find(e => e.entity_id === id)) continue;
    const name = id.split('.')[1].replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
    let attribute = { editable: true };
    if (domain === 'input_datetime') attribute = { has_date: true, has_time: true, editable: true };
    else if (domain === 'input_boolean') attribute = { editable: true };
    H.ENTITAETEN.push({
      entity_id: id, geraet: null, name: name, art: 'statisch', plattform: domain, unique_id: haSlug(id),
      start: { state: domain === 'input_boolean' ? 'off' : 'unknown', attributes: attribute }
    });
    log('Zusatz-Helfer: ' + id);
  }
}

// "2026-10-12 06:30:00" (Ortszeit Berlin) → Attribute wie HA
function datetimeAttribute(text, alt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(text || '').trim());
  if (!m) return null;
  const [j, mo, t, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] || '00'].map(Number);
  // Ortszeit → UTC: Versatz für genau diesen Zeitpunkt bestimmen
  const probe = Date.UTC(j, mo - 1, t, h, mi, s);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const teile = {};
  fmt.formatToParts(new Date(probe)).forEach(p => { teile[p.type] = p.value; });
  const alsOrt = Date.UTC(+teile.year, +teile.month - 1, +teile.day, +teile.hour % 24, +teile.minute, +teile.second);
  const utc = probe - (alsOrt - probe);
  const zwei = n => String(n).padStart(2, '0');
  return {
    state: j + '-' + zwei(mo) + '-' + zwei(t) + ' ' + zwei(h) + ':' + zwei(mi) + ':' + zwei(s),
    attributes: Object.assign({}, alt || {}, { has_date: true, has_time: true, editable: true, year: j, month: mo, day: t, hour: h, minute: mi, second: s, timestamp: utc / 1000 })
  };
}

module.exports = { ladeZusatz, datetimeAttribute };
