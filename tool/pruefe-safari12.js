#!/usr/bin/env node
// ---------------------------------------------------------------
// Safari-12-Prüfung für die SmartTafel (iPad Air 1, iOS 12.5).
// Aufruf über tool/pruefe-safari12.sh (oder direkt: node tool/pruefe-safari12.js).
//
// Prüft im Repo-Wurzelordner:
//  1. alle *.js mit es-check (es2017 + --checkFeatures: Syntax UND neuere
//     eingebaute Funktionen wie replaceAll/allSettled),
//  2. alle *.js auf verbotene Muster (Kommentare/Strings ausgenommen),
//  3. alle *.css auf verbotene Eigenschaften/Selektoren, inkl. gap in
//     Flex-Containern (Regeln werden grob geparst; display und gap dürfen
//     in verschiedenen Regeln für denselben Selektor stehen),
//  4. Inline-Styles in *.html (inset/aspect-ratio/gap).
//
// Ausgabe: je Fund "FEHLER|WARNUNG  datei:zeile  Grund", am Ende
// "OK" oder "FEHLER (n)". Exit-Code 1 bei Fehlern, sonst 0.
// Optionen: --still (nur Funde + Ergebnis), --ohne-escheck, --ordner <pfad>
// ---------------------------------------------------------------
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const TOOL = __dirname;
const args = process.argv.slice(2);
// --ordner <pfad>: anderen Ordner prüfen (zum Testen des Prüfskripts selbst)
const REPO = args.indexOf("--ordner") !== -1
  ? path.resolve(args[args.indexOf("--ordner") + 1])
  : path.resolve(__dirname, "..");
const STILL = args.indexOf("--still") !== -1;
const OHNE_ESCHECK = args.indexOf("--ohne-escheck") !== -1;

const funde = [];
function fund(art, datei, zeile, grund) {
  funde.push({ art: art, datei: datei, zeile: zeile, grund: grund });
}

function dateienMit(endung) {
  return fs.readdirSync(REPO)
    .filter((f) => f.endsWith(endung) && fs.statSync(path.join(REPO, f)).isFile())
    .sort();
}

