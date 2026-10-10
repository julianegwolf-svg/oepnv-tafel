// Musik-Charts als REST-Sensor, wie ihn HOME_ASSISTANT.md (Schritt 6)
// beschreibt: state = feed.updated, Attribut results = Apple-Music-Liste
// "Meistgespielt – Deutschland". Nur mit --charts / HA_SIM_CHARTS=1, weil
// Julians HA den Sensor erst hat, wenn er ihn anlegt.
// Daten: Aufnahme vom 10.10.2026 (charts-beispiel.json).
'use strict';
const path = require('path');
const fs = require('fs');

function sensor() {
  const feed = JSON.parse(fs.readFileSync(path.join(__dirname, 'charts-beispiel.json'), 'utf8'));
  return {
    entity_id: 'sensor.musik_charts', geraet: null, name: 'Musik Charts', art: 'statisch',
    plattform: 'rest', unique_id: 'tafel_musik_charts',
    start: { state: feed.updated, attributes: { results: feed.results, friendly_name: 'Musik Charts' } }
  };
}

module.exports = { sensor };
