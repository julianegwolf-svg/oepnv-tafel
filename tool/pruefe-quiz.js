// Allgemeinwissen auf Deutsch (quiz.js): Panel mehrfach zeigen, jedes Mal
// eine neue Frage? Antwort antippen (echtes Tap), Auflösung abwarten,
// Neuladen ohne Wiederholung. Fotos bei 1024×768 (WebKit).
//
//   node tool/pruefe-quiz.js [--url http://localhost:8765/index.html] [--out belege/…/quiz]
const { webkit } = require("playwright");
const path = require("path");
const fs = require("fs");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const URL = arg("url", "http://localhost:8765/index.html");
const OUT = arg("out", "belege/quiz");
let fehler = 0;
const log = (ok, t) => { if (!ok) fehler++; console.log((ok ? "✓ " : "✗ ") + t); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  const EXTERN = /access control|Access-Control|Failed to load|status of [45]\d\d|Load failed|TomTom|NetworkError/i;
  page.on("pageerror", (e) => { if (!EXTERN.test(e.message)) errors.push(e.message); });
  page.on("console", (m) => { if (m.type() === "error" && !EXTERN.test(m.text())) errors.push(m.text()); });
  await page.goto(URL);
  await page.waitForTimeout(6000);
  await page.evaluate(() => pauseCarouselIndefinitely());

  const frage = () => page.evaluate(() => ({
    kat: (document.getElementById("quizCategory") || {}).textContent,
    text: quizQuestion && quizQuestion.text,
    optionen: Array.prototype.map.call(document.querySelectorAll("#quizChoices .trivia-choice"), (c) => c.textContent),
    richtig: quizChoices && quizChoices.correct,
    ausSammlung: typeof QUIZ_FRAGEN !== "undefined" && QUIZ_FRAGEN.some((q) => quizQuestion && q.f === quizQuestion.text),
  }));

  const gesehen = [];
  for (let r = 0; r < 4; r++) {
    await page.evaluate(() => jumpToPanel("departures"));
    await page.waitForTimeout(400);
    await page.evaluate(() => { jumpToPanel("quiz"); pauseCarouselIndefinitely(); });
    await page.waitForTimeout(3500);
    const f = await frage();
    gesehen.push(f.text);
    log(!!f.text && f.ausSammlung && f.optionen.length === 4 && f.optionen.indexOf(f.richtig) !== -1,
      "Runde " + (r + 1) + ": [" + f.kat + "] " + f.text + " → " + f.optionen.join(" | "));
    if (r === 0) await page.screenshot({ path: path.join(OUT, "01-frage.png") });
  }
  log(new Set(gesehen).size === gesehen.length, "4× gezeigt, 4 verschiedene Fragen");

  // Echtes Antippen einer falschen Antwort, dann Auflösung
  const f = await frage();
  const falsch = f.optionen.filter((o) => o !== f.richtig)[0];
  await page.locator("#quizChoices .trivia-choice", { hasText: falsch }).first().tap();
  await page.waitForTimeout(900);
  const nachTipp = await page.evaluate(() => ({
    klassen: Array.prototype.map.call(document.querySelectorAll("#quizChoices .trivia-choice"), (c) => c.className),
    aufgeloest: document.getElementById("quizChoices").classList.contains("is-revealed") || !!document.querySelector("#panel-quiz .is-revealed-block"),
  }));
  log(nachTipp.aufgeloest, "Tipp auf „" + falsch + "“ löst auf: " + nachTipp.klassen.join(" / "));
  await page.screenshot({ path: path.join(OUT, "02-getippt.png") });

  // Ohne Tippen: Auflösung nach der Hälfte der Anzeigezeit
  await page.evaluate(() => { jumpToPanel("departures"); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { jumpToPanel("quiz"); pauseCarouselIndefinitely(); });
  await page.waitForTimeout(14000);
  const auto = await page.evaluate(() => document.getElementById("quizChoices").classList.contains("is-revealed"));
  log(auto, "ohne Tippen nach ~11 s aufgelöst");
  await page.screenshot({ path: path.join(OUT, "03-aufgeloest.png") });

  // Neuladen: Rest-Stapel bleibt, keine schon gezeigte Frage
  const restVor = await page.evaluate(() => JSON.parse(localStorage.getItem("tafelQuizRest") || "[]").length);
  await page.reload();
  await page.waitForTimeout(6000);
  await page.evaluate(() => { jumpToPanel("quiz"); pauseCarouselIndefinitely(); });
  await page.waitForTimeout(3000);
  const nach = await frage();
  const restNach = await page.evaluate(() => JSON.parse(localStorage.getItem("tafelQuizRest") || "[]").length);
  log(gesehen.indexOf(nach.text) === -1 && restNach < restVor, "nach Neuladen neue Frage (Rest " + restVor + " → " + restNach + "): " + nach.text);

  log(!errors.length, errors.length ? "Seitenfehler: " + errors.join(" | ") : "Keine Code-Fehler");
  await browser.close();
  console.log(fehler ? fehler + " Fehler" : "Alle Prüfungen bestanden.");
  process.exit(fehler ? 1 : 0);
})();
