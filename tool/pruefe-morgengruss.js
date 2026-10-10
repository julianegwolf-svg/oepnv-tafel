// Morgengruß-Probe gegen den Simulator (NIE gegen ein echtes HA):
// Tafel liegt nach "Gute Nacht" im Tiefschlaf, dann meldet der
// Bewegungsmelder Bewegung → Tafel wacht weich auf, Begrüßung mit dem
// einen Satz des Tages, danach Tagesblick. Bildfolge + Video (WebKit,
// 1024×768).
//
//   PORT=8125 node tool/ha-simulator/server.js &
//   node tool/pruefe-morgengruss.js --sim http://localhost:8125 --jetzt 2026-10-12T05:50 --out belege/2026-10-10/morgengruss
const { webkit } = require("playwright");
const path = require("path");
const fs = require("fs");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SIM = arg("sim", "http://localhost:8125");
const OUT = arg("out", "belege/morgengruss");
const JETZT = arg("jetzt", "2026-10-12T05:50");
const PREFIX = arg("prefix", "");
const results = [];

function log(ok, text) {
  results.push({ ok: ok, text: text });
  console.log((ok ? "✓ " : "✗ ") + text);
}

async function sim(pfad, body) {
  try {
    await fetch(SIM + pfad, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  } catch (e) { /* egal */ }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  const vdir = path.join(OUT, "_roh");
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    recordVideo: arg("video", "ja") === "ja" ? { dir: vdir, size: { width: 1024, height: 768 } } : undefined,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  const errors = [];
  const EXTERN = /access control|Access-Control|Failed to load resource|NetworkError|Load failed|status of 4\d\d|status of 5\d\d|cannot load|TomTom/i;
  page.on("pageerror", (e) => { if (!EXTERN.test(e.message)) errors.push("pageerror: " + e.message); });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (EXTERN.test(t)) return;
    errors.push("console: " + t);
  });
  let n = 0;
  const shot = async (name) => {
    n++;
    const f = path.join(OUT, PREFIX + String(n).padStart(2, "0") + "-" + name + ".png");
    await page.screenshot({ path: f });
    return f;
  };

  await page.goto(SIM + "/local/tafel/index.html?jetzt=" + encodeURIComponent(JETZT));
  await page.evaluate(() => { try { localStorage.removeItem("tafelMorgengruss"); } catch (e) { /* egal */ } });
  await page.waitForSelector("#haLogin.is-open", { timeout: 10000 });
  await page.fill("#haLoginUser", "tafel");
  await page.fill("#haLoginPass", "tafel-passwort");
  await page.tap("#haLoginSubmit");
  await page.waitForFunction(() => window.TafelHA && TafelHA.isConnected(), null, { timeout: 15000 });
  await page.waitForTimeout(6000); // Wetter/Abfahrten laden

  const sensor = await page.evaluate(() => {
    const all = Object.keys(TafelHA.states());
    const ids = all.length ? all : [];
    for (let i = 0; i < ids.length; i++) {
      const st = TafelHA.state(ids[i]);
      const dc = TafelHA.attr(st, "device_class");
      if (ids[i].indexOf("binary_sensor.") === 0 && (dc === "motion" || dc === "occupancy")) return ids[i];
    }
    return null;
  });
  log(!!sensor, "Bewegungsmelder gefunden: " + sensor);
  if (sensor) await sim("/sim/state", { entity_id: sensor, state: "off" });
  await page.waitForTimeout(800);

  // Abends "Gute Nacht" → Tiefschlaf bis 6 Uhr.
  await page.evaluate(() => { tafelGuteNacht(); });
  await page.waitForTimeout(4500);
  const dark = await page.evaluate(() => document.getElementById("nightOverlay").classList.contains("is-active"));
  log(dark, "Tafel liegt im Tiefschlaf (Gute Nacht bis 6 Uhr)");
  await shot("schlaf");

  // Bewegung!
  if (sensor) await sim("/sim/state", { entity_id: sensor, state: "on" });
  const t0 = Date.now();
  // Wach = Schleier weg oder nur noch normale Nachtdimmung (nachts 22–5 Uhr).
  await page.waitForFunction(() => {
    const o = document.getElementById("nightOverlay");
    return !o.classList.contains("is-active") || parseFloat(o.style.getPropertyValue("--night-dim-opacity")) < 0.9;
  }, null, { timeout: 8000 }).catch(() => {});
  const reaktion = Date.now() - t0;
  for (const ms of [150, 350, 600, 1000]) {
    const warte = ms - (Date.now() - t0);
    if (warte > 0) await page.waitForTimeout(warte);
    await shot("aufwachen-" + ms + "ms");
  }
  await page.waitForTimeout(1500);
  const gruss = await page.evaluate(() => {
    const el = document.getElementById("haGreeting");
    return el && el.classList.contains("is-open") ? el.innerText : "";
  });
  const stunde = parseInt(JETZT.slice(11, 13), 10);
  if (stunde >= 5 && stunde < 11) log(/Guten Morgen/.test(gruss), "Begrüßung: " + gruss.replace(/\n+/g, " | "));
  else log(!gruss, "Nachts kein Morgengruß, nur gestaffeltes Aufwachen");
  log(reaktion < 3000, "Aufwachen nach " + reaktion + " ms (inkl. Simulator-Weg)");
  await shot("gruss");
  await page.waitForTimeout(9000);
  await shot("danach");
  const panel = await page.evaluate(() => activeSequence[panelIndex]);
  log(stunde < 5 || stunde >= 11 || panel === "tagesblick" || panel === "departures", "Danach: Panel " + panel);
  await page.waitForTimeout(3000);
  await shot("danach-2");
  if (typeof arg("extra", "") === "string" && arg("extra", "")) {
    await page.evaluate(arg("extra", ""));
    await page.waitForTimeout(1000);
    await shot("extra");
  }

  const arbeit = await page.evaluate(() => ({ linie: lastCommuteFirstLine, richtung: lastCommuteFirstHeadsign, ab: (function () { const a = arbeitsBahnHeute(); return a ? (a.dep ? a.dep.line + " " + a.dep.dest + " " + a.dep.clock : "los " + new Date(a.losMs).toTimeString().slice(0, 5)) : null; })() }));
  console.log("   Arbeitsweg: Linie " + arbeit.linie + " Richtung " + arbeit.richtung + " → " + arbeit.ab);
  log(errors.length === 0, errors.length ? "Konsole: " + errors.join(" / ") : "Keine Code-Fehler in der Konsole");
  const video = page.video();
  await context.close();
  if (video) {
    const dest = path.join(OUT, PREFIX + "morgengruss.webm");
    fs.renameSync(await video.path(), dest);
    fs.rmSync(vdir, { recursive: true, force: true });
    console.log("🎬 " + dest);
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, PREFIX + "ergebnis.json"), JSON.stringify(results, null, 2));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
