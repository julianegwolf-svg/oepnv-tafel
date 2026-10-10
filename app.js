// ---------------------------------------------------------------
// Föhrenstraße Abfahrtstafel — app.js
// Datenquelle ÖPNV: Transitous (api.transitous.org) — kostenlos, kein
// API-Key, für Dauerbetrieb gedacht (MOTIS-Backend, GTFS/GTFS-RT-basiert).
// Datenquelle Wetter: Open-Meteo (kostenlos, kein API-Key)
// Bewusst ohne Optional Chaining (?.), Array.flat() etc. geschrieben,
// damit das auch auf Safari 12 (iPad Air 1 / iOS 12.5.x) läuft.
// ---------------------------------------------------------------

// ---------- Kiosk-Resilience: wach aus einer langen Pause ----------
// Nach Wochen ausgeschaltet meldete der Nutzer "News etc. komplett
// verschwunden" — die Tafel läuft als "Web-App" (siehe apple-mobile-
// web-app-capable-Meta-Tag in index.html), und Safari kann so eine Seite
// beim Wiedereinschalten aus dem bfcache (Back-Forward-Cache) zurückholen
// statt sie wirklich neu über das Netz zu laden. Der bestehende
// fullReloadMs-Reload (siehe init()) greift nur, solange die Seite
// durchgehend am Laufen ist — nach einem echten Aus/An kommt der nie zum
// Zug, weil dessen setTimeout mit der eingefrorenen Seite mit-eingefroren
// wurde. Deshalb zwei zusätzliche, von init() unabhängige Wecksignale:
// "pageshow" mit persisted=true feuert IMMER, wenn die Seite aus dem
// bfcache kommt (dokumentiertes Browser-Verhalten) — dann sofort hart neu
// laden. Und falls die Seite länger als STALE_RESUME_MS unsichtbar war
// (Display aus, App im Hintergrund pausiert), beim Sichtbarwerden
// ebenfalls neu laden statt zu versuchen, mit möglicherweise wochenalten
// Timer-/Fetch-Zuständen weiterzumachen.
const STALE_RESUME_MS = 20 * 60 * 1000;
let lastVisibleAt = Date.now();

function hardReload() {
  // Gleicher Trick wie beim bestehenden fullReloadMs-Reload: eine neue
  // URL mit Zeitstempel, garantiert weder im Browser- noch im CDN-Cache.
  window.location.href = window.location.pathname + "?_=" + Date.now();
}

window.addEventListener("pageshow", function (e) {
  if (e.persisted) hardReload();
});

document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible") {
    if (Date.now() - lastVisibleAt > STALE_RESUME_MS) hardReload();
  } else {
    lastVisibleAt = Date.now();
  }
});

const API_BASE = "https://api.transitous.org/api";

const els = {
  rows: document.getElementById("departureRows"),
  leaveNowBanner: document.getElementById("leaveNowBanner"),
  status: document.getElementById("statusText"),
  lastUpdate: document.getElementById("lastUpdate"),
  clockTime: document.getElementById("clockTime"),
  clockDate: document.getElementById("clockDate"),
  clockWeekday: document.getElementById("clockWeekday"),
  clockDay: document.getElementById("clockDay"),
  topbarTitle: document.getElementById("topbarTitle"),
  nightOverlay: document.getElementById("nightOverlay"),
  ambientOverlay: document.getElementById("ambientOverlay"),
  ambientClock: document.getElementById("ambientClock"),
  weatherPanel: document.getElementById("panel-weather"),
  weatherSky: document.getElementById("weatherSky"),
  weatherBig: document.getElementById("weatherBig"),
  weatherBigIcon: document.getElementById("weatherBigIcon"),
  weatherBigTemp: document.getElementById("weatherBigTemp"),
  weatherBigDesc: document.getElementById("weatherBigDesc"),
  weatherBigMinMax: document.getElementById("weatherBigMinMax"),
  weatherBigMoon: document.getElementById("weatherBigMoon"),
  weatherTip: document.getElementById("weatherTip"),
  weatherHours: document.getElementById("weatherHours"),
  weatherDetails: document.getElementById("weatherDetails"),
  newsList: document.getElementById("newsList"),
  musicList: document.getElementById("musicList"),
  quoteBlock: document.getElementById("quoteBlock"),
  triviaBlock: document.getElementById("triviaBlock"),
  quizBlock: document.getElementById("quizBlock"),
  riddleBlock: document.getElementById("riddleBlock"),
  eventsList: document.getElementById("eventsList"),
  calendarList: document.getElementById("calendarList"),
  commuteHero: document.getElementById("commuteHero"),
  commuteRace: document.getElementById("commuteRace"),
  commuteMapWrap: document.getElementById("commuteMapWrap"),
  commuteUnten: document.getElementById("commuteUnten"),
  commuteMapImg: document.getElementById("commuteMapImg"),
  commuteMapRoute: document.getElementById("commuteMapRoute"),
  wasteLine: document.getElementById("wasteLine"),
  sportBlock: document.getElementById("sportBlock"),
  radioToggle: document.getElementById("radioToggle"),
  radioMenu: document.getElementById("radioMenu"),
  panelNavToggle: document.getElementById("panelNavToggle"),
  panelNavOverlay: document.getElementById("panelNavOverlay"),
  panelNavGrid: document.getElementById("panelNavGrid"),
  stage: document.getElementById("stage"),
};

let resolvedStopIds = (CONFIG.stopIds && CONFIG.stopIds.length)
  ? CONFIG.stopIds.slice()
  : null;
let resolvedStopCoord = null;

// ---------- Radio-Schnellzugriff ----------
// Erste echte Touch-Interaktion der Tafel: ein Tap auf den Radio-Knopf im
// Header klappt ein kleines Menü mit den fest hinterlegten Sendern auf
// (siehe CONFIG.radioStations); ein Tap auf einen Sender startet die
// Wiedergabe und öffnet Safaris native AirPlay-Geräteauswahl, damit's auf
// dem HomePod läuft statt aus dem eingebauten iPad-Lautsprecher.
// webkitShowPlaybackTargetPicker ist eine alte, WebKit-spezifische
// Funktion auf <audio>-Elementen — auf anderen Browsern schlicht nicht
// vorhanden, dann spielt es einfach lokal.
//
// Menü als eigenes Popover statt einer festen Button-Zeile im Header:
// eine feste Zeile hätte allen Panels darunter dauerhaft Höhe weggenommen
// (.stage bekommt per flex:1 nur den Rest von 100vh) — das Popover kostet
// nur Platz, während es offen ist.
let radioAudioEl = null;
let radioActiveUrl = null;
let radioMenuOpen = false;
let radioStationNames = {};

function updateRadioButtonStates() {
  const isPlaying = !!(radioActiveUrl && radioAudioEl && !radioAudioEl.paused);

  if (els.radioToggle) els.radioToggle.classList.toggle("is-playing", isPlaying);

  if (!els.radioMenu) return;
  const items = els.radioMenu.querySelectorAll(".radio-menu-item");
  for (let i = 0; i < items.length; i++) {
    items[i].classList.toggle("is-playing", isPlaying && items[i].dataset.url === radioActiveUrl);
  }
}

function setRadioMenuOpen(open) {
  radioMenuOpen = open;
  if (els.radioMenu) els.radioMenu.classList.toggle("is-open", open);
}

function toggleRadioStation(url) {
  // Home Assistant verbunden und im Menü ein Lautsprecher als Ziel gewählt
  // (siehe ha-panels.js): dann spielt HA den Sender dort, nicht das iPad.
  if (window.TafelHAUI && TafelHAUI.radioUmleiten(url)) {
    setRadioMenuOpen(false);
    return;
  }
  if (!radioAudioEl) return;

  // Nochmal denselben Sender antippen = stoppen, statt neu zu starten.
  if (radioActiveUrl === url && !radioAudioEl.paused) {
    radioAudioEl.pause();
    radioActiveUrl = null;
    updateRadioButtonStates();
    return;
  }

  radioActiveUrl = url;
  if (radioAudioEl.getAttribute("src") !== url) {
    radioAudioEl.src = url;
  }
  radioAudioEl.play().catch(function (err) {
    console.error("Radio-Wiedergabe fehlgeschlagen:", err);
    radioActiveUrl = null;
    updateRadioButtonStates();
  });

  // Geräteauswahl nur zeigen, wenn noch nicht per AirPlay verbunden —
  // sonst würde jeder Sender-Wechsel erneut den Dialog aufreißen, obwohl
  // schon auf den HomePod geroutet ist.
  if (!radioAudioEl.webkitCurrentPlaybackTargetIsWireless
    && typeof radioAudioEl.webkitShowPlaybackTargetPicker === "function") {
    radioAudioEl.webkitShowPlaybackTargetPicker();
  }

  updateRadioButtonStates();
  setRadioMenuOpen(false);
}

function initRadioBar() {
  if (!els.radioToggle || !els.radioMenu) return;
  const stations = CONFIG.radioStations || [];
  if (!stations.length) return;

  radioAudioEl = document.createElement("audio");
  radioAudioEl.id = "radioAudio";
  radioAudioEl.preload = "none";
  radioAudioEl.addEventListener("play", updateRadioButtonStates);
  radioAudioEl.addEventListener("pause", updateRadioButtonStates);
  radioAudioEl.addEventListener("error", function () {
    console.error("Radio-Stream-Fehler:", radioAudioEl.error);
    radioActiveUrl = null;
    updateRadioButtonStates();
  });
  document.body.appendChild(radioAudioEl);

  stations.forEach(function (station) {
    radioStationNames[station.url] = station.name;

    const item = document.createElement("button");
    item.type = "button";
    item.className = "radio-menu-item";
    item.dataset.url = station.url;

    const dot = document.createElement("span");
    dot.className = "radio-menu-dot";
    item.appendChild(dot);

    // Equalizer aus drei Balken (nur sichtbar/animiert, solange der Sender
    // spielt) — zeigt, dass wirklich Ton kommt (IDEEN RA1).
    const eq = document.createElement("span");
    eq.className = "radio-eq";
    eq.innerHTML = "<i></i><i></i><i></i>";
    item.appendChild(eq);

    const label = document.createElement("span");
    label.textContent = station.name;
    item.appendChild(label);

    item.addEventListener("click", function (ev) {
      ev.stopPropagation();
      toggleRadioStation(station.url);
    });

    els.radioMenu.appendChild(item);
  });

  els.radioToggle.addEventListener("click", function (ev) {
    ev.stopPropagation();
    setRadioMenuOpen(!radioMenuOpen);
  });

  // Irgendwo sonst hintippen schließt das Menü wieder — sonst bliebe es
  // offen und würde bei jedem Karussell-Wechsel im Weg stehen.
  document.addEventListener("click", function () {
    if (radioMenuOpen) setRadioMenuOpen(false);
  });
}

// ---------- Uhrzeit ----------
function tickClock() {
  const now = new Date();
  els.clockTime.textContent = now.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  // Datum zweizeilig links neben der großen Uhr (IDEEN R2); nur bei
  // Änderung anfassen, nicht jede Sekunde.
  const weekday = now.toLocaleDateString("de-DE", { weekday: "long" });
  const dayText = now.toLocaleDateString("de-DE", { day: "numeric", month: "long" });
  if (els.clockWeekday && els.clockWeekday.textContent !== weekday) els.clockWeekday.textContent = weekday;
  if (els.clockDay && els.clockDay.textContent !== dayText) els.clockDay.textContent = dayText;
  if (els.ambientClock && ambientActive) {
    els.ambientClock.textContent = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    updateAmbientInfo(now);
  }
  updateNightDim(now.getHours());
  applyFarbwelt(now);
  if (now.getSeconds() % 15 === 0) updateStaleBadge();
  // Nicht an eine bestimmte Sekunde koppeln: fällt die mal aus (voller
  // Hauptthread), liefe der Wächter sonst nicht.
  if (now.getTime() - waechterZuletzt >= 15000) { waechterZuletzt = now.getTime(); karussellWaechter(); }
}

let waechterZuletzt = 0;

// ---------- Farbwelt (IDEEN R1) ----------
// "dunkel" = immer das dunkle Designsystem (wie die Home-Assistant-
// Panels), "auto" = tagsüber hell, zwischen Sonnenuntergang und
// -aufgang dunkel, "hell" = der bisherige Look. Nur eine Klasse auf
// <body>; die Farben stehen in farbwelt.css.
function applyFarbwelt(now) {
  const mode = CONFIG.farbwelt || "hell";
  let dark = mode === "dunkel";
  if (mode === "auto") {
    const w = lastWeatherSnapshot;
    const t = now.getTime();
    if (w && w.sunrise && w.sunset) {
      // Sonnenzeiten gelten für "heute" — außerhalb davon ist es dunkel.
      dark = t < w.sunrise || t > w.sunset;
    } else {
      dark = now.getHours() < 7 || now.getHours() >= 19;
    }
  }
  if (document.body.classList.contains("farbe-dunkel") !== dark) {
    document.body.classList.toggle("farbe-dunkel", dark);
  }
}

// ---------- Nachtdimmung ----------
// Läuft im selben Sekunden-Takt wie die Uhr mit (kein eigener Timer nötig)
// — nur ein Zahlenvergleich + ein Klassen-Toggle auf einem einzigen
// Element, kostet praktisch nichts.
function isInHourRange(hour, cfg) {
  if (!cfg) return false;
  const start = cfg.startHour;
  const end = cfg.endHour;
  if (start === end) return false;
  // z.B. 22–5 Uhr: Bereich geht über Mitternacht.
  if (start > end) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

function isNightHour(hour) {
  return isInHourRange(hour, CONFIG.nightDim);
}

// true, solange kürzlich (siehe CAROUSEL_IDLE_RESUME_MS-Fenster) irgendwo
// getippt wurde — gesetzt in deferCarouselAdvance/pauseCarouselIndefinitely,
// zurückgesetzt sobald der Leerlauf-Timer dort tatsächlich abläuft. Der
// Tiefschlaf greift nur, wenn NICHT kürzlich berührt wurde, siehe
// updateNightDim unten.
let recentlyTouched = false;

// Bewegung im Flur (Home Assistant, siehe ha-panels.js) zählt wie ein
// Antippen: weckt aus Ambient-Modus und Nacht-Tiefschlaf, ohne dabei das
// Karussell anzuhalten.
let presenceWakeUntil = 0;

// "Gute Nacht" (Schnellaktion, ha-panels.js): die Tafel dunkelt sanft in
// den Tiefschlaf ab, bis 6 Uhr — Antippen oder Bewegung weckt sie wie
// gewohnt (AUSBAU Abschnitt 4).
let goodNightUntil = 0;

function tafelGuteNacht() {
  const now = new Date();
  const six = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (now.getHours() >= 6 ? 1 : 0), 6, 0);
  goodNightUntil = six.getTime();
  recentlyTouched = false;
  presenceWakeUntil = 0;
  if (els.nightOverlay) {
    els.nightOverlay.classList.add("is-slow");
    setTimeout(function () { els.nightOverlay.classList.remove("is-slow"); }, 4000);
  }
  updateNightDim(now.getHours());
}

// Ist die Tafel gerade dunkel (Tiefschlaf, "Gute Nacht" oder Ambient bei
// Abwesenheit)? Die bloße Nachtdimmung zählt nicht – da sieht man alles.
function tafelIstDunkel() {
  if (ambientActive) return true;
  if (!els.nightOverlay || !els.nightOverlay.classList.contains("is-active")) return false;
  return (isInHourRange(new Date().getHours(), CONFIG.nightSleep) || Date.now() < goodNightUntil) &&
    !recentlyTouched && Date.now() > presenceWakeUntil;
}

// Aufwachen (AUSBAU 4): Kopfzeile, Panel und Hinweiszeile erscheinen
// leicht gestaffelt, während der Schleier in 0,6 s verschwindet.
let wakeAnimTimer = null;

function tafelWachAuf() {
  const panel = document.querySelector(".panel");
  if (!panel) return;
  panel.classList.remove("is-waking");
  void panel.offsetWidth;
  panel.classList.add("is-waking");
  if (wakeAnimTimer) clearTimeout(wakeAnimTimer);
  wakeAnimTimer = setTimeout(function () {
    wakeAnimTimer = null;
    panel.classList.remove("is-waking");
  }, 1400);
}

// greeted: der Morgengruß liegt schon über allem – dann erst beim
// Schließen des Grußes gestaffelt aufbauen (ha-panels.js).
function wakeByPresence(greeted) {
  const wasDark = tafelIstDunkel();
  presenceWakeUntil = Date.now() + 5 * 60 * 1000;
  goodNightUntil = 0;
  armAmbientTimer();
  if (ambientActive) exitAmbientMode();
  updateNightDim(new Date().getHours());
  if (wasDark && !greeted) tafelWachAuf();
}

function updateNightDim(hour) {
  if (!els.nightOverlay) return;
  const cfg = CONFIG.nightDim;
  const sleepCfg = CONFIG.nightSleep;
  const dimActive = isNightHour(hour);
  const sleepActive = (isInHourRange(hour, sleepCfg) || Date.now() < goodNightUntil) && !recentlyTouched && Date.now() > presenceWakeUntil;

  const opacity = sleepActive && sleepCfg && sleepCfg.opacity != null
    ? sleepCfg.opacity
    : ((cfg && cfg.opacity != null) ? cfg.opacity : 0.65);

  // Nachtansicht (IDEEN NA1): statt eines grauen Schleiers über dem
  // laufenden Karussell eine ruhige eigene Ansicht — große Uhr, die
  // nächsten zwei Bahnen, wichtige Hinweise, in gedämpftem Licht. Der
  // Schleier bleibt nur für den Tiefschlaf. CONFIG.nachtModus "schleier"
  // = bisheriges Verhalten.
  const nightView = CONFIG.nachtModus === "ansicht" && dimActive && !recentlyTouched &&
    Date.now() > presenceWakeUntil && !ambientActive;
  setNightView(nightView);
  const overlayOn = nightView ? sleepActive : (dimActive || sleepActive);
  els.nightOverlay.style.setProperty("--night-dim-opacity", opacity);
  els.nightOverlay.classList.toggle("is-active", overlayOn);
}

let nightViewActive = false;

function setNightView(on) {
  const el = document.getElementById("nightView");
  if (!el) return;
  if (on !== nightViewActive) {
    nightViewActive = on;
    el.classList.toggle("is-active", on);
    el.classList.toggle("is-grau", CONFIG.nachtFarbe === "grau");
    if (on) {
      // Karussell ruht, solange niemand hinsieht — spart nachts Strom und
      // hält keine Fotos/Animationen im Speicher.
      if (carouselTimer) { clearTimeout(carouselTimer); carouselTimer = null; }
      pauseSlideshowTimers();
      jumpQuietlyTo("departures");
    } else if (!carouselTimer && !carouselIdleTimer && !panelNavOpen && !ambientActive) {
      scheduleCarousel();
    }
  }
  if (on) renderNightView();
}

// Ohne Übergangseffekte auf das Abfahrten-Panel wechseln (liegt unter der
// Nachtansicht, damit die Bühne dahinter leicht ist).
function jumpQuietlyTo(name) {
  const idx = activeSequence.indexOf(name);
  if (idx !== -1) panelIndex = idx;
  showPanel(name);
}

function renderNightView() {
  const now = new Date();
  const set = function (id, text) {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
  };
  set("nvClock", now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }));
  set("nvDate", now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }));
  const deps = (lastDepartureSnapshot || []).filter(function (d) { return d.leaveByMs && d.leaveByMs >= now.getTime() - 60000; }).slice(0, 2);
  const depText = deps.map(function (d) {
    const m = Math.max(0, Math.round((d.whenMs - now.getTime()) / 60000));
    return d.line + "  " + d.dest + "  ·  " + (m <= 0 ? "jetzt" : m + " min");
  }).join("\n");
  set("nvDeps", depText || "Keine Bahn in der nächsten Stunde");
  // Nur Wichtiges: amtliche Warnung oder HA-Hinweis der höchsten Stufe.
  let hint = "";
  const warn = window.TafelWarn ? TafelWarn.aktuelle()[0] : null;
  if (warn) hint = "⚠ " + TafelWarn.kurz(warn);
  else if (window.TafelHAUI) {
    const h = TafelHAUI.hints().filter(function (x) { return x.prio === 1; })[0];
    if (h) hint = h.text;
  }
  set("nvHint", hint);
}

// ---------- Haltestellen auflösen ----------
// BUG gefunden ("jedes Mal eine andere Verbindung beim Aktualisieren"):
// die Freitext-Suche nach CONFIG.stopQuery lieferte die Treffer in der
// Reihenfolge, in der Transitous sie zurückgibt — die ist nicht garantiert
// stabil, und es kann mehr als die erwarteten zwei "Föhrenstraße"-Treffer
// geben (z.B. andere Straßen mit ähnlichem Namen). Bisher wurden einfach
// "die ersten zwei" genommen, ungeprüft — bei jedem Neuladen konnten so
// andere, teils falsche/weiter entfernte Haltestellen ausgewählt werden,
// wodurch komplett andere Linien auftauchten. Fix: sobald die echte
// Zuhause-Adresse geokodiert ist (dieselbe wie im Pendel-Panel), nach
// Luftlinien-Entfernung dorthin sortieren (haversineMeters, schon fürs
// Gehzeit-Feature vorhanden) und die nächstgelegenen Treffer nehmen —
// deterministisch UND tatsächlich die richtigen Haltestellen vor der Tür.
function resolveStopIds() {
  if (resolvedStopIds) return Promise.resolve(resolvedStopIds);

  const url = API_BASE + "/v1/geocode?text=" + encodeURIComponent(CONFIG.stopQuery) +
    "&type=STOP&numResults=10";

  return Promise.all([
    fetch(url).then(function (res) {
      if (!res.ok) throw new Error("Haltestellensuche fehlgeschlagen (" + res.status + ")");
      return res.json();
    }),
    // Kein hartes Scheitern, falls die Adress-Geokodierung mal ausfällt —
    // dann eben ohne Entfernungssortierung, wie bisher.
    resolveCommuteCoords().catch(function () { return null; }),
  ]).then(function (results) {
    const data = results[0];
    const home = results[1] && results[1].home;

    let stops = (Array.isArray(data) ? data : []).filter(function (loc) {
      return loc && loc.id;
    });

    if (!stops.length) {
      throw new Error('Keine Haltestelle für "' + CONFIG.stopQuery + '" gefunden');
    }

    if (home) {
      stops = stops.slice().sort(function (a, b) {
        const aHasCoord = typeof a.lat === "number" && typeof a.lon === "number";
        const bHasCoord = typeof b.lat === "number" && typeof b.lon === "number";
        if (!aHasCoord) return 1;
        if (!bHasCoord) return -1;
        const da = haversineMeters(home, { lat: a.lat, lon: a.lon });
        const db = haversineMeters(home, { lat: b.lat, lon: b.lon });
        return da - db;
      });
    }

    resolvedStopIds = stops.slice(0, CONFIG.stopLimit).map(function (s) {
      return s.id;
    });

    // Koordinaten der (jetzt nächstgelegenen) ersten Haltestelle merken
    // für die Gehzeit-Berechnung.
    const first = stops[0];
    if (typeof first.lat === "number" && typeof first.lon === "number") {
      resolvedStopCoord = { lat: first.lat, lon: first.lon };
    }

    return resolvedStopIds;
  });
}

// ---------- Abfahrten laden ----------
function fetchDeparturesForStop(stopId) {
  const url = API_BASE + "/v6/stoptimes?stopId=" + encodeURIComponent(stopId) +
    "&n=" + (CONFIG.maxRows * 6) + "&arriveBy=false";

  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error("Abfahrten-Abruf fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    if (data && Array.isArray(data.stopTimes)) return data.stopTimes;
    return [];
  });
}

function passesDirectionFilter(direction) {
  const dir = (direction || "").toLowerCase();

  if (CONFIG.onlyDestinations && CONFIG.onlyDestinations.length) {
    return CONFIG.onlyDestinations.some(function (d) {
      return dir.indexOf(d.toLowerCase()) !== -1;
    });
  }

  if (CONFIG.excludeDestinations && CONFIG.excludeDestinations.length) {
    return !CONFIG.excludeDestinations.some(function (d) {
      return dir.indexOf(d.toLowerCase()) !== -1;
    });
  }

  return true;
}

function productClass(mode) {
  if (mode === "TRAM" || mode === "SUBWAY" || mode === "RAIL") return "tram";
  return "bus";
}

// ---------- Gehzeit zur Haltestelle ----------
// Einmalig berechnet (WALK-Direktroute von zuhause zur Föhrenstraße über
// Transitous — dieselbe API, dieselbe Fetch-Logik wie beim Pendel-Panel)
// und danach für die ganze Laufzeit gecacht. Daraus ergibt sich pro
// Abfahrt, bis wann man spätestens los muss — als farbige Kante an der
// Zeile (grün = entspannt, gelb = bald los, rot = eigentlich zu spät).
//
// Nutzt die präzise geokodierte homeAddress (dieselbe wie beim Pendel-
// Panel) statt der groben weatherLat/weatherLon — die waren nur für die
// Wetteranzeige gedacht und ungenau genug, um bei einer eigentlich sehr
// kurzen Strecke völlig falsche Gehzeiten zu erzeugen. Zusätzlich wird
// das Ergebnis der Routing-API gegen eine Luftlinien-Schätzung geprüft:
// liefert die API (wie beim 97-Minuten-Bus-Bug schon einmal beobachtet)
// einen unplausiblen Umweg für eine kurze Strecke, wird die Schätzung
// verwendet statt der kaputten API-Antwort.
let walkMinutesToStop = null;
let walkTimeRequested = false;

// Reisezeit Zuhause→Arbeit inkl. aller Fußwege (nicht nur bis zur
// Haltestelle) — kommt aus der ÖPNV-Reisekette, die das Pendel-Panel
// ohnehin schon berechnet (fetchTransitItinerary/itineraryDurationMin),
// wird hier nur zusätzlich für die Ankunfts-Einschätzung in der "Sollte
// ich jetzt los?"-Karte zwischengespeichert (siehe workArrivalEstimate).
let lastCommutePtMinutes = null;
let lastCommuteFirstLine = null;
// Richtung der ersten Fahrt (headsign) – an der Föhrenstraße fährt die
// Arbeitslinie in beide Richtungen, gemeint ist nur eine.
let lastCommuteFirstHeadsign = null;

function normHeadsign(t) {
  return String(t || "").toLowerCase().replace(/[^a-zäöüß0-9]/g, "");
}

// Gehört eine Abfahrt zum Arbeitsweg? Gleiche Linie wie die erste Fahrt
// der ÖPNV-Route und – wenn bekannt – gleiche Richtung.
function istArbeitsBahn(line, dest) {
  if (!lastCommuteFirstLine || line !== lastCommuteFirstLine) return false;
  if (!lastCommuteFirstHeadsign || !dest) return true;
  const a = normHeadsign(dest);
  const b = normHeadsign(lastCommuteFirstHeadsign);
  return a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = function (deg) { return deg * Math.PI / 180; };
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function estimateWalkMinutes(distanceMeters) {
  // ca. 4,5 km/h (75 m/min) zu Fuß, plus 30% Aufschlag für reale Straßen/
  // Kreuzungen statt Luftlinie.
  return Math.max(1, Math.round((distanceMeters / 75) * 1.3));
}

function resolveWalkTime() {
  if (walkMinutesToStop !== null) return Promise.resolve(walkMinutesToStop);
  if (walkTimeRequested) return Promise.resolve(null);

  walkTimeRequested = true;

  return Promise.all([resolveCommuteCoords(), resolveStopIds()]).then(function (results) {
    const coords = results[0];
    if (!coords || !coords.home || !resolvedStopCoord) return null;

    const home = coords.home;
    const distanceMeters = haversineMeters(home, resolvedStopCoord);
    const fallbackMinutes = estimateWalkMinutes(distanceMeters);

    return fetchDirectItinerary(home, resolvedStopCoord, "WALK").then(function (it) {
      const apiMinutes = itineraryDurationMin(it);
      const plausibleMax = Math.max(fallbackMinutes * 2.5, fallbackMinutes + 8);

      if (apiMinutes != null && apiMinutes <= plausibleMax) {
        walkMinutesToStop = apiMinutes;
      } else {
        console.warn(
          "Gehzeit-API wirkt unplausibel (" + apiMinutes + " min bei ~" +
          Math.round(distanceMeters) + "m Luftlinie zur Haltestelle) — nutze Schätzung."
        );
        walkMinutesToStop = fallbackMinutes;
      }
      return walkMinutesToStop;
    }).catch(function (err) {
      console.error(err);
      // Lieber eine grobe Schätzung als gar keine Gehzeit-Anzeige.
      walkMinutesToStop = fallbackMinutes;
      return walkMinutesToStop;
    });
  }).catch(function (err) {
    console.error(err);
    walkTimeRequested = false; // späterer Retry erlaubt, keine Dauer-Sperre
    return null;
  });
}

function walkUrgencyClass(minutesUntilLeave) {
  if (minutesUntilLeave === null) return "";
  if (minutesUntilLeave <= 0) return " walk-late";
  if (minutesUntilLeave <= 4) return " walk-soon";
  return " walk-ok";
}

// Schätzt, ob man mit einer Abfahrt um departureDate rechtzeitig zur
// Arbeit kommt (departureDate + komplette ÖPNV-Reisezeit inkl. Fußwege,
// siehe lastCommutePtMinutes) — nur an Werktagen relevant, und nur, wenn
// die geschätzte Ankunft überhaupt in der Nähe der Zielzeit liegt (±3h),
// sonst würde z.B. mittags eine "pünktlich für 08:00"-Meldung auftauchen,
// obwohl das für den aktuellen Weg gar keine Rolle spielt.
function workArrivalEstimate(departureDate) {
  if (lastCommutePtMinutes == null || !CONFIG.workArrivalTarget) return null;
  const day = departureDate.getDay();
  if (day === 0 || day === 6) return null;
  if (holidayOn(departureDate)) return null; // Feiertag: kein Arbeitsweg (D19)

  const parts = CONFIG.workArrivalTarget.split(":");
  const targetDate = new Date(departureDate);
  targetDate.setHours(parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0, 0, 0);

  const arrivalDate = new Date(departureDate.getTime() + lastCommutePtMinutes * 60000);
  const diffMin = Math.round((targetDate.getTime() - arrivalDate.getTime()) / 60000);
  if (Math.abs(diffMin) > 180) return null;

  return { arrivalDate: arrivalDate, diffMin: diffMin };
}

// "Sollte ich jetzt los?"-Kopfzeile überm Abfahrten-Board: statt drei
// Panels (Wetter/Pendel/Abfahrten) einzeln durchzuschauen und selbst
// zusammenzurechnen, eine einzige Handlungsempfehlung aus dem, was die
// Tafel eh schon weiß — nächste erreichbare Abfahrt (samt echter
// Gehzeit-Berechnung, siehe resolveWalkTime) plus minutengenauer Regen-
// Hinweis aus dem Wetter-Abruf (siehe rainStartMinutes). Nur echte
// Synthese aus bereits vorhandenen Daten, kein zusätzlicher API-Aufruf.
function renderLeaveNowBanner(soonestDep, now) {
  if (!els.leaveNowBanner) return;
  els.leaveNowBanner.innerHTML = "";
  els.leaveNowBanner.classList.remove("is-visible", "is-urgent");

  if (!soonestDep || walkMinutesToStop == null) return;

  const place = soonestDep.place || {};
  const when = place.departure || place.scheduledDeparture;
  if (!when) return;

  const whenDate = new Date(when);
  const leaveByMs = whenDate.getTime() - walkMinutesToStop * 60000;
  const minutesUntilLeave = Math.round((leaveByMs - now) / 60000);

  const headline = document.createElement("div");
  headline.className = "leave-now-headline";
  headline.textContent = minutesUntilLeave <= 0
    ? "🚪 Geh jetzt los!"
    : "🚪 Geh in " + minutesUntilLeave + (minutesUntilLeave === 1 ? " Minute los" : " Minuten los");

  const lineName = soonestDep.routeShortName || soonestDep.tripShortName || soonestDep.displayName || "?";
  const dest = soonestDep.headsign || "";
  const timeStr = whenDate.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  // Regen nur erwähnen, wenn er auch wirklich zum Gehzeitpunkt passt — mit
  // 15 Minuten Sicherheitsabstand, für den Fall dass man noch etwas
  // trödelt. Regnet's erst in drei Stunden, ist das für DIESEN Weg
  // irrelevant und bleibt unerwähnt statt unnötig zu verunsichern.
  let rainHint = "";
  if (rainStartMinutes != null && rainStartMinutes <= minutesUntilLeave + walkMinutesToStop + 15) {
    rainHint = rainStartMinutes <= 0
      ? " · ☔ Es regnet schon"
      : " · ☔ In " + rainStartMinutes + " Min fängt's an zu regnen";
  }

  const sub = document.createElement("div");
  sub.className = "leave-now-sub";
  sub.textContent = "Linie " + lineName + (dest ? " nach " + dest : "") + " · ab " + timeStr + rainHint;

  els.leaveNowBanner.appendChild(headline);
  els.leaveNowBanner.appendChild(sub);

  // Ankunft bei der Arbeit nur, wenn mit dieser Linie auch der Arbeitsweg
  // beginnt (wie die Markierung in der Zeile, IDEEN A3).
  const workEstimate = (!lastCommuteFirstLine || istArbeitsBahn(lineName, dest)) ? workArrivalEstimate(whenDate) : null;
  if (workEstimate) {
    const arrivalStr = workEstimate.arrivalDate.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const arrivalLine = document.createElement("div");
    arrivalLine.className = "leave-now-arrival" + (workEstimate.diffMin < 0 ? " is-late" : "");
    arrivalLine.textContent = (workEstimate.diffMin < 0 ? "⚠️ Ankunft ca. " : "✅ Ankunft ca. ") +
      arrivalStr + " bei der Arbeit" +
      (workEstimate.diffMin < 0
        ? " · " + Math.abs(workEstimate.diffMin) + " Min zu spät für " + CONFIG.workArrivalTarget
        : " · rechtzeitig für " + CONFIG.workArrivalTarget);
    els.leaveNowBanner.appendChild(arrivalLine);
  }

  els.leaveNowBanner.classList.add("is-visible");
  els.leaveNowBanner.classList.toggle("is-urgent", minutesUntilLeave <= 2);
  // Gleicher ablaufender Balken wie in der Pille (Variante "zeile").
  const bar = document.createElement("span");
  bar.className = "leave-now-bar";
  els.leaveNowBanner.appendChild(bar);
  updatePillBar(bar, leaveByMs + 30000, now);
}

// ---------- Abfahrtstafel (IDEEN A1/A2/A4) ----------
// Zeilen werden nicht mehr bei jedem Abruf komplett neu gebaut, sondern
// über einen Schlüssel (Fahrt + Plan-Abfahrt) wiederverwendet: so kann
// eine abgefahrene Bahn nach oben hinausgleiten, die anderen rücken weich
// nach (FLIP: alte Position merken, neu anordnen, Differenz per transform
// zurückrechnen und auf 0 animieren), und bei den Minuten rollt nur die
// Ziffer, die sich wirklich ändert.
const depRowEls = {};

function depKey(dep) {
  const place = dep.place || {};
  return (dep.tripId || dep.routeShortName || "?") + "|" + (place.scheduledDeparture || place.departure || "");
}

// Text in Ziffern-Spans halten; nur geänderte Stellen rollen neu ein.
function setRollingText(el, text) {
  if (el._text === text) return;
  const old = el._text || "";
  el._text = text;
  if (old.length !== text.length) {
    el.innerHTML = "";
    for (let i = 0; i < text.length; i++) {
      const sp = document.createElement("span");
      sp.className = "dep-digit";
      sp.textContent = text.charAt(i);
      el.appendChild(sp);
    }
    return;
  }
  for (let i = 0; i < text.length; i++) {
    if (old.charAt(i) === text.charAt(i)) continue;
    const sp = el.children[i];
    sp.textContent = text.charAt(i);
    sp.classList.remove("is-rolling");
    void sp.offsetWidth;
    sp.classList.add("is-rolling");
  }
}

function clearDepartureRows(message) {
  Object.keys(depRowEls).forEach(function (k) { delete depRowEls[k]; });
  els.rows.innerHTML = "";
  const div = document.createElement("div");
  div.className = "row placeholder";
  div.textContent = message;
  els.rows.appendChild(div);
}

function buildDepartureRow() {
  const row = document.createElement("div");
  row.className = "row dep-row";
  row.innerHTML =
    '<span class="line-badge dep-badge"></span>' +
    '<span class="dest-wrap"><span class="dest"></span><span class="walk-hint dep-sub"></span><span class="dep-work"></span></span>' +
    '<span class="dep-pill"><span class="dep-pill-text"></span><span class="dep-pill-bar"></span></span>' +
    '<span class="time-cell"><span class="time-min"><span class="dep-min"></span><span class="dep-unit">min</span></span>' +
    '<span class="time-clock"><s class="dep-planned"></s><span class="dep-actual"></span><span class="dep-delay"></span></span></span>';
  return row;
}

function renderDepartures(departures) {
  const now = Date.now();
  const style = (CONFIG.abfahrtenDringlichkeit || "zeile");
  els.rows.classList.toggle("is-banner-variant", style === "banner");

  if (!departures.length) {
    clearDepartureRows("Keine Abfahrten in den nächsten 60 Minuten");
    renderLeaveNowBanner(null, now);
    lastDepartureSnapshot = [];
    return;
  }

  // Ist die Gehzeit bekannt: Abfahrten rausfiltern, die eh nicht mehr zu
  // schaffen sind (mehr als 1 Minute "zu spät los") — weniger, aber
  // tatsächlich planbare Zeilen statt einer Liste voller "zu spät".
  let visible = departures;
  if (walkMinutesToStop != null) {
    visible = departures.filter(function (dep) {
      if (dep.cancelled || dep.tripCancelled) return true; // Ausfälle immer anzeigen
      const place = dep.place || {};
      const when = place.departure || place.scheduledDeparture;
      if (!when) return true;
      const leaveByMs = new Date(when).getTime() - walkMinutesToStop * 60000;
      return Math.round((leaveByMs - now) / 60000) > -1;
    });
  }

  if (!visible.length) {
    clearDepartureRows("Gerade keine erreichbare Abfahrt — nächste in Kürze");
    renderLeaveNowBanner(null, now);
    lastDepartureSnapshot = [];
    return;
  }

  const firstReachable = visible.filter(function (d) { return !d.cancelled && !d.tripCancelled; })[0];
  // Variante "banner": Handlungsaufforderung oben (kompakt); Variante
  // "zeile": direkt in der Zeile der nächsten erreichbaren Bahn.
  renderLeaveNowBanner(style === "banner" ? firstReachable : null, now);

  lastDepartureSnapshot = visible.filter(function (d) { return !d.cancelled && !d.tripCancelled; }).slice(0, 16).map(function (dep) {
    const place = dep.place || {};
    const when = place.departure || place.scheduledDeparture;
    const whenMs = when ? new Date(when).getTime() : null;
    return {
      line: dep.routeShortName || dep.tripShortName || dep.displayName || "?",
      dest: dep.headsign || "",
      whenMs: whenMs,
      clock: whenMs ? new Date(whenMs).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "",
      leaveByMs: whenMs && walkMinutesToStop != null ? whenMs - walkMinutesToStop * 60000 : whenMs,
      color: dep.routeColor || null,
      textColor: dep.routeTextColor || null,
    };
  });

  // Mit Banner passen nur 4 Zeilen sauber unter den Kopf.
  const shown = visible.slice(0, style === "banner" ? Math.min(4, CONFIG.maxRows) : CONFIG.maxRows);

  // FLIP, Schritt 1: alte Positionen merken.
  const oldTops = {};
  const panelVisible = els.rows.offsetParent !== null;
  Object.keys(depRowEls).forEach(function (k) {
    if (panelVisible) oldTops[k] = depRowEls[k].getBoundingClientRect().top;
  });

  const wanted = {};
  const ordered = [];
  shown.forEach(function (dep) {
    const key = depKey(dep);
    wanted[key] = true;
    let row = depRowEls[key];
    const isNew = !row;
    if (isNew) {
      row = buildDepartureRow();
      depRowEls[key] = row;
    }
    updateDepartureRow(row, dep, now, dep === firstReachable && style === "zeile");
    ordered.push({ key: key, row: row, isNew: isNew });
  });

  // Abgefahrene/verschwundene Zeilen: gleiten nach oben hinaus und werden
  // danach entfernt (absolut positioniert, damit die anderen schon
  // nachrücken können).
  const containerTop = panelVisible ? els.rows.getBoundingClientRect().top : 0;
  Object.keys(depRowEls).forEach(function (k) {
    if (wanted[k]) return;
    const row = depRowEls[k];
    delete depRowEls[k];
    if (!panelVisible || !row.parentNode) {
      if (row.parentNode) row.parentNode.removeChild(row);
      return;
    }
    const r = row.getBoundingClientRect();
    row.style.position = "absolute";
    row.style.left = "0";
    row.style.right = "0";
    row.style.top = (r.top - containerTop) + "px";
    row.classList.add("is-leaving");
    setTimeout(function () { if (row.parentNode) row.parentNode.removeChild(row); }, 500);
  });

  // Platzhalter entfernen, Zeilen in neuer Reihenfolge einsetzen.
  const placeholder = els.rows.querySelector(".row.placeholder");
  if (placeholder) placeholder.parentNode.removeChild(placeholder);
  ordered.forEach(function (o) {
    els.rows.appendChild(o.row);
    const bar = o.row.querySelector(".dep-pill-bar");
    if (bar._pending != null) {
      const end = bar._pending;
      bar._pending = null;
      updatePillBar(bar, end, now);
    }
  });

  // FLIP, Schritt 2: Differenz zurückrechnen und weich auf 0 laufen lassen.
  if (!panelVisible) return;
  ordered.forEach(function (o) {
    const row = o.row;
    if (o.isNew) {
      row.classList.add("is-entering");
      void row.offsetWidth;
      row.classList.remove("is-entering");
      return;
    }
    const before = oldTops[o.key];
    if (before == null) return;
    const delta = before - row.getBoundingClientRect().top;
    if (Math.abs(delta) < 1) return;
    row.style.transition = "none";
    row.style.transform = "translateY(" + delta + "px)";
    void row.offsetWidth;
    row.style.transition = "";
    row.style.transform = "";
  });
}

// Balken läuft linear ab (transform: scaleX). Volle Länge = 5 Minuten
// Restzeit; die Pille erscheint 4½ Minuten vor "Los bis". Bei jedem Abruf
// (alle 30 s) wird er auf den aktuellen Stand gesetzt und läuft von dort
// weiter – ohne sichtbaren Sprung, aber selbstheilend, falls WebKit eine
// lange Transition verwirft (passiert beim ersten Zeichnen nach dem Laden).
const PILL_BAR_SPAN_MS = 5 * 60 * 1000;

// Fahrtziel für die Anzeige (Daten bleiben unverändert – istArbeitsBahn
// vergleicht weiter das Original): "via …" und "/ 39 Weserpark-Süd"
// (Weiterfahrt als andere Linie) wandern in die Unterzeile, "Bremen "
// vor Zielen in der eigenen Stadt fällt weg, "Bahnhof" → "Bf",
// Klammerzusätze ("Otterstedt(Ottersberg) Nord") entfallen. Vorher wurden
// lange Ziele mitten im Wort abgeschnitten ("Weidedamm-Süd via Strese…").
function zielAnzeige(headsign) {
  let haupt = String(headsign || "").trim();
  let zusatz = "";
  const via = /^(.+?)\s+via\s+(.+)$/i.exec(haupt);
  if (via) { haupt = via[1]; zusatz = "via " + via[2]; }
  const weiter = /^(.+?)\s*\/\s*(\d+[A-Za-z]?\s+\S.*)$/.exec(haupt);
  if (weiter) { haupt = weiter[1]; zusatz = "weiter als " + weiter[2]; }
  const stadt = String(CONFIG.stopQuery || "").split(",")[1];
  const st = stadt ? stadt.trim() : "";
  if (st && haupt.indexOf(st + " ") === 0 && haupt.length > st.length + 4) haupt = haupt.slice(st.length + 1);
  haupt = haupt.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\bBahnhof\b/g, "Bf").replace(/\s+/g, " ").trim();
  return { haupt: haupt || String(headsign || ""), zusatz: zusatz };
}

// Sehr dunkle Linienfarben (z. B. die 23) verschwinden fast auf der
// dunklen Karte – solche Schilder bekommen einen feinen hellen Rand.
function istDunkleFarbe(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
  if (!m) return false;
  const lin = function (h) { const c = parseInt(h, 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]) < 0.035;
}

function updatePillBar(bar, endMs, now) {
  // Eine Transition startet nur an einem Element im Dokument – neue Zeilen
  // holen das nach dem Einsetzen nach (renderDepartures).
  if (!document.documentElement.contains(bar)) { bar._pending = endMs; return; }
  if (bar._raf) { cancelAnimationFrame(bar._raf); bar._raf = 0; }
  bar.style.transition = "none";
  if (!endMs) { bar.style.transform = "scaleX(0)"; return; }
  bar.style.transform = "scaleX(" + Math.min(1, Math.max(0, endMs - now) / PILL_BAR_SPAN_MS).toFixed(4) + ")";
  // Ablaufen erst zwei Frames später starten, wenn der Startwert sicher
  // gezeichnet ist.
  bar._raf = requestAnimationFrame(function () {
    bar._raf = requestAnimationFrame(function () {
      bar._raf = 0;
      const left = Math.max(0, endMs - Date.now());
      const tempo = (window.debugZeit && window.debugZeit.tempo) || 1;
      bar.style.transition = "transform " + Math.round(left / tempo) + "ms linear";
      bar.style.transform = "scaleX(0)";
    });
  });
}

function updateDepartureRow(row, dep, now, isNext) {
  const place = dep.place || {};
  const when = place.departure || place.scheduledDeparture;
  const scheduled = place.scheduledDeparture;
  const whenDate = when ? new Date(when) : null;
  const minutes = whenDate ? Math.round((whenDate.getTime() - now) / 60000) : null;
  const cancelled = !!(dep.cancelled || dep.tripCancelled);

  let minutesUntilLeave = null;
  if (walkMinutesToStop != null && whenDate) {
    minutesUntilLeave = Math.round((whenDate.getTime() - walkMinutesToStop * 60000 - now) / 60000);
  }

  row.className = "row dep-row" + walkUrgencyClass(minutesUntilLeave) +
    (isNext ? " is-next" : "") + (cancelled ? " is-cancelled" : "") +
    (row.classList.contains("is-leaving") ? " is-leaving" : "");

  // Linie: echte Linienfarbe aus Transitous (Trams), sonst neutral.
  const badge = row.querySelector(".dep-badge");
  const lineName = dep.routeShortName || dep.tripShortName || dep.displayName || "?";
  if (badge.textContent !== lineName) badge.textContent = lineName;
  badge.className = "line-badge dep-badge " + productClass(dep.mode) + (dep.routeColor ? " has-color" : "") +
    (istDunkleFarbe(dep.routeColor) ? " is-dunkel" : "");
  badge.style.background = dep.routeColor ? "#" + dep.routeColor : "";
  badge.style.color = dep.routeColor ? "#" + (dep.routeTextColor || "ffffff") : "";

  const ziel = zielAnzeige(dep.headsign);
  row.querySelector(".dest").textContent = cancelled ? ziel.haupt + " (fällt aus)" : (ziel.haupt || "—");

  // Unterzeile: "Los bis …"; bei der nächsten Bahn zusätzlich Regen und
  // Ankunft bei der Arbeit (was früher im Banner stand).
  const subParts = [];
  if (ziel.zusatz) subParts.push(ziel.zusatz);
  if (minutesUntilLeave != null && !cancelled) {
    subParts.push("Los bis " + new Date(whenDate.getTime() - walkMinutesToStop * 60000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }));
  }
  if (isNext && rainStartMinutes != null && minutesUntilLeave != null &&
      rainStartMinutes <= minutesUntilLeave + walkMinutesToStop + 15) {
    subParts.push(rainStartMinutes <= 0 ? "☔ es regnet" : "☔ Regen in " + rainStartMinutes + " Min");
  }
  // Störungsmeldungen, falls Transitous sie an der Abfahrt mitliefert
  // (GTFS-RT Service Alerts; BSAG/VBN haben keine offene Quelle, D20).
  const alertsList = (place.alerts || dep.alerts || []);
  if (alertsList.length && alertsList[0].headerText) subParts.unshift("⚠ " + alertsList[0].headerText);
  // Ankunft bei der Arbeit nur, solange unbekannt ist, welche Linie
  // dorthin fährt — sonst übernimmt die Markierung an der richtigen Linie
  // (vorher stand "Arbeit 07:48" auch bei Linien in die Gegenrichtung).
  if (isNext && whenDate && !lastCommuteFirstLine) {
    const est = workArrivalEstimate(whenDate);
    if (est) {
      subParts.push((est.diffMin < 0 ? "⚠ Arbeit " : "Arbeit ") +
        est.arrivalDate.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) +
        (est.diffMin < 0 ? " (" + Math.abs(est.diffMin) + " Min zu spät)" : ""));
    }
  }
  row.querySelector(".dep-sub").textContent = subParts.join(" · ");

  // "Zur Arbeit"-Markierung (IDEEN A3): werktags 6–9 Uhr bekommt die
  // Linie, mit der die ÖPNV-Route zur Arbeit beginnt, eine Aktentasche
  // und die geschätzte Ankunft.
  const work = row.querySelector(".dep-work");
  let workHtml = "";
  const nowD = new Date(now);
  if (lastCommuteFirstLine && whenDate && !cancelled && istArbeitsBahn(lineName, dep.headsign) &&
      nowD.getHours() >= 6 && nowD.getHours() < 9 && isCommuteTime(nowD)) {
    const estW = workArrivalEstimate(whenDate);
    if (estW) {
      workHtml = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="7.5" width="18" height="12.5" rx="2"/><path d="M8.5 7.5V5.5c0-.6.4-1 1-1h5c.6 0 1 .4 1 1v2M3 12.5h18"/></svg>' +
        "Arbeit an " + estW.arrivalDate.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    }
  }
  if (work._html !== workHtml) { work._html = workHtml; work.innerHTML = workHtml; }

  // Dringlichkeit als Pille in der Zeile der nächsten Bahn.
  const pill = row.querySelector(".dep-pill");
  let pillText = "";
  let pillCls = "dep-pill";
  if (isNext && minutesUntilLeave != null && !cancelled) {
    if (minutesUntilLeave <= 0) { pillText = "LOS!"; pillCls += " is-now"; }
    else if (minutesUntilLeave <= 4) { pillText = "in " + minutesUntilLeave + " min los"; pillCls += " is-soon"; }
  }
  pill.firstChild.textContent = pillText;
  pill.className = pillCls + (pillText ? " is-shown" : "");
  // Ablaufender Balken: so viel Zeit bleibt noch, um diese Bahn zu
  // schaffen – bis 30 s nach "Los bis", dann verschwindet die Zeile.
  updatePillBar(pill.lastChild, pillText && whenDate ? whenDate.getTime() - walkMinutesToStop * 60000 + 30000 : 0, now);

  // Minuten: Fern-Info, nur geänderte Ziffern rollen.
  const minEl = row.querySelector(".dep-min");
  const unit = row.querySelector(".dep-unit");
  if (minutes === null) { setRollingText(minEl, "–"); unit.style.display = "none"; }
  else if (minutes <= 0) { setRollingText(minEl, "jetzt"); unit.style.display = "none"; }
  else { setRollingText(minEl, String(minutes)); unit.style.display = ""; }
  row.querySelector(".time-min").classList.toggle("now", minutes !== null && minutes <= 0);

  // Uhrzeit; Verspätung: Plan durchgestrichen + "+3" in Warnfarbe.
  const delaySec = (when && scheduled && when !== scheduled)
    ? Math.round((new Date(when).getTime() - new Date(scheduled).getTime()) / 1000) : 0;
  const delayMin = Math.round(delaySec / 60);
  const planned = row.querySelector(".dep-planned");
  const actual = row.querySelector(".dep-actual");
  const delay = row.querySelector(".dep-delay");
  const fmt = function (d) { return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }); };
  if (whenDate && delayMin >= 1 && scheduled) {
    planned.textContent = fmt(new Date(scheduled));
    actual.textContent = fmt(whenDate);
    delay.textContent = "+" + delayMin;
  } else {
    planned.textContent = "";
    actual.textContent = whenDate ? fmt(whenDate) : "";
    delay.textContent = "";
  }
}

let consecutiveFailures = 0;

function updateDepartures() {
  resolveStopIds().then(function (stopIds) {
    return Promise.all(stopIds.map(fetchDeparturesForStop));
  }).then(function (results) {
    let all = [].concat.apply([], results);

    all = all.filter(function (dep) {
      return passesDirectionFilter(dep.headsign);
    });

    const seen = {};
    all = all.filter(function (dep) {
      const place = dep.place || {};
      const key = (dep.tripId || dep.routeShortName) + "-" + (place.departure || place.scheduledDeparture);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });

    all.sort(function (a, b) {
      const pa = a.place || {};
      const pb = b.place || {};
      const ta = new Date(pa.departure || pa.scheduledDeparture).getTime();
      const tb = new Date(pb.departure || pb.scheduledDeparture).getTime();
      return ta - tb;
    });

    consecutiveFailures = 0;
    markFresh("departures");
    renderDepartures(all);
    // Morgens die Bahn zur Arbeit vorab holen lassen (Tagesblick), damit
    // der Morgengruß bei der ersten Bewegung schon die echte Bahn kennt.
    const hNow = new Date().getHours();
    if (hNow >= 4 && hNow < 10) arbeitsBahnHeute();
    els.status.textContent = "Live · Daten von Transitous";
    els.lastUpdate.textContent = "Aktualisiert " + new Date().toLocaleTimeString("de-DE");
  }).catch(function (err) {
    console.error(err);
    consecutiveFailures += 1;
    els.status.textContent = "Datenquelle gerade nicht erreichbar — versuche automatisch weiter (" +
      consecutiveFailures + ". Versuch, " + new Date().toLocaleTimeString("de-DE") + ")";
    if (consecutiveFailures <= 20) {
      setTimeout(updateDepartures, 10000);
    }
  });
}

// ---------- Wetter ----------
// Open-Meteo liefert Zeitstempel (hourly.time, daily.sunrise/sunset) mit
// &timezone=Europe%2FBerlin als lokale Bremer Wanduhrzeit OHNE Zeitzonen-
// Suffix, z.B. "2026-07-20T05:23" (kein "Z", kein Offset). Safari 12 /
// altes WebKit parst so einen Date-String beim new Date(...) fälschlich
// als UTC statt als lokale Zeit (moderne Engines folgen hier korrekt der
// ES2015-Spec und nehmen lokale Zeit) — Ergebnis war ein konstanter
// 2-Stunden-Versatz im Sommer (CEST = UTC+2), z.B. Sonnenaufgang
// "05:23" wurde als "07:23" angezeigt. Fix: Datum/Uhrzeit von Hand aus
// dem String lesen und über den numerischen Date-Konstruktor bauen
// (new Date(Jahr, Monat, Tag, Std, Min) wird von JEDER Engine garantiert
// als lokale Zeit interpretiert, kein Parsing-Spielraum mehr).
function parseOpenMeteoLocal(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || "");
  if (!m) return new Date(iso);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

const WEATHER_CODES = {
  0: ["☀️", "Klar"],
  1: ["🌤️", "Überwiegend klar"],
  2: ["⛅", "Teilweise bewölkt"],
  3: ["☁️", "Bedeckt"],
  45: ["🌫️", "Nebel"],
  48: ["🌫️", "Nebel"],
  51: ["🌦️", "Nieselregen"],
  53: ["🌦️", "Nieselregen"],
  55: ["🌦️", "Nieselregen"],
  61: ["🌧️", "Regen"],
  63: ["🌧️", "Regen"],
  65: ["🌧️", "Starker Regen"],
  71: ["🌨️", "Schnee"],
  73: ["🌨️", "Schnee"],
  75: ["❄️", "Starker Schnee"],
  80: ["🌦️", "Schauer"],
  81: ["🌧️", "Schauer"],
  82: ["⛈️", "Starke Schauer"],
  95: ["⛈️", "Gewitter"],
  96: ["⛈️", "Gewitter mit Hagel"],
  99: ["⛈️", "Gewitter mit Hagel"],
};

const RAIN_CODES = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99];

// Wird von updateWeather() gesetzt, vom Abfahrten-Panel gelesen (siehe
// renderLeaveNowBanner) — Minuten bis zum ersten 15-Minuten-Intervall mit
// Niederschlag (0 oder negativ = regnet schon), null = kein Regen in den
// nächsten 3 Stunden in Sicht. Minutengenau statt nur stundengenau, damit
// die "Sollte ich jetzt los?"-Karte einen echten Countdown zeigen kann.
let rainStartMinutes = null;
// Kurzfassung der zuletzt geladenen Daten für Begrüßung/Vorschläge
// (siehe tafelSnapshot weiter unten, lernen.js, ha-panels.js).
let lastWeatherSnapshot = null;
let lastDepartureSnapshot = [];
let lastCalendarEvents = [];

// ---------- Wetter-Icons als eigene SVGs statt Emoji ----------
// Emoji-Wettericons (☀️🌧️🌙 …) rendern je nach Gerät/Systemschriftart
// unterschiedlich und wirken bei 138px Größe wie Sticker aus einer Kinder-
// App statt wie ein eigenständig gestaltetes Wetter-Display. Eigene, ruhige
// Vektor-Icons in einer einzigen Formsprache (Kreise/Linien, keine
// Emoji-Buntheit) — sieben Kategorien, exakt dieselben wie
// weatherFxCategory() weiter unten (dieselbe Funktion klassifiziert jetzt
// sowohl den Hintergrund als auch das Icon, damit beide nie auseinanderlaufen).
function cloudShapeSvg(fill, cx, cyBase) {
  cx = cx == null ? 50 : cx;
  cyBase = cyBase == null ? 58 : cyBase;
  return '<ellipse cx="' + cx + '" cy="' + (cyBase + 6) + '" rx="30" ry="15" fill="' + fill + '"/>' +
    '<circle cx="' + (cx - 20) + '" cy="' + (cyBase - 6) + '" r="13" fill="' + fill + '"/>' +
    '<circle cx="' + cx + '" cy="' + (cyBase - 14) + '" r="17" fill="' + fill + '"/>' +
    '<circle cx="' + (cx + 19) + '" cy="' + (cyBase - 4) + '" r="12" fill="' + fill + '"/>';
}

function sparkleSvg(cx, cy, scale, fill) {
  scale = scale || 1;
  return '<g transform="translate(' + cx + ',' + cy + ') scale(' + scale + ')">' +
    '<path fill="' + fill + '" d="M0,-11 C1.2,-2.5 2.5,-1.2 11,0 C2.5,1.2 1.2,2.5 0,11 C-1.2,2.5 -2.5,1.2 -11,0 C-2.5,-1.2 -1.2,-2.5 0,-11 Z"/>' +
    '</g>';
}

function raindropLinesSvg(color) {
  return '<line x1="36" y1="80" x2="31" y2="93" stroke="' + color + '" stroke-width="5" stroke-linecap="round"/>' +
    '<line x1="52" y1="82" x2="47" y2="95" stroke="' + color + '" stroke-width="5" stroke-linecap="round"/>' +
    '<line x1="68" y1="80" x2="63" y2="93" stroke="' + color + '" stroke-width="5" stroke-linecap="round"/>';
}

function snowflakeSvg(cx, cy, r, color) {
  let out = "";
  for (let a = 0; a < 180; a += 60) {
    const rad = a * Math.PI / 180;
    const dx = Math.cos(rad) * r;
    const dy = Math.sin(rad) * r;
    out += '<line x1="' + (cx - dx) + '" y1="' + (cy - dy) + '" x2="' + (cx + dx) + '" y2="' + (cy + dy) +
      '" stroke="' + color + '" stroke-width="3.5" stroke-linecap="round"/>';
  }
  return out;
}

function fogLinesSvg(color) {
  return '<line x1="18" y1="34" x2="82" y2="34" stroke="' + color + '" stroke-width="6" stroke-linecap="round" opacity="0.9"/>' +
    '<line x1="26" y1="50" x2="74" y2="50" stroke="' + color + '" stroke-width="6" stroke-linecap="round" opacity="0.7"/>' +
    '<line x1="16" y1="66" x2="84" y2="66" stroke="' + color + '" stroke-width="6" stroke-linecap="round" opacity="0.85"/>' +
    '<line x1="30" y1="82" x2="70" y2="82" stroke="' + color + '" stroke-width="6" stroke-linecap="round" opacity="0.6"/>';
}

// Acht Sonnenstrahlen, fest vorgerechnet (innerer Radius 27, äußerer 40 um
// Mittelpunkt 50,50) statt zur Laufzeit Sinus/Cosinus zu rechnen.
function sunSvg() {
  return '<circle cx="50" cy="50" r="21" fill="#ffc55c"/>' +
    '<g stroke="#ffc55c" stroke-width="6" stroke-linecap="round">' +
    '<line x1="77" y1="50" x2="90" y2="50"/>' +
    '<line x1="69.1" y1="69.1" x2="78.3" y2="78.3"/>' +
    '<line x1="50" y1="77" x2="50" y2="90"/>' +
    '<line x1="30.9" y1="69.1" x2="21.7" y2="78.3"/>' +
    '<line x1="23" y1="50" x2="10" y2="50"/>' +
    '<line x1="30.9" y1="30.9" x2="21.7" y2="21.7"/>' +
    '<line x1="50" y1="23" x2="50" y2="10"/>' +
    '<line x1="69.1" y1="30.9" x2="78.3" y2="21.7"/>' +
    '</g>';
}

// Mondsichel als zwei vollständige Kreise (jeweils über die eigenen
// Pole gezeichnet, das ist für JEDEN Radius ein gültiger Bogen) statt
// einem einzelnen Pfad mit zwei unterschiedlichen Radien über dieselben
// Endpunkte — DAS war der eigentliche Bug in der ersten Version: die
// beiden Endpunkte lagen 60 Einheiten auseinander, der "innere" Bogen
// hatte aber nur Radius 21 (Durchmesser 42 < 60) und war damit geometrisch
// unmöglich. Browser korrigieren einen zu kleinen Bogenradius automatisch
// hoch, aber nicht auf den beabsichtigten Wert — die Sichel blieb dadurch
// unsichtbar/falsch geformt.
// Jetzt: Kreis B (der "Biss") liegt komplett innerhalb von Kreis A (der
// Mondscheibe) — bei vollständig enthaltenen Kreisen liefert fill-rule
// evenodd zuverlässig eine echte Sichel, unabhängig von den genauen
// Radien/Radien-Bögen.
function moonSvg() {
  return '<path fill-rule="evenodd" fill="#f4e6b8" d="' +
    'M50,23 A27,27 0 1,0 50,77 A27,27 0 1,0 50,23 ' +
    'M56,27 A18,18 0 1,0 56,63 A18,18 0 1,0 56,27 Z"/>' +
    sparkleSvg(80, 30, 0.6, "#fff6da") +
    sparkleSvg(24, 66, 0.4, "#fff6da");
}

const WEATHER_ICON_SVG = {
  sun: sunSvg(),
  night: moonSvg(),
  cloud: cloudShapeSvg("#c7d0d9", 52, 62) + cloudShapeSvg("#f4f7f9", 47, 52),
  rain: cloudShapeSvg("#b9c4d0", 50, 46) + raindropLinesSvg("#8fb8e0"),
  snow: cloudShapeSvg("#c7d0d9", 50, 46) + snowflakeSvg(36, 87, 7, "#ffffff") +
    snowflakeSvg(52, 91, 7, "#ffffff") + snowflakeSvg(68, 87, 7, "#ffffff"),
  fog: fogLinesSvg("#dbe2e8"),
  storm: cloudShapeSvg("#7c8797", 50, 44) +
    '<path fill="#ffcc4d" d="M58,52 L44,76 L53,76 L41,94 L67,68 L54,68 Z"/>',
};

// weatherFxCategory() (weiter unten) klassifiziert Code+Tag/Nacht schon für
// den Himmel-Hintergrund in exakt diese sieben Kategorien — hier
// wiederverwendet, damit Icon und Hintergrund garantiert immer zusammenpassen.
function weatherIconMarkup(code, isDay) {
  const category = weatherFxCategory(code, isDay) || "cloud";
  const inner = WEATHER_ICON_SVG[category] || WEATHER_ICON_SVG.cloud;
  return '<svg viewBox="0 0 100 100" aria-hidden="true">' + inner + '</svg>';
}

// Konkrete Handlungs-Tipps statt bloßer Zahlen — genau das, was einem
// vorm Rausgehen wirklich hilft. Schaut in die nächsten 12 Stunden nach
// Regen (Schirm/Auto-Tipp, oder nachts: Fenster zu) und rät sonst bei
// rundum angenehmem Wetter zum Lüften. Immer nur EIN Tipp gleichzeitig,
// nach Dringlichkeit sortiert (Regen schlägt Lüften-Hinweis).
function buildWeatherTip(hourlyTime, hourlyCode, hourlyTemp, startIdx, currentCode) {
  const commuteHour = CONFIG.commuteTypicalDepartTime
    ? parseInt(CONFIG.commuteTypicalDepartTime.split(":")[0], 10)
    : null;

  for (let i = startIdx; i < Math.min(startIdx + 12, hourlyTime.length); i++) {
    if (RAIN_CODES.indexOf(hourlyCode[i]) === -1) continue;

    const hDate = parseOpenMeteoLocal(hourlyTime[i]);
    const hHour = hDate.getHours();
    const isNight = hHour >= 22 || hHour < 6;
    const hTimeStr = hDate.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

    if (isNight) {
      return "🪟 Heute Nacht regnet's — Fenster rechtzeitig schließen.";
    }
    if (commuteHour != null && hHour === commuteHour) {
      return "🚗 Gegen " + hTimeStr + " Uhr regnet's — für den Arbeitsweg lieber Auto oder Bus.";
    }
    return "☔ Gegen " + hTimeStr + " Uhr wird's nass — Regenschirm einpacken.";
  }

  const niceNow = [0, 1, 2].indexOf(currentCode) !== -1;
  const tempNow = hourlyTemp[startIdx];
  if (niceNow && tempNow != null && tempNow >= 14 && tempNow <= 26) {
    return "🌬️ Schönes Wetter gerade — gute Gelegenheit zum Lüften.";
  }

  return null;
}

// Dezente Wetter-Animation: ein paar Regentropfen/Wolkenformen als reine
// CSS-Transform/Opacity-Animationen (keine Partikel-Flut, GPU-billig) —
// bewusst zurückhaltend gehalten für sichere Performance auf dem alten
// iPad Air 1. Werden einmalig gebaut und danach nur per Klasse auf
// .weather-big ein-/ausgeblendet (kein DOM-Neubau bei jedem Update).
let weatherFxBuilt = false;

// isDay kommt von Open-Meteos "is_day"-Feld (0/1) — nur für Codes 0/1
// relevant, die sowohl tagsüber ("sonnig") als auch nachts ("klar")
// auftreten können.
function weatherFxCategory(code, isDay) {
  if ([95, 96, 99].indexOf(code) !== -1) return "storm";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].indexOf(code) !== -1) return "rain";
  if ([71, 73, 75].indexOf(code) !== -1) return "snow";
  if ([45, 48].indexOf(code) !== -1) return "fog";
  if ([2, 3].indexOf(code) !== -1) return "cloud";
  if ([0, 1].indexOf(code) !== -1) return isDay === false ? "night" : "sun";
  return null;
}

const WEATHER_FX_CATEGORIES = ["rain", "storm", "snow", "fog", "cloud", "sun", "night"];

// Echte Bremen-Wetter-Videos gibt es nirgends kostenlos, und die einzigen
// Bremen-Videoclips auf Wikimedia Commons (ein paar Bahn-Aufnahmen) liegen
// als WebM/Ogg Theora vor — beides Codecs, die Safari 12 grundsätzlich gar
// nicht abspielen kann (nur H.264/MP4). Ein generisches Lottie-Vorschau-
// video war zwar technisch MP4, ist aber erstens nicht Bremen und wurde
// zweitens von iOS nach kurzer Zeit als "nicht wirklich sichtbares
// Hintergrundelement" pausiert (Energiespar-Heuristik für Video hinter
// anderem Content) — daher der kurze Aufblitzer und dann Stillstand.
// Stattdessen: ein dynamischer Himmel-Verlauf wie bei Apple Wetter/Carrot
// Weather — reines CSS, läuft garantiert, kein Netzwerk, keine Codecs,
// keine Energiespar-Überraschungen. Je nach Wetterlage UND Tag/Nacht
// eigene Farbstimmung.
// Runde 2 der Überarbeitung: die erste Version wirkte "platt" — eine
// nahezu einfarbige dunkle Fläche ohne Tiefe. Jetzt zwei kombinierte
// Hintergründe pro Stimmung: ein radialer "Lichtquelle"-Glow oben (fürs
// Volumen-/Atmosphäre-Gefühl, wie ein Sonnen-/Mondstand) UND ein breiterer
// 4-Stopp-Verlauf mit deutlich mehr Kontrast zwischen dunkelstem und
// hellstem Punkt (vorher oft nur 2 nah beieinanderliegende Töne).
const WEATHER_SKY_GRADIENTS = {
  // Vorherige Version endete unten in kräftigem Orange (#ffcf87) — sah
  // dadurch bei JEDEM "klar"-Wetter wie ein Sonnenuntergang aus, egal ob
  // Mittag oder Nachmittag, und wirkte dadurch grell/unrealistisch statt
  // wie ein normaler klarer Himmel. Jetzt ein glaubwürdigerer Blauverlauf,
  // Wärme kommt nur noch dezent vom radialen Glow oben (Sonnenposition).
  "sun": "radial-gradient(130% 70% at 80% -10%, rgba(255,236,190,0.4), transparent 55%), linear-gradient(165deg, #1c5a8c 0%, #3f86c2 45%, #7ab3dd 80%, #bcd9ec 100%)",
  "night": "radial-gradient(120% 60% at 50% -20%, rgba(120,150,220,0.18), transparent 60%), linear-gradient(165deg, #060a16 0%, #0f1830 40%, #1b2846 70%, #2a3a5e 100%)",
  "cloud:day": "radial-gradient(130% 60% at 30% -10%, rgba(255,255,255,0.18), transparent 55%), linear-gradient(165deg, #303a44 0%, #4c5964 40%, #71818d 70%, #9aa7b0 100%)",
  "cloud:night": "radial-gradient(120% 60% at 50% -15%, rgba(150,160,190,0.12), transparent 60%), linear-gradient(165deg, #0a0e15 0%, #1a212c 40%, #2c3540 70%, #414c58 100%)",
  "rain:day": "radial-gradient(120% 55% at 30% -10%, rgba(180,210,230,0.15), transparent 55%), linear-gradient(165deg, #182229 0%, #2c3b46 40%, #4a5f6f 70%, #6d8494 100%)",
  "rain:night": "radial-gradient(120% 55% at 50% -15%, rgba(100,140,180,0.12), transparent 60%), linear-gradient(165deg, #050a10 0%, #101c26 40%, #1c2b38 70%, #2c3f4e 100%)",
  "storm:day": "radial-gradient(120% 55% at 40% -10%, rgba(180,170,220,0.12), transparent 55%), linear-gradient(165deg, #0c0f14 0%, #1e2530 40%, #3a4453 70%, #57647a 100%)",
  "storm:night": "radial-gradient(120% 55% at 50% -15%, rgba(120,110,180,0.1), transparent 60%), linear-gradient(165deg, #030407 0%, #0c0f16 40%, #171d28 70%, #232b3a 100%)",
  "snow:day": "radial-gradient(130% 60% at 30% -10%, rgba(255,255,255,0.28), transparent 55%), linear-gradient(165deg, #2c4256 0%, #4d6a80 40%, #7396ab 70%, #a7c8db 100%)",
  "snow:night": "radial-gradient(120% 60% at 50% -15%, rgba(160,190,220,0.15), transparent 60%), linear-gradient(165deg, #0a121e 0%, #172236 40%, #263650 70%, #3a4f6b 100%)",
  "fog:day": "radial-gradient(130% 60% at 40% -10%, rgba(255,255,255,0.22), transparent 55%), linear-gradient(165deg, #3c454c 0%, #5b6469 40%, #838c92 70%, #a7afb4 100%)",
  "fog:night": "radial-gradient(120% 60% at 50% -15%, rgba(180,185,195,0.1), transparent 60%), linear-gradient(165deg, #0d1013 0%, #1c2024 40%, #2e3338 70%, #43494e 100%)",
};

// Leuchtfarbe für den Glow hinter Icon/Temperatur (siehe .weather-big::
// before in style.css) — sorgt für echte Tiefe statt einer flachen
// Textzeile vor dem Verlauf, Farbe passend zur jeweiligen Stimmung.
const WEATHER_GLOW_COLORS = {
  sun: "rgba(255, 224, 170, 0.35)",
  night: "rgba(140, 165, 230, 0.28)",
  cloud: "rgba(255, 255, 255, 0.16)",
  rain: "rgba(160, 205, 230, 0.22)",
  storm: "rgba(180, 170, 220, 0.18)",
  snow: "rgba(255, 255, 255, 0.32)",
  fog: "rgba(255, 255, 255, 0.24)",
};

function weatherSkyGradient(category, isDay) {
  if (category === "sun") return WEATHER_SKY_GRADIENTS.sun;
  if (category === "night") return WEATHER_SKY_GRADIENTS.night;
  const key = category + ":" + (isDay ? "day" : "night");
  return WEATHER_SKY_GRADIENTS[key] || WEATHER_SKY_GRADIENTS["cloud:day"];
}

// Setzt die fx-Kategorie + den Himmel-Verlauf auf .weather-scene
// (#panel-weather) über classList/style statt className-Ersatz —
// showPanel() wechselt beim Karussell ebenfalls per
// classList.toggle("active", …) auf demselben Element, eine className-
// Zuweisung hier würde dessen "active"-Klasse (und die hier gesetzten
// Klassen) beim nächsten Wechsel sonst gegenseitig wegwischen.
function setWeatherScene(fxCategory, isDay) {
  if (!els.weatherPanel) return;
  els.weatherPanel.classList.add("weather-scene");
  WEATHER_FX_CATEGORIES.forEach(function (c) {
    els.weatherPanel.classList.remove("fx-" + c);
  });
  if (fxCategory) els.weatherPanel.classList.add("fx-" + fxCategory);
  // Verlauf sitzt auf dem eigenen .weather-sky-Element (siehe index.html/
  // style.css), nicht direkt als background auf #panel-weather selbst —
  // robuster auf altem Safari als background auf einem Flex-Container mit
  // variabler Inhaltshöhe.
  if (els.weatherSky) {
    els.weatherSky.style.background = weatherSkyGradient(fxCategory, isDay);
  }
  // Glow-Farbe hinterm Icon per CSS-Variable (siehe .weather-big::before) —
  // macht aus der vorher komplett flachen Text-Zeile einen echten
  // Lichtpunkt, ohne eigenes DOM-Element extra dafür zu brauchen.
  els.weatherPanel.style.setProperty(
    "--sky-glow",
    WEATHER_GLOW_COLORS[fxCategory] || "rgba(255, 255, 255, 0.2)"
  );
}

// Die nächsten 5 Tage als Kacheln: Tag, Symbol, Höchst-/Tiefstwert und
// Regenwahrscheinlichkeit, wenn sie zählt (ab 30 %).
const WOCHENTAG_KURZ = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function renderWeatherDays(daily) {
  const d0 = new Date();
  const heute = d0.getFullYear() + "-" + String(d0.getMonth() + 1).padStart(2, "0") + "-" + String(d0.getDate()).padStart(2, "0");
  const start = Math.max(0, daily.time.indexOf(heute));
  const anzahl = Math.min(CONFIG.weatherHourCount || 5, daily.time.length - start);
  for (let k = 0; k < anzahl; k++) {
    const i = start + k;
    const tag = parseOpenMeteoLocal(daily.time[i] + "T12:00");
    const hi = daily.temperature_2m_max[i];
    const lo = daily.temperature_2m_min[i];
    const pp = daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : null;
    const cell = document.createElement("div");
    cell.className = "weather-hour weather-day" + (pp != null && pp >= 50 ? " is-nass" : "");
    // Waagerecht: Symbol links, Tag/Temperatur/Regen rechts – flacher als
    // die alten Stundenkacheln, die Kurve darüber behält ihren Platz.
    cell.innerHTML =
      '<span class="weather-hour-icon">' + weatherIconMarkup(daily.weather_code[i], true) + "</span>" +
      '<span class="weather-day-text"><span class="weather-hour-time">' + (k === 0 ? "Heute" : (k === 1 ? "Morgen" : WOCHENTAG_KURZ[tag.getDay()] + " " + tag.getDate() + ".")) + "</span>" +
      '<span class="weather-hour-temp">' + (hi != null ? Math.round(hi) + "°" : "–") +
      '<span class="weather-day-lo"> ' + (lo != null ? Math.round(lo) + "°" : "") + "</span></span>" +
      '<span class="weather-day-regen' + (pp != null && pp >= 30 ? " is-regen" : "") + '">' + (pp != null && pp >= 30 ? pp + " % Regen" : "trocken") + "</span></span>";
    els.weatherHours.appendChild(cell);
  }
}

function ensureWeatherFxLayers() {
  if (weatherFxBuilt || !els.weatherPanel) return;
  weatherFxBuilt = true;

  // Regen: drei Tiefenebenen (fern/mittel/nah) mit eigener Geschwindigkeit,
  // Deckkraft und leichtem Wind-Drift (via CSS-Var, siehe style.css),
  // plus ein paar Spritzer-Ringe am unteren Rand — dem Lottie-Referenz-
  // Regen nachempfunden, aber als reine Transform/Opacity-Animation.
  // Runde 2: vorher praktisch unsichtbar (zu dünn, zu dunkel vor dem
  // dunklen Himmel) — mehr Tropfen, heller, dicker (siehe .fx-drop in
  // style.css für die eigentliche Farb-/Breiten-Anpassung).
  // Runde 3 (Performance): Anzahl wieder spürbar runter — jeder Tropfen
  // ist ein eigenes animiertes Element, auf dem alten iPad summiert sich
  // das. Weniger, aber dafür (siehe style.css) heller/dicker, damit der
  // Regen trotzdem gut sichtbar bleibt.
  const rainLayer = document.createElement("div");
  rainLayer.className = "weather-fx-layer weather-fx-rain";
  [
    { cls: "layer-far", positions: [10, 34, 58, 82], duration: 1.7 },
    { cls: "layer-mid", positions: [20, 46, 72], duration: 1.25 },
    { cls: "layer-near", positions: [14, 40, 66, 90], duration: 0.9 },
  ].forEach(function (depth) {
    depth.positions.forEach(function (left, i) {
      const drop = document.createElement("span");
      drop.className = "fx-drop " + depth.cls;
      drop.style.left = left + "%";
      drop.style.animationDuration = depth.duration + "s";
      drop.style.animationDelay = ((i * depth.duration) / depth.positions.length) + "s";
      rainLayer.appendChild(drop);
    });
  });
  [15, 40, 65, 88].forEach(function (left, i) {
    const splash = document.createElement("span");
    splash.className = "fx-splash";
    splash.style.left = left + "%";
    splash.style.animationDelay = (i * 0.2) + "s";
    rainLayer.appendChild(splash);
  });

  // Gewitter nutzt dieselbe Regenebene (s.o.) + ein Blitz-Overlay, das
  // per Klasse auf .weather-scene nur bei "fx-storm" überhaupt aktiv wird.
  const lightningLayer = document.createElement("div");
  lightningLayer.className = "fx-lightning";

  const cloudLayer = document.createElement("div");
  cloudLayer.className = "weather-fx-layer weather-fx-cloud";
  [
    { top: 12, size: 100, duration: 26, delay: 0 },
    { top: 40, size: 70, duration: 20, delay: 6 },
    { top: 62, size: 85, duration: 30, delay: 12 },
  ].forEach(function (spec) {
    const shape = document.createElement("span");
    shape.className = "fx-cloud-shape";
    shape.style.top = spec.top + "%";
    shape.style.width = spec.size + "px";
    shape.style.height = Math.round(spec.size * 0.36) + "px";
    shape.style.animationDuration = spec.duration + "s";
    shape.style.animationDelay = spec.delay + "s";
    cloudLayer.appendChild(shape);
  });

  const snowLayer = document.createElement("div");
  snowLayer.className = "weather-fx-layer weather-fx-snow";
  [10, 25, 40, 55, 70, 85].forEach(function (left, i) {
    const flake = document.createElement("span");
    flake.className = "fx-flake";
    flake.style.left = left + "%";
    flake.style.animationDelay = (i * 0.6) + "s";
    snowLayer.appendChild(flake);
  });

  const fogLayer = document.createElement("div");
  fogLayer.className = "weather-fx-layer weather-fx-fog";
  [
    { top: 22, duration: 15, delay: 0, opacity: 0.28 },
    { top: 46, duration: 19, delay: 4, opacity: 0.38 },
    { top: 70, duration: 23, delay: 8, opacity: 0.3 },
  ].forEach(function (spec) {
    const band = document.createElement("span");
    band.className = "fx-fog-band";
    band.style.top = spec.top + "%";
    band.style.animationDuration = spec.duration + "s";
    band.style.animationDelay = spec.delay + "s";
    band.style.opacity = spec.opacity;
    fogLayer.appendChild(band);
  });

  const sunLayer = document.createElement("div");
  sunLayer.className = "weather-fx-layer weather-fx-sun";
  const sunGlow = document.createElement("span");
  sunGlow.className = "fx-sun-glow";
  sunLayer.appendChild(sunGlow);

  const nightLayer = document.createElement("div");
  nightLayer.className = "weather-fx-layer weather-fx-night";
  const STAR_SIZES = ["is-small", "", "", "is-large"];
  for (let i = 0; i < 14; i++) {
    const star = document.createElement("span");
    star.className = "fx-star " + STAR_SIZES[Math.floor(Math.random() * STAR_SIZES.length)];
    star.style.left = Math.round(6 + Math.random() * 88) + "%";
    star.style.top = Math.round(8 + Math.random() * 60) + "%";
    star.style.animationDelay = (Math.random() * 2.6).toFixed(2) + "s";
    nightLayer.appendChild(star);
  }

  [nightLayer, sunLayer, fogLayer, snowLayer, cloudLayer, lightningLayer, rainLayer].forEach(function (layer) {
    els.weatherPanel.insertBefore(layer, els.weatherPanel.firstChild);
  });
}

// Hinweis: eine frühere Version blendete zusätzlich ein Bremer Wahrzeichen-
// Foto (Wikipedia REST API) per mix-blend-mode:overlay als Textur ein.
// Bei genauerer Betrachtung war das auf dem dunklen Himmel-Verlauf praktisch
// unsichtbar (overlay-Blend auf sehr dunklem Untergrund verschluckt fast
// alles) — deshalb rausgeworfen statt weiter dran zu flicken. Der neue
// Fokus liegt auf sichtbaren Wetter-Effekten + Verlaufstiefe statt einem
// kaum wahrnehmbaren Foto.

// Gleiche Idee wie bei WEATHER_ICON_SVG oben: eigene ruhige Linien-Icons
// statt Emoji (🌡️💨💦☔🌅🌇) für die kleinen Zusatz-Daten-Kacheln —
// einfarbig (weiß, passend zum dunklen Glas der Kachel), keine Emoji-Buntheit.
const WEATHER_DETAIL_ICON_SVG = {
  thermo: '<rect x="42" y="14" width="16" height="48" rx="8" fill="none" stroke="#fff" stroke-width="7"/>' +
    '<circle cx="50" cy="76" r="16" fill="#fff"/>' +
    '<rect x="46" y="30" width="8" height="38" fill="#fff"/>',
  wind: '<path d="M14,34 H62 a9,9 0 1 0 -9,-9" fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round"/>' +
    '<path d="M14,54 H78 a10,10 0 1 1 -10,10" fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round"/>' +
    '<path d="M14,74 H54 a8,8 0 1 0 -8,8" fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round"/>',
  humidity: '<path fill="#fff" d="M50,10 C66,34 80,53 80,68 a30,30 0 1,1 -60,0 C20,53 34,34 50,10 Z"/>',
  rain: cloudShapeSvg("#fff", 50, 40) +
    '<line x1="50" y1="72" x2="45" y2="86" stroke="#fff" stroke-width="6" stroke-linecap="round"/>',
  // Pfeil zeigt nach OBEN: Schaft von unten (58) zur Spitze oben (20),
  // Flügel spreizen von der Spitze nach unten weg — klassische ↑-Form.
  sunrise: '<line x1="14" y1="72" x2="86" y2="72" stroke="#fff" stroke-width="6" stroke-linecap="round"/>' +
    '<path d="M28,72 a22,22 0 0 1 44,0" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>' +
    '<path d="M50,58 L50,20 M39,31 L50,20 L61,31" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
  // Gleiche Form, aber gespiegelt an einer festen Achse innerhalb des
  // eigenen Viewbox (nicht wie im ersten Versuch um einen Punkt AUSSERHALB
  // der Pfeilform herum, der die Spitze aus dem sichtbaren 0-100-Bereich
  // rausgeschoben hat) — Pfeil zeigt jetzt nach UNTEN, Spitze knapp über
  // dem Horizont.
  sunset: '<line x1="14" y1="72" x2="86" y2="72" stroke="#fff" stroke-width="6" stroke-linecap="round"/>' +
    '<path d="M28,72 a22,22 0 0 1 44,0" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>' +
    '<path d="M50,20 L50,58 M39,47 L50,58 L61,47" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
};

function weatherDetailIconMarkup(key) {
  const inner = WEATHER_DETAIL_ICON_SVG[key];
  if (!inner) return "";
  return '<svg viewBox="0 0 100 100" aria-hidden="true">' + inner + '</svg>';
}

// Kleine Zusatz-Daten unterm Wetter-Panel (Wind, Luftfeuchte, gefühlte
// Temperatur, Regenwahrscheinlichkeit, Sonnenauf-/-untergang) — fehlt ein
// Feld in der API-Antwort mal, wird die jeweilige Kachel einfach
// weggelassen statt "undefined" anzuzeigen.
function renderWeatherDetails(data) {
  if (!els.weatherDetails) return;
  const c = data.current || {};
  const d = data.daily || {};
  const chips = [];

  if (c.apparent_temperature != null) {
    chips.push({ iconKey: "thermo", value: Math.round(c.apparent_temperature) + "°", label: "Gefühlt" });
  }
  if (c.wind_speed_10m != null) {
    chips.push({ iconKey: "wind", value: Math.round(c.wind_speed_10m) + " km/h", label: "Wind" });
  }
  // Weniger, aber lesbar (IDEEN W3): Luftfeuchte nur noch im alten Look.
  if (c.relative_humidity_2m != null && CONFIG.farbwelt === "hell") {
    chips.push({ iconKey: "humidity", value: Math.round(c.relative_humidity_2m) + "%", label: "Luftfeuchte" });
  }
  if (d.precipitation_probability_max && d.precipitation_probability_max[0] != null) {
    chips.push({ iconKey: "rain", value: Math.round(d.precipitation_probability_max[0]) + "%", label: "Regen" });
  }
  // Nur der nächste Sonnen-Wechsel statt immer Auf- UND Untergang.
  const sunrise = d.sunrise && d.sunrise[0] ? parseOpenMeteoLocal(d.sunrise[0]) : null;
  const sunset = d.sunset && d.sunset[0] ? parseOpenMeteoLocal(d.sunset[0]) : null;
  const nowSun = Date.now();
  const hmSun = function (t) { return t.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }); };
  if (sunrise && nowSun < sunrise.getTime()) chips.push({ iconKey: "sunrise", value: hmSun(sunrise), label: "Aufgang" });
  else if (sunset && nowSun < sunset.getTime()) chips.push({ iconKey: "sunset", value: hmSun(sunset), label: "Untergang" });
  else if (sunrise) chips.push({ iconKey: "sunrise", value: hmSun(new Date(sunrise.getTime() + 86400000)), label: "Aufgang morgen" });

  els.weatherDetails.innerHTML = "";
  chips.forEach(function (c2) {
    const chip = document.createElement("div");
    chip.className = "weather-detail-chip";

    const iconEl = document.createElement("span");
    iconEl.className = "weather-detail-icon";
    iconEl.innerHTML = weatherDetailIconMarkup(c2.iconKey);
    chip.appendChild(iconEl);

    const textEl = document.createElement("span");
    textEl.className = "weather-detail-text";

    const valueEl = document.createElement("span");
    valueEl.className = "weather-detail-value";
    valueEl.textContent = c2.value;
    textEl.appendChild(valueEl);

    const labelEl = document.createElement("span");
    labelEl.className = "weather-detail-label";
    labelEl.textContent = c2.label;
    textEl.appendChild(labelEl);

    chip.appendChild(textEl);
    els.weatherDetails.appendChild(chip);
  });
}

function updateWeather() {
  // Cache-Buster (_=Date.now()), gleiches Muster wie beim Spruch-Abruf
  // (updateQuote) — ohne das kann ein zwischengeschalteter Cache (Safaris
  // eigener HTTP-Cache oder ein CDN vor Open-Meteo) über die eingestellten
  // 15 Minuten hinaus eine ältere Antwort ausliefern, ohne dass die
  // Tafel etwas davon merkt. Erklärt am ehesten, warum die Tafel zeitweise
  // "anderes" Wetter zeigt als eine frisch geöffnete App auf dem Handy.
  // minutely_15: dieselbe Genauigkeit, mit der auch Apple Wetter/Regenradar-
  // Apps arbeiten — 15-Minuten-Auflösung statt nur volle Stunden, siehe
  // rainStartMinutes weiter unten. forecast_minutely_15=12 deckt die
  // nächsten 3 Stunden ab, mehr braucht die "Sollte ich jetzt los?"-Karte
  // nicht.
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + CONFIG.weatherLat +
    "&longitude=" + CONFIG.weatherLon +
    "&current=temperature_2m,weather_code,is_day,relative_humidity_2m,apparent_temperature,wind_speed_10m" +
    "&hourly=temperature_2m,weather_code,precipitation_probability" +
    "&minutely_15=precipitation,weather_code" +
    "&forecast_minutely_15=12" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max" +
    "&timezone=Europe%2FBerlin" +
    "&_=" + Date.now();

  fetch(url, { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("Wetter-Abruf fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    markFresh("weather");
    const temp = Math.round(data.current.temperature_2m);
    const code = data.current.weather_code;
    const isDay = data.current.is_day !== 0;
    const entry = WEATHER_CODES[code] || ["🌡️", ""];
    lastWeatherSnapshot = {
      temp: temp,
      code: code,
      desc: entry[1] || "",
      hi: data.daily && data.daily.temperature_2m_max ? Math.round(data.daily.temperature_2m_max[0]) : null,
      lo: data.daily && data.daily.temperature_2m_min ? Math.round(data.daily.temperature_2m_min[0]) : null,
      sunrise: data.daily && data.daily.sunrise && data.daily.sunrise[0] ? parseOpenMeteoLocal(data.daily.sunrise[0]).getTime() : null,
      sunset: data.daily && data.daily.sunset && data.daily.sunset[0] ? parseOpenMeteoLocal(data.daily.sunset[0]).getTime() : null,
      // Stundenwerte für Tagesblick/"Morgen früh" (tagesblick.js), auf 72 h gekappt.
      hourly: data.hourly && data.hourly.time ? {
        time: data.hourly.time.slice(0, 72).map(function (t) { return parseOpenMeteoLocal(t).getTime(); }),
        temp: (data.hourly.temperature_2m || []).slice(0, 72),
        code: (data.hourly.weather_code || []).slice(0, 72),
        pp: (data.hourly.precipitation_probability || []).slice(0, 72),
      } : null,
      isDay: isDay,
      at: Date.now(),
    };

    if (els.weatherBigIcon) {
      els.weatherBigIcon.innerHTML = weatherIconMarkup(code, isDay);
      els.weatherBigTemp.textContent = temp + "°";
      els.weatherBigDesc.textContent = entry[1] || "";
    }

    if (els.weatherPanel) {
      ensureWeatherFxLayers();
      const fxCategory = weatherFxCategory(code, isDay);
      setWeatherScene(fxCategory, isDay);
    }

    renderWeatherDetails(data);
    renderWeatherCurve();

    if (els.weatherBigMinMax && data.daily && data.daily.temperature_2m_max && data.daily.temperature_2m_min
      && data.daily.temperature_2m_max[0] != null && data.daily.temperature_2m_min[0] != null) {
      const hi = Math.round(data.daily.temperature_2m_max[0]);
      const lo = Math.round(data.daily.temperature_2m_min[0]);
      els.weatherBigMinMax.textContent = "H: " + hi + "°  T: " + lo + "°";
    }
    if (els.weatherBigMoon) {
      const moon = moonPhase(new Date());
      els.weatherBigMoon.innerHTML = moonPhaseSvg(moon) + "<span>" + moon.name + " · " + Math.round(moon.lit * 100) + " %</span>";
    }

    if (els.weatherHours && data.hourly && data.hourly.time) {
      // BUG gefunden: hier stand ein exakter String-Vergleich
      // (data.hourly.time.indexOf(data.current.time)) — die Stundenwerte
      // stehen aber immer auf der vollen Stunde ("...T14:00"), während
      // current.time die tatsächliche Minute enthält ("...T14:37"). Das
      // hat NIE getroffen, ist immer auf 0 zurückgefallen und hat deshalb
      // dauerhaft die ersten Stunden des Tages (00/01/02 Uhr…) gezeigt,
      // egal wie spät es wirklich war. Jetzt: echter Zeitvergleich statt
      // Text-Gleichheit, findet die erste Stunde ab jetzt. Nutzt
      // parseOpenMeteoLocal() statt new Date() direkt — sonst derselbe
      // 2-Stunden-Safari-Versatz wie beim Sonnenaufgang (siehe dort).
      const nowMs = Date.now();
      let startIdx = data.hourly.time.length - 1;
      for (let j = 0; j < data.hourly.time.length; j++) {
        if (parseOpenMeteoLocal(data.hourly.time[j]).getTime() >= nowMs) {
          startIdx = j;
          break;
        }
      }

      // Sonnenauf-/-untergang von heute für die Tag/Nacht-Einordnung der
      // einzelnen Stunden — bei weatherHourCount=5 liegt der Streifen so gut
      // wie nie über den Tageswechsel hinaus, "heute" reicht also.
      const sunriseMs = data.daily && data.daily.sunrise && data.daily.sunrise[0]
        ? parseOpenMeteoLocal(data.daily.sunrise[0]).getTime() : null;
      const sunsetMs = data.daily && data.daily.sunset && data.daily.sunset[0]
        ? parseOpenMeteoLocal(data.daily.sunset[0]).getTime() : null;

      els.weatherHours.innerHTML = "";
      // Die nächsten Stunden zeigt schon die Kurve darüber – unten dann
      // die nächsten Tage (bisher fehlte der Tafel jeder Blick über heute hinaus).
      const tageUnten = (CONFIG.wetterUnten || "tage") === "tage" && (CONFIG.wetterMitte || "verlauf") === "verlauf" &&
        data.daily && data.daily.time && data.daily.weather_code;
      els.weatherHours.classList.toggle("is-tage", !!tageUnten);
      if (tageUnten) renderWeatherDays(data.daily);
      for (let i = 0; !tageUnten && i < CONFIG.weatherHourCount; i++) {
        const idx = startIdx + i;
        if (idx >= data.hourly.time.length) break;

        const hTime = parseOpenMeteoLocal(data.hourly.time[idx]);
        const hTemp = Math.round(data.hourly.temperature_2m[idx]);
        const hCode = data.hourly.weather_code[idx];
        const hMs = hTime.getTime();
        const hIsDay = (sunriseMs != null && sunsetMs != null)
          ? (hMs >= sunriseMs && hMs < sunsetMs)
          : (hTime.getHours() >= 6 && hTime.getHours() < 20);

        const cell = document.createElement("div");
        cell.className = "weather-hour";

        const timeEl = document.createElement("span");
        timeEl.className = "weather-hour-time";
        timeEl.textContent = hTime.toLocaleTimeString("de-DE", { hour: "2-digit" });

        const iconEl = document.createElement("span");
        iconEl.className = "weather-hour-icon";
        iconEl.innerHTML = weatherIconMarkup(hCode, hIsDay);

        const tempEl = document.createElement("span");
        tempEl.className = "weather-hour-temp";
        tempEl.textContent = hTemp + "°";

        cell.appendChild(timeEl);
        cell.appendChild(iconEl);
        cell.appendChild(tempEl);
        els.weatherHours.appendChild(cell);
      }

      if (els.weatherTip) {
        const tip = buildWeatherTip(data.hourly.time, data.hourly.weather_code, data.hourly.temperature_2m, startIdx, code);
        if (tip) {
          els.weatherTip.textContent = tip;
          els.weatherTip.classList.add("is-visible");
        } else {
          els.weatherTip.textContent = "";
          els.weatherTip.classList.remove("is-visible");
        }
      }

      // Für die "Sollte ich jetzt los?"-Karte: minutengenau statt nur
      // stundengenau, siehe rainStartMinutes/renderLeaveNowBanner in app.js.
      // Erster 15-Minuten-Schritt ab jetzt mit echtem Niederschlag (>0.1mm,
      // filtert Mess-/Rundungsrauschen) ODER einem Regen-Code — der Abstand
      // in Minuten dazu ist die Grundlage für "In X Minuten fängt's an zu
      // regnen" statt der bisherigen groben "irgendwann diese Stunde".
      rainStartMinutes = null;
      if (data.minutely_15 && data.minutely_15.time) {
        const mTime = data.minutely_15.time;
        const mPrecip = data.minutely_15.precipitation || [];
        const mCode = data.minutely_15.weather_code || [];
        const nowMs = Date.now();
        for (let mi = 0; mi < mTime.length; mi++) {
          const isRain = (mPrecip[mi] != null && mPrecip[mi] > 0.1) || RAIN_CODES.indexOf(mCode[mi]) !== -1;
          if (!isRain) continue;
          const mMs = parseOpenMeteoLocal(mTime[mi]).getTime();
          rainStartMinutes = Math.round((mMs - nowMs) / 60000);
          break;
        }
      }
    }
  }).catch(function (err) {
    console.error(err);
  });
}

// ---------- Nachrichten (Tagesschau) — Bild-Diashow ----------
// Für die ersten CONFIG.newsFullCount Meldungen wird zusätzlich der volle
// Artikeltext nachgeladen (zum Scrollen), der Rest bleibt Kurz-Headline.
// Klappt der Detail-Abruf mal nicht, fällt die Karte automatisch auf den
// kurzen Teaser (firstSentence/topline) zurück statt kaputt zu gehen.
//
// Statt einer scrollbaren Liste läuft das jetzt als eigene Mini-Diashow:
// ein Artikel füllt den Screen groß mit Teaserbild, wechselt selbstständig
// alle paar Sekunden, solange das News-Panel sichtbar ist (siehe
// startNewsSlideshow()/stopNewsSlideshow(), angestoßen von showPanel()).
// Das Bild-Feld der Tagesschau-API ist von hier aus nicht testbar (Domain
// gesperrt für meine eigenen Tools) — deshalb wird die Bildsuche bewusst
// defensiv gebaut: mehrere bekannte Feldpfade probieren, sonst bleibt die
// Karte einfach ein Text-Slide statt kaputt zu gehen.
let newsItems = [];
let newsSlideIndex = 0;
let newsSlideTimer = null;

function extractNewsImageUrl(item) {
  try {
    const variants = item && item.teaserImage && item.teaserImage.imageVariants;
    if (variants && typeof variants === "object") {
      const preferredKeys = ["16x9-1920", "16x9-1280", "16x9-840", "16x9-640"];
      for (let i = 0; i < preferredKeys.length; i++) {
        if (variants[preferredKeys[i]]) return variants[preferredKeys[i]];
      }
      for (const key in variants) {
        if (Object.prototype.hasOwnProperty.call(variants, key) && variants[key]) {
          return variants[key];
        }
      }
    }
    if (item && item.image && item.image.url) return item.image.url;
  } catch (e) {
    console.error(e);
  }
  return null;
}

function fetchArticleBody(item) {
  const detailUrl = item.details || item.detailsweb;
  if (!detailUrl) return Promise.resolve(null);

  // Cache-Buster + no-store — gleicher Bug/Fix wie beim Wetter-Abruf
  // (siehe updateWeather): ohne das kann ein Zwischenspeicher eine
  // veraltete Antwort ausliefern, obwohl die Tafel brav alle 15 Minuten
  // neu abfragt.
  const bustUrl = detailUrl + (detailUrl.indexOf("?") === -1 ? "?" : "&") + "_=" + Date.now();

  return fetch(bustUrl, { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("Artikel-Abruf fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const content = data && Array.isArray(data.content) ? data.content : null;
    if (!content) return null;

    const paragraphs = content
      .filter(function (block) { return block && block.type === "text" && block.value; })
      .map(function (block) { return "<p>" + block.value + "</p>"; });

    return paragraphs.length ? paragraphs.join("") : null;
  }).catch(function (err) {
    console.error(err);
    return null;
  });
}

function buildNewsSlide(entry, index) {
  const item = entry.item;
  const body = entry.body;
  const imageUrl = extractNewsImageUrl(item);

  const slide = document.createElement("div");
  slide.className = "news-slide" + (index === 0 ? " active" : "") + (imageUrl ? "" : " no-media");
  slide.id = "newsSlide" + index;

  if (imageUrl) {
    const media = document.createElement("div");
    media.className = "news-slide-media";
    // Bild-URL nur als data-Attribut merken, nicht sofort als
    // background-image setzen (außer beim direkt sichtbaren ersten Slide) —
    // alle Slides bleiben wegen der Crossfade-Optik dauerhaft im DOM (siehe
    // .panel-view-Kommentar in style.css), auf einem speicherschwachen
    // Gerät (iPad Air 1, 1GB RAM) würden sonst alle Diashow-Bilder
    // gleichzeitig im GPU-Speicher gehalten statt nur das sichtbare.
    // showNewsSlide() lädt/entlädt die restlichen Bilder bei Bedarf.
    media.setAttribute("data-bg", imageUrl);
    if (index === 0) media.style.backgroundImage = 'url("' + imageUrl + '")';
    slide.appendChild(media);

    const scrim = document.createElement("div");
    scrim.className = "news-slide-scrim";
    slide.appendChild(scrim);
  }

  const content = document.createElement("div");
  content.className = "news-slide-content";

  const badgeLabel = item._poolLabel || "Deutschland";
  const badge = document.createElement("span");
  badge.className = "news-slide-badge" +
    (badgeLabel === "Bremen" ? " badge-bremen" : badgeLabel === "Welt" ? " badge-welt" : " badge-de");
  badge.textContent = badgeLabel;
  content.appendChild(badge);
  // Wie alt ist die Meldung? (wird beim Zeigen aktualisiert)
  const alter = document.createElement("span");
  alter.className = "news-slide-alter num";
  alter.setAttribute("data-ms", String(newsZeitMs(item)));
  alter.textContent = newsAlterText(newsZeitMs(item));
  content.appendChild(alter);

  // Kicker nur, wenn er etwas anderes sagt als das Badge (sonst stand
  // "BREMEN" doppelt untereinander).
  if (item.topline && item.topline.toLowerCase() !== String(badgeLabel).toLowerCase()) {
    const top = document.createElement("div");
    top.className = "news-slide-topline";
    top.textContent = item.topline;
    content.appendChild(top);
  }

  const title = document.createElement("div");
  title.className = "news-slide-title";
  title.textContent = item.title || "";
  content.appendChild(title);

  // Neues Layout (IDEEN N1): nur der Teaser — einen Volltext liest an der
  // Wand niemand, er lief bisher unten aus dem Bild. "klassisch" behält
  // den alten Volltext über dem Foto.
  const layout = CONFIG.nachrichtenLayout || "rechts";
  const bodyText = layout === "klassisch"
    ? (body || (item.firstSentence ? "<p>" + item.firstSentence + "</p>" : ""))
    : (item.firstSentence ? "<p>" + item.firstSentence + "</p>" : (body ? "<p>" + String(body).replace(/<[^>]+>/g, " ").split(/(?:\. )/)[0] + ".</p>" : ""));
  if (bodyText) {
    const bodyEl = document.createElement("div");
    bodyEl.className = "news-slide-body";
    bodyEl.innerHTML = bodyText;
    content.appendChild(bodyEl);
  }

  slide.appendChild(content);
  return slide;
}

// Lädt das Bild eines Slides erst, wenn er tatsächlich aktiv wird
// (data-bg → background-image), und wirft die Bilder aller anderen Slides
// wieder raus, sobald ihre Ausblend-Transition vorbei ist — Gegenstück zum
// data-bg-Setup in buildNewsSlide/buildSportNewsSlide (siehe Kommentar
// dort). delayMs muss zur jeweiligen CSS-Transition-Dauer passen (.news-
// slide: 0.9s, .sport-slide: 0.8s), sonst verschwindet das Bild mitten in
// der Überblendung.
function applySlideMediaSwap(slides, activeIndex, delayMs) {
  const activeMedia = slides[activeIndex] && slides[activeIndex].querySelector(".news-slide-media");
  if (activeMedia) {
    const url = activeMedia.getAttribute("data-bg");
    if (url) activeMedia.style.backgroundImage = 'url("' + url + '")';
  }
  setTimeout(function () {
    for (let i = 0; i < slides.length; i++) {
      if (i === activeIndex) continue;
      const media = slides[i].querySelector(".news-slide-media");
      if (media) media.style.backgroundImage = "";
    }
  }, delayMs);
}

function showNewsSlide(index) {
  const slides = els.newsList ? els.newsList.querySelectorAll(".news-slide") : [];
  for (let i = 0; i < slides.length; i++) {
    slides[i].className = slides[i].className.replace(" active", "");
    if (i === index) slides[i].className += " active";
  }
  applySlideMediaSwap(slides, index, 950);
  const alter = slides[index] && slides[index].querySelector(".news-slide-alter");
  if (alter) alter.textContent = newsAlterText(Number(alter.getAttribute("data-ms")));

  // Fortschritts-Punkte — bisher war völlig unsichtbar, wie viele
  // Meldungen insgesamt kommen bzw. wie weit man schon durch ist.
  const dots = els.newsList ? els.newsList.querySelectorAll(".news-progress-dot") : [];
  for (let i = 0; i < dots.length; i++) {
    dots[i].className = "news-progress-dot" + (i === index ? " active" : "");
  }
  const count = document.getElementById("newsProgressCount");
  if (count) count.textContent = (index + 1) + " / " + slides.length;

  newsSlideIndex = index;
}

// keepIndex=true beim Fortsetzen nach einer Touch-Pause (siehe
// resumeCarouselFromFraction) — sonst würde jede Pause die Diashow
// zurück auf die erste Meldung springen lassen.
function startNewsSlideshow(keepIndex) {
  stopNewsSlideshow();
  if (!newsItems.length) return;

  if (!keepIndex) showNewsSlide(0);
  if (newsItems.length < 2) return;

  newsSlideTimer = setInterval(function () {
    showNewsSlide((newsSlideIndex + 1) % newsItems.length);
  }, CONFIG.newsSlideIntervalMs || 6000);
}

function stopNewsSlideshow() {
  if (newsSlideTimer) {
    clearInterval(newsSlideTimer);
    newsSlideTimer = null;
  }
}

// Ein einzelner Feed-Abruf, der bei Fehlern nicht die anderen Feeds mit
// runterreißt — kommt ein Pool nicht durch, gibt es halt weniger Slides
// aus diesem Bereich statt eines komplett leeren News-Panels.
// ---------- Nachrichten: frisch statt still veraltet (Sitzung 6) ----------
// FEEDBACK 10.10. „Nachrichten sollen aktuell sein“. Gegenprobe am 10.10.
// 11 Uhr: Der „allgemeine“ Feed news/?pageSize=2 lieferte gar nicht die
// Top-Meldungen, sondern die neuesten Meldungen irgendeiner Region („Lyrik
// in Neustrelitz und Erzählabend in Ueckermünde“; pageSize ignoriert die
// API ohnehin, es kamen 83 Meldungen); die zweite Bremen-Meldung war 52 h
// alt. Jetzt: Top-Meldungen = redaktionelle Auswahl der tagesschau-
// Startseite (homepage), höchstens 12 h alt; Bremen höchstens 24 h; an
// jeder Meldung steht, wie alt sie ist; Eilmeldungen (breakingNews) als
// roter Chip auf allen Panels.
const NEWS_MAX_ALTER_MS = 12 * 3600000;
const NEWS_BREMEN_MAX_ALTER_MS = 24 * 3600000;
const EIL_MAX_ALTER_MS = 3 * 3600000;
let eilmeldung = null; // { titel, ms, key } oder null
let eilGezeigt = "";

function newsZeitMs(item) {
  const t = item && item.date ? new Date(item.date).getTime() : NaN;
  return isNaN(t) ? 0 : t;
}

// "gerade eben" / "vor 12 Min" / "vor 3 Std" / "gestern 22:10" / "Mo. 09:15"
function newsAlterText(ms, jetzt) {
  if (!ms) return "";
  const min = Math.floor(((jetzt || Date.now()) - ms) / 60000);
  if (min < 2) return "gerade eben";
  if (min < 60) return "vor " + min + " Min";
  if (min < 12 * 60) return "vor " + Math.floor(min / 60) + " Std";
  const d = new Date(ms);
  const hm = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const heute = new Date(jetzt || Date.now());
  heute.setHours(0, 0, 0, 0);
  if (ms >= heute.getTime()) return "heute " + hm;
  if (ms >= heute.getTime() - 86400000) return "gestern " + hm;
  return d.toLocaleDateString("de-DE", { weekday: "short" }) + " " + hm;
}

function newsRessortLabel(item) {
  const r = String(item.ressort || "").toLowerCase();
  if (r === "ausland") return "Welt";
  if (r === "wirtschaft") return "Wirtschaft";
  if (r === "sport" || /sportschau\.de|\/sport\//.test(item.shareURL || "")) return "Sport";
  if (r === "wissen" || r === "investigativ") return "Wissen";
  return "Deutschland";
}

// Nur echte Meldungen (keine Wetter-/Sendungs-Kacheln), nicht zu alt.
// Kommen weniger als drei durch, die drei frischesten trotzdem – dann mit
// ehrlicher Altersangabe statt eines leeren Panels.
function newsAuswahl(items, maxAlter, jetzt, mindestens) {
  const echt = (items || []).filter(function (it) {
    // Wetter hat die Tafel selbst; die Startseite führt den Wetterbericht als Meldung
    return it && it.title && it.type === "story" && newsZeitMs(it) > 0 && !/\/wetter\//.test(it.shareURL || "");
  });
  const frisch = echt.filter(function (it) { return jetzt - newsZeitMs(it) <= maxAlter; });
  if (frisch.length >= mindestens) return frisch;
  return echt.slice().sort(function (a, b) { return newsZeitMs(b) - newsZeitMs(a); }).slice(0, mindestens);
}

function eilmeldungSetzen(alle, jetzt) {
  let neu = null;
  (alle || []).forEach(function (it) {
    if (!it || it.breakingNews !== true || !it.title) return;
    const ms = newsZeitMs(it);
    if (!ms || jetzt - ms > EIL_MAX_ALTER_MS) return;
    if (!neu || ms > neu.ms) neu = { titel: it.title, ms: ms, key: it.sophoraId || it.externalId || it.title };
  });
  eilmeldung = neu;
  eilChipZeichnen();
}

function eilChipZeichnen() {
  const bar = document.querySelector(".statusbar");
  if (!bar) return;
  let box = document.getElementById("eilHints");
  if (!box) {
    box = document.createElement("div");
    box.className = "warn-hints eil-hints";
    box.id = "eilHints";
    // Ganz vorn: noch vor den amtlichen Warnungen
    bar.insertBefore(box, document.getElementById("warnHints") || document.getElementById("haHints") || null);
    box.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (!eilmeldung) return;
      const key = eilmeldung.key;
      jumpToPanel("news");
      for (let i = 0; i < newsItems.length; i++) {
        const it = newsItems[i].item;
        if ((it.sophoraId || it.externalId || it.title) === key) { showNewsSlide(i); break; }
      }
    });
  }
  const e = eilmeldung && Date.now() - eilmeldung.ms <= EIL_MAX_ALTER_MS ? eilmeldung : null;
  const html = e ? '<button type="button" class="ha-hint is-p1 eil-hint" data-key="eil">' +
    '<span class="eil-wort">Eilmeldung</span><span class="eil-zeit num">' +
    new Date(e.ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + "</span><span></span></button>" : "";
  if (box._html !== html) {
    box._html = html;
    box.innerHTML = html;
    if (e) {
      box.querySelector("span:last-child").textContent = e.titel;
      // Einmal kurz pulsieren, wenn sie neu ist (AUSBAU 4: Hinweis erscheint)
      if (eilGezeigt !== e.key) {
        eilGezeigt = e.key;
        const chip = box.firstChild;
        chip.classList.add("is-flash");
        setTimeout(function () { chip.classList.remove("is-flash"); }, 2000);
      }
    }
  }
  if (typeof updateHintBar === "function") updateHintBar();
}

function fetchNewsPool(url, label, count) {
  // Cache-Buster + no-store — gleicher Bug/Fix wie beim Wetter-Abruf: ohne
  // das kann Safaris HTTP-Cache (oder ein CDN vor Tagesschau) über die
  // 15-Minuten-Aktualisierung hinaus eine ältere Antwort ausliefern, ohne
  // dass die Tafel etwas davon merkt — "Nachrichten sind nicht aktuell".
  const bustUrl = url + (url.indexOf("?") === -1 ? "?" : "&") + "_=" + Date.now();

  return fetch(bustUrl, { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("News-Pool fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const items = (data && Array.isArray(data.news)) ? data.news.slice(0, count) : [];
    items.forEach(function (item) { item._poolLabel = label; });
    return items;
  }).catch(function (err) {
    console.error(err);
    return [];
  });
}

function updateNews() {
  if (!els.newsList) return;

  const regionalUrl = "https://www.tagesschau.de/api2u/news/?regions=" + CONFIG.newsRegion;
  const startseiteUrl = "https://www.tagesschau.de/api2u/homepage/";

  Promise.all([
    fetchNewsPool(regionalUrl, "Bremen", 40),
    fetchNewsPool(startseiteUrl, null, 40),
  ]).then(function (pools) {
    const jetzt = Date.now();
    eilmeldungSetzen(pools[1].concat(pools[0]), jetzt);
    const bremen = newsAuswahl(pools[0], NEWS_BREMEN_MAX_ALTER_MS, jetzt, 0).slice(0, CONFIG.newsRegionCount || 2);
    const top = newsAuswahl(pools[1], NEWS_MAX_ALTER_MS, jetzt, 3).slice(0, (CONFIG.newsGeneralCount || 2) + (CONFIG.newsWorldCount || 3));
    top.forEach(function (it) { it._poolLabel = newsRessortLabel(it); });
    // Wichtigste Meldung zuerst (Reihenfolge der Redaktion), Bremen dazwischen
    let combined = [];
    for (let i = 0; i < Math.max(top.length, bremen.length * 2); i++) {
      if (top[i]) combined.push(top[i]);
      if (i % 2 === 0 && bremen[i / 2]) combined.push(bremen[i / 2]);
    }

    // Dedupe — der allgemeine Feed und der Ausland-Feed können sich
    // überschneiden, wenn eine Welt-Meldung gerade Top-Thema ist.
    const seen = {};
    combined = combined.filter(function (item) {
      const key = item.sophoraId || item.externalId || item.title;
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });

    if (!combined.length) throw new Error("Keine News erhalten");

    return Promise.all(combined.map(function (item, i) {
      // Volltext nur, wo er auch gezeigt wird ("klassisch") oder der Teaser fehlt
      const wantsFullText = i < CONFIG.newsFullCount &&
        ((CONFIG.nachrichtenLayout || "rechts") === "klassisch" || !item.firstSentence);
      const bodyPromise = wantsFullText ? fetchArticleBody(item) : Promise.resolve(null);
      return bodyPromise.then(function (body) {
        return { item: item, body: body };
      });
    }));
  }).then(function (entries) {
    els.newsList.innerHTML = "";
    newsItems = entries;

    entries.forEach(function (entry, index) {
      els.newsList.appendChild(buildNewsSlide(entry, index));
    });
    const newsPanel = document.getElementById("panel-news");
    if (newsPanel) {
      newsPanel.classList.remove("news-layout-rechts", "news-layout-oben", "news-layout-klassisch");
      newsPanel.classList.add("news-layout-" + (CONFIG.nachrichtenLayout || "rechts"));
    }

    // Fortschritts-Punkte, ein Punkt pro Meldung — sonst nicht erkennbar,
    // wie viele Slides insgesamt in dieser Runde kommen.
    if (entries.length > 1) {
      const progress = document.createElement("div");
      progress.className = "news-progress";
      entries.forEach(function () {
        const dot = document.createElement("span");
        dot.className = "news-progress-dot";
        progress.appendChild(dot);
      });
      // "3 / 12" statt nur winziger Punkte (IDEEN N1).
      const count = document.createElement("span");
      count.className = "news-progress-count";
      count.id = "newsProgressCount";
      count.textContent = "1 / " + entries.length;
      progress.appendChild(count);
      els.newsList.appendChild(progress);
    }

    // Panel könnte gerade schon aktiv sein (z.B. nach einem manuellen
    // Reload mitten im News-Slide) — dann die Diashow direkt starten.
    const panelEl = document.getElementById("panel-news");
    const isActive = panelEl && panelEl.className.indexOf("active") !== -1;
    if (isActive) startNewsSlideshow();

    newsAvailable = true;
    markFresh("news");
  }).catch(function (err) {
    console.error(err);
    newsAvailable = false;
  });
}

// ---------- Musik-Charts (Apple) ----------
// Politur-Runde: Platz 1 bekommt eine große Hero-Kachel (größeres Cover,
// größere Schrift, Kronen-Badge) statt in der Liste unterzugehen — dieselbe
// "ein Gewinner sticht heraus"-Idee wie beim Pendel-Panel. Plätze 2+
// bleiben die kompakte Listenansicht von vorher.
// JSONP-Hilfsfunktion: lädt eine URL über ein dynamisch eingefügtes
// <script>-Tag statt fetch()/XHR — CORS greift grundsätzlich nur bei
// fetch/XHR, nicht bei Script-Tags, deshalb umgeht das jede CORS-Sperre
// komplett. Uralte Technik (seit IE-Zeiten), aber auf Safari 12
// zuverlässig unterstützt. Jeder Aufruf bekommt einen eigenen, einmaligen
// Callback-Namen, damit sich überlappende Anfragen nicht in die Quere
// kommen; Script-Tag und Callback werden danach wieder aufgeräumt.
let jsonpCounter = 0;
function fetchJsonp(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const cbName = "__jsonp_cb_" + (jsonpCounter++) + "_" + Date.now();
    const script = document.createElement("script");
    let settled = false;

    function cleanup(spaet) {
      if (spaet) {
        // Die Antwort kann nach dem Zeitlimit noch kommen (ein entferntes
        // <script> bricht die Anfrage nicht ab) – dann bräuchte sie den
        // Callback, sonst ReferenceError in der Konsole. Leerfunktion, bis
        // das Skript geladen oder gescheitert ist (höchstens wenige Stück
        // bis zum 3-h-Neuladen der Tafel).
        const weg = function () {
          delete window[cbName];
          if (script.parentNode) script.parentNode.removeChild(script);
        };
        window[cbName] = function () {};
        script.onload = weg;
        script.onerror = weg;
        return;
      }
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      cleanup(true);
      reject(new Error("JSONP-Anfrage: Zeitüberschreitung"));
    }, timeoutMs || 8000);

    window[cbName] = function (data) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(data);
    };

    script.onerror = function () {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error("JSONP-Anfrage fehlgeschlagen"));
    };

    script.src = url + (url.indexOf("?") === -1 ? "?" : "&") +
      "output=jsonp&callback=" + cbName + "&_=" + Date.now();
    document.body.appendChild(script);
  });
}

// ---------- Musik zweispaltig (IDEEN M1) ----------
// Links die Nr. 1 groß, rechts die Plätze 2–10 als dichte Liste — statt
// fünf Karten, die zu 60 % leer waren. Aufsteiger/Neueinsteiger per
// Vergleich mit dem gestrigen Stand (localStorage, nur 10 IDs).
// Je Quelle getrennt – sonst wäre nach dem Wechsel Deezer → Apple einen Tag
// lang jeder Titel "neu".
function musicRankKey() { return "tafelMusikRang-" + (CONFIG.musikQuelle || "apple"); }

function musicMovement(results) {
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(musicRankKey()) || "null"); } catch (e) { prev = null; }
  const today = new Date().toDateString();
  const ids = results.map(function (r) { return r.id; });
  // Vergleichsbasis = Stand von einem früheren Tag; einmal täglich fortschreiben.
  let base = prev && prev.day !== today ? prev : (prev && prev.base ? prev.base : null);
  if (!prev || prev.day !== today) {
    try { localStorage.setItem(musicRankKey(), JSON.stringify({ day: today, ids: ids, base: prev ? { day: prev.day, ids: prev.ids } : null })); } catch (e) { /* egal */ }
    base = prev ? { day: prev.day, ids: prev.ids } : null;
  }
  return function (id, rank) {
    if (!base || !base.ids) return "";
    const before = base.ids.indexOf(id);
    if (before === -1) return "neu";
    if (before > rank) return "auf";
    if (before < rank) return "ab";
    return "";
  };
}

function renderMusicTwoColumns(results, info) {
  const move = musicMovement(results);
  const top = results[0];
  let html = '<div class="music2"><div class="music2-hero">' +
    '<img class="music2-cover" alt="" src="' + (top.artworkBig || "") + '">' +
    '<span class="music2-tag"></span>' +
    '<span class="music2-title"></span><span class="music2-artist"></span><span class="music2-quelle"></span></div><div class="music2-list">';
  results.slice(1, 10).forEach(function (song, i) {
    const m = move(song.id, i + 1);
    html += '<div class="music2-row"><span class="music2-rank">' + (i + 2) + "</span>" +
      '<span class="music2-move' + (m ? " is-" + m : "") + '">' + (m === "auf" ? "▲" : (m === "ab" ? "▼" : (m === "neu" ? "neu" : ""))) + "</span>" +
      '<img class="music2-art" alt="" src="' + (song.artworkUrl100 || "") + '">' +
      '<span class="music2-text"><span class="music2-t"></span><span class="music2-a"></span></span></div>';
  });
  html += "</div></div>";
  els.musicList.innerHTML = html;
  // Texte per textContent setzen (Titel können Sonderzeichen enthalten).
  els.musicList.querySelector(".music2-tag").textContent = info.tag;
  els.musicList.querySelector(".music2-title").textContent = top.name || "";
  els.musicList.querySelector(".music2-artist").textContent = top.artistName || "";
  els.musicList.querySelector(".music2-quelle").textContent = info.quelle;
  const rows = els.musicList.querySelectorAll(".music2-row");
  for (let i = 0; i < rows.length; i++) {
    rows[i].querySelector(".music2-t").textContent = results[i + 1].name || "";
    rows[i].querySelector(".music2-a").textContent = results[i + 1].artistName || "";
  }
}

// ---------- Musik-Charts: Quelle (Sitzung 6) ----------
// FEEDBACK 10.10.: "Musik-Charts meistens nicht richtig". Gegenprobe am
// 10.10.2026 mit den Offiziellen Deutschen Charts (offiziellecharts.de,
// Woche 09.–15.10.): von Deezers "Top Germany" standen nur 2 der Top 10 in
// den offiziellen Top 25 (dafür US-Country wie Morgan Wallen, Ella Langley),
// vom iTunes-Kauf-Chart 4 (drei davon Fassungen von "Patient Zero"), von
// Apple Music "Meistgespielt – Deutschland" 9
// (Nr. 1 identisch). Apple liefert aber keine CORS-Freigabe – die Liste
// kommt deshalb über Home Assistant (REST-Sensor, HOME_ASSISTANT.md
// Schritt 6) oder einen Proxy (CONFIG.musikProxy). Gibt es beides nicht,
// bleibt das Panel weg: lieber keins als falsche Charts.
const MUSIK_MAX_ALTER_MS = 4 * 86400000; // Sensor hängt? Dann nicht mehr zeigen
let musikHaAngemeldet = false;
let musikHaTimer = null;

// Apple: "Sat, 10 Oct 2026 08:07:33 +0000" (selbst gelesen – Safari 12
// soll hier nichts raten müssen)
function appleFeedZeit(text) {
  const m = /(\d{1,2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})/.exec(text || "");
  if (!m) return 0;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(m[2]);
  if (mon < 0) return 0;
  const off = (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
  return Date.UTC(+m[3], mon, +m[1], +m[4], +m[5], +m[6]) - off * 60000;
}

function appleTitel(results) {
  return (results || []).filter(function (r) { return r && r.name; }).map(function (r) {
    const art = String(r.artworkUrl100 || "");
    return {
      id: r.id,
      name: r.name,
      artistName: r.artistName,
      artworkUrl100: art.replace(/\/\d+x\d+bb\./, "/120x120bb."),
      artworkBig: art.replace(/\/\d+x\d+bb\./, "/640x640bb."),
    };
  });
}

function musikStandText(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const heute = new Date().toDateString() === d.toDateString();
  return "Stand " + (heute ? "heute " : d.toLocaleDateString("de-DE", { weekday: "short" }) + " ") +
    d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function zeigeMusik(results, info) {
  if (!results.length) throw new Error("Keine Musikdaten erhalten");
  if ((CONFIG.musikLayout || "zweispaltig") === "zweispaltig") {
    renderMusicTwoColumns(results, info);
  } else {
    renderMusicCards(results, info);
  }
  musicAvailable = true;
  markFresh("music");
}

function musikAppleZeigen(feed, weg) {
  const stand = appleFeedZeit(feed && feed.updated);
  if (!stand || Date.now() - stand > MUSIK_MAX_ALTER_MS) throw new Error("Musik-Charts zu alt oder ohne Stand (" + weg + ")");
  zeigeMusik(appleTitel(feed.results).slice(0, 10), {
    tag: "Nr. 1 in Deutschland",
    quelle: "Apple Music · meistgespielt · " + musikStandText(stand),
  });
}

// Liest den HA-Sensor; meldet sich einmal für Änderungen an (ein Listener
// für die ganze Laufzeit, gebündelt – kein Wachsen).
function musikAusHA() {
  const HA = window.TafelHA;
  if (!HA) return false;
  if (!musikHaAngemeldet) {
    musikHaAngemeldet = true;
    const sensor = CONFIG.musikSensor || "sensor.musik_charts";
    HA.on(function (typ, id) {
      if (typ !== "sync" && !(typ === "state" && id === sensor)) return;
      if (musikHaTimer) return;
      musikHaTimer = setTimeout(function () { musikHaTimer = null; updateMusic(); }, 1500);
    });
  }
  if (!HA.isConnected()) return false;
  const st = HA.state(CONFIG.musikSensor || "sensor.musik_charts");
  const res = st && st.attributes && st.attributes.results;
  if (!Array.isArray(res) || !res.length) return false;
  musikAppleZeigen({ updated: st.state, results: res }, "Home Assistant");
  return true;
}

function updateMusic() {
  if (!els.musicList) return;
  const quelle = CONFIG.musikQuelle || "apple";

  if (quelle === "apple") {
    try {
      if (musikAusHA()) return;
    } catch (e) {
      console.error(e);
    }
    if (!CONFIG.musikProxy) {
      // Ohne HA-Sensor und ohne Proxy gibt es keine verlässliche Quelle.
      musicAvailable = false;
      return;
    }
    fetch(CONFIG.musikProxy, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("Musik-Proxy: HTTP " + res.status);
      return res.json();
    }).then(function (data) {
      musikAppleZeigen(data && data.feed, "Proxy");
    }).catch(function (err) {
      console.error(err);
      musicAvailable = false;
    });
    return;
  }

  // Nur auf ausdrücklichen Wunsch (musikQuelle: "deezer"): Deezers
  // Hörer-Liste – ehrlich beschriftet, nicht als deutsche Charts.
  const url = "https://api.deezer.com/playlist/" + CONFIG.musicPlaylistId +
    "/tracks?limit=" + ((CONFIG.musikLayout || "zweispaltig") === "zweispaltig" ? 10 : CONFIG.musicCount);

  fetchJsonp(url).then(function (data) {
    if (data && data.error) throw new Error("Deezer-Fehler: " + (data.error.message || data.error.type));
    const entries = (data && Array.isArray(data.data)) ? data.data : [];
    const results = entries.map(function (t) {
      const album = t.album || {};
      return {
        id: t.id,
        name: t.title,
        artistName: t.artist && t.artist.name,
        artworkUrl100: album.cover_medium || album.cover_big || album.cover,
        artworkBig: album.cover_big || album.cover_medium || album.cover,
      };
    });
    zeigeMusik(results, { tag: "Deezer · Top Germany", quelle: "Deezer-Hörer, keine offiziellen Charts" });
  }).catch(function (err) {
    console.error(err);
    musicAvailable = false;
  });
}

// Bisheriges Karten-Layout (musikLayout: "karten")
function renderMusicCards(results, info) {
  els.musicList.innerHTML = "";
  const top = results[0];

  if (top) {
    const hero = document.createElement("div");
    hero.className = "music-hero";

    const art = document.createElement("img");
    art.className = "music-hero-art";
    art.src = top.artworkUrl100 || "";
    art.alt = "";
    hero.appendChild(art);

    const text = document.createElement("div");
    text.className = "music-hero-text";

    const tag = document.createElement("span");
    tag.className = "music-hero-tag";
    tag.textContent = info.tag;
    text.appendChild(tag);

    const title = document.createElement("span");
    title.className = "music-hero-title";
    title.textContent = top.name || "";
    text.appendChild(title);

    const artist = document.createElement("span");
    artist.className = "music-hero-artist";
    artist.textContent = top.artistName || "";
    text.appendChild(artist);

    hero.appendChild(text);
    els.musicList.appendChild(hero);
  }

  results.slice(1, CONFIG.musicCount).forEach(function (song, i) {
    const row = document.createElement("div");
    row.className = "music-item";

    const rank = document.createElement("span");
    rank.className = "music-rank";
    rank.textContent = (i + 2) + ".";

    const art = document.createElement("img");
    art.className = "music-art";
    art.src = song.artworkUrl100 || "";
    art.alt = "";

    const text = document.createElement("span");
    text.className = "music-text";

    const title = document.createElement("span");
    title.className = "music-title";
    title.textContent = song.name || "";

    const artist = document.createElement("span");
    artist.className = "music-artist";
    artist.textContent = song.artistName || "";

    text.appendChild(title);
    text.appendChild(artist);

    row.appendChild(rank);
    row.appendChild(art);
    row.appendChild(text);
    els.musicList.appendChild(row);
  });
}

// ---------- Veranstaltungen-Panel (Bremen) ----------
// InfraNode (infranode.dev), kostenlos, kein Key, offener CORS — Daten
// stammen von open.destination.one (siehe Kommentar bei CONFIG.eventsCount
// für die Recherche dahinter). Liste statt Diashow (wie Musik-Charts),
// weil man bei Terminen mehrere auf einen Blick vergleichen will.
const EVENT_MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

// ---------- Liste nach Tagen (IDEEN V1/K1) ----------
// Statt derselben Datumskachel dreimal hintereinander: Zwischenüberschrift
// je Tag ("Heute · Samstag"), Uhrzeit vorn in einer eigenen Spalte.
// items: [{ start: Date, allDay: bool, title, location }]
function dayLabel(d) {
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((d0 - t0) / 86400000);
  const wd = d.toLocaleDateString("de-DE", { weekday: "long" });
  if (diff === 0) return "Heute · " + wd;
  if (diff === 1) return "Morgen · " + wd;
  return wd + " · " + d.toLocaleDateString("de-DE", { day: "numeric", month: "long" });
}

function renderDayGroupedList(container, items) {
  container.innerHTML = "";
  container.classList.add("day-list");
  let lastDay = "";
  items.forEach(function (ev) {
    const label = dayLabel(ev.start);
    if (label !== lastDay) {
      lastDay = label;
      const head = document.createElement("div");
      head.className = "day-head";
      head.textContent = label;
      container.appendChild(head);
    }
    const row = document.createElement("div");
    row.className = "day-row";
    const time = document.createElement("span");
    time.className = "day-time" + (ev.allDay ? " is-allday" : "");
    time.textContent = ev.allDay ? "ganztags" : ev.start.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const text = document.createElement("span");
    text.className = "day-text";
    const title = document.createElement("span");
    title.className = "day-title";
    title.textContent = ev.title;
    text.appendChild(title);
    if (ev.location) {
      const loc = document.createElement("span");
      loc.className = "day-loc";
      loc.textContent = ev.location;
      text.appendChild(loc);
    }
    row.appendChild(time);
    row.appendChild(text);
    container.appendChild(row);
  });
}

function relativeIn(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return "jetzt";
  if (min < 60) return "in " + min + " min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return "in " + h + " h" + (m ? " " + m + " min" : "");
  const d = Math.round(h / 24);
  return "in " + d + (d === 1 ? " Tag" : " Tagen");
}

// ---------- Veranstaltungen in Bremen (Sitzung 6) ----------
// FEEDBACK „Veranstaltungen stimmen meistens auch nicht“: InfraNode lieferte
// zu 88 % Umland-Termine und für Bremen falsche Daten (siehe bremen-feste.js).
// Jetzt: geprüfte Liste der großen Bremer Veranstaltungen + Werder-Heimspiele
// aus den Fußball-Daten. Gezeigt wird, was läuft oder in den nächsten
// 10 Wochen beginnt (mindestens die nächsten drei).
const FEST_TAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function festDatum(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function festeAnstehend(jetztMs) {
  const heute = new Date(jetztMs);
  heute.setHours(0, 0, 0, 0);
  const liste = [];
  (window.BREMER_FESTE || []).forEach(function (e) {
    const von = festDatum(e.von);
    const bis = festDatum(e.bis);
    if (!von || !bis) return;
    const ende = new Date(bis.getFullYear(), bis.getMonth(), bis.getDate() + 1).getTime();
    if (ende <= jetztMs) return;
    liste.push({ name: e.name, ort: e.ort, hinweis: e.hinweis || "", von: von, bis: bis, ende: ende, zeit: false });
  });
  Object.keys(heimspiele).forEach(function (team) {
    heimspiele[team].forEach(function (h) {
      if (h.start.getTime() + 2 * 3600000 <= jetztMs) return;
      // Weiter entfernte Spiele stehen bei OpenLigaDB noch mit einem
      // Platzhalter (Sa 15:30), bis die DFL die Anstoßzeiten festlegt –
      // keine erfundene Uhrzeit zeigen.
      if (h.start.getTime() - jetztMs > 21 * 86400000) return;
      const tag = new Date(h.start.getFullYear(), h.start.getMonth(), h.start.getDate());
      liste.push({ name: h.name, ort: h.ort, hinweis: "", von: tag, bis: tag, start: h.start, ende: h.start.getTime() + 2 * 3600000, zeit: true });
    });
  });
  liste.sort(function (a, b) { return (a.start || a.von) - (b.start || b.von); });
  const grenze = heute.getTime() + 70 * 86400000;
  return liste.filter(function (e, i) { return i < 3 || e.von.getTime() <= grenze; }).slice(0, 5);
}

function festTagKurz(d) {
  return FEST_TAGE[d.getDay()] + " " + d.getDate() + "." + (d.getMonth() + 1) + ".";
}

function festSpanne(e) {
  if (e.zeit) return festTagKurz(e.von);
  if (e.von.getTime() === e.bis.getTime()) return festTagKurz(e.von);
  const gleicherMonat = e.von.getMonth() === e.bis.getMonth();
  return e.von.getDate() + "." + (gleicherMonat ? "" : (e.von.getMonth() + 1) + ".") + "–" + e.bis.getDate() + "." + (e.bis.getMonth() + 1) + ".";
}

// "Läuft · noch 12 Tage" / "Morgen" / "Ab Fr · in 6 Tagen" / "Sa 17.10. · 15:30 Uhr · in 7 Tagen"
function festWann(e, jetztMs) {
  const heute = new Date(jetztMs);
  heute.setHours(0, 0, 0, 0);
  const tageBis = Math.round((e.von.getTime() - heute.getTime()) / 86400000);
  const uhr = e.zeit ? " · " + e.start.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr" : "";
  if (tageBis <= 0) {
    if (e.zeit) return "Heute" + uhr;
    const rest = Math.round((e.bis.getTime() - heute.getTime()) / 86400000);
    if (e.von.getTime() === e.bis.getTime()) return "Heute";
    return rest <= 0 ? "Läuft · heute letzter Tag" : "Läuft · noch " + (rest + 1) + " Tage, bis " + festTagKurz(e.bis);
  }
  if (tageBis === 1) return "Morgen" + uhr;
  const ab = e.von.getTime() === e.bis.getTime() || e.zeit ? festTagKurz(e.von) : "Ab " + festTagKurz(e.von);
  return ab + uhr + " · in " + tageBis + " Tagen";
}

function renderFeste(liste, jetztMs) {
  const box = els.eventsList;
  box.innerHTML = "";
  box.classList.remove("day-list");
  const held = liste[0];
  const card = document.createElement("div");
  card.className = "cal-hero fest-hero";
  const wann = document.createElement("div");
  wann.className = "cal-hero-when";
  wann.textContent = festWann(held, jetztMs);
  const titel = document.createElement("div");
  titel.className = "cal-hero-title";
  titel.textContent = held.name;
  const ort = document.createElement("div");
  ort.className = "cal-hero-loc";
  const einTag = held.zeit || held.von.getTime() === held.bis.getTime();
  ort.textContent = (einTag ? "" : festSpanne(held) + " · ") + held.ort;
  card.appendChild(wann);
  card.appendChild(titel);
  card.appendChild(ort);
  if (held.hinweis) {
    const h = document.createElement("div");
    h.className = "fest-hinweis";
    h.textContent = held.hinweis;
    card.appendChild(h);
  }
  box.appendChild(card);
  const rest = document.createElement("div");
  rest.className = "day-list";
  liste.slice(1).forEach(function (e) {
    const row = document.createElement("div");
    row.className = "day-row fest-row";
    const d = document.createElement("span");
    d.className = "day-time fest-datum";
    d.textContent = festSpanne(e);
    const text = document.createElement("span");
    text.className = "day-text";
    const t = document.createElement("span");
    t.className = "day-title";
    t.textContent = e.name;
    const o = document.createElement("span");
    o.className = "day-loc";
    o.textContent = [e.zeit ? e.start.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr" : "", e.ort].filter(function (x) { return !!x; }).join(" · ");
    text.appendChild(t);
    text.appendChild(o);
    const bald = document.createElement("span");
    bald.className = "fest-bald";
    const tage = Math.round((e.von.getTime() - new Date(jetztMs).setHours(0, 0, 0, 0)) / 86400000);
    const mehrtaegig = !e.zeit && e.von.getTime() !== e.bis.getTime();
    bald.textContent = tage < 0 || (tage === 0 && mehrtaegig) ? "läuft" : (tage === 0 ? "heute" : (tage === 1 ? "morgen" : "in " + tage + " T."));
    row.appendChild(d);
    row.appendChild(text);
    row.appendChild(bald);
    rest.appendChild(row);
  });
  box.appendChild(rest);
}

function updateEvents() {
  if (!els.eventsList) return;
  if ((CONFIG.veranstaltungenQuelle || "bremen") === "bremen") {
    const jetzt = Date.now();
    const liste = festeAnstehend(jetzt);
    if (!liste.length) { eventsAvailable = false; return; }
    renderFeste(liste, jetzt);
    eventsAvailable = true;
    markFresh("events");
    return;
  }

  fetch("https://infranode.dev/api/v1/cities/bremen/events?_=" + Date.now(), { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("Veranstaltungen-Abruf fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const payload = data && data.data && data.data.payload;
    const raw = (payload && Array.isArray(payload.events)) ? payload.events : [];
    const now = Date.now();

    // Nur anstehende Termine, chronologisch, keine bereits vergangenen —
    // die API liefert auch ältere/laufende Einträge mit.
    const upcoming = raw
      .filter(function (e) { return e && e.title && e.date_from && new Date(e.date_from).getTime() >= now; })
      .sort(function (a, b) { return new Date(a.date_from) - new Date(b.date_from); })
      .slice(0, CONFIG.eventsCount || 6);

    if (!upcoming.length) throw new Error("Keine anstehenden Veranstaltungen erhalten");

    if ((CONFIG.terminListe || "tage") === "tage") {
      renderDayGroupedList(els.eventsList, upcoming.map(function (ev) {
        const d = new Date(ev.date_from);
        // 00:00 ist bei destination.one meist "keine genaue Uhrzeit".
        return { start: d, allDay: d.getHours() === 0 && d.getMinutes() === 0, title: ev.title, location: ev.location || "" };
      }));
      eventsAvailable = true;
      markFresh("events");
      return;
    }

    els.eventsList.innerHTML = "";
    upcoming.forEach(function (ev) {
      const d = new Date(ev.date_from);

      const item = document.createElement("div");
      item.className = "event-item";

      const dateBox = document.createElement("div");
      dateBox.className = "event-date";
      const day = document.createElement("span");
      day.className = "event-date-day";
      day.textContent = String(d.getDate());
      const month = document.createElement("span");
      month.className = "event-date-month";
      month.textContent = EVENT_MONTHS[d.getMonth()];
      dateBox.appendChild(day);
      dateBox.appendChild(month);

      const text = document.createElement("div");
      text.className = "event-text";
      const title = document.createElement("span");
      title.className = "event-title";
      title.textContent = ev.title;
      text.appendChild(title);
      // 00:00 ist bei destination.one meist "keine genaue Uhrzeit bekannt"
      // (ganztägig eingetragen), nicht wirklich Mitternacht — dann lieber
      // keine falsch-genaue Zeit vorgaukeln.
      const hasTime = !(d.getHours() === 0 && d.getMinutes() === 0);
      const timeStr = hasTime ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr" : "";
      const locLine = [timeStr, ev.location].filter(function (s) { return !!s; }).join(" · ");
      if (locLine) {
        const loc = document.createElement("span");
        loc.className = "event-location";
        loc.textContent = locLine;
        text.appendChild(loc);
      }

      item.appendChild(dateBox);
      item.appendChild(text);
      els.eventsList.appendChild(item);
    });

    eventsAvailable = true;
    markFresh("events");
  }).catch(function (err) {
    console.error(err);
    eventsAvailable = false;
  });
}

// ---------- Termine (privater Kalender über Cloudflare-Worker-Proxy) ----------
// Siehe CONFIG.calendarWorkerUrl für den Grund, warum der Umweg über einen
// eigenen Worker nötig ist (Apple liefert keinen CORS-Header).
//
// Lesen der ICS-Datei: kalender.js (Wiederholungen, Zeitzonen, abgesagte
// und mehrtägige Termine) – vorher stand hier ein Parser, der nur DTSTART
// las, siehe Kommentar dort.
function updateCalendar() {
  if (!els.calendarList || !CONFIG.calendarWorkerUrl) return;

  const bustUrl = CONFIG.calendarWorkerUrl +
    (CONFIG.calendarWorkerUrl.indexOf("?") === -1 ? "?" : "&") + "_=" + Date.now();

  fetch(bustUrl, { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("Kalender-Abruf fehlgeschlagen (" + res.status + ")");
    return res.text();
  }).then(function (text) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const heuteMs = startOfToday.getTime();
    const jetztMs = Date.now();

    // Nur, was noch kommt oder gerade läuft: ganztägige bis Tagesende,
    // Termine mit Uhrzeit bis zu ihrem Ende (ohne Ende: 30 min nach Beginn).
    // Ein laufender mehrtägiger Termin steht unter "Heute" mit "bis …".
    const upcoming = window.kalenderTermine(text, heuteMs, heuteMs + 62 * 86400000)
      .filter(function (t) {
        if (!t.titel) return false;
        if (t.ganztags) return t.ende > heuteMs;
        return t.ende > t.start ? t.ende > jetztMs : t.start > jetztMs - 30 * 60000;
      })
      .slice(0, CONFIG.calendarCount || 6)
      .map(function (t) {
        const laeuft = t.start < heuteMs;
        const mehrtaegig = t.ganztags ? t.ende - t.start > 26 * 3600000 : new Date(t.ende - 1).toDateString() !== new Date(t.start).toDateString();
        let bis = "";
        if (mehrtaegig) {
          const e = new Date(t.ganztags ? t.ende - 12 * 3600000 : t.ende);
          bis = "bis " + e.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" }) +
            (t.ganztags ? "" : " " + e.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }));
        }
        return {
          summary: t.titel,
          location: [bis, t.ort].filter(function (x) { return !!x; }).join(" · "),
          // Läuft schon seit gestern: unter "Heute" einordnen, wie ganztägig
          start: { date: new Date(laeuft ? heuteMs : t.start), allDay: t.ganztags || laeuft },
          ende: t.ende,
        };
      });

    lastCalendarEvents = upcoming.map(function (ev) {
      return { title: ev.summary, start: ev.start.date.getTime(), allDay: !!ev.start.allDay, location: ev.location || "", ende: ev.ende };
    });
    // Abruf hat geklappt – auch wenn gerade nichts ansteht (Einstellungen → Datenquellen).
    dataStand.calendar = Date.now();
    if (!upcoming.length) throw new Error("Keine anstehenden Termine gefunden");

    if ((CONFIG.terminListe || "tage") === "tage") {
      // Nächster (noch nicht vorbeier) Termin groß, der Rest als Liste.
      const nowMs = Date.now();
      const items = upcoming.map(function (ev) {
        return { start: ev.start.date, allDay: !!ev.start.allDay, title: ev.summary, location: ev.location || "" };
      });
      const heroIdx = items.findIndex ? items.findIndex(function (x) { return x.allDay || x.start.getTime() >= nowMs - 30 * 60000; }) : 0;
      const hero = items[Math.max(0, heroIdx)];
      els.calendarList.innerHTML = "";
      const card = document.createElement("div");
      card.className = "cal-hero";
      const when = document.createElement("div");
      when.className = "cal-hero-when";
      when.textContent = dayLabel(hero.start).split(" · ")[0] + (hero.allDay ? " · ganztägig" : " · " +
        hero.start.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr · " + relativeIn(hero.start.getTime() - nowMs));
      const t = document.createElement("div");
      t.className = "cal-hero-title";
      t.textContent = hero.title;
      card.appendChild(when);
      card.appendChild(t);
      if (hero.location) {
        const l = document.createElement("div");
        l.className = "cal-hero-loc";
        l.textContent = hero.location;
        card.appendChild(l);
      }
      els.calendarList.appendChild(card);
      const rest = document.createElement("div");
      els.calendarList.appendChild(rest);
      renderDayGroupedList(rest, items.filter(function (x) { return x !== hero; }).slice(0, 4));
      calendarAvailable = true;
      markFresh("calendar");
      return;
    }

    els.calendarList.innerHTML = "";
    upcoming.forEach(function (ev) {
      const d = ev.start.date;

      const item = document.createElement("div");
      item.className = "event-item";

      const dateBox = document.createElement("div");
      dateBox.className = "event-date";
      const day = document.createElement("span");
      day.className = "event-date-day";
      day.textContent = String(d.getDate());
      const month = document.createElement("span");
      month.className = "event-date-month";
      month.textContent = EVENT_MONTHS[d.getMonth()];
      dateBox.appendChild(day);
      dateBox.appendChild(month);

      const text = document.createElement("div");
      text.className = "event-text";
      const title = document.createElement("span");
      title.className = "event-title";
      title.textContent = ev.summary;
      text.appendChild(title);

      const timeStr = ev.start.allDay
        ? "Ganztägig"
        : d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
      const locLine = [timeStr, ev.location].filter(function (s) { return !!s; }).join(" · ");
      const loc = document.createElement("span");
      loc.className = "event-location";
      loc.textContent = locLine;
      text.appendChild(loc);

      item.appendChild(dateBox);
      item.appendChild(text);
      els.calendarList.appendChild(item);
    });

    calendarAvailable = true;
    markFresh("calendar");
  }).catch(function (err) {
    console.error(err);
    calendarAvailable = false;
  });
}

// ---------- Spruch des Tages (Advice Slip — bestätigt CORS-freundlich) ----------
// Wird zeichenweise "eingetippt", sobald das Panel sichtbar wird (siehe
// startQuoteTypewriter() und der Hook in showPanel()). Lädt die Daten
// schon vorher neu, tippt aber erst los, wenn der Text auch zu sehen ist.
let quoteFullText = null;
let quoteTypeTimer = null;

// Großes, blasses Anführungszeichen als Hintergrund-Wasserzeichen für die
// sonst leeren Text-Panels (Spruch/Trivia/Quiz/Rätsel) — ECHTER BUG bei der
// ersten Version: als reines CSS ::after mit negativem z-index gebaut, aber
// ohne dass ein Vorfahre einen eigenen Stacking-Context hatte, ist der
// negative z-index bis zum Wurzel-Stacking-Context der Seite "durchgereicht"
// worden und landete dort hinter praktisch allem — komplett unsichtbar,
// selbst bei voller Deckkraft (im Browser mit einem knallroten Debug-
// Hintergrund nachgewiesen). Ein echtes DOM-Element statt eines Pseudo-
// Elements umgeht das Problem zuverlässig.
// glyph: "„" für den Spruch, "?" für Rätsel/Quiz – ein Anführungszeichen
// hinter einer Quizfrage ergab keinen Sinn.
function appendPanelWatermark(container, glyph) {
  const mark = document.createElement("div");
  mark.className = "panel-watermark" + (glyph === "?" ? " is-frage" : "");
  mark.textContent = glyph || "„";
  container.appendChild(mark);
}

// ---------- Lokale Trefferquote für Trivia/Quiz ----------
// Die Multiple-Choice-Chips sahen bisher wie Knöpfe aus, waren aber rein
// dekorativ — man konnte gar nicht wirklich mitraten, nur zuschauen, wie
// nach ein paar Sekunden die richtige Antwort aufleuchtet. Jetzt sind sie
// echt antippbar (siehe attachChoiceInteractivity), und eine simple
// Trefferquote in localStorage (kein Backend, kein Account, bleibt nur
// auf diesem einen iPad) macht daraus ein echtes Mitmach-Panel statt
// eines zweiten Zuschau-Panels. Nur Trivia + Quiz, weil nur die
// Multiple-Choice-Optionen haben — das Rätsel-Panel ist eine offene
// Frage ohne Auswahl, da gibt's nichts zum Antippen.
const KNOWLEDGE_SCORE_KEY = "tafelKnowledgeScore";

function loadKnowledgeScore() {
  try {
    const raw = localStorage.getItem(KNOWLEDGE_SCORE_KEY);
    if (!raw) return { correct: 0, total: 0 };
    const parsed = JSON.parse(raw);
    return { correct: parsed.correct || 0, total: parsed.total || 0 };
  } catch (e) {
    return { correct: 0, total: 0 };
  }
}

let knowledgeScore = loadKnowledgeScore();

function knowledgeScoreText() {
  return knowledgeScore.total > 0
    ? (knowledgeScore.correct + "/" + knowledgeScore.total + " richtig")
    : "Antwort antippen zum Mitraten";
}

function recordGuess(isCorrect) {
  knowledgeScore.total++;
  if (isCorrect) knowledgeScore.correct++;
  try {
    localStorage.setItem(KNOWLEDGE_SCORE_KEY, JSON.stringify(knowledgeScore));
  } catch (e) {
    console.error(e);
  }
  const text = knowledgeScoreText();
  const badges = document.querySelectorAll(".knowledge-score-badge");
  for (let i = 0; i < badges.length; i++) badges[i].textContent = text;
}

function appendKnowledgeScoreBadge(container) {
  const badge = document.createElement("div");
  badge.className = "knowledge-score-badge";
  badge.textContent = knowledgeScoreText();
  container.appendChild(badge);
}

// Macht die Multiple-Choice-Chips wirklich antippbar: erster Tap
// entscheidet, weiterer Tap auf dieselbe Frage tut nichts mehr
// (choicesEl.is-answered sperrt). clearPendingReveal räumt den
// eigentlich für später geplanten Auto-Reveal-Timer auf, sonst würde der
// träge nachträglich nochmal draufklicken — er hat zu dem Zeitpunkt
// eh nichts mehr zu tun, ist aber sonst noch aktiv im Hintergrund.
function attachChoiceInteractivity(choicesEl, clearPendingReveal) {
  const chips = choicesEl.querySelectorAll(".trivia-choice");
  for (let i = 0; i < chips.length; i++) {
    chips[i].addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (choicesEl.classList.contains("is-answered")) return;
      clearPendingReveal();
      const isCorrect = this.classList.contains("correct");
      if (!isCorrect) this.classList.add("is-wrong-pick");
      choicesEl.classList.add("is-answered", "is-revealed");
      recordGuess(isCorrect);
    });
  }
}

function renderQuoteShell() {
  if (!els.quoteBlock) return;
  els.quoteBlock.innerHTML = "";
  appendPanelWatermark(els.quoteBlock);

  const mark = document.createElement("div");
  mark.className = "quote-mark";
  mark.textContent = "“";
  els.quoteBlock.appendChild(mark);

  const text = document.createElement("div");
  text.className = "quote-text" + ((CONFIG.spruchSchrift || "serif") === "serif" ? " is-serif" : "");

  const typed = document.createElement("span");
  typed.id = "quoteTypedText";
  text.appendChild(typed);

  const cursor = document.createElement("span");
  cursor.id = "quoteCursor";
  cursor.className = "typewriter-cursor";
  text.appendChild(cursor);

  els.quoteBlock.appendChild(text);

  if (quoteAuthor) {
    const author = document.createElement("div");
    author.className = "quote-author quote-author-new";
    author.id = "quoteAuthor";
    author.textContent = "— " + quoteAuthor;
    els.quoteBlock.appendChild(author);
  }
}

function startQuoteTypewriter() {
  if (!quoteFullText) return;
  const typedEl = document.getElementById("quoteTypedText");
  const cursorEl = document.getElementById("quoteCursor");
  if (!typedEl) return;

  if (quoteTypeTimer) clearInterval(quoteTypeTimer);
  typedEl.textContent = "";
  if (cursorEl) cursorEl.className = "typewriter-cursor";

  const full = quoteFullText;
  let i = 0;
  quoteTypeTimer = setInterval(function () {
    i++;
    typedEl.textContent = full.slice(0, i);
    if (i >= full.length) {
      clearInterval(quoteTypeTimer);
      quoteTypeTimer = null;
      if (cursorEl) cursorEl.className = "typewriter-cursor done";
    }
  }, 35);
}

// Deutsche Sprüche aus sprueche.js (IDEEN S1): ohne Netz, zufällig ohne
// direkte Wiederholung. CONFIG.spruchQuelle "deutsch" (Standard) |
// "advice" (bisherige englische Quelle).
let lastSpruchIndex = -1;
let quoteAuthor = "";

function pickSpruch() {
  if (typeof SPRUECHE === "undefined" || !SPRUECHE.length) return null;
  let i = Math.floor(Math.random() * SPRUECHE.length);
  if (SPRUECHE.length > 1 && i === lastSpruchIndex) i = (i + 1) % SPRUECHE.length;
  lastSpruchIndex = i;
  return SPRUECHE[i];
}

function updateQuote() {
  if (!els.quoteBlock) return;
  if ((CONFIG.spruchQuelle || "deutsch") === "deutsch") {
    const sp = pickSpruch();
    if (sp) {
      quoteFullText = sp.t;
      quoteAuthor = sp.a;
      renderQuoteShell();
      const pe = document.getElementById("panel-quote");
      if (pe && pe.className.indexOf("active") !== -1) startQuoteTypewriter();
      quoteAvailable = true;
      return;
    }
    // Sammlung fehlt (z. B. sprueche.js nicht mitkopiert): kein Rückfall
    // auf die englische Quelle – auf der Tafel erscheint nichts Englisches.
    quoteAvailable = false;
    return;
  }

  // Cache-Buster, weil manche CORS-Proxies/CDNs vor dieser API sonst
  // immer denselben Spruch ausliefern.
  fetch("https://api.adviceslip.com/advice?_=" + Date.now()).then(function (res) {
    if (!res.ok) throw new Error("Spruch-Abruf fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const advice = data && data.slip && data.slip.advice;
    if (!advice) throw new Error("Kein Spruch erhalten");

    quoteFullText = advice;
    renderQuoteShell();

    const panelEl = document.getElementById("panel-quote");
    const isActive = panelEl && panelEl.className.indexOf("active") !== -1;
    if (isActive) startQuoteTypewriter();

    quoteAvailable = true;
  }).catch(function (err) {
    console.error(err);
    quoteAvailable = false;
  });
}

// ---------- Trivia-Panel ("Auf den Tag genau") ----------
// Quelle (Sitzung 6, FEEDBACK „Auf den Tag genau ist random und nicht
// geil“): die von der Wikipedia-Redaktion ausgewählten Jahrestage der
// deutschen Hauptseite (Wikipedia:Hauptseite/Jahrestage/<Monat>/<Tag>) –
// fünf bekannte Ereignisse, Geburts- und Todestage, als ganzer deutscher
// Satz formuliert, bevorzugt runde Jahrestage, oft mit Bild. Vorher kam ein
// beliebiger Eintrag aus dem Rohfeed (z. B. „Erstausgabe des Gong“).
// Dazu Ereignisse mit Bremen-/Werder-Bezug aus bremen-tage.js. Die Tafel
// tippt das Ereignis als Frage (gleicher Schreibmaschinen-Mechanismus wie beim Spruch des Tages,
// startQuoteTypewriter oben). Auflösung als echtes Multiple-Choice
// (drei Jahreszahlen, eine davon richtig) statt einer nackten Zahl —
// die Tafel hat kein Touch, also wird nach einer Denkpause automatisch
// aufgelöst statt auf einen Tipp zu warten.
const TRIVIA_MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

let triviaFullText = null;
let triviaYear = null;
let triviaBild = null;      // { gross, klein, w, h, titel } oder null
let triviaStapel = [];      // heutige Ereignisse, gemischt (jede Runde das nächste)
let triviaStapelPos = 0;
let triviaStapelTag = "";
let triviaStapelDatum = null; // Date des Tages, aus dem der Stapel stammt
let triviaLaedt = "";         // Tag, für den gerade geladen wird
let triviaBremen = false;     // Ereignis aus bremen-tage.js
let triviaTypeTimer = null;
let triviaRevealTimer = null;

// Zwei plausible, aber garantiert falsche Jahreszahlen um das richtige
// Jahr herum bauen (nie in der Zukunft, nie vor 1) und zusammen mit der
// echten Antwort mischen.
function buildTriviaChoices(correctYear) {
  const thisYear = new Date().getFullYear();
  const offsets = [];
  // Höchstens 200 Würfe: Für Jahre, um die herum es keine zwei gültigen
  // Kandidaten gibt (vor Christus kommt aus dem Feed als negative Zahl),
  // lief die Schleife vorher endlos und fror die Tafel ein. Danach feste
  // Abstände als Rückfall.
  for (let versuch = 0; offsets.length < 2 && versuch < 200; versuch++) {
    const sign = Math.random() < 0.5 ? -1 : 1;
    // In Fünferschritten (10–75 Jahre): Die Hauptseite nimmt runde
    // Jahrestage, 2026 enden die richtigen Jahre also auf 1 oder 6 – mit
    // beliebigen Abständen wäre die Lösung an der Endziffer zu erkennen.
    const delta = sign * 5 * (2 + Math.floor(Math.random() * 14));
    const candidate = correctYear + delta;
    if (candidate === correctYear || candidate < 1 || candidate > thisYear) continue;
    if (offsets.indexOf(candidate) !== -1) continue;
    offsets.push(candidate);
  }
  for (let k = 1; offsets.length < 2 && k < 100; k++) {
    const c = correctYear + (k % 2 ? 1 : -1) * 10 * Math.ceil(k / 2);
    if (c !== correctYear && offsets.indexOf(c) === -1 && c <= thisYear) offsets.push(c);
  }
  const all = [correctYear, offsets[0], offsets[1]];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = all[i]; all[i] = all[j]; all[j] = tmp;
  }
  return all;
}

// Bild zum Ereignis: das erste Vorschaubild der verlinkten Artikel. Seiten
// mit Jahreszahl im Titel ("Rugby-Union-Weltmeisterschaft 2003") fallen weg –
// deren Bild ist oft ein Logo mit genau der Zahl, nach der gefragt wird.
// Ein Eintrag der Jahrestage-Seite (Wikitext) → { text, year, bild, links }
// "*<div …>[[Datei:X.jpg|{{Bildgröße|WGA|800|508}}|alt=…|Unterschrift]]</div>
//  {{Jahrestag|1846}}Der … [[William Lassell]] ent&shy;deckt [[Triton (Mond)|Triton]] …"
function jahrestagLesen(zeile) {
  let bild = null;
  let t = zeile.replace(/^\*\s*/, "");
  t = t.replace(/<div[^>]*>\s*\[\[(?:Datei|File|Bild):([^|\]]+)\|([^\]]*)\]\]\s*<\/div>/, function (_, datei, rest) {
    const g = /\{\{Bildgr(?:ö|oe)(?:ß|ss)e\|[^|}]*\|(\d+)\|(\d+)\}\}/.exec(rest);
    const teile = rest.replace(/\{\{[^}]*\}\}/g, "").split("|").filter(function (x) { return x && x.indexOf("alt=") !== 0; });
    bild = { datei: datei.trim(), w: g ? +g[1] : 4, h: g ? +g[2] : 3, titel: teile.length ? teile[teile.length - 1].trim() : "" };
    return "";
  });
  const j = /\{\{Jahrestag\|(-?\d{1,4})(?:\|[^}]*)?\}\}/.exec(t);
  if (!j) return null;
  t = t.replace(j[0], "");
  t = t.replace(/<small>\s*\(Bild\)\s*<\/small>/g, "")
    .replace(/<ref[^>]*\/>/g, "").replace(/<ref[\s\S]*?<\/ref>/g, "")
    .replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "");
  // Vorlagen von innen nach außen: {{ß}} → ß, {{nowrap|x}} → x, sonst letzter Wert
  for (let n = 0; n < 10 && /\{\{[^{}]*\}\}/.test(t); n++) {
    t = t.replace(/\{\{([^{}]*)\}\}/g, function (_, innen) {
      const teile = innen.split("|");
      if (teile[0].trim() === "ß") return "ß";
      return teile.length > 1 ? teile[teile.length - 1] : "";
    });
  }
  t = t.replace(/'{2,}/g, "").replace(/&shy;/g, "\u00AD").replace(/&nbsp;/g, "\u00A0");
  // Verlinkungen auflösen; Ziele merken (fürs Bild), mit dem Text davor:
  // "In [[Hubei]] bricht …" – Orte nach "in/bei/heute …" sind selten das Thema.
  const links = [];
  let aus = "";
  let pos = 0;
  const re = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
  let m;
  while ((m = re.exec(t))) {
    aus += t.slice(pos, m.index);
    const ziel = m[1].split("#")[0].trim();
    const label = m[2] != null ? m[2] : m[1];
    const ort = /(?:^|\s)(?:in|im|In|Im|nach|aus|bei|heute|auf)\s*$/.test(aus);
    if (ziel && !ort && !/^\d{1,4}$/.test(ziel) && !/^\d{1,2}\.\s/.test(ziel) && ziel.indexOf(":") === -1) links.push(ziel);
    aus += label;
    pos = re.lastIndex;
  }
  aus += t.slice(pos);
  const text = decodeHtmlEntities(aus).replace(/\s+/g, " ").replace(/\s([,.;:])/g, "$1").trim();
  if (text.length < 20) return null;
  return { text: text, year: +j[1], bild: bild, links: links };
}

function jahrestageLesen(wikitext) {
  const m = /<onlyinclude>([\s\S]*?)<\/onlyinclude>/.exec(wikitext || "");
  if (!m) return [];
  return m[1].split("\n").filter(function (z) { return /^\*/.test(z); })
    .map(jahrestagLesen)
    .filter(function (e) { return e && e.year > 0; }); // v. Chr. taugt nicht fürs Jahreszahl-Raten
}

// Bilder für alle Ereignisse des Tages mit EINER Anfrage: die Datei der
// Redaktion (imageinfo) bzw. das Artikelbild des ersten passenden Links
// (pageimages). Wikipedia sperrt bei vielen schnellen Abrufen – deshalb
// gebündelt und nur einmal am Tag.
function jahrestageBilder(liste) {
  const titel = [];
  liste.forEach(function (e) {
    if (e.bild && e.bild.datei) titel.push("Datei:" + e.bild.datei);
    else e.links.slice(0, 4).forEach(function (l) { if (titel.indexOf(l) === -1) titel.push(l); });
  });
  if (!titel.length) return Promise.resolve(liste);
  const url = "https://de.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&redirects=1" +
    "&prop=pageimages%7Cimageinfo&piprop=thumbnail&pithumbsize=500&iiprop=url&iiurlwidth=500&titles=" +
    encodeURIComponent(titel.slice(0, 50).join("|"));
  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error("Jahrestage-Bilder: HTTP " + res.status);
    return res.json();
  }).then(function (data) {
    const q = (data && data.query) || {};
    const umweg = {};
    (q.normalized || []).concat(q.redirects || []).forEach(function (n) { umweg[n.from] = n.to; });
    const seiten = {};
    (q.pages || []).forEach(function (p) { seiten[p.title] = p; });
    const seite = function (t) { let k = t; for (let i = 0; i < 3 && umweg[k]; i++) k = umweg[k]; return seiten[k] || null; };
    liste.forEach(function (e) {
      if (e.bild && e.bild.datei) {
        const p = seite("Datei:" + e.bild.datei);
        const ii = p && p.imageinfo && p.imageinfo[0];
        e.bild = ii && ii.thumburl ? { gross: ii.thumburl, klein: ii.thumburl, w: ii.thumbwidth || e.bild.w, h: ii.thumbheight || e.bild.h, titel: e.bild.titel } : null;
        return;
      }
      e.bild = null;
      for (let i = 0; i < e.links.length && i < 4; i++) {
        const p = seite(e.links[i]);
        const th = p && p.thumbnail;
        if (th && th.source && th.width && th.height) { e.bild = { gross: th.source, klein: th.source, w: th.width, h: th.height, titel: p.title }; break; }
      }
    });
    return liste;
  }).catch(function (err) {
    console.error(err);
    liste.forEach(function (e) { if (e.bild && !e.bild.gross) e.bild = null; });
    return liste; // ohne Bilder ist der Text genauso richtig
  });
}

function naechstesTriviaEreignis() {
  if (!triviaStapel.length) return false;
  // Nach Mitternacht stammt der Stapel noch vom Vortag (Abruf stündlich) –
  // gleich neu holen; bis dahin steht über dem Ereignis sein echtes Datum.
  const heute = new Date();
  if (triviaStapelDatum && heute.getDate() !== triviaStapelDatum.getDate()) updateTrivia();
  const ev = triviaStapel[triviaStapelPos % triviaStapel.length];
  triviaStapelPos++;
  triviaFullText = ev.text;
  triviaYear = ev.year;
  triviaBremen = !!ev.bremen;
  triviaBild = ev.bild || null;
  renderTriviaShell();
  return true;
}

function renderTriviaBild(block) {
  const b = triviaBild;
  if (!b) return;
  // Kasten nach dem Seitenverhältnis: quer 320 px breit, hoch 360 px hoch.
  const r = Math.max(0.7, Math.min(1.6, b.w / b.h));
  const bw = r >= 1 ? 320 : Math.round(360 * r);
  const bh = Math.round(bw / r);

  const fig = document.createElement("figure");
  fig.className = "trivia-bild";
  fig.style.width = bw + "px";
  const rahmen = document.createElement("div");
  rahmen.className = "trivia-bild-rahmen";
  rahmen.style.height = bh + "px";
  const img = document.createElement("img");
  img.alt = "";
  img.onload = function () { fig.classList.add("is-geladen"); };
  img.onerror = function () {
    if (!fig.parentNode) return; // längst durch ein neues Ereignis ersetzt
    if (img.getAttribute("src") !== b.klein) { img.src = b.klein; return; }
    if (fig.parentNode) fig.parentNode.removeChild(fig);
    block.classList.remove("mit-bild");
    block.style.paddingRight = "";
  };
  rahmen.appendChild(img);
  fig.appendChild(rahmen);
  if (b.titel) {
    const cap = document.createElement("figcaption");
    cap.textContent = b.titel;
    fig.appendChild(cap);
  }
  block.appendChild(fig);
  block.classList.add("mit-bild");
  block.style.paddingRight = (bw + 48 + 44) + "px";
  img.src = b.gross;
}

// "10. Oktober – in welchem Jahr?" bzw. nach der Auflösung
// "10. Oktober 1846 · vor 180 Jahren" (Bremen: "Bremen · …")
function triviaDatumText(aufgeloest) {
  const tag = triviaStapelDatum || new Date();
  const vorn = (triviaBremen ? "Bremen · " : "") + tag.getDate() + ". " + TRIVIA_MONTHS[tag.getMonth()];
  if (!aufgeloest || triviaYear == null) return vorn + " – in welchem Jahr?";
  const vor = tag.getFullYear() - triviaYear;
  return vorn + " " + triviaYear + (vor > 0 ? " · vor " + vor + (vor === 1 ? " Jahr" : " Jahren") : "");
}

function triviaAufloesungZeigen() {
  const el = document.getElementById("triviaDateLabel");
  if (el) el.textContent = triviaDatumText(true);
}

function renderTriviaShell() {
  if (!els.triviaBlock) return;
  els.triviaBlock.innerHTML = "";
  els.triviaBlock.classList.remove("mit-bild");
  els.triviaBlock.style.paddingRight = "";
  appendPanelWatermark(els.triviaBlock, "?");
  appendKnowledgeScoreBadge(els.triviaBlock);
  renderTriviaBild(els.triviaBlock);

  const now = new Date();
  const dateLabel = document.createElement("div");
  dateLabel.className = "trivia-date";
  dateLabel.id = "triviaDateLabel";
  dateLabel.textContent = triviaDatumText(false);
  els.triviaBlock.appendChild(dateLabel);

  const text = document.createElement("div");
  text.className = "trivia-text";

  const typed = document.createElement("span");
  typed.id = "triviaTypedText";
  text.appendChild(typed);

  const cursor = document.createElement("span");
  cursor.id = "triviaCursor";
  cursor.className = "typewriter-cursor";
  text.appendChild(cursor);

  els.triviaBlock.appendChild(text);

  const choices = document.createElement("div");
  choices.className = "trivia-choices";
  choices.id = "triviaChoices";
  els.triviaBlock.appendChild(choices);
}

function startTriviaReveal() {
  if (!triviaFullText || triviaYear == null) return;
  const typedEl = document.getElementById("triviaTypedText");
  const cursorEl = document.getElementById("triviaCursor");
  const choicesEl = document.getElementById("triviaChoices");
  if (!typedEl || !choicesEl) return;
  const ratenBlock = choicesEl.parentNode;
  if (ratenBlock) ratenBlock.classList.remove("is-raten");

  if (triviaTypeTimer) clearInterval(triviaTypeTimer);
  if (triviaRevealTimer) clearTimeout(triviaRevealTimer);
  typedEl.textContent = "";
  if (cursorEl) cursorEl.className = "typewriter-cursor";
  choicesEl.className = "trivia-choices";
  choicesEl.innerHTML = "";

  const options = buildTriviaChoices(triviaYear);
  options.forEach(function (year) {
    const chip = document.createElement("span");
    chip.className = "trivia-choice" + (year === triviaYear ? " correct" : "");
    chip.textContent = String(year);
    choicesEl.appendChild(chip);
  });
  attachChoiceInteractivity(choicesEl, function () {
    if (triviaRevealTimer) { clearTimeout(triviaRevealTimer); triviaRevealTimer = null; }
    stopRevealCountdown(els.triviaBlock);
    triviaAufloesungZeigen();
  });

  const full = triviaFullText;
  let i = 0;
  triviaTypeTimer = setInterval(function () {
    i++;
    typedEl.textContent = full.slice(0, i);
    if (i >= full.length) {
      clearInterval(triviaTypeTimer);
      triviaTypeTimer = null;
      if (cursorEl) cursorEl.className = "typewriter-cursor done";
      choicesEl.classList.add("is-shown");
      const triviaDelay = 6000;
      startRevealCountdown(els.triviaBlock, triviaDelay);
      triviaRevealTimer = setTimeout(function () {
        choicesEl.classList.add("is-revealed");
        stopRevealCountdown(els.triviaBlock);
        triviaAufloesungZeigen();
      }, triviaDelay);
    }
  }, 35);
}

function updateTrivia() {
  if (!els.triviaBlock) return;

  const now = new Date();
  const tag = (now.getMonth() + 1) + "-" + now.getDate();
  // Die Auswahl ändert sich nur einmal am Tag – also auch nur einmal holen.
  if (tag === triviaStapelTag || tag === triviaLaedt) return;
  triviaLaedt = tag;
  const seite = "Wikipedia:Hauptseite/Jahrestage/" + TRIVIA_MONTHS[now.getMonth()] + "/" + now.getDate();

  fetch("https://de.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&origin=*&prop=wikitext&page=" +
    encodeURIComponent(seite)).then(function (res) {
    if (!res.ok) throw new Error("Jahrestage-Abruf fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const liste = jahrestageLesen(data && data.parse && data.parse.wikitext);
    // Bremen/Werder zuerst (bremen-tage.js), dann die Auswahl der Redaktion
    const bremen = (window.BREMER_TAGE || []).filter(function (e) {
      return e.datum === ("0" + (now.getMonth() + 1)).slice(-2) + "-" + ("0" + now.getDate()).slice(-2);
    }).map(function (e) {
      return { text: e.text, year: e.jahr, bild: null, links: e.bildArtikel ? [e.bildArtikel] : [], bremen: true };
    });
    const alle = bremen.concat(liste);
    if (alle.length < 2) throw new Error("Jahrestage: zu wenige Einträge für " + seite);
    return jahrestageBilder(alle);
  }).then(function (stapel) {
    triviaLaedt = "";
    triviaStapel = stapel;
    triviaStapelPos = 0;
    triviaStapelTag = tag;
    triviaStapelDatum = now;
    triviaAvailable = true;
    // Gezogen wird erst beim Zeigen (showPanel) – läuft das Panel gerade,
    // gleich das erste Ereignis des neuen Tages.
    const panelEl = document.getElementById("panel-trivia");
    const isActive = panelEl && panelEl.className.indexOf("active") !== -1;
    if (isActive && naechstesTriviaEreignis()) startTriviaReveal();
  }).catch(function (err) {
    triviaLaedt = "";
    console.error(err);
    // Kein Ersatz aus dem Zufallsfeed: lieber kein Panel als ein belangloses.
    // Der Stapel vom Vortag bleibt nicht stehen.
    if (triviaStapelTag !== tag) { triviaStapel = []; triviaAvailable = false; }
  });
}

// ---------- Allgemeinwissen-Panel (Open Trivia Database) ----------
// Bewusst getrennt vom "Auf den Tag genau"-Panel oben: dort geht es um
// Fakten, die HEUTE vor X Jahren passiert sind (ans Datum gebunden),
// hier um zufälliges Allgemeinwissen aus jeder Rubrik, ohne Datumsbezug.
// Gleicher Tipp-dann-Multiple-Choice-Mechanismus, nur mit vier Antworten
// statt drei Jahreszahlen.
let quizQuestion = null;
let quizChoices = null;
let quizTypeTimer = null;
let quizRevealTimer = null;

// Open Trivia DB liefert HTML-Entities (&quot;, &#039; …) statt Klartext.
// Ein unsichtbares <textarea> lässt den Browser die Entities zuverlässig
// dekodieren, ohne ein eigenes Entity-Mapping pflegen zu müssen.
function decodeHtmlEntities(str) {
  const ta = document.createElement("textarea");
  ta.innerHTML = str;
  return ta.value;
}

function renderQuizShell() {
  if (!els.quizBlock) return;
  els.quizBlock.innerHTML = "";
  appendPanelWatermark(els.quizBlock, "?");
  appendKnowledgeScoreBadge(els.quizBlock);

  const category = document.createElement("div");
  category.className = "trivia-date";
  category.id = "quizCategory";
  els.quizBlock.appendChild(category);

  const text = document.createElement("div");
  text.className = "trivia-text";

  const typed = document.createElement("span");
  typed.id = "quizTypedText";
  text.appendChild(typed);

  const cursor = document.createElement("span");
  cursor.id = "quizCursor";
  cursor.className = "typewriter-cursor";
  text.appendChild(cursor);

  els.quizBlock.appendChild(text);

  const choices = document.createElement("div");
  choices.className = "trivia-choices";
  choices.id = "quizChoices";
  els.quizBlock.appendChild(choices);
}

// Auflösung mit Ansage (IDEEN T1/RÄ1): ein dünner Balken läuft bis zur
// Auflösung ab, dazu "Auflösung in 10 s" — statt dass die Antwort ohne
// Vorwarnung auftaucht. Ein Element je Block, wird wiederverwendet.
function startRevealCountdown(block, ms) {
  if (!block) return;
  block.classList.remove("is-revealed-block");
  block.classList.add("is-raten"); // Antworten stehen – Mitrate-Hinweis zeigen
  let box = block.querySelector(".reveal-countdown");
  if (!box) {
    box = document.createElement("div");
    box.className = "reveal-countdown";
    box.innerHTML = '<span class="reveal-label"></span><span class="reveal-track"><span class="reveal-fill"></span></span>';
    block.appendChild(box);
  }
  const fill = box.querySelector(".reveal-fill");
  const label = box.querySelector(".reveal-label");
  label.textContent = "Auflösung in " + Math.round(ms / 1000) + " s";
  box.classList.add("is-running");
  fill.style.transition = "none";
  fill.style.transform = "scaleX(1)";
  void fill.offsetWidth;
  fill.style.transition = "transform " + ms + "ms linear";
  fill.style.transform = "scaleX(0)";
}

function stopRevealCountdown(block) {
  const box = block ? block.querySelector(".reveal-countdown") : null;
  if (box) box.classList.remove("is-running");
  // Aufgelöst: Mitrate-Hinweis ausblenden (CSS .is-revealed-block).
  if (block) block.classList.add("is-revealed-block");
}

function startQuizReveal() {
  if (!quizQuestion || !quizChoices) return;
  const typedEl = document.getElementById("quizTypedText");
  const cursorEl = document.getElementById("quizCursor");
  const choicesEl = document.getElementById("quizChoices");
  const categoryEl = document.getElementById("quizCategory");
  if (!typedEl || !choicesEl) return;
  const ratenBlock = choicesEl.parentNode;
  if (ratenBlock) ratenBlock.classList.remove("is-raten");

  if (quizTypeTimer) clearInterval(quizTypeTimer);
  if (quizRevealTimer) clearTimeout(quizRevealTimer);
  typedEl.textContent = "";
  if (cursorEl) cursorEl.className = "typewriter-cursor";
  if (categoryEl) categoryEl.textContent = quizQuestion.category;
  choicesEl.className = "trivia-choices";
  choicesEl.innerHTML = "";

  quizChoices.options.forEach(function (opt) {
    const chip = document.createElement("span");
    chip.className = "trivia-choice text-choice" + (opt === quizChoices.correct ? " correct" : "");
    chip.textContent = opt;
    choicesEl.appendChild(chip);
  });
  attachChoiceInteractivity(choicesEl, function () {
    if (quizRevealTimer) { clearTimeout(quizRevealTimer); quizRevealTimer = null; }
    stopRevealCountdown(els.quizBlock);
  });

  // Auflösung erst zur Hälfte der gesamten Panel-Anzeigezeit statt fix 3s
  // nach dem Fertigtippen — lässt genug Zeit zum eigenen Raten, bevor die
  // richtige Antwort markiert wird. Rechnet ab Start dieser Funktion, damit
  // unterschiedlich lange Fragen (variable Tippdauer) nicht die Ratezeit
  // auffressen; eine Mindestpause sorgt dafür, dass es bei sehr langen
  // Fragen trotzdem noch etwas Spannung gibt.
  const startedAt = Date.now();
  const panelDuration = (CONFIG.panelDurations && CONFIG.panelDurations.quiz) || CONFIG.panelDurationMs || 22000;
  const halfMs = panelDuration / 2;

  const full = quizQuestion.text;
  let i = 0;
  quizTypeTimer = setInterval(function () {
    i++;
    typedEl.textContent = full.slice(0, i);
    if (i >= full.length) {
      clearInterval(quizTypeTimer);
      quizTypeTimer = null;
      if (cursorEl) cursorEl.className = "typewriter-cursor done";
      choicesEl.classList.add("is-shown");
      const elapsed = Date.now() - startedAt;
      const revealDelay = Math.max(halfMs - elapsed, 1500);
      startRevealCountdown(els.quizBlock, revealDelay);
      quizRevealTimer = setTimeout(function () {
        choicesEl.classList.add("is-revealed");
        stopRevealCountdown(els.quizBlock);
      }, revealDelay);
    }
  }, 35);
}

// Open Trivia DB blockt bei zu dichten Anfragen kurzzeitig mit 429 (eigene
// Rate-Limit-Regel des Anbieters, ca. 1 Anfrage pro 5s je IP). Ohne Retry
// blieb das Panel dann bis zum nächsten regulären Intervall (eine Stunde,
// CONFIG.refreshQuizMs) leer — spürbar lang für einen einzelnen kurzen
// Ausrutscher. Bei einem Fehlschlag jetzt bis zu drei erneute Versuche mit
// wachsendem Abstand, bevor endgültig bis zum nächsten Intervall aufgegeben
// wird.
let quizRetryTimer = null;
const QUIZ_RETRY_DELAYS_MS = [20000, 60000, 180000];

// Deutsche Fragen (quiz.js, FRAGEN 17) statt der englischen Open Trivia
// DB: lokal, jedes Mal eine neue Frage, wenn das Panel erscheint. Der
// Rest-Stapel liegt in localStorage, damit nach dem Neuladen nicht
// dieselben Fragen wiederkommen (höchstens so lang wie die Sammlung).
function quizLokal() {
  return (CONFIG.quizQuelle || "deutsch") === "deutsch" && typeof QUIZ_FRAGEN !== "undefined" && QUIZ_FRAGEN.length > 0;
}

function naechsteQuizFrage() {
  const n = QUIZ_FRAGEN.length;
  let rest = null;
  try { rest = JSON.parse(localStorage.getItem("tafelQuizRest") || "null"); } catch (e) { rest = null; }
  if (!Array.isArray(rest)) rest = [];
  rest = rest.filter(function (i) { return typeof i === "number" && i >= 0 && i < n; });
  if (!rest.length) {
    for (let i = 0; i < n; i++) rest.push(i);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = rest[i]; rest[i] = rest[j]; rest[j] = tmp;
    }
  }
  const q = QUIZ_FRAGEN[rest.shift()];
  try { localStorage.setItem("tafelQuizRest", JSON.stringify(rest)); } catch (e) { /* voll/privat: dann eben ohne Gedächtnis */ }

  quizQuestion = { text: q.f, category: q.k };
  const options = q.x.concat([q.r]);
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = options[i]; options[i] = options[j]; options[j] = tmp;
  }
  quizChoices = { options: options, correct: q.r };
  renderQuizShell();
  const panelEl = document.getElementById("panel-quiz");
  if (panelEl && panelEl.className.indexOf("active") !== -1) startQuizReveal();
  quizAvailable = true;
}

function updateQuiz(retryCount) {
  if (!els.quizBlock) return;
  if (quizLokal()) {
    // Die Frage wird erst beim Zeigen des Panels gezogen (showPanel) –
    // stündlich nichts tun, sonst wechselte sie womöglich mitten im Raten.
    quizAvailable = true;
    return;
  }
  if ((CONFIG.quizQuelle || "deutsch") === "deutsch") {
    // quiz.js fehlt: lieber kein Quiz als englische Fragen.
    quizAvailable = false;
    return;
  }
  retryCount = retryCount || 0;
  if (quizRetryTimer) { clearTimeout(quizRetryTimer); quizRetryTimer = null; }

  // Cache-Buster wie bei allen anderen Feeds hier — sonst liefert ein
  // zwischengeschalteter Cache stur dieselbe Frage über Stunden hinweg.
  // Nur Allgemeinwissen, Naturwissenschaft, Geografie, Geschichte (IDEEN
  // Q1) statt Anime-/Videospiel-Spezialfragen; abschaltbar per
  // CONFIG.quizKategorien = [].
  const cats = CONFIG.quizKategorien || [9, 17, 22, 23];
  const cat = cats.length ? "&category=" + cats[Math.floor(Math.random() * cats.length)] : "";
  fetch("https://opentdb.com/api.php?amount=1&type=multiple" + cat + "&_=" + Date.now(), { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("Quiz-Abruf fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const item = data && Array.isArray(data.results) && data.results[0];
    if (!item) throw new Error("Keine Quiz-Frage erhalten");

    quizQuestion = {
      text: decodeHtmlEntities(item.question),
      category: decodeHtmlEntities(item.category),
    };
    const correct = decodeHtmlEntities(item.correct_answer);
    const options = item.incorrect_answers.map(decodeHtmlEntities).concat([correct]);
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = options[i]; options[i] = options[j]; options[j] = tmp;
    }
    quizChoices = { options: options, correct: correct };

    renderQuizShell();

    const panelEl = document.getElementById("panel-quiz");
    const isActive = panelEl && panelEl.className.indexOf("active") !== -1;
    if (isActive) startQuizReveal();

    quizAvailable = true;
  }).catch(function (err) {
    console.error(err);
    if (retryCount < QUIZ_RETRY_DELAYS_MS.length) {
      quizRetryTimer = setTimeout(function () {
        updateQuiz(retryCount + 1);
      }, QUIZ_RETRY_DELAYS_MS[retryCount]);
    } else {
      quizAvailable = false;
    }
  });
}

// ---------- Rätsel-des-Tages-Panel ----------
// Keine externe API (siehe CONFIG.riddles-Kommentar in config.js) — eine
// feste lokale Sammlung. Früher pro Tag fest (Tag-des-Jahres-Index), das
// gleiche Rätsel blieb also von morgens bis abends stehen. Jetzt bei jedem
// Erreichen des Panels neu gewählt (siehe Aufruf von updateRiddle() in
// showPanel) — bei mehreren Karussell-Runden pro Stunde kommen so viele
// verschiedene Rätsel am Tag statt nur eines. Gleiche Tipp-und-Warten-
// Dramaturgie wie Quiz/Trivia, nur ohne Multiple-Choice: die Lösung wird
// als Text erst zur Hälfte der Panel-Anzeigezeit eingeblendet.
let riddleQuestion = null;
let riddleAnswerText = null;
let riddleTypeTimer = null;
let riddleRevealTimer = null;
let riddleAvailable = false;
let lastRiddleIndex = -1;

function pickNextRiddle() {
  const riddles = CONFIG.riddles || [];
  if (!riddles.length) return null;
  if (riddles.length === 1) return riddles[0];
  let idx;
  do {
    idx = Math.floor(Math.random() * riddles.length);
  } while (idx === lastRiddleIndex);
  lastRiddleIndex = idx;
  return riddles[idx];
}

function renderRiddleShell() {
  if (!els.riddleBlock) return;
  els.riddleBlock.innerHTML = "";
  appendPanelWatermark(els.riddleBlock, "?");

  const label = document.createElement("div");
  label.className = "trivia-date";
  label.textContent = "RÄTSEL DES TAGES";
  els.riddleBlock.appendChild(label);

  const text = document.createElement("div");
  text.className = "trivia-text";

  const typed = document.createElement("span");
  typed.id = "riddleTypedText";
  text.appendChild(typed);

  const cursor = document.createElement("span");
  cursor.id = "riddleCursor";
  cursor.className = "typewriter-cursor";
  text.appendChild(cursor);

  els.riddleBlock.appendChild(text);

  const answer = document.createElement("div");
  answer.className = "riddle-answer";
  answer.id = "riddleAnswer";
  els.riddleBlock.appendChild(answer);
}

function startRiddleReveal() {
  if (!riddleQuestion) return;
  const typedEl = document.getElementById("riddleTypedText");
  const cursorEl = document.getElementById("riddleCursor");
  const answerEl = document.getElementById("riddleAnswer");
  if (!typedEl || !answerEl) return;

  if (riddleTypeTimer) clearInterval(riddleTypeTimer);
  if (riddleRevealTimer) clearTimeout(riddleRevealTimer);
  typedEl.textContent = "";
  if (cursorEl) cursorEl.className = "typewriter-cursor";
  answerEl.className = "riddle-answer";
  answerEl.textContent = "Lösung: " + riddleAnswerText;

  // Gleiches Prinzip wie beim Quiz-Panel: Auflösung erst zur Hälfte der
  // gesamten Panel-Anzeigezeit statt sofort nach dem Fertigtippen, damit
  // genug Zeit zum eigenen Grübeln bleibt.
  const startedAt = Date.now();
  const panelDuration = (CONFIG.panelDurations && CONFIG.panelDurations.riddle) || CONFIG.panelDurationMs || 24000;
  const halfMs = panelDuration / 2;

  const full = riddleQuestion;
  let i = 0;
  riddleTypeTimer = setInterval(function () {
    i++;
    typedEl.textContent = full.slice(0, i);
    if (i >= full.length) {
      clearInterval(riddleTypeTimer);
      riddleTypeTimer = null;
      if (cursorEl) cursorEl.className = "typewriter-cursor done";
      const elapsed = Date.now() - startedAt;
      const revealDelay = Math.max(halfMs - elapsed, 1500);
      startRevealCountdown(els.riddleBlock, revealDelay);
      riddleRevealTimer = setTimeout(function () {
        answerEl.classList.add("is-shown");
        stopRevealCountdown(els.riddleBlock);
      }, revealDelay);
    }
  }, 35);
}

function updateRiddle() {
  if (!els.riddleBlock) return;
  const pick = pickNextRiddle();
  if (!pick) { riddleAvailable = false; return; }

  riddleQuestion = pick.q;
  riddleAnswerText = pick.a;
  renderRiddleShell();

  const panelEl = document.getElementById("panel-riddle");
  const isActive = panelEl && panelEl.className.indexOf("active") !== -1;
  if (isActive) startRiddleReveal();

  riddleAvailable = true;
}

// ---------- Pendel-Panel (Arbeitsweg zu Max Müller GmbH) ----------
// Rad- und Auto-Zeit kommen als Direktverbindung (directModes, ohne
// Transit) von Transitous, die Bus/ÖPNV-Zeit als normale Routenplanung.
// Ist eine Adresse mal nicht auflösbar oder eine Route nicht berechenbar,
// wird die jeweilige Zeile einfach als "nicht verfügbar" markiert statt
// das ganze Panel kaputt zu machen — das Panel selbst wird übersprungen,
// wenn gar keine der drei Routen klappt.
let commuteAvailable = false;
let commuteCoords = null;

function geocodeOne(query) {
  const url = API_BASE + "/v1/geocode?text=" + encodeURIComponent(query) + "&numResults=1";

  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error("Geokodierung fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const match = Array.isArray(data) ? data[0] : null;
    if (!match || typeof match.lat !== "number" || typeof match.lon !== "number") {
      throw new Error('Adresse nicht gefunden: "' + query + '"');
    }
    return { lat: match.lat, lon: match.lon };
  });
}

function resolveCommuteCoords() {
  if (commuteCoords) return Promise.resolve(commuteCoords);

  return Promise.all([
    geocodeOne(CONFIG.homeAddress),
    geocodeOne(CONFIG.workAddress),
  ]).then(function (results) {
    commuteCoords = { home: results[0], work: results[1] };
    return commuteCoords;
  });
}

// Aus einer Liste von Itinerary-Objekten die mit der kürzesten Dauer
// herauspicken (statt einfach das erste zu nehmen — die Antwortreihen-
// folge von Transitous ist nicht zwingend nach Dauer sortiert, das hat
// vorher gelegentlich absurd lange "schnellste" ÖPNV-Zeiten ausgespuckt).
function pickFastestItinerary(items) {
  if (!items || !items.length) return null;
  let best = items[0];
  let bestDur = itineraryDurationMin(best);
  if (bestDur === null) bestDur = Infinity;

  items.forEach(function (it) {
    const d = itineraryDurationMin(it);
    if (d !== null && d < bestDur) {
      bestDur = d;
      best = it;
    }
  });

  return best;
}

function fetchDirectItinerary(from, to, mode) {
  const url = API_BASE + "/v6/plan?fromPlace=" + from.lat + "," + from.lon +
    "&toPlace=" + to.lat + "," + to.lon +
    "&directModes=" + mode + "&transitModes=";

  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error("Routenabruf (" + mode + ") fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const items = (data && Array.isArray(data.direct)) ? data.direct : [];
    const best = pickFastestItinerary(items);
    if (!best) throw new Error("Keine " + mode + "-Route gefunden");
    return best;
  });
}

// departDate: gleiche Prognose-Uhrzeit wie Auto/Rad — ohne Uhrzeit fragte
// Transitous "ab jetzt", nachts kam dadurch "ab 05:25" als Verbindung zur
// 07:30-Prognose heraus (IDEEN AW1).
function fetchTransitItinerary(from, to, departDate) {
  const url = API_BASE + "/v6/plan?fromPlace=" + from.lat + "," + from.lon +
    "&toPlace=" + to.lat + "," + to.lon +
    "&directModes=&transitModes=TRANSIT" +
    (departDate ? "&time=" + encodeURIComponent(departDate.toISOString()) : "");

  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error("Routenabruf (ÖPNV) fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const items = (data && Array.isArray(data.itineraries)) ? data.itineraries : [];
    const best = pickFastestItinerary(items);
    if (!best) throw new Error("Keine ÖPNV-Route gefunden");
    return best;
  });
}

// Nächster Zeitpunkt, zu dem tatsächlich losgefahren würde (siehe
// CONFIG.commuteTypicalDepartTime) — an Werktagen die nächste noch nicht
// verstrichene Abfahrtszeit, sonst der nächste Werktag. Grund: die Tafel
// hängt an der Wand und zeigt das Pendel-Panel auch abends oder am
// Wochenende in der Rotation — "live jetzt" wäre dann fast immer
// irreführend kurz (kein Berufsverkehr um 22 Uhr oder Sonntagmittag).
// TomTom bekommt diesen Zeitpunkt über departAt und liefert die für DANN
// typische Verkehrslage statt der Lage genau jetzt.
function nextCommuteDepartureDate() {
  const timeStr = CONFIG.commuteTypicalDepartTime || "07:30";
  const parts = timeStr.split(":");
  const hh = parseInt(parts[0], 10) || 7;
  const mm = parseInt(parts[1], 10) || 30;

  const now = new Date();
  let d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);

  if (d.getTime() <= now.getTime()) {
    d = new Date(d.getTime() + 86400000);
  }
  while (d.getDay() === 0 || d.getDay() === 6) {
    d = new Date(d.getTime() + 86400000);
  }
  return d;
}

// Echte Routendaten über die TomTom Routing API statt der bisherigen
// Luftlinien-Schätzung — bei travelMode "car" zusätzlich mit Live-/
// vorhergesagtem Verkehr (traffic=true). Nur aktiv, wenn CONFIG.tomtomApiKey
// gesetzt ist; die Aufrufer weiter unten fallen sonst/bei Fehlern auf die
// alte Transitous-Route + Plausibilitätsschätzung zurück (keine harte
// Abhängigkeit von einem einzelnen Drittanbieter).
function fetchTomTomRoute(from, to, travelMode, departDate) {
  if (!CONFIG.tomtomApiKey) {
    return Promise.reject(new Error("kein TomTom-Key konfiguriert"));
  }
  const wantsTraffic = travelMode === "car";
  const url = "https://api.tomtom.com/routing/1/calculateRoute/" +
    from.lat + "," + from.lon + ":" + to.lat + "," + to.lon +
    "/json?key=" + encodeURIComponent(CONFIG.tomtomApiKey) +
    "&travelMode=" + travelMode + "&routeType=fastest" +
    (wantsTraffic ? "&traffic=true" : "") +
    (departDate ? "&departAt=" + encodeURIComponent(departDate.toISOString()) : "");
  // Kein "&_=<Zeit>"-Cache-Brecher wie bei den anderen Quellen: die Routing-
  // API lehnt jeden unbekannten Parameter mit HTTP 400 ab ("parameter [_]
  // not supported") – Auto und Rad liefen dadurch seit Juli immer über die
  // Ersatzroute. TomTom schickt selbst "Cache-Control: no-cache".

  return fetch(url, { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("TomTom-Routenabruf (" + travelMode + ") fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const route = data && Array.isArray(data.routes) ? data.routes[0] : null;
    const summary = route && route.summary;
    if (!summary || typeof summary.travelTimeInSeconds !== "number") {
      throw new Error("TomTom-Antwort (" + travelMode + ") ohne verwertbare Route");
    }
    const minutes = Math.max(1, Math.round(summary.travelTimeInSeconds / 60));
    const delayMin = wantsTraffic && typeof summary.trafficDelayInSeconds === "number"
      ? Math.round(summary.trafficDelayInSeconds / 60)
      : 0;

    // Echte Streckenführung für die Kartenansicht (siehe renderCommuteMap)
    // — [lon, lat]-Paare aus den Leg-Punkten. Fehlt das Feld oder ist leer,
    // zeichnet renderCommuteMap später einfach eine gerade Linie
    // Start→Ziel statt der echten Route — kein harter Fehler.
    const points = [];
    if (route && Array.isArray(route.legs)) {
      route.legs.forEach(function (leg) {
        if (leg && Array.isArray(leg.points)) {
          leg.points.forEach(function (p) {
            if (p && typeof p.longitude === "number" && typeof p.latitude === "number") {
              points.push([p.longitude, p.latitude]);
            }
          });
        }
      });
    }

    return { minutes: minutes, delayMin: delayMin, points: points };
  });
}

// Baut das Auto-Ergebnis fürs Pendel-Panel: erst TomTom mit Verkehr
// versuchen (falls konfiguriert), bei Erfolg direkt verwenden. Ohne Key
// oder bei jedem Fehler fällt es auf den bisherigen Weg zurück —
// Transitous-Route + Plausibilitätsschätzung.
// Letzte echte TomTom-Fahrzeit je Verkehrsmittel (FEEDBACK 10.10.: "immer
// 6 Minuten"). Gegenprobe am 10.10. für Julians Weg (4,4 km, über die
// Weser): TomTom 10,8 min, Transitous-Autoroute 5,5 min (kennt weder
// Verkehr noch Ampeln), Luftlinien-Schätzung 6 min – beide Ersatzwerte also
// halb so lang. Fällt TomTom aus, zeigt die Tafel deshalb den zuletzt
// gemessenen TomTom-Wert als "geschätzt" und sonst gar keine Autozeit.
const ROUTE_ZULETZT_KEY = "tafelRouteZuletzt";
const ROUTE_ZULETZT_MAX_MS = 14 * 86400000;

function routeZuletzt(modus, minuten) {
  let alle = null;
  try { alle = JSON.parse(localStorage.getItem(ROUTE_ZULETZT_KEY) || "null"); } catch (e) { alle = null; }
  if (!alle || typeof alle !== "object") alle = {};
  if (minuten != null) {
    alle[modus] = { min: minuten, at: Date.now() };
    try { localStorage.setItem(ROUTE_ZULETZT_KEY, JSON.stringify(alle)); } catch (e) { /* egal */ }
    return null;
  }
  const z = alle[modus];
  return z && typeof z.min === "number" && Date.now() - z.at < ROUTE_ZULETZT_MAX_MS ? z : null;
}

function fetchCarItinerary(from, to, distanceMeters, departDate) {
  // Ohne TomTom-Schlüssel: Transitous-Autoroute, aber nie als echte Angabe
  // (freie Fahrt ohne Ampeln und Verkehr).
  function viaMotis() {
    return fetchDirectItinerary(from, to, "CAR")
      .then(function (it) {
        const check = plausibleMinutesOrFallback(
          itineraryDurationMin(it), estimateCarMinutes(distanceMeters), "Auto"
        );
        return { itinerary: it, minutes: check.minutes, estimated: true, delayMin: null, source: "ohne-verkehr" };
      })
      .catch(function (err) {
        console.error(err);
        return null;
      });
  }

  if (!CONFIG.tomtomApiKey) return viaMotis();

  return fetchTomTomRoute(from, to, "car", departDate)
    .then(function (r) {
      routeZuletzt("car", r.minutes);
      return {
        itinerary: null, minutes: r.minutes, estimated: false, delayMin: r.delayMin,
        source: "tomtom", points: r.points,
      };
    })
    .catch(function (err) {
      console.error("TomTom-Route (Auto) nicht verfügbar:", err);
      const z = routeZuletzt("car");
      if (!z) return null; // lieber keine Autozeit als eine halb so lange
      return { itinerary: null, minutes: z.min, estimated: true, delayMin: null, source: "zuletzt", zuletztAt: z.at };
    });
}

// Analog fürs Fahrrad: TomTom liefert die reale Straßenführung (Kanäle,
// Umwege etc.) statt der reinen Luftlinien-Schätzung. Stau spielt beim Rad
// kaum eine Rolle, deshalb ohne traffic=true — departAt wird trotzdem
// mitgeschickt, schadet nicht und hält den Code für Auto/Rad einheitlich.
function fetchBikeItinerary(from, to, distanceMeters, departDate) {
  function viaMotis() {
    return fetchDirectItinerary(from, to, "BIKE")
      .then(function (it) {
        const check = plausibleMinutesOrFallback(
          itineraryDurationMin(it), estimateBikeMinutes(distanceMeters), "Fahrrad"
        );
        return {
          itinerary: it, minutes: check.minutes, estimated: check.estimated,
          source: check.estimated ? "fallback" : "motis",
        };
      })
      .catch(function (err) {
        console.error(err);
        return { itinerary: null, minutes: estimateBikeMinutes(distanceMeters), estimated: true, source: "fallback" };
      });
  }

  if (!CONFIG.tomtomApiKey) return viaMotis();

  // Ersatz Transitous-Rad passt (10.10.: 15,3 statt TomTom 13,3 min) –
  // Radwege kennt jeder Routenplaner, Verkehr spielt kaum eine Rolle.
  return fetchTomTomRoute(from, to, "bicycle", departDate)
    .then(function (r) {
      return { itinerary: null, minutes: r.minutes, estimated: false, source: "tomtom", points: r.points };
    })
    .catch(function (err) {
      console.error("TomTom-Route (Rad) nicht verfügbar, nutze Ersatzroute:", err);
      return viaMotis();
    });
}

function itineraryDurationMin(itinerary) {
  try {
    if (typeof itinerary.duration === "number") {
      return Math.round(itinerary.duration / 60);
    }
    if (itinerary.startTime && itinerary.endTime) {
      const ms = new Date(itinerary.endTime).getTime() - new Date(itinerary.startTime).getTime();
      return Math.round(ms / 60000);
    }
  } catch (e) {
    console.error(e);
  }
  return null;
}

// Liest, falls vorhanden, echte Live-/Verspätungsdaten aus den Legs der
// ÖPNV-Route (dieselbe Idee wie die Verspätungsanzeige im Abfahrten-Panel).
// Sind keine Live-Daten in der Antwort enthalten, wird nichts behauptet
// (kein erfundener "pünktlich"-Status) — die Zeile bleibt dann einfach ohne
// Zusatztext.
function itineraryRealtimeNote(itinerary) {
  try {
    const legs = itinerary.legs || [];
    let hasRealTime = false;
    let maxDelayMin = 0;

    legs.forEach(function (leg) {
      if (leg.realTime) hasRealTime = true;
      const sched = leg.scheduledStartTime || leg.scheduledDeparture;
      const real = leg.startTime || leg.departure;
      if (sched && real) {
        const d = Math.round((new Date(real).getTime() - new Date(sched).getTime()) / 60000);
        if (d > maxDelayMin) maxDelayMin = d;
      }
    });

    if (!hasRealTime) return null;
    return maxDelayMin >= 1
      ? ("+" + maxDelayMin + " Min. Verspätung · Live-Daten")
      : "pünktlich · Live-Daten";
  } catch (e) {
    console.error(e);
    return null;
  }
}

// Welche Linie(n) tatsächlich genutzt werden — mehrere bei Umstiegen.
// Mehrere bekannte Feldpfade probieren (Transitous/MOTIS-Feldnamen von
// hier aus nicht 1:1 verifizierbar), sonst bleibt die Liste einfach leer
// statt "undefined" anzuzeigen.
function itineraryLineNames(itinerary) {
  try {
    const legs = itinerary.legs || [];
    const names = [];
    legs.forEach(function (leg) {
      if (!leg || leg.mode === "WALK") return;
      const name = (leg.route && (leg.route.shortName || leg.route.name)) ||
        leg.routeShortName || leg.tripShortName || leg.displayName;
      if (name && names.indexOf(name) === -1) names.push(name);
    });
    return names;
  } catch (e) {
    console.error(e);
    return [];
  }
}

// Live-Abfahrtszeit des ersten Nicht-Fußweg-Legs — damit die Tafel nicht
// nur "23 min" zeigt, sondern auch WANN die genutzte Bahn/der Bus wirklich
// fährt (nutzt dieselben Echtzeit-Felder wie oben).
function itineraryFirstHeadsign(itinerary) {
  const legs = (itinerary && itinerary.legs) || [];
  for (let i = 0; i < legs.length; i++) {
    if (legs[i] && legs[i].mode !== "WALK") return legs[i].headsign || null;
  }
  return null;
}

function itineraryFirstDeparture(itinerary) {
  try {
    const legs = itinerary.legs || [];
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      if (!leg || leg.mode === "WALK") continue;
      const when = leg.startTime || leg.departure || leg.scheduledStartTime || leg.scheduledDeparture;
      if (when) return new Date(when);
    }
  } catch (e) {
    console.error(e);
  }
  return null;
}

// Fahrrad/Auto-Zeiten der Transitous-Direktrouten gegen eine grobe
// Luftlinien-Schätzung prüfen — dieselbe Idee wie schon bei der Gehzeit
// (resolveWalkTime): die Direktrouting-Antwort hat schon mal absurde
// Umwege geliefert (97-Minuten-Bus-Bug, 20-Minuten-Fußweg-Bug), deshalb
// hier vorsorglich dieselbe Plausibilitätsprüfung statt blind zu
// vertrauen. Weicht die API-Zeit zu stark ab, wird die Schätzung
// verwendet und in der UI transparent als "geschätzt" markiert.
function estimateBikeMinutes(distanceMeters) {
  // ~15 km/h effektiv (inkl. Ampeln/Kreuzungen), 25% Aufschlag ggü.
  // Luftlinie für reale Straßenführung.
  const km = (distanceMeters / 1000) * 1.25;
  return Math.max(1, Math.round((km / 15) * 60));
}

function estimateCarMinutes(distanceMeters) {
  // ~32 km/h effektiv innerstädtisch (inkl. Ampeln), 30% Aufschlag ggü.
  // Luftlinie für reale Straßenführung.
  const km = (distanceMeters / 1000) * 1.3;
  return Math.max(1, Math.round((km / 32) * 60));
}

function plausibleMinutesOrFallback(apiMinutes, fallbackMinutes, label) {
  const maxOk = Math.max(fallbackMinutes * 2.2, fallbackMinutes + 10);
  const minOk = fallbackMinutes * 0.35;

  if (apiMinutes == null || apiMinutes > maxOk || apiMinutes < minOk) {
    if (apiMinutes != null) {
      console.warn(
        label + "-Zeit wirkt unplausibel (" + apiMinutes + " min, erwartet ~" +
        fallbackMinutes + " min) — nutze Schätzung."
      );
    }
    return { minutes: fallbackMinutes, estimated: true };
  }
  return { minutes: apiMinutes, estimated: false };
}

const COMMUTE_MODES = [
  { key: "bike", icon: "🚲", label: "Fahrrad" },
  { key: "bus", icon: "🚌", label: "Bus / ÖPNV" },
  { key: "car", icon: "🚗", label: "Auto" },
];

// ---------- "Wer gewinnt heute?"-Rennen statt Karte ----------
// Vorher: Leaflet + OpenStreetMap-Kacheln mit eingezeichneten Routen. Trotz
// mehrerer Politur-Runden nie richtig "hochwertig" — generische Karten-
// kacheln lassen sich schwer schick gestalten — UND eine schwere JS-
// Abhängigkeit (Kachel-Laden, SVG-Pfad-Animation), die in einer Phase, wo
// jedes Gramm Performance zählt, nicht mehr zu rechtfertigen war. Jetzt
// stattdessen: eine große Sieger-Anzeige (welches Verkehrsmittel gerade
// am schnellsten ist) plus drei Vergleichsbalken darunter, deren Länge die
// relative Dauer zeigt — auf einen Blick verständlich, kein Kartenmaterial
// nötig, rein CSS-Breiten-Übergang (genauso billig wie der Fortschritts-
// balken oben im Header).
function fastestCommuteMode(results) {
  let best = null;
  // Eine Schätzung gewinnt nur, wenn es gar keinen echten Wert gibt – sonst
  // stünde "Los um …" auf einer Zahl, die niemand gemessen hat.
  const echteDa = COMMUTE_MODES.some(function (m) { const r = results[m.key]; return r && r.minutes != null && !r.estimated; });
  COMMUTE_MODES.forEach(function (m) {
    const res = results[m.key];
    if (!res || res.minutes == null) return;
    if (echteDa && res.estimated) return;
    if (!best || res.minutes < best.minutes) {
      best = { key: m.key, icon: m.icon, label: m.label, minutes: res.minutes, estimated: res.estimated, source: res.source };
    }
  });
  return best;
}

function renderCommuteHero(results) {
  if (!els.commuteHero) return;
  els.commuteHero.innerHTML = "";

  const winner = fastestCommuteMode(results);
  if (!winner) {
    els.commuteHero.innerHTML = '<div class="view-placeholder">Keine Route verfügbar</div>';
    return;
  }

  const color = (CONFIG.commuteModeColors && CONFIG.commuteModeColors[winner.key]) || "#5b6b78";
  els.commuteHero.style.setProperty("--winner-color", color);

  const icon = document.createElement("span");
  icon.className = "commute-hero-icon";
  icon.textContent = winner.icon;
  els.commuteHero.appendChild(icon);

  const textWrap = document.createElement("div");
  textWrap.className = "commute-hero-text";

  // Ohne Vorhersage (kein TomTom-Key) bleibt es bei "heute" — mit
  // Vorhersage ist der Bezugstag/-zeitpunkt variabel (siehe
  // nextCommuteDepartureDate), deshalb dann explizit benennen statt
  // fälschlich "heute" zu behaupten, wenn eigentlich der nächste
  // Werktagmorgen gemeint ist.
  const tag = document.createElement("span");
  tag.className = "commute-hero-tag";
  tag.textContent = results.forecastDate ? "Voraussichtlich am schnellsten" : "Heute am schnellsten";
  textWrap.appendChild(tag);

  // Fern-Info ist die Handlung, nicht die Rechengröße (IDEEN AW1):
  // "Los um 07:49" = Zielankunft minus Fahrzeit minus 5 Min Puffer; bei
  // ÖPNV die echte Abfahrt der gefundenen Verbindung.
  const target = String(CONFIG.workArrivalTarget || "08:00").split(":");
  const base = results.forecastDate || new Date();
  const arriveBy = new Date(base.getFullYear(), base.getMonth(), base.getDate(), parseInt(target[0], 10) || 8, parseInt(target[1], 10) || 0);
  let leave = new Date(arriveBy.getTime() - (winner.minutes + 5) * 60000);
  if (winner.key === "bus" && results.bus && results.bus.departure) leave = results.bus.departure;
  const arrival = new Date(leave.getTime() + winner.minutes * 60000);
  const hm = function (d) { return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }); };
  const isToday = new Date().toDateString() === leave.toDateString();

  const big = document.createElement("span");
  big.className = "commute-hero-big";
  big.textContent = (isToday ? "Los um " : leave.toLocaleDateString("de-DE", { weekday: "short" }) + " los um ") + hm(leave);
  // Bisher unsichtbar, obwohl das Panel im Hintergrund längst zwischen
  // echten TomTom-Verkehrsdaten und grober Schätzung unterscheidet
  // (results[mode].source) — nur der "geschätzt"-Fall hatte eine Anzeige,
  // der Normalfall (echte Live-Daten) keine. Jetzt beide sichtbar.
  if (winner.estimated) {
    const est = document.createElement("span");
    est.className = "commute-hero-estimated";
    est.textContent = "geschätzt";
    big.appendChild(est);
  } else if (winner.source === "tomtom") {
    const live = document.createElement("span");
    live.className = "commute-hero-live";
    live.textContent = verkehrsArt(results);
    big.appendChild(live);
  }
  textWrap.appendChild(big);

  const label = document.createElement("span");
  label.className = "commute-hero-label";
  label.textContent = winner.minutes + " Min mit " + winner.label + " · Ankunft " + hm(arrival) + " · Ziel " + (CONFIG.workArrivalTarget || "08:00");
  textWrap.appendChild(label);

  if (results.forecastDate) {
    const forecast = document.createElement("span");
    forecast.className = "commute-hero-forecast";
    const wd = results.forecastDate.toLocaleDateString("de-DE", { weekday: "short" });
    const hm = results.forecastDate.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    forecast.textContent = "Prognose für " + wd + ", " + hm + " Uhr";
    textWrap.appendChild(forecast);
  }

  els.commuteHero.appendChild(textWrap);
}

// TomTom rechnet für den Abfahrtszeitpunkt (departAt): kurz davor mit der
// echten Lage, Tage vorher mit der üblichen Lage zu dieser Zeit. "Live"
// stimmt also nur, wenn die Fahrt bald ansteht.
function verkehrsArt(results) {
  const ab = results && results.forecastDate;
  return !ab || ab.getTime() - Date.now() < 90 * 60000 ? "Live-Verkehr" : "Verkehrsprognose";
}

function renderCommuteRace(results) {
  if (!els.commuteRace) return;
  els.commuteRace.innerHTML = "";

  const known = COMMUTE_MODES
    .map(function (m) { return { mode: m, res: results[m.key] }; })
    .filter(function (e) { return e.res && e.res.minutes != null; });

  const maxMinutes = known.length
    ? Math.max.apply(null, known.map(function (e) { return e.res.minutes; }))
    : 0;
  const winner = fastestCommuteMode(results);
  const fillTargets = [];

  COMMUTE_MODES.forEach(function (m) {
    const res = results[m.key];
    const color = (CONFIG.commuteModeColors && CONFIG.commuteModeColors[m.key]) || "#5b6b78";
    const available = !!(res && res.minutes != null);
    const isWinner = !!(winner && winner.key === m.key);

    const row = document.createElement("div");
    row.className = "commute-race-row" + (available ? "" : " unavailable") + (isWinner ? " is-winner" : "");
    row.style.setProperty("--mode-color", color);

    const head = document.createElement("div");
    head.className = "commute-race-head";

    const icon = document.createElement("span");
    icon.className = "commute-race-icon";
    icon.textContent = m.icon;
    head.appendChild(icon);

    const label = document.createElement("span");
    label.className = "commute-race-label";
    label.textContent = m.label;
    head.appendChild(label);

    if (isWinner) {
      const badge = document.createElement("span");
      badge.className = "commute-race-badge";
      badge.textContent = "Schnellster";
      head.appendChild(badge);
    }

    // Neben der Karte ist die Spalte zu schmal für Balken – dort steht die
    // Zeit direkt in der Kopfzeile (CSS blendet je nach Ansicht um).
    const kopfZeit = document.createElement("span");
    kopfZeit.className = "commute-race-kopfzeit";
    kopfZeit.textContent = available ? (res.minutes + " min") : "–";
    head.appendChild(kopfZeit);

    row.appendChild(head);

    const track = document.createElement("div");
    track.className = "commute-race-track";

    const fill = document.createElement("div");
    fill.className = "commute-race-fill";
    track.appendChild(fill);

    // Kürzere Zeit = kürzerer Balken (relativ zum langsamsten Verkehrs-
    // mittel), damit "kürzer ist besser" auf einen Blick stimmt. Mindestens
    // 8%, sonst wäre ein sehr schnelles Verkehrsmittel kaum als Balken
    // erkennbar.
    const pct = available && maxMinutes > 0
      ? Math.max(8, Math.round((res.minutes / maxMinutes) * 100))
      : 0;
    fillTargets.push({ el: fill, pct: pct });

    // Zeit in eigener Spalte rechts statt auf dem Balken (dort war sie
    // mit 1,15:1 Kontrast unsichtbar, IDEEN AW1).
    const timeLabel = document.createElement("span");
    timeLabel.className = "commute-race-time is-column";
    timeLabel.textContent = available ? (res.minutes + " min") : "–";

    const trackRow = document.createElement("div");
    trackRow.className = "commute-race-trackrow";
    trackRow.appendChild(track);
    trackRow.appendChild(timeLabel);
    row.appendChild(trackRow);

    // Bus/ÖPNV: zusätzlich Linie(n) + wirkliche nächste Abfahrtszeit statt
    // nur einer nackten Minutenzahl — deutlich planbarer.
    if (m.key === "bus" && res) {
      const lineText = res.lines && res.lines.length ? "Linie " + res.lines.join("/") : "";
      const depText = res.departure
        ? "ab " + res.departure.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
        : "";
      const noteText = res.note || "";
      const extraText = [lineText, depText, noteText].filter(function (s) { return !!s; }).join(" · ");
      if (extraText) {
        const extra = document.createElement("div");
        extra.className = "commute-race-extra is-bus";
        extra._standard = extraText;
        extra.textContent = extraText;
        row.appendChild(extra);
      }
    } else if (m.key === "car" && res && res.source === "tomtom") {
      // Live-Verkehr über TomTom war erfolgreich — zeigen, ob und wie viel
      // Stau eingerechnet ist, statt nur eine nackte Minutenzahl.
      const extra = document.createElement("div");
      extra.className = "commute-race-extra";
      extra.textContent = res.delayMin > 0
        ? ("inkl. " + res.delayMin + " Min. Stau · " + verkehrsArt(results))
        : "keine Verzögerung · " + verkehrsArt(results);
      row.appendChild(extra);
    } else if (res && res.estimated) {
      const extra = document.createElement("div");
      extra.className = "commute-race-extra is-geschaetzt";
      if (res.source === "zuletzt") {
        const t = new Date(res.zuletztAt);
        extra.textContent = "geschätzt · Verkehrsdaten fehlen, zuletzt gemessen " +
          (t.toDateString() === new Date().toDateString() ? "heute " : t.toLocaleDateString("de-DE", { weekday: "short" }) + " ") +
          t.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      } else if (res.source === "ohne-verkehr") {
        extra.textContent = "geschätzt · ohne Verkehr und Ampeln";
      } else {
        extra.textContent = "geschätzt, keine Live-Route verfügbar";
      }
      row.appendChild(extra);
    }

    els.commuteRace.appendChild(row);
    if (m.key === "bus") aktualisiereBusZeile();
  });

  // Balken erst NACH dem Einfügen ins DOM auf die Zielbreite setzen (wie
  // schon beim Fortschrittsbalken oben), sonst überspringt der Browser den
  // Übergang und der Balken erscheint einfach fertig statt "einzurennen".
  // transform:scaleX statt width (siehe CSS-Kommentar bei .commute-race-fill)
  // — Bruch 0..1 statt Prozentangabe.
  setTimeout(function () {
    fillTargets.forEach(function (entry) {
      entry.el.style.transform = "scaleX(" + (entry.pct / 100) + ")";
    });
  }, 50);

  commuteAvailable = !!known.length;
  if (commuteAvailable) markFresh("commute");
}

// Web-Mercator-Y (EPSG:3857) für eine Breitengrad — Standardformel, damit
// die Route korrekt über dem TomTom-Kartenbild liegt (Kartenbilder werden
// in Mercator-Projektion gerendert, geradlinige Interpolation von Breiten-
// graden allein würde die Route leicht nach Norden/Süden verschieben).
function mercatorY(lat) {
  const rad = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

// ECHTER BUG gefunden (per curl direkt gegen TomTom getestet, nicht nur
// Sandbox-Netzwerk): die Static-Image-API gibt IMMER HTTP 400 zurück,
// sobald bbox UND width/height gleichzeitig gesetzt sind — unabhängig von
// Format, Stil oder Bildgröße (getestet von 512×512 bis 2048×1024, alle
// 400). bbox ALLEINE (ohne width/height) funktioniert, liefert aber nur
// ein winziges 291×291-Standardbild, verpixelt gestreckt auf Panelgröße.
// center+zoom+width+height funktioniert dagegen einwandfrei (200, echtes
// Bild in der angeforderten Größe) — deshalb hier auf center+zoom
// umgestellt. Weltpixel-Projektion + der "welcher Zoom passt in die
// Box"-Algorithmus sind Standard-Slippy-Map-Mathematik (dieselbe, die
// hinter Google-/Leaflet-Kartenausschnitten steckt).
function lonToWorldX(lon, zoom) {
  return ((lon + 180) / 360) * (256 * Math.pow(2, zoom));
}

function latToWorldY(lat, zoom) {
  return (0.5 - mercatorY(lat) / (2 * Math.PI)) * (256 * Math.pow(2, zoom));
}

function latRadClamped(lat) {
  const sinVal = Math.sin((lat * Math.PI) / 180);
  const radX2 = Math.log((1 + sinVal) / (1 - sinVal)) / 2;
  return Math.max(Math.min(radX2, Math.PI), -Math.PI) / 2;
}

// Größter Zoom, bei dem die Bounding Box (mit Rand) noch komplett in ein
// width×height-Bild passt — gleiches Grundprinzip wie Google Maps'
// getBoundsZoomLevel().
function zoomForBounds(minLon, minLat, maxLon, maxLat, mapW, mapH) {
  const WORLD_DIM = 256;
  const ZOOM_MAX = 19;
  const latFraction = (latRadClamped(maxLat) - latRadClamped(minLat)) / Math.PI;
  let lngDiff = maxLon - minLon;
  if (lngDiff < 0) lngDiff += 360;
  const lngFraction = lngDiff / 360;
  const latZoom = Math.floor(Math.log(mapH / WORLD_DIM / latFraction) / Math.LN2);
  const lngZoom = Math.floor(Math.log(mapW / WORLD_DIM / lngFraction) / Math.LN2);
  return Math.max(1, Math.min(latZoom, lngZoom, ZOOM_MAX));
}

// Kartenansicht mit eingezeichneter Route für den schnellsten Verkehrsmittel
// (Ersatz für die interaktive TomTom-Karte, die an fehlendem WebGL2 auf
// Safari 12 scheitert — siehe Kommentar bei .commute-map-wrap in style.css).
// Statisches Kartenbild von TomToms Static-Image-API + eine SVG-Linie
// darüber, deren Koordinaten aus den echten Routen-Punkten (falls
// vorhanden) oder sonst einer geraden Start→Ziel-Linie berechnet werden.
let letzteArbeitswegKarte = null;

// Beim Zeigen des Panels: Hat sich das Kartenfeld seit dem Zeichnen in der
// Größe geändert (Hinweiszeile kam oder ging), Bild neu anfordern – sonst
// wäre die Karte gestaucht. Ebenso nach dem Wechsel der Farbwelt
// (farbwelt "auto" bei Sonnenuntergang), sonst bliebe die Karte hell.
function pruefeArbeitswegKarte() {
  const k = letzteArbeitswegKarte;
  if (!k || !els.commuteMapWrap || !els.commuteUnten || !els.commuteUnten.classList.contains("mit-karte")) return;
  const w = els.commuteMapWrap.offsetWidth, h = els.commuteMapWrap.offsetHeight;
  if (!w || !h) return;
  const nacht = document.body.classList.contains("farbe-dunkel");
  if (Math.abs(w - k.w) > 6 || Math.abs(h - k.h) > 6 || nacht !== k.nacht) renderCommuteMap(k.coords, k.results);
}

function renderCommuteMap(coords, results) {
  if (!els.commuteMapImg || !els.commuteMapRoute) return;

  const winner = fastestCommuteMode(results);
  const winnerRes = winner && results[winner.key];
  const hasRealRoute = !!(winnerRes && Array.isArray(winnerRes.points) && winnerRes.points.length >= 2);

  // ECHTER BUG gefunden: ohne echte Routen-Punkte (z.B. wenn TomTom für
  // den Sieger mal keine Route liefert und der Motis-Schätz-Fallback ohne
  // Punkte einspringt) hat die Karte bisher stur eine gerade Luftlinie
  // Start→Ziel quer über Fluss/Häuser gezeichnet — sieht kaputt aus, weil
  // es aussieht wie eine (falsche) echte Route statt einer Schätzung.
  // Jetzt: ohne echte Punkte lieber ganz auf die Balken-Ansicht zurück-
  // fallen (die zeigt nur Minutenzahlen, keine falsche Streckenführung).
  if (!winner || !coords || !hasRealRoute) {
    els.commuteMapImg.removeAttribute("src");
    els.commuteMapRoute.innerHTML = "";
    zeigeArbeitswegKarte(false);
    return;
  }

  const points = winnerRes.points;

  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  points.forEach(function (p) {
    if (p[0] < minLon) minLon = p[0];
    if (p[0] > maxLon) maxLon = p[0];
    if (p[1] < minLat) minLat = p[1];
    if (p[1] > maxLat) maxLat = p[1];
  });
  // Rand ringsum, sonst klebt die Route am Bildrand.
  const padLon = Math.max((maxLon - minLon) * 0.18, 0.003);
  const padLat = Math.max((maxLat - minLat) * 0.18, 0.002);
  minLon -= padLon; maxLon += padLon; minLat -= padLat; maxLat += padLat;

  // Bild genau in der Größe des Kartenfelds anfordern: Bild und SVG werden
  // ungleichmäßig gestreckt, ein anderes Seitenverhältnis verzerrt die
  // Karte. Ist das Panel gerade ausgehängt (display:none), lässt sich die
  // Größe nicht messen (sie hängt u. a. an der Hinweiszeile) – dann erst
  // beim Zeigen anfordern (pruefeArbeitswegKarte), statt zweimal.
  const W = Math.round(els.commuteMapWrap.offsetWidth);
  const H = Math.round(els.commuteMapWrap.offsetHeight);
  if (!W || !H) {
    letzteArbeitswegKarte = { coords: coords, results: results, w: 0, h: 0, nacht: null };
    return;
  }
  const color = (CONFIG.commuteModeColors && CONFIG.commuteModeColors[winner.key]) || "#5b6b78";
  // Dunkle Farbwelt: TomToms Nachtstil statt einer hellen Fläche mitten im
  // dunklen Panel; die Linie dort kräftig und hell (gleicher Farbton), sonst
  // verschwindet das Braun des Autos zwischen den beigen Hauptstraßen.
  const nacht = document.body.classList.contains("farbe-dunkel");
  const linie = nacht ? farbeLeuchtend(color) : color;
  letzteArbeitswegKarte = { coords: coords, results: results, w: W, h: H, nacht: nacht };

  // center+zoom statt bbox — siehe Kommentar bei zoomForBounds() weiter
  // oben für den Grund (bbox+width/height gibt bei TomTom immer HTTP 400).
  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const zoom = zoomForBounds(minLon, minLat, maxLon, maxLat, W, H);

  const imgUrl = "https://api.tomtom.com/map/1/staticimage" +
    "?key=" + encodeURIComponent(CONFIG.tomtomApiKey) +
    "&center=" + centerLon.toFixed(5) + "," + centerLat.toFixed(5) + "&zoom=" + zoom +
    "&format=jpg&layer=basic&style=" + (nacht ? "night" : "main") + "&width=" + W + "&height=" + H +
    "&view=Unified&language=de-DE&_=" + Date.now();

  els.commuteMapImg.onload = function () {
    if (els.commuteMapWrap) els.commuteMapWrap.classList.remove("is-empty");
    // Falls ein vorheriger Versuch auf die Balken zurückgefallen war (siehe
    // onerror unten), bei Erfolg wieder auf die Kartenansicht umschalten.
    zeigeArbeitswegKarte(true);
  };
  els.commuteMapImg.onerror = function () {
    // Kartenbild nicht verfügbar (Netzwerk, Kontingent, ungültiger Key) —
    // Route weglassen statt ein kaputtes Bild + falsch platzierte Linie
    // stehen zu lassen. Die Balken-Ansicht wurde in updateCommute() schon
    // im Hintergrund mitgebaut (nur versteckt) — jetzt draufschalten statt
    // das Panel auf einen bloßen Text-Hinweis zu reduzieren.
    els.commuteMapRoute.innerHTML = "";
    if (els.commuteMapWrap) els.commuteMapWrap.classList.add("is-empty");
    zeigeArbeitswegKarte(false);
  };
  els.commuteMapImg.src = imgUrl;

  // Route in Weltpixeln bei genau dem Zoom projizieren, mit dem auch das
  // Bild angefordert wurde, und relativ zum Bildmittelpunkt (= center)
  // positionieren — muss zur center+zoom-Anfrage oben passen, sonst liegt
  // die Route neben statt auf der Straße.
  const centerWorldX = lonToWorldX(centerLon, zoom);
  const centerWorldY = latToWorldY(centerLat, zoom);

  function project(lon, lat) {
    const x = lonToWorldX(lon, zoom) - centerWorldX + W / 2;
    const y = latToWorldY(lat, zoom) - centerWorldY + H / 2;
    return [x, y];
  }

  const pathD = points.map(function (p, i) {
    const xy = project(p[0], p[1]);
    return (i === 0 ? "M" : "L") + xy[0].toFixed(1) + "," + xy[1].toFixed(1);
  }).join(" ");

  const homeXY = project(coords.home.lon, coords.home.lat);
  const workXY = project(coords.work.lon, coords.work.lat);

  els.commuteMapRoute.setAttribute("viewBox", "0 0 " + W + " " + H);
  els.commuteMapRoute.innerHTML =
    (nacht ? '<path d="' + pathD + '" fill="none" stroke="#0b0f16" stroke-width="11" ' +
      'stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.75"></path>' : '') +
    '<path d="' + pathD + '" fill="none" stroke="' + linie + '" stroke-width="6" ' +
    'stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.95"></path>' +
    '<circle cx="' + homeXY[0].toFixed(1) + '" cy="' + homeXY[1].toFixed(1) + '" r="8" fill="#fff" stroke="' + linie + '" stroke-width="4"></circle>' +
    '<circle cx="' + workXY[0].toFixed(1) + '" cy="' + workXY[1].toFixed(1) + '" r="8" fill="' + linie + '" stroke="#fff" stroke-width="3"></circle>';
}

// Gleicher Farbton, aber satt und hell (HSL: Sättigung ≥ 80 %, Helligkeit
// 62 %) – "#a9793f" (Auto-Braun) wird zu kräftigem Bernstein.
function farbeLeuchtend(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + 360) % 360;
  const sat = 0.8, hell = 0.62;
  const c = (1 - Math.abs(2 * hell - 1)) * sat;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const o = hell - c / 2;
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + rgb.map(function (v) {
    const k = Math.round((v + o) * 255);
    return (k < 16 ? "0" : "") + k.toString(16);
  }).join("");
}

// Karte und Verkehrsmittel-Liste nebeneinander, solange es ein Kartenbild
// mit echter Route gibt; sonst die Balken über die volle Breite. Vorher
// ersetzte die Karte die Liste ganz – mit ihr verschwand die "Bahn zur
// Arbeit", die Tagesblick und Morgengruß nennen.
function zeigeArbeitswegKarte(mitKarte) {
  if (els.commuteMapWrap) els.commuteMapWrap.style.display = mitKarte ? "" : "none";
  if (els.commuteRace) els.commuteRace.style.display = "";
  if (els.commuteUnten) els.commuteUnten.classList.toggle("mit-karte", !!mitKarte);
}

// Bus-Zeile im Arbeitsweg: werktags vor der Arbeit dieselbe Bahn wie
// Tagesblick und Morgengruß (späteste pünktliche) – vorher stand hier
// "ab 07:45" (Prognose fürs Losgehen um 07:30), dort "die 23 um 07:35".
// Wird auch beim Zeigen des Panels erneuert: die gezielt geholten
// Abfahrten kommen oft erst nach dem Routenabruf.
// Abends und am Wochenende kam hier die Route "ab 07:30 von zu Hause"
// durch – also die 23 um 07:45, die um 08:05 ankommt, während der
// Tagesblick daneben die 07:35 empfahl. Jetzt dieselbe Rechnung für den
// Tag der Prognose; solange die Abfahrten noch geholt werden, wenigstens
// die späteste Losgehzeit statt einer zu späten Bahn.
function aktualisiereBusZeile() {
  const el = document.querySelector(".commute-race-extra.is-bus");
  if (!el) return;
  let text = el._standard || "";
  const hm = function (ms) { return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }); };
  let ab = arbeitsBahnHeute();
  let tagText = "";
  if (!ab) {
    const prognose = nextCommuteDepartureDate();
    ab = arbeitsBahnAm(prognose);
    tagText = " " + prognose.toLocaleDateString("de-DE", { weekday: "short" }).replace(/\.$/, "");
  }
  if (ab && ab.dep && !ab.spaet) {
    // Geschützte Leerzeichen: neben der Karte bricht die Zeile sonst
    // mitten in "los 07:27" um.
    text = "Bahn zur Arbeit" + tagText + ": " + ab.dep.line + "\u00a0um\u00a0" + ab.dep.clock + " · los\u00a0" + hm(ab.dep.leaveByMs) + " · an\u00a0" + hm(ab.ankunftMs);
  } else if (ab && !ab.dep && ab.losMs && tagText) {
    text = "Bahn zur Arbeit" + tagText + ": " + (ab.linie ? ab.linie + ", " : "") + "spätestens " + hm(ab.losMs) + " los";
  }
  if (el.textContent !== text) el.textContent = text;
}

function updateCommute() {
  if (!els.commuteHero) return;

  // Nur wenn TomTom aktiv ist, macht eine Vorhersage-Uhrzeit überhaupt
  // etwas — die alte Transitous-Schätzung kennt kein departAt.
  const departDate = CONFIG.tomtomApiKey ? nextCommuteDepartureDate() : null;

  resolveCommuteCoords().then(function (coords) {
    const distanceMeters = haversineMeters(coords.home, coords.work);

    return Promise.all([
      fetchBikeItinerary(coords.home, coords.work, distanceMeters, departDate),
      fetchTransitItinerary(coords.home, coords.work, departDate || nextCommuteDepartureDate())
        .then(function (it) {
          return {
            itinerary: it,
            minutes: itineraryDurationMin(it),
            note: itineraryRealtimeNote(it),
            lines: itineraryLineNames(it),
            headsign: itineraryFirstHeadsign(it),
            departure: itineraryFirstDeparture(it),
          };
        })
        .catch(function (err) { console.error(err); return null; }),
      fetchCarItinerary(coords.home, coords.work, distanceMeters, departDate),
    ]).then(function (all) {
      const results = { bike: all[0], bus: all[1], car: all[2], forecastDate: departDate };
      lastCommutePtMinutes = (results.bus && typeof results.bus.minutes === "number") ? results.bus.minutes : null;
      // Erste Linie der ÖPNV-Route = die, die man an der Föhrenstraße nimmt.
      const firstLine = results.bus && results.bus.lines && results.bus.lines.length ? String(results.bus.lines[0]) : null;
      const firstHeadsign = results.bus && results.bus.headsign ? String(results.bus.headsign) : null;
      if (firstLine !== lastCommuteFirstLine || firstHeadsign !== lastCommuteFirstHeadsign) {
        lastCommuteFirstLine = firstLine;
        lastCommuteFirstHeadsign = firstHeadsign;
        updateDepartures(); // Markierung sofort zeigen, nicht erst beim nächsten Abruf
      }
      renderCommuteHero(results);

      // Kartenansicht nur mit TomTom-Key (sonst kein Kartenbild abrufbar
      // und keine echte Routenführung vorhanden) — ohne Key bleibt es bei
      // der Balken-Ansicht, damit das Panel nie leer/kaputt aussieht.
      // Balken werden auch mit Key im Hintergrund mitgebaut (nur versteckt)
      // — falls das Kartenbild fehlschlägt, kann renderCommuteMap()s
      // onerror-Handler sofort darauf zurückfallen, statt das Panel auf
      // einen bloßen Text-Hinweis zu reduzieren.
      renderCommuteRace(results);
      if (CONFIG.tomtomApiKey) {
        zeigeArbeitswegKarte(true);
        renderCommuteMap(coords, results);
      } else {
        zeigeArbeitswegKarte(false);
      }
    });
  }).catch(function (err) {
    console.error(err);
    commuteAvailable = false;
  });
}

// ---------- Müllabfuhr (Bremer Abfallkalender) ----------
// Bremen bietet keine öffentliche API/kein iCal dafür — nur eine session-
// basierte Weboberfläche eines Drittanbieters ohne CORS-Unterstützung für
// fremde Seiten. Statt das (unzuverlässig) nachzubauen: reine Datums-
// rechnung anhand des echten, offiziellen PDF-Kalenders für die Adresse
// (siehe CONFIG.wasteCollection) — kein Netzwerkaufruf, kann nie durch
// eine kaputte externe API ausfallen. Muss nur einmal im Jahr aktualisiert
// werden, wenn Bremen den nächsten Kalender veröffentlicht.
const WASTE_LABELS = {
  restbio: { icon: "🗑️", text: "Restmüll & Bioabfall" },
  papier: { icon: "♻️", text: "Papier & Gelber Sack" },
};

// ---------- Wetter: 12-Stunden-Verlauf in der Mitte (IDEEN W1) ----------
// Die Mitte des Wetter-Panels war leerer Himmel. Jetzt: Temperaturkurve
// der nächsten 12 Stunden mit Regenwahrscheinlichkeit als Balken —
// beantwortet "wird's wärmer/kälter, wann regnet's" auf einen Blick.
// CONFIG.wetterMitte: "verlauf" (Standard) | "leer".
function renderWeatherCurve() {
  const el = document.getElementById("weatherCurve");
  const w = lastWeatherSnapshot;
  if (!el) return;
  if ((CONFIG.wetterMitte || "verlauf") !== "verlauf" || !w || !w.hourly) { el.innerHTML = ""; return; }
  const h = w.hourly;
  const now = Date.now();
  let start = 0;
  while (start < h.time.length - 1 && h.time[start] + 3600000 <= now) start++;
  const idx = [];
  for (let i = start; i < h.time.length && idx.length < 13; i++) idx.push(i);
  if (idx.length < 4) { el.innerHTML = ""; return; }
  const W = 940;
  const H = 170;
  const top = 26;
  const bottom = 56;
  const temps = idx.map(function (i) { return h.temp[i]; });
  const lo = Math.min.apply(null, temps) - 1;
  const hi = Math.max.apply(null, temps) + 1;
  const x = function (k) { return 30 + k * (W - 60) / (idx.length - 1); };
  const y = function (t) { return top + (1 - (t - lo) / (hi - lo)) * (H - top - bottom); };
  let line = "";
  idx.forEach(function (i, k) { line += (k ? "L" : "M") + x(k).toFixed(1) + " " + y(h.temp[i]).toFixed(1); });
  const area = line + "L" + x(idx.length - 1).toFixed(1) + " " + (H - bottom) + "L" + x(0).toFixed(1) + " " + (H - bottom) + "Z";
  // Linie, Fläche und Balken als SVG (darf sich in der Breite strecken);
  // Beschriftungen und Punkte als HTML in Prozent — Schrift bleibt so in
  // jeder Breite (z. B. neben dem Regenradar) unverzerrt.
  const pct = function (k) { return (x(k) / W * 100).toFixed(2) + "%"; };
  let bars = "";
  let labels = "";
  idx.forEach(function (i, k) {
    const pp = h.pp[i] || 0;
    if (pp >= 10) {
      const bh = Math.max(2, pp / 100 * 30);
      bars += '<rect x="' + (x(k) - 9).toFixed(1) + '" y="' + (H - bottom + 30 - bh).toFixed(1) + '" width="18" height="' + bh.toFixed(1) + '" rx="3" class="wc-rain' + (pp >= 50 ? " is-wet" : "") + '"/>';
    }
    if (k % 2 === 0) {
      labels += '<span class="wc-hour" style="left:' + pct(k) + '">' + new Date(h.time[i]).getHours() + " Uhr</span>";
    }
  });
  // Höchst- und Tiefstwert direkt an der Kurve beschriften.
  let iMax = 0;
  let iMin = 0;
  temps.forEach(function (t, k) { if (t > temps[iMax]) iMax = k; if (t < temps[iMin]) iMin = k; });
  const mark = function (k) {
    return '<span class="wc-dot" style="left:' + pct(k) + ";top:" + y(temps[k]).toFixed(1) + 'px"></span>' +
      '<span class="wc-temp" style="left:' + pct(k) + ";top:" + (y(temps[k]) - 30).toFixed(1) + 'px">' + Math.round(temps[k]) + "°</span>";
  };
  el.innerHTML = '<div class="wc-plot"><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">' +
    '<defs><linearGradient id="wcFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2a65a" stop-opacity="0.35"/><stop offset="1" stop-color="#e2a65a" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="' + area + '" fill="url(#wcFill)"/>' +
    '<path d="' + line + '" class="wc-line"/>' + bars +
    "</svg>" + labels + mark(iMax) + (iMin !== iMax ? mark(iMin) : "") + "</div>" +
    '<div class="wc-legend"><span class="wc-key wc-key-t"></span>Temperatur <span class="wc-key wc-key-r"></span>Regenwahrscheinlichkeit · nächste 12 Stunden</div>';
}

// ---------- Mondphase (AUSBAU D21) ----------
// Rein rechnerisch: Alter seit einem bekannten Neumond (6.1.2000 18:14 UTC)
// modulo synodischem Monat — auf wenige Stunden genau, für die Anzeige
// "zunehmend/abnehmend, x % beleuchtet" mehr als genug.
function moonPhase(date) {
  const SYN = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  let age = ((date.getTime() - ref) / 86400000) % SYN;
  if (age < 0) age += SYN;
  const lit = (1 - Math.cos(2 * Math.PI * age / SYN)) / 2;
  const names = [
    [1.85, "Neumond"], [7.38, "Zunehmende Sichel"], [9.23, "Erstes Viertel"], [14.77, "Zunehmender Mond"],
    [16.61, "Vollmond"], [22.15, "Abnehmender Mond"], [23.99, "Letztes Viertel"], [27.68, "Abnehmende Sichel"], [SYN + 1, "Neumond"],
  ];
  let name = "Neumond";
  for (let i = 0; i < names.length; i++) { if (age < names[i][0]) { name = names[i][1]; break; } }
  return { age: age, lit: lit, waxing: age < SYN / 2, name: name };
}

// Kleines Mondsymbol: beleuchteter Teil aus Halbkreis + Ellipsenbogen.
function moonPhaseSvg(m) {
  const r = 9;
  const k = m.lit;
  const rx = Math.abs(1 - 2 * k) * r;
  const lightRight = m.waxing;
  const sweepOuter = lightRight ? 1 : 0;
  const sweepInner = (k > 0.5) === lightRight ? 1 : 0;
  const d = "M12 3 A" + r + " " + r + " 0 0 " + sweepOuter + " 12 21 A" + rx.toFixed(2) + " " + r + " 0 0 " + sweepInner + " 12 3 Z";
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>' +
    '<path d="' + d + '" fill="#efe9df"/></svg>';
}

// ---------- Feiertage Bremen (D19) ----------
// Gesetzliche Feiertage im Land Bremen: feste Tage plus die von Ostern
// abhängigen (Gaußsche Osterformel). Reformationstag ist seit 2018 in
// Bremen gesetzlicher Feiertag.
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function bremenHolidays(year) {
  const e = easterSunday(year).getTime();
  const DAY = 86400000;
  const rel = function (n, name) { const d = new Date(e + n * DAY); return { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), name: name }; };
  return [
    { date: new Date(year, 0, 1), name: "Neujahr" },
    rel(-2, "Karfreitag"),
    rel(1, "Ostermontag"),
    { date: new Date(year, 4, 1), name: "Tag der Arbeit" },
    rel(39, "Christi Himmelfahrt"),
    rel(50, "Pfingstmontag"),
    { date: new Date(year, 9, 3), name: "Tag der Deutschen Einheit" },
    { date: new Date(year, 9, 31), name: "Reformationstag" },
    { date: new Date(year, 11, 25), name: "1. Weihnachtstag" },
    { date: new Date(year, 11, 26), name: "2. Weihnachtstag" },
  ];
}

function holidayOn(date) {
  const list = bremenHolidays(date.getFullYear());
  for (let i = 0; i < list.length; i++) {
    if (list[i].date.getMonth() === date.getMonth() && list[i].date.getDate() === date.getDate()) return list[i];
  }
  return null;
}

// Feiertagsverschiebung (übliche Regel der Bremer Stadtreinigung): liegt
// in derselben Woche am oder vor dem Abfuhrtag ein Feiertag (Mo–Abfuhrtag),
// verschiebt sich die Abfuhr um einen Werktag nach hinten.
function shiftForHolidays(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
  for (let d = new Date(monday.getTime()); d <= date; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const h = holidayOn(d);
    if (h) {
      let shifted = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
      while (holidayOn(shifted) || shifted.getDay() === 0) shifted = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate() + 1);
      return { date: shifted, reason: h.name };
    }
  }
  return null;
}

function nextWasteCollections(count) {
  const cfg = CONFIG.wasteCollection;
  if (!cfg) return [];

  const refDate = new Date(cfg.referenceDate + "T00:00:00");
  const refType = cfg.referenceType;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const items = [];

  // Reguläre, alternierende Mittwochstermine ab dem nächsten Termin.
  let d = new Date(refDate.getTime());
  while (d < today) {
    d = new Date(d.getTime() + 7 * 86400000);
  }
  for (let i = 0; i < count + 6; i++) {
    const weeksSinceRef = Math.round((d.getTime() - refDate.getTime()) / (7 * 86400000));
    const isRefType = ((weeksSinceRef % 2) + 2) % 2 === 0;
    const type = isRefType ? refType : (refType === "restbio" ? "papier" : "restbio");
    const shift = shiftForHolidays(d);
    items.push(shift
      ? { date: shift.date, type: type, shiftedBecause: shift.reason }
      : { date: new Date(d.getTime()), type: type });
    d = new Date(d.getTime() + 7 * 86400000);
  }

  // Einmalige Sondertermine (z.B. Tannenbaumabfuhr), die nicht dem
  // regulären Mittwochsrhythmus folgen.
  (cfg.exceptions || []).forEach(function (ex) {
    const exDate = new Date(ex.date + "T00:00:00");
    if (exDate >= today) {
      items.push({ date: exDate, type: "exception", label: ex.label });
    }
  });

  items.sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });

  return items.slice(0, count);
}

function formatWasteEntry(entry) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((entry.date.getTime() - today.getTime()) / 86400000);

  let when;
  if (days === 0) when = "heute";
  else if (days === 1) when = "morgen";
  else {
    when = entry.date.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
  }

  const info = entry.type === "exception"
    ? { icon: "🎄", text: entry.label }
    : WASTE_LABELS[entry.type];

  if (!info) return null;
  return info.icon + " " + when + ": " + info.text;
}

// Müll (IDEEN R5 / AUSBAU D17): nicht mehr tagelang vorher, sondern
// dann, wenn man etwas tun muss — ab 16 Uhr am Vorabend prominent
// ("heute Abend rausstellen") und am Abholtag bis 9 Uhr.
function updateWasteLine() {
  if (!els.wasteLine || !CONFIG.wasteCollection) return;
  const upcoming = nextWasteCollections(2);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let text = "";
  let urgent = false;
  for (let i = 0; i < upcoming.length && !text; i++) {
    const entry = upcoming[i];
    const days = Math.round((entry.date.getTime() - today.getTime()) / 86400000);
    const info = entry.type === "exception" ? { icon: "🎄", text: entry.label } : WASTE_LABELS[entry.type];
    if (!info) continue;
    const shifted = entry.shiftedBecause ? " (verschoben wegen " + entry.shiftedBecause + ")" : "";
    if (days === 1 && now.getHours() >= 16) {
      text = info.icon + " Morgen: " + info.text + " – heute Abend rausstellen" + shifted;
      urgent = true;
    } else if (days === 0 && now.getHours() < 9) {
      text = info.icon + " Heute: " + info.text + " – bis 7 Uhr an die Straße" + shifted;
      urgent = true;
    }
  }
  els.wasteLine.textContent = text;
  els.wasteLine.classList.toggle("is-urgent", urgent);
  updateHintBar();
}

// Hinweiszeile unten (IDEEN R5): nur sichtbar, wenn es etwas zu sagen
// gibt — dann schrumpft die Bühne um ihre Höhe, damit nichts verdeckt
// wird (vorher lag der Müll-Chip über Wetter-, News- und Spruch-Inhalten).
function updateHintBar() {
  const shell = document.querySelector(".panel");
  if (!shell) return;
  const hints = document.getElementById("haHints");
  const warn = document.getElementById("warnHints");
  // Zeigt das Panel die DWD-Warnung selbst (Tagesblick), zählen nur die
  // übrigen Einträge – sonst bliebe ein leeres Band stehen.
  const warnZahl = !warn ? 0 : (shell.classList.contains("warn-im-panel") ? warn.querySelectorAll('.ha-hint:not([data-warn="0"])').length : warn.children.length);
  const eil = document.getElementById("eilHints");
  const live = document.getElementById("liveHints");
  const has = !!((els.wasteLine && els.wasteLine.textContent) || (hints && hints.children.length) || warnZahl ||
    (eil && eil.children.length) || (live && live.children.length));
  if (shell.classList.contains("has-hintbar") !== has) shell.classList.toggle("has-hintbar", has);
}

// Kurzfassung des aktuellen Stands für Begrüßung und Vorschläge
// (ha-panels.js, lernen.js) — nur gelesen, nichts wird neu abgerufen.
function tafelSnapshot() {
  const waste = nextWasteCollections(1)[0] || null;
  return {
    weather: lastWeatherSnapshot,
    rainStartMinutes: rainStartMinutes,
    departures: lastDepartureSnapshot,
    walkMinutes: walkMinutesToStop,
    waste: waste ? { date: waste.date, text: formatWasteEntry(waste), type: waste.type, label: waste.label, shiftedBecause: waste.shiftedBecause } : null,
    calendar: lastCalendarEvents,
    commutePtMinutes: lastCommutePtMinutes,
  };
}

// Bahn zur Arbeit (Morgengruß, Tagesblick, Arbeitsweg, Lern-Vorschlag –
// eine Rechnung für alle): an Arbeitstagen die späteste Abfahrt der Linie,
// mit der der Arbeitsweg beginnt, die mit 5 Min Puffer pünktlich ankommt.
// Früh am Morgen steht die noch nicht in der Abfahrtsliste (nächste
// Stunde) – dann holt der Tagesblick die Abfahrten um diese Zeit gezielt;
// bis dahin nur die Losgehzeit. Für einen späteren Tag (abends "Morgen
// früh", Arbeitsweg-Prognose) zählt nur die gezielte Abfrage. null = an
// dem Tag kein Arbeitsweg (Wochenende, Feiertag, Arbeitsbeginn vorbei)
// oder noch keine Fahrzeit bekannt.
function arbeitsBahnHeute() {
  return arbeitsBahnAm(new Date());
}

function arbeitsBahnAm(tag) {
  if (tag.getDay() === 0 || tag.getDay() === 6 || holidayOn(tag)) return null;
  const pt = lastCommutePtMinutes;
  const t = String(CONFIG.workArrivalTarget || "").split(":");
  if (pt == null || t.length !== 2) return null;
  const now = new Date();
  const nowMs = Date.now();
  const heute = tag.getFullYear() === now.getFullYear() && tag.getMonth() === now.getMonth() && tag.getDate() === now.getDate();
  const ziel = new Date(tag.getFullYear(), tag.getMonth(), tag.getDate(), parseInt(t[0], 10) || 0, parseInt(t[1], 10) || 0).getTime();
  const spaetestens = ziel - (pt + 5) * 60000; // späteste Abfahrt, die pünktlich ankommt
  if (spaetestens < nowMs - 20 * 60000) return null;
  const walkMs = (walkMinutesToStop || 0) * 60000;
  const linie = lastCommuteFirstLine;
  const fmt = function (ms) { return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }); };

  // Die Live-Liste (nächste Stunde) gilt nur für heute.
  const liste = heute ? (lastDepartureSnapshot || []).slice() : [];
  let bis = 0;
  liste.forEach(function (d) { if (d.whenMs > bis) bis = d.whenMs; });
  // Die gezielt geholten Abfahrten (bis 30 min alt) ergänzen nur, was
  // HINTER der Live-Liste liegt – innerhalb gilt die Live-Liste (Ausfälle,
  // Verspätungen); sonst käme eine inzwischen gestrichene Bahn zurück.
  if (window.TafelTag && TafelTag.bahnenAb) {
    const liveBis = bis;
    const frueh = TafelTag.bahnenAb(spaetestens - walkMs - 15 * 60000);
    (frueh || []).forEach(function (f) {
      if (f.whenMs <= liveBis) return;
      const doppelt = liste.some(function (d) { return d.line === f.line && Math.abs(d.whenMs - f.whenMs) < 90000; });
      if (!doppelt) liste.push({ line: f.line, dest: f.dest, whenMs: f.whenMs, clock: fmt(f.whenMs), leaveByMs: f.whenMs - walkMs, color: f.color, textColor: f.textColor });
      if (f.whenMs > bis) bis = f.whenMs;
    });
    liste.sort(function (a, b) { return a.whenMs - b.whenMs; });
  }
  const passend = liste.filter(function (d) {
    return d.whenMs && d.leaveByMs >= nowMs + 60000 && (!linie || istArbeitsBahn(d.line, d.dest));
  });
  let pick = null;
  passend.forEach(function (d) { if (d.whenMs <= spaetestens) pick = d; });
  // alle: noch erreichbare Bahnen der Linie (Tagesblick zeigt davor/danach).
  if (pick && bis > spaetestens) return { dep: pick, ankunftMs: pick.whenMs + pt * 60000, alle: passend, ptMin: pt };
  if (spaetestens - walkMs < nowMs) {
    // Pünktlich klappt nicht mehr: die nächste Bahn der Linie, ehrlich "zu spät".
    return passend.length ? { dep: passend[0], ankunftMs: passend[0].whenMs + pt * 60000, spaet: true, alle: passend, ptMin: pt } : null;
  }
  return { dep: null, losMs: spaetestens - walkMs, linie: linie };
}

// ---------- Sport-Ticker (Lieblingsvereine, openligadb.de) ----------
// openligadb ist kostenlos, ohne API-Key, offene REST-API für Fußball-
// daten. Abfrage per Vereinsname (getmatchesbyteam) statt fester Team-ID —
// robuster, kein Pflegeaufwand bei falschen/veralteten IDs. Enthält aber
// auch Test-/Fantasieligen fremder Nutzer (z.B. eine Liga namens
// "BLClaude" mit erfundenen Ergebnissen) — deshalb wird strikt auf
// CONFIG.sportLeagueWhitelist gefiltert (echte Bundesliga/2./3. Liga/
// DFB-Pokal-Daten), alles andere wird ignoriert. Pro Verein wird das
// nächste anstehende Spiel gezeigt, oder — falls gerade keins bekannt
// ist — das letzte Ergebnis.
let sportAvailable = false;
let sportItems = [];
let sportSlideIndex = 0;
let sportSlideTimer = null;

const SPORT_LEAGUE_NAMES = {
  bl1: "Bundesliga",
  bl2: "2. Bundesliga",
  bl3: "3. Liga",
  dfb: "DFB-Pokal",
};

function isFollowedTeam(team, followedName) {
  const n = (team && team.teamName) || "";
  return n.toLowerCase().indexOf((followedName || "").toLowerCase()) !== -1;
}

function teamColorFor(teamName) {
  const map = CONFIG.sportTeamColors || {};
  return map[teamName] || "#5b6b78";
}

function finalScore(match) {
  if (!match.matchResults || !match.matchResults.length) return null;

  let best = match.matchResults[0];
  match.matchResults.forEach(function (r) {
    if (r.resultOrderID > best.resultOrderID) best = r;
  });

  if (best.pointsTeam1 == null || best.pointsTeam2 == null) return null;
  return best.pointsTeam1 + ":" + best.pointsTeam2;
}

function matchOutcome(match, score, teamName) {
  if (!score) return "";
  const parts = score.split(":");
  const p1 = parseInt(parts[0], 10);
  const p2 = parseInt(parts[1], 10);

  const t1Name = (match.team1 && match.team1.teamName) || "";
  const isTeam1 = t1Name.toLowerCase().indexOf(teamName.toLowerCase()) !== -1;
  const ownGoals = isTeam1 ? p1 : p2;
  const opponentGoals = isTeam1 ? p2 : p1;

  if (ownGoals > opponentGoals) return "win";
  if (ownGoals < opponentGoals) return "loss";
  return "draw";
}

// Anstoß als Date: matchDateTimeUTC (mit "Z") – matchDateTime hat keine
// Zeitzone, und Safari 12 liest so etwas als UTC (auf dem iPad 2 h
// verschoben, derselbe Effekt wie bei parseOpenMeteoLocal).
function anstoss(m) {
  return new Date(m.matchDateTimeUTC || m.matchDateTime);
}

function formatMatchDate(d) {
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }) +
    ", " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
}

const heimspiele = {}; // je verfolgtem Verein die nächsten Heimspiele
const vereinsWappen = {}; // Vereinsname → Wappen-URL (OpenLigaDB)

function fetchTeamMatches(teamName) {
  const url = "https://api.openligadb.de/getmatchesbyteam/" + encodeURIComponent(teamName) + "/6/20";

  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error("Sport-Abruf (" + teamName + ") fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const whitelist = CONFIG.sportLeagueWhitelist || [];
    const matches = (Array.isArray(data) ? data : []).filter(function (m) {
      return m && m.leagueShortcut && whitelist.indexOf(m.leagueShortcut) !== -1;
    });

    matches.sort(function (a, b) {
      return anstoss(a).getTime() - anstoss(b).getTime();
    });

    // BUG (IDEEN F1): OpenLigaDB setzt matchIsFinished oft erst Stunden
    // nach Abpfiff — dann stand ein gestriges Spiel als "Nächstes Spiel"
    // auf der Tafel. Ein Spiel gilt deshalb auch als vorbei, wenn der
    // Anstoß mehr als 2 h 15 min zurückliegt (90 min + Pause + Nachspielzeit
    // + Verlängerung/Elfmeter mit Puffer).
    const overMs = 135 * 60 * 1000;
    const isOver = function (m) {
      return m.matchIsFinished || (Date.now() - anstoss(m).getTime() > overMs);
    };

    let next = null;
    for (let i = 0; i < matches.length; i++) {
      if (!isOver(matches[i])) { next = matches[i]; break; }
    }

    // Live-Stand (fussball-live.js): Spiele um jetzt herum melden
    if (window.FussballLive) FussballLive.melden(teamName, matches);

    // Wappen des Vereins für die News-Karten ohne Foto (kicker)
    for (let i = 0; i < matches.length && !vereinsWappen[teamName]; i++) {
      [matches[i].team1, matches[i].team2].forEach(function (t) {
        if (t && t.teamIconUrl && isFollowedTeam(t, teamName)) vereinsWappen[teamName] = t.teamIconUrl;
      });
    }

    // Heimspiele Bremer Vereine sind Bremer Veranstaltungen (Panel
    // "Veranstaltungen") – die der anderen verfolgten Vereine nicht.
    heimspiele[teamName] = !/bremen|bremer/i.test(teamName) ? [] : matches.filter(function (m) {
      return !isOver(m) && m.team1 && isFollowedTeam(m.team1, teamName);
    }).slice(0, 3).map(function (m) {
      const loc = m.location || {};
      return {
        name: m.team1.teamName + " – " + (m.team2 ? m.team2.teamName : ""),
        start: anstoss(m),
        ort: loc.locationStadium || (/werder/i.test(teamName) ? "Weserstadion" : "Heimspiel"),
      };
    });

    let last = null;
    for (let i = matches.length - 1; i >= 0; i--) {
      if (isOver(matches[i])) { last = matches[i]; break; }
    }

    if (!next && !last) return null;

    // Nicht jedes noch Wochen entfernte "nächste Spiel" verdient eine
    // eigene Karte in der Diashow — erst zeigen, wenn es wirklich bald
    // ansteht (oder gerade eben vorbei ist), sonst lieber der Fußball-News
    // mehr Platz lassen (siehe CONFIG.sportRelevanceDays).
    const windowMs = (CONFIG.sportRelevanceDays || 5) * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const nextSoon = next && (anstoss(next).getTime() - now) <= windowMs;
    const lastRecent = last && (now - anstoss(last).getTime()) <= windowMs;

    if (!nextSoon && !lastRecent) return null;

    return {
      teamName: teamName,
      next: nextSoon ? next : null,
      last: (!nextSoon && lastRecent) ? last : null,
      // Unter dem letzten Ergebnis: wann es weitergeht (auch wenn das
      // nächste Spiel noch außerhalb des Relevanz-Fensters liegt).
      danach: (!nextSoon && lastRecent && next) ? next : null,
    };
  }).catch(function (err) {
    console.error(err);
    return null;
  });
}

function buildCrestImg(team) {
  const img = document.createElement("img");
  img.className = "sport-slide-crest";
  img.src = (team && team.teamIconUrl) || "";
  img.alt = "";
  // Manche Wappen-URLs sind mal nicht erreichbar/gesperrt — dann das
  // Bild einfach ausblenden statt ein kaputtes Icon anzuzeigen.
  img.onerror = function () { img.style.display = "none"; };
  return img;
}

// Statt einer scrollbaren Liste läuft der Sport-Ticker jetzt als eigene
// Diashow (gleiches Muster wie die News): eine große "Spieltag-Karte" pro
// Verein, eigene Vereinsfarbe als Glow hinterm Wappen, Wappen fliegen beim
// Erscheinen sanft rein. Score/Ergebnis groß und farblich nach Sieg/
// Niederlage/Unentschieden eingefärbt, bei einem anstehenden Spiel steht
// dort stattdessen "VS" und unten Datum/Uhrzeit.
function kickoffLabel(d) {
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((d0 - t0) / 86400000);
  const hm = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (d.getTime() <= now.getTime()) return "Läuft gerade";
  if (days === 0) return "Heute " + hm;
  if (days === 1) return "Morgen " + hm;
  return d.toLocaleDateString("de-DE", { weekday: "short" }) + " " + hm + " · in " + days + " Tagen";
}

function buildSportSlide(entry, index) {
  const useNext = !!entry.next;
  const match = useNext ? entry.next : entry.last;
  const followedName = entry.teamName;
  const color = teamColorFor(followedName);

  let score = null;
  let outcomeClass = "";
  if (!useNext) {
    score = finalScore(match);
    if (score) outcomeClass = " result-" + matchOutcome(match, score, followedName);
  }

  const slide = document.createElement("div");
  slide.className = "sport-slide" + (index === 0 ? " active" : "") + outcomeClass;
  slide.style.setProperty("--team-color", color);
  slide.setAttribute("data-match", String(match.matchID));

  const glow = document.createElement("div");
  glow.className = "sport-slide-glow";
  slide.appendChild(glow);

  const content = document.createElement("div");
  content.className = "sport-slide-content";

  const label = document.createElement("div");
  label.className = "sport-slide-label";
  label.textContent = useNext ? "Nächstes Spiel" : "Letztes Ergebnis";
  content.appendChild(label);

  const groupName = match.group && match.group.groupName;
  const compText = (SPORT_LEAGUE_NAMES[match.leagueShortcut] || "") +
    (groupName ? " · " + groupName : "");
  if (compText.replace(/^\s*·\s*/, "").trim()) {
    const comp = document.createElement("div");
    comp.className = "sport-slide-competition";
    comp.textContent = compText.trim();
    content.appendChild(comp);
  }

  const matchup = document.createElement("div");
  matchup.className = "sport-slide-matchup";

  [match.team1, match.team2].forEach(function (team, i) {
    if (i === 1) {
      const center = document.createElement("div");
      center.className = "sport-slide-center";
      if (score) {
        const scoreEl = document.createElement("span");
        scoreEl.className = "sport-slide-score";
        scoreEl.textContent = score;
        center.appendChild(scoreEl);
      } else if (!useNext) {
        // Vorbei, aber OpenLigaDB hat noch kein Endergebnis.
        const pendingEl = document.createElement("span");
        pendingEl.className = "sport-slide-vs sport-slide-pending";
        pendingEl.textContent = "Ergebnis folgt";
        center.appendChild(pendingEl);
      } else {
        const vsEl = document.createElement("span");
        vsEl.className = "sport-slide-vs";
        vsEl.textContent = "VS";
        center.appendChild(vsEl);
      }
      matchup.appendChild(center);
    }

    const teamEl = document.createElement("div");
    teamEl.className = "sport-slide-team" +
      (isFollowedTeam(team, followedName) ? " is-followed" : "");
    teamEl.appendChild(buildCrestImg(team));
    const nameEl = document.createElement("span");
    nameEl.className = "sport-slide-team-name";
    nameEl.textContent = (team && (team.shortName || team.teamName)) || "?";
    teamEl.appendChild(nameEl);
    matchup.appendChild(teamEl);
  });

  content.appendChild(matchup);

  // Anstoß als Fern-Info (IDEEN F2): "Morgen 15:30" / "Heute 20:30" /
  // "Sa 15:30 · in 3 Tagen" groß, das genaue Datum klein darunter.
  if (useNext) {
    const kick = anstoss(match);
    const big = document.createElement("div");
    big.className = "sport-slide-kickoff";
    big.textContent = kickoffLabel(kick);
    content.appendChild(big);
  }
  const meta = document.createElement("div");
  meta.className = "sport-slide-meta";
  meta.textContent = formatMatchDate(anstoss(match));
  content.appendChild(meta);

  // Letztes Ergebnis: darunter, gegen wen und wann es weitergeht – vorher
  // stand dort nur das Datum des vergangenen Spiels über viel Leerfläche.
  if (!useNext && entry.danach) {
    const n = entry.danach;
    const heim = isFollowedTeam(n.team1, followedName);
    const gegner = heim ? n.team2 : n.team1;
    const weiter = document.createElement("div");
    weiter.className = "sport-slide-danach";
    weiter.innerHTML = '<span class="sport-slide-danach-label">Als Nächstes</span>' +
      '<span class="sport-slide-danach-text"></span>';
    const k = anstoss(n);
    const wann = kickoffLabel(k).indexOf(" · in ") !== -1
      ? k.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" }) + ", " +
        k.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
      : kickoffLabel(k);
    weiter.lastChild.textContent = wann + " · " + (heim ? "gegen " : "bei ") +
      ((gegner && (gegner.shortName || gegner.teamName)) || "?");
    content.appendChild(weiter);
  }

  slide.appendChild(content);
  return slide;
}

// Fußball-News-Karte (Transfers/Berichte, ressort=sport) — nutzt bewusst
// dasselbe Bild+Scrim+Text-Muster wie die News-Diashow (.news-slide-*
// Klassen), nur innerhalb eines .sport-slide-Containers, damit
// showSportSlide() (das nach ".sport-slide" sucht) sie normal mitzählt.
function buildSportNewsSlide(item, index) {
  const imageUrl = extractNewsImageUrl(item);

  const slide = document.createElement("div");
  slide.className = "sport-slide sport-slide-news" + (index === 0 ? " active" : "") + (imageUrl ? "" : " ohne-bild");

  const wappen = !imageUrl && item._team ? vereinsWappen[item._team] : "";
  if (wappen) {
    const w = document.createElement("img");
    w.className = "sport-news-wappen";
    w.alt = "";
    w.onerror = function () { w.style.display = "none"; };
    w.src = wappen;
    slide.appendChild(w);
  }

  if (imageUrl) {
    const media = document.createElement("div");
    media.className = "news-slide-media";
    // Lazy-Load wie bei buildNewsSlide (siehe Kommentar dort) — gilt hier
    // genauso, das Sport-Panel hält seine News-Karten dauerhaft im DOM.
    media.setAttribute("data-bg", imageUrl);
    if (index === 0) media.style.backgroundImage = 'url("' + imageUrl + '")';
    slide.appendChild(media);

    const scrim = document.createElement("div");
    scrim.className = "news-slide-scrim";
    slide.appendChild(scrim);
  }

  const content = document.createElement("div");
  content.className = "news-slide-content";

  const badge = document.createElement("span");
  badge.className = "news-slide-badge badge-sportnews";
  badge.textContent = "Fußball News";
  content.appendChild(badge);
  const alter = document.createElement("span");
  alter.className = "news-slide-alter num";
  alter.textContent = newsAlterText(newsZeitMs(item));
  content.appendChild(alter);

  if (item.topline) {
    const top = document.createElement("div");
    top.className = "news-slide-topline";
    top.textContent = item.topline;
    content.appendChild(top);
  }

  const title = document.createElement("div");
  title.className = "news-slide-title";
  title.textContent = item.title || "";
  content.appendChild(title);

  if (item.firstSentence) {
    const bodyEl = document.createElement("div");
    bodyEl.className = "news-slide-body";
    bodyEl.innerHTML = "<p>" + item.firstSentence + "</p>";
    content.appendChild(bodyEl);
  }

  slide.appendChild(content);
  return slide;
}

// Kein kostenloses "nur Fußball-Transfers"-Feed (Kicker o.ä.) ohne API-Key
// auffindbar bzw. CORS-freundlich nutzbar. Der bisherige ressort=sport-Feed
// zeigte aber praktisch nur noch, was gerade das größte Sport-Ereignis ist
// (WM, Tour de France, Tennis) — verdrängt die eigentlich verfolgten Vereine
// komplett (per curl gegen die echte API bestätigt: von 10 Meldungen keine
// einzige zu einem der sportTeams-Vereine). Stattdessen jetzt gezielt über
// die Tagesschau-Volltextsuche (?searchText=<Verein>) pro Verein aus
// sportTeams gesucht — dieselbe Quelle, aber themengefiltert statt zeitlich
// zufällig überschwemmt.
function fetchTeamNews(teamName, count) {
  const url = "https://www.tagesschau.de/api2u/search/?searchText=" +
    encodeURIComponent(teamName) + "&pageSize=" + count;
  const bustUrl = url + "&_=" + Date.now();
  return fetch(bustUrl, { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("Team-News fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    return (data && Array.isArray(data.searchResults)) ? data.searchResults : [];
  }).catch(function (err) {
    console.error(err);
    return [];
  });
}

// Die Volltextsuche matcht auch Fließtext, nicht nur den Titel — bei
// Vereinsnamen, die zugleich Stadt-/Ortsnamen sind (Mönchengladbach,
// Dortmund, Essen, ...), kommen dadurch völlig themenfremde Regional-
// meldungen rein (z.B. "Rotter See in Troisdorf bleibt gesperrt" bei einer
// "Mönchengladbach"-Suche). Artikel-Treffer aus dem Sport-Ressort tragen
// aber zuverlässig "/sport" im shareURL/detailsweb-Pfad (bei allen
// Regionalsendern: hessenschau.de/sport/fussball/…, swr.de/sport/…, etc.,
// per curl gegen die echte API stichprobenartig bestätigt); Video-Beiträge
// haben oft gar keine Artikel-URL, sind aber laut item.type="video"
// erkennbar und in den Stichproben durchweg vereinsbezogen.
function isFootballRelevant(item) {
  const url = ((item.shareURL || "") + " " + (item.detailsweb || "")).toLowerCase();
  if (url.indexOf("/sport") === -1 && item.type !== "video") return false;
  // Sitzung 6: Die Volltextsuche trifft auch Erwähnungen tief im Artikel
  // ("SV Elversberg zu Gast bei Union Berlin" bei einer Schalke-Suche) –
  // ein verfolgter Verein muss in Titel, Dachzeile oder Teaser stehen.
  const sichtbar = ((item.title || "") + " " + (item.topline || "") + " " + (item.firstSentence || "")).toLowerCase();
  // Ganze Wörter ("essen" nicht in "Interessenten")
  return vereinsWoerter().some(function (w) {
    let i = sichtbar.indexOf(w);
    while (i !== -1) {
      const vor = i === 0 ? " " : sichtbar.charAt(i - 1);
      let nach = sichtbar.charAt(i + w.length) || " ";
      if (nach === "s") nach = sichtbar.charAt(i + w.length + 1) || " "; // "Schalkes"
      if (!/[a-zäöüß]/.test(vor) && !/[a-zäöüß]/.test(nach)) return true;
      i = sichtbar.indexOf(w, i + 1);
    }
    return false;
  });
}

const VEREIN_ALIASE = { dortmund: ["bvb"], "mönchengladbach": ["gladbach"], essen: ["rwe"], pauli: ["kiezkicker"], werder: ["sv werder"] };
let vereinsWoerterCache = null;
function vereinsWoerter() {
  if (vereinsWoerterCache) return vereinsWoerterCache;
  const w = [];
  (CONFIG.sportTeams || []).forEach(function (t) {
    String(t).toLowerCase().split(/[\s-]+/).forEach(function (teil) {
      teil = teil.replace(/\.$/, "");
      if (teil.length >= 4 && ["borussia", "bremen", "rot", "weiss"].indexOf(teil) === -1) w.push(teil);
      if (VEREIN_ALIASE[teil]) VEREIN_ALIASE[teil].forEach(function (a) { w.push(a); });
    });
  });
  vereinsWoerterCache = w;
  return w;
}

// ---------- Fußball-News vom kicker (Sitzung 6) ----------
// Gegenprobe 10.10.: Die tagesschau-Suche lieferte zu "Werder Bremen" einen
// 6 Tage alten Liveticker vom Einheitsfest und einen 10 Tage alten
// Frankfurt-Artikel, zu "Schalke" "SV Elversberg zu Gast bei Union Berlin".
// Der kicker hat je Verein einen Feed (CORS *, alle paar Minuten frisch,
// nur dieser Verein). Ohne Bild – die Karte zeigt dann Text auf dunklem
// Grund. Vereine ohne bekannten Feed (Gladbach: kein Feedname gefunden)
// fehlen bei den News, ihre Ergebnisse kommen weiter von OpenLigaDB.
const KICKER_FEEDS = [
  { wort: "werder", slug: "werder-bremen" },
  { wort: "pauli", slug: "fc-st-pauli" },
  { wort: "dortmund", slug: "borussia-dortmund" },
  { wort: "schalke", slug: "fc-schalke-04" },
  { wort: "essen", slug: "rot-weiss-essen" },
];

// "Sat, 10 Oct 2026 06:12:15 GMT" / "+0200" (selbst gelesen, s. appleFeedZeit)
function rssZeit(text) {
  const t = String(text || "").replace(/\b(GMT|UTC|Z)\b/, "+0000");
  return appleFeedZeit(t);
}

function fetchKickerTeam(team) {
  const f = KICKER_FEEDS.filter(function (k) { return String(team).toLowerCase().indexOf(k.wort) !== -1; })[0];
  if (!f) return Promise.resolve([]);
  return fetch("https://newsfeed.kicker.de/team/" + f.slug).then(function (res) {
    if (!res.ok) throw new Error("kicker-Feed " + f.slug + ": HTTP " + res.status);
    return res.text();
  }).then(function (xml) {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const items = doc.getElementsByTagName("item");
    const aus = [];
    for (let i = 0; i < items.length && aus.length < 6; i++) {
      const feld = function (n) { const e = items[i].getElementsByTagName(n)[0]; return e ? e.textContent.trim() : ""; };
      const ms = rssZeit(feld("pubDate"));
      const titel = feld("title");
      if (!ms || !titel) continue;
      aus.push({
        title: titel,
        topline: team + " · kicker",
        firstSentence: feld("description").replace(/<[^>]+>/g, ""),
        date: new Date(ms).toISOString(),
        externalId: feld("guid") || feld("link"),
        _team: team,
      });
    }
    return aus;
  }).catch(function (err) {
    console.error(err);
    return [];
  });
}

function fetchFootballNews() {
  if ((CONFIG.sportNewsQuelle || "kicker") === "kicker") {
    const teamsK = CONFIG.sportTeams || [];
    const anzahl = CONFIG.sportNewsCount || 4;
    return Promise.all(teamsK.map(fetchKickerTeam)).then(function (pools) {
      const jetzt = Date.now();
      // Frischeste zuerst, nichts älter als 3 Tage, höchstens 2 je Verein
      // (Werder darf 3 – Julians Verein).
      const alle = [].concat.apply([], pools).filter(function (it) { return jetzt - newsZeitMs(it) <= 3 * 86400000; });
      alle.sort(function (a, b) { return newsZeitMs(b) - newsZeitMs(a); });
      const jeTeam = {};
      return alle.filter(function (it) {
        const n = (jeTeam[it._team] || 0) + 1;
        if (n > (/werder/i.test(it._team) ? 3 : 2)) return false;
        jeTeam[it._team] = n;
        return true;
      }).slice(0, anzahl);
    });
  }
  const teams = CONFIG.sportTeams || [];
  const count = CONFIG.sportNewsCount || 4;
  if (!teams.length) return Promise.resolve([]);
  // Höher als count/teams angesetzt, weil isFootballRelevant() danach noch
  // einen Teil der Treffer rausfiltert (Fließtext-Matches auf Ortsnamen).
  const perTeam = Math.max(5, Math.ceil((count * 2) / teams.length));

  return Promise.all(teams.map(function (team) {
    return fetchTeamNews(team, perTeam);
  })).then(function (pools) {
    let combined = [].concat.apply([], pools).filter(isFootballRelevant);

    // Dedupe — mehrere Vereinssuchen können dieselbe Meldung treffen
    // (z.B. ein Transfer zwischen zwei verfolgten Vereinen).
    const seen = {};
    combined = combined.filter(function (item) {
      const key = item.sophoraId || item.externalId || item.title;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });

    // Frisch zuerst, nichts älter als 3 Tage (Sitzung 6: die Suche liefert
    // auch wochenalte Treffer – lieber weniger Karten als veraltete).
    const jetzt = Date.now();
    combined = combined.filter(function (it) { const t = newsZeitMs(it); return t && jetzt - t <= 3 * 86400000; });
    combined.sort(function (a, b) { return newsZeitMs(b) - newsZeitMs(a); });
    return combined.slice(0, count);
  });
}

// Vereins-Karten und News-Karten abwechselnd mischen statt erst alle
// Ergebnisse und danach erst alle News zu zeigen — sorgt für Abwechslung
// über die ganze Diashow statt eines langweiligen zweiten Teils.
function interleaveArrays(a, b) {
  const result = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (i < a.length) result.push(a[i]);
    if (i < b.length) result.push(b[i]);
  }
  return result;
}

function showSportSlide(index) {
  const slides = els.sportBlock ? els.sportBlock.querySelectorAll(".sport-slide") : [];
  for (let i = 0; i < slides.length; i++) {
    slides[i].className = slides[i].className.replace(" active", "");
    if (i === index) slides[i].className += " active";
  }
  applySlideMediaSwap(slides, index, 850);

  // Gleiche Fortschritts-Punkte wie bei der News-Diashow (siehe
  // showNewsSlide) — bisher auch hier nicht erkennbar, wie viele Karten
  // insgesamt kommen.
  const dots = els.sportBlock ? els.sportBlock.querySelectorAll(".news-progress-dot") : [];
  for (let i = 0; i < dots.length; i++) {
    dots[i].className = "news-progress-dot" + (i === index ? " active" : "");
  }

  sportSlideIndex = index;
}

// keepIndex=true beim Fortsetzen nach einer Touch-Pause, gleiches Prinzip
// wie bei startNewsSlideshow.
function startSportSlideshow(keepIndex) {
  stopSportSlideshow();
  if (!sportItems.length) return;

  if (!keepIndex) showSportSlide(0);
  if (sportItems.length < 2) return;

  sportSlideTimer = setInterval(function () {
    showSportSlide((sportSlideIndex + 1) % sportItems.length);
  }, CONFIG.sportSlideIntervalMs || 5000);
}

function stopSportSlideshow() {
  if (sportSlideTimer) {
    clearInterval(sportSlideTimer);
    sportSlideTimer = null;
  }
}

function renderSport(entries) {
  if (!els.sportBlock) return;
  els.sportBlock.innerHTML = "";
  sportItems = entries;

  if (!entries.length) {
    els.sportBlock.innerHTML = '<div class="view-placeholder">Keine Spiele gefunden</div>';
    sportAvailable = false;
    return;
  }

  entries.forEach(function (entry, index) {
    const slideEl = entry.type === "news"
      ? buildSportNewsSlide(entry.item, index)
      : buildSportSlide(entry, index);
    els.sportBlock.appendChild(slideEl);
  });

  // Fortschritts-Punkte, gleiches Muster wie bei der News-Diashow.
  if (entries.length > 1) {
    const progress = document.createElement("div");
    progress.className = "news-progress";
    entries.forEach(function () {
      const dot = document.createElement("span");
      dot.className = "news-progress-dot";
      progress.appendChild(dot);
    });
    els.sportBlock.appendChild(progress);
  }

  // Panel könnte gerade schon aktiv sein (z.B. nach einem manuellen
  // Reload mitten in der Sport-Diashow) — dann direkt starten.
  const panelEl = document.getElementById("panel-sport");
  const isActive = panelEl && panelEl.className.indexOf("active") !== -1;
  if (isActive) startSportSlideshow();

  sportAvailable = true;
  markFresh("sport");
  // Live-Stand gleich wieder eintragen (die Karten wurden neu gebaut)
  if (window.FussballLive) FussballLive.render();
}

function updateSport() {
  if (!els.sportBlock) return;
  const teams = CONFIG.sportTeams || [];
  if (!teams.length) return;

  Promise.all([
    Promise.all(teams.map(fetchTeamMatches)),
    fetchFootballNews(),
  ]).then(function (results) {
    const matchEntries = results[0].filter(function (r) { return !!r; });
    const newsEntries = (results[1] || []).map(function (item) {
      return { type: "news", item: item };
    });
    renderSport(interleaveArrays(matchEntries, newsEntries));
    // Heimspiele erscheinen auch unter "Veranstaltungen"
    if ((CONFIG.veranstaltungenQuelle || "bremen") === "bremen") updateEvents();
  }).catch(function (err) {
    console.error(err);
    sportAvailable = false;
  });
}

// ---------- Karussell ----------
let newsAvailable = false;
let musicAvailable = false;
let quoteAvailable = false;
let triviaAvailable = false;
let quizAvailable = false;
let eventsAvailable = false;
let calendarAvailable = false;
let panelIndex = 0;

const PANEL_AVAILABILITY = {
  departures: function () { return true; },
  // Arbeitsweg nur an Werktagen bis 18 Uhr (IDEEN AW2): am Wochenende/
  // Feiertag oder abends wirkte "6 Min" wie eine aktuelle Info, war aber
  // eine Prognose für Montag — abends übernimmt der Tagesblick.
  commute: function () { return commuteAvailable && isCommuteTime(new Date()); },
  weather: function () { return true; },
  news: function () { return newsAvailable; },
  music: function () { return musicAvailable; },
  sport: function () { return sportAvailable; },
  quote: function () { return quoteAvailable; },
  trivia: function () { return triviaAvailable; },
  quiz: function () { return quizAvailable; },
  riddle: function () { return riddleAvailable; },
  events: function () { return eventsAvailable; },
  calendar: function () { return calendarAvailable; },
  // Home-Assistant-Panels (ha-panels.js): ohne eingerichtetes HA nie da.
  home: function () { return haPanelAvailable("home"); },
  klima: function () { return haPanelAvailable("klima"); },
  medien: function () { return haPanelAvailable("medien"); },
  // Tagesblick (tagesblick.js): morgens "Heute", abends "Morgen früh".
  tagesblick: function () { return !!(window.TafelTag && TafelTag.available()); },
  // Video "tagesschau in 100 Sekunden" (clips.js): nur morgens/abends.
  tagesschau: function () { return !!(window.TafelClips && TafelClips.tagesschauAvailable()); },
};

function isCommuteTime(now) {
  const day = now.getDay();
  if (day === 0 || day === 6 || holidayOn(now)) return false;
  return now.getHours() >= 5 && now.getHours() < 18;
}

function haPanelAvailable(name) {
  return !!(window.TafelHAUI && TafelHAUI.panelAvailable(name));
}

const PANEL_IDS = ["departures", "commute", "weather", "news", "music", "sport", "quote", "trivia", "quiz", "riddle", "events", "calendar", "home", "klima", "medien", "tagesschau", "tagesblick"];

// Alle 11 Panels bleiben wegen der Crossfade-Optik dauerhaft im DOM (nur
// opacity:0 + pointer-events:none statt display:none, siehe .panel-view-
// Kommentar in style.css) — auf einem speicherschwachen Gerät (iPad Air 1,
// 1GB RAM) heißt das: WebKit hält ALLE Panels mit ihren teils aufwendigen
// Effekten (Wetter-FX, Verläufe, Kartenbild, Bilder) gleichzeitig im
// GPU-Speicher, nicht nur das gerade sichtbare — Hauptverdächtiger für die
// häufigen Abstürze ("schafft nie einen kompletten Durchlauf"). Gleiches
// Prinzip wie schon beim Bild-Lazy-Load in applySlideMediaSwap: das neue
// Panel wird sofort sichtbar gemacht, alle anderen erst NACH Ablauf ihrer
// Crossfade-Transition (siehe .panel-view: 0.7s) per display:none komplett
// aus dem Renderbaum genommen, statt nur unsichtbar zu bleiben.
// Nie das gerade aktive Panel ausblenden – auch wenn ein älterer Timer
// (Wechsel kurz hintereinander, z. B. Karussell + Sprung durch HA) für
// ein anderes Panel feuert.
let unmountTimer = null;

function unmountInactivePanels(activeName) {
  for (let i = 0; i < PANEL_IDS.length; i++) {
    if (PANEL_IDS[i] === activeName) continue;
    const el = document.getElementById("panel-" + PANEL_IDS[i]);
    if (el && !el.classList.contains("active")) el.style.display = "none";
  }
}

function showPanel(name) {
  letzterPanelWechsel = Date.now();
  const ids = PANEL_IDS;
  for (let i = 0; i < ids.length; i++) {
    const el = document.getElementById("panel-" + ids[i]);
    if (!el) continue;
    if (ids[i] === name && el.style.display === "none") {
      // Panel kommt aus dem unmounted-Zustand zurück — display:none muss
      // weg, BEVOR die active-Klasse (und damit opacity:1) gesetzt wird,
      // sonst überspringt der Browser die Transition (display:none->
      // opacity:1 in einem Frame ist kein Übergang, sondern ein Sprung).
      el.style.display = "";
      void el.offsetWidth; // Reflow erzwingen, damit der Sprung nicht greift
    }
    // classList.toggle statt className-Zuweisung — #panel-weather trägt
    // inzwischen eigene Zustandsklassen (weather-scene, fx-*, has-photo,
    // has-video), die hier sonst bei JEDEM Karussell-Wechsel überschrieben
    // würden (className = "..." ersetzt IMMER alles).
    el.classList.toggle("active", ids[i] === name);
  }
  if (unmountTimer) clearTimeout(unmountTimer);
  unmountTimer = setTimeout(function () { unmountTimer = null; unmountInactivePanels(name); }, 750);

  if (name === "quote") {
    // Jede Runde ein neuer Spruch (lokal, kostet nichts).
    if ((CONFIG.spruchQuelle || "deutsch") === "deutsch") updateQuote();
    startQuoteTypewriter();
  }

  if (name === "trivia") {
    naechstesTriviaEreignis();
    startTriviaReveal();
  }

  if (name === "quiz") {
    if (quizLokal()) naechsteQuizFrage();
    else startQuizReveal();
  }

  if (name === "riddle") {
    // updateRiddle() statt direkt startRiddleReveal() — wählt jedes Mal ein
    // neues Rätsel (siehe pickNextRiddle), statt das immer gleiche
    // Tages-Rätsel erneut abzuspielen.
    updateRiddle();
  }

  if (name === "commute") { aktualisiereBusZeile(); pruefeArbeitswegKarte(); }

  if (name === "news") {
    startNewsSlideshow();
  } else {
    stopNewsSlideshow();
  }

  if (name === "sport") {
    startSportSlideshow();
  } else {
    stopSportSlideshow();
  }

  if (window.TafelHAUI) TafelHAUI.onPanelShown(name);
  if (window.TafelClips) TafelClips.onPanelShown(name);
  if (window.TafelTag) TafelTag.onPanelShown(name);
  updateTopbarTitle(name);
}

// Einheitliche Kopfzeile (IDEEN R3): Titel des aktuellen Panels links,
// Uhr rechts — statt je Panel woanders stehender Mini-Labels. Panels mit
// eigenem großem Kopf (Home Assistant, Video) zeigen hier keinen Titel.
const PANELS_OHNE_KOPFTITEL = ["home", "klima", "medien", "tagesschau", "weather", "tagesblick"];
const PANELS_VOLLBILD = ["weather", "sport", "tagesschau"];

// ---------- Datenalter (AUSBAU E23) ----------
// Jede Quelle meldet ihren letzten erfolgreichen Abruf. Hängt die Quelle
// des gerade sichtbaren Panels länger als üblich (WLAN weg, API down),
// steht in der Kopfzeile ehrlich "Stand 07:12" statt still veralteter
// Daten, die wie aktuell aussehen.
const dataStand = {};
const STALE_MS = {
  departures: 3 * 60 * 1000,
  weather: 45 * 60 * 1000,
  commute: 35 * 60 * 1000,
  news: 45 * 60 * 1000,
  music: 3 * 3600 * 1000,
  sport: 90 * 60 * 1000,
  events: 13 * 3600 * 1000,
  calendar: 90 * 60 * 1000,
};

function markFresh(src) {
  dataStand[src] = Date.now();
  updateStaleBadge();
}

// Für die Einstellungsseite (ha-panels.js): letzter erfolgreicher Abruf je
// Quelle. So sieht man am iPad ohne Entwicklerwerkzeuge, ob z. B. der
// Kalender nach dem Umzug nach Home Assistant noch lädt (der Worker lässt
// nur freigegebene Adressen zu, siehe HOME_ASSISTANT.md).
const QUELLEN_NAMEN = {
  departures: "Abfahrten", weather: "Wetter", commute: "Arbeitsweg", calendar: "Termine",
  news: "Nachrichten", events: "Veranstaltungen", sport: "Fußball", music: "Musik-Charts",
};

function tafelQuellen() {
  const seq = CONFIG.panelSequence || PANEL_IDS;
  const aus = { calendar: !CONFIG.calendarWorkerUrl, sport: !(CONFIG.sportTeams || []).length };
  return Object.keys(QUELLEN_NAMEN).filter(function (id) {
    return seq.indexOf(id) !== -1 && !aus[id];
  }).map(function (id) {
    const at = dataStand[id] || 0;
    return { id: id, name: QUELLEN_NAMEN[id], stand: at, alt: !!(at && Date.now() - at > STALE_MS[id]) };
  });
}

function updateStaleBadge() {
  const badge = document.getElementById("topbarStand");
  if (!badge) return;
  const name = activeSequence[panelIndex];
  const at = dataStand[name];
  const stale = !!(at && STALE_MS[name] && Date.now() - at > STALE_MS[name]);
  const text = stale ? "Stand " + new Date(at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "";
  if (badge.textContent !== text) badge.textContent = text;
}

function updateTopbarTitle(name) {
  if (!els.topbarTitle) return;
  const panelEl = document.getElementById("panel-" + name);
  let text = "";
  if (PANELS_OHNE_KOPFTITEL.indexOf(name) === -1) {
    const label = panelEl ? panelEl.querySelector(".view-label") : null;
    text = label ? label.textContent : ((PANEL_NAV_META[name] || {}).label || "");
    if (name === "departures") text = "Abfahrten — " + String(CONFIG.stopQuery || "").split(",")[0];
  }
  els.topbarTitle.textContent = text;
  if (panelEl) {
    const accent = getComputedStyle(panelEl).getPropertyValue("--accent");
    if (accent) els.topbarTitle.style.setProperty("--accent", accent.trim());
  }
  const shell = document.querySelector(".panel");
  const fullbleed = PANELS_VOLLBILD.indexOf(name) !== -1 ||
    (name === "news" && (CONFIG.nachrichtenLayout || "rechts") !== "rechts");
  if (shell) shell.classList.toggle("is-fullbleed", fullbleed);
  updateStaleBadge();
}

const progressFillEl = document.getElementById("progressFill");
let carouselTimer = null;

// Findet die aktuell zutreffende Zeitperiode aus CONFIG.timeBasedPriority
// (siehe dort für die Begründung) — Perioden dürfen über Mitternacht
// gehen (z.B. startHour:22, endHour:6).
function currentPriorityPeriod() {
  const periods = CONFIG.timeBasedPriority || [];
  const hour = new Date().getHours();
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const inRange = p.startHour <= p.endHour
      ? (hour >= p.startHour && hour < p.endHour)
      : (hour >= p.startHour || hour < p.endHour);
    if (inRange) return p;
  }
  return null;
}

// Zeitbewusste Dauer: boost-Panels der aktuellen Periode laufen länger,
// alle anderen kürzer (muteFactor) — ohne passende Periode unverändert.
function durationForPanel(name) {
  const base = (CONFIG.panelDurations && CONFIG.panelDurations[name]) || CONFIG.panelDurationMs;
  const period = currentPriorityPeriod();
  if (!period) return base;
  const isBoosted = period.boost && period.boost.indexOf(name) !== -1;
  const factor = isBoosted ? (period.boostFactor || 1) : (period.muteFactor != null ? period.muteFactor : 1);
  return Math.round(base * factor);
}

function resetProgressBar(durationMs) {
  if (!progressFillEl) return;
  // transform: scaleX statt width — läuft komplett auf dem Compositor
  // (GPU), löst kein Layout/Reflow pro Frame aus. Auf dem iPad Air 1
  // ist das der Unterschied zwischen ruckelfrei und Frame-Drops.
  progressFillEl.style.transition = "none";
  progressFillEl.style.transform = "scaleX(0)";
  // Reflow erzwingen, damit der Browser die Reset-Breite wirklich anwendet,
  // bevor die neue Transition startet.
  void progressFillEl.offsetWidth;
  progressFillEl.style.transition = "transform " + durationMs + "ms linear";
  progressFillEl.style.transform = "scaleX(1)";
}

// Reihenfolge nach jeder vollen Runde neu gemischt (siehe Kommentar bei
// CONFIG.panelSequence), damit man sie sich nach ein paar Wochen nicht
// stur auswendig lernt. "departures" bleibt als Anker immer an erster
// Stelle — die wichtigste Information soll direkt nach dem Rundenstart
// kommen, nicht erst irgendwann per Zufall.
let activeSequence = (CONFIG.panelSequence || []).slice();

function shuffleSequence() {
  const seq = CONFIG.panelSequence || [];
  const anchor = seq[0];
  const rest = seq.slice(1);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = rest[i]; rest[i] = rest[j]; rest[j] = tmp;
  }

  // Zeitbewusste Priorität, Teil 2 (siehe durationForPanel für Teil 1 —
  // die Dauer): boost-Panels der aktuellen Periode nach dem Mischen nach
  // vorne sortieren, damit sie nicht nur länger, sondern auch früher in
  // der Runde drankommen. Innerhalb von "boost" und "Rest" bleibt die
  // zufällige Reihenfolge von oben erhalten — kein starres Muster.
  const period = currentPriorityPeriod();
  if (period && period.boost && period.boost.length) {
    const boosted = rest.filter(function (n) { return period.boost.indexOf(n) !== -1; });
    const others = rest.filter(function (n) { return period.boost.indexOf(n) === -1; });
    activeSequence = [anchor].concat(boosted, others);
  } else {
    activeSequence = [anchor].concat(rest);
  }

  // Gelernt (lernen.js): was jemand um diese Uhrzeit sonst selbst aufruft,
  // kommt direkt nach dem Anker.
  const learned = window.TafelLernen ? TafelLernen.bevorzugtePanels() : [];
  if (learned.length) {
    const head = activeSequence.slice(1).filter(function (n) { return learned.indexOf(n) !== -1; });
    const tail = activeSequence.slice(1).filter(function (n) { return learned.indexOf(n) === -1; });
    activeSequence = [anchor].concat(head, tail);
  }
}

function pickNextAvailablePanel() {
  let tries = 0;
  while (tries < activeSequence.length) {
    panelIndex = (panelIndex + 1) % activeSequence.length;
    if (panelIndex === 0) shuffleSequence();
    const name = activeSequence[panelIndex];
    if (panelVerfuegbar(name)) return name;
    tries++;
  }
  return activeSequence[panelIndex];
}

// Verfügbarkeit; eine Prüfung, die wirft, gilt als "nicht verfügbar".
function panelVerfuegbar(name) {
  const check = PANEL_AVAILABILITY[name];
  if (!check) return true;
  try { return !!check(); } catch (e) { console.error("Verfügbarkeit " + name + ":", e); return false; }
}

// "Als Nächstes: Wetter" in den letzten 3 Sekunden (IDEEN R4): der
// Wechsel kommt nicht überraschend. Nur schauen, nicht weiterschalten.
let nextHintTimer = null;

function peekNextPanel() {
  for (let k = 1; k <= activeSequence.length; k++) {
    const name = activeSequence[(panelIndex + k) % activeSequence.length];
    if (panelVerfuegbar(name)) return name;
  }
  return null;
}

function setNextHint(ms) {
  const el = document.getElementById("topbarNext");
  if (nextHintTimer) { clearTimeout(nextHintTimer); nextHintTimer = null; }
  if (el) el.classList.remove("is-shown");
  if (ms == null || !el) return;
  nextHintTimer = setTimeout(function () {
    nextHintTimer = null;
    const next = peekNextPanel();
    const meta = next ? PANEL_NAV_META[next] : null;
    if (!meta || next === activeSequence[panelIndex]) return;
    // Nur ganz oder gar nicht: der Titel daneben hat Vorrang (style.css).
    const texte = ["Als Nächstes: " + meta.label, "Gleich: " + meta.label];
    for (let i = 0; i < texte.length; i++) {
      el.textContent = texte[i];
      if (el.scrollWidth <= el.clientWidth + 1) {
        el.classList.add("is-shown");
        return;
      }
    }
    el.textContent = "";
  }, Math.max(0, ms - 3000));
}

// Ein Panelwechsel. Wirft ein Panel oder eine Verfügbarkeitsprüfung eine
// Ausnahme, läuft das Karussell trotzdem weiter – vorher hätte jeder
// Fehler hier den Durchlauf für immer angehalten (genau das, was an der
// Wand am meisten stört, FEEDBACK 10.10.).
function carouselStep() {
  // Immer erst einen laufenden Timer abräumen: ruft der Wächter das auf,
  // während noch einer läuft, liefen sonst zwei Ketten parallel.
  if (carouselTimer) { clearTimeout(carouselTimer); carouselTimer = null; }
  try {
    showPanel(pickNextAvailablePanel());
  } catch (e) {
    console.error("Karussell: Panelwechsel fehlgeschlagen –", e);
  }
  scheduleCarousel();
}

function scheduleCarousel() {
  const seq = activeSequence;
  if (!seq || seq.length < 2) return;

  const currentName = seq[panelIndex];
  const duration = durationForPanel(currentName);
  resetProgressBar(duration);
  setNextHint(duration);

  if (carouselTimer) clearTimeout(carouselTimer);
  carouselTimer = setTimeout(carouselStep, duration);
}

// Karussell-Wächter (alle 15 s aus tickClock): Steht das aktuelle Panel
// länger als doppelt so lange wie vorgesehen (mindestens 3 min), ohne dass
// es dafür einen Grund gibt (Antippen, Übersicht, Raumansicht, Nacht-
// ansicht, Ambient), wird das Karussell neu angeworfen. Sicherheitsnetz
// für alles, was den Wechsel-Timer unbemerkt verlieren könnte.
let letzterPanelWechsel = Date.now();

function karussellWaechter() {
  if (recentlyTouched || panelNavOpen || ambientActive || nightViewActive || carouselIdleTimer) return;
  if (window.TafelHAUI && TafelHAUI.blocksCarousel()) return;
  if (!activeSequence || activeSequence.length < 2) return;
  const soll = durationForPanel(activeSequence[panelIndex]);
  if (Date.now() - letzterPanelWechsel <= Math.max(2 * soll, 3 * 60 * 1000)) return;
  console.warn("Karussell stand " + Math.round((Date.now() - letzterPanelWechsel) / 1000) + " s – neu angeworfen");
  letzterPanelWechsel = Date.now();
  carouselStep();
}

// ---------- Panel-Übersicht (Direktsprung) + Touch-Pause ----------
// Zwei zusammenhängende Wünsche: (1) von überall aus direkt zu einem
// bestimmten Panel springen können, statt den Durchlauf abzuwarten, und
// (2) jeder Touch irgendwo auf der Tafel hält den automatischen Wechsel
// für 10s an (verlängert sich bei weiterem Touch), damit man in Ruhe
// fertiglesen kann, bevor es weitergeht.
const PANEL_NAV_META = {
  departures: { icon: "🚌", label: "Abfahrten" },
  commute: { icon: "🧭", label: "Arbeitsweg" },
  weather: { icon: "⛅", label: "Wetter" },
  news: { icon: "📰", label: "Nachrichten" },
  music: { icon: "🎵", label: "Musik-Charts" },
  sport: { icon: "⚽", label: "Fußball" },
  quote: { icon: "💬", label: "Spruch des Tages" },
  trivia: { icon: "📅", label: "Auf den Tag genau" },
  quiz: { icon: "❓", label: "Allgemeinwissen" },
  riddle: { icon: "🧩", label: "Rätsel des Tages" },
  events: { icon: "🎉", label: "Veranstaltungen" },
  calendar: { icon: "🗓️", label: "Termine" },
  home: { icon: "🏠", label: "Zuhause" },
  klima: { icon: "🌡️", label: "Raumklima" },
  medien: { icon: "🔊", label: "Medien" },
  tagesschau: { icon: "📺", label: "tagesschau in 100 s" },
  tagesblick: { icon: "☀️", label: "Tagesblick" },
};

let panelNavOpen = false;
let carouselIdleTimer = null;
const CAROUSEL_IDLE_RESUME_MS = 10000;

// Fortschrittsbalken einfrieren statt zurücksetzen: liest die aktuell
// interpolierte transform-Matrix aus (auch mitten in einer laufenden
// Transition liefert getComputedStyle den echten Momentanwert) und friert
// genau dort ein, statt die Animation einfach zu stoppen und später bei
// 0 neu zu starten.
function freezeProgressBar() {
  if (!progressFillEl) return;
  const computed = getComputedStyle(progressFillEl).transform;
  progressFillEl.style.transition = "none";
  progressFillEl.style.transform = computed === "none" ? "scaleX(0)" : computed;
}

function currentProgressFraction() {
  if (!progressFillEl) return 0;
  const computed = getComputedStyle(progressFillEl).transform;
  if (computed === "none") return 0;
  // matrix(a, b, c, d, tx, ty) — bei einer reinen scaleX-Transformation
  // wie hier ist "a" exakt der Skalierungsfaktor, also der Fortschrittsanteil.
  const match = /matrix\(([^,]+),/.exec(computed);
  const scale = match ? parseFloat(match[1]) : NaN;
  return isNaN(scale) ? 0 : Math.min(Math.max(scale, 0), 1);
}

// Pausiert nicht nur den Panel-Wechsel, sondern auch die inneren
// Diashow-Timer von News/Sport — sonst "pausiert" ein Touch nur das
// Springen zum nächsten PANEL, während die Meldungen/Karten darunter
// unbeirrt weiter durchlaufen. Betrifft beide Timer unabhängig davon,
// welches Panel gerade aktiv ist (clearInterval auf null ist ein
// No-Op, kostet also nichts, wenn der jeweils andere gar nicht läuft).
function pauseSlideshowTimers() {
  stopNewsSlideshow();
  stopSportSlideshow();
}

function pauseCarouselIndefinitely() {
  recentlyTouched = true;
  setNextHint(null);
  if (carouselTimer) { clearTimeout(carouselTimer); carouselTimer = null; }
  if (carouselIdleTimer) { clearTimeout(carouselIdleTimer); carouselIdleTimer = null; }
  freezeProgressBar();
  pauseSlideshowTimers();
}

function resumeCarouselFromFraction() {
  if (!activeSequence || activeSequence.length < 2) return;
  const currentName = activeSequence[panelIndex];
  const totalDuration = durationForPanel(currentName);
  const remaining = Math.max(totalDuration * (1 - currentProgressFraction()), 500);

  if (progressFillEl) {
    void progressFillEl.offsetWidth; // Reflow erzwingen, siehe resetProgressBar oben
    progressFillEl.style.transition = "transform " + remaining + "ms linear";
    progressFillEl.style.transform = "scaleX(1)";
  }

  // keepIndex=true: an der Meldung/Karte weiterlaufen, bei der pausiert
  // wurde, nicht wieder bei der ersten anfangen.
  if (currentName === "news") startNewsSlideshow(true);
  if (currentName === "sport") startSportSlideshow(true);

  setNextHint(remaining);
  if (carouselTimer) clearTimeout(carouselTimer);
  carouselTimer = setTimeout(carouselStep, remaining);
}

function deferCarouselAdvance() {
  markUserActivity();
  if (panelNavOpen) return; // Übersicht offen: pauseCarouselIndefinitely() übernimmt das
  if (window.TafelHAUI && TafelHAUI.blocksCarousel()) return; // Raumansicht/HA-Einrichtung offen
  if (!activeSequence || activeSequence.length < 2) return;

  if (carouselTimer) {
    clearTimeout(carouselTimer);
    carouselTimer = null;
    freezeProgressBar();
    pauseSlideshowTimers();
    setNextHint(null);
  }

  if (carouselIdleTimer) clearTimeout(carouselIdleTimer);
  carouselIdleTimer = setTimeout(function () {
    carouselIdleTimer = null;
    recentlyTouched = false;
    resumeCarouselFromFraction();
  }, CAROUSEL_IDLE_RESUME_MS);
}

// ---------- Ambient-Modus ---------- (siehe CONFIG.ambientAfterMs / .ambient-overlay)
let ambientTimer = null;
let ambientActive = false;

// FEEDBACK 10.10.: An einer Wandtafel tippt fast nie jemand — der
// Berührungs-Timeout schickte die Tafel deshalb praktisch immer nach einer
// Stunde in die Riesen-Uhr, und das Karussell stand. Ambient gibt es jetzt
// nur noch bei echter Abwesenheit (Home Assistant: niemand zu Hause, siehe
// checkAbsence in ha-panels.js). CONFIG.ambientAfterMs = 0 (Standard)
// schaltet den Berührungs-Timeout ganz ab; ein Wert > 0 holt ihn zurück.
function armAmbientTimer() {
  if (ambientTimer) clearTimeout(ambientTimer);
  ambientTimer = null;
  if (!CONFIG.ambientAfterMs) return;
  ambientTimer = setTimeout(enterAmbientMode, CONFIG.ambientAfterMs);
}

// Ruhebild mit Nutzen (IDEEN AM1): unter der Uhr Datum, Temperatur und
// die nächste Bahn — die zwei Zahlen, die man im Vorbeigehen wissen will.
function updateAmbientInfo(now) {
  const el = document.getElementById("ambientInfo");
  if (!el) return;
  const parts = [now.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "long" })];
  if (lastWeatherSnapshot && lastWeatherSnapshot.temp != null) parts.push(lastWeatherSnapshot.temp + "°");
  const dep = (lastDepartureSnapshot || []).filter(function (d) { return d.whenMs && d.whenMs > now.getTime(); })[0];
  if (dep) parts.push("Linie " + dep.line + " in " + Math.max(1, Math.round((dep.whenMs - now.getTime()) / 60000)) + " min");
  const text = parts.join(" · ");
  if (el.textContent !== text) el.textContent = text;
}

function enterAmbientMode() {
  if (ambientActive) return;
  ambientActive = true;
  pauseCarouselIndefinitely();
  // Abwesenheit ist keine Berührung: Tiefschlaf darf weiter greifen.
  recentlyTouched = false;
  if (els.ambientClock) els.ambientClock.textContent = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  updateAmbientInfo(new Date());
  if (els.ambientOverlay) els.ambientOverlay.classList.add("is-active");
}

function exitAmbientMode() {
  if (!ambientActive) return;
  ambientActive = false;
  if (els.ambientOverlay) els.ambientOverlay.classList.remove("is-active");
  // Nach einer Stunde+ Stillstand lieber frisch mit voller Anzeigedauer
  // starten als eine längst bedeutungslose Rest-Fraktion fortzusetzen.
  scheduleCarousel();
}

// Zentraler Einstiegspunkt für "hier ist gerade jemand" — hält den
// Nacht-Tiefschlaf zurück (recentlyTouched), verschiebt den Ambient-
// Timer und beendet den Ambient-Modus sofort, falls gerade aktiv.
function markUserActivity() {
  recentlyTouched = true;
  armAmbientTimer();
  if (ambientActive) exitAmbientMode();
}

// Einfarbige Linien-Symbole für die Übersicht (IDEEN Ü1) statt bunter
// Emoji — ruhiger, auf iOS 12 identisch, in der Akzentfarbe färbbar.
const PANEL_NAV_ICONS = {
  departures: '<rect x="5" y="3.5" width="14" height="14" rx="3"/><path d="M5 11h14M8.5 21l1.5-3.5M15.5 21L14 17.5"/><circle cx="8.5" cy="14.3" r="0.8" fill="currentColor"/><circle cx="15.5" cy="14.3" r="0.8" fill="currentColor"/>',
  commute: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  weather: '<path d="M7.5 18h9a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7.5 18z"/>',
  news: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7 9h10M7 12.5h10M7 16h6"/>',
  music: '<path d="M9 17.5V5.5l10.5-2v12"/><circle cx="6.6" cy="17.5" r="2.4"/><circle cx="17.1" cy="15.5" r="2.4"/>',
  sport: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5l3.5 2.5-1.3 4h-4.4l-1.3-4z"/>',
  quote: '<path d="M5 17.5c1.7-1 2.5-3 2.5-5.5H5V6.5h5.5V12c0 3.5-1.7 5.7-5 6.5zM13.5 17.5c1.7-1 2.5-3 2.5-5.5h-2.5V6.5H19V12c0 3.5-1.7 5.7-5 6.5z"/>',
  trivia: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9.5h16M8.5 3v4M15.5 3v4"/>',
  quiz: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.7v.5"/><circle cx="12" cy="16.8" r="0.6" fill="currentColor"/>',
  riddle: '<path d="M9 4h4v2.5a1.5 1.5 0 1 0 3 0V4h4v6h-2.5a1.5 1.5 0 1 0 0 3H20v7H4V4h5z"/>',
  events: '<path d="M4 20l5-14 9 9z"/><path d="M14 4.5l1 2M18 7l2-1M19 10.5l2 .5"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9.5h16M8.5 3v4M15.5 3v4M8 13h3v3H8z"/>',
  home: '<path d="M3.5 11L12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
  klima: '<path d="M10 14.3V5a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z"/><path d="M12 9.5V17"/>',
  medien: '<rect x="6" y="3" width="12" height="18" rx="3"/><circle cx="12" cy="14" r="3.2"/><circle cx="12" cy="7.3" r="1"/>',
  tagesschau: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8.5 20.5h7M12 17v3.5M10.5 8.5v5l4-2.5z"/>',
  tagesblick: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
};

// Übersicht: Panels, die nicht in der automatischen Runde laufen, aber
// erreichbar bleiben sollen (länger pausierter HomePod → weiterhören).
const PANEL_IN_UEBERSICHT = {
  medien: function () { return !!(window.TafelHAUI && TafelHAUI.panelErreichbar && TafelHAUI.panelErreichbar("medien")); },
};

function buildPanelNavGrid() {
  if (!els.panelNavGrid) return;
  els.panelNavGrid.innerHTML = "";
  const currentName = activeSequence[panelIndex];
  // Smart-Home zuerst, dann der Rest in Karussell-Reihenfolge.
  const first = ["home", "klima", "medien", "tagesblick", "departures"];
  const seq = first.concat((CONFIG.panelSequence || []).filter(function (n) { return first.indexOf(n) === -1; }));

  seq.forEach(function (name) {
    const check = PANEL_IN_UEBERSICHT[name] || PANEL_AVAILABILITY[name];
    if (check && !check()) return;
    const meta = PANEL_NAV_META[name];
    if (!meta) return;

    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "panel-nav-tile" + (name === currentName ? " is-current" : "");

    const icon = document.createElement("span");
    icon.className = "panel-nav-tile-icon";
    if (PANEL_NAV_ICONS[name]) {
      icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + PANEL_NAV_ICONS[name] + "</svg>";
    } else {
      icon.textContent = meta.icon;
    }
    tile.appendChild(icon);

    const label = document.createElement("span");
    label.className = "panel-nav-tile-label";
    label.textContent = meta.label;
    tile.appendChild(label);

    tile.addEventListener("click", function (ev) {
      ev.stopPropagation();
      // Selbst gewählt → zählt fürs Lernen (welches Panel wann, lernen.js).
      if (window.TafelLernen) TafelLernen.merkePanel(name);
      jumpToPanel(name);
    });

    els.panelNavGrid.appendChild(tile);
  });
}

function setPanelNavOpen(open) {
  panelNavOpen = open;
  if (els.panelNavOverlay) els.panelNavOverlay.classList.toggle("is-open", open);
  if (open) {
    buildPanelNavGrid();
    pauseCarouselIndefinitely();
  } else {
    deferCarouselAdvance();
  }
}

function jumpToPanel(name) {
  panelNavOpen = false;
  if (els.panelNavOverlay) els.panelNavOverlay.classList.remove("is-open");
  if (carouselIdleTimer) { clearTimeout(carouselIdleTimer); carouselIdleTimer = null; }

  const idx = activeSequence.indexOf(name);
  if (idx !== -1) panelIndex = idx;
  showPanel(name);
  scheduleCarousel();
}

function initPanelNav() {
  if (els.panelNavToggle) {
    els.panelNavToggle.addEventListener("click", function (ev) {
      ev.stopPropagation();
      setPanelNavOpen(!panelNavOpen);
    });
  }

  if (els.panelNavOverlay) {
    els.panelNavOverlay.addEventListener("click", function (ev) {
      if (ev.target === els.panelNavOverlay || (ev.target.closest && ev.target.closest(".panel-nav-close"))) setPanelNavOpen(false);
    });
  }

  // Capture-Phase statt Bubble-Phase: das Radio-Menü ruft bei eigenen
  // Klicks ev.stopPropagation() auf (schließt sich sonst sofort wieder
  // über den "irgendwo hin klicken schließt das Menü"-Handler weiter
  // unten in initRadioBar). Ein Bubble-Phase-Listener hier würde von
  // diesem stopPropagation() ebenfalls verschluckt — Touches auf den
  // Radio-Bereich sollen den Durchlauf aber genauso pausieren wie jeder
  // andere Touch. In der Capture-Phase feuert dieser Listener, bevor
  // stopPropagation() überhaupt greifen kann.
  //
  // touchstart zusätzlich zu click: ein Wisch (siehe initStageSwipe unten)
  // löst auf iOS Safari nicht zuverlässig ein click-Event aus, touchstart
  // dagegen immer — sonst würde eine Wischgeste den Durchlauf nicht
  // pausieren.
  document.addEventListener("click", deferCarouselAdvance, true);
  document.addEventListener("touchstart", deferCarouselAdvance, true);
}

// ---------- Wischgeste für News/Sport-Diashows ----------
// Manuelles Vor-/Zurückblättern durch die Meldungen bzw. Vereinskarten,
// unabhängig vom automatischen Diashow-Timer (der ja jetzt bei jedem
// Touch sowieso pausiert, siehe pauseSlideshowTimers).
let stageSwipeStartX = null;
let stageSwipeStartY = null;

function initStageSwipe() {
  if (!els.stage) return;

  els.stage.addEventListener("touchstart", function (ev) {
    const t = ev.touches && ev.touches[0];
    if (!t) return;
    stageSwipeStartX = t.clientX;
    stageSwipeStartY = t.clientY;
  }, { passive: true });

  els.stage.addEventListener("touchend", function (ev) {
    if (stageSwipeStartX === null) return;
    const t = ev.changedTouches && ev.changedTouches[0];
    const startX = stageSwipeStartX;
    const startY = stageSwipeStartY;
    stageSwipeStartX = null;
    stageSwipeStartY = null;
    if (!t) return;

    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    // Nur eindeutig horizontale Gesten werten (klar mehr Breite als
    // Höhe), sonst zählt jedes leichte Zittern beim Antippen als Wisch.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;

    const activePanel = document.querySelector(".panel-view.active");
    if (!activePanel) return;
    const dir = dx < 0 ? 1 : -1;

    if (activePanel.id === "panel-news" && newsItems.length > 1) {
      showNewsSlide((newsSlideIndex + dir + newsItems.length) % newsItems.length);
    } else if (activePanel.id === "panel-sport" && sportItems.length > 1) {
      showSportSlide((sportSlideIndex + dir + sportItems.length) % sportItems.length);
    }
  }, { passive: true });
}

// ---------- Start ----------
function init() {
  updateTopbarTitle("departures");
  document.body.classList.toggle("wetter-ruhig", (CONFIG.wetterEffekte || "ruhig") === "ruhig");
  // Regentipp gehört zur Hauptaussage (IDEEN W2): unter die Beschreibung.
  const tipHome = document.querySelector("#weatherBig .weather-big-text");
  if (tipHome && els.weatherTip) tipHome.appendChild(els.weatherTip);
  // Sofort beim Start alle Panels außer dem sichtbaren ersten unmounten
  // (siehe unmountInactivePanels-Kommentar) — sonst stünden bis zum ersten
  // Karussell-Wechsel alle 11 Panels unnötig lange voll im Speicher.
  unmountInactivePanels("departures");

  initRadioBar();
  initPanelNav();
  initStageSwipe();
  armAmbientTimer();
  // Home Assistant (ha.js/ha-panels.js) — ohne Token/Adresse ein No-Op.
  if (window.TafelHAUI) TafelHAUI.init();
  if (window.TafelLernen) TafelLernen.init();
  if (window.TafelClips) TafelClips.init();
  if (window.TafelTag) TafelTag.init();
  if (window.TafelWarn) TafelWarn.init();

  tickClock();
  setInterval(tickClock, CONFIG.refreshClockMs);

  updateDepartures();
  setInterval(updateDepartures, CONFIG.refreshDeparturesMs);

  // Gehzeit einmalig berechnen und danach die Abfahrten einmal neu
  // rendern, damit die Farbkanten/„Los bis"-Hinweise ohne 30s Wartezeit
  // erscheinen.
  resolveWalkTime().then(function (mins) {
    if (mins != null) updateDepartures();
  });

  updateWeather();
  setInterval(updateWeather, CONFIG.refreshWeatherMs);

  updateNews();
  setInterval(updateNews, CONFIG.refreshNewsMs);
  setInterval(eilChipZeichnen, 60 * 1000); // abgelaufene Eilmeldung verschwindet

  updateCommute();
  setInterval(updateCommute, CONFIG.refreshCommuteMs);

  updateMusic();
  setInterval(updateMusic, CONFIG.refreshMusicMs);

  updateQuote();
  setInterval(updateQuote, CONFIG.refreshQuoteMs);

  updateTrivia();
  setInterval(updateTrivia, CONFIG.refreshTriviaMs);

  updateQuiz();
  setInterval(updateQuiz, CONFIG.refreshQuizMs);

  // Rein lokale Auswahl nach Tag-des-Jahres, kein Netzwerk-Refresh nötig —
  // der tägliche Auto-Reload der Tafel sorgt schon dafür, dass der
  // Tageswechsel ankommt.
  updateRiddle();

  updateEvents();
  // Eigene Liste: rechnet nur lokal – oft genug, dass "in 6 Tagen" nach
  // Mitternacht stimmt.
  setInterval(updateEvents, (CONFIG.veranstaltungenQuelle || "bremen") === "bremen" ? 15 * 60 * 1000 : CONFIG.refreshEventsMs);

  updateCalendar();
  setInterval(updateCalendar, CONFIG.refreshCalendarMs);

  updateWasteLine();
  if (CONFIG.wasteCollection && CONFIG.wasteCollection.refreshMs) {
    setInterval(updateWasteLine, CONFIG.wasteCollection.refreshMs);
  }

  updateSport();
  setInterval(updateSport, CONFIG.refreshSportMs);

  scheduleCarousel();

  if (CONFIG.fullReloadMs) {
    setTimeout(function () {
      // Ein einfaches location.reload() kann trotzdem aus dem Cache
      // beantwortet werden (GitHub Pages liefert über ein CDN aus, das
      // eigene Cache-Control-Header setzt — die überstimmen unsere
      // <meta http-equiv="Cache-Control">-Tags oben, die sind nur eine
      // Empfehlung, kein echter HTTP-Header). Deshalb stattdessen auf
      // eine neue URL mit Zeitstempel wechseln — die hat garantiert noch
      // niemand im Cache, weder der Browser noch ein CDN dazwischen.
      window.location.href = window.location.pathname + "?_=" + Date.now();
    }, CONFIG.fullReloadMs);
  }
}

init();
