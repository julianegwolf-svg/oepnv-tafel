// Prüft kalender.js gegen eine unabhängige Wahrheit (tool/kalender-wahrheit.py:
// python-dateutil + IANA-Zeitzonen) – für erfundene, knifflige Testfälle
// und optional für eine echte ICS-Datei. Zeigt außerdem, was der alte
// Parser (bis Sitzung 5) auf Safari 12 daraus gemacht hätte.
//
// Aufruf (TZ wie am iPad):
//   TZ=Europe/Berlin node tool/pruefe-kalender.js                 # Testfälle
//   TZ=Europe/Berlin node tool/pruefe-kalender.js --ics datei.ics # zusätzlich echt
// Bei echten Dateien werden Titel nie ausgegeben (privat), nur Kürzel.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const icsArg = args.indexOf("--ics") !== -1 ? args[args.indexOf("--ics") + 1] : null;

if (process.env.TZ !== "Europe/Berlin") {
  console.error("Bitte mit TZ=Europe/Berlin starten (Ortszeit der Tafel).");
  process.exit(2);
}

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "kalender.js"), "utf8"), sandbox);
const kalenderTermine = sandbox.window.kalenderTermine;

// ---------- alter Parser (app.js bis Sitzung 5), Safari-12-Datumslesart ----------
function safari12Date(iso) {
  // Safari 12 liest "YYYY-MM-DDTHH:MM:SS" ohne Zone als UTC.
  return new Date(/Z$/.test(iso) ? iso : iso + "Z");
}
function altParse(icsText) {
  const unfolded = icsText.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const events = [];
  let cur = null;
  unfolded.split("\n").forEach(function (line) {
    if (line === "BEGIN:VEVENT") { cur = {}; return; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; return; }
    if (!cur) return;
    const i = line.indexOf(":");
    if (i === -1) return;
    const rawKey = line.slice(0, i);
    const value = line.slice(i + 1);
    const key = rawKey.split(";")[0];
    if (key === "SUMMARY") cur.summary = value;
    else if (key === "DTSTART") {
      if (rawKey.indexOf("VALUE=DATE") !== -1 && value.length === 8) {
        cur.start = { date: safari12Date(value.slice(0, 4) + "-" + value.slice(4, 6) + "-" + value.slice(6, 8) + "T00:00:00"), allDay: true };
      } else {
        const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
        if (m) cur.start = { date: safari12Date(m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":" + m[6] + (m[7] ? "Z" : "")), allDay: false };
      }
    }
  });
  return events;
}

function wahrheit(icsText, von, bis) {
  const f = path.join(os.tmpdir(), "tafel-kalender-" + process.pid + ".ics");
  fs.writeFileSync(f, icsText);
  try {
    return JSON.parse(execFileSync("python3", ["-I", path.join(__dirname, "kalender-wahrheit.py"), f, String(von), String(bis)], { encoding: "utf8" }));
  } finally { fs.unlinkSync(f); }
}

