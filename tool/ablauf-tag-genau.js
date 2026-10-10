// Ablaufskript für tool/screenshot.js: "Auf den Tag genau" über mehrere
// Runden. Hält nach jedem Sprung das Karussell an, wartet bis zur
// Auflösung und prüft: jedes Mal ein anderes Ereignis, Text vollständig
// im Kasten (nichts unten abgeschnitten), Bild geladen und nicht über dem
// Text, DOM wächst nicht.
//   node tool/screenshot.js --skript tool/ablauf-tag-genau.js --out belege/<datum>/tag --prefix nachher-
module.exports = async (page, hilfe) => {
  const RUNDEN = 5;
  const gesehen = [];
  let fehler = 0;
  let knotenErste = null;
  for (let r = 1; r <= RUNDEN; r++) {
    await hilfe.panel("weather", 800);
    await hilfe.panel("trivia", 300);
    await page.evaluate(() => pauseCarouselIndefinitely());
    // Tippen (35 ms/Zeichen) + 6 s Bedenkzeit + Puffer
    const laenge = await page.evaluate(() => (triviaFullText || "").length);
    await hilfe.warte(laenge * 35 + 6000 + 1200);
    const b = await page.evaluate(() => {
      const block = document.getElementById("triviaBlock");
      const text = block.querySelector(".trivia-text");
      const fig = block.querySelector(".trivia-bild");
      const img = fig && fig.querySelector("img");
      const kb = block.getBoundingClientRect();
      const tb = text.getBoundingClientRect();
      const fb = fig ? fig.getBoundingClientRect() : null;
      const choices = block.querySelector(".trivia-choices");
      const cb = choices.getBoundingClientRect();
      const getippt = (document.getElementById("triviaTypedText") || {}).textContent || "";
      return {
        jahr: triviaYear,
        text: triviaFullText,
        vollstaendig: getippt === triviaFullText,
        imKasten: tb.bottom <= kb.bottom - 8 && cb.bottom <= kb.bottom - 8,
        bild: fig ? { titel: (fig.querySelector("figcaption") || {}).textContent || "", geladen: !!(img && img.complete && img.naturalWidth > 0), breite: img ? img.naturalWidth : 0 } : null,
        ueberlappt: fb ? (tb.right > fb.left - 10 || cb.right > fb.left - 10) : false,
        aufgeloest: choices.classList.contains("is-revealed"),
        knoten: document.getElementsByTagName("*").length,
        // Sitzung 6: Wikitext sauber aufgelöst, Auflösung nennt Jahr + Abstand
        sauber: !/\[\[|\]\]|\{\{|\}\}|&[a-z]+;|''|<[a-z]/i.test(triviaFullText || ""),
        label: (document.getElementById("triviaDateLabel") || {}).textContent || "",
      };
    });
    if (knotenErste === null) knotenErste = b.knoten;
    const labelOk = new RegExp(" " + b.jahr + "( · vor \\d+ Jahre?n?)?$").test(b.label);
    const ok = b.vollstaendig && b.imKasten && !b.ueberlappt && b.aufgeloest && (!b.bild || b.bild.geladen) && gesehen.indexOf(b.text) === -1 && b.sauber && labelOk;
    if (!ok) fehler++;
    gesehen.push(b.text);
    console.log((ok ? "✓" : "✗") + " Runde " + r + ": " + b.jahr + " · " + b.text.length + " Zeichen · " +
      (b.bild ? "Bild „" + b.bild.titel + "“ " + (b.bild.geladen ? b.bild.breite + " px" : "NICHT geladen") : "ohne Bild") +
      (b.imKasten ? "" : " · TEXT ABGESCHNITTEN") + (b.ueberlappt ? " · ÜBERLAPPT BILD" : "") +
      (b.vollstaendig ? "" : " · noch nicht fertig getippt") + (b.aufgeloest ? "" : " · nicht aufgelöst") +
      (b.sauber ? "" : " · WIKITEXT-RESTE") + (labelOk ? "" : " · Beschriftung falsch") + " · „" + b.label + "“" +
      " · DOM " + b.knoten);
    console.log("     " + b.text);
    await hilfe.foto("runde-" + r);
    await page.evaluate(() => resumeCarouselFromFraction());
  }
  const knotenLetzte = await page.evaluate(() => document.getElementsByTagName("*").length);
  console.log((fehler ? "✗ " + fehler + " Runde(n) mit Fehler" : "✓ alle Runden in Ordnung") +
    " · DOM erste Runde " + knotenErste + ", danach " + knotenLetzte);
};
