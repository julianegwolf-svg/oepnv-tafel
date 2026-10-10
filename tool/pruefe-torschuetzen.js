#!/usr/bin/env node
// ---------------------------------------------------------------
// Probe Torschützen beim letzten Ergebnis (FEEDBACK 10.10.: "Fußball:
// Torschützen fehlen"). Gegen echte Spieldaten: das letzte Werder-Spiel
// aus OpenLigaDB (ein Abruf hier, einer in der Seite) – die Erwartung
// rechnet diese Probe selbst aus den Rohdaten aus (eigene Umsetzung),
// die Tafel muss genau das zeigen. Dazu Sonderfälle mit Kunstdaten:
// Elfmeter, Eigentor, Namenszusatz, Nachspielzeit, unvollständige Liste.
// Aufruf: python3 -m http.server 8765 &  node tool/pruefe-torschuetzen.js [--out …]
// ---------------------------------------------------------------
"use strict";
const fs = require("fs");
const path = require("path");
const { webkit } = require("playwright");

const args = process.argv.slice(2);
const opt = (n, s) => { const i = args.indexOf("--" + n); return i === -1 ? s : args[i + 1]; };
const URL_ = opt("url", "http://localhost:8765/index.html");
const OUT = path.resolve(opt("out", "belege/2026-10-10/s8/torschuetzen"));
fs.mkdirSync(OUT, { recursive: true });

let ok = 0, schlecht = 0;
function pruefe(bed, text) {
  if (bed) { ok++; console.log("✓ " + text); } else { schlecht++; console.log("✗ " + text); }
}

// Eigene Erwartung aus den Rohdaten (unabhängig von fussball-live.js geschrieben)
function erwartung(m) {
  const nachname = (n) => {
    const w = n.replace(/^([A-ZÄÖÜ]\.\s*)+/, "").trim().split(" ");
    const p = w.findIndex((x, i) => i > 0 && i < w.length - 1 && /^(de|da|di|van|von|der|ten|ter|el|al|le|la|dos|du)$/i.test(x));
    return p > 0 ? w.slice(p).join(" ") : w[w.length - 1];
  };
  const res = { [m.team1.teamId]: [], [m.team2.teamId]: [] };
  m.goals.slice().sort((a, b) => a.scoreTeam1 + a.scoreTeam2 - (b.scoreTeam1 + b.scoreTeam2)).forEach((g) => {
    const min = g.isOvertime && g.matchMinute > 90 && g.matchMinute < 100 ? "90+" + (g.matchMinute - 90)
      : g.isOvertime && g.matchMinute > 45 && g.matchMinute < 60 ? "45+" + (g.matchMinute - 45) : String(g.matchMinute);
    res[g.scoringTeamId].push(min + "' " + nachname(g.goalGetterName) + (g.isOwnGoal ? " (ET)" : g.isPenalty ? " (Elfm.)" : ""));
  });
  return [res[m.team1.teamId].join(" · "), res[m.team2.teamId].join(" · ")];
}

