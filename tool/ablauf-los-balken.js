// Ablaufskript für tool/screenshot.js: "in 3 min los"/"LOS!"-Pille mit
// ablaufendem Balken (AUSBAU Abschnitt 4) im Zeitraffer beobachten.
//
//   node tool/screenshot.js --skript tool/ablauf-los-balken.js --jetzt 2026-10-12T07:20 --tempo 20 --video --prefix los-
//   VARIANTE=banner node tool/screenshot.js --skript tool/ablauf-los-balken.js …   (Banner statt Pille)
"use strict";

module.exports = async function (page, hilfe) {
  await hilfe.panel("departures", 1500);
  await page.evaluate(() => { if (carouselTimer) { clearTimeout(carouselTimer); carouselTimer = null; } });
  if (process.env.VARIANTE === "banner") {
    await page.evaluate(() => { CONFIG.abfahrtenDringlichkeit = "banner"; updateDepartures(); });
    await hilfe.warte(1500);
  }
  const zustand = async () => page.evaluate(() => {
    const p = document.querySelector(".leave-now-banner.is-visible") || document.querySelector("#departureRows .dep-row.is-next .dep-pill");
    if (!p) return "keine Pille";
    const bar = p.querySelector(".dep-pill-bar, .leave-now-bar");
    const m = /matrix\(([^,]+)/.exec(getComputedStyle(bar).transform);
    return ((p.querySelector(".dep-pill-text, .leave-now-headline") || p).textContent || "(leer)") + " · Balken " + (m ? Math.round(parseFloat(m[1]) * 100) + " %" : getComputedStyle(bar).transform);
  });
  for (let i = 1; i <= 8; i++) {
    console.log(String(i).padStart(2, "0") + ": " + await zustand());
    await hilfe.foto(String(i).padStart(2, "0"));
    await hilfe.warte(3000);
  }
};
