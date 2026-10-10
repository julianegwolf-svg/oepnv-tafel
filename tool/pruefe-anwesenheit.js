#!/usr/bin/env node
// ---------------------------------------------------------------
// Probe Anwesenheit (FEEDBACK 10.10. 11:56): oben stand immer „Niemand zu
// Hause“, weil person.* nur am GPS der Companion-App hing. Startet einen
// EIGENEN, frischen Simulator (nie ein echtes HA) und spielt durch:
//   A  Person + iPhone-GPS unterwegs, nichts sonst      → „Niemand zu Hause“
//   B  Bewegung im Schlafzimmer                          → neutral, kein „Niemand“
//   C  Bewegung endete vor 32 min                        → wieder „Niemand“
//   D  Tafel angetippt                                   → „Tafel gerade bedient“
//   E  Licht von einer Automation an                     → zählt nicht
//   F  Licht von Hand an                                 → „Licht … eingeschaltet“
//   G  iPhone im WLAN (FRITZ!Box-Tracker, router)        → „… ist im WLAN“
//   H  Person kommt heim                                 → „Julian ist zu Hause“
// Je Schritt: HA.anwesenheit().stand, Titel des Zuhause-Panels, Hinweise
// („Niemand da – …“ nur bei „weg“), Bild.
// Aufruf: node tool/pruefe-anwesenheit.js [--out <ordner>] [--port 8146]
// ---------------------------------------------------------------
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { webkit } = require("playwright");

