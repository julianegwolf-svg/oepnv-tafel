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
  status: document.getElementById("statusText"),
  lastUpdate: document.getElementById("lastUpdate"),
  clockTime: document.getElementById("clockTime"),
  clockDate: document.getElementById("clockDate"),
  nightOverlay: document.getElementById("nightOverlay"),
  greetingText: document.getElementById("greetingText"),
  weatherPanel: document.getElementById("panel-weather"),
  weatherSky: document.getElementById("weatherSky"),
  weatherBig: document.getElementById("weatherBig"),
  weatherBigIcon: document.getElementById("weatherBigIcon"),
  weatherBigTemp: document.getElementById("weatherBigTemp"),
  weatherBigDesc: document.getElementById("weatherBigDesc"),
  weatherHours: document.getElementById("weatherHours"),
  weatherDetails: document.getElementById("weatherDetails"),
  newsList: document.getElementById("newsList"),
  musicList: document.getElementById("musicList"),
  quoteBlock: document.getElementById("quoteBlock"),
  commuteHero: document.getElementById("commuteHero"),
  commuteRace: document.getElementById("commuteRace"),
  commuteMapWrap: document.getElementById("commuteMapWrap"),
  commuteMapImg: document.getElementById("commuteMapImg"),
  commuteMapRoute: document.getElementById("commuteMapRoute"),
  wasteLine: document.getElementById("wasteLine"),
  sportBlock: document.getElementById("sportBlock"),
};

let resolvedStopIds = (CONFIG.stopIds && CONFIG.stopIds.length)
  ? CONFIG.stopIds.slice()
  : null;
let resolvedStopCoord = null;

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

// ---------- Begrüßung (ersetzt das Mini-Wetter im Header) ----------
// Statt Icon+Temperatur oben (steht eh groß im Wetter-Panel) läuft hier
// ein witziger, zur Tageszeit passender Spruch. Wechselt alle paar
// Minuten und beim Wechsel der Tageszeit-Phase, mit sanftem Crossfade.
const GREETINGS = {
  night: [
    "Immer noch wach? Respekt.",
    "Schlaf ist auch nur eine Empfehlung.",
    "Moin schon mal auf Vorrat.",
    "Netflix hat wieder gewonnen, oder?",
    "Die Nacht ist jung, du auch (hoffentlich).",
    "Gute Nacht — falls du doch noch schlafen gehst.",
    "Nachteule meldet sich zurück.",
    "Wer schläft, verpasst die besten Memes.",
    "Kein Ende in Sicht, was?",
    "Psst, alle schlafen. Fast alle.",
    "Mitternachtssnack-Alarm.",
    "Träum was Schönes, wenn's soweit ist.",
  ],
  earlyMorning: [
    "GuMo!",
    "Guten Morgen, du Frühaufsteher-Legende.",
    "Kaffee wartet auf dich. Beeil dich.",
    "Der frühe Vogel nervt trotzdem.",
    "Moin! Noch vor dem Wecker wach?",
    "5-Uhr-Club, Respekt.",
    "GuMo mit Ei.",
    "Aufstehen, die Bahn wartet nicht.",
    "Frühschicht-Energie, spürst du sie?",
    "Moin Moin, Bremen ruft.",
    "Sonne noch nicht wach, du schon.",
  ],
  morning: [
    "Guten Morgen!",
    "Moin, wie war die Nacht?",
    "Kaffee Nummer zwei, oder?",
    "Der Tag hat gerade erst angefangen, entspann dich.",
    "Frühstück nicht vergessen!",
    "Moin! Alter Postweg meldet sich.",
    "Guten Morgen, Champion.",
    "Zeit für den ersten Blick auf die Abfahrten.",
    "Der Tag kann kommen.",
    "Moin, lauf los oder chill weiter — du hast noch Zeit.",
  ],
  midday: [
    "Mahlzeit!",
    "Schon Hunger? Ist ok.",
    "Halbzeit des Tages.",
    "Mittagspause verdient, oder?",
    "Moin, äh Mahlzeit.",
    "Der Vormittag ist geschafft, stolz auf dich.",
    "Zeit für was Warmes zu essen.",
    "Mittagstief incoming, halt durch.",
    "Guten Appetit, falls zutreffend.",
    "Die Sonne steht hoch, du hoffentlich auch.",
  ],
  afternoon: [
    "Guten Nachmittag!",
    "Kaffee Nummer drei ist erlaubt.",
    "Nachmittagstief? Kenn ich.",
    "Feierabend rückt näher, halt durch.",
    "Der Nachmittag zieht sich, was?",
    "Noch ein paar Stunden, dann ist Ruhe.",
    "Zeit für einen kurzen Motivationsschub.",
    "Schon ans Wochenende gedacht?",
    "Der Tag läuft, du auch (hoffentlich).",
    "Kleine Pause gefällig?",
  ],
  evening: [
    "Guten Abend!",
    "Feierabend, na endlich.",
    "Zeit zum Entspannen, verdient.",
    "Der Tag ist geschafft, gut gemacht.",
    "Abendrunde: Sofa oder noch was vor?",
    "Moin — äh, Abend natürlich.",
    "Zeit für was Gutes zum Essen.",
    "Der Abend gehört dir.",
    "Bildschirmzeit oder frische Luft? Deine Wahl.",
    "Gemütlicher Abend gewünscht.",
  ],
};

