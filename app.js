// ---------------------------------------------------------------
// Föhrenstraße Abfahrtstafel — app.js
// Datenquelle ÖPNV: Transitous (api.transitous.org) — kostenlos, kein
// API-Key, für Dauerbetrieb gedacht (MOTIS-Backend, GTFS/GTFS-RT-basiert).
// Datenquelle Wetter: Open-Meteo (kostenlos, kein API-Key)
// Bewusst ohne Optional Chaining (?.), Array.flat() etc. geschrieben,
// damit das auch auf Safari 12 (iPad Air 1 / iOS 12.5.x) läuft.
// ---------------------------------------------------------------

const API_BASE = "https://api.transitous.org/api";

const els = {
  rows: document.getElementById("departureRows"),
  leaveNowBanner: document.getElementById("leaveNowBanner"),
  status: document.getElementById("statusText"),
  lastUpdate: document.getElementById("lastUpdate"),
  clockTime: document.getElementById("clockTime"),
  clockDate: document.getElementById("clockDate"),
  nightOverlay: document.getElementById("nightOverlay"),
  weatherPanel: document.getElementById("panel-weather"),
  weatherSky: document.getElementById("weatherSky"),
  weatherBig: document.getElementById("weatherBig"),
  weatherBigIcon: document.getElementById("weatherBigIcon"),
  weatherBigTemp: document.getElementById("weatherBigTemp"),
  weatherBigDesc: document.getElementById("weatherBigDesc"),
  weatherBigMinMax: document.getElementById("weatherBigMinMax"),
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
  commuteHero: document.getElementById("commuteHero"),
  commuteRace: document.getElementById("commuteRace"),
  commuteMapWrap: document.getElementById("commuteMapWrap"),
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
  els.clockDate.textContent = now.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
  updateNightDim(now.getHours());
}

