// Beispiel-Ablaufskript für tool/screenshot.js: Wischgeste in der
// Nachrichten-Diashow durchspielen und belegen.
//
//   node tool/screenshot.js --skript tool/ablauf-wischen.js --prefix wischen-
//
// Bekommt die Playwright-"page" und "hilfe" mit:
//   hilfe.panel(name[, ms])      Panel per jumpToPanel() zeigen und warten
//   hilfe.foto(name)             Screenshot <out>/<prefix><name>.png
//   hilfe.wische(x1,y1,x2,y2,o)  echte touchstart/-move/-end-Folge
//                                (o: { schritte, dauer, selektor })
//   hilfe.tippe(x, y)            Antippen (page.touchscreen.tap)
//   hilfe.warte(ms)
"use strict";

module.exports = async function (page, hilfe) {
  await hilfe.panel("news", 2500);
  const vorher = await page.evaluate(() => (typeof newsSlideIndex === "number" ? newsSlideIndex : null));
  await hilfe.foto("01-news-vorher");

  // Von rechts nach links wischen = nächste Meldung (siehe initStageSwipe in app.js).
  const art = await hilfe.wische(800, 400, 300, 410, { selektor: "#stage", schritte: 10, dauer: 300 });
  await hilfe.warte(1200);
  const nachher = await page.evaluate(() => (typeof newsSlideIndex === "number" ? newsSlideIndex : null));
  await hilfe.foto("02-news-nach-wisch");

  // Zurückwischen
  await hilfe.wische(300, 400, 800, 395, { selektor: "#stage" });
  await hilfe.warte(1200);
  const zurueck = await page.evaluate(() => (typeof newsSlideIndex === "number" ? newsSlideIndex : null));
  await hilfe.foto("03-news-zurueck");

  const ok = art === "touch" && vorher !== null && nachher !== vorher && zurueck === vorher;
  console.log("  Wischen (" + art + "): Meldung " + vorher + " → " + nachher + " → " + zurueck + (ok ? "  OK" : "  NICHT OK"));
  if (!ok) process.exitCode = 1;
};
