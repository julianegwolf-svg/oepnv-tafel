// Medien-Panel im Karussell: läuft → drin; gerade pausiert → drin;
// seit über 30 min pausiert → raus (über die Übersicht erreichbar).
// Gegen den Simulator (NIE ein echtes HA). "Über 30 min" per ?jetzt=
// (Seitenuhr 45 min vorgestellt).
//
//   node tool/pruefe-medien-pause.js --sim http://localhost:8124 [--out belege/…]
//   [--alt /tmp/ha-panels-alt.js]  (ältere ha-panels.js einspielen = Vorher-Probe)
const { webkit } = require("playwright");
const path = require("path");
const fs = require("fs");
function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const SIM = arg("sim", "http://localhost:8124");
const OUT = arg("out", "belege/medien-pause");
const MP = arg("entity", "media_player.office_homepod");
let fehler = 0;
const log = (ok, t) => { if (!ok) fehler++; console.log((ok ? "✓ " : "✗ ") + t); };
const setze = (state) => fetch(SIM + "/sim/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_id: MP, state: state }) }).then((r) => r.json());
const p2 = (n) => String(n).padStart(2, "0");
const lokal = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + "T" + p2(d.getHours()) + ":" + p2(d.getMinutes());

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  async function verfuegbar(jetzt, foto) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    // Morgengruß gilt als schon gezeigt – sonst legt er sich übers Bild.
    await page.addInitScript(() => {
      const n = new Date();
      try { localStorage.setItem("tafelMorgengruss", n.getFullYear() + "-" + (n.getMonth() + 1) + "-" + n.getDate()); } catch (e) { /* egal */ }
    });
    const alt = arg("alt", "");
    if (alt) {
      await page.route((u) => u.pathname.endsWith("/ha-panels.js"), (route) =>
        route.fulfill({ status: 200, contentType: "application/javascript; charset=utf-8", body: fs.readFileSync(alt) }));
    }
    await page.goto(SIM + "/local/tafel/index.html?ha_token=tafel-sim-token" + (jetzt ? "&jetzt=" + jetzt : ""));
    await page.waitForFunction(() => window.TafelHA && TafelHA.isConnected && TafelHA.isConnected(), null, { timeout: 20000 });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => ({ medien: TafelHAUI.panelAvailable("medien") }));
    // Übersicht per echtem Antippen öffnen: steht "Medien" drin?
    await page.locator("#panelNavToggle").tap().catch(() => page.locator("#panelNavToggle").click());
    await page.waitForTimeout(800);
    r.uebersicht = await page.evaluate(() => Array.prototype.some.call(document.querySelectorAll(".panel-nav-tile-label"), (e) => e.textContent === "Medien"));
    if (foto) await page.screenshot({ path: path.join(OUT, foto) });
    if (r.uebersicht && foto) {
      await page.locator(".panel-nav-tile", { hasText: "Medien" }).first().click();
      await page.waitForTimeout(1500);
      r.gezeigt = await page.evaluate(() => document.getElementById("panel-medien").classList.contains("active"));
      await page.screenshot({ path: path.join(OUT, foto.replace(".png", "-geoeffnet.png")) });
    }
    await page.close();
    return r;
  }
  let st = await setze("playing");
  let r = await verfuegbar(null);
  log(r.medien, "läuft → Medien im Karussell (" + st.state + ")");
  st = await setze("paused");
  r = await verfuegbar(null);
  log(r.medien, "gerade pausiert → Medien noch im Karussell");
  r = await verfuegbar(lokal(new Date(Date.now() + 45 * 60000)), "uebersicht-pausiert-45min.png");
  log(!r.medien, "seit 45 min pausiert → nicht mehr im Karussell");
  log(r.uebersicht, "… aber in der Übersicht erreichbar");
  log(r.gezeigt === true, "… und per Tipp auf die Kachel geöffnet");
  await browser.close();
  console.log(fehler ? fehler + " Fehler" : "Alle Prüfungen bestanden.");
  process.exit(fehler ? 1 : 0);
})();
