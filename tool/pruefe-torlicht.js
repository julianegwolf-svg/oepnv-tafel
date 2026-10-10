// Probe K3 Werder-Tor-Licht (KONZEPTE.md, Sitzung 7) – Simulator +
// OpenLigaDB-Attrappe (die echte API wird nicht gefragt).
//   1. Prototyp aus → Werder-Tor ändert kein Licht
//   2. an, Wohnzimmer warmweiß → Werder-Tor: Farblampen 3× Grün/Weiß,
//      danach exakt der vorige Zustand; reine Weißlampe unberührt
//   3. Gegentor → kein Licht; niemand zu Hause → kein Licht
// Aufzeichnung aller state_changed der Wohnzimmerlampen → Lichtverlauf.json
// (+ Bildstreifen mit tool/vergleich-bild.py nicht nötig: eigener Streifen).
//
//   PORT=8142 node tool/ha-simulator/server.js &
//   node tool/pruefe-torlicht.js --sim http://localhost:8142 --out belege/…/torlicht
"use strict";
const { webkit } = require("playwright");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const SIM = arg("sim", "http://localhost:8142");
const OUT = arg("out", "belege/torlicht");
const ANSTOSS = new Date(2026, 9, 17, 15, 30).getTime();

// --vorher: ha.js/ha-panels.js/konzepte.js/fussball-live.js aus dem letzten
// Commit ausliefern (Stand vor den Korrekturen) – zeigt, dass die Probe den
// Fehler findet.
const VORHER = process.argv.indexOf("--vorher") !== -1;
async function vorherRouten(page) {
  if (!VORHER) return;
  const { execSync } = require("child_process");
  for (const f of ["ha.js", "ha-panels.js", "konzepte.js", "fussball-live.js"]) {
    const alt = execSync("git show HEAD:" + f, { cwd: path.join(__dirname, ".."), maxBuffer: 1 << 24 });
    await page.route(new RegExp("/" + f.replace(".", "\\.") + "(\\?|$)"), (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: alt }));
  }
}
let fehler = 0;
function log(ok, text) { if (!ok) fehler++; console.log((ok ? "✓ " : "✗ ") + text); }
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Attrappe OpenLigaDB ----------
const team1 = { teamId: 134, teamName: "SV Werder Bremen", shortName: "Bremen", teamIconUrl: "", teamGroupName: null };
let team2 = { teamId: 31, teamName: "SC Paderborn 07", shortName: "Paderborn", teamIconUrl: "", teamGroupName: null };
let tore = [];
function spiel() {
  const s = tore.length ? tore[tore.length - 1] : { s1: 0, s2: 0 };
  return {
    matchID: 83207, matchDateTime: "2026-10-17T15:30:00", matchDateTimeUTC: new Date(ANSTOSS).toISOString().replace(".000", ""), timeZoneID: "W. Europe Standard Time",
    leagueId: 4900, leagueName: "1. Fußball-Bundesliga 2026/2027", leagueSeason: 2026, leagueShortcut: "bl1",
    group: { groupName: "6. Spieltag", groupOrderID: 6, groupID: 50638 },
    team1: team1, team2: team2, lastUpdateDateTime: "2026-10-17T15:30:00", matchIsFinished: false, matchResults: [],
    goals: tore.map((t, i) => ({ goalID: i + 1, scoreTeam1: t.s1, scoreTeam2: t.s2, matchMinute: t.min, goalGetterID: 0, goalGetterName: t.name, scoringTeamId: t.team, isPenalty: false, isOwnGoal: false, isOvertime: false })),
    location: { locationID: 1, locationCity: "Bremen", locationStadium: "Weserstadion" }, numberOfViewers: null,
  };
}

// ---------- WebSocket-Mitschnitt ----------
function verbinde() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SIM.replace(/^http/, "ws") + "/api/websocket");
    let nr = 0;
    const offen = new Map();
    const api = {
      events: [],
      cmd(o) { return new Promise((ok, nein) => { const id = ++nr; offen.set(id, { ok, nein }); ws.send(JSON.stringify(Object.assign({ id }, o))); }); },
      zu() { ws.close(); },
    };
    ws.on("message", (roh) => {
      [].concat(JSON.parse(roh)).forEach((m) => {
        if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: "tafel-sim-token" }));
        else if (m.type === "auth_ok") resolve(api);
        else if (m.type === "event" && m.event && m.event.data && m.event.data.entity_id) {
          const d = m.event.data;
          if (d.entity_id.indexOf("light.") === 0) api.events.push({ t: Date.now(), id: d.entity_id, s: d.new_state && d.new_state.state, a: d.new_state && d.new_state.attributes });
        } else if (m.type === "result" && offen.has(m.id)) { const p = offen.get(m.id); offen.delete(m.id); m.success ? p.ok(m.result) : p.nein(new Error(JSON.stringify(m.error))); }
      });
    });
    ws.on("error", reject);
  });
}

