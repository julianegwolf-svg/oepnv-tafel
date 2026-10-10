#!/usr/bin/env node
// ---------------------------------------------------------------
// Probe Cover im Medien-Panel (FEEDBACK 10.10.: HomePod „Spielt jetzt“ ohne
// Cover). Eigener, frischer Simulator (nie ein echtes HA); die iTunes-Suche
// wird ECHT gefragt (je Fall höchstens ein Abruf, zusammen ~6).
//   1  entity_picture aus HA                  → genau dieses Bild
//   2  ohne entity_picture, echte Titel       → iTunes-Cover (600×600)
//   3  Radio „Interpret - Titel“ (ICY)         → iTunes-Cover
//   4  Radio nur mit Sendernamen              → Sender-Kachel
//   5  unbekannter Titel                      → Lautsprecher-Symbol
//   6  Titel passt, Interpret nicht           → KEIN Cover (nichts Falsches)
// Dazu: Schein in der Cover-Farbe, weicher Wechsel (neues <img>), kein
// zweiter iTunes-Abruf für denselben Titel.
// Aufruf: node tool/pruefe-cover.js [--out <ordner>] [--port 8147]
// ---------------------------------------------------------------
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { webkit } = require("playwright");

const args = process.argv.slice(2);
const opt = (n, s) => { const i = args.indexOf("--" + n); return i === -1 ? s : args[i + 1]; };
const PORT = Number(opt("port", "8147"));
const OUT = path.resolve(opt("out", "belege/2026-10-10/s8/cover"));
fs.mkdirSync(OUT, { recursive: true });
const SIM = "http://localhost:" + PORT;
let HP = null; // erster Lautsprecher aus dem Simulator (siehe unten)
const WDR4 = "https://icecast.wdr.de/wdr/wdr4/rheinruhr/mp3/128/stream.mp3";

let ok = 0, schlecht = 0;
function pruefe(bed, text) {
  if (bed) { ok++; console.log("✓ " + text); } else { schlecht++; console.log("✗ " + text); }
}

function post(pfad, body) {
  return new Promise((res, rej) => {
    const daten = JSON.stringify(body);
    const req = http.request(SIM + pfad, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(daten) } }, (r) => {
      let t = ""; r.on("data", (c) => (t += c)); r.on("end", () => (r.statusCode < 300 ? res(t) : rej(new Error(pfad + " " + r.statusCode + " " + t))));
    });
    req.on("error", rej); req.end(daten);
  });
}

function warteAufSim() {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function versuch() {
      http.get(SIM + "/sim/status", (r) => { r.resume(); res(); }).on("error", () => {
        if (Date.now() - t0 > 15000) rej(new Error("Simulator startet nicht")); else setTimeout(versuch, 300);
      });
    })();
  });
}

