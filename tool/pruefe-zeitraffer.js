// 24-h-Zeitrafferprobe der ganzen Tafel (AUSBAU E24): Playwright spult die
// Uhr in 10-Minuten-Sprüngen vor (fällige Timer feuern dabei je Sprung
// einmal), das Karussell läuft, alle Abrufe laufen echt. Alle 30 Minuten
// wird gemessen: DOM-Knoten, aktive Intervalle/Timeouts, Listener an
// lebenden Elementen, geladene Bilder, Video-Elemente.
//
//   node tool/pruefe-zeitraffer.js --stunden 24 --out belege/2026-10-10/zeitraffer
//
// Die Tafel lädt sich alle 3 Stunden selbst neu (fullReloadMs) — gemessen
// wird deshalb je 3-h-Abschnitt: innerhalb eines Abschnitts darf nichts
// stetig wachsen, nach jedem Neuladen muss wieder dasselbe Niveau gelten.
const { webkit } = require("playwright");
const path = require("path");
const fs = require("fs");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const URL = arg("url", "http://localhost:8765/index.html");
const STUNDEN = parseFloat(arg("stunden", "24"));
const OUT = arg("out", "belege/zeitraffer");
const START = arg("start", "2026-10-12T05:00:00");

// Listener-Zähler läuft ab Dokumentbeginn (Init-Skript). Die Timer-Zähler
// werden NACH dem Laden über die Fake-Timer der Playwright-Uhr gelegt
// (die ersetzt setInterval/setTimeout selbst): gezählt wird also, wie
// viele Intervalle/Timeouts seit dem Laden NEU dazukommen und offen
// bleiben — genau das, was bei einem Leck wachsen würde.
const TIMER_ZAEHLER = `
(function () {
  if (window.__timerZaehler) return;
  var activeIntervals = {}, activeTimeouts = {};
  var si = window.setInterval, ci = window.clearInterval, st = window.setTimeout, ct = window.clearTimeout;
  window.setInterval = function () { var id = si.apply(window, arguments); activeIntervals[id] = 1; return id; };
  window.clearInterval = function (id) { delete activeIntervals[id]; return ci.call(window, id); };
  window.setTimeout = function (fn) {
    var args = Array.prototype.slice.call(arguments), id;
    if (typeof fn === "function") args[0] = function () { delete activeTimeouts[id]; return fn.apply(this, arguments); };
    id = st.apply(window, args); activeTimeouts[id] = 1; return id;
  };
  window.clearTimeout = function (id) { delete activeTimeouts[id]; return ct.call(window, id); };
  window.__timerZaehler = function () { return { intervalle: Object.keys(activeIntervals).length, timeouts: Object.keys(activeTimeouts).length }; };
})();`;

