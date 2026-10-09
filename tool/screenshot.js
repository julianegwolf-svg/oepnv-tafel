#!/usr/bin/env node
// ---------------------------------------------------------------
// SmartTafel – Screenshot- und Bedien-Werkzeug (Playwright, WebKit)
//
// Fotografiert die Tafel so, wie das Wand-iPad sie zeigt: 1024×768,
// Touch, iPad-Safari-12-Kennung. Panels werden über die globale
// Funktion jumpToPanel(name) aus app.js angesprungen.
//
// Aufruf (aus dem Repo-Wurzelordner):
//   node tool/screenshot.js --panels weather,news --out belege/2026-10-10/ --prefix vorher-
//   node tool/screenshot.js --panels alle --jetzt 2026-10-12T07:20
//   node tool/screenshot.js --aktion "enterAmbientMode()" --name ambient
//   node tool/screenshot.js --klick "#panelNavToggle" --name uebersicht
//   node tool/screenshot.js --skript tool/ablauf-wischen.js
//   node tool/screenshot.js --panels quote:9000,trivia:9000 --panelwarte 2500
//
// Optionen:
//   --url <url>          Seite (Standard http://localhost:8765/index.html)
//   --jetzt <zeit>       hängt ?jetzt=<zeit> an (siehe debug-zeit.js)
//   --tempo <n>          hängt ?tempo=<n> an (Zeitraffer, siehe debug-zeit.js)
//   --panels <liste>     Kommagetrennt; "alle" = alle section.panel-view der Seite.
//                        Eigene Wartezeit je Panel: name:ms (z. B. quote:9000)
//   --out <ordner>       Zielordner (Standard belege/<heute>/)
//   --prefix <text>      Vorsilbe der Dateinamen (z. B. "vorher-")
//   --name <name>        Dateiname für Einzelbild (ohne Panels), Standard "seite"
//   --warte <ms>         Wartezeit nach dem Laden (Standard 9000)
//   --panelwarte <ms>    Wartezeit nach jedem Panel-Sprung (Standard 2500)
//   --aktion "<js>"      JS vor jedem Foto in der Seite ausführen (Promise wird abgewartet)
//   --klick "<selektor>" vor jedem Foto antippen (Playwright tap, echtes Touch-Ereignis)
//   --tippe x,y          vor jedem Foto an Koordinate antippen
//   --nachwarte <ms>     Wartezeit nach aktion/klick/tippe (Standard 600)
//   --skript <datei.js>  eigenes Ablaufskript: module.exports = async (page, hilfe) => {…}
//   --localstorage k=v   vor dem Laden in localStorage setzen (mehrfach möglich)
//   --attrappe teil=datei  Anfragen, deren URL "teil" enthält, lokal beantworten
//                        (mit CORS-Freigabe). .js-Datei: module.exports = (url) => text.
//                        Bsp.: --attrappe kalender-worker=tool/attrappen/kalender.js
//                        Alte CSS-Fassung zeigen: --attrappe style.css=/tmp/style-alt.css
//   --video              Video des ganzen Laufs aufnehmen (<prefix>video.webm)
//   --safari12-sim       grobe Safari-12-Simulation: liefert die lokalen *.css ohne die
//                        Angaben aus, die tool/pruefe-safari12.js als FEHLER meldet
//                        (inset, gap bei Flex, aspect-ratio) – so sieht man, was auf
//                        dem iPad kaputt ist. Ersetzt KEINEN Test auf dem echten Gerät.
//   --streng             Exit-Code 1, wenn Code-Fehler (pageerror / console.error) auftraten
//   --still              Nur Bildpfade und Fehlerzusammenfassung ausgeben
//
// Externe Netzwerkfehler (CORS, Zeitüberschreitung, 4xx/5xx fremder APIs)
// werden separat gelistet und NICHT als Code-Fehler gezählt.
// ---------------------------------------------------------------
"use strict";

const path = require("path");
const fs = require("fs");
const { webkit } = require("playwright");

const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1";

const REPO = path.resolve(__dirname, "..");

function heute() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

