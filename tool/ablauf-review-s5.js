// Ablaufskript für tool/screenshot.js: prüft die Funde des Code-Reviews
// von Sitzung 5 (nach der Behebung).
//  1. buildTriviaChoices endet auch für Jahre vor Christus; der Stapel
//     enthält nur Jahre n. Chr.
//  2. Das erste Ereignis des Stapels wird nicht übersprungen.
//  3. Nach Mitternacht steht über dem Ereignis sein echtes Datum, und der
//     neue Tag wird geholt.
//  4. Ein veraltetes Bild-onerror verändert den neuen Block nicht.
//  5. Arbeitsweg-Karte: kein Bild, solange das Panel ausgeblendet ist,
//     beim Zeigen genau eine Anfrage in der richtigen Größe.
module.exports = async (page, hilfe) => {
  let fehler = 0;
  const pruefe = (ok, text) => { if (!ok) fehler++; console.log((ok ? "✓ " : "✗ ") + text); };

  // 5a. vor dem ersten Zeigen: keine Kartenanfrage
  const vorher = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.name.indexOf("staticimage") !== -1).length);
  pruefe(vorher === 0, "Arbeitsweg ausgeblendet: " + vorher + " Kartenanfrage(n) seit dem Laden");

  // 2. Stapel bereit, aber noch nichts gezogen
  const st = await page.evaluate(() => ({ pos: triviaStapelPos, n: triviaStapel.length }));
  pruefe(st.n > 0 && st.pos === 0, "Stapel geladen (" + st.n + " Ereignisse), Position vor dem ersten Zeigen " + st.pos);
  await hilfe.panel("trivia", 600);
  const erstes = await page.evaluate(() => ({ pos: triviaStapelPos, text: triviaFullText, erstes: triviaStapel[0].text }));
  pruefe(erstes.pos === 1 && erstes.text === erstes.erstes, "erstes Zeigen bringt Ereignis 0 (Position jetzt " + erstes.pos + ")");

  // 1. Jahre vor Christus
  const bc = await page.evaluate(() => {
    const t0 = Date.now();
    const a = buildTriviaChoices(-100), b = buildTriviaChoices(-44), c = buildTriviaChoices(5), d = buildTriviaChoices(new Date().getFullYear());
    const stapel = triviaStapelBauen([
      { year: -100, text: "Ein Ereignis vor Christus mit genug Text für den Filter da." },
      { year: -44, text: "An den Iden des März wird der römische Diktator ermordet." },
      { year: 1990, text: "Ein Ereignis nach Christus, lang genug für den Filter." },
    ]);
    return { ms: Date.now() - t0, a: a, b: b, c: c, d: d, jahre: stapel.map((e) => e.year) };
  });
  pruefe(bc.ms < 1000 && bc.a.length === 3 && bc.b.length === 3 && bc.c.length === 3 && bc.d.length === 3,
    "buildTriviaChoices endet (" + bc.ms + " ms): -100 → " + bc.a.join("/") + ", -44 → " + bc.b.join("/") + ", 5 → " + bc.c.join("/") + ", " + bc.d.join("/"));
  pruefe(bc.jahre.length === 1 && bc.jahre[0] === 1990, "Stapel ohne Jahre v. Chr.: " + JSON.stringify(bc.jahre));

  // 3. Datum nach Mitternacht
  const nacht = await page.evaluate(() => {
    const gestern = new Date(Date.now() - 86400000);
    triviaStapelDatum = gestern;
    let abrufe = 0;
    const alt = window.fetch;
    window.fetch = function (u) { if (String(u).indexOf("onthisday") !== -1) abrufe++; return alt.apply(this, arguments); };
    naechstesTriviaEreignis();
    window.fetch = alt;
    const label = document.querySelector("#triviaBlock .trivia-date").textContent;
    return { label: label, soll: gestern.getDate() + ". ", abrufe: abrufe };
  });
  pruefe(nacht.label.indexOf("vom " + nacht.soll) !== -1 && nacht.abrufe === 1, "Stapel vom Vortag: „" + nacht.label + "“, neuer Abruf gestartet (" + nacht.abrufe + ")");

  // 4. veraltetes onerror
  const alt = await page.evaluate(() => new Promise((fertig) => {
    triviaBild = { gross: "data:image/png;base64,AAAA", klein: "data:image/png;base64,AAAB", w: 330, h: 220, titel: "Test" };
    renderTriviaShell();
    const altesImg = document.querySelector("#triviaBlock .trivia-bild img");
    triviaBild = { gross: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", klein: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", w: 330, h: 220, titel: "Neu" };
    renderTriviaShell();
    // altes Bild meldet jetzt seinen Fehler
    altesImg.onerror();
    altesImg.onerror();
    const block = document.getElementById("triviaBlock");
    fertig({ mitBild: block.classList.contains("mit-bild"), pad: block.style.paddingRight, fig: !!block.querySelector(".trivia-bild") });
  }));
  pruefe(alt.mitBild && alt.pad !== "" && alt.fig, "veraltetes onerror lässt den neuen Block in Ruhe (mit-bild " + alt.mitBild + ", padding " + alt.pad + ")");
  await page.evaluate(() => { if (naechstesTriviaEreignis()) startTriviaReveal(); });

  // 5b. Zeigen: genau eine Anfrage, Größe passt
  await hilfe.panel("commute", 4000);
  const k = await page.evaluate(() => {
    const w = document.getElementById("commuteMapWrap");
    const m = /width=(\d+)&height=(\d+)/.exec(document.getElementById("commuteMapImg").getAttribute("src") || "");
    return { feld: w.offsetWidth + "x" + w.offsetHeight, bild: m ? m[1] + "x" + m[2] : "(kein Bild)",
      anfragen: performance.getEntriesByType("resource").filter((e) => e.name.indexOf("staticimage") !== -1).length };
  });
  pruefe(k.anfragen === 1 && k.feld === k.bild, "Arbeitsweg gezeigt: " + k.anfragen + " Kartenanfrage, Feld " + k.feld + ", Bild " + k.bild);
  await hilfe.foto("arbeitsweg");
  await hilfe.panel("weather", 1000);
  await hilfe.panel("commute", 2500);
  const k2 = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.name.indexOf("staticimage") !== -1).length);
  pruefe(k2 === 1, "zweites Zeigen ohne neue Anfrage (" + k2 + ")");
  console.log(fehler ? "✗ " + fehler + " Prüfung(en) fehlgeschlagen" : "✓ alle Review-Punkte in Ordnung");
};
