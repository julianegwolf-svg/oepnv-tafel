// ---------------------------------------------------------------
// KONFIGURATION – hier anpassen, ohne app.js anzufassen
// Datenquelle: Transitous (api.transitous.org) — kostenlose,
// spendenfinanzierte Open-Source-API, extra für Dauerabfragen wie
// diese gedacht (im Gegensatz zu v6.db.transport.rest).
// ---------------------------------------------------------------
const CONFIG = {
  stopQuery: "Föhrenstraße, Bremen",
  stopLimit: 2,

  // Falls die automatische Suche mal daneben liegt, hier die exakte
  // Transitous-Stop-ID eintragen, dann wird nicht gesucht.
  stopIds: [],

  // Fahrtziele, die NICHT angezeigt werden sollen (z.B. weil sie aus
  // der Stadt raus fahren). Bekannte Linien an der Föhrenstraße:
  // Bus 38, 39, 40, 41, 42, 730, 740, 745.
  excludeDestinations: [],

  // Falls stattdessen nur bestimmte Ziele erlaubt sein sollen, hier
  // eintragen (z.B. ["Hauptbahnhof", "Domsheide", "Am Brill"]).
  onlyDestinations: [],

  maxRows: 6,

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
