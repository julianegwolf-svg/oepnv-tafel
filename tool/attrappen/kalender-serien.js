// Attrappe wie ein iCloud-Kalender: Wiederholungen (jährlicher Geburtstag,
// wöchentlicher Termin mit TZID=Europe/Berlin und EXDATE), ein laufender
// mehrtägiger Urlaub, ein abgesagter Termin – relativ zu "jetzt" (Cache-
// Buster ?_=<Date.now()> der App, folgt ?jetzt=).
// Nutzung: --attrappe kalender-worker=tool/attrappen/kalender-serien.js
"use strict";

module.exports = function (url) {
  const m = /[?&]_=(\d+)/.exec(url);
  const jetzt = new Date(m ? Number(m[1]) : Date.now());
  const p = (n) => String(n).padStart(2, "0");
  const tag = (plus, jahr) => {
    const d = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + plus);
    return (jahr || d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate());
  };
  const wt = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const z = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SmartTafel//Attrappe Serien//DE",
    "BEGIN:VTIMEZONE", "TZID:Europe/Berlin",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "DTSTART:19810329T020000", "TZOFFSETTO:+0200", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "DTSTART:19961027T030000", "TZOFFSETTO:+0100", "END:STANDARD",
    "END:VTIMEZONE",
    // Urlaub: seit vorgestern, noch bis übermorgen (DTEND exklusiv)
    "BEGIN:VEVENT", "UID:u1", "SUMMARY:Urlaub an der Nordsee", "DTSTART;VALUE=DATE:" + tag(-2), "DTEND;VALUE=DATE:" + tag(3), "END:VEVENT",
    // Geburtstag seit 1988 jährlich – morgen
    "BEGIN:VEVENT", "UID:g1", "SUMMARY:Geburtstag Mama", "DTSTART;VALUE=DATE:" + tag(1, 1988), "DTEND;VALUE=DATE:" + tag(2, 1988), "RRULE:FREQ=YEARLY", "END:VEVENT",
    // Wöchentlich seit Januar, Wochentag von übermorgen, 18:30 Berliner Zeit
    "BEGIN:VEVENT", "UID:w1", "SUMMARY:Bouldern mit Tim", "LOCATION:Kletterhalle Bremen",
    "DTSTART;TZID=Europe/Berlin:" + tag(2, jetzt.getFullYear() - 1) + "T183000", "DTEND;TZID=Europe/Berlin:" + tag(2, jetzt.getFullYear() - 1) + "T200000",
    "RRULE:FREQ=WEEKLY;BYDAY=" + wt[new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + 2).getDay()],
    "EXDATE;TZID=Europe/Berlin:" + tag(9) + "T183000", "END:VEVENT",
    // Monatlich am 2. Dienstag
    "BEGIN:VEVENT", "UID:m1", "SUMMARY:Werder-Stammtisch", "LOCATION:Ostkurvensaal",
    "DTSTART;TZID=Europe/Berlin:20250114T193000", "DTEND;TZID=Europe/Berlin:20250114T220000", "RRULE:FREQ=MONTHLY;BYDAY=2TU", "END:VEVENT",
    // Einzeltermin in 4 Tagen, 09:15 Berliner Zeit (alt auf Safari 12: 11:15)
    "BEGIN:VEVENT", "UID:e1", "SUMMARY:Zahnarzt Dr. Behrens", "LOCATION:Ostertorsteinweg 12",
    "DTSTART;TZID=Europe/Berlin:" + tag(4) + "T091500", "DTEND;TZID=Europe/Berlin:" + tag(4) + "T100000", "END:VEVENT",
    // Abgesagt
    "BEGIN:VEVENT", "UID:c1", "SUMMARY:Elternabend (abgesagt)", "STATUS:CANCELLED",
    "DTSTART;TZID=Europe/Berlin:" + tag(1) + "T190000", "DTEND;TZID=Europe/Berlin:" + tag(1) + "T210000", "END:VEVENT",
    "END:VCALENDAR",
  ];
  return { body: z.join("\r\n"), typ: "text/calendar" };
};
