#!/usr/bin/env node
// ---------------------------------------------------------------
// Probe „kein Gummiband“ (FEEDBACK 10.10. 12:37): Beim senkrechten Wischen
// darf die Seite nicht mitziehen, echte Scroll-Bereiche müssen weiter
// scrollen, Blättern per Wischen und Regler-Ziehen müssen weiter gehen.
// Touch-Folgen werden wie in tool/screenshot.js mit document.createTouch
// erzeugt; ob die Seite gezogen würde, zeigt defaultPrevented am touchmove
// (genau das, was Safari 12 fürs Gummiband auswertet).
// Gegen den Simulator (nie ein echtes HA):
//   node tool/ha-simulator/server.js &   node tool/pruefe-gummiband.js [--out …]
// ---------------------------------------------------------------
"use strict";
const fs = require("fs");
const path = require("path");
const { webkit } = require("playwright");

const args = process.argv.slice(2);
const opt = (n, s) => { const i = args.indexOf("--" + n); return i === -1 ? s : args[i + 1]; };
const URL_ = opt("url", "http://localhost:8124/local/tafel/index.html?ha_token=tafel-sim-token");
const OUT = path.resolve(opt("out", "belege/2026-10-10/s8/gummiband"));
fs.mkdirSync(OUT, { recursive: true });

let ok = 0, schlecht = 0;
function pruefe(bed, text) {
  if (bed) { ok++; console.log("✓ " + text); } else { schlecht++; console.log("✗ " + text); }
}

// Touch-Folge in der Seite; liefert, ob irgendein touchmove verhindert wurde.
async function zug(page, sel, x1, y1, x2, y2, schritte) {
  return page.evaluate(async (a) => {
    const ziel = (a.sel && document.querySelector(a.sel)) || document.elementFromPoint(a.x1, a.y1);
    const mache = (x, y) => document.createTouch(window, ziel, 1, x, y, x, y);
    const liste = (arr) => document.createTouchList.apply(document, arr);
    let verhindert = 0, zuege = 0;
    const feuere = (typ, x, y, ende) => {
      const t = mache(x, y);
      const ev = new TouchEvent(typ, { bubbles: true, cancelable: true, touches: liste(ende ? [] : [t]), targetTouches: liste(ende ? [] : [t]), changedTouches: liste([t]) });
      const durch = ziel.dispatchEvent(ev);
      if (typ === "touchmove") { zuege++; if (!durch) verhindert++; }
    };
    feuere("touchstart", a.x1, a.y1, false);
    for (let i = 1; i <= a.n; i++) {
      await new Promise((r) => setTimeout(r, 25));
      feuere("touchmove", a.x1 + (a.x2 - a.x1) * i / a.n, a.y1 + (a.y2 - a.y1) * i / a.n, false);
    }
    feuere("touchend", a.x2, a.y2, true);
    return { verhindert: verhindert, zuege: zuege, ziel: ziel ? ziel.className || ziel.id : "" };
  }, { sel: sel, x1: x1, y1: y1, x2: x2, y2: y2, n: schritte || 8 });
}

