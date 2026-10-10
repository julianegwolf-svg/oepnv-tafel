// Probe: Merkt die Tafel, wenn eine Schnellaktion nichts schaltet?
// (NIE gegen ein echtes Home Assistant.)
//
// Echtes HA meldet Fehler in Automationen nicht an den Aufrufer zurück –
// automation.trigger endet "erfolgreich", auch wenn die Automation bei der
// ersten Licht-Aktion abbricht (z. B. rgb_color + color_temp_kelvin).
// Die Tafel prüft deshalb, ob danach Zustände mit dem Kontext der
// Automation geändert wurden (ha-panels.js, pruefeWirkung).
//
//   HA_SIM_STRENG=1 PORT=8126 node tool/ha-simulator/server.js &   (bricht ab wie HA)
//   PORT=8125 node tool/ha-simulator/server.js &                   (nachsichtig)
//   node tool/pruefe-wirkung.js --sim http://localhost:8126 --erwartung keine --out belege/…/wirkung/streng
//   node tool/pruefe-wirkung.js --sim http://localhost:8125 --erwartung wirkt --out belege/…/wirkung/locker
//
// Optionen: --aktion nacht (Schnellaktion-id), --erwartung keine|wirkt
const { webkit } = require("playwright");
const path = require("path");
const fs = require("fs");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SIM = arg("sim", "http://localhost:8126");
const OUT = arg("out", "belege/wirkung");
const AKTION = arg("aktion", "nacht");
const ERWARTUNG = arg("erwartung", "keine");
const TOKEN = arg("token", "tafel-sim-token");

const results = [];
function log(ok, text) {
  results.push({ ok: ok, text: text });
  console.log((ok ? "✓ " : "✗ ") + text);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  const errors = [];
  // Kalender-Worker erlaubt localhost nicht (CORS) – extern, kein Code-Fehler.
  page.on("pageerror", (e) => { if (!/access control/i.test(e.message)) errors.push("pageerror: " + e.message); });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/access control|Access-Control|Failed to load resource|NetworkError|Load failed|status of 4\d\d|status of 5\d\d|cannot load|TomTom/i.test(t)) return;
    errors.push("console: " + t);
  });
  let n = 0;
  async function shot(name) {
    n++;
    const f = path.join(OUT, String(n).padStart(2, "0") + "-" + name + ".png");
    await page.screenshot({ path: f });
    console.log("   📷 " + f);
  }
  async function waitFor(fn, ms, a) {
    try { await page.waitForFunction(fn, a, { timeout: ms }); return true; } catch (e) { return false; }
  }

  await page.goto(SIM + "/local/tafel/index.html?ha_token=" + TOKEN);
  await page.evaluate(() => {
    CONFIG.nightDim = null; CONFIG.nightSleep = null; tickClock();
    const d = new Date();
    localStorage.setItem("tafelMorgengruss", d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate());
  });
  log(await waitFor(() => window.TafelHA && TafelHA.isConnected(), 15000), "Mit dem Simulator verbunden (" + SIM + ")");
  await page.waitForTimeout(1500);

  // Drei Lampen an – eine wirkende Automation muss dann etwas schalten.
  await page.evaluate(() => TafelHA.callService("light", "turn_on", null, { entity_id: TafelHA.model().global.lightsAll.slice(0, 3) }));
  await page.waitForTimeout(800);
  const anVorher = await page.evaluate(() => TafelHA.model().global.lightsAll.filter((id) => TafelHA.state(id).state === "on"));
  await page.evaluate(() => jumpToPanel("home"));
  await page.waitForTimeout(1200);
  await page.tap("#haHouseToggle");
  await page.waitForTimeout(600);
  const btn = await page.$('#haActionsMenu [data-aktion="' + AKTION + '"]');
  log(!!btn, "Schnellaktion „" + AKTION + "“ im Haus-Menü");
  if (!btn) { await browser.close(); process.exit(1); }
  await btn.tap();
  await page.waitForTimeout(1500);
  await shot("countdown");

  // Countdown (4 s) + Lauf + Prüffenster (5 s)
  const ende = await waitFor(() => {
    const t = document.querySelector(".ha-toast.is-shown");
    return t && /erledigt|nichts geschaltet|fehlgeschlagen|läuft noch/.test(t.textContent);
  }, 20000);
  const toast = await page.evaluate(() => { const t = document.querySelector(".ha-toast"); return t ? t.textContent + " [" + t.className + "]" : ""; });
  log(ende, "Rückmeldung: " + toast);
  await page.waitForTimeout(300);
  await shot("rueckmeldung");

  const anNachher = await page.evaluate(() => TafelHA.model().global.lightsAll.filter((id) => TafelHA.state(id).state === "on"));
  const geaendert = JSON.stringify(anVorher.slice().sort()) !== JSON.stringify(anNachher.slice().sort());
  console.log("   Lichter an vorher: " + anVorher.length + ", nachher: " + anNachher.length);
  await page.waitForTimeout(2500);
  const dunkel = await page.evaluate(() => Date.now() < goodNightUntil);
  const hinweis = await page.evaluate(() => TafelHAUI.hints().filter((h) => /wirkt nicht/.test(h.text)).map((h) => h.text));

  if (ERWARTUNG === "keine") {
    log(!geaendert, "Simulator (streng) hat wie echtes HA nichts geschaltet");
    log(/nichts geschaltet/.test(toast) && /is-warn/.test(toast), "Tafel meldet „hat nichts geschaltet“ statt „erledigt“");
    log(hinweis.length === 1, "Hinweisband: " + (hinweis[0] || "–"));
    if (AKTION === "nacht") log(!dunkel, "„Gute Nacht“ dunkelt die Tafel NICHT ab (die Lichter sind ja noch an)");
    await page.tap("#haHouseToggle").catch(() => {});
    await page.waitForTimeout(700);
    await shot("hinweis");
    await page.waitForTimeout(10000); // Toast (12 s) ist weg, Hinweis bleibt
    await shot("hinweis-danach");
  } else {
    log(geaendert, "Automation hat geschaltet (" + anVorher.length + " → " + anNachher.length + " Lichter an)");
    log(/erledigt/.test(toast) && !/nichts geschaltet/.test(toast), "Tafel meldet „erledigt“ – kein Fehlalarm");
    log(hinweis.length === 0, "Kein Hinweis im Band");
    if (AKTION === "nacht") log(dunkel, "„Gute Nacht“ dunkelt die Tafel ab");
    await shot("danach");
  }

  log(errors.length === 0, "Keine Code-Fehler in der Konsole" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad ? "\n" + bad + " Prüfung(en) fehlgeschlagen." : "\nAlle Prüfungen bestanden.");
  process.exit(bad ? 1 : 0);
})();
