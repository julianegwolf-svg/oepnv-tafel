// Ablaufskript für tool/screenshot.js: Abfahrtstafel im Zeitraffer
// beobachten — abgefahrene Bahn gleitet nach oben hinaus, die anderen
// rücken nach, Minutenziffern rollen (IDEEN A4 / AUSBAU Abschnitt 4).
//
//   node tool/screenshot.js --skript tool/ablauf-abfahrten.js --jetzt 2026-10-12T07:20 --tempo 20 --video --prefix a4-
"use strict";

module.exports = async function (page, hilfe) {
  await hilfe.panel("departures", 1500);
  // Karussell anhalten, damit die Tafel im Bild bleibt (Zeitraffer!).
  await page.evaluate(() => { if (carouselTimer) { clearTimeout(carouselTimer); carouselTimer = null; } });
  const zeilen = async () => page.evaluate(() =>
    Array.prototype.map.call(document.querySelectorAll("#departureRows .dep-row:not(.is-leaving) .dest"), (e) => e.textContent).join(" | "));
  const start = await zeilen();
  await hilfe.foto("01-start");
  for (let i = 2; i <= 6; i++) {
    await hilfe.warte(3000);
    await hilfe.foto("0" + i);
  }
  const ende = await zeilen();
  console.log("Start: " + start + "\nEnde:  " + ende);
};