(async () => {
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const fehler = [];
  page.on("pageerror", (e) => { if (!/access control|Load failed|Failed to fetch/i.test(String(e))) fehler.push(String(e)); });
  await page.goto(URL_);
  await page.waitForFunction(() => window.TafelHA && TafelHA.isConnected(), null, { timeout: 30000 });
  await page.waitForTimeout(2000);

  pruefe(await page.evaluate(() => getComputedStyle(document.body).position === "fixed"), "body ist festgenagelt (position: fixed)");

  // 1. Abfahrten: senkrecht wischen → Seite darf nicht mitgehen
  await page.evaluate(() => { jumpToPanel("departures"); pauseCarouselIndefinitely(); });
  await page.waitForTimeout(800);
  let r = await zug(page, null, 500, 300, 500, 600);
  pruefe(r.zuege > 0 && r.verhindert === r.zuege, "Abfahrten nach unten wischen: alle " + r.zuege + " touchmove gesperrt (kein Gummiband)");
  r = await zug(page, null, 500, 600, 500, 250);
  pruefe(r.verhindert === r.zuege, "Abfahrten nach oben wischen: gesperrt");

  // 2. Blättern per Wischen geht weiter (Nachrichten)
  await page.evaluate(() => { jumpToPanel("news"); pauseCarouselIndefinitely(); });
  await page.waitForTimeout(1500);
  const vor = await page.evaluate(() => newsSlideIndex);
  r = await zug(page, "#stage", 800, 400, 300, 410, 10);
  await page.waitForTimeout(900);
  const nach = await page.evaluate(() => newsSlideIndex);
  pruefe(nach !== vor, "Nachrichten waagerecht wischen blättert weiter (" + vor + " → " + nach + ")");

  // 3. Echter Scroll-Bereich: Einstellungen (lange auf die Uhr)
  const uhr = await (await page.$(".clock")).boundingBox();
  await page.mouse.move(uhr.x + uhr.width / 2, uhr.y + uhr.height / 2);
  await page.mouse.down(); await page.waitForTimeout(1000); await page.mouse.up();
  await page.waitForTimeout(700);
  const karte = await page.evaluate(() => {
    const k = document.querySelector(".ha-setup-card");
    if (!k) return null;
    k.scrollTop = 0;
    const b = k.getBoundingClientRect();
    return { kann: k.scrollHeight > k.clientHeight + 1, x: b.left + b.width / 2, y: b.top + b.height / 2, max: k.scrollHeight - k.clientHeight };
  });
  pruefe(karte && karte.kann, "Einstellungen sind ein echter Scroll-Bereich" + (karte ? " (" + karte.max + " px)" : ""));
  if (karte && karte.kann) {
    r = await zug(page, ".ha-setup-card .ha-setup-title", karte.x, karte.y, karte.x, karte.y + 200);
    pruefe(r.verhindert === r.zuege, "Einstellungen ganz oben, nach unten ziehen: gesperrt (sonst zöge die Seite)");
    r = await zug(page, ".ha-setup-card .ha-setup-title", karte.x, karte.y + 150, karte.x, karte.y - 100);
    pruefe(r.verhindert === 0, "Einstellungen ganz oben, nach oben schieben: darf scrollen (" + r.verhindert + " gesperrt)");
    await page.evaluate(() => { const k = document.querySelector(".ha-setup-card"); k.scrollTop = Math.floor((k.scrollHeight - k.clientHeight) / 2); });
    r = await zug(page, ".ha-setup-card .ha-setup-title", karte.x, karte.y, karte.x, karte.y + 120);
    const r2 = await zug(page, ".ha-setup-card .ha-setup-title", karte.x, karte.y + 120, karte.x, karte.y);
    pruefe(r.verhindert === 0 && r2.verhindert === 0, "Einstellungen in der Mitte: beide Richtungen scrollen");
    await page.evaluate(() => { const k = document.querySelector(".ha-setup-card"); k.scrollTop = k.scrollHeight; });
    r = await zug(page, ".ha-setup-card .ha-setup-title", karte.x, karte.y + 100, karte.x, karte.y - 100);
    pruefe(r.verhindert === r.zuege, "Einstellungen ganz unten, weiter nach oben schieben: gesperrt");
    await page.screenshot({ path: path.join(OUT, "einstellungen.png") });
  }
  await page.evaluate(() => { const d = document.getElementById("haSetup"); if (d) d.click(); });
  await page.waitForTimeout(500);

  // 4. Regler in der Raumansicht per Touch ziehen
  await page.evaluate(() => { jumpToPanel("home"); pauseCarouselIndefinitely(); });
  await page.waitForTimeout(1200);
  await page.click(".ha-room-slot .ha-room-name, .ha-room-slot", { position: { x: 60, y: 30 } }).catch(() => {});
  await page.waitForTimeout(1200);
  const regler = await page.evaluate(() => {
    const s = document.querySelector(".ha-overlay .ha-slider[data-id^='light.']:not(.is-disabled)");
    if (!s) return null;
    const b = s.getBoundingClientRect();
    return { id: s.getAttribute("data-id"), x: b.left, y: b.top + b.height / 2, w: b.width };
  });
  if (regler) {
    r = await zug(page, ".ha-overlay .ha-slider[data-id^='light.']:not(.is-disabled)", regler.x + regler.w * 0.2, regler.y, regler.x + regler.w * 0.75, regler.y + 3, 10);
    await page.waitForTimeout(1500);
    const hell = await page.evaluate((id) => { const st = TafelHA.state(id); return st ? [st.state, st.attributes.brightness] : null; }, regler.id);
    pruefe(hell && hell[0] === "on" && hell[1] > 150, "Regler per Touch gezogen: " + regler.id + " → " + JSON.stringify(hell));
    await page.screenshot({ path: path.join(OUT, "regler.png") });
  } else {
    pruefe(false, "Raumansicht mit Regler gefunden");
  }

  pruefe(fehler.length === 0, "keine Seitenfehler" + (fehler.length ? " – " + fehler.join(" | ").slice(0, 300) : ""));
  await browser.close();
  console.log("\n" + (schlecht ? "✗ " + schlecht + " von " + (ok + schlecht) + " Prüfungen fehlgeschlagen" : "✓ alle " + ok + " Prüfungen bestanden"));
  process.exit(schlecht ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
