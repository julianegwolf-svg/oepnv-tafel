// Speicherprobe für clips.js (AUSBAU Abschnitt 5): 50× abwechselnd das
// Video-Panel (tagesschau in 100 Sekunden) und das Wetter-Panel mit
// Regenradar zeigen und dabei messen, ob Video-Elemente, Radarbilder oder
// der Arbeitsspeicher der WebKit-Prozesse wachsen.
//
//   node tool/pruefe-clips.js --runden 50 --out belege/2026-10-10/clips
//
// Speicher = RSS des Browser-Prozesses plus aller Kindprozesse (WebKit
// rendert in eigenen Prozessen). Desktop-WebKit, nicht das iPad —
// gemessen wird der Trend, nicht der absolute Wert.
const { webkit } = require("playwright");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const URL = arg("url", "http://localhost:8765/index.html?jetzt=2026-10-10T19:30");
const RUNDEN = parseInt(arg("runden", "50"), 10);
const OUT = arg("out", "belege/clips");

function rssTree(pid) {
  try {
    const out = execSync("ps -A -o pid=,ppid=,rss=").toString().trim().split("\n");
    const rows = out.map((l) => l.trim().split(/\s+/).map(Number));
    const kids = {};
    rows.forEach((r) => { (kids[r[1]] = kids[r[1]] || []).push(r); });
    let sum = 0;
    const stack = [pid];
    const rss = {};
    rows.forEach((r) => { rss[r[0]] = r[2]; });
    while (stack.length) {
      const p = stack.pop();
      sum += rss[p] || 0;
      (kids[p] || []).forEach((r) => stack.push(r[0]));
    }
    return Math.round(sum / 1024);
  } catch (e) { return null; }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await webkit.launchServer();
  const pid = server.process().pid;
  const browser = await webkit.connect(server.wsEndpoint());
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = [];
  page.on("pageerror", (e) => { if (!/access control checks/.test(e.message)) errors.push(e.message); });
  await page.goto(URL);
  await page.waitForTimeout(8000);
  await page.evaluate(() => { CONFIG.nightDim = null; CONFIG.nightSleep = null; tickClock(); });
  // Radar unabhängig vom aktuellen Wetter erzwingen (sonst wird es bei
  // trockenem Wetter gar nicht geladen und die Probe sagt nichts).
  await page.evaluate((m) => { CONFIG.clips.regenradar = m; }, arg("radar", "immer"));
  const verfuegbar = await page.evaluate(() => TafelClips.tagesschauAvailable());
  console.log("Video verfügbar: " + verfuegbar + ", Radar relevant: " + await page.evaluate(() => TafelClips.radarRelevant()));

  const proben = [];
  for (let i = 1; i <= RUNDEN; i++) {
    await page.evaluate(() => jumpToPanel("tagesschau"));
    await page.waitForTimeout(2500);
    const v = await page.evaluate(() => ({ videos: document.getElementsByTagName("video").length, spielt: (function () { const x = document.querySelector("video"); return !!(x && !x.paused); })() }));
    await page.evaluate(() => jumpToPanel("weather"));
    await page.waitForTimeout(2500);
    const w = await page.evaluate(() => TafelClips.debug());
    if (i === 1 || i % 10 === 0) {
      const p = { runde: i, mb: rssTree(pid), videosImVideoPanel: v.videos, videoSpielte: v.spielt, videosImWetter: w.videos, radarBilder: w.radarBilder };
      proben.push(p);
      console.log("Runde " + i + ": " + p.mb + " MB, Video-Elemente " + p.videosImVideoPanel + "→" + p.videosImWetter + (p.videoSpielte ? " (spielte)" : "") + ", Radarbilder " + p.radarBilder);
    }
  }
  await page.evaluate(() => jumpToPanel("departures"));
  await page.waitForTimeout(1500);
  const ende = await page.evaluate(() => TafelClips.debug());
  await browser.close();
  await server.close();

  const erste = proben[0];
  const letzte = proben[proben.length - 1];
  const checks = [
    ["Nie mehr als ein Video-Element", proben.every((p) => p.videosImVideoPanel <= 1 && p.videosImWetter === 0)],
    ["Radar hält höchstens 2 Ebenen + Karte (≤ 12 Bilder)", proben.every((p) => p.radarBilder <= 12)],
    ["Nach dem Verlassen: kein Video, kein Radarbild", ende.videos === 0 && ende.radarBilder === 0],
    ["Speicher wächst nicht stetig (letzte ≤ erste + 25 %)", letzte.mb != null && letzte.mb <= erste.mb * 1.25],
    ["Keine Seitenfehler", errors.length === 0],
  ];
  let ok = true;
  checks.forEach((c) => { console.log((c[1] ? "✓ " : "✗ ") + c[0]); if (!c[1]) ok = false; });
  if (errors.length) console.log("Fehler: " + errors.slice(0, 3).join(" | "));
  fs.writeFileSync(path.join(OUT, "speicherprobe.json"), JSON.stringify({ proben, ende, checks, errors }, null, 2));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
