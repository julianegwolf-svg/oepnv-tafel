'use strict';
/*
 * Minimaler YAML-Leser für Home-Assistant-Dateien wie automations.yaml
 * (Block-Mappings, Listen – auch auf gleicher Einrückung wie der Schlüssel –,
 * einfache/doppelte Anführungszeichen auch über mehrere Zeilen, kleine Flow-Werte {} / [a, b],
 * Block-Skalare | und >). Kein vollständiger YAML-Parser, aber ohne fremde Pakete.
 */

function zeilenAus(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').map(function (roh, nr) {
    const einzug = roh.length - roh.replace(/^ +/, '').length;
    return { roh: roh, einzug: einzug, text: roh.slice(einzug), nr: nr + 1 };
  });
}

function istLeer(z) {
  return !z || z.text === '' || z.text[0] === '#';
}

function plain(wert) {
  const v = wert.replace(/\s+#.*$/, '').trim();
  if (v === '' || v === '~' || v === 'null' || v === 'Null' || v === 'NULL') return null;
  if (/^(true|True|TRUE)$/.test(v)) return true;
  if (/^(false|False|FALSE)$/.test(v)) return false;
  if (/^[-+]?\d+$/.test(v)) return parseInt(v, 10);
  if (/^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(v)) return parseFloat(v);
  if (v === '{}') return {};
  if (v === '[]') return [];
  if (v[0] === '[' && v[v.length - 1] === ']') return teileFlow(v.slice(1, -1)).map(t => skalar(t));
  if (v[0] === '{' && v[v.length - 1] === '}') {
    const o = {};
    teileFlow(v.slice(1, -1)).forEach(function (t) {
      const i = t.indexOf(':');
      if (i > 0) o[entferneQuotes(t.slice(0, i).trim())] = skalar(t.slice(i + 1).trim());
    });
    return o;
  }
  return v;
}

function teileFlow(inhalt) {
  const teile = [];
  let aktuell = '';
  let quote = null;
  for (const c of inhalt) {
    if (quote) {
      aktuell += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      aktuell += c;
    } else if (c === ',') {
      teile.push(aktuell.trim());
      aktuell = '';
    } else {
      aktuell += c;
    }
  }
  if (aktuell.trim()) teile.push(aktuell.trim());
  return teile;
}

function entferneQuotes(t) {
  if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) return skalar(t);
  return t;
}

