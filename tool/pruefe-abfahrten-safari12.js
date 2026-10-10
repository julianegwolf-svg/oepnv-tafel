#!/usr/bin/env node
// ---------------------------------------------------------------
// Probe zu FEEDBACK 10.10. 11:59 – Abfahrten am echten iPad (Safari 12)
// "schwarz auf schwarz". Ein altes WebKit lässt sich hier nicht starten
// (kein Docker, kein iOS-12-Simulator, alte Playwright-Builds nicht mehr
// abrufbar) – geprüft wird deshalb, dass die Tafel die bekannten
// Safari-12-Fallen gar nicht erst betritt:
//  1. Die Farbwelt-Klasse steht am <body>, bevor das erste Panel-Element
//     entsteht (kein Umschalten von CSS-Variablen nach dem Zeichnen).
//  2. Abfahrtszeilen: Schrift/Grund fest und deckend, Kontrast ≥ 7 : 1
//     (dunkel und hell); Zeilen-Hintergrund ohne Durchsichtigkeit.
//  3. Umschalten zur Laufzeit (Farbwelt "auto") baut die Tafel neu auf,
//     Zeilen haben danach die neuen Farben, keine Seitenfehler.
//  4. LOS-Balken: keine laufende CSS-Transition (keine Dauer-GPU-Ebene),
//     schrumpft trotzdem im Sekundentakt.
//  5. Wächter: unlesbare erste Zeile wird erkannt, notiert und höchstens
//     einmal je 10 min neu aufgebaut.
//  6. Einstellungen → Anzeige-Prüfung zeigt Gerät, Farbwelt, Kontrast,
//     Fehler (Bild).
// Aufruf: node tool/pruefe-abfahrten-safari12.js [--out <ordner>] [--url <url>]
// ---------------------------------------------------------------
"use strict";
const fs = require("fs");
const path = require("path");
const { webkit } = require("playwright");

const args = process.argv.slice(2);
const opt = (n, s) => { const i = args.indexOf("--" + n); return i === -1 ? s : args[i + 1]; };
const BASIS = opt("url", "http://localhost:8765/index.html");
const OUT = path.resolve(opt("out", "belege/2026-10-10/s8/abfahrten-probe"));
fs.mkdirSync(OUT, { recursive: true });
const REPO = path.resolve(__dirname, "..");

const UA = "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1";
let ok = 0, schlecht = 0;
function pruefe(bed, text) {
  if (bed) { ok++; console.log("✓ " + text); } else { schlecht++; console.log("✗ " + text); }
}

function configMit(welt) {
  const src = fs.readFileSync(path.join(REPO, "config.js"), "utf8");
  return src.replace(/farbwelt:\s*"[a-z]+"/, 'farbwelt: "' + welt + '"');
}

async function seite(browser, welt, jetzt) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, userAgent: UA, hasTouch: true });
  const page = await ctx.newPage();
  const fehler = [];
  page.on("pageerror", (e) => { if (!/access control|Load failed|Failed to fetch/i.test(String(e))) fehler.push(String(e)); });
  await page.route(/\/config\.js/, (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: configMit(welt) }));
  // Zeitpunkt, zu dem das erste Panel-Element entsteht: welche Klasse hat <body> da?
  await page.addInitScript(() => {
    window.__klasseBeimErstenPanel = null;
    const mo = new MutationObserver(() => {
      if (window.__klasseBeimErstenPanel === null && document.querySelector(".panel")) {
        window.__klasseBeimErstenPanel = document.body ? document.body.className : "(kein body)";
        mo.disconnect();
      }
    });
    mo.observe(document, { childList: true, subtree: true });
  });
  const url = BASIS + (jetzt ? (BASIS.indexOf("?") === -1 ? "?" : "&") + "jetzt=" + encodeURIComponent(jetzt) : "");
  await page.goto(url);
  return { ctx, page, fehler };
}