// ---------- Argumente ----------
function parseArgs(argv) {
  const opts = {
    url: "http://localhost:8765/index.html",
    jetzt: null,
    tempo: null,
    panels: null,
    out: path.join(REPO, "belege", heute()),
    prefix: "",
    name: "seite",
    warte: 9000,
    panelwarte: 2500,
    nachwarte: 600,
    aktion: [],
    klick: [],
    tippe: [],
    skript: null,
    localstorage: [],
    attrappe: [],
    video: false,
    "safari12-sim": false,
    streng: false,
    still: false,
  };
  const listen = { aktion: 1, klick: 1, tippe: 1, localstorage: 1, attrappe: 1 };
  const schalter = { video: 1, streng: 1, still: 1, "safari12-sim": 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--hilfe" || a === "--help") {
      const kopf = fs.readFileSync(__filename, "utf8").split("\n").slice(1, 40);
      console.log(kopf.filter((z) => z.indexOf("//") === 0).map((z) => z.replace(/^\/\/ ?/, "")).join("\n"));
      process.exit(0);
    }
    if (a.indexOf("--") !== 0) throw new Error("Unbekanntes Argument: " + a);
    const key = a.slice(2);
    if (schalter[key]) { opts[key] = true; continue; }
    if (!(key in opts)) throw new Error("Unbekannte Option: " + a);
    const val = argv[++i];
    if (val === undefined) throw new Error("Wert fehlt für " + a);
    if (listen[key]) opts[key].push(val);
    else if (key === "warte" || key === "panelwarte" || key === "nachwarte") opts[key] = Number(val);
    else opts[key] = val;
  }
  opts.out = path.resolve(process.cwd(), opts.out);
  if (opts.jetzt || opts.tempo) {
    const u = new URL(opts.url);
    if (opts.jetzt) u.searchParams.set("jetzt", opts.jetzt);
    if (opts.tempo) u.searchParams.set("tempo", opts.tempo);
    opts.url = u.toString();
  }
  return opts;
}

// ---------- Fehler-Sammlung ----------
// Meldungen, die nach Netzwerk/Fremd-API klingen. Die App meldet eigene
// Abruffehler per console.error(err) – auch die zählen als Netzwerk, wenn
// der Text eindeutig ein Abrufproblem beschreibt.
const NETZ_MUSTER = new RegExp([
  "Failed to load resource", "access control", "Access-Control-Allow-Origin",
  "Fetch API cannot load", "XMLHttpRequest cannot load", "NetworkError",
  "Load failed", "Failed to fetch", "net::", "timed out", "Zeitüberschreitung",
  "Could not connect", "fehlgeschlagen \\(\\d{3}\\)", "HTTP \\d{3}", "JSONP",
  "The network connection was lost", "A server with the specified hostname",
  "The Internet connection appears to be offline", "AbortError",
].join("|"), "i");

function istExtern(url, basis) {
  try {
    return new URL(url).origin !== new URL(basis).origin;
  } catch (e) {
    return false;
  }
}

