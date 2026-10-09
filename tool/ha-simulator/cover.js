'use strict';
/*
 * Erzeugt ein SVG-Cover (300×300) für /api/media_player_proxy/<entity_id>:
 * Farbverlauf je Titel, große Initialen, Titel und Interpret unten.
 */

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function hslZuHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = x => Math.round(x * 255).toString(16).padStart(2, '0');
  return '#' + hex(f(0)) + hex(f(8)) + hex(f(4));
}

function xml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function kuerze(text, max) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function initialen(titel) {
  const woerter = titel.split(/[\s\-–&,.]+/).filter(w => /[A-Za-zÄÖÜäöüß0-9]/.test(w));
  const buchstaben = woerter.slice(0, 2).map(w => {
    const m = /[A-Za-zÄÖÜäöüß0-9]/.exec(w);
    return m ? m[0].toUpperCase() : '';
  });
  return buchstaben.join('') || '♪';
}

function coverSvg(titel, kuenstler) {
  titel = titel || 'Unbekannt';
  kuenstler = kuenstler || '';
  const h = hash(titel + '|' + kuenstler);
  const farbton1 = h % 360;
  const farbton2 = (farbton1 + 35 + (h >>> 9) % 90) % 360;
  const c1 = hslZuHex(farbton1, 70, 55);
  const c2 = hslZuHex(farbton2, 65, 28);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs>' +
    '<rect width="300" height="300" fill="url(#g)"/>' +
    '<circle cx="235" cy="62" r="95" fill="#ffffff" fill-opacity="0.08"/>' +
    '<circle cx="40" cy="270" r="70" fill="#000000" fill-opacity="0.10"/>' +
    '<text x="150" y="168" font-family="Helvetica, Arial, sans-serif" font-size="112" font-weight="700" fill="#ffffff" fill-opacity="0.92" text-anchor="middle">' + xml(initialen(titel)) + '</text>' +
    '<text x="150" y="236" font-family="Helvetica, Arial, sans-serif" font-size="21" font-weight="600" fill="#ffffff" text-anchor="middle">' + xml(kuerze(titel, 24)) + '</text>' +
    '<text x="150" y="264" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#ffffff" fill-opacity="0.78" text-anchor="middle">' + xml(kuerze(kuenstler, 32)) + '</text>' +
    '</svg>';
}

module.exports = { coverSvg, hash };
