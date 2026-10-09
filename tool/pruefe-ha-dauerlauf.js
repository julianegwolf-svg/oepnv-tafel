// Dauerlauf der HA-Anbindung gegen den Simulator: Die Tafel läuft echte
// Minuten lang mit stark beschleunigten Sensor-Ereignissen und
// zwischendurch harten Verbindungsabbrüchen, schaltet durch alle Panels,
// öffnet Raumansichten — und misst jede Minute, ob irgendetwas wächst:
// DOM-Knoten, aktive Intervalle/Timeouts, offene Anfragen, optimistische
// Werte, Verlaufspunkte, Event-Listener.
//
// Simulator dafür mit schnellem Takt + Chaos starten, z. B.
//   HA_SIM_TICK_MS=200 HA_SIM_CHAOS_S=90 node tool/ha-simulator/server.js
//   node tool/pruefe-ha-dauerlauf.js --minuten 20 --out belege/2026-10-10/ha-dauerlauf
//
// Bei 200 ms Takt entsprechen 20 Minuten etwa 8 Stunden Ereignissen im
// normalen 5-s-Takt; 60 Minuten ≈ 24 Stunden.
const { webkit } = require("playwright");
const path = require("path");
const fs = require("fs");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SIM = arg("sim", "http://localhost:8124");
const OUT = arg("out", "belege/ha-dauerlauf");
const MINUTEN = parseFloat(arg("minuten", "10"));
const USER = arg("user", "tafel");
const PASS = arg("pass", "tafel-passwort");

