// ---------------------------------------------------------------
// KONFIGURATION – hier anpassen, ohne app.js anzufassen
//
// Die Abfahrten selbst kommen jetzt über das offizielle VBN-Widget
// (siehe das <div data-hfs-widget...> in index.html) — die Haltestelle
// und Fahrtrichtung stellst du dort im Widgetgenerator ein
// (https://fahrplaner.vbn.de/fahrplan/widgetgenerator.html?L=vs_vbn),
// nicht hier.
// ---------------------------------------------------------------
const CONFIG = {
  // Koordinaten für die Wetteranzeige (Alter Postweg, Bremen-Hemelingen)
  weatherLat: 53.073,
  weatherLon: 8.887,

  // Update-Intervalle in Millisekunden
  refreshWeatherMs: 15 * 60 * 1000,
  refreshClockMs: 1000,

  // Sicherheitsnetz: kompletter Seiten-Reload alle paar Stunden,
  // falls Safari nach Tagen im Dauerbetrieb mal zickt.
  fullReloadMs: 3 * 60 * 60 * 1000,
};
