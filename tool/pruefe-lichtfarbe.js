#!/usr/bin/env node
// ---------------------------------------------------------------
// Probe „Leisten und Kacheln in der Lichtfarbe“ (FEEDBACK 10.10. 12:42):
// Szenen Frühling (Büro), Polarlicht (Wohnzimmer), Sonnenuntergang
// (Schlafzimmer) im eigenen Simulator mit ha-vorschlag/scenes.yaml
// auslösen; je Raum prüfen: Lampenleiste in der Lampenfarbe, Raumleiste
// als Verlauf aus den Lampenfarben, Zahl lesbar, aktive Szene als ganze
// Kachel im Szenenverlauf, Zuhause-Kachel mit mehreren Lichtkegeln. Bilder.
//   node tool/pruefe-lichtfarbe.js [--out …] [--port 8148] [--vorher]
// --vorher: Seite aus HEAD ausliefern (alter Stand, für Vorher-Bilder).
// ---------------------------------------------------------------
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn, execFileSync } = require("child_process");
const { webkit } = require("playwright");

const args = process.argv.slice(2);
const opt = (n, s) => { const i = args.indexOf("--" + n); return i === -1 ? s : args[i + 1]; };
const PORT = Number(opt("port", "8148"));
const VORHER = args.indexOf("--vorher") !== -1;
const OUT = path.resolve(opt("out", "belege/2026-10-10/s8/lichtfarbe" + (VORHER ? "-vorher" : "")));
fs.mkdirSync(OUT, { recursive: true });
const SIM = "http://localhost:" + PORT;
const REPO = path.resolve(__dirname, "..");
const SZENEN = path.join(REPO, "ha-vorschlag", "scenes.yaml");

let ok = 0, schlecht = 0;
function pruefe(bed, text) {
  if (VORHER) { console.log("  (vorher) " + text); return; }
  if (bed) { ok++; console.log("✓ " + text); } else { schlecht++; console.log("✗ " + text); }
}

function warteAufSim() {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function versuch() {
      http.get(SIM + "/sim/status", (r) => { r.resume(); res(); }).on("error", () => {
        if (Date.now() - t0 > 15000) rej(new Error("Simulator startet nicht")); else setTimeout(versuch, 300);
      });
    })();
  });
}