let lastGreetingBucket = null;
let lastGreetingText = null;
let lastGreetingSwapAt = 0;
const GREETING_ROTATE_MS = 3 * 60 * 1000;

function greetingBucket(hour) {
  if (hour >= 22 || hour < 5) return "night";
  if (hour < 8) return "earlyMorning";
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (hour < 18) return "afternoon";
  return "evening";
}

function pickGreeting(bucket) {
  const list = GREETINGS[bucket] || GREETINGS.morning;
  if (list.length === 1) return list[0];
  let pick = list[Math.floor(Math.random() * list.length)];
  let tries = 0;
  while (pick === lastGreetingText && tries < 5) {
    pick = list[Math.floor(Math.random() * list.length)];
    tries++;
  }
  return pick;
}

function updateGreeting() {
  if (!els.greetingText) return;
  const now = Date.now();
  const bucket = greetingBucket(new Date().getHours());
  const bucketChanged = bucket !== lastGreetingBucket;
  const dueForRotation = (now - lastGreetingSwapAt) > GREETING_ROTATE_MS;
  if (!bucketChanged && !dueForRotation && lastGreetingText) return;

  const text = pickGreeting(bucket);
  lastGreetingBucket = bucket;
  lastGreetingText = text;
  lastGreetingSwapAt = now;

  const el = els.greetingText;
  el.classList.add("swap-out");
  setTimeout(function () {
    el.textContent = text;
    el.classList.remove("swap-out");
  }, 350);
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

function renderDepartures(departures) {
  els.rows.innerHTML = "";

  if (!departures.length) {
    const div = document.createElement("div");
    div.className = "row placeholder";
    div.textContent = "Keine Abfahrten in den nächsten 60 Minuten";
    els.rows.appendChild(div);
    return;
  }

  const now = Date.now();

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
    return;
  }

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
  "sun": "radial-gradient(130% 70% at 75% -10%, rgba(255,214,140,0.35), transparent 55%), linear-gradient(165deg, #123f68 0%, #2f7cc4 35%, #57a4dd 65%, #ffcf87 100%)",
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
  sun: "rgba(255, 200, 120, 0.4)",
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
  for (let i = 0; i < 10; i++) {
    const star = document.createElement("span");
    star.className = "fx-star";
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
    chips.push({ icon: "🌡️", value: Math.round(c.apparent_temperature) + "°", label: "Gefühlt" });
  }
  if (c.wind_speed_10m != null) {
    chips.push({ icon: "💨", value: Math.round(c.wind_speed_10m) + " km/h", label: "Wind" });
  }
  if (c.relative_humidity_2m != null) {
    chips.push({ icon: "💦", value: Math.round(c.relative_humidity_2m) + "%", label: "Luftfeuchte" });
  }
  if (d.precipitation_probability_max && d.precipitation_probability_max[0] != null) {
    chips.push({ icon: "☔", value: Math.round(d.precipitation_probability_max[0]) + "%", label: "Regen" });
  }
  if (d.sunrise && d.sunrise[0]) {
    chips.push({
      icon: "🌅",
      value: parseOpenMeteoLocal(d.sunrise[0]).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
      label: "Aufgang",
    });
  }
  if (d.sunset && d.sunset[0]) {
    chips.push({
      icon: "🌇",
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
    iconEl.textContent = c2.icon;
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
      els.weatherBigIcon.textContent = entry[0];
      els.weatherBigTemp.textContent = temp + "°";
      els.weatherBigDesc.textContent = entry[1] || "";
    }

    if (els.weatherPanel) {
      ensureWeatherFxLayers();
      const fxCategory = weatherFxCategory(code, isDay);
      setWeatherScene(fxCategory, isDay);
    }

    renderWeatherDetails(data);

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

      els.weatherHours.innerHTML = "";
      for (let i = 0; i < CONFIG.weatherHourCount; i++) {
        const idx = startIdx + i;
        if (idx >= data.hourly.time.length) break;

        const hTime = parseOpenMeteoLocal(data.hourly.time[idx]);
        const hTemp = Math.round(data.hourly.temperature_2m[idx]);
        const hCode = data.hourly.weather_code[idx];
        const hEntry = WEATHER_CODES[hCode] || ["🌡️"];

        const cell = document.createElement("div");
        cell.className = "weather-hour";

        const timeEl = document.createElement("span");
        timeEl.className = "weather-hour-time";
        timeEl.textContent = hTime.toLocaleTimeString("de-DE", { hour: "2-digit" });

        const iconEl = document.createElement("span");
        iconEl.className = "weather-hour-icon";
        iconEl.textContent = hEntry[0];

        const tempEl = document.createElement("span");
        tempEl.className = "weather-hour-temp";
        tempEl.textContent = hTemp + "°";

        cell.appendChild(timeEl);
        cell.appendChild(iconEl);
        cell.appendChild(tempEl);
        els.weatherHours.appendChild(cell);
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
  newsSlideIndex = index;
}

function startNewsSlideshow() {
  stopNewsSlideshow();
  if (!newsItems.length) return;

  showNewsSlide(0);
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
function updateMusic() {
  if (!els.musicList) return;

  const url = "https://rss.marketingtools.apple.com/api/v2/de/music/most-played/" +
    CONFIG.musicCount + "/songs.json?_=" + Date.now();

  fetch(url, { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("Musik-Abruf fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const results = (data && data.feed && Array.isArray(data.feed.results)) ? data.feed.results : [];
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

// ---------- Spruch des Tages (Advice Slip — bestätigt CORS-freundlich) ----------
// Wird zeichenweise "eingetippt", sobald das Panel sichtbar wird (siehe
// startQuoteTypewriter() und der Hook in showPanel()). Lädt die Daten
// schon vorher neu, tippt aber erst los, wenn der Text auch zu sehen ist.
let quoteFullText = null;
let quoteTypeTimer = null;

function renderQuoteShell() {
  if (!els.quoteBlock) return;
  els.quoteBlock.innerHTML = "";

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
      best = { key: m.key, icon: m.icon, label: m.label, minutes: res.minutes, estimated: res.estimated };
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
  if (winner.estimated) {
    const est = document.createElement("span");
    est.className = "commute-hero-estimated";
    est.textContent = "geschätzt";
    big.appendChild(est);
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
  setTimeout(function () {
    fillTargets.forEach(function (entry) {
      entry.el.style.width = entry.pct + "%";
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

// Kartenansicht mit eingezeichneter Route für den schnellsten Verkehrsmittel
// (Ersatz für die interaktive TomTom-Karte, die an fehlendem WebGL2 auf
// Safari 12 scheitert — siehe Kommentar bei .commute-map-wrap in style.css).
// Statisches Kartenbild von TomToms Static-Image-API + eine SVG-Linie
// darüber, deren Koordinaten aus den echten Routen-Punkten (falls
// vorhanden) oder sonst einer geraden Start→Ziel-Linie berechnet werden.
function renderCommuteMap(coords, results) {
  if (!els.commuteMapImg || !els.commuteMapRoute) return;

  const winner = fastestCommuteMode(results);
  if (!winner || !coords) {
    els.commuteMapImg.removeAttribute("src");
    els.commuteMapRoute.innerHTML = "";
    return;
  }

  const winnerRes = results[winner.key];
  const points = (winnerRes && Array.isArray(winnerRes.points) && winnerRes.points.length >= 2)
    ? winnerRes.points
    : [[coords.home.lon, coords.home.lat], [coords.work.lon, coords.work.lat]];

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

  const imgUrl = "https://api.tomtom.com/map/1/staticimage" +
    "?key=" + encodeURIComponent(CONFIG.tomtomApiKey) +
    "&bbox=" + minLon.toFixed(5) + "," + minLat.toFixed(5) + "," + maxLon.toFixed(5) + "," + maxLat.toFixed(5) +
    "&format=jpg&layer=basic&style=main&width=" + W + "&height=" + H +
    "&view=Unified&language=de-DE&_=" + Date.now();

  els.commuteMapImg.onload = function () {
    if (els.commuteMapWrap) els.commuteMapWrap.classList.remove("is-empty");
  };
  els.commuteMapImg.onerror = function () {
    // Kartenbild nicht verfügbar (Netzwerk, Kontingent, ungültiger Key) —
    // Route weglassen statt ein kaputtes Bild + falsch platzierte Linie
    // stehen zu lassen.
    els.commuteMapRoute.innerHTML = "";
    if (els.commuteMapWrap) els.commuteMapWrap.classList.add("is-empty");
  };
  els.commuteMapImg.src = imgUrl;

  const mercMinY = mercatorY(minLat);
  const mercMaxY = mercatorY(maxLat);

  function project(lon, lat) {
    const x = ((lon - minLon) / (maxLon - minLon)) * W;
    const y = ((mercMaxY - mercatorY(lat)) / (mercMaxY - mercMinY)) * H;
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
      if (CONFIG.tomtomApiKey) {
        if (els.commuteRace) els.commuteRace.style.display = "none";
        if (els.commuteMapWrap) els.commuteMapWrap.style.display = "";
        renderCommuteMap(coords, results);
      } else {
        if (els.commuteMapWrap) els.commuteMapWrap.style.display = "none";
        if (els.commuteRace) els.commuteRace.style.display = "";
        renderCommuteRace(results);
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
  sportSlideIndex = index;
}

function startSportSlideshow() {
  stopSportSlideshow();
  if (!sportItems.length) return;

  showSportSlide(0);
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
let panelIndex = 0;

const PANEL_AVAILABILITY = {
  departures: function () { return true; },
  commute: function () { return commuteAvailable; },
  weather: function () { return true; },
  news: function () { return newsAvailable; },
  music: function () { return musicAvailable; },
  sport: function () { return sportAvailable; },
  quote: function () { return quoteAvailable; },
};

function showPanel(name) {
  const ids = ["departures", "commute", "weather", "news", "music", "sport", "quote"];
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

function durationForPanel(name) {
  if (CONFIG.panelDurations && CONFIG.panelDurations[name]) {
    return CONFIG.panelDurations[name];
  }
  return CONFIG.panelDurationMs;
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

function pickNextAvailablePanel() {
  const seq = CONFIG.panelSequence;
  let tries = 0;
  while (tries < seq.length) {
    panelIndex = (panelIndex + 1) % seq.length;
    const name = seq[panelIndex];
    const check = PANEL_AVAILABILITY[name];
    if (!check || check()) return name;
    tries++;
  }
  return seq[panelIndex];
}

function scheduleCarousel() {
  const seq = CONFIG.panelSequence;
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

// ---------- Start ----------
function init() {
  tickClock();
  setInterval(tickClock, CONFIG.refreshClockMs);

  updateGreeting();
  setInterval(updateGreeting, 60 * 1000);

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

  updateWasteLine();
  if (CONFIG.wasteCollection && CONFIG.wasteCollection.refreshMs) {
    setInterval(updateWasteLine, CONFIG.wasteCollection.refreshMs);
  }

  updateSport();
  setInterval(updateSport, CONFIG.refreshSportMs);

  scheduleCarousel();

  if (CONFIG.fullReloadMs) {
    setTimeout(function () {
      window.location.reload();
    }, CONFIG.fullReloadMs);
  }
}

init();
