// Ablaufskript für tool/screenshot.js: Arbeitsweg-Karte passt sich an, wenn
// sich das Kartenfeld nach dem Zeichnen in der Größe ändert (z. B. weil die
// Hinweiszeile erscheint). Simuliert das über zusätzlichen Innenabstand.
module.exports = async (page, hilfe) => {
  const lies = () => page.evaluate(() => {
    const w = document.getElementById("commuteMapWrap");
    const img = document.getElementById("commuteMapImg");
    const m = /width=(\d+)&height=(\d+)/.exec(img.getAttribute("src") || "");
    return { feld: w.offsetWidth + "x" + w.offsetHeight, bild: m ? m[1] + "x" + m[2] : "(kein Bild)" };
  });
  await hilfe.panel("commute", 4000);
  const a = await lies();
  console.log("vorher: Feld " + a.feld + ", Bild " + a.bild);
  await hilfe.foto("karte-1");
  await page.addStyleTag({ content: "#panel-commute { padding-bottom: 90px !important; }" });
  await hilfe.panel("weather", 1500);
  await hilfe.panel("commute", 4000);
  const b = await lies();
  console.log("nach Größenänderung: Feld " + b.feld + ", Bild " + b.bild);
  await hilfe.foto("karte-2");
  const passt = (x) => x.feld === x.bild;
  console.log(passt(a) && passt(b) ? "✓ Kartenbild passt in beiden Fällen zum Feld" : "✗ Kartenbild passt nicht zum Feld");
};