(async () => {
  if (!fs.existsSync(SZENEN)) { console.log("ha-vorschlag/scenes.yaml fehlt (privat, nicht im Repo) – Probe übersprungen"); process.exit(0); }
  const sim = spawn(process.execPath, [path.join(__dirname, "ha-simulator", "server.js")], {
    env: Object.assign({}, process.env, { PORT: String(PORT), HA_SIM_LEISE: "1", HA_SIM_SZENEN: SZENEN, HA_SIM_SZENEN_BEREICH: "1" }), stdio: "ignore",
  });
  let browser;
  try {
    await warteAufSim();
    browser = await webkit.launch();
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    const page = await ctx.newPage();
    const fehler = [];
    page.on("pageerror", (e) => { if (!/access control|Load failed|Failed to fetch/i.test(String(e))) fehler.push(String(e)); });
    if (VORHER) {
      await page.route(/\/local\/tafel\/([\w.-]+\.(?:js|html|css))(\?|$)/, (route) => {
        const datei = /\/local\/tafel\/([\w.-]+\.(?:js|html|css))/.exec(route.request().url())[1];
        let body;
        try { body = execFileSync("git", ["show", "HEAD:" + datei], { cwd: REPO, maxBuffer: 1 << 24 }); } catch (e) { return route.continue(); }
        route.fulfill({ status: 200, contentType: datei.endsWith(".html") ? "text/html" : datei.endsWith(".css") ? "text/css" : "application/javascript", body: body });
      });
    }
    await page.goto(SIM + "/local/tafel/index.html?ha_token=tafel-sim-token");
    await page.waitForFunction(() => window.TafelHA && TafelHA.isConnected(), null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    const faelle = [["buero", "Frühling"], ["wohnzimmer", "Polarlicht"], ["schlafzimmer", "Sonnenuntergang"]];
    for (const [raum, name] of faelle) {
      const sid = await page.evaluate((a) => Object.keys(TafelHA.states()).filter((id) => /^scene\./.test(id) &&
        (TafelHA.attr(TafelHA.state(id), "friendly_name") || "").indexOf(a.name) !== -1 &&
        (TafelHA.attr(TafelHA.state(id), "friendly_name") || "").toLowerCase().replace("ü", "ue").indexOf(a.raum.slice(0, 4)) === 0)[0], { name: name, raum: raum });
      if (!sid) { pruefe(false, raum + ": Szene „" + name + "“ gefunden"); continue; }
      await page.evaluate((id) => TafelHA.callService("scene", "turn_on", null, { entity_id: id }), sid);
      await page.waitForTimeout(1500);
      const rid = await page.evaluate((r) => TafelHA.model().rooms.filter((x) => x.name.toLowerCase().replace("ü", "ue").indexOf(r.slice(0, 4)) === 0).map((x) => x.id)[0], raum);
      await page.evaluate((r) => { jumpToPanel("home"); pauseCarouselIndefinitely(); }, rid);
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(OUT, raum + "-zuhause.png") });
      const kachel = await page.evaluate((r) => {
        const k = document.querySelector('.ha-room[data-raum="' + r + '"] .ha-room-glow');
        return k ? k.style.background : "";
      }, rid);
      pruefe((kachel.match(/radial-gradient/g) || []).length >= 2, raum + ": Zuhause-Kachel mit mehreren Lichtkegeln in den Lampenfarben");
      await page.evaluate((r) => { const k = document.querySelector('.ha-room[data-raum="' + r + '"]'); if (k) k.click(); }, rid);
      await page.waitForTimeout(1300);
      const info = await page.evaluate(() => {
        const zeilen = [].map.call(document.querySelectorAll(".ha-overlay .ha-light.is-on"), (z) => {
          const dot = z.querySelector(".ha-light-dot");
          const fill = z.querySelector(".ha-slider-hell .ha-slider-fill");
          const sl = z.querySelector(".ha-slider-hell");
          return { dot: dot ? dot.style.background : "", fill: fill ? fill.style.background : "", hell: sl ? sl.classList.contains("is-hell") : false, name: (z.querySelector(".ha-light-name") || {}).textContent };
        });
        const raumFill = document.querySelector(".ha-overlay .ha-slider-raum .ha-slider-fill");
        const aktiv = document.querySelector(".ha-overlay .ha-scene.is-active");
        const tint = aktiv ? aktiv.querySelector(".ha-scene-tint") : null;
        const tb = tint ? tint.getBoundingClientRect() : null;
        const ab = aktiv ? aktiv.getBoundingClientRect() : null;
        return { zeilen: zeilen, raum: raumFill ? raumFill.style.background : "", aktiv: aktiv ? aktiv.textContent : "", tintVoll: !!(tb && ab && tb.width >= ab.width - 4) };
      });
      // Farbe der Lampe (Punkt) steckt in der Leiste
      const passend = info.zeilen.filter((z) => z.fill && z.dot && z.fill.indexOf(z.dot.replace(/\s/g, "").replace("rgb(", "").replace(")", "").split(",")[0]) !== -1);
      pruefe(info.zeilen.length > 0 && passend.length === info.zeilen.length,
        raum + ": " + info.zeilen.length + " Lampenleisten in ihrer Lichtfarbe (" + info.zeilen.map((z) => z.name + " " + z.dot).join("; ") + ")");
      pruefe((info.raum.match(/rgb\(/g) || []).length >= 2, raum + ": Raumleiste als Verlauf aus den Lampenfarben");
      pruefe(info.aktiv.indexOf(name) !== -1 && info.tintVoll, raum + ": aktive Szene „" + info.aktiv.trim() + "“ als ganze Kachel im Szenenverlauf");
      await page.screenshot({ path: path.join(OUT, raum + "-raum.png") });
      await page.evaluate(() => { const c = document.querySelector(".ha-overlay [data-act='schliessen'], .ha-overlay .ha-close"); if (c) c.click(); });
      await page.keyboard.press("Escape").catch(() => {});
      await page.evaluate(() => { if (window.TafelHAUI && TafelHAUI.closeRoom) TafelHAUI.closeRoom(); });
      await page.waitForTimeout(600);
    }
    pruefe(fehler.length === 0, "keine Seitenfehler" + (fehler.length ? " – " + fehler.join(" | ").slice(0, 300) : ""));
  } finally {
    if (browser) await browser.close();
    sim.kill();
  }
  if (!VORHER) console.log("\n" + (schlecht ? "✗ " + schlecht + " von " + (ok + schlecht) + " Prüfungen fehlgeschlagen" : "✓ alle " + ok + " Prüfungen bestanden"));
  process.exit(schlecht ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