const fmt = (ms) => new Date(ms).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function vergleiche(name, icsText, jetztMs, tage, privat) {
  const t0 = new Date(jetztMs); t0.setHours(0, 0, 0, 0);
  const von = t0.getTime();
  const bis = von + tage * 86400000;
  const soll = wahrheit(icsText, von, bis);
  const ist = kalenderTermine(icsText, von, bis).map((t) => ({ start: t.start, ende: t.ende, ganztags: t.ganztags, titel: t.titel }));
  const schl = (t) => t.start + "|" + t.ende + "|" + t.ganztags + "|" + t.titel;
  const sollSet = new Set(soll.map(schl));
  const istSet = new Set(ist.map(schl));
  const fehlt = soll.filter((t) => !istSet.has(schl(t)));
  const zuviel = ist.filter((t) => !sollSet.has(schl(t)));
  const titel = (t) => privat ? "Termin(" + t.titel.length + " Zeichen)" : t.titel;
  const ok = !fehlt.length && !zuviel.length;
  console.log((ok ? "✓ " : "✗ ") + name + ": " + ist.length + " Termine in " + tage + " Tagen, Wahrheit " + soll.length);
  fehlt.forEach((t) => console.log("    fehlt:  " + fmt(t.start) + (t.ganztags ? " ganztags" : "") + "  " + titel(t)));
  zuviel.forEach((t) => console.log("    zuviel: " + fmt(t.start) + (t.ganztags ? " ganztags" : "") + "  " + titel(t)));

  // Was zeigte das Termine-Panel (6 nächste) – alt (Safari 12) vs. neu vs. Wahrheit?
  const jetzt = jetztMs;
  const anstehend = (liste) => liste.filter((t) => t.ganztags ? t.ende > von : (t.ende > jetzt || (t.ende === t.start && t.start > jetzt - 30 * 60000))).slice(0, 6);
  const altListe = altParse(icsText)
    .filter((e) => e.summary && e.start && e.start.date.getTime() >= von)
    .sort((a, b) => a.start.date - b.start.date).slice(0, 6)
    .map((e) => ({ start: e.start.date.getTime(), ganztags: e.start.allDay, titel: e.summary }));
  const sollPanel = anstehend(soll);
  const neuPanel = anstehend(ist);
  const gleich = (a, b) => a.length === b.length && a.every((x, i) => x.start === b[i].start && x.titel === b[i].titel);
  const altRichtig = altListe.filter((a) => sollPanel.some((s) => s.start === a.start && s.titel === a.titel)).length;
  console.log("    Panel (6 nächste): neu " + (gleich(neuPanel, sollPanel) ? "= Wahrheit ✓" : "≠ Wahrheit ✗") +
    " · alt auf Safari 12: " + altRichtig + " von " + sollPanel.length + " richtig" +
    (altListe.length > altRichtig ? ", " + (altListe.length - altRichtig) + " falsch/zu viel" : ""));
  if (privat || !gleich(altListe, sollPanel)) {
    sollPanel.forEach((s, i) => {
      const a = altListe[i];
      console.log("      " + (i + 1) + ". Wahrheit " + fmt(s.start) + (s.ganztags ? " ganztags" : "") + " " + titel(s) +
        "  | alt: " + (a ? fmt(a.start) + (a.ganztags ? " ganztags" : "") + " " + titel(a) : "—"));
    });
  }
  return ok && gleich(neuPanel, sollPanel);
}

// ---------- Testfälle ----------
const TZ_BERLIN = [
  "BEGIN:VTIMEZONE", "TZID:Europe/Berlin",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "DTSTART:19810329T020000", "TZNAME:CEST", "TZOFFSETTO:+0200", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "RRULE:FREQ=YEARLY;UNTIL=19950924T010000Z;BYMONTH=9;BYDAY=-1SU", "DTSTART:19810927T030000", "TZNAME:CET", "TZOFFSETTO:+0100", "END:STANDARD",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "DTSTART:19961027T030000", "TZNAME:CET", "TZOFFSETTO:+0100", "END:STANDARD",
  "END:VTIMEZONE",
];
const TZ_NY = [
  "BEGIN:VTIMEZONE", "TZID:America/New_York",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "DTSTART:20070311T020000", "TZNAME:EDT", "TZOFFSETTO:-0400", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "DTSTART:20071104T020000", "TZNAME:EST", "TZOFFSETTO:-0500", "END:STANDARD",
  "END:VTIMEZONE",
];
const TZ_FIX = ["BEGIN:VTIMEZONE", "TZID:GMT+0200", "BEGIN:STANDARD", "DTSTART:18000101T020000", "RDATE:18000101T020000", "TZNAME:+02", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0200", "END:STANDARD", "END:VTIMEZONE"];

function ev(lines) { return ["BEGIN:VEVENT"].concat(lines, ["END:VEVENT"]); }
function cal(evs, zonen) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SmartTafel//Test//DE"].concat(zonen || [], [].concat.apply([], evs), ["END:VCALENDAR"]).join("\r\n");
}

