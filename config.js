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

  // ---------------------------------------------------------------
  // Karussell: welche Ansichten in welcher Reihenfolge. Läuft einmal
  // komplett durch und fängt dann wieder von vorne an — kein Zurück-
  // springen zu Abfahrten nach jedem einzelnen Panel mehr. Abfahrten
  // bleiben trotzdem am längsten sichtbar, über panelDurations unten.
  // Panels, deren Datenquelle gerade nicht klappt, werden automatisch
  // übersprungen.
  // ---------------------------------------------------------------
  panelSequence: ["departures", "commute", "weather", "news", "music", "quote"],

  // Anzeigedauer je Panel in Millisekunden. Fehlt ein Eintrag, gilt
  // panelDurationMs als Standard.
  panelDurations: {
    departures: 30 * 1000,
    commute: 16 * 1000,
    weather: 15 * 1000,
    news: 20 * 1000,
    music: 15 * 1000,
    quote: 12 * 1000,
  },
  panelDurationMs: 18 * 1000,

  // ---------------------------------------------------------------
  // Pendel-Panel: Arbeitsweg mit Rad/Bus/Auto zu Max Müller GmbH.
  // Adressen werden beim Laden einmalig über Transitous geokodiert
  // (wie schon bei der Haltestellensuche), danach gecacht.
  // ---------------------------------------------------------------
  homeAddress: "Alter Postweg 110, 28237 Bremen",
  workAddress: "Fritz-Thiele-Straße 7, 28279 Bremen",
  workLabel: "Max Müller GmbH",
  refreshCommuteMs: 10 * 60 * 1000,

  // Karten-Kacheln (OpenStreetMap, kostenlos, kein API-Key) + Routenfarben
  // je Verkehrsmittel für das Pendel-Panel.
  mapTileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  commuteMapColors: {
    bike: "#3f7d52",
    bus: "#5b6b78",
    car: "#a9793f",
  },

  // Wetter-Panel: wie viele Stunden-Kacheln
  weatherHourCount: 5,

  // News-Panel: Tagesschau-Region (5 = Bremen), wie viele Meldungen
  newsRegion: 5,
  newsCount: 4,
  // Für die ersten X Meldungen wird der volle Artikeltext geladen
  // (zum Scrollen), der Rest bleibt kurze Headline.
  newsFullCount: 2,
  refreshNewsMs: 15 * 60 * 1000,

  // Musik-Panel: Apple-Music-Charts Deutschland
  musicCount: 5,
  refreshMusicMs: 60 * 60 * 1000,

  // Zitat-Panel
  refreshQuoteMs: 60 * 60 * 1000,

  // ---------------------------------------------------------------
  // Müllabfuhr — Bremer Abfallkalender für Alter Postweg 110.
  // Bremen hat keine öffentliche API/iCal dafür (nur eine sessionbasierte
  // Drittanbieter-Weboberfläche ohne CORS-Unterstützung), deshalb reine
  // Datumsrechnung statt Live-Abruf — laut offiziellem PDF-Kalender fester
  // Rhythmus: jeden Mittwoch abwechselnd Restmüll/Bioabfall und Papier/
  // Gelber Sack, gültig bis Juni 2027. referenceDate ist ein Mittwoch mit
  // bekanntem Typ, ab dem hochgezählt/durchgezählt wird.
  //
  // Wenn Bremen im Sommer 2027 den nächsten Kalender veröffentlicht: neuen
  // PDF-Kalender unter die-bremer-stadtreinigung.de/abfallkalender ziehen
  // und referenceDate/referenceType (und exceptions) hier aktualisieren.
  // ---------------------------------------------------------------
  wasteCollection: {
    referenceDate: "2026-07-22",
    referenceType: "restbio", // "restbio" = Restmüll/Bioabfall, "papier" = Papier/Gelber Sack
    exceptions: [
      { date: "2027-01-26", label: "Tannenbaumabfuhr" },
    ],
    refreshMs: 30 * 60 * 1000,
  },
};
