// Attrappe für den privaten Kalender-Worker (nur für Screenshots).
// Der echte Worker gibt localhost keine CORS-Freigabe – damit das
// Termine-Panel trotzdem beurteilt werden kann, liefert dieses Skript
// erfundene Termine relativ zu "jetzt". Als "jetzt" dient der
// Cache-Buster ?_=<Date.now()> der App – der folgt auch ?jetzt= aus
// debug-zeit.js.
//
// Nutzung: node tool/screenshot.js --attrappe kalender-worker=tool/attrappen/kalender.js …
"use strict";

module.exports = function (url) {
  const m = /[?&]_=(\d+)/.exec(url);
  const jetzt = new Date(m ? Number(m[1]) : Date.now());
  const p = (n) => String(n).padStart(2, "0");
  const tag = (plusTage) => {
    const d = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + plusTage);
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  };
  const termine = [
    [0, "T183000", "Zahnarzt Dr. Behrens", "Ostertorsteinweg 12"],
    [1, null, "Mama Geburtstag", ""],
    [2, "T080000", "Teammeeting Quartalsplanung", "Büro, Raum 3.14"],
    [3, "T194500", "Werder – Union Berlin", "Weserstadion"],
    [5, "T110000", "Wohnungsübergabe Schlüssel", "Föhrenstraße"],
    [8, "T200000", "Kino mit Lea: Langer Filmtitel, der in der Zeile vermutlich abgeschnitten wird", "Schauburg, Vor dem Steintor 114"],
  ];
  const zeilen = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SmartTafel//Attrappe//DE"];
  termine.forEach((t, i) => {
    zeilen.push("BEGIN:VEVENT", "UID:attrappe-" + i);
    zeilen.push(t[1] ? "DTSTART:" + tag(t[0]) + t[1] : "DTSTART;VALUE=DATE:" + tag(t[0]));
    zeilen.push("SUMMARY:" + t[2].replace(/,/g, "\\,"));
    if (t[3]) zeilen.push("LOCATION:" + t[3].replace(/,/g, "\\,"));
    zeilen.push("END:VEVENT");
  });
  zeilen.push("END:VCALENDAR");
  return { body: zeilen.join("\r\n"), typ: "text/calendar" };
};
