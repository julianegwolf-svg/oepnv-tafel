'use strict';
/*
 * Kleine Hilfsfunktionen für den HA-Simulator:
 * Zeitstempel im HA-Format, IDs (ULID, Hex), Ortszeit Berlin, Zufall, Vergleiche.
 */
const crypto = require('crypto');

let letzteMikros = 0;

// Aktuelle Zeit als Unix-Sekunden (Float mit Mikrosekunden), streng monoton steigend.
function jetzt() {
  let m = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  if (m <= letzteMikros) m = letzteMikros + 1;
  letzteMikros = m;
  return m / 1e6;
}

// Unix-Sekunden → ISO wie HA: 2026-10-10T00:31:12.123456+00:00
function iso(sek) {
  const mikro = Math.round(sek * 1e6);
  const ms = Math.floor(mikro / 1000);
  const rest = mikro - ms * 1000;
  return new Date(ms).toISOString().slice(0, 23) + String(rest).padStart(3, '0') + '+00:00';
}

// Unix-Sekunden → ISO ohne Sekundenbruchteile (wie Timestamp-Sensoren): 2026-10-10T01:05:00+00:00
function isoSekunden(sek) {
  return new Date(Math.floor(sek) * 1000).toISOString().slice(0, 19) + '+00:00';
}

// ISO-Text → Unix-Sekunden (oder null). Ohne Zeitzone gilt die lokale Zeit (wie HA mit time_zone).
function parseZeit(text) {
  if (typeof text !== 'string' || !text) return null;
  const ms = Date.parse(text);
  if (isNaN(ms)) return null;
  // Mikrosekunden aus dem Text übernehmen, damit Abfragen exakt sind
  const m = /\.(\d{4,6})/.exec(text);
  if (m) {
    const bruch = Number('0.' + m[1]);
    return Math.floor(ms / 1000) + bruch;
  }
  return ms / 1000;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// ULID wie HA-Kontext-IDs (26 Zeichen, zeitlich sortierbar)
function ulid(ms) {
  let t = Math.floor(ms === undefined ? Date.now() : ms);
  let zeit = '';
  for (let i = 0; i < 10; i++) {
    zeit = CROCKFORD[t % 32] + zeit;
    t = Math.floor(t / 32);
  }
  const b = crypto.randomBytes(16);
  let zufallsteil = '';
  for (let i = 0; i < 16; i++) zufallsteil += CROCKFORD[b[i] % 32];
  return zeit + zufallsteil;
}

// Deterministische 32-stellige Hex-ID aus einem Text (stabil über Neustarts)
function hexId(text) {
  return crypto.createHash('md5').update(String(text)).digest('hex');
}

function uuidAus(text) {
  const h = hexId(text);
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32);
}

function zufallsToken(laenge) {
  return crypto.randomBytes(laenge || 32).toString('hex');
}

const berlinFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

// Ortszeit (Europe/Berlin) als Stunde mit Bruchteil, z. B. 7.5 = 07:30
function ortsStunde(sek) {
  const teile = berlinFormat.formatToParts(new Date(sek * 1000));
  let h = 0;
  let m = 0;
  for (const t of teile) {
    if (t.type === 'hour') h = Number(t.value);
    else if (t.type === 'minute') m = Number(t.value);
  }
  return h + m / 60;
}

function zufall(min, max) {
  return min + Math.random() * (max - min);
}

function zufallGanz(min, max) {
  return Math.floor(zufall(min, max + 1));
}

// Annähernd normalverteiltes Rauschen, meist innerhalb ±amp
function rauschen(amp) {
  return ((Math.random() + Math.random() + Math.random()) - 1.5) / 1.5 * amp;
}

function runde(x, stellen) {
  const f = Math.pow(10, stellen || 0);
  return Math.round(x * f) / f;
}

function begrenze(x, min, max) {
  return x < min ? min : (x > max ? max : x);
}

// Tiefer Vergleich für JSON-artige Werte
function gleich(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!gleich(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!gleich(a[k], b[k])) return false;
  }
  return true;
}

// Wert oder Liste → Liste (Strings mit Komma wie in HA aufteilen)
function alsListe(wert) {
  if (wert === undefined || wert === null) return [];
  if (Array.isArray(wert)) return wert.map(String);
  return String(wert).split(',').map(s => s.trim()).filter(Boolean);
}

module.exports = {
  jetzt, iso, isoSekunden, parseZeit, ulid, hexId, uuidAus, zufallsToken, ortsStunde,
  zufall, zufallGanz, rauschen, runde, begrenze, gleich, alsListe
};
