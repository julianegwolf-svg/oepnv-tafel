// Probe Fußball live (fussball-live.js, Sitzung 6) – mit Attrappe statt der
// echten OpenLigaDB (die soll nicht mit Testläufen geflutet werden).
// Spielt Werder – Paderborn (Sa 17.10.2026, 15:30) durch: Vorlauf, Anstoß,
// Werder-Tor (Sport-Panel springt vor, „Tor!“), Gegentor (kein Sprung),
// Halbzeit, zweites Werder-Tor, Abpfiff, Endstand verschwindet nach 45 min.
// Außerhalb des Spielfensters darf kein Live-Abruf passieren.
//   python3 -m http.server 8765 &
//   node tool/pruefe-fussball-live.js --out belege/…/fussball-live [--video]
"use strict";
const { webkit } = require("playwright");
const fs = require("fs");
const path = require("path");

const arg = (n) => { const i = process.argv.indexOf("--" + n); return i !== -1 ? (process.argv[i + 1] || true) : null; };
const OUT = arg("out") || "belege/fussball-live";
const ANSTOSS = new Date(2026, 9, 17, 15, 30).getTime();
const MIN = 60000;
let fehler = 0;
function log(ok, text) { if (!ok) fehler++; console.log((ok ? "✓ " : "✗ ") + text); }

const team1 = { teamId: 134, teamName: "SV Werder Bremen", shortName: "Bremen", teamIconUrl: "https://upload.wikimedia.org/wikipedia/commons/b/be/SV-Werder-Bremen-Logo.svg", teamGroupName: null };
const team2 = { teamId: 31, teamName: "SC Paderborn 07", shortName: "Paderborn", teamIconUrl: "https://upload.wikimedia.org/wikipedia/commons/e/e3/SC_Paderborn_07_Logo.svg", teamGroupName: null };
let tore = []; // { s1, s2, min, name, team }
let fertig = false;
let liveAbrufe = 0;

