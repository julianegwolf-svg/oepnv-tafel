// Ablaufskript für tool/screenshot.js: Arbeitsweg-Karte folgt der Farbwelt
// (dunkel → TomTom-Nachtstil, hell → Tagstil), auch wenn die Farbwelt erst
// nach dem Zeichnen wechselt (farbwelt "auto" bei Sonnenuntergang).
module.exports = async (page, hilfe) => {
  const stil = () => page.evaluate(() => {
    const m = /style=(\w+)/.exec(document.getElementById("commuteMapImg").getAttribute("src") || "");
    return { farbe: document.body.classList.contains("farbe-dunkel") ? "dunkel" : "hell", karte: m ? m[1] : "(kein Bild)" };
  });
  await hilfe.panel("commute", 4000);
  const a = await stil();
  await hilfe.foto("dunkel");
  await page.evaluate(() => { CONFIG.farbwelt = "hell"; applyFarbwelt(new Date()); });
  await hilfe.panel("weather", 1200);
  await hilfe.panel("commute", 4000);
  const b = await stil();
  await hilfe.foto("hell");
  const ok = a.farbe === "dunkel" && a.karte === "night" && b.farbe === "hell" && b.karte === "main";
  console.log((ok ? "✓" : "✗") + " Farbwelt " + a.farbe + " → Karte " + a.karte + ", danach " + b.farbe + " → Karte " + b.karte);
};