(async () => {
  // 1. Letztes Werder-Spiel aus OpenLigaDB
  const tabelle = await (await fetch("https://api.openligadb.de/getlastmatchbyleagueteam/4974/134")).json().catch(() => null);
  let spiel = tabelle && tabelle.matchID ? tabelle : null;
  if (!spiel) {
    const tag = await (await fetch("https://api.openligadb.de/getmatchdata/bl1/2026/5")).json();
    spiel = tag.find((m) => m.team1.teamId === 134 || m.team2.teamId === 134);
  }
  const erw = erwartung(spiel);
  console.log("Echtes Spiel: " + spiel.team1.teamName + " – " + spiel.team2.teamName + " (" + spiel.matchDateTime + ", matchID " + spiel.matchID + ")");
  console.log("  Erwartung: " + JSON.stringify(erw));

  const browser = await webkit.launch();
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const fehler = [];
  page.on("pageerror", (e) => { if (!/access control|Load failed|Failed to fetch/i.test(String(e))) fehler.push(String(e)); });
  await page.goto(URL_);
  await page.waitForFunction((id) => !!document.querySelector('#sportBlock .sport-slide[data-match="' + id + '"]'), spiel.matchID, { timeout: 40000 });
  await page.evaluate((id) => {
    jumpToPanel("sport");
    pauseCarouselIndefinitely();
    const slides = document.querySelectorAll("#sportBlock .sport-slide");
    for (let i = 0; i < slides.length; i++) if (slides[i].getAttribute("data-match") === String(id)) { showSportSlide(i); break; }
    stopSportSlideshow();
  }, spiel.matchID);
  await page.waitForTimeout(1500);
  const gezeigt = await page.evaluate((id) => {
    const s = document.querySelector('#sportBlock .sport-slide[data-match="' + id + '"]');
    return [].map.call(s.querySelectorAll(".sport-slide-team"), (t) => { const el = t.querySelector(".sport-live-tore"); return el ? el.textContent : ""; });
  }, spiel.matchID);
  pruefe(JSON.stringify(gezeigt) === JSON.stringify(erw), "Letztes Werder-Spiel: Tafel zeigt " + JSON.stringify(gezeigt));
  const ueberlauf = await page.evaluate((id) => {
    const s = document.querySelector('#sportBlock .sport-slide[data-match="' + id + '"]');
    const r = s.getBoundingClientRect();
    return [].some.call(s.querySelectorAll(".sport-live-tore, .sport-slide-danach, .sport-slide-meta"), (el) => { const b = el.getBoundingClientRect(); return b.bottom > r.bottom || b.right > r.right || b.left < r.left; });
  }, spiel.matchID);
  pruefe(!ueberlauf, "Torschützen, Datum und „Als Nächstes“ passen in die Karte");
  await page.screenshot({ path: path.join(OUT, "werder-letztes-ergebnis.png") });

  // 2. Sonderfälle (Kunstdaten)
  const t1 = { teamId: 1, teamName: "A" }, t2 = { teamId: 2, teamName: "B" };
  const end = (a, b) => [{ resultTypeID: 1, pointsTeam1: 0, pointsTeam2: 0 }, { resultTypeID: 2, pointsTeam1: a, pointsTeam2: b }];
  const tor = (s1, s2, min, name, team, x) => Object.assign({ scoreTeam1: s1, scoreTeam2: s2, matchMinute: min, goalGetterName: name, scoringTeamId: team, isPenalty: false, isOwnGoal: false, isOvertime: false }, x || {});
  const faelle = [
    { name: "Elfmeter, Eigentor, Namenszusatz, 45+ bleibt 47'", m: { team1: t1, team2: t2, matchResults: end(2, 1), goals: [
      tor(1, 0, 12, "Kevin De Bruyne", 1, { isPenalty: true }), tor(1, 1, 47, "M. Friedl", 2), tor(2, 1, 90, "Mitchell Weiser", 1, { isOwnGoal: true })] },
      soll: [["12' De Bruyne (Elfm.)", "90' Weiser (ET)"], ["47' Friedl"]] },
    { name: "Nachspielzeit 90+3'", m: { team1: t1, team2: t2, matchResults: end(0, 1), goals: [tor(0, 1, 93, "N. Füllkrug", 2, { isOvertime: true })] },
      soll: [[], ["90+3' Füllkrug"]] },
    { name: "Nachspielzeit der 1. Halbzeit 45+2'", m: { team1: t1, team2: t2, matchResults: end(1, 0), goals: [tor(1, 0, 47, "M. Olise", 1, { isOvertime: true })] },
      soll: [["45+2' Olise"], []] },
    { name: "Name fehlt bei einem Tor → diese Mannschaft ohne Liste", m: { team1: t1, team2: t2, matchResults: end(2, 1), goals: [
      tor(1, 0, 10, "Ducksch", 1), tor(2, 0, 30, "", 1), tor(2, 1, 50, "Stage", 2)] },
      soll: [[], ["50' Stage"]] },
    { name: "Torliste unvollständig (2:2, nur 3 Tore) → keine halbe Liste", m: { team1: t1, team2: t2, matchResults: end(2, 2), goals: [
      tor(1, 0, 10, "Ducksch", 1), tor(1, 1, 20, "Stage", 2), tor(2, 1, 30, "Njinmah", 1)] },
      soll: [["10' Ducksch", "30' Njinmah"], []] },
    { name: "keine Tore gemeldet, Endstand 1:0 → nichts", m: { team1: t1, team2: t2, matchResults: end(1, 0), goals: [] }, soll: [[], []] },
  ];
  for (const f of faelle) {
    const ist = await page.evaluate((m) => FussballLive.torschuetzen(m), f.m);
    pruefe(JSON.stringify(ist) === JSON.stringify(f.soll), f.name + ": " + JSON.stringify(ist));
  }

  pruefe(fehler.length === 0, "keine Seitenfehler" + (fehler.length ? " – " + fehler.join(" | ").slice(0, 300) : ""));
  await browser.close();
  console.log("\n" + (schlecht ? "✗ " + schlecht + " von " + (ok + schlecht) + " Prüfungen fehlgeschlagen" : "✓ alle " + ok + " Prüfungen bestanden"));
  process.exit(schlecht ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