function farbe(a) {
  if (!a) return null;
  if (a.rgb_color) return a.rgb_color;
  return null;
}
function istGruen(rgb) { return rgb && rgb[1] > rgb[0] * 1.6 && rgb[1] > rgb[2] * 1.2; }
function istWeiss(rgb) { return rgb && rgb[0] > 200 && rgb[1] > 200 && rgb[2] > 200; }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ha = await verbinde();
  await ha.cmd({ type: "subscribe_events", event_type: "state_changed" });
  const browser = await webkit.launch();
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 }, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
    recordVideo: { dir: OUT, size: { width: 1024, height: 768 } },
  });
  const page = await context.newPage();
  await vorherRouten(page);
  const codeFehler = [];
  page.on("pageerror", (e) => { if (!/access control checks/.test(e.message)) codeFehler.push(e.message); });
  const json = (body) => ({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
  await page.route(/api\.openligadb\.de\/getmatchesbyteam\/([^/]+)/, (r) => {
    const team = decodeURIComponent(/getmatchesbyteam\/([^/]+)/.exec(r.request().url())[1]);
    r.fulfill(json(/werder/i.test(team) ? [spiel()] : []));
  });
  await page.route(/api\.openligadb\.de\/getmatchdata\//, (r) => r.fulfill(json([spiel()])));
  await page.goto(SIM + "/local/tafel/index.html?jetzt=2026-10-17T15:40");
  await page.waitForSelector("#haLogin.is-open", { timeout: 10000 });
  await page.fill("#haLoginUser", "tafel");
  await page.fill("#haLoginPass", "tafel-passwort");
  await page.tap("#haLoginSubmit");
  await page.waitForFunction(() => window.TafelHA && TafelHA.isConnected(), null, { timeout: 15000 });
  await page.evaluate(() => { CONFIG.nightDim = null; CONFIG.nightSleep = null; tickClock(); });
  await page.waitForFunction(() => window.FussballLive && FussballLive.anzahl() > 0, null, { timeout: 20000 }).catch(() => {});
  log(await page.evaluate(() => FussballLive.anzahl() > 0), "Attrappe: Werder – Paderborn läuft (Anstoß 15:30, Tafel 15:40)");

  // Wohnzimmer warmweiß an, Person zu Hause
  const raum = await page.evaluate(() => {
    const r = TafelHA.model().rooms.filter((x) => x.name === "Wohnzimmer")[0];
    return r ? r.lights : [];
  });
  await page.evaluate((ids) => TafelHA.callService("light", "turn_on", { brightness: 150, color_temp_kelvin: 2700 }, { entity_id: ids }), raum);
  await pause(800);
  const vorher = await page.evaluate((ids) => ids.map((id) => { const s = TafelHA.state(id); return { id, s: s.state, bri: s.attributes.brightness, k: s.attributes.color_temp_kelvin, modus: s.attributes.color_mode, modi: s.attributes.supported_color_modes }; }), raum);
  const farbig = vorher.filter((l) => l.modi.some((m) => ["xy", "hs", "rgb"].indexOf(m) !== -1)).map((l) => l.id);
  const weiss = vorher.filter((l) => farbig.indexOf(l.id) === -1).map((l) => l.id);
  console.log("   Wohnzimmer: " + farbig.length + " Farblampen, " + weiss.length + " Weißlampe(n)");

  async function tor(s1, s2, name, team, fotos) {
    tore.push({ s1, s2, min: 10 + tore.length * 9, name, team });
    ha.events.length = 0;
    const t = Date.now();
    await page.evaluate(() => FussballLive.takt());
    for (const f of (fotos || [])) {
      await pause(Math.max(0, f.ms - (Date.now() - t)));
      await page.screenshot({ path: path.join(OUT, f.name) });
    }
    await pause(Math.max(0, 6000 - (Date.now() - t)));
    return ha.events.slice();
  }

  // 1. aus
  let ev = await tor(1, 0, "Ducksch", 134);
  log(!ev.some((e) => istGruen(farbe(e.a))), "Prototyp aus (Standard): Werder-Tor ändert kein Licht");

  // 2. an
  await page.evaluate(() => { CONFIG.konzepte.torLicht = true; });
  // Wohnzimmer-Ansicht offen: man sieht die Lampen auf der Tafel mitblinken
  await page.evaluate(() => jumpToPanel("home"));
  await pause(900);
  const rid = await page.evaluate(() => TafelHA.model().rooms.filter((x) => x.name === "Wohnzimmer")[0].id);
  await page.tap('#haRooms .ha-room[data-raum="' + rid + '"] .ha-room-name');
  await pause(900);
  await page.screenshot({ path: path.join(OUT, "raum-0-vorher.png") });
  const t0 = Date.now();
  ev = await tor(2, 0, "Grüll", 134, [{ ms: 500, name: "raum-1-gruen.png" }, { ms: 1050, name: "raum-2-weiss.png" }, { ms: 5200, name: "raum-3-nachher.png" }]);
  const proLampe = {};
  ev.forEach((e) => { (proLampe[e.id] = proLampe[e.id] || []).push(e); });
  const gruenPhasen = (farbig[0] && proLampe[farbig[0]] || []).filter((e) => istGruen(farbe(e.a))).length;
  const weissPhasen = (farbig[0] && proLampe[farbig[0]] || []).filter((e) => istWeiss(farbe(e.a)) && e.a.color_mode !== "color_temp").length;
  log(farbig.every((id) => (proLampe[id] || []).filter((e) => istGruen(farbe(e.a))).length >= 3), "Werder-Tor: jede Farblampe 3× Grün (" + gruenPhasen + "×) und Weiß (" + weissPhasen + "×)");
  const dauer = ev.length ? ev[ev.length - 1].t - ev[0].t : 0;
  log(dauer > 2500 && dauer < 6000, "Dauer des Blinkens: " + (dauer / 1000).toFixed(1) + " s");
  const nachher = await page.evaluate((ids) => ids.map((id) => { const s = TafelHA.state(id); return { id, s: s.state, bri: s.attributes.brightness, k: s.attributes.color_temp_kelvin, modus: s.attributes.color_mode }; }), raum);
  const zurueck = vorher.every((v) => { const n = nachher.filter((x) => x.id === v.id)[0]; return n && n.s === v.s && Math.abs(n.bri - v.bri) <= 1 && n.modus === v.modus && Math.abs((n.k || 0) - (v.k || 0)) <= 2; });
  log(zurueck, "Danach exakt wie vorher (an, Helligkeit 150, 2700 K)");
  log(weiss.every((id) => !(proLampe[id] || []).length), "Reine Weißlampe(n) unberührt");
  fs.writeFileSync(path.join(OUT, "lichtverlauf.json"), JSON.stringify({ start: t0, lampen: farbig, events: ev.map((e) => ({ t: e.t - ev[0].t, id: e.id, s: e.s, rgb: e.a && e.a.rgb_color, bri: e.a && e.a.brightness })) }, null, 1));
  await page.screenshot({ path: path.join(OUT, "sport-tor.png") });

  // 3a. Gegentor
  ev = await tor(2, 1, "Muslija", 31);
  log(!ev.some((e) => istGruen(farbe(e.a))), "Gegentor (Paderborn): kein Licht");
  // Gegner ist selbst ein verfolgter Verein (St. Pauli steht in sportTeams):
  // vorher kam hier "Werder Bremen" als Torschütze an → Licht beim Gegentor
  team2 = { teamId: 98, teamName: "FC St. Pauli", shortName: "St. Pauli", teamIconUrl: "", teamGroupName: null };
  ev = await tor(2, 2, "Irvine", 98);
  log(!ev.some((e) => istGruen(farbe(e.a))), "Gegentor eines ebenfalls verfolgten Vereins (St. Pauli): kein Licht");
  team2 = { teamId: 31, teamName: "SC Paderborn 07", shortName: "Paderborn", teamIconUrl: "", teamGroupName: null };
  // 3b. niemand zu Hause
  const person = await page.evaluate(() => TafelHA.model().global.persons[0]);
  await fetch(SIM + "/sim/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_id: person, state: "not_home" }) });
  await pause(800);
  ev = await tor(3, 2, "Stage", 134);
  log(!ev.some((e) => istGruen(farbe(e.a))), "Niemand zu Hause: Werder-Tor ohne Licht");
  await fetch(SIM + "/sim/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_id: person, state: "home" }) });

  log(await page.evaluate(() => !TafelKonzepte.debug().torLaeuft), "Kein Ablauf hängt (torLaeuft = false)");
  log(!codeFehler.length, "keine Code-Fehler" + (codeFehler.length ? " – " + codeFehler.join(" | ") : ""));
  const video = page.video();
  await context.close();
  if (video) fs.renameSync(await video.path(), path.join(OUT, "torlicht-tafel.webm"));
  await browser.close();
  ha.zu();
  console.log(fehler ? "\nFEHLER ✗ (" + fehler + ")" : "\nALLES ✓");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