// Zählt aktive Timer und Listener, ohne das Verhalten zu ändern.
const ZAEHLER = `
(function () {
  var activeIntervals = {}, activeTimeouts = {}, listeners = 0;
  var si = window.setInterval, ci = window.clearInterval, st = window.setTimeout, ct = window.clearTimeout;
  window.setInterval = function () { var id = si.apply(window, arguments); activeIntervals[id] = 1; return id; };
  window.clearInterval = function (id) { delete activeIntervals[id]; return ci.call(window, id); };
  window.setTimeout = function (fn) {
    var args = Array.prototype.slice.call(arguments);
    var id;
    if (typeof fn === "function") {
      args[0] = function () { delete activeTimeouts[id]; return fn.apply(this, arguments); };
    }
    id = st.apply(window, args); activeTimeouts[id] = 1; return id;
  };
  window.clearTimeout = function (id) { delete activeTimeouts[id]; return ct.call(window, id); };
  // Listener nur zählen, solange ihr Ziel noch lebt (window/document oder
  // ein Element, das noch im DOM hängt) — Listener an weggeworfenen
  // Elementen räumt der Garbage Collector ab, die sind kein Leck.
  var ael = EventTarget.prototype.addEventListener, rel = EventTarget.prototype.removeEventListener;
  var records = [];
  EventTarget.prototype.addEventListener = function (type, fn) {
    records.push({ t: new WeakRef(this), type: type, fn: new WeakRef(fn) });
    return ael.apply(this, arguments);
  };
  EventTarget.prototype.removeEventListener = function (type, fn) {
    for (var i = records.length - 1; i >= 0; i--) {
      if (records[i].t.deref() === this && records[i].type === type && records[i].fn.deref() === fn) { records.splice(i, 1); break; }
    }
    return rel.apply(this, arguments);
  };
  window.__tafelZaehler = function () {
    records = records.filter(function (r) {
      var t = r.t.deref();
      return t && (t === window || t === document || (t.nodeType && t.isConnected) || (!t.nodeType && t !== null));
    });
    var live = records.filter(function (r) { var t = r.t.deref(); return t === window || t === document || (t.nodeType && t.isConnected); }).length;
    return { intervalle: Object.keys(activeIntervals).length, timeouts: Object.keys(activeTimeouts).length, listener: live };
  };
})();`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await context.addInitScript(ZAEHLER);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (!/access control checks/.test(e.message)) errors.push(e.message); });

  await page.goto(SIM + "/local/tafel/index.html");
  await page.waitForSelector("#haLogin.is-open", { timeout: 10000 });
  await page.fill("#haLoginUser", USER);
  await page.fill("#haLoginPass", PASS);
  await page.tap("#haLoginSubmit");
  await page.waitForFunction(() => window.TafelHA && TafelHA.isConnected(), null, { timeout: 15000 });
  await page.waitForTimeout(3000);

  const proben = [];
  const panels = ["home", "klima", "medien", "departures", "weather", "home"];
  const start = Date.now();
  let runde = 0;
  let reconnects = 0;
  let warVerbunden = true;

  while (Date.now() - start < MINUTEN * 60 * 1000) {
    // Eine Minute lang: Panels durchschalten, Raum öffnen/schließen, Licht schalten.
    const minuteEnde = Date.now() + 60 * 1000;
    while (Date.now() < minuteEnde) {
      const p = panels[runde % panels.length];
      runde++;
      await page.evaluate((name) => { try { jumpToPanel(name); } catch (e) {} }, p);
      await page.waitForTimeout(2500);
      if (p === "home") {
        await page.evaluate(() => {
          const m = TafelHA.model();
          const r = m.rooms.filter((x) => x.lights.length)[0];
          if (r && TafelHA.isConnected()) {
            TafelHAUI.openRoom(r.id);
            TafelHA.callService("light", "toggle", null, { entity_id: r.lights[0] }).catch(() => {});
          }
        });
        await page.waitForTimeout(2500);
        await page.evaluate(() => TafelHAUI.closeRoom());
      }
      const verbunden = await page.evaluate(() => TafelHA.isConnected());
      if (verbunden && !warVerbunden) reconnects++;
      warVerbunden = verbunden;
    }
    const probe = await page.evaluate(() => {
      const z = window.__tafelZaehler();
      const ui = TafelHAUI.debug();
      const ha = TafelHA.debug();
      return {
        dom: ui.domNodes,
        intervalle: z.intervalle,
        timeouts: z.timeouts,
        listener: z.listener,
        offeneAnfragen: ha.pending,
        haListener: ha.listeners,
        optimistisch: ui.optimistic,
        verlaufspunkte: ui.historyPoints,
        status: ha.status,
        entitaeten: ha.entities,
      };
    });
    probe.minute = Math.round((Date.now() - start) / 60000);
    proben.push(probe);
    console.log("min " + probe.minute + ": DOM " + probe.dom + ", Intervalle " + probe.intervalle + ", Timeouts " + probe.timeouts +
      ", Listener " + probe.listener + ", Anfragen " + probe.offeneAnfragen + ", optimistisch " + probe.optimistisch +
      ", Verlauf " + probe.verlaufspunkte + ", " + probe.status + " (Wiederverbindungen bisher " + reconnects + ")");
  }

  let simStatus = null;
  try { simStatus = await (await fetch(SIM + "/sim/status")).json(); } catch (e) { /* egal */ }
  await page.screenshot({ path: path.join(OUT, "ende.png") });
  await browser.close();

  // Bewertung: zweite Hälfte vs. erste Messung nach dem Einschwingen.
  const basis = proben[Math.min(1, proben.length - 1)];
  const ende = proben[proben.length - 1];
  const checks = [
    ["DOM-Knoten stabil (±10 %)", Math.abs(ende.dom - basis.dom) <= basis.dom * 0.1],
    ["Intervalle wachsen nicht", ende.intervalle <= basis.intervalle],
    ["Timeouts wachsen nicht (±15)", ende.timeouts <= basis.timeouts + 15],
    ["Listener wachsen nicht (±20)", ende.listener <= basis.listener + 20],
    ["Keine hängenden Anfragen", ende.offeneAnfragen <= 2],
    ["HA-Listener konstant", ende.haListener === basis.haListener],
    ["Verlaufspunkte begrenzt", ende.verlaufspunkte <= 24 * 12 * 20],
    ["Keine Seitenfehler", errors.length === 0],
  ];
  let ok = true;
  checks.forEach((c) => { console.log((c[1] ? "✓ " : "✗ ") + c[0]); if (!c[1]) ok = false; });
  console.log("Wiederverbindungen: " + reconnects + (simStatus ? ", Simulator: " + JSON.stringify({ verbindungen: simStatus.verbindungen || simStatus.connections, abos: simStatus.subscriptions || simStatus.abos }) : ""));
  if (errors.length) console.log("Fehler: " + errors.slice(0, 5).join(" | "));
  fs.writeFileSync(path.join(OUT, "proben.json"), JSON.stringify({ proben, checks, reconnects, errors, simStatus }, null, 2));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
