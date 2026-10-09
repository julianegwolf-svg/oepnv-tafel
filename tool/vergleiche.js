#!/usr/bin/env node
// ---------------------------------------------------------------
// Vorher/Nachher-Vergleich zweier Screenshots (ohne Zusatzpakete –
// rechnet im WebKit-Canvas von Playwright).
//
//   node tool/vergleiche.js vorher.png nachher.png
//   node tool/vergleiche.js a.png b.png --diff belege/x/diff.png --paar belege/x/paar.png
//   node tool/vergleiche.js a.png b.png --titel "Vorher,Nachher" --schwelle 40
//
//   --diff <datei>    Differenzbild: abweichende Pixel rot, Rest blass grau
//   --paar <datei>    Beide Bilder nebeneinander mit Beschriftung (für MORGEN.html)
//   --titel a,b       Beschriftung für --paar (Standard "Vorher,Nachher")
//   --schwelle <n>    ab welcher Kanal-Differenz (0–255) ein Pixel als
//                     abweichend gilt (Standard 32 – ignoriert Kantenglättung)
//
// Ausgabe: Anteil abweichender Pixel und das umschließende Rechteck.
// Exit-Code 0 immer (reines Messwerkzeug).
// ---------------------------------------------------------------
"use strict";

const fs = require("fs");
const path = require("path");
const { webkit } = require("playwright");

function parseArgs(argv) {
  const o = { bilder: [], diff: null, paar: null, titel: "Vorher,Nachher", schwelle: 32 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--diff") o.diff = argv[++i];
    else if (a === "--paar") o.paar = argv[++i];
    else if (a === "--titel") o.titel = argv[++i];
    else if (a === "--schwelle") o.schwelle = Number(argv[++i]);
    else if (a.indexOf("--") === 0) throw new Error("Unbekannte Option " + a);
    else o.bilder.push(a);
  }
  if (o.bilder.length !== 2) throw new Error("Bitte genau zwei Bilder angeben (vorher nachher).");
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const daten = o.bilder.map((b) => "data:image/png;base64," + fs.readFileSync(b).toString("base64"));
  const browser = await webkit.launch();
  const page = await browser.newPage();
  await page.setContent("<!doctype html><body></body>");
  const erg = await page.evaluate(async (a) => {
    const lade = (src) => new Promise((ok, fehler) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => fehler(new Error("Bild nicht lesbar"));
      img.src = src;
    });
    const [ia, ib] = await Promise.all([lade(a.daten[0]), lade(a.daten[1])]);
    const w = Math.max(ia.width, ib.width);
    const h = Math.max(ia.height, ib.height);
    const pixel = (img) => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const x = c.getContext("2d");
      x.fillStyle = "#ff00ff"; x.fillRect(0, 0, w, h);
      x.drawImage(img, 0, 0);
      return x.getImageData(0, 0, w, h).data;
    };
    const pa = pixel(ia);
    const pb = pixel(ib);
    const dc = document.createElement("canvas");
    dc.width = w; dc.height = h;
    const dx = dc.getContext("2d");
    const dd = dx.createImageData(w, h);
    let anzahl = 0;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let i = 0; i < pa.length; i += 4) {
      const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
      if (d > a.schwelle) {
        anzahl++;
        const p = i / 4, px = p % w, py = (p - px) / w;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        dd.data[i] = 230; dd.data[i + 1] = 30; dd.data[i + 2] = 40; dd.data[i + 3] = 255;
      } else {
        const g = Math.round((pb[i] + pb[i + 1] + pb[i + 2]) / 3);
        const blass = 200 + Math.round(g * 55 / 255);
        dd.data[i] = blass; dd.data[i + 1] = blass; dd.data[i + 2] = blass; dd.data[i + 3] = 255;
      }
    }
    dx.putImageData(dd, 0, 0);

    // Nebeneinander mit Beschriftung
    const kopf = 44, abstand = 16;
    const pc = document.createElement("canvas");
    pc.width = w * 2 + abstand; pc.height = h + kopf;
    const px2 = pc.getContext("2d");
    px2.fillStyle = "#1b1f27"; px2.fillRect(0, 0, pc.width, pc.height);
    px2.fillStyle = "#f3efe6"; px2.font = "600 22px -apple-system, Helvetica, sans-serif";
    px2.textBaseline = "middle";
    px2.fillText(a.titel[0] || "Vorher", 12, kopf / 2);
    px2.fillText(a.titel[1] || "Nachher", w + abstand + 12, kopf / 2);
    px2.drawImage(ia, 0, kopf);
    px2.drawImage(ib, w + abstand, kopf);

    return {
      w: w, h: h, anzahl: anzahl,
      groesseGleich: ia.width === ib.width && ia.height === ib.height,
      box: maxX >= 0 ? [minX, minY, maxX, maxY] : null,
      diff: a.mitDiff ? dc.toDataURL("image/png") : null,
      paar: a.mitPaar ? pc.toDataURL("image/png") : null,
    };
  }, { daten: daten, schwelle: o.schwelle, titel: o.titel.split(","), mitDiff: !!o.diff, mitPaar: !!o.paar });
  await browser.close();

  const schreibe = (ziel, url) => {
    fs.mkdirSync(path.dirname(path.resolve(ziel)), { recursive: true });
    fs.writeFileSync(ziel, Buffer.from(url.split(",")[1], "base64"));
  };
  if (o.diff) schreibe(o.diff, erg.diff);
  if (o.paar) schreibe(o.paar, erg.paar);

  const anteil = (100 * erg.anzahl / (erg.w * erg.h)).toFixed(2);
  console.log(path.basename(o.bilder[0]) + " ↔ " + path.basename(o.bilder[1]) + ": " + anteil + " % abweichend (" +
    erg.anzahl + " px)" + (erg.box ? ", Bereich x " + erg.box[0] + "–" + erg.box[2] + ", y " + erg.box[1] + "–" + erg.box[3] : "") +
    (erg.groesseGleich ? "" : "  [Bildgrößen verschieden!]"));
  if (o.diff) console.log("  Differenzbild: " + o.diff);
  if (o.paar) console.log("  Nebeneinander: " + o.paar);
}

main().catch((e) => {
  console.error("Abbruch: " + (e && e.stack || e));
  process.exit(2);
});
