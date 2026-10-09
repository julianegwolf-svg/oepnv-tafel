// Dauerlauf-Probe ohne Berührung (FEEDBACK 10.10.): lässt die Tafel per
// Playwright-Uhr (page.clock) 2, 6 und 24 Stunden "laufen", ohne sie
// anzutippen, und prüft an jedem Messpunkt, ob das Karussell noch
// weiterschaltet und kein Ambient-Modus aktiv ist. Screenshots je Messpunkt.
//
//   node tool/pruefe-dauerlauf.js --url http://localhost:8765/index.html --out belege/2026-10-10/dauerlauf --prefix nachher-
//
// Die Zeit wird in 10-Minuten-Sprüngen vorgespult (fastForward): fällige
// Timer feuern dabei je Sprung höchstens einmal — genug, damit Karussell-
// und Ambient-Timer echt ablaufen, ohne Stunden an Netzabrufen nachzuholen.
const { webkit } = require("playwright");
const path = require("path");
const fs = require("fs");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const URL = arg("url", "http://localhost:8765/index.html");
const OUT = arg("out", "belege/dauerlauf");
const PREFIX = arg("prefix", "");
const START = arg("start", "2026-10-12T10:00:00");
const CHECKPOINTS_H = [2, 6, 24];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.clock.install({ time: new Date(START) });
  await page.goto(URL);
  await page.clock.runFor(8000);

  async function snapshot() {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await page.waitForLoadState("domcontentloaded");
        return await page.evaluate(() => ({
          ambient: typeof ambientActive !== "undefined" ? ambientActive : null,
          overlayVisible: !!document.querySelector(".ambient-overlay.is-active"),
          panel: (document.querySelector(".panel-view.active") || {}).id || null,
          clock: (document.getElementById("clockTime") || {}).textContent,
        }));
      } catch (e) {
        await page.waitForTimeout(500);
      }
    }
    return null;
  }

  let elapsedMin = 0;
  const results = [];
  let ok = true;
  for (const h of CHECKPOINTS_H) {
    while (elapsedMin < h * 60) {
      await page.clock.fastForward("00:10:00");
      elapsedMin += 10;
      try { await page.waitForLoadState("domcontentloaded", { timeout: 3000 }); } catch (e) { /* weiter */ }
    }
    const a = await snapshot();
    // Zwei Panel-Wechsel abwarten (max. ~2 x 50 s Anzeigedauer).
    await page.clock.fastForward("00:01:00");
    await page.clock.fastForward("00:01:00");
    elapsedMin += 2;
    const b = await snapshot();
    const moving = !!(a && b && a.panel !== b.panel);
    const pass = !!(a && b && !a.ambient && !a.overlayVisible && moving);
    if (!pass) ok = false;
    const file = path.join(OUT, PREFIX + "nach-" + h + "h.png");
    await page.screenshot({ path: file });
    results.push({ stunden: h, ambient: a && a.ambient, overlay: a && a.overlayVisible, panelVorher: a && a.panel, panelNachher: b && b.panel, uhr: a && a.clock, karussellLaeuft: moving, ok: pass, bild: file });
    console.log((pass ? "✓" : "✗") + " nach " + h + " h ohne Berührung: Ambient=" + (a && a.ambient) + ", Panel " + (a && a.panel) + " → " + (b && b.panel) + " (Uhr " + (a && a.clock) + ")  " + file);
  }
  if (errors.length) console.log("Seitenfehler:\n  " + errors.slice(0, 5).join("\n  "));
  fs.writeFileSync(path.join(OUT, PREFIX + "ergebnis.json"), JSON.stringify(results, null, 2));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
