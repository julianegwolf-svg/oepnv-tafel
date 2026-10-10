// Probe K1 Wecklicht (KONZEPTE.md, Sitzung 7) – nur gegen den Simulator.
//   A. HA-Seite: Helfer input_datetime.wecklicht auf die nächste Minute →
//      Automation "Wecklicht (Tafel)" löst aus → Schlafzimmerlampen stehen
//      auf "Schlafzimmer · Aufwachen" (Übergang 1200 s angefragt)
//   B. Tafel So 21:40 (?jetzt=): Vorschlag "Wecklicht morgen …?" =
//      Losgehzeit der Bahn zur Arbeit − 45 min (auf 5 min), Antippen setzt
//      den Helfer auf Beginn = Ende − 20 min, Bestätigung, Info im Zuhause
//   C. Früher Termin am Montag → 90 min davor; Ablehnen (×) → kein Vorschlag
//   D. Sa 21:40 (So frei) → kein Vorschlag; Prototyp aus → kein Vorschlag
//
//   HA_SIM_SZENEN=ha-vorschlag/scenes.yaml HA_SIM_AUTOMATIONEN=tool/ha-simulator/wecklicht.yaml \
//     HA_SIM_HELFER=input_datetime.wecklicht PORT=8145 node tool/ha-simulator/server.js &
//   node tool/pruefe-wecklicht.js --sim http://localhost:8145 --datei ha-vorschlag/scenes.yaml --out belege/…/wecklicht
"use strict";
const { webkit } = require("playwright");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const { parseYaml } = require("./ha-simulator/yaml.js");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const SIM = arg("sim", "http://localhost:8145");
const DATEI = arg("datei", "ha-vorschlag/scenes.yaml");
const OUT = arg("out", "belege/wecklicht");
const NUR = arg("nur", "");
let fehler = 0;
function log(ok, text) { if (!ok) fehler++; console.log((ok ? "✓ " : "✗ ") + text); }
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function verbinde() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SIM.replace(/^http/, "ws") + "/api/websocket");
    let nr = 0;
    const offen = new Map();
    ws.on("message", (roh) => {
      [].concat(JSON.parse(roh)).forEach((m) => {
        if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: "tafel-sim-token" }));
        else if (m.type === "auth_ok") resolve(api);
        else if (m.type === "result" && offen.has(m.id)) { const p = offen.get(m.id); offen.delete(m.id); m.success ? p.ok(m.result) : p.nein(new Error(JSON.stringify(m.error))); }
      });
    });
    ws.on("error", reject);
    const api = {
      cmd(o) { return new Promise((ok, nein) => { const id = ++nr; offen.set(id, { ok, nein }); ws.send(JSON.stringify(Object.assign({ id }, o))); }); },
      async st(id) { return (await api.cmd({ type: "get_states" })).filter((s) => s.entity_id === id)[0]; },
      zu() { ws.close(); },
    };
  });
}

function berlin(ms) {
  const t = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(ms));
  return t.replace(",", "");
}