function doppeltEscape(s) {
  return s.replace(/\\(U[0-9a-fA-F]{8}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, function (m, e) {
    if (e[0] === 'U' || e[0] === 'u' || e[0] === 'x') return String.fromCodePoint(parseInt(e.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', '0': '\0', '"': '"', '\\': '\\', '/': '/', ' ': ' ' }[e] || e;
  });
}

// Einzeiliger Skalar (auch gequotet)
function skalar(t) {
  t = t.trim();
  if (t[0] === "'" && t[t.length - 1] === "'" && t.length >= 2) return t.slice(1, -1).replace(/''/g, "'");
  if (t[0] === '"' && t[t.length - 1] === '"' && t.length >= 2) return doppeltEscape(t.slice(1, -1));
  return plain(t);
}

class Leser {
  constructor(text) {
    this.z = zeilenAus(text);
    this.i = 0;
  }

  ueberspringeLeere() {
    while (this.i < this.z.length && istLeer(this.z[this.i])) this.i++;
  }

  aktuelle() {
    this.ueberspringeLeere();
    return this.i < this.z.length ? this.z[this.i] : null;
  }

  block(einzug) {
    const z = this.aktuelle();
    if (!z || z.einzug < einzug) return null;
    if (z.text === '-' || z.text.indexOf('- ') === 0) return this.liste(z.einzug);
    return this.mapping(z.einzug);
  }

  liste(einzug) {
    const ergebnis = [];
    for (;;) {
      const z = this.aktuelle();
      if (!z || z.einzug !== einzug || !(z.text === '-' || z.text.indexOf('- ') === 0)) break;
      const rest = z.text === '-' ? '' : z.text.slice(2).replace(/^ +/, '');
      if (rest === '') {
        this.i++;
        const naechste = this.aktuelle();
        ergebnis.push(naechste && naechste.einzug > einzug ? this.block(naechste.einzug) : null);
        continue;
      }
      // „- key: wert“ oder „- - x“: Zeile als eingerückten Block weiterlesen
      const neuerEinzug = z.einzug + (z.text.length - rest.length);
      if (rest.indexOf('- ') === 0 || rest === '-' || this.istMappingZeile(rest)) {
        z.einzug = neuerEinzug;
        z.text = rest;
        ergebnis.push(this.block(neuerEinzug));
      } else {
        ergebnis.push(this.wert(rest, einzug));
      }
    }
    return ergebnis;
  }

  istMappingZeile(text) {
    if (text[0] === '"' || text[0] === "'") {
      const q = text[0];
      let j = 1;
      while (j < text.length) {
        if (text[j] === q) {
          if (q === "'" && text[j + 1] === "'") { j += 2; continue; }
          break;
        }
        if (q === '"' && text[j] === '\\') j++;
        j++;
      }
      return /^\s*:(\s|$)/.test(text.slice(j + 1));
    }
    if (text[0] === '{' || text[0] === '[') return false;
    return /^[^#][^:]*?:(\s|$)/.test(text);
  }

  trenneSchluessel(text) {
    if (text[0] === '"' || text[0] === "'") {
      const q = text[0];
      let j = 1;
      while (j < text.length) {
        if (text[j] === q) {
          if (q === "'" && text[j + 1] === "'") { j += 2; continue; }
          break;
        }
        if (q === '"' && text[j] === '\\') j++;
        j++;
      }
      const schluessel = skalar(text.slice(0, j + 1));
      const rest = text.slice(j + 1).replace(/^\s*:/, '');
      return [String(schluessel), rest.trim()];
    }
    const m = /^([^:]*?):(\s|$)(.*)$/.exec(text);
    return [m[1].trim(), (m[3] || '').trim()];
  }

  mapping(einzug) {
    const ergebnis = {};
    for (;;) {
      const z = this.aktuelle();
      if (!z || z.einzug !== einzug || z.text === '-' || z.text.indexOf('- ') === 0) break;
      if (!this.istMappingZeile(z.text)) throw new Error('YAML: unerwartete Zeile ' + z.nr + ': ' + z.text);
      const teile = this.trenneSchluessel(z.text);
      const schluessel = teile[0];
      const rest = teile[1];
      if (rest === '' || rest[0] === '#') {
        this.i++;
        const naechste = this.aktuelle();
        if (naechste && naechste.einzug > einzug) ergebnis[schluessel] = this.block(naechste.einzug);
        else if (naechste && naechste.einzug === einzug && (naechste.text === '-' || naechste.text.indexOf('- ') === 0)) ergebnis[schluessel] = this.liste(einzug);
        else ergebnis[schluessel] = null;
      } else {
        ergebnis[schluessel] = this.wert(rest, einzug);
      }
    }
    return ergebnis;
  }

  // Wert ab aktueller Zeile (rest = Text nach „key:“ bzw. „- “); verbraucht ggf. Folgezeilen
  wert(rest, einzug) {
    const startZeile = this.i;
    if (rest[0] === '|' || rest[0] === '>') {
      this.i++;
      const teile = [];
      let blockEinzug = null;
      while (this.i < this.z.length) {
        const z = this.z[this.i];
        if (z.text !== '' && z.einzug <= einzug) break;
        if (z.text !== '' && blockEinzug === null) blockEinzug = z.einzug;
        teile.push(z.text === '' ? '' : z.roh.slice(blockEinzug));
        this.i++;
      }
      while (teile.length && teile[teile.length - 1] === '') teile.pop();
      return rest[0] === '|' ? teile.join('\n') + '\n' : teile.join(' ') + '\n';
    }
    if (rest[0] === "'" || rest[0] === '"') {
      const q = rest[0];
      let gesammelt = rest;
      for (;;) {
        const ende = this.quoteEnde(gesammelt, q);
        if (ende !== -1) {
          this.i++;
          const inhalt = gesammelt.slice(1, ende);
          return q === "'" ? this.falte(inhalt).replace(/''/g, "'") : doppeltEscape(this.falte(inhalt));
        }
        this.i++;
        if (this.i >= this.z.length) throw new Error('YAML: Anführungszeichen nicht geschlossen ab Zeile ' + (startZeile + 1));
        gesammelt += '\n' + this.z[this.i].text;
      }
    }
    this.i++;
    return plain(rest);
  }

  quoteEnde(text, q) {
    let j = 1;
    while (j < text.length) {
      if (text[j] === q) {
        if (q === "'" && text[j + 1] === "'") { j += 2; continue; }
        return j;
      }
      if (q === '"' && text[j] === '\\') j++;
      j++;
    }
    return -1;
  }

  // Zeilenumbrüche in gequoteten Werten wie YAML falten (Leerzeile = \n, sonst Leerzeichen)
  falte(inhalt) {
    const zeilen = inhalt.split('\n').map((s, i) => i === 0 ? s.replace(/\s+$/, '') : s.trim());
    let aus = '';
    for (let i = 0; i < zeilen.length; i++) {
      if (i === 0) { aus = zeilen[0]; continue; }
      if (zeilen[i] === '') aus += '\n';
      else aus += (aus.endsWith('\n') || aus === '' ? '' : ' ') + zeilen[i];
    }
    return aus;
  }
}

function parseYaml(text) {
  const leser = new Leser(text);
  const z = leser.aktuelle();
  if (!z) return null;
  return leser.block(z.einzug);
}

module.exports = { parseYaml };
