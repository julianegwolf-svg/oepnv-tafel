// Kopfzeilen-Titel: wird er irgendwo abgeschnitten? Springt jedes Panel
// an, nachdem der "Als Nächstes: …"-Hinweis (IDEEN R4) schon einmal Text
// bekommen hat, und vergleicht scrollWidth mit clientWidth des Titels –
// einmal mit ausgeblendetem, einmal mit sichtbarem Hinweis.
//
//   node tool/pruefe-kopftitel.js [--url http://localhost:8765/index.html] [--out belege/…/titel] [--prefix vorher-]
const { webkit } = require("playwright");
const path = require("path");
const fs = require("fs");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const URL = arg("url", "http://localhost:8765/index.html");
const OUT = arg("out", "belege/titel");
const PREFIX = arg("prefix", "");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForTimeout(8000);
  const panels = await page.evaluate(() =>
    Array.prototype.map.call(document.querySelectorAll("section.panel-view"), (s) => s.id.replace(/^panel-/, "")));
  let fehler = 0;
  for (const p of panels) {
    await page.evaluate((name) => jumpToPanel(name), p);
    await page.waitForTimeout(700);
    // Hinweis einmal zeigen (Text setzen) und wieder ausblenden, wie am Ende jedes Panels.
    for (const sichtbar of [false, true]) {
      if (sichtbar) {
        // echter Ablauf: setNextHint wie in den letzten 3 s eines Panels
        await page.evaluate(() => setNextHint(3000));
        await page.waitForTimeout(100);
      }
      const r = await page.evaluate((zeigen) => {
        const t = document.getElementById("topbarTitle");
        const n = document.getElementById("topbarNext");
        if (!zeigen) {
          // ausgeblendeter Hinweis mit langem Text (wie nach jedem Panelwechsel)
          n.textContent = "Als Nächstes: Veranstaltungen";
          n.classList.remove("is-shown");
        }
        const ab = t.scrollWidth > t.clientWidth + 1;
        const hinweisAb = n.classList.contains("is-shown") && n.scrollWidth > n.clientWidth + 1;
        const nr = n.getBoundingClientRect();
        const rechts = document.getElementById("topbarRight").getBoundingClientRect();
        return { text: t.textContent, ab: ab, sw: t.scrollWidth, cw: t.clientWidth,
          hinweis: n.classList.contains("is-shown") ? n.textContent : "(aus)", hinweisAb: hinweisAb,
          ueberlapp: n.classList.contains("is-shown") && nr.right > rechts.left + 1 };
      }, sichtbar);
      if (!r.text) continue;
      const ok = !r.ab && !r.ueberlapp && !r.hinweisAb;
      if (!ok) fehler++;
      console.log((ok ? "✓ " : "✗ ") + p + (sichtbar ? " (Hinweis sichtbar)" : " (Hinweis aus)") + ": „" + r.text + "“ " + r.cw + "/" + r.sw + " px" + (sichtbar ? " · Hinweis: " + r.hinweis + (r.hinweisAb ? " (abgeschnitten)" : "") : "") + (r.ueberlapp ? " – Hinweis ragt in die Knöpfe" : ""));
      if (p === "events" || p === "departures") {
        await page.waitForTimeout(450);
        await page.screenshot({ path: path.join(OUT, PREFIX + p + (sichtbar ? "-hinweis" : "") + ".png"), clip: { x: 0, y: 0, width: 1024, height: 120 } });
      }
    }
  }
  console.log(errors.length ? "Seitenfehler: " + errors.join(" | ") : "Keine Seitenfehler.");
  console.log(fehler ? fehler + " abgeschnittene Titel" : "Kein Titel abgeschnitten.");
  await browser.close();
  process.exit(fehler ? 1 : 0);
})();