async function seite(browser, jetzt, video) {
  const context = await browser.newContext(Object.assign({
    viewport: { width: 1024, height: 768 }, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
  }, video ? { recordVideo: { dir: OUT, size: { width: 1024, height: 768 } } } : {}));
  const page = await context.newPage();
  page.codeFehler = [];
  page.on("pageerror", (e) => { if (!/access control checks/.test(e.message)) page.codeFehler.push(e.message); });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/access control|Access-Control|Failed to load resource|NetworkError|Load failed|status of [45]\d\d|cannot load|Kalender-Abruf|Veranstaltungen-Abruf|Keine anstehenden|Musik/i.test(t)) return;
    page.codeFehler.push(t);
  });
  await page.goto(SIM + "/local/tafel/index.html?jetzt=" + jetzt);
  await page.waitForSelector("#haLogin.is-open", { timeout: 10000 });
  await page.fill("#haLoginUser", "tafel");
  await page.fill("#haLoginPass", "tafel-passwort");
  await page.tap("#haLoginSubmit");
  await page.waitForFunction(() => window.TafelHA && TafelHA.isConnected(), null, { timeout: 15000 });
  await page.evaluate(() => { CONFIG.nightDim = null; CONFIG.nightSleep = null; tickClock(); });
  await page.waitForFunction(() => !document.querySelector("#haLogin.is-open"), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return { page, context };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const szenen = parseYaml(fs.readFileSync(DATEI, "utf8"));
  const aufwachen = szenen.filter((s) => / · Aufwachen$/.test(s.name))[0];
  const ha = await verbinde();

  // ---------- A. HA-Seite ----------
  if (!NUR || NUR === "a") {
    const lampen = Object.keys(aufwachen.entities);
    await ha.cmd({ type: "call_service", domain: "light", service: "turn_off", target: { entity_id: lampen } });
    const jetzt = Date.now();
    const naechste = Math.ceil((jetzt + 5000) / 60000) * 60000;
    await ha.cmd({ type: "call_service", domain: "input_datetime", service: "set_datetime", service_data: { datetime: berlin(naechste) }, target: { entity_id: "input_datetime.wecklicht" } });
    const h = await ha.st("input_datetime.wecklicht");
    log(h && h.state === berlin(naechste) && h.attributes.timestamp * 1000 === naechste, "Helfer gesetzt: " + (h && h.state) + " (timestamp passt)");
    console.log("   warte auf " + berlin(naechste) + " …");
    let aus = null;
    for (let i = 0; i < 60; i++) {
      await pause(2500);
      aus = await ha.st("automation.wecklicht_tafel");
      if (aus && aus.attributes.last_triggered && Date.parse(aus.attributes.last_triggered) >= naechste - 1000) break;
    }
    log(!!(aus && aus.attributes.last_triggered && Date.parse(aus.attributes.last_triggered) >= naechste - 1000), "Automation „Wecklicht (Tafel)“ löst zur Minute aus (" + (aus && aus.attributes.last_triggered) + ")");
    await pause(3500); // Nachtlicht → 2 s → Aufwachen
    const abw = [];
    for (const id of lampen) {
      const s = await ha.st(id);
      const z = aufwachen.entities[id];
      if (s.state !== "on" || Math.abs(s.attributes.brightness - z.brightness) > 1 || Math.abs(s.attributes.color_temp_kelvin - z.color_temp_kelvin) > 2) abw.push(id + " " + s.state + "/" + s.attributes.brightness + "/" + s.attributes.color_temp_kelvin + " K");
    }
    log(!abw.length, "Schlafzimmerlampen danach auf „Aufwachen“ (" + lampen.length + " Lampen)" + (abw.length ? " – " + abw.join(", ") : ""));
  }

  const browser = await webkit.launch();

  // ---------- B. Tafel: Sonntagabend ----------
  if (!NUR || NUR === "b") {
    await ha.cmd({ type: "call_service", domain: "input_datetime", service: "set_datetime", service_data: { datetime: "2026-10-01 06:00:00" }, target: { entity_id: "input_datetime.wecklicht" } });
    const { page, context } = await seite(browser, "2026-10-11T21:40", true);
    const ausPlan = await page.evaluate(() => TafelKonzepte.hinweise().length);
    log(ausPlan === 0, "Prototyp aus (Standard): kein Vorschlag");
    await page.evaluate(() => { CONFIG.konzepte.wecklicht = true; });
    // Fahrzeit + Abfahrten am Montag früh kommen echt (Transitous) – warten
    const plan = await page.waitForFunction(() => {
      const p = TafelKonzepte.wecklichtPlan();
      const ab = arbeitsBahnAm(new Date(2026, 9, 12));
      return p && ab && ab.dep ? { p: p, los: ab.dep.leaveByMs, linie: ab.dep.line, uhr: ab.dep.clock } : null;
    }, null, { timeout: 30000, polling: 500 }).then((h) => h.jsonValue()).catch(() => null);
    log(!!plan, "Plan für Mo 12.10. mit Bahn zur Arbeit: " + (plan ? plan.linie + " um " + plan.uhr : "—"));
    if (plan) {
      const soll = Math.floor((plan.los - 45 * 60000) / 300000) * 300000;
      log(plan.p.endeMs === soll && plan.p.startMs === soll - 20 * 60000, "Rechnung: Losgehen " + berlin(plan.los).slice(11, 16) + " − 45 min → Licht ganz an " + berlin(plan.p.endeMs).slice(11, 16) + ", Beginn " + berlin(plan.p.startMs).slice(11, 16));
    }
    await page.evaluate(() => { jumpToPanel("departures"); TafelHAUI.refresh(); });
    const chip = await page.waitForFunction(() => {
      const b = [].filter.call(document.querySelectorAll("#haHints .ha-hint"), (x) => /Wecklicht morgen/.test(x.textContent))[0];
      return b ? b.textContent.replace(/\s+/g, " ").trim() : null;
    }, null, { timeout: 8000 }).then((h) => h.jsonValue()).catch(() => null);
    log(!!chip && /Wecklicht morgen \d\d:\d\d\? Bahn \S+ um \d\d:\d\d/.test(chip), "Vorschlag im Hinweisband: „" + chip + "“");
    await page.waitForTimeout(1000); // Band gleitet 0,35 s herein, Bühne rückt nach
    await page.screenshot({ path: path.join(OUT, "1-vorschlag.png") });
    if (chip && plan) {
      await page.tap('#haHints .ha-hint[data-key^="konzept|wecklicht|"]');
      const gesetzt = await page.waitForFunction(() => { const s = TafelHA.state("input_datetime.wecklicht"); return s && /^2026-10-12 /.test(s.state) ? s.state : null; }, null, { timeout: 5000 }).then((h) => h.jsonValue()).catch(() => null);
      log(gesetzt === berlin(plan.p.startMs), "Antippen setzt den Helfer auf den Beginn: " + gesetzt);
      await page.waitForTimeout(700);
      const gruss = await page.evaluate(() => { const g = document.querySelector("#haGreeting.is-open"); return g ? g.textContent.replace(/\s+/g, " ").trim() : ""; });
      log(/Wecklicht.*Mo \d\d:\d\d–\d\d:\d\d.*20 Minuten Sonnenaufgang/.test(gruss), "Bestätigung: „" + gruss + "“");
      await page.screenshot({ path: path.join(OUT, "2-bestaetigung.png") });
      await page.waitForTimeout(5500);
      await page.evaluate(() => { TafelHAUI.refresh(); });
      await page.waitForTimeout(800);
      const nochChip = await page.evaluate(() => [].some.call(document.querySelectorAll("#haHints .ha-hint"), (x) => /Wecklicht morgen/.test(x.textContent)));
      log(!nochChip, "Danach kein Vorschlag mehr im Band");
      await page.evaluate(() => jumpToPanel("home"));
      await page.waitForTimeout(1200);
      const info = await page.evaluate(() => [].map.call(document.querySelectorAll("#haHints .ha-hint"), (x) => x.textContent.replace(/\s+/g, " ").trim()).join(" | "));
      log(/Wecklicht Mo \d\d:\d\d–\d\d:\d\d/.test(info), "Zuhause-Panel zeigt, dass es steht: „" + info + "“");
      await page.screenshot({ path: path.join(OUT, "3-zuhause-info.png") });
    }

    // C. früher Termin + Ablehnen
    await ha.cmd({ type: "call_service", domain: "input_datetime", service: "set_datetime", service_data: { datetime: "2026-10-01 06:00:00" }, target: { entity_id: "input_datetime.wecklicht" } });
    const termin = await page.evaluate(() => {
      lastCalendarEvents = [{ title: "Zahnarzt", start: new Date(2026, 9, 12, 7, 30).getTime(), allDay: false }];
      const p = TafelKonzepte.wecklichtPlan();
      return p ? { ende: p.endeMs, grund: p.grund } : null;
    });
    log(!!termin && termin.ende === new Date(2026, 9, 12, 6, 0).getTime() && /Termin um 07:30/.test(termin.grund), "Termin Mo 7:30 → Licht ganz an 6:00 („" + (termin && termin.grund) + "“)");
    await page.evaluate(() => { lastCalendarEvents = []; jumpToPanel("departures"); TafelHAUI.refresh(); });
    await page.waitForTimeout(1200);
    const x = await page.$('#haHints .ha-hint[data-key^="konzept|wecklicht|"] .ha-hint-weg');
    if (x) {
      await x.tap();
      await page.waitForTimeout(800);
      const weg = await page.evaluate(() => { TafelHAUI.refresh(); return true; });
      await page.waitForTimeout(800);
      const noch = await page.evaluate(() => !!document.querySelector('#haHints .ha-hint[data-key^="konzept|wecklicht|"]'));
      log(weg && !noch, "× lehnt ab: für diesen Morgen kein Vorschlag mehr");
    } else log(false, "×-Knopf am Vorschlag nicht gefunden");
    log(!page.codeFehler.length, "So-Abend: keine Code-Fehler" + (page.codeFehler.length ? " – " + page.codeFehler.join(" | ") : ""));
    const video = page.video();
    await context.close();
    if (video) fs.renameSync(await video.path(), path.join(OUT, "wecklicht.webm"));
  }

  // ---------- D. Samstagabend: Sonntag frei ----------
  if (!NUR || NUR === "b") {
    const { page, context } = await seite(browser, "2026-10-10T21:40", false);
    await page.evaluate(() => { CONFIG.konzepte.wecklicht = true; });
    await page.waitForTimeout(6000);
    const p = await page.evaluate(() => ({ plan: TafelKonzepte.wecklichtPlan(), h: TafelKonzepte.hinweise().length }));
    log(!p.plan && p.h === 0, "Sa 21:40 (So frei): kein Vorschlag");
    await context.close();
  }

  await browser.close();
  ha.zu();
  console.log(fehler ? "\nFEHLER ✗ (" + fehler + ")" : "\nALLES ✓");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