const JETZT = new Date(2026, 9, 10, 10, 0).getTime(); // Sa 10.10.2026 10:00
const faelle = [
  ["Geburtstag jährlich (seit 1990, ganztags)", cal([ev(["UID:g1", "SUMMARY:Geburtstag Oma", "DTSTART;VALUE=DATE:19901012", "DTEND;VALUE=DATE:19901013", "RRULE:FREQ=YEARLY"])])],
  ["Jour fixe Mo+Mi 09:00 Berlin über Zeitumstellung, EXDATE, verschoben, abgesagt", cal([
    ev(["UID:w1", "SUMMARY:Jour fixe", "DTSTART;TZID=Europe/Berlin:20260907T090000", "DTEND;TZID=Europe/Berlin:20260907T093000", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE", "EXDATE;TZID=Europe/Berlin:20261014T090000"]),
    ev(["UID:w1", "SUMMARY:Jour fixe (verschoben)", "RECURRENCE-ID;TZID=Europe/Berlin:20261019T090000", "DTSTART;TZID=Europe/Berlin:20261019T140000", "DTEND;TZID=Europe/Berlin:20261019T143000"]),
    ev(["UID:w1", "SUMMARY:Jour fixe", "STATUS:CANCELLED", "RECURRENCE-ID;TZID=Europe/Berlin:20261028T090000", "DTSTART;TZID=Europe/Berlin:20261028T090000", "DTEND;TZID=Europe/Berlin:20261028T093000"]),
  ], TZ_BERLIN)],
  ["Monatlich 2. Dienstag 19:30", cal([ev(["UID:m1", "SUMMARY:Stammtisch", "DTSTART;TZID=Europe/Berlin:20250114T193000", "DTEND;TZID=Europe/Berlin:20250114T220000", "RRULE:FREQ=MONTHLY;BYDAY=2TU"])], TZ_BERLIN)],
  ["Monatlich letzter Tag (BYMONTHDAY=-1)", cal([ev(["UID:m2", "SUMMARY:Miete prüfen", "DTSTART;VALUE=DATE:20260131", "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1"])])],
  ["Monatlich am 12. bis UNTIL", cal([ev(["UID:m3", "SUMMARY:Abo", "DTSTART;TZID=Europe/Berlin:20250312T080000", "DTEND;TZID=Europe/Berlin:20250312T081500", "RRULE:FREQ=MONTHLY;UNTIL=20261112T070000Z;BYMONTHDAY=12"])], TZ_BERLIN)],
  ["Urlaub mehrtägig, läuft gerade", cal([ev(["UID:u1", "SUMMARY:Urlaub Sylt", "DTSTART;VALUE=DATE:20261008", "DTEND;VALUE=DATE:20261014"])])],
  ["Abgesagter Einzeltermin", cal([ev(["UID:c1", "SUMMARY:Zahnarzt", "STATUS:CANCELLED", "DTSTART;TZID=Europe/Berlin:20261012T083000", "DTEND;TZID=Europe/Berlin:20261012T090000"])], TZ_BERLIN)],
  ["UTC-Termin (Z)", cal([ev(["UID:z1", "SUMMARY:Webinar", "DTSTART:20261013T170000Z", "DTEND:20261013T180000Z"])])],
  ["New York mit VTIMEZONE (Zeitumstellung USA ≠ EU)", cal([ev(["UID:n1", "SUMMARY:Call NY", "DTSTART;TZID=America/New_York:20261001T090000", "DTEND;TZID=America/New_York:20261001T100000", "RRULE:FREQ=WEEKLY;COUNT=8"])], TZ_NY)],
  ["Feste Zone GMT+0200 (Outlook)", cal([ev(["UID:f1", "SUMMARY:Flug", "DTSTART;TZID=GMT+0200:20261015T063000", "DTEND;TZID=GMT+0200:20261015T090000"])], TZ_FIX)],
  ["Täglich COUNT=5 mit Erinnerung (VALARM)", cal([ev(["UID:d1", "SUMMARY:Tabletten", "DTSTART;TZID=Europe/Berlin:20261009T080000", "DTEND;TZID=Europe/Berlin:20261009T080500", "RRULE:FREQ=DAILY;COUNT=5", "BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY", "DESCRIPTION:Erinnerung", "END:VALARM"])], TZ_BERLIN)],
  ["Schwebende Zeit (ohne Zone)", cal([ev(["UID:s1", "SUMMARY:Friseur", "DTSTART:20261016T150000", "DTEND:20261016T160000"])])],
  ["29. Februar jährlich (nur Schaltjahre)", cal([ev(["UID:l1", "SUMMARY:Schalttag-Geburtstag", "DTSTART;VALUE=DATE:20000229", "RRULE:FREQ=YEARLY"])])],
  ["Alle 2 Wochen Fr, Ende per Datum", cal([ev(["UID:b1", "SUMMARY:Papiertonne", "DTSTART;VALUE=DATE:20260102", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;UNTIL=20261231"])])],
  ["Täglich alle 2 Tage seit 2019", cal([ev(["UID:d2", "SUMMARY:Pflanzen gießen", "DTSTART;TZID=Europe/Berlin:20190101T190000", "DTEND;TZID=Europe/Berlin:20190101T191000", "RRULE:FREQ=DAILY;INTERVAL=2"])], TZ_BERLIN)],
  ["Jährlich am 2. Sonntag im Mai (Muttertag)", cal([ev(["UID:y2", "SUMMARY:Muttertag", "DTSTART;VALUE=DATE:20200510", "RRULE:FREQ=YEARLY;BYMONTH=5;BYDAY=2SU"])])],
  ["Monatlich am 31. (Monate ohne 31. fallen aus)", cal([ev(["UID:x1", "SUMMARY:Abrechnung", "DTSTART;VALUE=DATE:20260131", "RRULE:FREQ=MONTHLY;BYMONTHDAY=31"])])],
  ["Jährlich im Januar und Juli", cal([ev(["UID:x2", "SUMMARY:Zählerstand", "DTSTART;TZID=Europe/Berlin:20250115T100000", "RRULE:FREQ=YEARLY;BYMONTH=1,7"])], TZ_BERLIN)],
  ["Letzter Werktag im Monat (BYSETPOS=-1)", cal([ev(["UID:x3", "SUMMARY:Monatsabschluss", "DTSTART;TZID=Europe/Berlin:20260130T090000", "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1"])], TZ_BERLIN)],
  ["Alle 3 Wochen So+Mo, Wochenbeginn Sonntag", cal([ev(["UID:x4", "SUMMARY:Familie", "DTSTART;TZID=Europe/Berlin:20260104T080000", "RRULE:FREQ=WEEKLY;INTERVAL=3;WKST=SU;BYDAY=SU,MO"])], TZ_BERLIN)],
  ["Täglich, aber nur im Dezember", cal([ev(["UID:x5", "SUMMARY:Adventskalender", "DTSTART;TZID=Europe/Berlin:20201201T070000", "RRULE:FREQ=DAILY;BYMONTH=12"])], TZ_BERLIN)],
  ["Jährlich am 100. und letzten Tag des Jahres", cal([ev(["UID:x6", "SUMMARY:Jahrestage", "DTSTART;TZID=Europe/Berlin:20260101T070000", "RRULE:FREQ=YEARLY;BYYEARDAY=100,-1"])], TZ_BERLIN)],
];

let alleOk = true;
console.log("Testfälle (jetzt = " + fmt(JETZT) + ", 400 Tage):");
faelle.forEach(function (f) { if (!vergleiche(f[0], f[1], JETZT, 400, false)) alleOk = false; });

if (icsArg) {
  const text = fs.readFileSync(icsArg, "utf8");
  console.log("\nEchte Datei " + path.basename(icsArg) + " (" + (text.match(/BEGIN:VEVENT/g) || []).length + " VEVENTs), jetzt = " + fmt(Date.now()) + ":");
  if (!vergleiche("Kalender 60 Tage", text, Date.now(), 60, true)) alleOk = false;
  if (!vergleiche("Kalender 400 Tage", text, Date.now(), 400, true)) alleOk = false;
}
console.log(alleOk ? "\nALLES ✓" : "\nFEHLER ✗");
process.exit(alleOk ? 0 : 1);
