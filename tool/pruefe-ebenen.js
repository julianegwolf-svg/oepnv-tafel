#!/usr/bin/env node
// ---------------------------------------------------------------
// Welche Animationen/Übergänge laufen dauerhaft, während ein Panel
// steht? Jede laufende transform/opacity-Animation hält auf dem iPad
// (WebKit/iOS) eine eigene GPU-Ebene; Ebenen, die eine solche Ebene
// überlappen, werden ebenfalls Ebenen. Auf dem iPad Air 1 (1 GB) ist das
// der Verdächtige für schwarze Flächen (FEEDBACK 10.10. 11:59).
//
// Aufruf: node tool/pruefe-ebenen.js [--url <url>] [--panel departures]
//         [--warte 9000] [--jetzt 2026-10-12T07:20] [--json <datei>]
// Ausgabe: je laufender Animation Ziel-Selektor, Art, Eigenschaft,
// Restdauer; dazu Elemente mit will-change und mit Endlos-Animation.
// ---------------------------------------------------------------
"use strict";
const fs = require("fs");
const { webkit } = require("playwright");

const args = process.argv.slice(2);
function opt(name, std) {
  const i = args.indexOf("--" + name);
  return i === -1 ? std : args[i + 1];
}
let url = opt("url", "http://localhost:8765/index.html");
const panel = opt("panel", "departures");
const warte = Number(opt("warte", "9000"));
const jetzt = opt("jetzt", null);
const jsonAus = opt("json", null);
if (jetzt) url += (url.indexOf("?") === -1 ? "?" : "&") + "jetzt=" + encodeURIComponent(jetzt);

(async () => {
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false });
  const page = await ctx.newPage();
  const fehler = [];
  page.on("pageerror", (e) => fehler.push(String(e)));
  await page.goto(url);
  await page.waitForTimeout(warte);
  await page.evaluate((p) => { if (window.jumpToPanel) window.jumpToPanel(p); }, panel);
  await page.waitForTimeout(3000);
  const bericht = await page.evaluate(() => {
    function sel(el) {
      if (!el || !el.tagName) return String(el);
      let s = el.tagName.toLowerCase();
      if (el.id) s += "#" + el.id;
      if (el.className && typeof el.className === "string") s += "." + el.className.trim().split(/\s+/).join(".");
      return s;
    }
    function weg(el) {
      const teile = [];
      let e = el;
      for (let i = 0; e && e.tagName && i < 4; i++, e = e.parentElement) teile.unshift(sel(e));
      return teile.join(" > ");
    }
    function sichtbar(el) {
      for (let e = el; e && e.tagName; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    // Eigener Hintergrund durchscheinend (0 < Alpha < 1) oder Verlauf mit
    // durchscheinenden Farben – das Muster, das iOS 12.2–12.5 auf GPU-Ebenen
    // teils schwarz zeichnet (WebKit-Fehler 197654).
    function durchsichtigerGrund(el) {
      const cs = getComputedStyle(el);
      const m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(cs.backgroundColor);
      if (m && +m[1] > 0 && +m[1] < 1) return "Grund " + cs.backgroundColor;
      const st = String(cs.backgroundImage).match(/rgba\([^)]*,\s*([\d.]+)\)/g) || [];
      if (st.some((x) => { const a = +/,\s*([\d.]+)\)$/.exec(x)[1]; return a > 0 && a < 1; })) return "Verlauf durchscheinend";
      return "";
    }
    const anim = document.getAnimations().map((a) => {
      const ziel = a.effect && a.effect.target;
      const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
      const r = ziel && ziel.getBoundingClientRect ? ziel.getBoundingClientRect() : { width: 0, height: 0, top: 0, left: 0 };
      return {
        art: a.constructor.name,
        name: a.animationName || a.transitionProperty || "",
        ziel: weg(ziel),
        sichtbar: ziel ? sichtbar(ziel) : false,
        endlos: t.iterations === Infinity,
        dauerMs: t.duration,
        restMs: t.endTime != null && a.currentTime != null ? Math.round(t.endTime - a.currentTime) : null,
        flaeche: Math.round(r.width) + "x" + Math.round(r.height) + "@" + Math.round(r.left) + "," + Math.round(r.top),
        status: a.playState,
        durchsichtig: ziel ? durchsichtigerGrund(ziel) : "",
      };
    });
    const willChange = [];
    document.querySelectorAll("*").forEach((el) => {
      const wc = getComputedStyle(el).willChange;
      if (wc && wc !== "auto") willChange.push({ ziel: weg(el), wert: wc, sichtbar: sichtbar(el) });
    });
    return { anim: anim, willChange: willChange, dom: document.getElementsByTagName("*").length };
  });
  console.log("Panel:", panel, "· DOM-Knoten:", bericht.dom, "· Seitenfehler:", fehler.length);
  fehler.forEach((f) => console.log("  Seitenfehler: " + f.slice(0, 200)));
  console.log("\nLaufende Animationen/Übergänge (" + bericht.anim.length + "):");
  bericht.anim.forEach((a) => {
    console.log((a.sichtbar ? "  [sichtbar] " : "  [unsichtb] ") + (a.durchsichtig ? "[DURCHSICHTIG: " + a.durchsichtig + "] " : "") + a.art + " " + a.name +
      (a.endlos ? " ENDLOS" : " rest " + a.restMs + " ms") + " " + a.status + "  " + a.flaeche + "\n      " + a.ziel);
  });
  console.log("\nwill-change (" + bericht.willChange.length + "):");
  bericht.willChange.forEach((w) => console.log((w.sichtbar ? "  [sichtbar] " : "  [unsichtb] ") + w.wert + "  " + w.ziel));
  if (jsonAus) fs.writeFileSync(jsonAus, JSON.stringify(bericht, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(2); });