(async () => {
  const sim = spawn(process.execPath, [path.join(__dirname, "ha-simulator", "server.js")], {
    env: Object.assign({}, process.env, { PORT: String(PORT), HA_SIM_LEISE: "1", HA_SIM_OHNE_COVER: "1" }), stdio: "ignore",
  });
  let browser;
  try {
    await warteAufSim();
    browser = await webkit.launch();
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    const page = await ctx.newPage();
    const fehler = [];
    let itunes = 0;
    page.on("pageerror", (e) => { if (!/access control|Load failed|Failed to fetch/i.test(String(e))) fehler.push(String(e)); });
    page.on("request", (r) => { if (/itunes\.apple\.com\/search/.test(r.url())) itunes++; });
    await page.goto(SIM + "/local/tafel/index.html?ha_token=tafel-sim-token");
    await page.waitForFunction(() => window.TafelHA && TafelHA.isConnected(), null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    HP = await page.evaluate(() => TafelHA.model().global.media[0]);
    await page.evaluate(() => { jumpToPanel("medien"); pauseCarouselIndefinitely(); });

    async function fall(name, attrs, warte) {
      await post("/sim/state", { entity_id: HP, state: "playing", attributes: Object.assign({ entity_picture: null, media_content_id: null, media_artist: null, media_album_name: null, media_content_type: "music",
        media_duration: attrs.media_content_id ? null : 215, media_position: attrs.media_content_id ? null : 40 }, attrs) });
      // (entity_picture: null = HA liefert keins; der Simulator merkt sich das)
      await page.waitForTimeout(warte || 3500);
      const r = await page.evaluate(() => {
        const box = document.querySelector("#haMedien .ha-cover-l");
        const img = box && box.querySelector("img");
        const hero = document.querySelector("#haMedien .ha-hero");
        return {
          src: img ? img.getAttribute("src") : "",
          geladen: img ? img.complete && img.naturalWidth > 0 : false,
          sender: box && box.querySelector(".ha-sender-name") ? box.querySelector(".ha-sender-name").textContent : "",
          symbol: !!(box && box.querySelector(".ha-ico")),
          schein: hero ? hero.classList.contains("has-cover-schein") : false,
          farbe: hero ? hero.style.getPropertyValue("--cover-rgb") : "",
          titel: (document.querySelector("#haMedien .ha-hero-title") || {}).textContent || "",
        };
      });
      await page.screenshot({ path: path.join(OUT, name + ".png") });
      return r;
    }

    // 1 entity_picture (Simulator-Proxy)
    const itunesVor1 = itunes;
    // (ein ladbares Bild; relative Proxy-Pfade + Auflösung zur HA-Adresse prüft Fall 8)
    const BILD = "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/e8/43/5f/e8435ffa-b6b9-b171-40ab-4ff3959ab661/886443919266.jpg/300x300bb.jpg";
    let r = await fall("1-entity-picture", { media_title: "Ein Titel ohne Suche", media_artist: "Irgendwer", entity_picture: BILD });
    pruefe(r.src === BILD && r.geladen, "1 entity_picture aus HA wird genommen: " + r.src.slice(-40));
    pruefe(itunes === itunesVor1, "1 mit entity_picture keine iTunes-Suche");
    const vorItunes = itunes;

    // 2 echte Titel ohne entity_picture
    const echte = [["Peter Fox", "Haus am See"], ["Daft Punk", "Get Lucky (feat. Pharrell Williams)"], ["Nena", "99 Luftballons"]];
    for (let i = 0; i < echte.length; i++) {
      r = await fall("2-itunes-" + (i + 1), { media_artist: echte[i][0], media_title: echte[i][1] });
      pruefe(/^https:\/\/is\d-ssl\.mzstatic\.com\/.+\/600x600bb\.jpg$/.test(r.src) && r.geladen, "2 " + echte[i][0] + " – " + echte[i][1] + ": iTunes-Cover " + r.src.replace(/^.*\/image\/thumb\//, "…/"));
      pruefe(r.schein && /^\d+, \d+, \d+$/.test(r.farbe), "2 Schein in der Cover-Farbe (" + r.farbe + ")");
    }

    // Gleicher Titel noch einmal: aus dem Speicher, kein neuer Abruf
    const n0 = itunes;
    r = await fall("2-itunes-wieder", { media_artist: "Peter Fox", media_title: "Haus am See" }, 1500);
    pruefe(itunes === n0 && /mzstatic/.test(r.src), "2 derselbe Titel noch einmal: Cover aus dem Speicher, kein neuer Abruf");

    // 3 Radio mit "Interpret - Titel"
    r = await fall("3-radio-icy", { media_title: "Nena - 99 Luftballons", media_content_id: WDR4 });
    const zeilen = await page.evaluate(() => [(document.querySelector("#haMedien .ha-hero-title") || {}).textContent, (document.querySelector("#haMedien .ha-hero-artist") || {}).textContent]);
    pruefe(/mzstatic/.test(r.src) && zeilen[0] === "99 Luftballons" && zeilen[1] === "Nena", "3 Radio „Nena - 99 Luftballons“ (ohne media_artist): iTunes-Cover, Titel/Interpret getrennt " + JSON.stringify(zeilen));

    // 4 Radio nur Sendername
    r = await fall("4-radio-sender", { media_title: "WDR 4", media_content_id: WDR4 });
    pruefe(!r.src && r.sender === "WDR 4", "4 Radio ohne Titel: Sender-Kachel „" + r.sender + "“");

    // 5 unbekannter Titel
    r = await fall("5-unbekannt", { media_artist: "Testband Xyzqw", media_title: "Gibt es nicht 4711" });
    pruefe(!r.src && r.symbol, "5 unbekannter Titel: Lautsprecher-Symbol, kein Bild");

    // 6 Titel passt, Interpret nicht
    r = await fall("6-falscher-interpret", { media_artist: "Helene Fischer", media_title: "Get Lucky" });
    pruefe(!r.src && /Get Lucky/.test(r.titel), "6 „Get Lucky“ von „Helene Fischer“: kein (fremdes) Cover" + (r.src ? " – gezeigt: " + r.src + " bei „" + r.titel + "“" : ""));

    // 7 Podcast (FEEDBACK 12:37: „Mord auf Ex“ mit Fragezeichen)
    r = await fall("7-podcast", { media_title: "Folge 312: Der Fall", media_artist: "MORD AUF EX", media_album_name: "MORD AUF EX", media_content_type: "podcast" });
    pruefe(/^https:\/\/is\d-ssl\.mzstatic\.com\/.+\/600x600bb\.jpg$/.test(r.src) && r.geladen, "7 Podcast „MORD AUF EX“: Cover der Sendung " + r.src.replace(/^.*\/image\/thumb\//, "…/"));
    // 8 HA-Bild lädt nicht (Fragezeichen) → Ausweichen auf iTunes
    r = await fall("8-kaputtes-bild", { media_title: "Haus am See", media_artist: "Peter Fox", entity_picture: "/api/media_player_proxy/" + HP + "?token=kaputt&cache=9" }, 4500);
    pruefe(/mzstatic/.test(r.src) && r.geladen, "8 entity_picture (relativ, zur HA-Adresse aufgelöst) lädt nicht → iTunes-Cover statt Fragezeichen");

    pruefe(itunes - vorItunes <= 9, "iTunes-Abrufe insgesamt: " + (itunes - vorItunes) + " (je neuer Titel höchstens einer bzw. Song + Sendung)");
    pruefe(fehler.length === 0, "keine Seitenfehler" + (fehler.length ? " – " + fehler.join(" | ").slice(0, 300) : ""));
  } finally {
    if (browser) await browser.close();
    sim.kill();
  }
  console.log("\n" + (schlecht ? "✗ " + schlecht + " von " + (ok + schlecht) + " Prüfungen fehlgeschlagen" : "✓ alle " + ok + " Prüfungen bestanden"));
  process.exit(schlecht ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
