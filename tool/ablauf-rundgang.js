// Rundgang-Ablaufskript für tool/screenshot.js: fotografiert in EINEM
// Seitenaufruf alle Panels der Seite (section.panel-view) und danach
// Panel-Übersicht, Radio-Menü, Nachtdimmung und Ambient-Modus.
// Ideal für Vorher/Nachher-Vergleiche (gleiche Daten in beiden Läufen,
// wenn mit --jetzt gearbeitet wird).
//
//   node tool/screenshot.js --skript tool/ablauf-rundgang.js --jetzt 2026-10-10T14:00 \
//        --out belege/2026-10-10/rundgang --prefix nachher-
//
// Panels mit Tipp-Animation (Spruch, Trivia, Quiz, Rätsel) bekommen
// automatisch mehr Wartezeit.
"use strict";

const LANGSAM = { quote: 10000, trivia: 12000, quiz: 12000, riddle: 12000 };

module.exports = async function (page, hilfe) {
  const panels = await page.evaluate(() =>
    Array.prototype.map.call(document.querySelectorAll("section.panel-view"), (s) => s.id.replace(/^panel-/, "")));
  let nr = 0;
  const name = (n) => String(++nr).padStart(2, "0") + "-" + n;

  for (const p of panels) {
    await hilfe.panel(p, LANGSAM[p] || hilfe.opts.panelwarte);
    await hilfe.foto(name(p));
  }

  await hilfe.panel(panels[0], 1500);

  // Panel-Übersicht per echtem Antippen öffnen
  await page.locator("#panelNavToggle").tap();
  await hilfe.warte(700);
  await hilfe.foto(name("uebersicht"));
  await page.evaluate(() => { if (typeof setPanelNavOpen === "function") setPanelNavOpen(false); });
  await hilfe.warte(500);

  // Radio-Menü
  if (await page.locator("#radioToggle").isVisible()) {
    await page.locator("#radioToggle").tap();
    await hilfe.warte(600);
    await hilfe.foto(name("radio-menue"));
    await page.evaluate(() => { if (typeof setRadioMenuOpen === "function") setRadioMenuOpen(false); });
    await hilfe.warte(400);
  }

  // Nachtdimmung erzwingen (unabhängig von der Uhrzeit)
  await page.evaluate(() => {
    const o = document.getElementById("nightOverlay");
    if (o) { o.style.setProperty("--night-dim-opacity", "0.65"); o.classList.add("is-active"); }
  });
  await hilfe.warte(900);
  await hilfe.foto(name("nacht"));
  await page.evaluate(() => {
    const o = document.getElementById("nightOverlay");
    if (o) o.classList.remove("is-active");
  });

  // Ambient-Modus
  const ambient = await page.evaluate(() => {
    if (typeof enterAmbientMode !== "function") return false;
    enterAmbientMode();
    return true;
  });
  if (ambient) {
    await hilfe.warte(1600);
    await hilfe.foto(name("ambient"));
    await page.evaluate(() => { if (typeof exitAmbientMode === "function") exitAmbientMode(); });
  }
};