const args = process.argv.slice(2);
const opt = (n, s) => { const i = args.indexOf("--" + n); return i === -1 ? s : args[i + 1]; };
const PORT = Number(opt("port", "8146"));
const OUT = path.resolve(opt("out", "belege/2026-10-10/s8/anwesenheit"));
fs.mkdirSync(OUT, { recursive: true });
const SIM = "http://localhost:" + PORT;

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
    env: Object.assign({}, process.env, { PORT: String(PORT), HA_SIM_LEISE: "1" }), stdio: "ignore",
  });
  let browser;
  try {
    await warteAufSim();
    browser = await webkit.launch();
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    const page = await ctx.newPage();
    const fehler = [];
    page.on("pageerror", (e) => { if (!/access control|Load failed|Failed to fetch/i.test(String(e))) fehler.push(String(e)); });
    // --vorher: Seite aus dem Stand eines Commits (Standard HEAD) ausliefern,
    // um den alten Fehler zu zeigen.
    if (args.indexOf("--vorher") !== -1) {
      const stand = opt("vorher-stand", "HEAD");
      const { execFileSync } = require("child_process");
      await page.route(/\/local\/tafel\/([\w.-]+\.(?:js|html|css))(\?|$)/, (route) => {
        const datei = /\/local\/tafel\/([\w.-]+\.(?:js|html|css))/.exec(route.request().url())[1];
        let body;
        try { body = execFileSync("git", ["show", stand + ":" + datei], { cwd: path.resolve(__dirname, ".."), maxBuffer: 1 << 24 }); } catch (e) { return route.continue(); }
        route.fulfill({ status: 200, contentType: datei.endsWith(".html") ? "text/html" : datei.endsWith(".css") ? "text/css" : "application/javascript", body: body });
      });
    }
    await page.goto(SIM + "/local/tafel/index.html?ha_token=tafel-sim-token");
    await page.waitForFunction(() => window.TafelHA && TafelHA.isConnected(), null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    const lichter = await page.evaluate(() => Object.keys(TafelHA.states()).filter((id) => /^light\./.test(id)));
    // IDs aus dem Simulator lesen statt fest einzutragen (keine Namen aus
    // dem privaten Haushalt in eingecheckten Dateien).
    const ids = await page.evaluate(() => {
      const person = TafelHA.model().global.persons[0];
      const tr = (TafelHA.attr(TafelHA.state(person), "device_trackers") || [])[0] ||
        Object.keys(TafelHA.states()).filter((id) => /^device_tracker\./.test(id))[0];
      const melder = Object.keys(TafelHA.states()).filter((id) => /^binary_sensor\./.test(id) &&
        /motion|occupancy|presence/.test(TafelHA.attr(TafelHA.state(id), "device_class") || ""))[0];
      return { person: person, tracker: tr, melder: melder };
    });
    const bewegung = ids.melder;

    // Ausgangslage A: alles seit 2 h unverändert, Person + GPS unterwegs, Lichter aus.
    await post("/sim/state", { entity_id: ids.person, state: "not_home", vor_s: 7200 });
    await post("/sim/state", { entity_id: ids.tracker, state: "not_home", vor_s: 7200, attributes: { source_type: "gps" } });
    await post("/sim/state", { entity_id: bewegung, state: "off", vor_s: 7200 });
    for (const id of lichter) await post("/sim/state", { entity_id: id, state: "off", vor_s: 7200, automation: true });
    await page.waitForTimeout(1200);

    async function stand(name) {
      await page.evaluate(() => { jumpToPanel("home"); });
      await page.waitForTimeout(900);
      const r = await page.evaluate(() => {
        // Alter Stand (--vorher) kennt anwesenheit() noch nicht: nur person.*.
        const a = TafelHA.anwesenheit ? TafelHA.anwesenheit()
          : { stand: TafelHA.personsHome().length ? "da" : "weg", signale: [] };
        return {
          stand: a.stand,
          signale: a.signale.map((s) => s.art + (s.id ? ":" + s.id : "")),
          titel: (document.getElementById("haHomeTitle") || {}).textContent || "",
          unter: (document.getElementById("haHomeSub") || {}).textContent || "",
          hinweise: TafelHAUI.hints().map((h) => h.text),
        };
      });
      if (!r.titel) r.titel = await page.evaluate(() => { const el = document.querySelector("#panel-home [class*='title']"); return el ? el.textContent : ""; });
      await page.screenshot({ path: path.join(OUT, name + ".png") });
      return r;
    }
    // Vergangenheit über last_changed im Simulator (vor_s), nicht über die
    // Uhr der Seite – sonst sähen frische Ereignisse aus HA alt aus.
    const vorher = async (id, an, aus, vorAn, vorAus, extra) => {
      await post("/sim/state", Object.assign({ entity_id: id, state: an, vor_s: vorAn }, extra || {}));
      await post("/sim/state", Object.assign({ entity_id: id, state: aus, vor_s: vorAus }, extra || {}));
      await page.waitForTimeout(800);
    };

    let r = await stand("a-niemand");
    pruefe(r.stand === "weg" && /Niemand zu Hause/.test(r.titel), "A Person + GPS unterwegs, nichts sonst → \"" + r.titel + "\" (" + r.stand + ")");

    // B Bewegung
    await post("/sim/state", { entity_id: bewegung, state: "on" });
    await page.waitForTimeout(800);
    r = await stand("b-bewegung");
    pruefe(r.stand === "unklar" && /Bewegung im Schlafzimmer/.test(r.titel) && !/Niemand/.test(r.titel) && /Julian laut Handy unterwegs/.test(r.unter || ""),
      "B Bewegung im Schlafzimmer → \"" + r.titel + "\" / \"" + r.unter + "\" (" + r.stand + ")");
    const abgeschnitten = await page.evaluate(() => { const el = document.getElementById("haHomeTitle"); return el.scrollWidth > el.clientWidth + 1; });
    pruefe(!abgeschnitten, "B Titel passt ohne Abschneiden");
    await post("/sim/state", { entity_id: bewegung, state: "off", vor_s: 240 });
    await page.waitForTimeout(800);
    r = await stand("b2-bewegung-vor-4-min");
    pruefe(r.stand === "unklar" && /vor 4 Min/.test(r.titel), "B' Bewegung endete vor 4 Min → \"" + r.titel + "\"");

    // C 31 min später
    await vorher(bewegung, "on", "off", 1940, 1920);
    r = await stand("c-31-min-spaeter");
    pruefe(r.stand === "weg" && /Niemand zu Hause/.test(r.titel), "C 32 min nach der Bewegung → \"" + r.titel + "\" (" + r.stand + ")");

    // D Tafel angetippt (echtes Touch-Ereignis auf den Titel)
    await page.touchscreen.tap(200, 140);
    await page.waitForTimeout(600);
    r = await stand("d-tafel-bedient");
    pruefe(r.stand === "unklar" && /Tafel gerade bedient/.test(r.titel), "D Tafel angetippt → \"" + r.titel + "\" (" + r.stand + ")");
    await page.evaluate(() => { window.tafelZuletztBedient -= 31 * 60000; });
    r = await stand("d2-bedienung-vorbei");
    pruefe(r.stand === "weg", "D' 31 min nach dem Antippen → " + r.stand + " " + r.signale.join(","));

    // E Licht von einer Automation → zählt nicht
    const lampe = lichter.find((id) => /standlampe|panthella|kugel/.test(id)) || lichter[0];
    await post("/sim/state", { entity_id: lampe, state: "on", automation: true, attributes: { brightness: 200 } });
    await page.waitForTimeout(800);
    r = await stand("e-licht-automation");
    pruefe(r.stand === "weg" && r.hinweise.some((h) => /Niemand da – 1 Licht an/.test(h)),
      "E Licht von einer Automation an → bleibt \"" + r.titel + "\", Hinweis \"" + (r.hinweise.find((h) => /Niemand da/.test(h)) || "–") + "\"");

    // F Licht von Hand
    // E2 Licht von einer Zeit-/Sonnen-Automation: weder parent_id noch user_id
    await post("/sim/state", { entity_id: lampe, state: "off", automation: true });
    await post("/sim/state", { entity_id: lampe, state: "on", attributes: { brightness: 200 } });
    await page.waitForTimeout(800);
    r = await stand("e2-licht-zeitautomation");
    pruefe(r.stand === "weg", "E2 Licht ohne Benutzer (z. B. Sonnenuntergangs-Automation) → bleibt " + r.stand);

    await post("/sim/state", { entity_id: lampe, state: "off", automation: true });
    await post("/sim/state", { entity_id: lampe, state: "on", benutzer: true, attributes: { brightness: 200 } });
    await page.waitForTimeout(800);
    r = await stand("f-licht-von-hand");
    pruefe(r.stand === "unklar" && /Licht im Wohnzimmer gerade eingeschaltet/.test(r.titel) && !r.hinweise.some((h) => /Niemand da/.test(h)),
      "F Licht von Hand an → \"" + r.titel + "\", kein „Niemand da“-Hinweis " + r.signale.join(","));
    await post("/sim/state", { entity_id: lampe, state: "off", automation: true });
    await post("/sim/state", { entity_id: lampe, state: "on", vor_s: 960, benutzer: true, attributes: { brightness: 200 } });
    await page.waitForTimeout(800);
    r = await stand("f2-licht-vorbei");
    pruefe(r.stand === "weg", "F' Licht seit 16 min an (von Hand) → " + r.stand + " " + r.signale.join(","));

    // G0 Küchenuhr/Tablet im WLAN, keiner Person zugeordnet → zählt nicht
    await post("/sim/state", { entity_id: "device_tracker.kuechenuhr", state: "home", attributes: { source_type: "router", friendly_name: "Küchenuhr" } });
    await post("/sim/state", { entity_id: "device_tracker.galaxy_tab_a", state: "home", attributes: { source_type: "router", friendly_name: "Galaxy Tab A" } });
    await page.waitForTimeout(800);
    r = await stand("g0-geraete-im-wlan");
    pruefe(r.stand === "weg", "G0 Küchenuhr und Galaxy Tab im WLAN (keiner Person zugeordnet) → " + r.stand);

    // G iPhone im WLAN (FRITZ!Box), der Person zugeordnet (HOME_ASSISTANT.md Schritt 9)
    await post("/sim/state", { entity_id: ids.person, attributes: { device_trackers: [ids.tracker, "device_tracker.julians_iphone"] } });
    await post("/sim/state", { entity_id: "device_tracker.julians_iphone", state: "home", attributes: { source_type: "router", friendly_name: "Julians iPhone" } });
    await page.waitForTimeout(800);
    r = await stand("g-iphone-im-wlan");
    pruefe(r.stand === "unklar" && /Julians iPhone ist im WLAN/.test(r.titel), "G FRITZ!Box-Tracker der Person home → \"" + r.titel + "\"");
    await post("/sim/state", { entity_id: "device_tracker.julians_iphone", state: "not_home" });

    // G2 HA-Neustart: Melder kommt von unavailable auf off zurück (frisches last_changed)
    await post("/sim/state", { entity_id: bewegung, state: "unavailable" });
    await post("/sim/state", { entity_id: bewegung, state: "off" });
    await page.waitForTimeout(800);
    r = await stand("g2-neustart-melder");
    pruefe(r.stand === "weg", "G2 Melder nach Neustart unavailable → off: keine Bewegung → " + r.stand);

    // H Person kommt heim
    await post("/sim/state", { entity_id: ids.person, state: "home" });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const g = document.getElementById("haGreeting"); if (g) g.click(); });
    r = await stand("h-person-da");
    pruefe(r.stand === "da" && /Julian ist zu Hause/.test(r.titel), "H Person home → \"" + r.titel + "\"");

    pruefe(fehler.length === 0, "keine Seitenfehler" + (fehler.length ? " – " + fehler.join(" | ").slice(0, 300) : ""));
  } finally {
    if (browser) await browser.close();
    sim.kill();
  }
  console.log("\n" + (schlecht ? "✗ " + schlecht + " von " + (ok + schlecht) + " Prüfungen fehlgeschlagen" : "✓ alle " + ok + " Prüfungen bestanden"));
  process.exit(schlecht ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
