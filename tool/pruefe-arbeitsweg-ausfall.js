// Probe Arbeitsweg, wenn TomTom ausfällt (Sitzung 6, FEEDBACK „immer 6 Minuten“):
//   1. TomTom geht: Auto = echte Fahrzeit, wird gemerkt
//   2. TomTom fällt aus, gemerkter Wert da: Auto = dieser Wert, als
//      „geschätzt · … zuletzt gemessen …“ markiert, gewinnt nicht gegen echte Werte
//   3. TomTom fällt aus, nichts gemerkt: keine Autozeit („–“) statt der
//      halb so langen Transitous-/Luftlinien-Zeit
//   python3 -m http.server 8765 &  ·  node tool/pruefe-arbeitsweg-ausfall.js --out belege/…
"use strict";
const { webkit } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = (process.argv.indexOf("--out") !== -1 && process.argv[process.argv.indexOf("--out") + 1]) || "belege/arbeitsweg-ausfall";
const URL = "http://localhost:8765/index.html?jetzt=2026-10-12T07:05";
let fehler = 0;
function log(ok, text) { if (!ok) fehler++; console.log((ok ? "✓ " : "✗ ") + text); }

async function lauf(context, name, tomtomKaputt) {
  const page = await context.newPage();
  const codeFehler = [];
  page.on("pageerror", (e) => { if (!/access control checks/.test(e.message)) codeFehler.push(e.message); });
  if (tomtomKaputt) {
    await page.route(/api\.tomtom\.com\/routing\//, (r) => r.fulfill({ status: 403, contentType: "application/json", body: '{"error":"Simulierter Ausfall"}' }));
  }
  await page.goto(URL);
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll("#commuteRace .commute-race-row");
    return rows.length === 3 && !!document.querySelector(".commute-hero-big");
  }, null, { timeout: 45000 });
  await page.evaluate(() => jumpToPanel("commute"));
  await page.waitForTimeout(2500);
  const zustand = await page.evaluate(() => {
    const rows = [].slice.call(document.querySelectorAll("#commuteRace .commute-race-row"));
    const zeile = function (i) {
      const r = rows[i];
      return {
        zeit: (r.querySelector(".commute-race-kopfzeit") || {}).textContent || "",
        zusatz: (r.querySelector(".commute-race-extra") || {}).textContent || "",
        sieger: r.classList.contains("is-winner"),
      };
    };
    return { rad: zeile(0), bus: zeile(1), auto: zeile(2), held: (document.querySelector(".commute-hero-big") || {}).textContent || "" };
  });
  await page.screenshot({ path: path.join(OUT, name + ".png") });
  console.log("   " + name + ": Rad " + zustand.rad.zeit + " · Bus " + zustand.bus.zeit + " · Auto " + zustand.auto.zeit +
    (zustand.auto.zusatz ? " („" + zustand.auto.zusatz + "“)" : "") + " · oben: " + zustand.held);
  if (codeFehler.length) console.log("   Code-Fehler: " + codeFehler.join(" | "));
  await page.close();
  return { z: zustand, codeFehler: codeFehler };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  const a = await lauf(context, "1-tomtom-geht", false);
  const autoMin = parseInt(a.z.auto.zeit, 10);
  log(autoMin >= 8 && autoMin <= 25 && /Verzögerung|Stau/.test(a.z.auto.zusatz), "TomTom geht: Auto " + a.z.auto.zeit + " mit Verkehrsangabe (Gegenprobe 10.10.: 10,8 min)");

  const b = await lauf(context, "2-ausfall-mit-zuletzt", true);
  log(parseInt(b.z.auto.zeit, 10) === autoMin && /^geschätzt · Verkehrsdaten fehlen, zuletzt gemessen/.test(b.z.auto.zusatz), "Ausfall: Auto = zuletzt gemessener Wert, als „geschätzt“ markiert");
  log(!b.z.auto.sieger || (!/min/.test(b.z.rad.zeit) && !/min/.test(b.z.bus.zeit)), "Ausfall: geschätztes Auto gewinnt nicht gegen echte Rad-/Buszeit");

  const p = await context.newPage();
  await p.goto("http://localhost:8765/index.html");
  await p.evaluate(() => localStorage.removeItem("tafelRouteZuletzt"));
  await p.close();
  const c = await lauf(context, "3-ausfall-ohne-zuletzt", true);
  log(c.z.auto.zeit === "–", "Ausfall ohne gemerkten Wert: keine Autozeit („–“) statt 6 min");
  log(!/\b[1-7] min\b/.test(c.z.held), "Oben steht keine 5–7-Minuten-Autozeit");
  log(![a, b, c].some((x) => x.codeFehler.length), "keine Code-Fehler");

  await browser.close();
  console.log(fehler ? "\nFEHLER ✗ (" + fehler + ")" : "\nALLES ✓");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