function zeileAn(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// ---------------------------------------------------------------
// 1. es-check
// ---------------------------------------------------------------
function pruefeEsCheck(jsDateien) {
  const bin = path.join(TOOL, "node_modules", ".bin", "es-check");
  if (!fs.existsSync(bin)) {
    fund("WARNUNG", "tool/node_modules", 0, "es-check fehlt – cd tool && npm install");
    return;
  }
  for (const datei of jsDateien) {
    const r = spawnSync(bin, ["es2017", datei, "--checkFeatures", "--noColor"], { cwd: REPO, encoding: "utf8" });
    if (r.status === 0) continue;
    const aus = (r.stdout || "") + (r.stderr || "");
    const ort = /erroring file: \S+ at \S+?:(\d+):(\d+)/.exec(aus);
    const fehler = /· error: (.+)/.exec(aus);
    fund("FEHLER", datei, ort ? Number(ort[1]) : 0,
      "es-check es2017: " + (fehler ? fehler[1].trim() : "fehlgeschlagen (Ausgabe prüfen)"));
  }
}

// ---------------------------------------------------------------
// 2. JS-Muster
// ---------------------------------------------------------------
// Zerlegt JS grob: Kommentare und String-Inhalte werden durch Leerzeichen
// ersetzt (Zeilen bleiben erhalten), Regex-Literale ebenfalls ausgeblendet,
// aber separat gesammelt (für die Lookbehind-Prüfung).
function maskiereJs(src) {
  const out = src.split("");
  const strings = [];
  const regexe = [];
  const KEYWORDS_VOR_REGEX = /(?:^|[^\w$])(return|typeof|case|do|else|in|of|new|delete|void|throw|instanceof|yield|await)$/;
  let i = 0;
  const n = src.length;
  const vorlagenTiefe = []; // Klammertiefe je offenem ${ in Template-Strings
  let klammer = 0;
  let letztesZeichen = ""; // letztes signifikantes Code-Zeichen
  let letzterText = "";

  const blank = (a, b) => {
    for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " ";
  };

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      const e = src.indexOf("\n", i);
      const ende = e === -1 ? n : e;
      blank(i, ende);
      i = ende;
      continue;
    }
    if (c === "/" && c2 === "*") {
      const e = src.indexOf("*/", i + 2);
      const ende = e === -1 ? n : e + 2;
      blank(i, ende);
      i = ende;
      continue;
    }
    if (c === "'" || c === '"') {
      let k = i + 1;
      while (k < n && src[k] !== c && src[k] !== "\n") k += src[k] === "\\" ? 2 : 1;
      strings.push({ text: src.slice(i + 1, k), index: i });
      blank(i + 1, k);
      i = k + 1;
      letztesZeichen = "a";
      continue;
    }
    if (c === "`" || (c === "}" && vorlagenTiefe.length && vorlagenTiefe[vorlagenTiefe.length - 1] === klammer)) {
      if (c === "}") vorlagenTiefe.pop();
      let k = i + 1;
      while (k < n && src[k] !== "`" && !(src[k] === "$" && src[k + 1] === "{")) k += src[k] === "\\" ? 2 : 1;
      strings.push({ text: src.slice(i + 1, k), index: i });
      blank(i + 1, k);
      if (src[k] === "$") {
        vorlagenTiefe.push(klammer);
        i = k + 2;
        letztesZeichen = "{";
      } else {
        i = k + 1;
        letztesZeichen = "a";
      }
      continue;
    }
    if (c === "/") {
      const regexMoeglich = letztesZeichen === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(letztesZeichen) ||
        KEYWORDS_VOR_REGEX.test(letzterText);
      if (regexMoeglich) {
        let k = i + 1;
        let inKlasse = false;
        while (k < n && src[k] !== "\n") {
          if (src[k] === "\\") { k += 2; continue; }
          if (src[k] === "[") inKlasse = true;
          else if (src[k] === "]") inKlasse = false;
          else if (src[k] === "/" && !inKlasse) break;
          k++;
        }
        regexe.push({ text: src.slice(i + 1, k), index: i });
        blank(i + 1, k);
        i = k + 1;
        while (i < n && /[a-z]/.test(src[i])) i++;
        letztesZeichen = "a";
        continue;
      }
    }
    if (c === "{") klammer++;
    if (c === "}") klammer--;
    if (!/\s/.test(c)) {
      letztesZeichen = c;
      letzterText = (letzterText + c).slice(-12);
    } else {
      letzterText += " ";
    }
    i++;
  }
  return { code: out.join(""), strings: strings, regexe: regexe };
}

