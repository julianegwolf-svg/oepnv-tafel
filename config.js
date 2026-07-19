// ---------------------------------------------------------------
// KONFIGURATION – hier anpassen, ohne app.js anzufassen
// ---------------------------------------------------------------
const CONFIG = {
  stopQuery: "Föhrenstraße, Bremen",
  stopLimit: 2,

  // Bekannte Haltestellen-ID aus dem VBN-Widget-Generator (Bremen
  // Föhrenstraße). Wird zuerst probiert, damit keine Haltestellensuche
  // nötig ist. Falls sie in v6.db.transport.rest nicht funktioniert,
  // einfach auf [] setzen — dann sucht die Seite selbst über stopQuery.
  stopIds: ["9013884"],

  // API-Profil für v6.db.transport.rest. Leer lassen = Standard (dbnav).
  // Falls die Föhrenstraße damit nicht gefunden wird, mal "db" oder
  // "dbweb" probieren.
  apiProfile: "",

  // Fahrtziele, die NICHT angezeigt werden sollen (z.B. weil sie aus
  // der Stadt raus fahren). Bekannte Linien an der Föhrenstraße:
  // Bus 38, 39, 40, 41, 42, 730, 740, 745.
  excludeDestinations: [],

  // Falls stattdessen nur bestimmte Ziele erlaubt sein sollen, hier
  // eintragen (z.B. ["Hauptbahnhof", "Domsheide", "Am Brill"]).
  onlyDestinations: [],

  maxRows: 8,

  // Koordinaten für die Wetteranzeige (Alter Postweg, Bremen-Hemelingen)
  weatherLat: 53.073,
  weatherLon: 8.887,

  // Update-Intervalle in Millisekunden
  refreshDeparturesMs: 30 * 1000,
  refreshWeatherMs: 15 * 60 * 1000,
  refreshClockMs: 1000,

  // Sicherheitsnetz: kompletter Seiten-Reload alle paar Stunden,
  // falls Safari nach Tagen im Dauerbetrieb mal zickt.
  fullReloadMs: 3 * 60 * 60 * 1000,
};