function spiel() {
  const pad = (n) => String(n).padStart(2, "0");
  const d = new Date(ANSTOSS);
  const lokal = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T15:30:00";
  const s = tore.length ? tore[tore.length - 1] : { s1: 0, s2: 0 };
  return {
    matchID: 83207, matchDateTime: lokal, matchDateTimeUTC: new Date(ANSTOSS).toISOString().replace(".000", ""), timeZoneID: "W. Europe Standard Time",
    leagueId: 4900, leagueName: "1. Fußball-Bundesliga 2026/2027", leagueSeason: 2026, leagueShortcut: "bl1",
    group: { groupName: "6. Spieltag", groupOrderID: 6, groupID: 50638 },
    team1: team1, team2: team2, lastUpdateDateTime: lokal, matchIsFinished: fertig,
    matchResults: fertig ? [{ resultID: 1, resultName: "Endergebnis", pointsTeam1: s.s1, pointsTeam2: s.s2, resultOrderID: 2, resultTypeID: 2 }] : [],
    goals: tore.map((t, i) => ({ goalID: i + 1, scoreTeam1: t.s1, scoreTeam2: t.s2, matchMinute: t.min, goalGetterID: 0, goalGetterName: t.name, scoringTeamId: t.team, isPenalty: false, isOwnGoal: false, isOvertime: false })),
    location: { locationID: 1, locationCity: "Bremen", locationStadium: "Weserstadion" }, numberOfViewers: null,
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  const context = await browser.newContext(Object.assign({ viewport: { width: 1024, height: 768 }, hasTouch: true },
    arg("video") ? { recordVideo: { dir: OUT, size: { width: 1024, height: 768 } } } : {}));
  const page = await context.newPage();
  const codeFehler = [];
  page.on("pageerror", (e) => { if (!/access control checks/.test(e.message)) codeFehler.push(e.message); });
  const json = (body) => ({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
  await page.route(/api\.openligadb\.de\/getmatchesbyteam\/([^/]+)/, (r) => {
    const team = decodeURIComponent(/getmatchesbyteam\/([^/]+)/.exec(r.request().url())[1]);
    r.fulfill(json(/werder/i.test(team) ? [spiel()] : []));
  });
  await page.route(/api\.openligadb\.de\/getmatchdata\//, (r) => { liveAbrufe++; r.fulfill(json([spiel()])); });

  const pad = (n) => String(n).padStart(2, "0");
  const zeit = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  await page.goto("http://localhost:8765/index.html?jetzt=2026-10-17T15:05");
  await page.waitForFunction(() => window.FussballLive && FussballLive.anzahl() > 0, null, { timeout: 30000 });
  await page.evaluate(() => { CONFIG.nightDim = null; CONFIG.nightSleep = null; localStorage.setItem("tafelMorgengruss", "x"); });

  const chip = () => page.evaluate(() => { const c = document.querySelector("#liveHints .fussball-hint"); return c ? c.textContent : ""; });
  const lage = () => page.evaluate(() => {
    const s = document.querySelector('#sportBlock .sport-slide[data-match="83207"]');
    return {
      panel: (document.querySelector(".panel-view.active") || {}).id,
      karteAktiv: !!(s && s.classList.contains("active")),
      stand: s ? (s.querySelector(".sport-slide-score") || {}).textContent : "",
      label: s ? (s.querySelector(".sport-slide-label") || {}).textContent : "",
      tore: s ? [].map.call(s.querySelectorAll(".sport-live-tore"), (x) => x.textContent) : [],
      tor: !!document.querySelector("#panel-sport .tor-overlay.is-an"),
    };
  });
  async function schritt(ms, name, vorher) {
    await page.evaluate((t) => debugZeit.springe(t), ms);
    if (vorher) vorher();
    await page.evaluate(() => FussballLive.takt());
    await page.waitForTimeout(700);
    const c = await chip();
    const l = await lage();
    console.log("   " + zeit(ms) + " " + name.padEnd(22) + " Chip: „" + c + "“ · Karte: " + (l.label || "–") + " " + (l.stand || "") + (l.tore.join("").length ? " · Tore " + JSON.stringify(l.tore) : ""));
    return { c: c, l: l };
  }

  // 1. Vorlauf, kein Abruf
  await page.evaluate(() => jumpToPanel("departures"));
  let r = await schritt(ANSTOSS - 25 * MIN, "Vorlauf (−25 min)");
  log(/^⚽Heute 15:30 · Bremen – Paderborn$/.test(r.c) && liveAbrufe === 0, "Vorlauf: Chip „Heute 15:30 · Bremen – Paderborn“, noch kein Live-Abruf");
  await page.screenshot({ path: path.join(OUT, "1-vorlauf.png") });

  // 2. Anstoß
  r = await schritt(ANSTOSS + 3 * MIN, "Anstoß (+3 min)");
  log(/^Live\s*Bremen 0:0 Paderborn · ~4'$/.test(r.c.replace(/\s+/g, " ").replace("Live ", "Live ")) || /LiveBremen 0:0 Paderborn · ~4'/.test(r.c), "Live: „LIVE Bremen 0:0 Paderborn · ~4'“");
  log(liveAbrufe > 0, "ab Anstoß wird der Spieltag abgerufen (" + liveAbrufe + "×)");

  // 3. Werder-Tor → Sprung + Tor!
  await page.evaluate(() => jumpToPanel("weather"));
  r = await schritt(ANSTOSS + 23 * MIN, "Tor Werder (23')", () => { tore.push({ s1: 1, s2: 0, min: 22, name: "Ducksch", team: 134 }); });
  log(r.l.panel === "panel-sport" && r.l.karteAktiv, "Werder-Tor: Sport-Panel springt vor, Spielkarte aktiv");
  log(r.l.tor, "Werder-Tor: „Tor!“ erscheint");
  log(/^1:0$/.test(r.l.stand) && /Live · ~24'/.test(r.l.label) && /22' Ducksch/.test(r.l.tore[0] || ""), "Karte: 1:0, „Live · ~24'“, Torschütze 22' Ducksch");
  await page.screenshot({ path: path.join(OUT, "3-tor-werder.png") });
  await page.waitForTimeout(2800);
  await page.screenshot({ path: path.join(OUT, "3b-karte-nach-tor.png") });

  // 4. Gegentor → kein Sprung
  await page.evaluate(() => jumpToPanel("departures"));
  r = await schritt(ANSTOSS + 41 * MIN, "Gegentor (40')", () => { tore.push({ s1: 1, s2: 1, min: 40, name: "Kinsombi", team: 31 }); });
  // (Der Zeitsprung kann das Karussell weiterschalten – geprüft wird nur: nicht zum Sport gesprungen)
  log(r.l.panel !== "panel-sport" && /1:1/.test(r.c) && !r.l.tor, "Gegentor: Chip 1:1, kein Sprung, kein „Tor!“ (Panel: " + r.l.panel + ")");
  await page.screenshot({ path: path.join(OUT, "4-gegentor-chip.png") });

  // 5. Halbzeit
  r = await schritt(ANSTOSS + 54 * MIN, "Halbzeit");
  log(/^Halbzeit\s*Bremen 1:1 Paderborn$/.test(r.c), "Halbzeit: „Halbzeit Bremen 1:1 Paderborn“");

  // 6. 2:1 in der 2. Halbzeit
  r = await schritt(ANSTOSS + 90 * MIN, "Tor Werder (72')", () => { tore.push({ s1: 2, s2: 1, min: 72, name: "Njinmah", team: 134 }); });
  log(/2:1/.test(r.c) && /~73'/.test(r.c) && r.l.panel === "panel-sport", "2. Halbzeit: „~73'“, 2:1, Sport-Panel wieder vorn");

  // 7. Abpfiff
  r = await schritt(ANSTOSS + 112 * MIN, "Abpfiff", () => { fertig = true; });
  log(/^Endstand\s*Bremen 2:1 Paderborn$/.test(r.c) && /Endstand/.test(r.l.label), "Abpfiff: Chip + Karte „Endstand 2:1“");
  const abrufeBeiAbpfiff = liveAbrufe;
  await page.screenshot({ path: path.join(OUT, "7-endstand.png") });

  // 8. Endstand verschwindet, keine Abrufe mehr
  r = await schritt(ANSTOSS + 112 * MIN + 50 * MIN, "50 min nach Abpfiff");
  log(r.c === "" && liveAbrufe === abrufeBeiAbpfiff, "nach 45 min: Chip weg, keine weiteren Live-Abrufe");
  log(!codeFehler.length, "keine Code-Fehler" + (codeFehler.length ? " – " + codeFehler.join(" | ") : ""));

  await context.close();
  await browser.close();
  console.log(fehler ? "\nFEHLER ✗ (" + fehler + ")" : "\nALLES ✓");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
