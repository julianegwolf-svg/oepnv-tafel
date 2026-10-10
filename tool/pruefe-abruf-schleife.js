// Code-Review Sitzung 4: Fehlt heute die passende Bahn (Arbeitsbeginn
// knapp, Linie fällt aus), fragt die Tafel heute UND den nächsten
// Arbeitstag ab. Mit nur einem Zwischenspeicher verdrängten sich beide –
// endlose Abrufe an Transitous. Probe: Mo 07:40, Arbeitslinie künstlich
// auf eine nicht fahrende Linie, 45 s lang /v6/stoptimes zählen.
//
//   node tool/pruefe-abruf-schleife.js [--url …] [--alt alte-tagesblick.js]
const { webkit } = require("playwright");
const fs = require("fs");
function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const URL = arg("url", "http://localhost:8765/index.html") + "?jetzt=2026-10-12T07:40";
(async () => {
  const browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const alt = arg("alt", "");
  if (alt) await page.route((u) => u.pathname.endsWith("/tagesblick.js"), (r) => r.fulfill({ status: 200, contentType: "application/javascript; charset=utf-8", body: fs.readFileSync(alt) }));
  let zaehler = 0;
  let zaehlen = false;
  page.on("request", (r) => { if (zaehlen && r.url().indexOf("/v6/stoptimes") !== -1 && r.url().indexOf("time=") !== -1) zaehler++; });
  await page.goto(URL);
  await page.waitForFunction(() => typeof lastCommutePtMinutes !== "undefined" && lastCommutePtMinutes != null, null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { lastCommuteFirstLine = "99"; lastCommuteFirstHeadsign = null; jumpToPanel("commute"); pauseCarouselIndefinitely(); });
  zaehlen = true;
  await page.evaluate(() => { aktualisiereBusZeile(); if (window.TafelTag) TafelTag.render(); });
  await page.waitForTimeout(45000);
  const ok = zaehler <= 6;
  console.log((ok ? "✓ " : "✗ ") + zaehler + " gezielte Abfahrts-Abrufe in 45 s (erwartet: je Tag einer, höchstens 6)");
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
