// Für tool/screenshot.js: Tagesblick mit zwei DWD-Warnungen – Streifen
// zeigt die wichtigste, das Band die zweite; Tipp auf den Streifen öffnet
// den vollen DWD-Text.
module.exports = async (page, hilfe) => {
  await hilfe.panel("tagesblick", 3500);
  const r = await page.evaluate(() => ({
    streifen: (document.querySelector(".tb-warnstreifen .tb-warn-name") || {}).textContent || "-",
    band: Array.prototype.filter.call(document.querySelectorAll(".statusbar .ha-hint"), (c) => c.offsetWidth > 0).map((c) => c.textContent.trim()),
  }));
  console.log((r.streifen !== "-" && r.band.some((t) => /Frost/.test(t)) && !r.band.some((t) => /Böen/.test(t)) ? "✓ " : "✗ ") +
    "Streifen: " + r.streifen + " · Band: " + JSON.stringify(r.band));
  await hilfe.foto("zwei-warnungen");
  await page.locator(".tb-warnstreifen").tap();
  await hilfe.warte(900);
  const offen = await page.evaluate(() => { const d = document.querySelector(".warn-detail"); return !!(d && d.classList.contains("is-open")) ? d.innerText.replace(/\s+/g, " ").slice(0, 120) : ""; });
  console.log((offen ? "✓ " : "✗ ") + "Tipp auf den Streifen öffnet den DWD-Text: " + offen);
  await hilfe.foto("streifen-getippt");
  await hilfe.panel("departures", 2500);
  const b2 = await page.evaluate(() => Array.prototype.filter.call(document.querySelectorAll(".statusbar .ha-hint"), (c) => c.offsetWidth > 0).map((c) => c.textContent.trim()));
  console.log((b2.some((t) => /Böen/.test(t)) && b2.some((t) => /Frost/.test(t)) ? "✓ " : "✗ ") + "Abfahrten: Band zeigt beide: " + JSON.stringify(b2));
};
