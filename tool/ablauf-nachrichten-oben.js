// Variante "oben" des Nachrichten-Layouts fotografieren (IDEEN N1).
"use strict";
module.exports = async function (page, hilfe) {
  await page.evaluate(() => { CONFIG.nachrichtenLayout = "oben"; updateNews(); });
  await hilfe.warte(6000);
  await hilfe.panel("news", 2500);
  await hilfe.foto("01-news");
};
