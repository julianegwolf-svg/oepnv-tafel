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
  maxRows: 5,

  // Dringlichkeit auf der Abfahrtstafel (IDEEN A2): "zeile" = Pille
  // "LOS!"/"in 3 min los" direkt in der Zeile der nächsten erreichbaren
  // Bahn (spart das Banner), "banner" = kompaktes Banner darüber.
  abfahrtenDringlichkeit: "zeile",

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

  // Nachtdimmung: die Tafel hängt dauerhaft an der Wand, deshalb nachts
  // automatisch abdunkeln statt mit voller Helligkeit zu blenden.
  // startHour/endHour wie bei den Nacht-Begrüßungen (22–5 Uhr), aber
  // bewusst als eigene Werte, falls die beiden mal auseinanderlaufen
  // sollen. endHour < startHour bedeutet automatisch "über Mitternacht".
  nightDim: {
    startHour: 22,
    endHour: 5,
    opacity: 0.65,
  },

  // Echter Tiefschlaf mitten in der Nacht (Teilmenge von nightDim oben):
  // fast schwarz statt nur gedimmt, da um 2 Uhr nachts realistisch niemand
  // Abfahrten prüfen will. Wacht sofort auf, sobald jemand die Tafel
  // berührt (siehe recentlyTouched in app.js) — fällt dann auf die normale
  // nightDim-Helligkeit zurück, nicht auf volle Tageshelligkeit.
  // Nachts (nightDim-Stunden): "schleier" = Karussell läuft gedimmt weiter
  // (bisher), "ansicht" = ruhige Nachtansicht mit großer Uhr, nächsten zwei
  // Bahnen und wichtigen Hinweisen, Karussell ruht bis zum nächsten Tipp.
  // Bewusst noch "schleier": eine große Uhr mit stehendem Karussell ist
  // genau das, was tagsüber gestört hat (FEEDBACK) — Julian entscheidet
  // (FRAGEN.md). nachtFarbe: "bernstein" | "grau".
  nachtModus: "schleier",
  nachtFarbe: "bernstein",

  nightSleep: {
    startHour: 1,
    endHour: 5,
    opacity: 0.94,
  },

  // Ambient-Modus (nur Uhrzeit + langsamer Farbverlauf): früher nach so
  // langer Untätigkeit automatisch — an einer Wandtafel tippt aber fast nie
  // jemand, die Tafel landete dadurch praktisch immer nach einer Stunde in
  // der Riesen-Uhr und das Karussell stand (FEEDBACK 10.10.). Jetzt 0 = aus:
  // Ambient nur noch bei echter Abwesenheit über Home Assistant (siehe
  // homeAssistant.reaktionen.niemandDaAmbient). Nachtdimmung/Tiefschlaf nach
  // Uhrzeit bleiben davon unberührt. Ein Wert > 0 (ms) holt den alten
  // Berührungs-Timeout zurück.
  ambientAfterMs: 0,

  // ---------------------------------------------------------------
  // Karussell: welche Ansichten in welcher Reihenfolge. Läuft einmal
  // komplett durch und fängt dann wieder von vorne an — kein Zurück-
  // springen zu Abfahrten nach jedem einzelnen Panel mehr. Abfahrten
  // bleiben trotzdem am längsten sichtbar, über panelDurations unten.
  // Panels, deren Datenquelle gerade nicht klappt, werden automatisch
  // übersprungen.
  // ---------------------------------------------------------------
  // "departures" bleibt als erstes Panel jeder Runde fix (wichtigste
  // Information, direkt nach dem Umschalten) — die Reihenfolge der
  // restigen Panels wird bei jedem vollen Durchlauf neu gemischt (siehe
  // shuffleSequence in app.js), damit sich die Reihenfolge nach ein paar
  // Wochen nicht stur auswendig lernen lässt.
  // "home", "klima", "medien" sind die Home-Assistant-Panels — ohne
  // eingerichtetes HA werden sie automatisch übersprungen.
  panelSequence: ["departures", "tagesblick", "home", "commute", "weather", "klima", "news", "music", "sport", "quote", "trivia", "quiz", "riddle", "events", "calendar", "medien", "tagesschau"],

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
    trivia: 22 * 1000, // Tippdauer variiert mit Satzlänge + 3s Denkpause vor der Multiple-Choice-Auflösung
    quiz: 22 * 1000,
    riddle: 24 * 1000, // Frage tippen, dann Lösung erst zur Halbzeit auflösen
    events: 16 * 1000,
    home: 22 * 1000,
    klima: 16 * 1000,
    medien: 15 * 1000,
    tagesschau: 105 * 1000, // Video läuft ~100 s
    tagesblick: 20 * 1000,
  },
  panelDurationMs: 18 * 1000,

  // ---------------------------------------------------------------
  // Zeitbewusste Panel-Priorität: welche Panels je nach Tageszeit mehr
  // Aufmerksamkeit bekommen (länger angezeigt UND weiter vorne in der
  // gemischten Reihenfolge, siehe boostFactor/muteFactor + shuffleSequence
  // in app.js) und welche kürzer/weiter hinten. "boost" bekommt
  // boostFactor auf die Dauer aus panelDurations, alle anderen Panels
  // (nicht "boost") bekommen muteFactor. Perioden dürfen über Mitternacht
  // gehen (startHour > endHour). Trifft keine Periode zu, bleibt alles
  // beim Standardwert (Faktor 1).
  // ---------------------------------------------------------------
  timeBasedPriority: [
    { // Vor der Arbeit: raus aus dem Haus zählt am meisten.
      startHour: 6, endHour: 9,
      boost: ["tagesblick", "departures", "commute", "weather", "klima"],
      boostFactor: 1.6, muteFactor: 0.7,
    },
    { // Feierabend: der Weg nach Hause plus, ob man noch trocken ankommt.
      startHour: 16, endHour: 19,
      boost: ["departures", "weather"],
      boostFactor: 1.5, muteFactor: 0.8,
    },
    { // Abends zuhause: Unterhaltung/Wissen wichtiger als Pendel-Daten.
      startHour: 19, endHour: 23,
      boost: ["tagesblick", "home", "medien", "news", "music", "quiz", "trivia", "riddle", "events", "sport"],
      boostFactor: 1.3, muteFactor: 0.75,
    },
  ],

  // ---------------------------------------------------------------
  // Pendel-Panel: Arbeitsweg mit Rad/Bus/Auto zu Max Müller GmbH.
  // Adressen werden beim Laden einmalig über Transitous geokodiert
  // (wie schon bei der Haltestellensuche), danach gecacht.
  // ---------------------------------------------------------------
  homeAddress: "Alter Postweg 110, 28237 Bremen",
  workAddress: "Fritz-Thiele-Straße 7, 28279 Bremen",
  workLabel: "Max Müller GmbH",
  refreshCommuteMs: 10 * 60 * 1000,

  // Uhrzeit, zu der man werktags bei der Arbeit sein muss — für die
  // Ankunfts-Einschätzung in der "Sollte ich jetzt los?"-Karte (siehe
  // workArrivalEstimate/renderLeaveNowBanner in app.js). Nur Mo-Fr
  // relevant, am Wochenende wird sie ignoriert.
  workArrivalTarget: "08:00",

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
  tomtomApiKey: "83kEpBN2fCEuAb4swgizpdqF1A0mJM3r",

  // Übliche Abfahrtszeit an Werktagen. Die Tafel zeigt das Pendel-Panel
  // auch außerhalb der eigentlichen Pendelzeit (Abend, Wochenende) in der
  // Rotation — "Verkehr genau jetzt" wäre dann meist irreführend kurz.
  // Ist ein TomTom-Key gesetzt, fragt die Tafel deshalb immer die
  // vorhergesagte Verkehrslage für die nächste noch bevorstehende
  // Abfahrt zu dieser Uhrzeit ab (an Werktagen, sonst nächster Werktag).
  commuteTypicalDepartTime: "07:30",

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
  // Mitte des Wetter-Panels: "verlauf" = Temperaturkurve + Regen der
  // nächsten 12 Stunden, "leer" = nur Himmel (bisher).
  wetterMitte: "verlauf",

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
  // Layout der Nachrichten (IDEEN N1): "rechts" = Foto rechts, links
  // Kicker + große Überschrift + Teaser; "oben" = Foto oben über die volle
  // Breite, Text darunter; "klassisch" = Volltext über dem Foto (bisher).
  nachrichtenLayout: "rechts",

  // Musik-Panel: Deezers offizielle "Top Germany"-Redaktions-Playlist
  // (von Deezer selbst kuratiert und laufend aktualisiert, echte
  // Popularitäts-Charts statt Kauf-Charts — siehe ausführlicher
  // Kommentar bei updateMusic() in app.js für die Historie dahinter).
  // Playlist-ID über die Deezer-Suche/-Website ermittelbar, falls sie
  // sich mal ändert: deezer.com nach "Top Germany" durchsuchen, ID steht
  // in der URL der Playlist.
  musicPlaylistId: "1111143121",
  musicCount: 5,
  // "zweispaltig" = Nr. 1 groß links, Plätze 2–10 rechts mit Auf-/Absteigern
  // (IDEEN M1); "karten" = bisherige fünf Karten.
  musikLayout: "zweispaltig",
  refreshMusicMs: 60 * 60 * 1000,

  // Zitat-Panel
  refreshQuoteMs: 60 * 60 * 1000,

  // Trivia-Panel ("Auf den Tag genau") — Wikipedia-REST-API, kostenlos,
  // kein Key. Stündlich neu abgerufen und zufällig aus der Tagesliste
  // ausgewählt (siehe updateTrivia in app.js), damit sich die Auswahl über
  // den Tag verteilt abwechselt statt immer dasselbe erste Ereignis zu
  // zeigen.
  refreshTriviaMs: 60 * 60 * 1000,

  // Allgemeinwissen-Panel — Open Trivia Database (opentdb.com), kostenlos,
  // kein Key, CORS offen. Bewusst eigenständig neben "Auf den Tag genau":
  // dort geht es um Fakten, die HEUTE vor X Jahren passiert sind, hier um
  // zufälliges Allgemeinwissen aus jeder Rubrik (Wissenschaft, Geografie,
  // Film, Sport …), nicht ans Datum gebunden. Fragen kommen auf Englisch
  // (die API bietet kein Deutsch an) — gleiches Prinzip wie beim
  // Spruch-des-Tages-Panel, das ebenfalls englische Inhalte zeigt.
  refreshQuizMs: 60 * 60 * 1000,

  // Rätsel-des-Tages-Panel — keine externe API: eine Recherche nach einer
  // kostenlosen, keylosen, deutschsprachigen Rätsel-API mit Lösung blieb
  // ergebnislos (die einzigen brauchbaren Kandidaten, z.B. riddles-api.
  // vercel.app, liefern nur Englisch — gleiche Lücke wie beim letzten Check).
  // Stattdessen eine feste, lokale Sammlung klassischer Rätsel, ganz ohne
  // Netzwerkabhängigkeit oder CORS-Risiko. Wird bei jedem Erreichen des
  // Panels neu (zufällig, ohne direkte Wiederholung) ausgewählt statt nur
  // einmal pro Kalendertag (siehe pickNextRiddle in app.js) — bei mehreren
  // Karussell-Runden am Tag kommen so deutlich mehr als eines zum Einsatz.
  riddles: [
    { q: "Je mehr man davon wegnimmt, desto größer wird es. Was ist es?", a: "Ein Loch" },
    { q: "Was wird nasser, je mehr es trocknet?", a: "Ein Handtuch" },
    { q: "Welcher Monat hat 28 Tage?", a: "Alle Monate" },
    { q: "Zwei Väter und zwei Söhne gehen angeln und fangen zusammen drei Fische — jeder bekommt einen ganzen. Wie ist das möglich?", a: "Es sind nur drei Personen: Großvater, Vater und Sohn" },
    { q: "Was hat viele Zähne, kann aber nicht beißen?", a: "Ein Kamm" },
    { q: "Ein Bauer hat 17 Schafe. Alle außer 9 laufen weg. Wie viele Schafe bleiben ihm?", a: "9" },
    { q: "Welches Wort wird in jedem Wörterbuch immer falsch geschrieben?", a: "Das Wort „falsch“" },
    { q: "Was kann man leicht zerbrechen, ohne es je zu berühren?", a: "Ein Versprechen" },
    { q: "Ich habe Städte, aber keine Häuser, Berge, aber keine Bäume, und Wasser, aber keine Fische. Was bin ich?", a: "Eine Landkarte" },
    { q: "Was geht ständig nach oben, aber niemals nach unten?", a: "Das Alter" },
    { q: "Was hat einen Ring, aber keinen Finger?", a: "Ein Baum (Jahresring)" },
    { q: "Was hat eine Zunge, kann aber nicht sprechen?", a: "Ein Schuh" },
    { q: "Was füllt einen ganzen Raum, ohne Platz wegzunehmen?", a: "Licht" },
    { q: "Je mehr davon in einem Zimmer ist, desto weniger sieht man. Was ist es?", a: "Dunkelheit" },
    { q: "Was hat vier Beine, kann aber nicht laufen?", a: "Ein Tisch" },
    { q: "Was hat Hände, aber keine Arme, und ein Gesicht, aber keine Augen?", a: "Eine Uhr" },
    { q: "Was kann sprechen, ohne einen Mund zu haben, und hören, ohne Ohren zu haben?", a: "Ein Echo" },
    { q: "Ich bin am Anfang der Ewigkeit, am Ende von Raum und Zeit, am Anfang jedes Endes und am Ende jedes Ortes. Welcher Buchstabe bin ich?", a: "Der Buchstabe E" },
    { q: "Wie nennt man ein Wort, das vorwärts wie rückwärts gelesen gleich klingt, zum Beispiel „OTTO“?", a: "Ein Palindrom" },
    { q: "Was ist schwarz-weiß und wird jeden Tag von vielen gelesen?", a: "Eine Zeitung" },
    { q: "Welches Tier trägt sein ganzes Leben lang dieselben vier Schuhe?", a: "Ein Pferd (Hufeisen)" },
    { q: "Was steigt ständig, ohne sich dabei je zu bewegen?", a: "Die Temperatur" },
    { q: "Was kann man sich einfangen, aber nicht werfen?", a: "Eine Erkältung" },
    { q: "Was hat einen Boden, kann aber nicht stehen?", a: "Das Meer" },
    { q: "Was kann durch ein geschlossenes Fenster fallen, ohne es zu zerbrechen?", a: "Sonnenlicht" },
    { q: "Wie viele Monate haben mindestens 30 Tage?", a: "Elf" },
    { q: "Was hat keine Augen, kann aber trotzdem weinen?", a: "Eine Wolke" },
    { q: "Welches Wasser kann man in einem Sieb tragen, ohne dass es durchläuft?", a: "Gefrorenes Wasser (Eis)" },
    { q: "Was ist voller Löcher, hält aber trotzdem Wasser?", a: "Ein Schwamm" },
    { q: "Sobald du meinen Namen aussprichst, bin ich nicht mehr da. Was bin ich?", a: "Stille" },
    { q: "Was hat einen Hals, aber keinen Kopf?", a: "Eine Flasche" },
    { q: "Was hat viele Blätter, ist aber kein Baum?", a: "Ein Buch" },
    { q: "Was hat einen Bart, ist aber kein Mann?", a: "Ein Schlüssel" },
    { q: "Was steigt aus dem Wasser auf, ohne selbst nass zu sein?", a: "Dampf" },
    { q: "Was hat man umso mehr, je mehr man davon abgibt?", a: "Wissen" },
    { q: "Was wird immer kürzer, je länger man es benutzt?", a: "Ein Bleistift" },
    { q: "Was fällt jeden Tag, verletzt sich dabei aber nie?", a: "Der Regen" },
    { q: "Welches Tier kann nicht rückwärts springen?", a: "Ein Känguru" },
    { q: "Was hat morgens vier Beine, mittags zwei und abends drei?", a: "Der Mensch (als Baby, Erwachsener, mit Gehstock im Alter)" },
    { q: "Was hat einen Mund, spricht aber nie, und ein Bett, schläft aber nie?", a: "Ein Fluss" },
    { q: "Was liegt immer vor dir, aber du kannst es nie erreichen?", a: "Die Zukunft" },
    { q: "Was kannst du in deine linke Hand nehmen, aber nicht in deine rechte?", a: "Deinen rechten Ellbogen" },
    { q: "Ich habe Schlüssel, aber keine Schlösser, und Platz, aber keine Zimmer. Man kann bei mir eintreten, aber nicht hineingehen. Was bin ich?", a: "Eine Tastatur" },
    { q: "Welcher Kamm kämmt niemals Haare?", a: "Ein Hahnenkamm" },
  ],

  // ---------------------------------------------------------------
  // Radio-Schnellzugriff: feste Senderliste, ein Tap startet die
  // Wiedergabe + öffnet (beim ersten Mal) die native AirPlay-Geräte-
  // auswahl von Safari, damit's auf dem HomePod läuft statt aus dem
  // iPad-Lautsprecher. Alle vier Stream-URLs sind echte HTTPS-Direkt-
  // streams (per curl geprüft) — wichtig, weil die Tafel selbst über
  // HTTPS läuft und ein http-Stream als Mixed Content geblockt würde.
  // Kein Home Assistant, kein API-Key, kein Sicherheitsrisiko im
  // öffentlichen Repo — die URLs sind ja nur Radiosender, keine
  // Zugangsdaten.
  // ---------------------------------------------------------------
  radioStations: [
    { name: "80s80s", url: "https://streams.80s80s.de/web/mp3-192/streams.80s80s.de/" },
    { name: "WDR 4", url: "https://icecast.wdr.de/wdr/wdr4/rheinruhr/mp3/128/stream.mp3" },
    { name: "House/Techno", url: "https://stream.sunshine-live.de/live/mp3-192/stream.sunshine-live.de/" },
    // "Radio Italia — Solo Musica Italiana", offizieller HLS-Stream.
    { name: "Italiano", url: "https://radioitaliasmi.akamaized.net/hls/live/2093120/RISMI/master.m3u8" },
  ],

  // Veranstaltungen-Panel (Bremen) — InfraNode (infranode.dev), kostenlos,
  // kein Key, CORS offen (access-control-allow-origin: *), Daten stammen
  // von open.destination.one (Lizenz CC0, geprüft per Testabruf). Erste
  // Recherche nach einer offiziellen bremen.de-Quelle (Transparenzportal,
  // offizieller Veranstaltungskalender) fand keine öffentliche, keylose
  // API — InfraNode ist die einzige tatsächlich funktionierende Quelle,
  // die dabei gefunden wurde.
  eventsCount: 6,
  refreshEventsMs: 6 * 60 * 60 * 1000,

  // Termine-Panel — privater Apple-Kalender (iCloud "Öffentlichen Kalender
  // teilen"). Apple liefert dabei keinen CORS-Header, ein Browser darf den
  // Link deshalb nicht direkt abrufen (per echtem Browser-fetch bestätigt,
  // nicht nur per curl — gleiches Problem wie beim Radio-Metadaten-Versuch
  // an anderer Stelle im Code). Deshalb ruft ein selbst betriebener,
  // kostenloser Cloudflare Worker den Kalender serverseitig ab und reicht
  // ihn mit passendem CORS-Header weiter — der eigentliche Kalender-Link
  // liegt nur als Secret im Worker, nirgends in diesem (öffentlichen!)
  // Repo. Kein Passwortschutz nötig: die Worker-URL selbst ist öffentlich
  // einsehbar (sie steht ja hier im Code), aber ohne das Secret im Worker
  // kommt niemand an die echten Kalenderdaten.
  calendarWorkerUrl: "https://kalender-worker.julian-e-g-wolf.workers.dev/",
  calendarCount: 6,
  // Termine/Veranstaltungen: "tage" = nach Tagen gruppiert, Uhrzeit vorn,
  // nächster Termin groß (IDEEN V1/K1); "kacheln" = bisherige Liste.
  terminListe: "tage",
  refreshCalendarMs: 30 * 60 * 1000,

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

  // Zusätzlich zu den Vereins-Karten: Fußball-News (Transfers, Berichte) zu
  // den oben verfolgten Vereinen, über die Tagesschau-Volltextsuche pro
  // Vereinsname statt eines pauschalen ressort=sport-Feeds — der wurde
  // während Großereignissen (WM, Tour de France) komplett von diesen
  // überschwemmt und zeigte praktisch nie etwas zu den eigenen Vereinen.
  sportNewsCount: 6,

  // ---------------------------------------------------------------
  // Farbwelt (farbwelt.css): "dunkel" = immer dunkles Blau-Anthrazit wie
  // die Home-Assistant-Panels, "auto" = tagsüber hell, nach Sonnen-
  // untergang dunkel, "hell" = der bisherige beige Look.
  // ---------------------------------------------------------------
  farbwelt: "dunkel",

  // ---------------------------------------------------------------
  // Bewegte Bilder (clips.js): Regenradar im Wetter-Panel ("auto" = nur
  // wenn es regnet oder in den nächsten 3 Stunden Regen kommt, "immer",
  // "aus") und "tagesschau in 100 Sekunden" als eigenes Panel morgens
  // (6–10 Uhr) und abends (18–23 Uhr), stumm.
  // ---------------------------------------------------------------
  clips: {
    regenradar: "auto",
    tagesschau: true,
  },

  // ---------------------------------------------------------------
  // Home Assistant — Smart-Home-Zentrale an der Wand (ha.js, ha-panels.js,
  // Anleitung: HOME_ASSISTANT.md). Räume, Lampen, Szenen, Heizungen,
  // Lautsprecher usw. erkennt die Tafel selbst aus den HA-Bereichen —
  // hier steht nur optionale Feinsteuerung.
  //
  // Der Zugangstoken steht NIE hier (das Repo ist öffentlich!): er wird
  // einmalig am iPad eingegeben (lange auf die Uhr drücken) und nur dort
  // im Browser gespeichert. Ohne Token ist alles Home-Assistant-Bezogene
  // unsichtbar und die Tafel läuft wie bisher.
  // ---------------------------------------------------------------
  homeAssistant: {
    // Leer lassen, wenn die Tafel direkt aus Home Assistant geladen wird
    // (http://homeassistant.local:8123/local/tafel/index.html) — dann ist
    // HA die eigene Adresse. Von GitHub Pages (HTTPS) aus blockiert Safari
    // http://-Adressen im Heimnetz ohnehin (Mixed Content).
    url: "",
    // Entitäten, die nie auf der Tafel erscheinen sollen, z. B.
    // ["light.flur_nachtlicht", "switch.server"].
    ausblenden: [],
    // Raum-Reihenfolge (Namen oder area_ids); fehlende Räume folgen in der
    // Reihenfolge aus Home Assistant.
    raumReihenfolge: [],
    // Schnellaktionen (Haus-Knopf oben rechts + Zuhause-Panel). Leer =
    // automatisch: Skripte/Szenen, deren Name nach "Ich geh raus",
    // "Gute Nacht" bzw. "Ich bin da" klingt. Eigene Liste z. B.:
    // [{ name: "Ich geh raus", ziel: "script.ich_geh_raus", icon: "out" }]
    // (icon: out, moon, home, sparkle, bulb, lightsoff).
    schnellaktionen: [],
    alleLichterAus: true, // zusätzlich "Alle Lichter aus" anbieten
    bestaetigungSek: 4, // so lange kann man eine Schnellaktion noch abbrechen
    // Hinweisband unten links (Fenster offen + Heizung, Waschmaschine
    // fertig, Batterie leer, nicht erreichbar …).
    hinweise: true,
    feuchteGrenze: 65, // % Luftfeuchte → "lüften" (Bad/Küche +10)
    batterieGrenze: 20, // % → "Batterie fast leer"
    stromWarnungW: 3000, // Gesamtverbrauch, ab dem ein Hinweis kommt
    reaktionen: {
      bewegungWeckt: true, // Bewegung im Flur weckt aus Ambient/Tiefschlaf
      weckSensoren: [], // leer = Bewegungsmelder in Flur/Diele/Eingang
      niemandDaAmbient: true, // alle person.* weg → Ambient-Modus
      ereignisSprung: true, // Waschmaschine fertig / Tür offen → Zuhause-Panel
    },
  },
};