function externeUrl(text, ortUrl, basis) {
  if (ortUrl && istExtern(ortUrl, basis)) return ortUrl;
  const alle = String(text).match(/https?:\/\/[^\s"')]+/g) || [];
  for (const u of alle) if (istExtern(u, basis)) return u;
  return null;
}

function kuerze(text, n) {
  text = String(text).replace(/\s+/g, " ").trim();
  return text.length > n ? text.slice(0, n - 1) + "…" : text;
}

function hostVon(url) {
  try { return new URL(url).host; } catch (e) { return url; }
}

// ---------- Hilfen für Ablaufskripte ----------
function baueHilfe(page, opts, bilder) {
  const hilfe = {
    opts: opts,
    warte: (ms) => page.waitForTimeout(ms),
    // Foto unter <out>/<prefix><name>.png
    foto: async (name) => {
      const datei = path.join(opts.out, opts.prefix + name + ".png");
      await page.screenshot({ path: datei });
      bilder.push(datei);
      return datei;
    },
    panel: async (name, ms) => {
      await springeZuPanel(page, name);
      await page.waitForTimeout(ms == null ? opts.panelwarte : ms);
    },
    tippe: (x, y) => page.touchscreen.tap(x, y),
    // Wischgeste per echten Touch-Ereignissen (touchstart → n× touchmove → touchend).
    // Playwright hat keine fertige Touch-Wischgeste; wir erzeugen die Ereignisse
    // in der Seite selbst (Ziel: selektor bzw. Element unter dem Startpunkt).
    // Rückgabe "touch" = Ereignisse gesendet, "kein-touch" = Engine kann es nicht.
    wische: async (x1, y1, x2, y2, opt) => {
      const o = Object.assign({ schritte: 8, dauer: 250, selektor: null }, opt || {});
      return page.evaluate(async (a) => {
        const ziel = (a.selektor && document.querySelector(a.selektor)) ||
          document.elementFromPoint(a.x1, a.y1) || document.body;
        // WebKit (wie iOS): new Touch() ist "Illegal constructor" –
        // stattdessen document.createTouch/createTouchList (so macht es
        // Playwright intern auch). Andere Engines: new Touch({...}).
        const alt = typeof document.createTouch === "function";
        if (typeof TouchEvent !== "function") return "kein-touch";
        const mache = (x, y) => alt
          ? document.createTouch(window, ziel, 1, x + window.pageXOffset, y + window.pageYOffset, x, y)
          : new Touch({ identifier: 1, target: ziel, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y });
        const liste = (arr) => (alt ? document.createTouchList.apply(document, arr) : arr);
        const feuere = (typ, x, y, ende) => {
          const t = mache(x, y);
          ziel.dispatchEvent(new TouchEvent(typ, {
            bubbles: true, cancelable: true, composed: true,
            touches: liste(ende ? [] : [t]), targetTouches: liste(ende ? [] : [t]), changedTouches: liste([t]),
          }));
        };
        const pause = (ms) => new Promise((r) => setTimeout(r, ms));
        feuere("touchstart", a.x1, a.y1, false);
        for (let i = 1; i <= a.schritte; i++) {
          await pause(a.dauer / a.schritte);
          feuere("touchmove", a.x1 + (a.x2 - a.x1) * i / a.schritte, a.y1 + (a.y2 - a.y1) * i / a.schritte, false);
        }
        feuere("touchend", a.x2, a.y2, true);
        return "touch";
      }, { x1: x1, y1: y1, x2: x2, y2: y2, schritte: o.schritte, dauer: o.dauer, selektor: o.selektor });
    },
  };
  return hilfe;
}

async function springeZuPanel(page, name) {
  const ergebnis = await page.evaluate((n) => {
    const el = document.getElementById("panel-" + n);
    if (!el) return "fehlt";
    if (typeof jumpToPanel !== "function") return "keine-funktion";
    jumpToPanel(n);
    return el.classList.contains("active") ? "ok" : "nicht-aktiv";
  }, name);
  if (ergebnis !== "ok") {
    const text = {
      fehlt: "Panel #panel-" + name + " gibt es nicht auf der Seite",
      "keine-funktion": "jumpToPanel() ist nicht definiert",
      "nicht-aktiv": "jumpToPanel('" + name + "') hat das Panel nicht aktiviert (fehlt in PANEL_IDS/panelSequence?)",
    }[ergebnis];
    console.warn("  ! " + text);
  }
  return ergebnis;
}

async function fuehreAktionenAus(page, opts) {
  let etwas = false;
  for (const js of opts.aktion) {
    // Als Funktionsrumpf auswerten, damit auch mehrere Anweisungen gehen;
    // ein Ausdruck ohne "return" wird automatisch zurückgegeben.
    const erg = await page.evaluate((code) => {
      let fn;
      try { fn = new Function("return (" + code + ");"); } catch (e) { fn = new Function(code); }
      return Promise.resolve(fn()).then((r) => (r === undefined ? undefined : JSON.stringify(r)));
    }, js);
    if (erg !== undefined) console.log("  aktion → " + erg);
    etwas = true;
  }
  for (const sel of opts.klick) {
    await page.locator(sel).first().tap({ timeout: 5000 });
    etwas = true;
  }
  for (const xy of opts.tippe) {
    const teile = xy.split(",").map(Number);
    await page.touchscreen.tap(teile[0], teile[1]);
    etwas = true;
  }
  if (etwas) await page.waitForTimeout(opts.nachwarte);
}

// ---------- Hauptablauf ----------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(opts.out, { recursive: true });

  const codeFehler = [];
  const warnungen = [];
  const netz = new Map(); // host → { anzahl, beispiel }
  const bilder = [];

  const merkeNetz = (url, grund) => {
    const host = hostVon(url);
    const e = netz.get(host) || { anzahl: 0, beispiel: grund };
    e.anzahl++;
    netz.set(host, e);
  };

  const browser = await webkit.launch();
  const kontextOpts = {
    viewport: { width: 1024, height: 768 },
    deviceScaleFactor: 1,
    hasTouch: true,
    userAgent: IPAD_UA,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  };
  if (opts.video) kontextOpts.recordVideo = { dir: opts.out, size: { width: 1024, height: 768 } };
  const context = await browser.newContext(kontextOpts);

  if (opts.localstorage.length) {
    const paare = opts.localstorage.map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)];
    });
    await context.addInitScript((p) => {
      for (const kv of p) localStorage.setItem(kv[0], kv[1]);
    }, paare);
  }

  for (const eintrag of opts.attrappe) {
    const i = eintrag.indexOf("=");
    const teil = eintrag.slice(0, i);
    const datei = path.resolve(process.cwd(), eintrag.slice(i + 1));
    const typen = { ".ics": "text/calendar", ".json": "application/json", ".js": "text/plain", ".xml": "application/xml", ".css": "text/css", ".html": "text/html" };
    await context.route((u) => u.href.indexOf(teil) !== -1, (route) => {
      const url = route.request().url();
      let body;
      let typ = typen[path.extname(datei)] || "text/plain";
      if (path.extname(datei) === ".js") {
        delete require.cache[datei];
        const erg = require(datei)(url);
        body = typeof erg === "string" ? erg : erg.body;
        if (erg && erg.typ) typ = erg.typ;
      } else {
        body = fs.readFileSync(datei);
      }
      route.fulfill({
        status: 200,
        contentType: typ + "; charset=utf-8",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: body,
      });
    });
    if (!opts.still) console.log("Attrappe: *" + teil + "* → " + path.relative(process.cwd(), datei));
  }

  if (opts["safari12-sim"]) {
    const pruefer = require("./pruefe-safari12.js");
    const basis = new URL(opts.url).origin;
    await context.route((u) => u.origin === basis && /\.css$/.test(u.pathname), (route) => {
      const datei = path.join(REPO, decodeURIComponent(new URL(route.request().url()).pathname));
      if (!fs.existsSync(datei)) return route.continue();
      const zeilen = fs.readFileSync(datei, "utf8").split("\n");
      let entschaerft = 0;
      pruefer.cssFunde(zeilen.join("\n"), path.basename(datei))
        .filter((f) => f.art === "FEHLER")
        .forEach((f) => {
          const i = f.zeile - 1;
          const neu = zeilen[i].replace(/(^|[;{\s])(inset|gap|row-gap|column-gap|aspect-ratio)\s*:[^;}]*;?/g, "$1/* safari12-sim */");
          if (neu !== zeilen[i]) entschaerft++;
          zeilen[i] = neu;
        });
      if (!opts.still) console.log("  Safari-12-Simulation: " + path.basename(datei) + " – " + entschaerft + " Angabe(n) entfernt");
      return route.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: zeilen.join("\n") });
    });
  }

  const page = await context.newPage();

  const stelleVon = (ort) => {
    const u = (ort && ort.url) || "";
    if (!u) return "";
    return " (" + u.replace(/^https?:\/\/[^/]+\//, "").replace(/\?.*$/, "") + ":" + (ort.lineNumber || 0) + ")";
  };
  page.on("pageerror", (err) => {
    const text = (err && err.message) || String(err);
    if (NETZ_MUSTER.test(text)) {
      merkeNetz(externeUrl(text, "", opts.url) || "(App)", kuerze(text, 120));
      return;
    }
    const stapel = err && err.stack ? " | " + kuerze(err.stack, 200) : "";
    codeFehler.push("pageerror: " + kuerze(text, 300) + stapel);
  });
  page.on("console", (msg) => {
    const typ = msg.type();
    if (typ !== "error" && typ !== "warning") return;
    const text = msg.text();
    const ort = msg.location() || {};
    if (NETZ_MUSTER.test(text)) {
      merkeNetz(externeUrl(text, ort.url, opts.url) || "(App)", kuerze(text, 120));
      return;
    }
    if (typ === "error") codeFehler.push("console.error: " + kuerze(text, 300) + stelleVon(ort));
    else warnungen.push("console.warn: " + kuerze(text, 300) + stelleVon(ort));
  });
  page.on("requestfailed", (req) => {
    const f = req.failure();
    const grund = f ? f.errorText : "fehlgeschlagen";
    if (istExtern(req.url(), opts.url)) merkeNetz(req.url(), grund);
    else codeFehler.push("Lokale Datei nicht geladen: " + req.url() + " (" + grund + ")");
  });
  page.on("response", (res) => {
    if (res.status() < 400) return;
    if (istExtern(res.url(), opts.url)) merkeNetz(res.url(), "HTTP " + res.status());
    else codeFehler.push("Lokale Datei HTTP " + res.status() + ": " + res.url());
  });

  if (!opts.still) console.log("Lade " + opts.url + " (warte " + opts.warte + " ms) …");
  await page.goto(opts.url, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(opts.warte);

  // Panels auflösen
  let panels = [];
  if (opts.panels) {
    if (opts.panels === "alle") {
      const ids = await page.evaluate(() =>
        Array.prototype.map.call(document.querySelectorAll("section.panel-view"), (s) => s.id.replace(/^panel-/, "")));
      panels = ids.map((n) => ({ name: n, warte: opts.panelwarte }));
    } else {
      panels = opts.panels.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
        const t = s.split(":");
        return { name: t[0], warte: t[1] ? Number(t[1]) : opts.panelwarte };
      });
    }
  }

  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    if (!opts.still) console.log("Panel " + p.name + " …");
    await springeZuPanel(page, p.name);
    await page.waitForTimeout(p.warte);
    await fuehreAktionenAus(page, opts);
    const nr = String(i + 1).padStart(2, "0");
    const datei = path.join(opts.out, opts.prefix + nr + "-" + p.name + ".png");
    await page.screenshot({ path: datei });
    bilder.push(datei);
  }

  if (opts.skript) {
    const skriptPfad = path.resolve(process.cwd(), opts.skript);
    if (!opts.still) console.log("Ablaufskript " + skriptPfad + " …");
    const ablauf = require(skriptPfad);
    await (typeof ablauf === "function" ? ablauf : ablauf.default)(page, baueHilfe(page, opts, bilder));
  }

  if (!panels.length && !opts.skript) {
    await fuehreAktionenAus(page, opts);
    const datei = path.join(opts.out, opts.prefix + opts.name + ".png");
    await page.screenshot({ path: datei });
    bilder.push(datei);
  }

  const video = page.video();
  await context.close();
  if (video) {
    const roh = await video.path();
    const ziel = path.join(opts.out, opts.prefix + (panels.length || opts.skript ? "video" : opts.name) + ".webm");
    fs.renameSync(roh, ziel);
    bilder.push(ziel);
  }
  await browser.close();

  // ---------- Bericht ----------
  console.log("");
  console.log("Bilder:");
  bilder.forEach((b) => console.log("  " + path.relative(process.cwd(), b)));
  if (netz.size) {
    console.log("Externe Netzwerkfehler (kein Code-Fehler):");
    netz.forEach((v, host) => console.log("  " + host + " ×" + v.anzahl + " – " + v.beispiel));
  }
  if (warnungen.length) {
    console.log("Warnungen (" + warnungen.length + "):");
    warnungen.forEach((w) => console.log("  " + w));
  }
  if (codeFehler.length) {
    console.log("CODE-FEHLER (" + codeFehler.length + "):");
    codeFehler.forEach((f) => console.log("  " + f));
  } else {
    console.log("Keine Code-Fehler.");
  }
  if (opts.streng && codeFehler.length) process.exit(1);
}

main().catch((err) => {
  console.error("Abbruch: " + (err && err.stack || err));
  process.exit(2);
});
