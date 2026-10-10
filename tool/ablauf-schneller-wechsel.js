// Ablaufskript für tool/screenshot.js: zwei Panelwechsel kurz hintereinander
// (Karussell, dann Sprung durch HA) – das Zielpanel darf danach nicht leer
// sein (Code-Review 10.10.: veralteter Ausblende-Timer).
//
//   node tool/screenshot.js --skript tool/ablauf-schneller-wechsel.js --prefix wechsel-
"use strict";

module.exports = async function (page, hilfe) {
  const ergebnis = [];
  for (const [a, b] of [["weather", "departures"], ["departures", "tagesblick"], ["news", "weather"]]) {
    await page.evaluate((x) => jumpToPanel(x), a);
    await hilfe.warte(250);
    await page.evaluate((x) => jumpToPanel(x), b);
    await hilfe.warte(1200);
    const sichtbar = await page.evaluate((x) => {
      const el = document.getElementById("panel-" + x);
      return !!el && el.classList.contains("active") && getComputedStyle(el).display !== "none";
    }, b);
    ergebnis.push((sichtbar ? "✓ " : "✗ ") + a + " → " + b + (sichtbar ? " sichtbar" : " LEER (display:none)"));
    await hilfe.foto(a + "-" + b);
  }
  console.log(ergebnis.join("\n"));
};
