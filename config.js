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

  // Fahrtziele, die NICHT angezeigt werden sollen (weil sie aus der Stadt
  // raus fahren). Föhrenstraße liegt auf der Straßenbahnstrecke Sebald-
  // sbrück/Mahndorf <-> Innenstadt (Linien 1, 2, 10 + Ersatzverkehr),
  // Sebaldsbrück/Mahndorf ist die von der Stadt wegführende Richtung.
  // Erste Einschätzung aus Recherche, noch nicht gegen die echten
  // Fahrtziel-Texte auf der Tafel geprüft — bitte kurz gegenchecken.
  excludeDestinations: ["Sebaldsbrück", "Mahndorf"],

  // Falls stattdessen nur bestimmte Ziele erlaubt sein sollen, hier
  // eintragen (z.B. ["Hauptbahnhof", "Domsheide", "Am Brill"]).
  onlyDestinations: [],

  // Bewusst klein gehalten: die Tafel filtert Abfahrten raus, die man mit
  // der Gehzeit eh nicht mehr schafft (siehe renderDepartures) — weniger,
  // aber tatsächlich planbare Zeilen statt einer langen Liste voller
  // "eigentlich schon zu spät".
  maxRows: 4,

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
  panelSequence: ["departures", "commute", "weather", "news", "music", "sport", "quote"],

  // Anzeigedauer je Panel in Millisekunden. Fehlt ein Eintrag, gilt
  // panelDurationMs als Standard.
  panelDurations: {
    departures: 30 * 1000,
    commute: 16 * 1000,
    weather: 15 * 1000,
    news: 40 * 1000, // bis zu 7 Slides (Bremen+Deutschland+Welt) à 6s
    music: 15 * 1000,
    sport: 50 * 1000, // bis zu 6 Vereine + 4 News à 5s Diashow
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

  // TomTom-API-Key für echte Live-Verkehrsdaten bei der Auto-Zeit (Stau,
  // aktuelle Verkehrslage — nicht nur freie Fahrt wie bei der bisherigen
  // Schätzung). Kostenloses Freemium-Konto, keine Kreditkarte nötig,
  // 2.500 Anfragen/Tag gratis (die Tafel braucht bei 10-Minuten-Takt nur
  // ~144/Tag):
  //   1. Auf https://developer.tomtom.com registrieren
  //   2. Im Dashboard eine App anlegen (Produkt "Routing API" reicht)
  //   3. Den API-Key hier eintragen
  // Leer lassen ("") = Auto-Zeit fällt zurück auf die bisherige grobe
  // Schätzung (Luftlinie × Aufschlag) ohne echten Verkehr.
  tomtomApiKey: "",

  // Farben je Verkehrsmittel im Pendel-Panel (Rennen-Balken/Sieger-Anzeige).
  // Kein Kartenmaterial mehr nötig, seit die Karte durch die Rennen-
  // Visualisierung ersetzt wurde.
  commuteModeColors: {
    bike: "#3f7d52",
    bus: "#5b6b78",
    car: "#a9793f",
  },

  // Wetter-Panel: wie viele Stunden-Kacheln
  weatherHourCount: 5,

  // News-Panel: Mischung aus Bremen-Regionalmeldungen (regions=5) und
  // überregionalen/internationalen Meldungen (allgemeiner Feed + explizit
  // ressort=ausland), damit nicht nur Lokales läuft.
  newsRegion: 5,
  newsRegionCount: 2, // Bremen
  newsGeneralCount: 2, // Deutschland/Top-Meldungen
  newsWorldCount: 3, // explizit Ausland/Welt
  // Für die ersten X Meldungen (in der zusammengeführten Reihenfolge)
  // wird der volle Artikeltext geladen (zum Scrollen), der Rest bleibt
  // kurze Headline.
  newsFullCount: 3,
  refreshNewsMs: 15 * 60 * 1000,
  // Wie lange jeder Artikel in der News-Diashow einzeln zu sehen ist,
  // bevor automatisch zum nächsten gewechselt wird.
  newsSlideIntervalMs: 6 * 1000,

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

  // Sport-Ticker über openligadb.de (kostenlos, kein Key, per Vereins-
  // namen abgefragt statt fester Team-IDs — robuster, kein Pflegeaufwand
  // bei falschen/veralteten IDs). Werder zuerst (Hauptverein, bleibt oben),
  // danach die weiteren Lieblingsvereine. Es werden nur echte Wettbewerbe
  // angezeigt (Bundesliga/2./3. Liga/DFB-Pokal) — openligadb enthält auch
  // Test-/Fantasieligen fremder Nutzer, die hier bewusst ignoriert werden.
  sportTeams: [
    "Werder Bremen",
    "St. Pauli",
    "Borussia Dortmund",
    "Rot-Weiss Essen",
    "Schalke",
    "Mönchengladbach",
  ],
  sportLeagueWhitelist: ["bl1", "bl2", "bl3", "dfb"],
  refreshSportMs: 30 * 60 * 1000,
  // Eine Vereins-Karte wird erst gezeigt, wenn das nächste Spiel innerhalb
  // dieser Zahl an Tagen ansteht (oder das letzte höchstens so lange her
  // ist) — weit entfernte "nächste Spiele" sind selten interessant genug
  // für eine eigene Karte, lieber Platz für Fußball-News lassen.
  sportRelevanceDays: 5,
  // Vereinsfarben fürs Sport-Panel (Verlauf/Glow hinterm eigenen Wappen).
  // Grobe Annäherung an die echten Vereinsfarben, kein Anspruch auf exakten
  // Markenfarbcode.
  sportTeamColors: {
    "Werder Bremen": "#1d9053",
    "St. Pauli": "#6b4226",
    "Borussia Dortmund": "#fde100",
    "Rot-Weiss Essen": "#e2001a",
    "Schalke": "#004d9d",
    "Mönchengladbach": "#14532d",
  },
  // Wie lange jede Spiel-Karte in der Sport-Diashow einzeln zu sehen ist.
  sportSlideIntervalMs: 5 * 1000,

  // Zusätzlich zu den Vereins-Karten: allgemeine Fußball-/Sportnachrichten
  // (Transfers, Berichte) über Tagesschau ressort=sport — dieselbe bereits
  // bewährte, garantiert CORS-freundliche Quelle wie der Rest der Nach-
  // richten hier, nur mit anderem Ressort-Filter (wie schon bei
  // ressort=ausland für Welt-News). Kein reines "nur Fußball"-Feed (Tages-
  // schau mischt auch andere Sportarten rein), aber die zuverlässigste
  // kostenlose Option ohne API-Key.
  sportNewsCount: 6,
};