async function zeilenFarben(page) {
  return page.evaluate(() => {
    const zeile = document.querySelector("#departureRows .dep-row");
    if (!zeile) return null;
    const cs = getComputedStyle(zeile);
    return {
      ziel: tafelKontrast(zeile.querySelector(".dest")),
      minuten: tafelKontrast(zeile.querySelector(".time-min")),
      bgFarbe: cs.backgroundColor,
      bgBild: cs.backgroundImage,
      klasse: zeile.className,
      body: document.body.className,
    };
  });
}

function deckend(f) {
  // backgroundColor leer (nur Verlauf) oder deckend; alle Verlaufsfarben deckend
  const durchsichtig = /rgba\([^)]*,\s*0(\.\d+)?\)/.test(f.bgFarbe) && !/rgba\(0, 0, 0, 0\)/.test(f.bgFarbe);
  const verlaufDurchsichtig = /rgba\(/.test(f.bgBild);
  return !durchsichtig && !verlaufDurchsichtig;
}

(async () => {
  const browser = await webkit.launch();

  // --- 1./2. dunkel und hell ---
  for (const welt of ["dunkel", "hell"]) {
    const { ctx, page, fehler } = await seite(browser, welt, "2026-10-12T07:22");
    await page.waitForSelector("#departureRows .dep-row", { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const klasse = await page.evaluate(() => window.__klasseBeimErstenPanel);
    pruefe(welt === "dunkel" ? /farbe-dunkel/.test(klasse || "") : !/farbe-dunkel/.test(klasse || ""),
      welt + ": Klasse am <body>, als das erste Panel-Element entstand: \"" + klasse + "\"");
    const f = await zeilenFarben(page);
    pruefe(!!f, welt + ": Abfahrtszeilen vorhanden");
    if (f) {
      pruefe(f.ziel && f.ziel.verhaeltnis >= 7, welt + ": Ziel " + (f.ziel ? f.ziel.schrift + " auf " + f.ziel.grund + " = " + f.ziel.verhaeltnis.toFixed(1) + " : 1" : "?"));
      pruefe(f.minuten && f.minuten.verhaeltnis >= 7, welt + ": Minuten " + (f.minuten ? f.minuten.schrift + " auf " + f.minuten.grund + " = " + f.minuten.verhaeltnis.toFixed(1) + " : 1" : "?"));
      pruefe(deckend(f), welt + ": Zeilen-Hintergrund deckend (" + (f.bgBild !== "none" ? f.bgBild.slice(0, 70) : f.bgFarbe) + ")");
    }
    await page.screenshot({ path: path.join(OUT, welt + "-abfahrten.png") });
    pruefe(fehler.length === 0, welt + ": keine Seitenfehler" + (fehler.length ? " – " + fehler.join(" | ").slice(0, 200) : ""));
    await ctx.close();
  }

  // --- 3. Umschalten zur Laufzeit, 4. Balken, 5. Wächter, 6. Einstellungen ---
  {
    const { ctx, page, fehler } = await seite(browser, "auto", "2026-10-12T07:22");
    await page.waitForSelector("#departureRows .dep-row", { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const vor = await zeilenFarben(page);
    // Umschalten erzwingen: Einstellung im laufenden Betrieb ändern, die Uhr
    // (Sekundentakt) schaltet um und baut neu auf.
    const zielWelt = vor && /farbe-dunkel/.test(vor.body) ? "hell" : "dunkel";
    // Karussell-Balken frisch starten (bekannte Laufzeit), dann umschalten
    await page.evaluate(() => { resetProgressBar(60000); });
    await page.waitForTimeout(3000);
    const balkenVor = await page.evaluate(() => currentProgressFraction());
    await page.evaluate((w) => { CONFIG.farbwelt = w; }, zielWelt);
    await page.waitForTimeout(1600);
    const balkenNach = await page.evaluate(() => currentProgressFraction());
    pruefe(balkenNach < 0.5 && balkenNach >= balkenVor, "Karussell-Balken läuft nach dem Neuaufbau weiter (" + balkenVor.toFixed(2) + " → " + balkenNach.toFixed(2) + ", nicht auf voll)");
    const nach = await zeilenFarben(page);
    pruefe(vor && nach && vor.ziel.schrift !== nach.ziel.schrift && nach.ziel.verhaeltnis >= 7,
      "Umschalten zur Laufzeit (" + (vor ? vor.body || "hell" : "?") + " → " + zielWelt + "): Ziel " +
      (vor ? vor.ziel.schrift : "?") + " → " + (nach ? nach.ziel.schrift + " auf " + nach.ziel.grund + " (" + nach.ziel.verhaeltnis.toFixed(1) + " : 1)" : "?"));
    const panelDa = await page.evaluate(() => getComputedStyle(document.querySelector(".panel")).display !== "none" &&
      document.querySelector("#panel-departures").classList.contains("active"));
    pruefe(panelDa, "nach dem Neuaufbau ist die Tafel sichtbar, Abfahrten aktiv");

    // 4. Balken
    const balken = await page.evaluate(async () => {
      const bar = document.querySelector(".dep-pill.is-shown .dep-pill-bar");
      if (!bar) return null;
      const a = bar.style.transform;
      const laufend = document.getAnimations().filter((x) => x.effect && x.effect.target === bar).length;
      await new Promise((r) => setTimeout(r, 4200));
      return { a: a, b: bar.style.transform, laufend: laufend, alle: document.getAnimations().filter((x) => x.playState === "running").map((x) => (x.transitionProperty || x.animationName) + "@" + (x.effect.target.className || x.effect.target.id)) };
    });
    if (balken) {
      const wa = parseFloat((/scaleX\(([\d.]+)\)/.exec(balken.a) || [])[1]);
      const wb = parseFloat((/scaleX\(([\d.]+)\)/.exec(balken.b) || [])[1]);
      pruefe(balken.laufend === 0, "LOS-Balken ohne laufende CSS-Transition/Animation (laufend gesamt: " + (balken.alle.join(", ") || "keine") + ")");
      pruefe(wb < wa || wa === 0, "LOS-Balken schrumpft im Sekundentakt: " + balken.a + " → " + balken.b);
    } else {
      console.log("  (keine LOS-Pille zu sehen – Balken-Prüfung übersprungen)");
    }

    // 5. Wächter
    await page.addStyleTag({ content: ".dep-row .dest { color: #17202c !important; } body:not(.farbe-dunkel) .dep-row .dest { color: #fdfdfc !important; }" });
    const w = await page.evaluate(async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 32000) {
        if ((window.tafelFehler || []).some((f) => /unlesbar/.test(f))) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      await new Promise((r) => setTimeout(r, 31000)); // noch ein Takt: darf nicht erneut auslösen
      return (window.tafelFehler || []).filter((f) => /unlesbar/.test(f));
    });
    pruefe(w.length === 1, "Wächter: unlesbare Zeile erkannt und genau einmal neu aufgebaut (" + (w[0] || "nichts notiert") + ")");

    // 6. Einstellungen → Anzeige-Prüfung
    await page.mouse.move(930, 40);
    const uhr = await page.$(".clock");
    const box = await uhr.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1000);
    await page.mouse.up();
    await page.waitForTimeout(600);
    const anzeige = await page.evaluate(() => {
      const el = document.querySelector(".ha-setup-anzeige");
      if (!el) return null;
      const karte = el.closest(".ha-setup-card"); if (karte) karte.scrollTop = karte.scrollHeight;
      return el.innerText;
    });
    pruefe(!!anzeige && /iPad · iOS 12\.5/.test(anzeige) && /Abfahrt: Ziel/.test(anzeige) && /unlesbar/.test(anzeige),
      "Einstellungen zeigen die Anzeige-Prüfung (Gerät, Kontrast, notierter Fehler)");
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "einstellungen-anzeige-pruefung.png") });
    pruefe(fehler.length === 0, "Umschalten/Wächter: keine Seitenfehler" + (fehler.length ? " – " + fehler.join(" | ").slice(0, 200) : ""));
    await ctx.close();
  }

  await browser.close();
  console.log("\n" + (schlecht ? "✗ " + schlecht + " von " + (ok + schlecht) + " Prüfungen fehlgeschlagen" : "✓ alle " + ok + " Prüfungen bestanden"));
  process.exit(schlecht ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