const ZAEHLER = `
(function () {
  var ael = EventTarget.prototype.addEventListener, rel = EventTarget.prototype.removeEventListener, records = [];
  EventTarget.prototype.addEventListener = function (type, fn) { records.push({ t: new WeakRef(this), type: type, fn: new WeakRef(fn) }); return ael.apply(this, arguments); };
  EventTarget.prototype.removeEventListener = function (type, fn) {
    for (var i = records.length - 1; i >= 0; i--) { if (records[i].t.deref() === this && records[i].type === type && records[i].fn.deref() === fn) { records.splice(i, 1); break; } }
    return rel.apply(this, arguments);
  };
  window.__zaehler = function () {
    records = records.filter(function (r) { var t = r.t.deref(); return !!t; });
    var live = records.filter(function (r) { var t = r.t.deref(); return t === window || t === document || (t.nodeType && t.isConnected); }).length;
    var t = window.__timerZaehler ? window.__timerZaehler() : { intervalle: -1, timeouts: -1 };
    return {
      dom: document.getElementsByTagName("*").length,
      intervalle: t.intervalle,
      timeouts: t.timeouts,
      listener: live,
      bilder: document.querySelectorAll("img[src]").length,
      videos: document.getElementsByTagName("video").length,
    };
  };
})();`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await context.addInitScript(ZAEHLER);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (!/access control checks|__jsonp_cb/.test(e.message)) errors.push(e.message); });
  await page.clock.install({ time: new Date(START) });
  await page.goto(URL);
  await page.clock.runFor(8000);
  await page.evaluate(TIMER_ZAEHLER);

  const proben = [];
  let minuten = 0;
  let ladeZaehler = 0;
  let letzteUrl = page.url();
  while (minuten < STUNDEN * 60) {
    await page.clock.fastForward("00:10:00");
    minuten += 10;
    try { await page.waitForLoadState("domcontentloaded", { timeout: 3000 }); } catch (e) { /* weiter */ }
    if (page.url() !== letzteUrl) {
      ladeZaehler++;
      letzteUrl = page.url();
      try { await page.evaluate(TIMER_ZAEHLER); } catch (e) { /* nächster Sprung */ }
    }
    if (minuten % 30 === 0) {
      let z = null;
      for (let v = 0; v < 4 && !z; v++) {
        try { z = await page.evaluate(() => window.__zaehler && window.__zaehler()); } catch (e) { await page.waitForTimeout(400); }
      }
      if (!z) continue;
      z.stunde = Math.round(minuten / 6) / 10;
      z.abschnitt = ladeZaehler;
      proben.push(z);
      console.log("h " + z.stunde + " (Abschnitt " + z.abschnitt + "): DOM " + z.dom + ", Intervalle " + z.intervalle + ", Timeouts " + z.timeouts + ", Listener " + z.listener + ", Bilder " + z.bilder + ", Videos " + z.videos);
    }
  }
  await page.screenshot({ path: path.join(OUT, "nach-" + STUNDEN + "h.png") });
  await browser.close();

  // Bewertung: Inhalte laden je Abschnitt unterschiedlich schnell nach
  // (News-Bilder, Diashows) — verglichen werden deshalb die MAXIMA je
  // 3-h-Abschnitt: sie dürfen über 24 h nicht steigen. Neu hinzukommende
  // offene Intervalle müssen 0 bleiben, Timeouts klein.
  const abschnitte = {};
  proben.forEach((p) => { (abschnitte[p.abschnitt] = abschnitte[p.abschnitt] || []).push(p); });
  const maxima = Object.keys(abschnitte).map((k) => {
    const l = abschnitte[k];
    const m = (f) => Math.max.apply(null, l.map((p) => p[f]));
    return { abschnitt: k, dom: m("dom"), listener: m("listener"), bilder: m("bilder"), intervalle: m("intervalle"), timeouts: m("timeouts"), videos: m("videos") };
  });
  let ok = true;
  const erst = maxima[0];
  maxima.forEach((x) => {
    // Diashows/Ticker des gerade sichtbaren Panels starten eigene
    // Intervalle und beenden sie beim Wechsel — die zählen mit, dürfen
    // aber über die Abschnitte nicht mehr werden.
    const pass = x.dom <= erst.dom * 1.15 && x.listener <= erst.listener + 5 && x.intervalle <= erst.intervalle &&
      x.timeouts <= erst.timeouts + 5 && x.videos <= 1 && x.bilder <= 25;
    if (!pass) ok = false;
    console.log((pass ? "✓" : "✗") + " Abschnitt " + x.abschnitt + " (max): DOM " + x.dom + ", Listener " + x.listener + ", neue offene Intervalle " + x.intervalle + ", Timeouts " + x.timeouts + ", Bilder " + x.bilder + ", Videos " + x.videos);
  });
  const ergebnisse = maxima;
  if (errors.length) { console.log("✗ Seitenfehler: " + errors.slice(0, 3).join(" | ")); ok = false; } else console.log("✓ Keine Seitenfehler");
  console.log("Neuladen (fullReloadMs): " + ladeZaehler + "×");
  fs.writeFileSync(path.join(OUT, "proben.json"), JSON.stringify({ proben, ergebnisse, errors, ladeZaehler }, null, 2));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
