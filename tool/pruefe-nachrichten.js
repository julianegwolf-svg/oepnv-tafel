// Probe Nachrichten (Sitzung 6, FEEDBACK „Nachrichten sollen aktuell sein“):
//   1. echte Daten: jede Meldung trägt ihr Alter, Top-Meldungen stammen aus
//      der Startseite (nicht aus dem Regional-Sammelfeed), nichts > 12 h
//      (Bremen > 24 h), solange genug Frisches da ist
//   2. Attrappe mit Eilmeldung (breakingNews, vor 5 Min): roter Chip auf
//      einem anderen Panel; Antippen springt zur Meldung
//   3. Attrappe, in der alles 20 h alt ist: trotzdem 3 Meldungen, ehrlich
//      mit „gestern …“/„heute …“ beschriftet
//   python3 -m http.server 8765 &  ·  node tool/pruefe-nachrichten.js --out belege/…
"use strict";
const { webkit } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = (process.argv.indexOf("--out") !== -1 && process.argv[process.argv.indexOf("--out") + 1]) || "belege/nachrichten";
const URL = "http://localhost:8765/index.html";
let fehler = 0;
function log(ok, text) { if (!ok) fehler++; console.log((ok ? "✓ " : "✗ ") + text); }

async function seite(browser, homepageBody) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await context.newPage();
  page.codeFehler = [];
  page.on("pageerror", (e) => { if (!/access control checks/.test(e.message)) page.codeFehler.push(e.message); });
  if (homepageBody) {
    await page.route(/tagesschau\.de\/api2u\/homepage/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: homepageBody }));
  }
  await page.goto(URL);
  await page.waitForFunction(() => document.querySelectorAll("#newsList .news-slide").length > 0, null, { timeout: 30000 });
  return page;
}

const slides = (page) => page.evaluate(() => [].map.call(document.querySelectorAll("#newsList .news-slide"), (s, i) => ({
  titel: (s.querySelector(".news-slide-title") || {}).textContent || "",
  badge: (s.querySelector(".news-slide-badge") || {}).textContent || "",
  alter: (s.querySelector(".news-slide-alter") || {}).textContent || "",
  ms: Number((s.querySelector(".news-slide-alter") || { getAttribute: () => 0 }).getAttribute("data-ms")),
})));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  const jetzt = Date.now();

  // 1. echte Daten
  const echt = await fetch("https://www.tagesschau.de/api2u/homepage/").then((r) => r.json());
  const startTitel = echt.news.map((n) => n.title);
  let page = await seite(browser, null);
  const s1 = await slides(page);
  console.log("   " + s1.length + " Meldungen:");
  s1.forEach((s) => console.log("     " + s.badge.padEnd(11) + " " + s.alter.padEnd(13) + " " + s.titel.slice(0, 70)));
  log(s1.length >= 3 && s1.every((s) => s.alter), "jede Meldung zeigt ihr Alter");
  const fremd = s1.filter((s) => s.badge !== "Bremen" && startTitel.indexOf(s.titel) === -1);
  log(!fremd.length, "Top-Meldungen stammen aus der Startseite der tagesschau" + (fremd.length ? " – fremd: " + fremd.map((f) => f.titel).join(" | ") : ""));
  const zuAlt = s1.filter((s) => jetzt - s.ms > (s.badge === "Bremen" ? 24 : 12) * 3600000);
  log(!zuAlt.length || s1.filter((s) => s.badge !== "Bremen").length <= 3, "nichts älter als 12 h (Bremen 24 h)" + (zuAlt.length ? " – " + zuAlt.map((z) => z.alter + " " + z.titel).join(" | ") : ""));
  log(!s1.some((s) => /Wolken, Temperaturen/.test(s.titel)), "kein Wetterbericht als Meldung");
  await page.evaluate(() => jumpToPanel("news"));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "nachher-01-news.png") });
  log(!page.codeFehler.length, "echte Daten: keine Code-Fehler" + (page.codeFehler.length ? " – " + page.codeFehler.join(" | ") : ""));
  await page.context().close();

  // 2. Eilmeldung
  const eil = JSON.parse(JSON.stringify(echt));
  const iso = (ms) => new Date(ms).toISOString().replace("Z", "+00:00");
  eil.news.forEach((n, i) => { n.date = iso(jetzt - (30 + i * 20) * 60000); n.breakingNews = false; });
  eil.news[2].breakingNews = true;
  eil.news[2].date = iso(jetzt - 5 * 60000);
  eil.news[2].title = "Testmeldung: Großbrand im Bremer Hafen";
  page = await seite(browser, JSON.stringify(eil));
  await page.evaluate(() => jumpToPanel("departures"));
  await page.waitForTimeout(1500);
  const chip = await page.evaluate(() => { const c = document.querySelector("#eilHints .eil-hint"); return c ? c.textContent : ""; });
  log(/^Eilmeldung\d{2}:\d{2}Testmeldung: Großbrand im Bremer Hafen$/.test(chip), "Eilmeldung als Chip auf den Abfahrten: „" + chip + "“");
  await page.screenshot({ path: path.join(OUT, "eil-01-abfahrten.png") });
  await page.tap("#eilHints .eil-hint");
  await page.waitForTimeout(1800);
  const nachTipp = await page.evaluate(() => ({ panel: (document.querySelector(".panel-view.active") || {}).id, titel: (document.querySelector("#newsList .news-slide.active .news-slide-title") || {}).textContent }));
  log(nachTipp.panel === "panel-news" && nachTipp.titel === "Testmeldung: Großbrand im Bremer Hafen", "Antippen → Nachrichten mit genau dieser Meldung");
  await page.screenshot({ path: path.join(OUT, "eil-02-nach-tipp.png") });
  log(!page.codeFehler.length, "Eilmeldung: keine Code-Fehler" + (page.codeFehler.length ? " – " + page.codeFehler.join(" | ") : ""));
  await page.context().close();

  // 3. alles alt
  const alt = JSON.parse(JSON.stringify(echt));
  alt.news.forEach((n, i) => { n.date = iso(jetzt - (20 * 60 + i) * 60000); n.breakingNews = false; });
  page = await seite(browser, JSON.stringify(alt));
  const s3 = (await slides(page)).filter((s) => s.badge !== "Bremen");
  log(s3.length === 3 && s3.every((s) => /^(heute|gestern) \d{2}:\d{2}$/.test(s.alter)), "alles 20 h alt: 3 Meldungen, ehrlich datiert (" + s3.map((s) => s.alter).join(", ") + ")");
  const chip3 = await page.evaluate(() => !!document.querySelector("#eilHints .eil-hint"));
  log(!chip3, "keine Eilmeldung → kein Chip");
  await page.context().close();

  await browser.close();
  console.log(fehler ? "\nFEHLER ✗ (" + fehler + ")" : "\nALLES ✓");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