// ---------- Nachtdimmung ----------
// Läuft im selben Sekunden-Takt wie die Uhr mit (kein eigener Timer nötig)
// — nur ein Zahlenvergleich + ein Klassen-Toggle auf einem einzigen
// Element, kostet praktisch nichts.
function isNightHour(hour) {
  const cfg = CONFIG.nightDim;
  if (!cfg) return false;
  const start = cfg.startHour;
  const end = cfg.endHour;
  if (start === end) return false;
  // z.B. 22–5 Uhr: Bereich geht über Mitternacht.
  if (start > end) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

function updateNightDim(hour) {
  if (!els.nightOverlay) return;
  const cfg = CONFIG.nightDim;
  const active = isNightHour(hour);
  els.nightOverlay.style.setProperty("--night-dim-opacity", (cfg && cfg.opacity != null) ? cfg.opacity : 0.65);
  els.nightOverlay.classList.toggle("is-active", active);
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

// "Sollte ich jetzt los?"-Kopfzeile überm Abfahrten-Board: statt drei
// Panels (Wetter/Pendel/Abfahrten) einzeln durchzuschauen und selbst
// zusammenzurechnen, eine einzige Handlungsempfehlung aus dem, was die
// Tafel eh schon weiß — nächste erreichbare Abfahrt (samt echter
// Gehzeit-Berechnung, siehe resolveWalkTime) plus Regen-Hinweis aus dem
// Wetter-Abruf (siehe rainSoonForLeave). Nur echte Synthese aus bereits
// vorhandenen Daten, kein zusätzlicher API-Aufruf.
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

  const sub = document.createElement("div");
  sub.className = "leave-now-sub";
  sub.textContent = "Linie " + lineName + (dest ? " nach " + dest : "") + " · ab " + timeStr +
    (rainSoonForLeave ? " · ☔ Schirm mitnehmen" : "");

  els.leaveNowBanner.appendChild(headline);
  els.leaveNowBanner.appendChild(sub);
  els.leaveNowBanner.classList.add("is-visible");
  els.leaveNowBanner.classList.toggle("is-urgent", minutesUntilLeave <= 2);
}

function renderDepartures(departures) {
  els.rows.innerHTML = "";
  const now = Date.now();

  if (!departures.length) {
    const div = document.createElement("div");
    div.className = "row placeholder";
    div.textContent = "Keine Abfahrten in den nächsten 60 Minuten";
    els.rows.appendChild(div);
    renderLeaveNowBanner(null, now);
    return;
  }

  // Ist die Gehzeit bekannt: Abfahrten rausfiltern, die eh nicht mehr zu
  // schaffen sind (mehr als 1 Minute "zu spät los"). Sonst steht die Tafel
  // voller Verbindungen, die man ohnehin schon verpasst hat, und die
  // tatsächlich planbaren gehen darin unter — genau das Problem, das die
  // Tafel eigentlich lösen soll.
  let visible = departures;
  if (walkMinutesToStop != null) {
    visible = departures.filter(function (dep) {
      if (dep.cancelled || dep.tripCancelled) return true; // Ausfälle immer anzeigen
      const place = dep.place || {};
      const when = place.departure || place.scheduledDeparture;
      if (!when) return true;
      const leaveByMs = new Date(when).getTime() - walkMinutesToStop * 60000;
      const minutesUntilLeave = Math.round((leaveByMs - now) / 60000);
      return minutesUntilLeave > -1;
    });
  }

  if (!visible.length) {
    const div = document.createElement("div");
    div.className = "row placeholder";
    div.textContent = "Gerade keine erreichbare Abfahrt — nächste in Kürze";
    els.rows.appendChild(div);
    renderLeaveNowBanner(null, now);
    return;
  }

  const firstReachable = visible.filter(function (d) { return !d.cancelled && !d.tripCancelled; })[0];
  renderLeaveNowBanner(firstReachable, now);

  visible.slice(0, CONFIG.maxRows).forEach(function (dep) {
    const place = dep.place || {};
    const when = place.departure || place.scheduledDeparture;
    const scheduled = place.scheduledDeparture;
    const whenDate = when ? new Date(when) : null;
    const minutes = whenDate ? Math.round((whenDate.getTime() - now) / 60000) : null;
    const cancelled = !!(dep.cancelled || dep.tripCancelled);

    // Gehzeit-Hinweis: bis wann muss man spätestens los, um diesen Bus
    // noch zu bekommen.
    let walkHint = null;
    let urgencyClass = "";
    if (walkMinutesToStop != null && whenDate) {
      const leaveByMs = whenDate.getTime() - walkMinutesToStop * 60000;
      const minutesUntilLeave = Math.round((leaveByMs - now) / 60000);
      urgencyClass = walkUrgencyClass(minutesUntilLeave);
      const leaveByDate = new Date(leaveByMs);
      walkHint = "Los bis " + leaveByDate.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    }

    const row = document.createElement("div");
    row.className = "row" + urgencyClass;
    if (cancelled) row.style.opacity = "0.45";

    const lineName = dep.routeShortName || dep.tripShortName || dep.displayName || "?";

    const lineBadge = document.createElement("span");
    lineBadge.className = "line-badge " + productClass(dep.mode);
    lineBadge.textContent = lineName;

    const destWrap = document.createElement("span");
    destWrap.className = "dest-wrap";

    const dest = document.createElement("span");
    dest.className = "dest";
    dest.textContent = cancelled
      ? (dep.headsign || "") + " (fällt aus)"
      : (dep.headsign || "—");
    destWrap.appendChild(dest);

    if (walkHint && !cancelled) {
      const hint = document.createElement("span");
      hint.className = "walk-hint";
      hint.textContent = walkHint;
      destWrap.appendChild(hint);
    }

    const timeCell = document.createElement("span");
    timeCell.className = "time-cell";

    const timeMin = document.createElement("span");
    timeMin.className = "time-min" + (minutes !== null && minutes <= 0 ? " now" : "");
    timeMin.textContent =
      minutes === null ? "–" : (minutes <= 0 ? "jetzt" : minutes + " min");

    timeCell.appendChild(timeMin);

    // Kleine, genaue Uhrzeit unter der Minutenangabe — grün wenn
    // pünktlich, rot wenn verspätet (>= 60 Sekunden Abweichung vom
    // Fahrplan).
    if (whenDate) {
      const delaySec = (when && scheduled && when !== scheduled)
        ? Math.round((new Date(when).getTime() - new Date(scheduled).getTime()) / 1000)
        : 0;
      const isLate = delaySec >= 60;

      const clockEl = document.createElement("span");
      clockEl.className = "time-clock " + (isLate ? "late" : "ontime");
      clockEl.textContent = whenDate.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      timeCell.appendChild(clockEl);
    }

    row.appendChild(lineBadge);
    row.appendChild(destWrap);
    row.appendChild(timeCell);
    els.rows.appendChild(row);
  });
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
    renderDepartures(all);
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
// renderLeaveNowBanner) — regnet es gerade oder in der nächsten Stunde,
// bekommt die "Sollte ich jetzt los?"-Karte einen Schirm-Hinweis dazu.
let rainSoonForLeave = false;

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
  if (c.relative_humidity_2m != null) {
    chips.push({ iconKey: "humidity", value: Math.round(c.relative_humidity_2m) + "%", label: "Luftfeuchte" });
  }
  if (d.precipitation_probability_max && d.precipitation_probability_max[0] != null) {
    chips.push({ iconKey: "rain", value: Math.round(d.precipitation_probability_max[0]) + "%", label: "Regen" });
  }
  if (d.sunrise && d.sunrise[0]) {
    chips.push({
      iconKey: "sunrise",
      value: parseOpenMeteoLocal(d.sunrise[0]).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
      label: "Aufgang",
    });
  }
  if (d.sunset && d.sunset[0]) {
    chips.push({
      iconKey: "sunset",
      value: parseOpenMeteoLocal(d.sunset[0]).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
      label: "Untergang",
    });
  }

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
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + CONFIG.weatherLat +
    "&longitude=" + CONFIG.weatherLon +
    "&current=temperature_2m,weather_code,is_day,relative_humidity_2m,apparent_temperature,wind_speed_10m" +
    "&hourly=temperature_2m,weather_code" +
    "&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max" +
    "&timezone=Europe%2FBerlin" +
    "&_=" + Date.now();

  fetch(url, { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("Wetter-Abruf fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const temp = Math.round(data.current.temperature_2m);
    const code = data.current.weather_code;
    const isDay = data.current.is_day !== 0;
    const entry = WEATHER_CODES[code] || ["🌡️", ""];

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

    if (els.weatherBigMinMax && data.daily && data.daily.temperature_2m_max && data.daily.temperature_2m_min
      && data.daily.temperature_2m_max[0] != null && data.daily.temperature_2m_min[0] != null) {
      const hi = Math.round(data.daily.temperature_2m_max[0]);
      const lo = Math.round(data.daily.temperature_2m_min[0]);
      els.weatherBigMinMax.textContent = "H: " + hi + "°  T: " + lo + "°";
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
      for (let i = 0; i < CONFIG.weatherHourCount; i++) {
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

      // Für die "Sollte ich jetzt los?"-Karte im Abfahrten-Panel: reicht ein
      // einfaches Ja/Nein, ob es gerade oder in der nächsten Stunde regnet —
      // die ausführliche Formulierung übernimmt weiterhin buildWeatherTip()
      // fürs Wetter-Panel selbst, hier geht's nur um den Schirm-Hinweis.
      rainSoonForLeave = RAIN_CODES.indexOf(code) !== -1 ||
        RAIN_CODES.indexOf(data.hourly.weather_code[startIdx + 1]) !== -1;
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
    media.style.backgroundImage = 'url("' + imageUrl + '")';
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

  const bodyText = body || (item.firstSentence ? "<p>" + item.firstSentence + "</p>" : "");
  if (bodyText) {
    const bodyEl = document.createElement("div");
    bodyEl.className = "news-slide-body";
    bodyEl.innerHTML = bodyText;
    content.appendChild(bodyEl);
  }

  slide.appendChild(content);
  return slide;
}

function showNewsSlide(index) {
  const slides = els.newsList ? els.newsList.querySelectorAll(".news-slide") : [];
  for (let i = 0; i < slides.length; i++) {
    slides[i].className = slides[i].className.replace(" active", "");
    if (i === index) slides[i].className += " active";
  }

  // Fortschritts-Punkte — bisher war völlig unsichtbar, wie viele
  // Meldungen insgesamt kommen bzw. wie weit man schon durch ist.
  const dots = els.newsList ? els.newsList.querySelectorAll(".news-progress-dot") : [];
  for (let i = 0; i < dots.length; i++) {
    dots[i].className = "news-progress-dot" + (i === index ? " active" : "");
  }

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

  const regionalUrl = "https://www.tagesschau.de/api2u/news/?regions=" + CONFIG.newsRegion +
    "&pageSize=" + CONFIG.newsRegionCount;
  const generalUrl = "https://www.tagesschau.de/api2u/news/?pageSize=" + CONFIG.newsGeneralCount;
  const worldUrl = "https://www.tagesschau.de/api2u/news/?ressort=ausland" +
    "&pageSize=" + CONFIG.newsWorldCount;

  Promise.all([
    fetchNewsPool(regionalUrl, "Bremen", CONFIG.newsRegionCount),
    fetchNewsPool(generalUrl, null, CONFIG.newsGeneralCount),
    fetchNewsPool(worldUrl, "Welt", CONFIG.newsWorldCount),
  ]).then(function (pools) {
    let combined = pools[0].concat(pools[1], pools[2]);

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
      const wantsFullText = i < CONFIG.newsFullCount;
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
      els.newsList.appendChild(progress);
    }

    // Panel könnte gerade schon aktiv sein (z.B. nach einem manuellen
    // Reload mitten im News-Slide) — dann die Diashow direkt starten.
    const panelEl = document.getElementById("panel-news");
    const isActive = panelEl && panelEl.className.indexOf("active") !== -1;
    if (isActive) startNewsSlideshow();

    newsAvailable = true;
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

    function cleanup() {
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      cleanup();
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

function updateMusic() {
  if (!els.musicList) return;

  // ECHTER BUG, zweiter Anlauf: itunes.apple.com/.../topsongs (voriger
  // Fix) ist der iTunes-Store-KAUF-Chart, nicht die tatsächliche
  // Popularität — deshalb wirkten die Titel seltsam/unbekannt statt wie
  // echte aktuelle Hits. Deezers "Top Germany"-Redaktions-Playlist (von
  // Deezer selbst kuratiert, laufend aktualisiert) bildet echte
  // Popularität ab — hat aber KEIN Access-Control-Allow-Origin (per
  // echtem Browser-fetch()-Test verifiziert, nicht nur curl: "Failed to
  // fetch"). JSONP (siehe fetchJsonp oben) umgeht das vollständig.
  const url = "https://api.deezer.com/playlist/" + CONFIG.musicPlaylistId +
    "/tracks?limit=" + CONFIG.musicCount;

  fetchJsonp(url).then(function (data) {
    if (data && data.error) throw new Error("Deezer-Fehler: " + (data.error.message || data.error.type));
    const entries = (data && Array.isArray(data.data)) ? data.data : [];
    // Deezer-Feld-Namen auf dieselbe {name, artistName, artworkUrl100}-Form
    // bringen wie zuvor — der Rest der Rendering-Logik unten bleibt dadurch
    // unverändert.
    const results = entries.map(function (t) {
      const album = t.album || {};
      return {
        name: t.title,
        artistName: t.artist && t.artist.name,
        artworkUrl100: album.cover_medium || album.cover_big || album.cover,
      };
    });
    if (!results.length) throw new Error("Keine Musikdaten erhalten");

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
      tag.textContent = "👑 Nr. 1 in Deutschland";
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

    musicAvailable = true;
  }).catch(function (err) {
    console.error(err);
    musicAvailable = false;
  });
}

// ---------- Veranstaltungen-Panel (Bremen) ----------
// InfraNode (infranode.dev), kostenlos, kein Key, offener CORS — Daten
// stammen von open.destination.one (siehe Kommentar bei CONFIG.eventsCount
// für die Recherche dahinter). Liste statt Diashow (wie Musik-Charts),
// weil man bei Terminen mehrere auf einen Blick vergleichen will.
const EVENT_MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function updateEvents() {
  if (!els.eventsList) return;

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
  }).catch(function (err) {
    console.error(err);
    eventsAvailable = false;
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
function appendPanelWatermark(container) {
  const mark = document.createElement("div");
  mark.className = "panel-watermark";
  mark.textContent = "„";
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
  text.className = "quote-text";

  const typed = document.createElement("span");
  typed.id = "quoteTypedText";
  text.appendChild(typed);

  const cursor = document.createElement("span");
  cursor.id = "quoteCursor";
  cursor.className = "typewriter-cursor";
  text.appendChild(cursor);

  els.quoteBlock.appendChild(text);
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

function updateQuote() {
  if (!els.quoteBlock) return;

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
// Wikipedia-REST-API (de.wikipedia.org/api/rest_v1/...), kostenlos, kein
// Key, CORS-freundlich. Liefert historische Ereignisse zum heutigen
// Kalendertag; die Tafel wählt eins zufällig aus und tippt es als Frage
// ein (gleicher Schreibmaschinen-Mechanismus wie beim Spruch des Tages,
// startQuoteTypewriter oben). Auflösung als echtes Multiple-Choice
// (drei Jahreszahlen, eine davon richtig) statt einer nackten Zahl —
// die Tafel hat kein Touch, also wird nach einer Denkpause automatisch
// aufgelöst statt auf einen Tipp zu warten.
const TRIVIA_MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

let triviaFullText = null;
let triviaYear = null;
let triviaTypeTimer = null;
let triviaRevealTimer = null;

// Zwei plausible, aber garantiert falsche Jahreszahlen um das richtige
// Jahr herum bauen (nie in der Zukunft, nie vor 1) und zusammen mit der
// echten Antwort mischen.
function buildTriviaChoices(correctYear) {
  const thisYear = new Date().getFullYear();
  const offsets = [];
  while (offsets.length < 2) {
    const sign = Math.random() < 0.5 ? -1 : 1;
    const delta = sign * (10 + Math.floor(Math.random() * 70));
    const candidate = correctYear + delta;
    if (candidate === correctYear || candidate < 1 || candidate > thisYear) continue;
    if (offsets.indexOf(candidate) !== -1) continue;
    offsets.push(candidate);
  }
  const all = [correctYear, offsets[0], offsets[1]];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = all[i]; all[i] = all[j]; all[j] = tmp;
  }
  return all;
}

function renderTriviaShell() {
  if (!els.triviaBlock) return;
  els.triviaBlock.innerHTML = "";
  appendPanelWatermark(els.triviaBlock);
  appendKnowledgeScoreBadge(els.triviaBlock);

  const now = new Date();
  const dateLabel = document.createElement("div");
  dateLabel.className = "trivia-date";
  dateLabel.textContent = "Historisches Ereignis vom " + now.getDate() + ". " + TRIVIA_MONTHS[now.getMonth()];
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
      triviaRevealTimer = setTimeout(function () {
        choicesEl.classList.add("is-revealed");
      }, 3000);
    }
  }, 35);
}

function updateTrivia() {
  if (!els.triviaBlock) return;

  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  // Cache-Buster wie bei allen anderen Feeds hier (siehe Kommentar bei
  // updateQuote) — sonst liefert ein zwischengeschalteter Cache stur
  // dieselbe Tagesauswahl über Stunden hinweg aus.
  fetch("https://de.wikipedia.org/api/rest_v1/feed/onthisday/events/" + mm + "/" + dd + "?_=" + Date.now(), { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("Trivia-Abruf fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const events = (data && data.events) || [];
    const usable = events.filter(function (e) { return e && e.text && e.year; });
    if (!usable.length) throw new Error("Keine Trivia-Ereignisse erhalten");

    const pick = usable[Math.floor(Math.random() * usable.length)];
    triviaFullText = pick.text;
    triviaYear = pick.year;
    renderTriviaShell();

    const panelEl = document.getElementById("panel-trivia");
    const isActive = panelEl && panelEl.className.indexOf("active") !== -1;
    if (isActive) startTriviaReveal();

    triviaAvailable = true;
  }).catch(function (err) {
    console.error(err);
    triviaAvailable = false;
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
  appendPanelWatermark(els.quizBlock);
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

function startQuizReveal() {
  if (!quizQuestion || !quizChoices) return;
  const typedEl = document.getElementById("quizTypedText");
  const cursorEl = document.getElementById("quizCursor");
  const choicesEl = document.getElementById("quizChoices");
  const categoryEl = document.getElementById("quizCategory");
  if (!typedEl || !choicesEl) return;

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
      quizRevealTimer = setTimeout(function () {
        choicesEl.classList.add("is-revealed");
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

function updateQuiz(retryCount) {
  if (!els.quizBlock) return;
  retryCount = retryCount || 0;
  if (quizRetryTimer) { clearTimeout(quizRetryTimer); quizRetryTimer = null; }

  // Cache-Buster wie bei allen anderen Feeds hier — sonst liefert ein
  // zwischengeschalteter Cache stur dieselbe Frage über Stunden hinweg.
  fetch("https://opentdb.com/api.php?amount=1&type=multiple&_=" + Date.now(), { cache: "no-store" }).then(function (res) {
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
// feste lokale Sammlung, deterministisch nach Tag-des-Jahres ausgewählt,
// damit an einem Tag immer dasselbe Rätsel gezeigt wird. Gleiche Tipp-
// und-Warten-Dramaturgie wie Quiz/Trivia, nur ohne Multiple-Choice: die
// Lösung wird als Text erst zur Hälfte der Panel-Anzeigezeit eingeblendet.
let riddleQuestion = null;
let riddleAnswerText = null;
let riddleTypeTimer = null;
let riddleRevealTimer = null;
let riddleAvailable = false;

function pickRiddleForToday() {
  const riddles = CONFIG.riddles || [];
  if (!riddles.length) return null;
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - startOfYear) / 86400000);
  return riddles[dayOfYear % riddles.length];
}

function renderRiddleShell() {
  if (!els.riddleBlock) return;
  els.riddleBlock.innerHTML = "";
  appendPanelWatermark(els.riddleBlock);

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
      riddleRevealTimer = setTimeout(function () {
        answerEl.classList.add("is-shown");
      }, revealDelay);
    }
  }, 35);
}

function updateRiddle() {
  if (!els.riddleBlock) return;
  const pick = pickRiddleForToday();
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

function fetchTransitItinerary(from, to) {
  const url = API_BASE + "/v6/plan?fromPlace=" + from.lat + "," + from.lon +
    "&toPlace=" + to.lat + "," + to.lon +
    "&directModes=&transitModes=TRANSIT";

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
    (departDate ? "&departAt=" + encodeURIComponent(departDate.toISOString()) : "") +
    "&_=" + Date.now();

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
function fetchCarItinerary(from, to, distanceMeters, departDate) {
  function viaMotis() {
    return fetchDirectItinerary(from, to, "CAR")
      .then(function (it) {
        const check = plausibleMinutesOrFallback(
          itineraryDurationMin(it), estimateCarMinutes(distanceMeters), "Auto"
        );
        return {
          itinerary: it, minutes: check.minutes, estimated: check.estimated,
          delayMin: null, source: check.estimated ? "fallback" : "motis",
        };
      })
      .catch(function (err) {
        console.error(err);
        return {
          itinerary: null, minutes: estimateCarMinutes(distanceMeters), estimated: true,
          delayMin: null, source: "fallback",
        };
      });
  }

  if (!CONFIG.tomtomApiKey) return viaMotis();

  return fetchTomTomRoute(from, to, "car", departDate)
    .then(function (r) {
      return {
        itinerary: null, minutes: r.minutes, estimated: false, delayMin: r.delayMin,
        source: "tomtom", points: r.points,
      };
    })
    .catch(function (err) {
      console.error("TomTom-Route (Auto) nicht verfügbar, nutze Ersatzroute:", err);
      return viaMotis();
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
  COMMUTE_MODES.forEach(function (m) {
    const res = results[m.key];
    if (!res || res.minutes == null) return;
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

  const big = document.createElement("span");
  big.className = "commute-hero-big";
  big.textContent = winner.minutes + " Min";
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
    live.textContent = "Live-Verkehr";
    big.appendChild(live);
  }
  textWrap.appendChild(big);

  const label = document.createElement("span");
  label.className = "commute-hero-label";
  label.textContent = "mit " + winner.label + " zu Max Müller GmbH";
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

    const timeLabel = document.createElement("span");
    timeLabel.className = "commute-race-time";
    timeLabel.textContent = available ? (res.minutes + " min") : "nicht verfügbar";
    track.appendChild(timeLabel);

    row.appendChild(track);

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
        extra.className = "commute-race-extra";
        extra.textContent = extraText;
        row.appendChild(extra);
      }
    } else if (m.key === "car" && res && res.source === "tomtom") {
      // Live-Verkehr über TomTom war erfolgreich — zeigen, ob und wie viel
      // Stau eingerechnet ist, statt nur eine nackte Minutenzahl.
      const extra = document.createElement("div");
      extra.className = "commute-race-extra";
      extra.textContent = res.delayMin > 0
        ? ("inkl. " + res.delayMin + " Min. Stau · Live-Verkehr")
        : "keine Verzögerung · Live-Verkehr";
      row.appendChild(extra);
    } else if (res && res.estimated) {
      const extra = document.createElement("div");
      extra.className = "commute-race-extra";
      extra.textContent = "geschätzt, keine Live-Route verfügbar";
      row.appendChild(extra);
    }

    els.commuteRace.appendChild(row);
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
    if (els.commuteMapWrap) els.commuteMapWrap.style.display = "none";
    if (els.commuteRace) els.commuteRace.style.display = "";
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

  const W = 900;
  const H = 460;
  const color = (CONFIG.commuteModeColors && CONFIG.commuteModeColors[winner.key]) || "#5b6b78";

  // center+zoom statt bbox — siehe Kommentar bei zoomForBounds() weiter
  // oben für den Grund (bbox+width/height gibt bei TomTom immer HTTP 400).
  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const zoom = zoomForBounds(minLon, minLat, maxLon, maxLat, W, H);

  const imgUrl = "https://api.tomtom.com/map/1/staticimage" +
    "?key=" + encodeURIComponent(CONFIG.tomtomApiKey) +
    "&center=" + centerLon.toFixed(5) + "," + centerLat.toFixed(5) + "&zoom=" + zoom +
    "&format=jpg&layer=basic&style=main&width=" + W + "&height=" + H +
    "&view=Unified&language=de-DE&_=" + Date.now();

  els.commuteMapImg.onload = function () {
    if (els.commuteMapWrap) els.commuteMapWrap.classList.remove("is-empty");
    // Falls ein vorheriger Versuch auf die Balken zurückgefallen war (siehe
    // onerror unten), bei Erfolg wieder auf die Kartenansicht umschalten.
    if (els.commuteMapWrap) els.commuteMapWrap.style.display = "";
    if (els.commuteRace) els.commuteRace.style.display = "none";
  };
  els.commuteMapImg.onerror = function () {
    // Kartenbild nicht verfügbar (Netzwerk, Kontingent, ungültiger Key) —
    // Route weglassen statt ein kaputtes Bild + falsch platzierte Linie
    // stehen zu lassen. Die Balken-Ansicht wurde in updateCommute() schon
    // im Hintergrund mitgebaut (nur versteckt) — jetzt draufschalten statt
    // das Panel auf einen bloßen Text-Hinweis zu reduzieren.
    els.commuteMapRoute.innerHTML = "";
    if (els.commuteMapWrap) els.commuteMapWrap.classList.add("is-empty");
    if (els.commuteMapWrap) els.commuteMapWrap.style.display = "none";
    if (els.commuteRace) els.commuteRace.style.display = "";
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
    '<path d="' + pathD + '" fill="none" stroke="' + color + '" stroke-width="6" ' +
    'stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.92"></path>' +
    '<circle cx="' + homeXY[0].toFixed(1) + '" cy="' + homeXY[1].toFixed(1) + '" r="8" fill="#fff" stroke="' + color + '" stroke-width="4"></circle>' +
    '<circle cx="' + workXY[0].toFixed(1) + '" cy="' + workXY[1].toFixed(1) + '" r="8" fill="' + color + '" stroke="#fff" stroke-width="3"></circle>';
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
      fetchTransitItinerary(coords.home, coords.work)
        .then(function (it) {
          return {
            itinerary: it,
            minutes: itineraryDurationMin(it),
            note: itineraryRealtimeNote(it),
            lines: itineraryLineNames(it),
            departure: itineraryFirstDeparture(it),
          };
        })
        .catch(function (err) { console.error(err); return null; }),
      fetchCarItinerary(coords.home, coords.work, distanceMeters, departDate),
    ]).then(function (all) {
      const results = { bike: all[0], bus: all[1], car: all[2], forecastDate: departDate };
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
        if (els.commuteRace) els.commuteRace.style.display = "none";
        if (els.commuteMapWrap) els.commuteMapWrap.style.display = "";
        renderCommuteMap(coords, results);
      } else {
        if (els.commuteMapWrap) els.commuteMapWrap.style.display = "none";
        if (els.commuteRace) els.commuteRace.style.display = "";
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
    items.push({ date: new Date(d.getTime()), type: type });
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

function updateWasteLine() {
  if (!els.wasteLine || !CONFIG.wasteCollection) return;

  const upcoming = nextWasteCollections(1);
  if (!upcoming.length) {
    els.wasteLine.textContent = "";
    return;
  }

  els.wasteLine.textContent = formatWasteEntry(upcoming[0]) || "";
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

function formatMatchDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }) +
    ", " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
}

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
      return new Date(a.matchDateTime).getTime() - new Date(b.matchDateTime).getTime();
    });

    let next = null;
    for (let i = 0; i < matches.length; i++) {
      if (!matches[i].matchIsFinished) { next = matches[i]; break; }
    }

    let last = null;
    for (let i = matches.length - 1; i >= 0; i--) {
      if (matches[i].matchIsFinished) { last = matches[i]; break; }
    }

    if (!next && !last) return null;

    // Nicht jedes noch Wochen entfernte "nächste Spiel" verdient eine
    // eigene Karte in der Diashow — erst zeigen, wenn es wirklich bald
    // ansteht (oder gerade eben vorbei ist), sonst lieber der Fußball-News
    // mehr Platz lassen (siehe CONFIG.sportRelevanceDays).
    const windowMs = (CONFIG.sportRelevanceDays || 5) * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const nextSoon = next && (new Date(next.matchDateTime).getTime() - now) <= windowMs;
    const lastRecent = last && (now - new Date(last.matchDateTime).getTime()) <= windowMs;

    if (!nextSoon && !lastRecent) return null;

    return {
      teamName: teamName,
      next: nextSoon ? next : null,
      last: (!nextSoon && lastRecent) ? last : null,
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

  const meta = document.createElement("div");
  meta.className = "sport-slide-meta";
  meta.textContent = formatMatchDate(match.matchDateTime);
  content.appendChild(meta);

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
  slide.className = "sport-slide sport-slide-news" + (index === 0 ? " active" : "");

  if (imageUrl) {
    const media = document.createElement("div");
    media.className = "news-slide-media";
    media.style.backgroundImage = 'url("' + imageUrl + '")';
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
// auffindbar bzw. CORS-freundlich nutzbar. Tagesschau bietet aber denselben
// ressort-Filter-Mechanismus, den diese Tafel schon für die Welt-News
// (ressort=ausland) nutzt — mit ressort=sport kommen allgemeine Sport-
// meldungen (Fußball ist da redaktionell klar dominant, aber nicht
// exklusiv). Bewährte, garantiert erreichbare Quelle statt eines
// ungetesteten Fremd-Feeds, der am CORS-Header scheitern könnte.
function fetchFootballNews() {
  const count = CONFIG.sportNewsCount || 4;
  const url = "https://www.tagesschau.de/api2u/news/?ressort=sport&pageSize=" + count;
  return fetchNewsPool(url, "Sport", count);
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
let panelIndex = 0;

const PANEL_AVAILABILITY = {
  departures: function () { return true; },
  commute: function () { return commuteAvailable; },
  weather: function () { return true; },
  news: function () { return newsAvailable; },
  music: function () { return musicAvailable; },
  sport: function () { return sportAvailable; },
  quote: function () { return quoteAvailable; },
  trivia: function () { return triviaAvailable; },
  quiz: function () { return quizAvailable; },
  riddle: function () { return riddleAvailable; },
  events: function () { return eventsAvailable; },
};

function showPanel(name) {
  const ids = ["departures", "commute", "weather", "news", "music", "sport", "quote", "trivia", "quiz", "riddle", "events"];
  for (let i = 0; i < ids.length; i++) {
    const el = document.getElementById("panel-" + ids[i]);
    if (!el) continue;
    // classList.toggle statt className-Zuweisung — #panel-weather trägt
    // inzwischen eigene Zustandsklassen (weather-scene, fx-*, has-photo,
    // has-video), die hier sonst bei JEDEM Karussell-Wechsel überschrieben
    // würden (className = "..." ersetzt IMMER alles).
    el.classList.toggle("active", ids[i] === name);
  }

  if (name === "quote") {
    startQuoteTypewriter();
  }

  if (name === "trivia") {
    startTriviaReveal();
  }

  if (name === "quiz") {
    startQuizReveal();
  }

  if (name === "riddle") {
    startRiddleReveal();
  }

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
}

function pickNextAvailablePanel() {
  let tries = 0;
  while (tries < activeSequence.length) {
    panelIndex = (panelIndex + 1) % activeSequence.length;
    if (panelIndex === 0) shuffleSequence();
    const name = activeSequence[panelIndex];
    const check = PANEL_AVAILABILITY[name];
    if (!check || check()) return name;
    tries++;
  }
  return activeSequence[panelIndex];
}

function scheduleCarousel() {
  const seq = activeSequence;
  if (!seq || seq.length < 2) return;

  const currentName = seq[panelIndex];
  const duration = durationForPanel(currentName);
  resetProgressBar(duration);

  if (carouselTimer) clearTimeout(carouselTimer);
  carouselTimer = setTimeout(function () {
    const nextName = pickNextAvailablePanel();
    showPanel(nextName);
    scheduleCarousel();
  }, duration);
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

  if (carouselTimer) clearTimeout(carouselTimer);
  carouselTimer = setTimeout(function () {
    const nextName = pickNextAvailablePanel();
    showPanel(nextName);
    scheduleCarousel();
  }, remaining);
}

function deferCarouselAdvance() {
  if (panelNavOpen) return; // Übersicht offen: pauseCarouselIndefinitely() übernimmt das
  if (!activeSequence || activeSequence.length < 2) return;

  if (carouselTimer) {
    clearTimeout(carouselTimer);
    carouselTimer = null;
    freezeProgressBar();
    pauseSlideshowTimers();
  }

  if (carouselIdleTimer) clearTimeout(carouselIdleTimer);
  carouselIdleTimer = setTimeout(function () {
    carouselIdleTimer = null;
    resumeCarouselFromFraction();
  }, CAROUSEL_IDLE_RESUME_MS);
}

function buildPanelNavGrid() {
  if (!els.panelNavGrid) return;
  els.panelNavGrid.innerHTML = "";
  const seq = CONFIG.panelSequence || [];
  const currentName = activeSequence[panelIndex];

  seq.forEach(function (name) {
    const check = PANEL_AVAILABILITY[name];
    if (check && !check()) return;
    const meta = PANEL_NAV_META[name];
    if (!meta) return;

    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "panel-nav-tile" + (name === currentName ? " is-current" : "");

    const icon = document.createElement("span");
    icon.className = "panel-nav-tile-icon";
    icon.textContent = meta.icon;
    tile.appendChild(icon);

    const label = document.createElement("span");
    label.className = "panel-nav-tile-label";
    label.textContent = meta.label;
    tile.appendChild(label);

    tile.addEventListener("click", function (ev) {
      ev.stopPropagation();
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
      if (ev.target === els.panelNavOverlay) setPanelNavOpen(false);
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
  initRadioBar();
  initPanelNav();
  initStageSwipe();

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
  setInterval(updateEvents, CONFIG.refreshEventsMs);

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
