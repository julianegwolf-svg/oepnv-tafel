// bremen-feste.js – große Publikumsveranstaltungen in der Stadt Bremen für
// das Panel „Veranstaltungen“ (Sitzung 6).
//
// Warum eine eigene Liste: Die bisherige Quelle (InfraNode/destination.one,
// „Bremen“) lieferte am 10.10.2026 zu 88 % Termine aus dem Umland
// (Worpswede, Osterholz-Scharmbeck, Ganderkesee …), und die wenigen in Bremen
// hatten falsche Daten (Weihnachtsmarkt bis 27.11., jazzahead! am 21.4.,
// swb-Marathon an einem Freitag); der Freimarkt fehlte ganz.
//
// Jeder Termin ist gegen die offizielle Seite des Veranstalters bzw. der
// Stadt geprüft (Quelle je Eintrag). Werder-Heimspiele kommen zusätzlich
// live aus den Fußball-Daten (OpenLigaDB).
// PFLEGE: einmal im Jahr neue Termine ergänzen – die Tafel zeigt, was in
// den nächsten Wochen ansteht; ist die Liste abgelaufen, fällt das Panel weg.
//
// { name, von: "JJJJ-MM-TT", bis (letzter Tag), ort, hinweis (kurz), quelle }
window.BREMER_FESTE = [
  { name: "Bremer Freimarkt", von: "2026-10-16", bis: "2026-11-01", ort: "Bürgerweide",
    hinweis: "Eröffnung Fr 16 Uhr · täglich ab 13 Uhr · Kleiner Freimarkt auf dem Marktplatz",
    quelle: "https://www.freimarkt.de/" },
  { name: "Freimarktsumzug", von: "2026-10-24", bis: "2026-10-24", ort: "Pappelstraße → Marktplatz → Hauptbahnhof",
    hinweis: "ab 10 Uhr", quelle: "https://www.freimarkt.de/freimarktsumzug/" },
  { name: "Messetrio: caravan bremen, ReiseLust, Fisch & Feines", von: "2026-11-06", bis: "2026-11-08", ort: "Messe Bremen & ÖVB-Arena",
    hinweis: "ab 10 Uhr · ein Ticket für alle drei", quelle: "https://www.messe-bremen.de/" },
  { name: "Bremer Weihnachtsmarkt", von: "2026-11-23", bis: "2026-12-23", ort: "Marktplatz, Domshof, Schoppensteel",
    hinweis: "So–Do 11–20.30 Uhr, Fr/Sa bis 21.30 Uhr", quelle: "https://www.bremen.de/weihnachtsmarkt" },
  { name: "Schlachte-Zauber", von: "2026-11-23", bis: "2026-12-23", ort: "Schlachte",
    hinweis: "Höhenfeuerwerk zur Eröffnung Mo 23.11. gegen 18.30 Uhr", quelle: "https://www.marktwelt-bremen.de/markt/schlachte-zauber/" },
  { name: "Eiswette", von: "2027-01-06", bis: "2027-01-06", ort: "Punkendeich am Osterdeich",
    hinweis: "Eiswettprobe um 12 Uhr – wie jedes Jahr am 6. Januar", quelle: "https://www.eiswette.de/eiswettprobe/" },
  { name: "Sixdays Bremen", von: "2027-01-15", bis: "2027-01-18", ort: "ÖVB-Arena",
    hinweis: "Kidsday Sa 16.1., Eintritt frei", quelle: "https://www.sixdays.de/" },
  { name: "Bremen Classic Motorshow", von: "2027-02-05", bis: "2027-02-07", ort: "Messe Bremen",
    hinweis: "Oldtimer-Messe in acht Hallen", quelle: "https://messe-bremen.de/event/bremen-classic-motorshow/" },
  { name: "Osterwiese", von: "2027-03-19", bis: "2027-04-04", ort: "Bürgerweide",
    hinweis: "täglich 14–23 Uhr, Karfreitag geschlossen", quelle: "https://www.osterwiese.com/" },
  { name: "jazzahead!", von: "2027-04-22", bis: "2027-04-24", ort: "Messe Bremen & Clubs",
    hinweis: "Clubnight Fr/Sa in der ganzen Stadt", quelle: "https://www.jazzahead.de/" },
  { name: "Lange Nacht der Museen", von: "2027-05-29", bis: "2027-05-29", ort: "Museen in der ganzen Stadt",
    hinweis: "ab 18 Uhr", quelle: "https://www.langenachtbremen.de/" },
  { name: "Festival Maritim", von: "2027-07-30", bis: "2027-08-01", ort: "Vegesack, Maritime Meile",
    hinweis: "Eintritt frei", quelle: "https://www.festival-maritim.de/" },
  { name: "Musikfest Bremen", von: "2027-08-21", bis: "2027-09-11", ort: "Glocke und weitere Spielstätten",
    hinweis: "", quelle: "https://www.musikfest-bremen.de/" },
  { name: "swb-Marathon", von: "2027-10-03", bis: "2027-10-03", ort: "Start und Ziel Marktplatz",
    hinweis: "Start 9.30 Uhr · Straßensperrungen", quelle: "https://swb-marathon.com/" },
  { name: "Bremer Freimarkt", von: "2027-10-15", bis: "2027-10-31", ort: "Bürgerweide",
    hinweis: "", quelle: "https://www.wirtschaft.bremen.de/sixcms/media.php/13/%C3%9Cbersicht%20Marktveranstaltungen.pdf" },
  { name: "Bremer Weihnachtsmarkt", von: "2027-11-22", bis: "2027-12-23", ort: "Marktplatz",
    hinweis: "", quelle: "https://www.wirtschaft.bremen.de/sixcms/media.php/13/%C3%9Cbersicht%20Marktveranstaltungen.pdf" },
];
