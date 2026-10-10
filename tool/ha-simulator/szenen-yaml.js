'use strict';
/*
 * Szenen aus einer HA-scenes.yaml laden (HA_SIM_SZENEN=pfad) – wie die
 * Szenen-Integration von Home Assistant:
 *  - entity_id = "scene." + slugify(name) (Umlaute ohne Punkte: "Büro" → "buro")
 *  - Zustand = Zeitpunkt der letzten Aktivierung, Attribute entity_id/id/icon
 *  - kein Bereich, solange Julian die Szene in HA keinem zuordnet;
 *    HA_SIM_SZENEN_BEREICH=1 ordnet sie wie in der HA-Oberfläche einem
 *    Bereich zu (über den Namensanfang "Wohnzimmer · …").
 * Die Datei selbst ist privat (ha-vorschlag/ ist gitignored).
 */
const fs = require('fs');
const { parseYaml } = require('./yaml.js');

// python-slugify (HA util.slugify): Akzente weg, ß → ss, Rest → "_"
function haSlug(text) {
  return String(text).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function ladeSzenenYaml(H, pfad, mitBereich, log) {
  let liste;
  try {
    liste = parseYaml(fs.readFileSync(pfad, 'utf8')) || [];
  } catch (err) {
    log('Szenen-Datei nicht lesbar: ' + err.message);
    return 0;
  }
  if (!Array.isArray(liste)) {
    log('Szenen-Datei: oberste Ebene ist keine Liste – ignoriert');
    return 0;
  }
  const ids = new Set();
  let n = 0;
  for (const s of liste) {
    if (!s || !s.name || !s.entities || typeof s.entities !== 'object') {
      log('Szenen-Datei: Eintrag ohne name/entities übersprungen');
      continue;
    }
    if (s.id !== undefined && ids.has(String(s.id))) {
      log('Szenen-Datei: doppelte id ' + s.id + ' – übersprungen (wie HA)');
      continue;
    }
    if (s.id !== undefined) ids.add(String(s.id));
    let eid = 'scene.' + haSlug(s.name);
    for (let i = 2; H.ENTITAETEN.find(e => e.entity_id === eid); i++) eid = 'scene.' + haSlug(s.name) + '_' + i;
    let bereich = null;
    if (mitBereich) {
      const name = String(s.name);
      const b = H.BEREICHE.find(x => name.toLowerCase().indexOf(x.name.toLowerCase()) === 0 && /^[\s·:\-–]/.test(name.slice(x.name.length)));
      bereich = b ? b.id : null;
    }
    H.ENTITAETEN.push({
      entity_id: eid, geraet: null, name: String(s.name), art: 'szene_ha', plattform: 'homeassistant',
      unique_id: s.id !== undefined ? String(s.id) : null, bereich: bereich,
      modell: { id: s.id !== undefined ? String(s.id) : null, entities: s.entities, icon: s.icon || null }
    });
    n++;
  }
  log('Szenen-Datei: ' + n + ' Szenen geladen' + (mitBereich ? ' (mit Bereich)' : ' (ohne Bereich)'));
  return n;
}

module.exports = { ladeSzenenYaml, haSlug };
