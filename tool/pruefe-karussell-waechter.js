// Probe: Läuft das Karussell weiter, wenn beim Panelwechsel etwas schiefgeht?
// (FEEDBACK 10.10.: ein stehendes Karussell stört an der Wand am meisten.)
//  1. Eine Verfügbarkeitsprüfung wirft eine Ausnahme → Wechsel geht weiter.
//  2. Ein Panel wirft beim Zeigen eine Ausnahme → Wechsel geht weiter.
//  3. Der Wechsel-Timer geht verloren → der Wächter wirft das Karussell
//     nach spätestens ~3 min wieder an.
//  4. Absichtliche Pause (Übersicht offen) → Wächter greift NICHT ein.
//
//   node tool/pruefe-karussell-waechter.js [--alt /tmp/app-alt.js] [--out belege/…/karussell]
const { webkit } = require("playwright");
const fs = require("fs");
const path = require("path");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const URL = arg("url", "http://localhost:8765/index.html");
const OUT = arg("out", "");
const results = [];
function log(ok, text) { results.push(ok); console.log((ok ? "✓ " : "✗ ") + text); }

(async () => {
  const browser = await webkit.launch();
  const page = await (await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true })).newPage();
  if (arg("alt", "")) {
    const alt = fs.readFileSync(arg("alt", ""), "utf8");
    await page.route(/\/app\.js(\?|$)/, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: alt }));
  }
  await page.clock.install({ time: new Date("2026-10-12T10:00:00") });
  await page.goto(URL);
  await page.clock.runFor(8000);
  const panel = () => page.evaluate(() => (document.querySelector(".panel-view.active") || {}).id);
  // Panels wechseln in der Zeit? (bis zu 3 Sprünge à 1 min)
  // Wirft ein Timer-Callback (alte Fassung), meldet Playwright das beim
  // Vorspulen – im echten Browser bliebe das Karussell dann stehen.
  let geworfen = 0;
  async function spule(dauer) {
    try { await page.clock.fastForward(dauer); } catch (e) { geworfen++; }
  }
  async function wechselt(minuten) {
    const a = await panel();
    for (let i = 0; i < minuten; i++) {
      await spule("00:01:00");
      if ((await panel()) !== a) return true;
    }
    return false;
  }

  // 1. Verfügbarkeitsprüfung wirft
  await page.evaluate(() => { PANEL_AVAILABILITY.weather = function () { throw new Error("Testfehler Verfügbarkeit"); }; });
  let ok1 = true;
  for (let i = 0; i < 6; i++) if (!(await wechselt(2))) { ok1 = false; break; }
  log(ok1, "Verfügbarkeitsprüfung wirft – das Karussell wechselt trotzdem weiter (6 Wechsel)");
  await page.evaluate(() => { PANEL_AVAILABILITY.weather = function () { return true; }; });

  // 2. Panel wirft beim Zeigen (Hook)
  await page.evaluate(() => {
    window.__altShow = window.TafelTag ? TafelTag.onPanelShown : null;
    if (window.TafelTag) TafelTag.onPanelShown = function () { throw new Error("Testfehler Panel"); };
  });
  let ok2 = true;
  for (let i = 0; i < 6; i++) if (!(await wechselt(2))) { ok2 = false; break; }
  log(ok2, "Panel wirft beim Zeigen – das Karussell wechselt trotzdem weiter (6 Wechsel)");
  await page.evaluate(() => { if (window.TafelTag && window.__altShow) TafelTag.onPanelShown = window.__altShow; });

  // 3. Timer verloren
  await page.evaluate(() => { clearTimeout(carouselTimer); carouselTimer = null; });
  const a3 = await panel();
  let nach = null;
  for (let m = 1; m <= 6; m++) {
    await spule("00:01:00");
    if ((await panel()) !== a3) { nach = m; break; }
  }
  log(nach !== null && nach <= 4, "Wechsel-Timer verloren – Wächter wirft das Karussell wieder an" + (nach ? " (nach " + nach + " min)" : " (nicht innerhalb 6 min)"));
  log(await wechselt(3), "… und danach läuft es normal weiter");

  // 3b. Wächter greift ein, während noch ein Wechsel-Timer läuft (Uhr
  // sprang, z. B. nach eingefrorenem JavaScript): danach darf es nur EINE
  // Kette geben – vorher liefen zwei parallel und wurden immer mehr.
  const ketten = await page.evaluate(() => {
    if (typeof karussellWaechter !== "function") return { hatteTimer: !!carouselTimer, altWeg: false, neuerTimer: false, fehlt: "kein Wächter" };
    const alt = carouselTimer;
    let altWeg = false;
    const ct = window.clearTimeout;
    window.clearTimeout = function (id) { if (id === alt) altWeg = true; return ct.apply(window, arguments); };
    letzterPanelWechsel = Date.now() - 10 * 60 * 1000; // "steht seit 10 min"
    karussellWaechter();
    window.clearTimeout = ct;
    return { hatteTimer: alt != null, altWeg: altWeg, neuerTimer: carouselTimer != null && carouselTimer !== alt };
  });
  log(ketten.hatteTimer && ketten.altWeg && ketten.neuerTimer, "Wächter bei laufendem Timer: alter Timer abgeräumt, genau eine Kette (" + JSON.stringify(ketten) + ")");

  // 4. Absichtliche Pause
  await page.evaluate(() => { setPanelNavOpen(true); });
  const a4 = await panel();
  for (let m = 0; m < 6; m++) await spule("00:01:00");
  log((await panel()) === a4 && (await page.evaluate(() => panelNavOpen)), "Übersicht offen: Wächter lässt die gewollte Pause in Ruhe (6 min)");
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, (arg("alt", "") ? "alt-" : "") + "ende.png") }); }

  if (geworfen) console.log("   (" + geworfen + "× warf ein Timer-Callback eine Ausnahme bis in die Seite)");
  await browser.close();
  const bad = results.filter((r) => !r).length;
  console.log(bad ? "\n" + bad + " Prüfung(en) fehlgeschlagen." : "\nAlle Prüfungen bestanden.");
  process.exit(bad ? 1 : 0);
})();
