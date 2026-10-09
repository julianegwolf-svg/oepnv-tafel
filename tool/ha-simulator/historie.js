'use strict';
/*
 * Verlauf: erzeugt plausible 24-h-Kurven für Temperatur/Feuchte beim Start
 * und beantwortet history/history_during_period im kompakten HA-Format.
 */
const { ortsStunde, rauschen, zufall } = require('./werkzeuge');

// Domains, bei denen HA auch reine Attribut-Änderungen als signifikant zählt
// bzw. bei minimal_response trotzdem volle Einträge liefert (recorder/history)
const SIGNIFIKANTE_DOMAINS = new Set(['climate', 'device_tracker', 'humidifier', 'thermostat', 'water_heater']);
const BRAUCHT_ATTRIBUTE = new Set(['climate', 'humidifier', 'input_datetime', 'thermostat', 'water_heater']);

// Abstand (Stunden) zu einem Tageszeitpunkt, -12..+12
function abstand(h, ziel) {
  let d = h - ziel;
  while (d < -12) d += 24;
  while (d >= 12) d -= 24;
  return d;
}

// Duschspitze: steiler Anstieg (12 min), dann exponentieller Abfall
function spitze(d) {
  if (d < 0) return 0;
  if (d < 0.2) return d / 0.2;
  return Math.exp(-(d - 0.2) / 0.5);
}

// Besonderheiten je Raum (Feuchte bzw. Temperatur)
function besonderheit(art, groesse, h) {
  if (art === 'dusche') {
    const s = spitze(abstand(h, 6.9)) + spitze(abstand(h, 21.5)) * 0.8;
    return groesse === 'feuchte' ? s * 28 : s * 1.2;
  }
  if (art === 'nachtfeuchte' && groesse === 'feuchte') {
    // ab 23 Uhr steigt die Feuchte (zwei Personen schlafen), ab 7 Uhr wird gelüftet
    if (h >= 23) return (h - 23) / 8 * 12;
    if (h < 7) return (h + 1) / 8 * 12;
    if (h < 12) return 12 * Math.exp(-(h - 7) / 0.7);
    return 0;
  }
  if (art === 'nachtfeuchte' && groesse === 'temp') {
    if (h >= 7.2 && h < 8) return -1.2; // Dachfenster morgens gekippt
    return 0;
  }
  return 0;
}

/*
 * Erzeugt Verlaufspunkte der letzten 24 h (etwa alle 10 min).
 * Die Kurve endet weich beim Startwert. Rückgabe: Liste {wert, t} (älteste zuerst).
 */
function erzeugeKurve(opt) {
  const ende = opt.ende;            // Zeitpunkt des Startwerts
  const schritte = 144;
  const roh = [];
  let walk = 0;
  for (let i = schritte; i >= 1; i--) {
    const t = ende - i * 600 + zufall(-50, 50);
    const h = ortsStunde(t);
    walk = walk * 0.85 + rauschen(opt.rauschen);
    let v = opt.basis + opt.amplitude * Math.cos(2 * Math.PI * (h - opt.spitzeStunde) / 24) + walk;
    v += besonderheit(opt.besonders, opt.groesse, h);
    roh.push({ t: t, v: v });
  }
  // sanft an den aktuellen Wert anschließen (Gewicht steigt zum Ende hin)
  const letzter = roh[roh.length - 1].v;
  const versatz = opt.endwert - letzter;
  return roh.map(p => {
    const alterStunden = (ende - p.t) / 3600;
    const w = Math.exp(-alterStunden / 3);
    let v = p.v + versatz * w;
    if (opt.min !== undefined) v = Math.max(opt.min, v);
    if (opt.max !== undefined) v = Math.min(opt.max, v);
    return { t: p.t, v: v };
  });
}

// Kompakter Eintrag wie row_to_compressed_state
function kompakt(e, startZeit, ohneAttribute) {
  const c = { s: e.s };
  if (!ohneAttribute) c.a = e.a;
  if (startZeit !== null && e.lu < startZeit) {
    c.lu = startZeit;
  } else {
    c.lu = e.lu;
    if (e.lc !== e.lu) c.lc = e.lc;
  }
  return c;
}

/*
 * history/history_during_period
 * p: { start, ende, ids, minimal, ohneAttribute, nurSignifikant, mitStartzustand }
 */
function abfrage(welt, p) {
  const ergebnis = {};
  for (const id of p.ids) {
    const liste = welt.historie.get(id);
    if (!liste || !liste.length) continue;
    const domain = id.split('.')[0];
    const attrSignifikant = SIGNIFIKANTE_DOMAINS.has(domain);
    const immerVoll = BRAUCHT_ATTRIBUTE.has(domain);
    let vorher = null;
    const auswahl = [];
    for (const e of liste) {
      if (e.lu < p.start) {
        if (!(p.nurSignifikant && e.nurAttr && !attrSignifikant)) vorher = e;
        continue;
      }
      if (e.lu > p.ende) break;
      if (p.nurSignifikant && e.nurAttr && !attrSignifikant) continue;
      auswahl.push(e);
    }
    const aus = [];
    let letzterZustand = null;
    if (p.mitStartzustand && vorher) {
      aus.push(kompakt(vorher, p.start, p.ohneAttribute));
      letzterZustand = vorher.s;
    }
    for (const e of auswahl) {
      if (aus.length === 0 || !p.minimal || immerVoll) {
        aus.push(kompakt(e, null, p.ohneAttribute));
      } else {
        if (e.s === letzterZustand) continue;
        aus.push({ s: e.s, lu: e.lu });
      }
      letzterZustand = e.s;
    }
    if (aus.length) ergebnis[id] = aus;
  }
  return ergebnis;
}

module.exports = { erzeugeKurve, abfrage };
