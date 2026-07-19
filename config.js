// ---------------------------------------------------------------
// KONFIGURATION – hier anpassen, ohne app.js anzufassen
// ---------------------------------------------------------------
const CONFIG = {
  // Suchbegriff für die Haltestelle(n). Die Seite sucht selbst alle
  // Treffer und übernimmt bis zu STOP_LIMIT davon.
  stopQuery: "Föhrenstraße, Bremen",
  stopLimit: 2,

  // Falls die automatische Suche mal daneben liegt, kannst du hier die
  // exakten Haltestellen-IDs eintragen (z.B. ["008010123"]) — dann wird
  // gar nicht erst gesucht. Leer lassen = automatische Suche per stopQuery.
  stopIds: [],

  // API-Profil für v6.db.transport.rest. Leer lassen = Standard (dbnav).
  // Falls die Föhrenstraße damit nicht gefunden wird, mal "db" oder
  // "dbweb" probieren.
  apiProfile: "",

  // Fahrtziele, die NICHT angezeigt werden sollen (z.B. weil sie aus
  // der Stadt raus fahren). Trag hier Teile des Zielnamens ein, wie
  // sie in den Live-Daten stehen — schau dir dazu einmal die Seite an,
  // wenn sie läuft, und ergänze die Namen, die "falsch rum" fahren.
  // Beispiel: excludeDestinations: ["Sebaldsbrück", "Mahndorf", "Arsten"]
  excludeDestinations: [],

  // Falls stattdessen nur bestimmte Ziele erlaubt sein sollen, hier
  // eintragen (z.B. ["Hauptbahnhof", "Domsheide", "Am Brill"]).
  // Leer lassen = alle (außer excludeDestinations) werden gezeigt.
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
