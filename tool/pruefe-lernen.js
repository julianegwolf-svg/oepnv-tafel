// Prüft lernen.js gegen den Simulator mit mehreren Wochen Verlauf: Lernt
// die Tafel den Rhythmus aus HA (Personen + Logbuch der Automationen), und
// kommen die Vorschläge zur richtigen Zeit — und nur dann?
//
//   HA_SIM_WOCHEN=4 PORT=8128 node tool/ha-simulator/server.js &
//   node tool/pruefe-lernen.js --sim http://localhost:8128 --out belege/2026-10-10/lernen
//
// Die Uhrzeit wird per ?jetzt= (debug-zeit.js) gesetzt.
const { webkit } = require("playwright");
const path = require("path");
const fs = require("fs");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SIM = arg("sim", "http://localhost:8128");
const OUT = arg("out", "belege/lernen");

const FAELLE = [
  { name: "werktag-morgens", jetzt: "2026-10-12T07:12", erwartet: /werktags meist um 07:[23]\d los/, panel: "departures" },
  { name: "abends", jetzt: "2026-10-12T22:14", erwartet: /Wie jeden Abend: Gute Nacht/, panel: "home" },
  { name: "samstag-vormittag", jetzt: "2026-10-17T09:51", erwartet: /Arbeiten\?.*(samstags|wochenende).*(09:[3-5]\d|10:[0-3]\d)/i, panel: "home" }, // Verlauf ist zufällig: um 10 Uhr
  { name: "werktag-nachmittags", jetzt: "2026-10-12T14:30", erwartet: null, panel: "home" },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  let ok = true;
  let beschreibung = null;
  for (const f of FAELLE) {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    // Externe Quellen, die von localhost aus blockieren (Kalender-Worker), sind kein Code-Fehler.
    page.on("pageerror", (e) => { if (!/access control checks/.test(e.message)) errors.push(e.message); });
    await page.goto(SIM + "/local/tafel/index.html?jetzt=" + f.jetzt);
    await page.evaluate(() => { CONFIG.nightDim = null; CONFIG.nightSleep = null; tickClock(); });
    await page.waitForSelector("#haLogin.is-open", { timeout: 10000 });
    await page.fill("#haLoginUser", "tafel");
    await page.fill("#haLoginPass", "tafel-passwort");
    await page.tap("#haLoginSubmit");
    await page.waitForFunction(() => window.TafelHA && TafelHA.isConnected(), null, { timeout: 15000 });
    await page.waitForTimeout(6000); // Abfahrten/Wetter laden (für den Losgeh-Vorschlag)
    const gelernt = await page.evaluate(() => TafelLernen.neuLernen().then(() => {
      const d = TafelLernen._daten();
      const o = {};
      Object.keys(d.ha).forEach((k) => { o[k] = d.ha[k].length; });
      return o;
    }));
    const vorschlaege = await page.evaluate(() => TafelLernen.vorschlaege().map((v) => v.text));
    await page.evaluate((p) => jumpToPanel(p), f.panel);
    await page.waitForTimeout(2600);
    const chips = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll("#haHints .ha-hint.is-vorschlag"), (e) => e.textContent));
    const file = path.join(OUT, f.name + ".png");
    await page.screenshot({ path: file });
    let pass;
    if (f.erwartet) pass = vorschlaege.some((t) => f.erwartet.test(t)) && chips.length > 0;
    else pass = vorschlaege.length === 0 && chips.length === 0;
    if (!pass) ok = false;
    console.log((pass ? "✓ " : "✗ ") + f.name + " (" + f.jetzt + "): " + (vorschlaege.length ? vorschlaege.join(" | ") : "kein Vorschlag") + "  → " + file);
    console.log("   gelernt aus HA: " + JSON.stringify(gelernt));
    if (errors.length) { console.log("   Seitenfehler: " + errors.slice(0, 3).join(" | ")); ok = false; }
    if (!beschreibung) {
      beschreibung = await page.evaluate(() => TafelLernen.beschreibung());
      // Einstellungen mit "Was die Tafel gelernt hat" fotografieren.
      await page.evaluate(() => TafelHAUI.openSetup());
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, "einstellungen-gelernt.png") });
    }
    // Ablehnen: Vorschlag verschwindet für heute.
    if (f.erwartet && chips.length) {
      await page.evaluate(() => { const s = document.getElementById("haSetup"); if (s) s.classList.remove("is-open"); });
      const weg = await page.$("#haHints .ha-hint.is-vorschlag .ha-hint-weg");
      if (weg) {
        await weg.tap();
        await page.waitForTimeout(1500);
        const danach = await page.evaluate(() => document.querySelectorAll("#haHints .ha-hint.is-vorschlag").length);
        const p2 = danach < chips.length;
        if (!p2) ok = false;
        console.log((p2 ? "✓ " : "✗ ") + "   „Nicht jetzt“ blendet den Vorschlag aus (" + chips.length + " → " + danach + ")");
      }
    }
    await ctx.close();
  }
  console.log("Was die Tafel gelernt hat:\n  - " + (beschreibung || []).join("\n  - "));
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