const JS_MUSTER = [
  { re: /\?\.(?!\d)/g, art: "FEHLER", grund: "Optional Chaining ?. (erst Safari 13.1)" },
  { re: /\?\?/g, art: "FEHLER", grund: "Nullish Coalescing ?? (erst Safari 13.1)" },
  { re: /\.replaceAll\s*\(/g, art: "FEHLER", grund: "String.replaceAll (erst Safari 13.1)" },
  { re: /\ballSettled\b/g, art: "FEHLER", grund: "Promise.allSettled (erst Safari 13)" },
  { re: /\bstructuredClone\b/g, art: "FEHLER", grund: "structuredClone (erst Safari 15.4)" },
  { re: /\bglobalThis\b/g, art: "FEHLER", grund: "globalThis (unsicher auf Safari 12) – window nutzen" },
  { re: /\bObject\.fromEntries\b/g, art: "FEHLER", grund: "Object.fromEntries (unsicher auf Safari 12)" },
  { re: /\.matchAll\s*\(/g, art: "FEHLER", grund: "String.matchAll (erst Safari 13)" },
  { re: /\.at\s*\(/g, art: "FEHLER", grund: ".at() (erst Safari 15.4)" },
  { re: /\bIntl\.RelativeTimeFormat\b/g, art: "FEHLER", grund: "Intl.RelativeTimeFormat (erst Safari 14)" },
  { re: /\bResizeObserver\b/g, art: "FEHLER", grund: "ResizeObserver (erst Safari 13.1)" },
  { re: /(^|[^\w$\])"'])#[A-Za-z_$][\w$]*/g, art: "FEHLER", grund: "privates Klassenfeld #… (erst Safari 14.1)" },
  { re: /^\s*(import|export)\b(?!\s*\()/gm, art: "FEHLER", grund: "ES-Modul-Syntax import/export (klassische <script>-Tags verwenden)" },
  { re: /\bimport\s*\(/g, art: "FEHLER", grund: "dynamisches import() (nicht in Safari 12)" },
  { re: /\.(flatMap|flat)\s*\(/g, art: null }, // Safari 12 kann das – nur Platzhalter, keine Meldung
  { re: /\bAbortController\b/g, art: "WARNUNG", grund: "AbortController: auf Safari 12 bricht fetch() nicht zuverlässig ab – Zeitlimit zusätzlich per Promise.race" },
  { re: /\bIntersectionObserver\b/g, art: "WARNUNG", grund: "IntersectionObserver erst ab iOS 12.2 – Fallback vorsehen" },
  { re: /\.style\.(gap|rowGap|columnGap)\b/g, art: "WARNUNG", grund: "gap per JS gesetzt – auf Safari 12 nur bei Grid wirksam" },
];

function pruefeKlassenfelder(datei, code) {
  // Grob: innerhalb eines class-Körpers (Tiefe 1) ist "name = …" oder
  // "static name = …" bzw. "name;" ein Klassenfeld.
  const re = /\bclass\b[^{]*\{/g;
  let m;
  while ((m = re.exec(code))) {
    let tiefe = 1;
    let k = m.index + m[0].length;
    let zeilenStart = k;
    while (k < code.length && tiefe > 0) {
      const c = code[k];
      if (c === "{") tiefe++;
      else if (c === "}") tiefe--;
      else if (c === "\n") zeilenStart = k + 1;
      if (tiefe === 1 && c === "\n") {
        const zeile = code.slice(k + 1, code.indexOf("\n", k + 1) === -1 ? code.length : code.indexOf("\n", k + 1));
        if (/^\s*(static\s+)?[A-Za-z_$][\w$]*\s*(=(?!=|>)|;)/.test(zeile)) {
          fund("FEHLER", datei, zeileAn(code, k + 1), "Klassenfeld im class-Körper (erst Safari 14) – im constructor zuweisen");
        }
      }
      k++;
    }
    void zeilenStart;
  }
}

function pruefeJs(datei) {
  const src = fs.readFileSync(path.join(REPO, datei), "utf8");
  const m = maskiereJs(src);
  for (const regel of JS_MUSTER) {
    if (!regel.art) continue;
    regel.re.lastIndex = 0;
    let t;
    while ((t = regel.re.exec(m.code))) {
      fund(regel.art, datei, zeileAn(src, t.index), regel.grund);
      if (t[0].length === 0) regel.re.lastIndex++;
    }
  }
  const lookbehind = /\(\?<[=!]/;
  m.regexe.forEach((r) => {
    if (lookbehind.test(r.text)) fund("FEHLER", datei, zeileAn(src, r.index), "Regex-Lookbehind (?<= / (?<! (erst Safari 16.4)");
  });
  m.strings.forEach((s) => {
    if (lookbehind.test(s.text)) fund("FEHLER", datei, zeileAn(src, s.index), "Regex-Lookbehind im String (new RegExp?) (erst Safari 16.4)");
  });
  pruefeKlassenfelder(datei, m.code);
}

// ---------------------------------------------------------------
// 3. CSS
// ---------------------------------------------------------------
function entferneCssKommentare(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (k) => k.replace(/[^\n]/g, " "));
}

// Grober Parser: liefert Regeln { selektoren[], zeile, decls[{prop,wert,zeile}], kontext }.
function parseCss(css) {
  const regeln = [];
  const atRegeln = [];
  let i = 0;

  function leseBlockInhalt(kontext, istRegelListe, ende) {
    // istRegelListe: Inhalt besteht aus Regeln (Top-Level, @media, @supports)
    while (i < css.length) {
      // Leerraum überspringen
      while (i < css.length && /\s/.test(css[i])) i++;
      if (i >= css.length) return;
      if (css[i] === "}") { i++; return; }
      const start = i;
      // Prelude bis { oder ; lesen (Strings/Klammern beachten)
      let tiefe = 0;
      while (i < css.length) {
        const c = css[i];
        if (c === '"' || c === "'") {
          const e = css.indexOf(c, i + 1);
          i = e === -1 ? css.length : e + 1;
          continue;
        }
        if (c === "(") tiefe++;
        else if (c === ")") tiefe--;
        else if (tiefe === 0 && (c === "{" || c === ";" || c === "}")) break;
        i++;
      }
      const prelude = css.slice(start, i).trim();
      const zeile = zeileAn(css, start);
      if (css[i] === ";" || css[i] === "}") {
        // @import/@charset o. ä. – oder Deklaration außerhalb einer Regel
        if (css[i] === ";") i++;
        continue;
      }
      i++; // "{"
      if (prelude[0] === "@") {
        const name = (/^@([\w-]+)/.exec(prelude) || [])[1] || "";
        atRegeln.push({ name: name, prelude: prelude, zeile: zeile });
        if (name === "media" || name === "supports" || name === "document") {
          leseBlockInhalt(kontext.concat(prelude), true);
        } else if (name === "keyframes" || name === "-webkit-keyframes") {
          leseBlockInhalt(kontext.concat(prelude), true, "keyframes");
        } else if (name === "container" || name === "layer" || name === "scope") {
          leseBlockInhalt(kontext.concat(prelude), true);
        } else {
          leseDeklarationen(prelude, zeile, kontext, true);
        }
      } else {
        leseDeklarationen(prelude, zeile, kontext, ende === "keyframes");
      }
    }
  }

  function leseDeklarationen(prelude, zeile, kontext, sonder) {
    const decls = [];
    let verschachtelt = null;
    while (i < css.length) {
      while (i < css.length && /\s/.test(css[i])) i++;
      if (css[i] === "}") { i++; break; }
      const start = i;
      let tiefe = 0;
      while (i < css.length) {
        const c = css[i];
        if (c === '"' || c === "'") {
          const e = css.indexOf(c, i + 1);
          i = e === -1 ? css.length : e + 1;
          continue;
        }
        if (c === "(") tiefe++;
        else if (c === ")") tiefe--;
        else if (tiefe === 0 && (c === ";" || c === "}" || c === "{")) break;
        i++;
      }
      const text = css.slice(start, i).trim();
      if (css[i] === "{") {
        // Verschachtelte Regel = CSS-Nesting
        verschachtelt = verschachtelt || { zeile: zeileAn(css, start), text: text };
        i++;
        leseDeklarationen(text, zeileAn(css, start), kontext, sonder);
        continue;
      }
      if (css[i] === ";") i++;
      const dp = text.indexOf(":");
      if (dp > 0) {
        decls.push({
          prop: text.slice(0, dp).trim().toLowerCase(),
          wert: text.slice(dp + 1).trim(),
          zeile: zeileAn(css, start),
        });
      }
    }
    const selektoren = sonder ? [] : splitSelektoren(prelude);
    regeln.push({ prelude: prelude, selektoren: selektoren, zeile: zeile, decls: decls, kontext: kontext, sonder: !!sonder, verschachtelt: verschachtelt });
  }

  leseBlockInhalt([], true);
  return { regeln: regeln, atRegeln: atRegeln };
}

function splitSelektoren(prelude) {
  const teile = [];
  let tiefe = 0;
  let akt = "";
  for (const c of prelude) {
    if (c === "(") tiefe++;
    if (c === ")") tiefe--;
    if (c === "," && tiefe === 0) { teile.push(akt); akt = ""; continue; }
    akt += c;
  }
  teile.push(akt);
  return teile.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function displayArt(wert) {
  const w = wert.replace(/!important/, "").trim().toLowerCase();
  if (/^(-webkit-)?(inline-)?flex$|^-webkit-(inline-)?box$/.test(w)) return "flex";
  if (/^(-ms-)?(inline-)?grid$/.test(w)) return "grid";
  return "anders";
}

function pruefeCss(datei) {
  pruefeCssText(datei, fs.readFileSync(path.join(REPO, datei), "utf8"));
}

function pruefeCssText(datei, roh) {
  const css = entferneCssKommentare(roh);
  const { regeln, atRegeln } = parseCss(css);

  atRegeln.forEach((a) => {
    if (/^(container|layer|property|scope|nest)$/.test(a.name)) {
      fund("FEHLER", datei, a.zeile, "@" + a.name + " kennt Safari 12 nicht");
    }
    if (a.name === "supports" && /selector\(/.test(a.prelude)) {
      fund("FEHLER", datei, a.zeile, "@supports selector() erst Safari 14.1");
    }
  });

  // display je Selektor sammeln (über alle Regeln/Media-Queries hinweg)
  const displayVon = new Map(); // selektor → [{art, zeile}]
  regeln.forEach((r) => {
    r.decls.forEach((d) => {
      if (d.prop !== "display") return;
      r.selektoren.forEach((s) => {
        const l = displayVon.get(s) || [];
        l.push({ art: displayArt(d.wert), zeile: d.zeile });
        displayVon.set(s, l);
      });
    });
  });

  regeln.forEach((r) => {
    if (r.verschachtelt) fund("FEHLER", datei, r.verschachtelt.zeile, "CSS-Nesting (Regel in Regel) kennt Safari 12 nicht");
    if (!r.sonder) {
      if (/:(is|where|has)\(/.test(r.prelude)) fund("FEHLER", datei, r.zeile, "Selektor " + RegExp.lastMatch + " kennt Safari 12 nicht");
      if (/:focus-visible/.test(r.prelude)) fund("FEHLER", datei, r.zeile, ":focus-visible erst Safari 15.4");
      if (/&/.test(r.prelude)) fund("FEHLER", datei, r.zeile, "CSS-Nesting (&) kennt Safari 12 nicht");
    }
    const props = new Map();
    r.decls.forEach((d) => props.set(d.prop, d));
    const hat = (p) => props.has(p);

    r.decls.forEach((d) => {
      const p = d.prop;
      const w = d.wert.toLowerCase();
      if (p === "inset" || p.indexOf("inset-") === 0) {
        fund("FEHLER", datei, d.zeile, p + ": kennt Safari 12 nicht (Element bekommt 0×0 px) – top/right/bottom/left verwenden");
      }
      if (p === "aspect-ratio") fund("FEHLER", datei, d.zeile, "aspect-ratio erst Safari 15 – padding-top-Trick oder feste Höhe");
      if (/\b(color-mix|lab|lch|oklab|oklch|hwb)\(/.test(w)) fund("FEHLER", datei, d.zeile, RegExp.lastMatch + " kennt Safari 12 nicht – feste rgba()-Farbe");
      if (/\bclamp\(/.test(w)) fund("FEHLER", datei, d.zeile, "clamp() erst Safari 13.1");
      if (/\d(dvh|svh|lvh|dvw|svw|lvw|cqw|cqh|cqi|cqb)\b/.test(w)) fund("FEHLER", datei, d.zeile, "Einheit " + RegExp.$1 + " kennt Safari 12 nicht");
      if (p === "translate" || p === "rotate" || p === "scale") fund("FEHLER", datei, d.zeile, "Einzel-Transform \"" + p + ":\" erst Safari 14.1 – transform: verwenden");
      if (p === "backdrop-filter" && !hat("-webkit-backdrop-filter")) {
        fund("WARNUNG", datei, d.zeile, "backdrop-filter ohne -webkit- Präfix: wirkt auf Safari 12 nicht (und ist auf großen Flächen zu teuer)");
      }
      if (p === "position" && /\bsticky\b/.test(w) && !r.decls.some((x) => x.prop === "position" && /-webkit-sticky/.test(x.wert))) {
        fund("WARNUNG", datei, d.zeile, "position: sticky braucht auf Safari 12 zusätzlich -webkit-sticky");
      }
      const brauchtPraefix = { "user-select": 1, "mask": 1, "mask-image": 1, "appearance": 1, "hyphens": 1, "text-size-adjust": 1 };
      if (brauchtPraefix[p] && !hat("-webkit-" + p)) {
        fund("WARNUNG", datei, d.zeile, p + " wirkt auf Safari 12 nur mit -webkit- Präfix");
      }
      if (p === "background-clip" && /\btext\b/.test(w) && !hat("-webkit-background-clip")) {
        fund("WARNUNG", datei, d.zeile, "background-clip: text braucht auf Safari 12 -webkit-background-clip");
      }
      if (p === "gap" || p === "row-gap" || p === "column-gap") {
        pruefeGap(datei, r, d, displayVon);
      }
    });
  });
}

function pruefeGap(datei, r, d, displayVon) {
  const eigen = r.decls.filter((x) => x.prop === "display").map((x) => displayArt(x.wert));
  if (eigen.indexOf("flex") !== -1) {
    fund("FEHLER", datei, d.zeile, d.prop + " in Flex-Container (" + r.prelude.slice(0, 60) + ") – Safari 12 ignoriert es; Abstand per margin an den Kindern");
    return;
  }
  if (eigen.indexOf("grid") !== -1) return;
  // display steht woanders: alle Regeln mit gleichem Selektor ansehen
  let flex = null;
  let grid = false;
  // Gleicher Selektor – oder derselbe mit Zustandsklasse/Pseudoklasse
  // (".x" ↔ ".x.is-visible", ".x:hover"): gleiches Element, anderer Zustand.
  const passt = (s, t) => t === s || (t.indexOf(s) === 0 && /^[.:[]/.test(t.slice(s.length)));
  r.selektoren.forEach((s) => {
    displayVon.forEach((liste, t) => {
      if (!passt(s, t)) return;
      liste.forEach((e) => {
        if (e.art === "flex" && !flex) flex = e;
        if (e.art === "grid") grid = true;
      });
    });
  });
  if (flex) {
    fund("FEHLER", datei, d.zeile, d.prop + " für " + r.prelude.slice(0, 60) + " – display:flex steht in Zeile " + flex.zeile + "; Safari 12 ignoriert gap bei Flex");
  } else if (!grid) {
    fund("WARNUNG", datei, d.zeile, d.prop + " ohne erkennbares display für " + r.prelude.slice(0, 60) + " – bei Flex wirkungslos auf Safari 12, bitte prüfen");
  }
}

// ---------------------------------------------------------------
// 4. Inline-Styles in HTML
// ---------------------------------------------------------------
function pruefeHtml(datei) {
  const src = fs.readFileSync(path.join(REPO, datei), "utf8");
  const re = /style\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(src))) {
    const s = m[1];
    const z = zeileAn(src, m.index);
    if (/(^|;)\s*inset\s*:/.test(s)) fund("FEHLER", datei, z, "inline style mit inset: – kennt Safari 12 nicht");
    if (/aspect-ratio\s*:/.test(s)) fund("FEHLER", datei, z, "inline style mit aspect-ratio – kennt Safari 12 nicht");
    if (/(^|;)\s*(row-|column-)?gap\s*:/.test(s)) fund("WARNUNG", datei, z, "inline style mit gap – bei Flex wirkungslos auf Safari 12");
  }
}

// Für tool/screenshot.js --safari12-sim: CSS-Funde zu einem Text liefern.
function cssFunde(text, datei) {
  const vorher = funde.length;
  pruefeCssText(datei || "inline.css", text);
  return funde.splice(vorher);
}
module.exports = { cssFunde: cssFunde };

if (require.main === module) {
  hauptprogramm();
}

function hauptprogramm() {
  const jsDateien = dateienMit(".js");
  const cssDateien = dateienMit(".css");
  const htmlDateien = dateienMit(".html");

  if (!STILL) {
    console.log("Safari-12-Prüfung (" + path.basename(REPO) + ")");
    console.log("  JS:   " + jsDateien.join(", "));
    console.log("  CSS:  " + cssDateien.join(", "));
    console.log("  HTML: " + htmlDateien.join(", "));
    console.log("");
  }

  if (!OHNE_ESCHECK) pruefeEsCheck(jsDateien);
  jsDateien.forEach(pruefeJs);
  cssDateien.forEach(pruefeCss);
  htmlDateien.forEach(pruefeHtml);

  funde.sort((a, b) => (a.datei < b.datei ? -1 : a.datei > b.datei ? 1 : a.zeile - b.zeile));
  funde.forEach((f) => {
    console.log((f.art === "FEHLER" ? "FEHLER " : "WARNUNG") + "  " + f.datei + ":" + f.zeile + "  " + f.grund);
  });

  const fehler = funde.filter((f) => f.art === "FEHLER").length;
  const warnungen = funde.length - fehler;
  console.log("");
  if (fehler) {
    console.log("FEHLER (" + fehler + ")" + (warnungen ? ", " + warnungen + " Warnung(en)" : ""));
    process.exit(1);
  } else {
    console.log("OK" + (warnungen ? " (" + warnungen + " Warnung(en))" : ""));
  }
}
