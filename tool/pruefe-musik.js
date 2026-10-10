// Probe Musik-Charts (Sitzung 6): Apple-Music-Liste über den HA-REST-Sensor.
//   1. ohne HA (GitHub-Pages-Fall, kein Proxy): Panel fällt weg, kein Deezer
//   2. HA ohne Sensor (Julians HA heute): Panel fällt weg
//   3. HA mit Sensor (Simulator --charts): Liste = Sensor, Reihenfolge,
//      Beschriftung "Apple Music · meistgespielt · Stand …"
//   4. Sensor ändert sich (stündlicher Abruf in HA) → Panel folgt ohne Neuladen
//   5. Sensor 5 Tage alt → Panel fällt weg (nichts veraltet still)
//
//   PORT=8141 HA_SIM_CHARTS=1 node tool/ha-simulator/server.js &
//   PORT=8142 node tool/ha-simulator/server.js &
//   python3 -m http.server 8765 &
//   node tool/pruefe-musik.js --mit http://localhost:8141 --ohne http://localhost:8142 --out belege/…/musik
"use strict";
const { webkit } = require("playwright");
const fs = require("fs");
const path = require("path");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const MIT = arg("mit", "http://localhost:8141");
const OHNE = arg("ohne", "http://localhost:8142");
const PAGES = arg("pages", "http://localhost:8765/index.html");
const OUT = arg("out", "belege/musik");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "ha-simulator", "charts-beispiel.json"), "utf8"));

let fehler = 0;
function log(ok, text) { if (!ok) fehler++; console.log((ok ? "✓ " : "✗ ") + text); }

async function neueSeite(browser) {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 }, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  page.codeFehler = [];
  page.anfragen = [];
  page.on("request", (r) => page.anfragen.push(r.url()));
  // WebKit meldet CORS-Ablehnungen fremder Quellen (Kalender-Worker von
  // localhost) als pageerror, obwohl der Code sie abfängt – extern, kein Code-Fehler.
  page.on("pageerror", (e) => { if (!/access control checks/.test(e.message)) page.codeFehler.push(e.message); });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/access control|Access-Control|Failed to load resource|NetworkError|Load failed|status of [45]\d\d|cannot load|Musik-Charts zu alt|Kalender-Abruf|Veranstaltungen-Abruf|Keine anstehenden/i.test(t)) return;
    page.codeFehler.push(t);
  });
  return page;
}

async function anmelden(page, sim) {
  await page.goto(sim + "/local/tafel/index.html");
  await page.evaluate(() => { const d = new Date(); localStorage.setItem("tafelMorgengruss", d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate()); });
  await page.waitForSelector("#haLogin.is-open", { timeout: 10000 });
  await page.fill("#haLoginUser", "tafel");
  await page.fill("#haLoginPass", "tafel-passwort");
  await page.tap("#haLoginSubmit");
  await page.waitForFunction(() => window.TafelHA && TafelHA.isConnected(), null, { timeout: 15000 });
  await page.evaluate(() => { CONFIG.nightDim = null; CONFIG.nightSleep = null; tickClock(); });
  await page.waitForTimeout(2500); // Sync-Ereignis → updateMusic (gebündelt 1,5 s)
}

const liste = (page) => page.evaluate(() => {
  const t = document.querySelector("#musicList .music2-title");
  if (!t) return null;
  return {
    titel: [t.textContent].concat([].map.call(document.querySelectorAll("#musicList .music2-t"), (x) => x.textContent)),
    tag: (document.querySelector("#musicList .music2-tag") || {}).textContent,
    quelle: (document.querySelector("#musicList .music2-quelle") || {}).textContent,
    verfuegbar: panelVerfuegbar("music"),
  };
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();

  // 1. ohne HA
  let page = await neueSeite(browser);
  await page.goto(PAGES);
  await page.waitForTimeout(6000);
  const ohneHa = { v: await page.evaluate(() => panelVerfuegbar("music")), deezer: page.anfragen.some((u) => /deezer/.test(u)) };
  log(!ohneHa.v && !ohneHa.deezer, "Ohne HA und ohne Proxy: Musik-Panel fällt weg, keine Deezer-Anfrage");
  log(!page.codeFehler.length, "ohne HA: keine Code-Fehler" + (page.codeFehler.length ? " – " + page.codeFehler.join(" | ") : ""));
  await page.context().close();

  // 2. HA ohne Sensor
  page = await neueSeite(browser);
  await anmelden(page, OHNE);
  const ohneSensor = await page.evaluate(() => panelVerfuegbar("music"));
  log(!ohneSensor, "HA ohne sensor.musik_charts (Julians HA heute): Panel fällt weg");
  log(!page.codeFehler.length, "HA ohne Sensor: keine Code-Fehler" + (page.codeFehler.length ? " – " + page.codeFehler.join(" | ") : ""));
  await page.context().close();

  // 3. HA mit Sensor
  page = await neueSeite(browser);
  await anmelden(page, MIT);
  await page.evaluate(() => jumpToPanel("music"));
  await page.waitForTimeout(2500);
  const l = await liste(page);
  const soll = FIXTURE.results.map((r) => r.name);
  log(!!l && l.verfuegbar, "HA mit Sensor: Musik-Panel verfügbar");
  log(!!l && JSON.stringify(l.titel) === JSON.stringify(soll), "Reihenfolge = Sensor (Apple Music): " + (l ? l.titel.slice(0, 3).join(" / ") + " …" : "—"));
  log(!!l && /Apple Music · meistgespielt · Stand/.test(l.quelle), "Quelle + Stand sichtbar: „" + (l && l.quelle) + "“");
  await page.screenshot({ path: path.join(OUT, "nachher-01-music.png") });

  // 4. Sensor ändert sich (neue Nr. 1)
  const neu = FIXTURE.results.slice();
  const erster = neu.splice(3, 1)[0];
  neu.unshift(erster);
  const jetzt = new Date();
  const stand = jetzt.toUTCString().replace("GMT", "+0000");
  await fetch(MIT + "/sim/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_id: "sensor.musik_charts", state: stand, attributes: { results: neu } }) });
  await page.waitForTimeout(3500);
  const l2 = await liste(page);
  log(!!l2 && l2.titel[0] === erster.name, "Sensor-Update kommt ohne Neuladen an (neue Nr. 1: " + erster.name + ")");
  await page.screenshot({ path: path.join(OUT, "nachher-02-music-update.png") });

  // 5. Sensor veraltet
  const alt = new Date(Date.now() - 5 * 86400000).toUTCString().replace("GMT", "+0000");
  await fetch(MIT + "/sim/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_id: "sensor.musik_charts", state: alt }) });
  await page.waitForTimeout(3500);
  const alt5 = await page.evaluate(() => panelVerfuegbar("music"));
  log(!alt5, "Sensor 5 Tage alt (HA ruft nicht mehr ab): Panel fällt weg");
  // zurücksetzen für weitere Proben
  await fetch(MIT + "/sim/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_id: "sensor.musik_charts", state: FIXTURE.updated, attributes: { results: FIXTURE.results } }) });
  log(!page.codeFehler.length, "HA mit Sensor: keine Code-Fehler" + (page.codeFehler.length ? " – " + page.codeFehler.join(" | ") : ""));
  await page.context().close();

  await browser.close();
  console.log(fehler ? "\nFEHLER ✗ (" + fehler + ")" : "\nALLES ✓");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
