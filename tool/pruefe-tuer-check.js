// Probe K2 Tür-Check (KONZEPTE.md, Sitzung 7) – nur gegen den Simulator.
//   1. Prototyp an, Lichter an, Einkaufsliste gefüllt → Tür-Tag scannen
//      (Simulator: Tag-Zustand = Scanzeit, Julians "Rausgehen" läuft echt)
//      → "Tschüss"-Karte mit Name, Bahn (Los-Minuten), Regen, Licht, Liste
//   2. Licht-Zeile folgt live, während "Rausgehen" die Lampen ausschaltet
//   3. "Aufs iPhone" → notify.send_message, Knopf wird zu "geschickt"
//   4. Antippen schließt, kein Takt/Timer bleibt übrig
//   5. anderer Tag (Arbeiten) → keine Karte; Prototyp aus → keine Karte
//
//   PORT=8142 node tool/ha-simulator/server.js &
//   node tool/pruefe-tuer-check.js --sim http://localhost:8142 --out belege/…/tuer
"use strict";
const { webkit } = require("playwright");
const fs = require("fs");
const path = require("path");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const SIM = arg("sim", "http://localhost:8142");
const OUT = arg("out", "belege/tuer");

let fehler = 0;
function log(ok, text) { if (!ok) fehler++; console.log((ok ? "✓ " : "✗ ") + text); }
// Szenario-Parameter gehen beim Simulator über die Adresse (?entity_id=…)
async function sim(pfad, param) {
  const q = param ? "?" + Object.keys(param).map((k) => k + "=" + encodeURIComponent(param[k])).join("&") : "";
  const r = await fetch(SIM + pfad + q, { method: "POST" });
  return r.json().catch(() => ({}));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await sim("/sim/szenario/reset");
  const browser = await webkit.launch();
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 }, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
    recordVideo: { dir: OUT, size: { width: 1024, height: 768 } },
  });
  const page = await context.newPage();
  const codeFehler = [];
  page.on("pageerror", (e) => { if (!/access control checks/.test(e.message)) codeFehler.push(e.message); });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/access control|Access-Control|Failed to load resource|NetworkError|Load failed|status of [45]\d\d|cannot load|Kalender-Abruf|Veranstaltungen-Abruf|Keine anstehenden|Musik/i.test(t)) return;
    codeFehler.push(t);
  });
  await page.goto(SIM + "/local/tafel/index.html");
  await page.evaluate(() => { const d = new Date(); localStorage.setItem("tafelMorgengruss", d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate()); });
  await page.waitForSelector("#haLogin.is-open", { timeout: 10000 });
  await page.fill("#haLoginUser", "tafel");
  await page.fill("#haLoginPass", "tafel-passwort");
  await page.tap("#haLoginSubmit");
  await page.waitForFunction(() => window.TafelHA && TafelHA.isConnected(), null, { timeout: 15000 });
  await page.evaluate(() => { CONFIG.nightDim = null; CONFIG.nightSleep = null; tickClock(); });
  // Abfahrten sind echt (Transitous); warten, bis welche da sind
  await page.waitForFunction(() => tafelSnapshot().departures.length > 0, null, { timeout: 20000 }).catch(() => {});
  const tags = await page.evaluate(() => Object.keys(TafelHA.states()).filter((id) => id.indexOf("tag.") === 0).map((id) => ({ id: id, name: TafelHA.name(id) })));
  const tuer = tags.filter((t) => /t(ü|ue|u)r|door/i.test(t.name + t.id))[0];
  const andere = tags.filter((t) => t !== tuer)[0];
  log(!!tuer, "Tür-Tag per Name gefunden: " + (tuer ? tuer.name : "—") + " (weitere: " + tags.filter((t) => t !== tuer).map((t) => t.name).join(", ") + ")");

  // Ausgangslage: zwei Räume mit Licht, Einkaufsliste mit drei Dingen,
  // Regen ab dem Nachmittag (Attrappe in den Stundenwerten)
  await page.evaluate(() => {
    const m = TafelHA.model();
    const raeume = m.rooms.filter((r) => r.lights.length).slice(0, 2);
    raeume.forEach((r) => TafelHA.callService("light", "turn_on", { brightness_pct: 70 }, { entity_id: r.lights }));
    const liste = m.global.todos[0];
    ["Milch", "Brot", "Kaffee"].forEach((t) => TafelHA.callService("todo", "add_item", { item: t }, { entity_id: liste }));
    rainStartMinutes = null; // echter Regen gerade? Für die Probe: trocken bis zur Attrappe
    const w = lastWeatherSnapshot;
    if (w && w.hourly) {
      const jetzt = Date.now();
      w.hourly.pp = w.hourly.time.map((t) => (t > jetzt + 5 * 3600 * 1000 && t < jetzt + 9 * 3600 * 1000 ? 70 : 5));
    }
  });
  await page.waitForTimeout(1500);

  // 5b. Prototyp aus → keine Karte
  await sim("/sim/szenario/tag-scannen", { entity_id: tuer.id });
  await page.waitForTimeout(1500);
  log(!(await page.evaluate(() => !!document.querySelector("#kTuer.is-open"))), "Prototyp aus (Standard): Scan zeigt keine Karte");
  // Lichter wieder an (Rausgehen hat sie eben ausgeschaltet)
  await page.evaluate(() => TafelHA.model().rooms.filter((r) => r.lights.length).slice(0, 2).forEach((r) => TafelHA.callService("light", "turn_on", { brightness_pct: 70 }, { entity_id: r.lights })));
  await page.evaluate(() => { CONFIG.konzepte.tuerCheck = true; });
  await page.waitForTimeout(1200);

  // 5a. anderer Tag → keine Karte
  if (andere) {
    await sim("/sim/szenario/tag-scannen", { entity_id: andere.id });
    await page.waitForTimeout(1500);
    log(!(await page.evaluate(() => !!document.querySelector("#kTuer.is-open"))), "Scan von „" + andere.name + "“ zeigt keine Tschüss-Karte");
    await page.evaluate(() => TafelHA.model().rooms.filter((r) => r.lights.length).slice(0, 2).forEach((r) => TafelHA.callService("light", "turn_on", { brightness_pct: 70 }, { entity_id: r.lights })));
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: path.join(OUT, "0-vorher.png") });

  // 1. Tür-Tag scannen
  const lichterVorher = await page.evaluate(() => TafelHA.model().global.lightsAll.filter((id) => TafelHA.state(id).state === "on").length);
  const t0 = Date.now();
  await sim("/sim/szenario/tag-scannen", { entity_id: tuer.id });
  const offen = await page.waitForFunction(() => !!document.querySelector("#kTuer.is-open"), null, { timeout: 4000 }).then(() => true).catch(() => false);
  log(offen, "Tür-Tag gescannt → Tschüss-Karte nach " + (Date.now() - t0) + " ms");
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, "1-karte-sofort.png") });
  const inhalt = await page.evaluate(() => {
    const el = document.getElementById("kTuer");
    const t = (s) => { const x = el.querySelector(s); return x ? x.textContent.replace(/\s+/g, " ").trim() : ""; };
    return {
      titel: t(".k-tuer-titel"), linie: t(".k-linie"), ziel: t(".k-bahn-ziel"), los: t(".k-los"), sub: t(".k-bahn-sub"),
      zeilen: [].map.call(el.querySelectorAll(".k-zeile"), (z) => z.textContent.replace(/\s+/g, " ").trim()),
      dep: tafelSnapshot().departures.filter((d) => d.leaveByMs >= Date.now() - 30000)[0] || null,
      ab: (function () { const a = arbeitsBahnHeute(); return a && a.dep ? a.dep : null; })(),
    };
  });
  console.log("   Karte: " + JSON.stringify({ titel: inhalt.titel, linie: inhalt.linie, ziel: inhalt.ziel, los: inhalt.los, sub: inhalt.sub, zeilen: inhalt.zeilen }));
  log(/^Tschüss, \S+!$/.test(inhalt.titel), "Titel mit Vorname: „" + inhalt.titel + "“");
  const soll = inhalt.ab || inhalt.dep;
  log(!!soll && inhalt.linie === soll.line && inhalt.sub.indexOf(soll.clock) !== -1, "Bahn = " + (inhalt.ab ? "Bahn zur Arbeit (arbeitsBahnHeute)" : "nächste erreichbare Abfahrt") + ": " + (soll ? soll.line + " " + soll.clock : "—") + " → Karte „" + inhalt.linie + " · " + inhalt.sub + "“");
  if (soll) {
    const min = Math.max(0, Math.round((soll.leaveByMs - Date.now()) / 60000));
    log(min <= 1 ? /jetzt/.test(inhalt.los) : new RegExp("^" + min + "|^" + (min - 1) + "|^" + (min + 1)).test(inhalt.los), "Los-Minuten = Abfahrt − Gehzeit (" + min + " Min): „" + inhalt.los + "“");
  }
  log(inhalt.zeilen.some((z) => /Uhr Regen \(70 %\) – Schirm mit/.test(z)), "Regen-Zeile mit Uhrzeit und Wahrscheinlichkeit");
  const offeneListe = await page.evaluate(() => (TafelHA.todoItems(TafelHA.model().global.todos[0]) || []).filter((it) => it.status !== "completed").map((it) => it.summary));
  log(inhalt.zeilen.some((z) => z.indexOf(offeneListe.slice(0, 3).join(", ")) !== -1 && /Aufs iPhone/.test(z)), "Einkaufsliste (" + offeneListe.length + " offen, erste: " + offeneListe.slice(0, 3).join(", ") + ") mit „Aufs iPhone“");

  // 2. Rausgehen schaltet die Lichter aus → Zeile folgt
  const alleAus = await page.waitForFunction(() => /Licht: alles aus/.test(document.getElementById("kTuer").textContent), null, { timeout: 6000 }).then(() => true).catch(() => false);
  log(alleAus && lichterVorher > 0, "„Rausgehen“ schaltet " + lichterVorher + " Lampen aus → Karte zeigt „Licht: alles aus“ ohne Neuladen");
  await page.screenshot({ path: path.join(OUT, "2-karte-licht-aus.png") });

  // 3. Aufs iPhone
  await page.tap('#kTuer [data-k="liste-senden"]');
  const gesendet = await page.waitForFunction(() => /aufs iPhone geschickt/.test(document.getElementById("kTuer").textContent), null, { timeout: 4000 }).then(() => true).catch(() => false);
  log(gesendet, "„Aufs iPhone“ → notify.send_message angenommen, Knopf zeigt „aufs iPhone geschickt“");
  await page.screenshot({ path: path.join(OUT, "3-karte-gesendet.png") });
  log(await page.evaluate(() => !!document.querySelector("#kTuer.is-open")), "Knöpfe schließen die Karte nicht");

  // 4. Antippen schließt
  await page.tap("#kTuer .k-tuer-titel");
  await page.waitForTimeout(700);
  const zu = await page.evaluate(() => ({ offen: !!document.querySelector("#kTuer.is-open"), dbg: TafelKonzepte.debug() }));
  log(!zu.offen && !zu.dbg.tuerOffen && !zu.dbg.tuerTakt, "Antippen schließt, kein Takt bleibt übrig");
  await page.screenshot({ path: path.join(OUT, "4-geschlossen.png") });

  log(!codeFehler.length, "keine Code-Fehler" + (codeFehler.length ? " – " + codeFehler.join(" | ") : ""));
  const video = page.video();
  await context.close();
  if (video) fs.renameSync(await video.path(), path.join(OUT, "tuer-check.webm"));
  await browser.close();
  console.log(fehler ? "\nFEHLER ✗ (" + fehler + ")" : "\nALLES ✓");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
