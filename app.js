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
  greetingText: document.getElementById("greetingText"),
  weatherBig: document.getElementById("weatherBig"),
  weatherBigIcon: document.getElementById("weatherBigIcon"),
  weatherBigTemp: document.getElementById("weatherBigTemp"),
  weatherBigDesc: document.getElementById("weatherBigDesc"),
  weatherHours: document.getElementById("weatherHours"),
  weatherDetails: document.getElementById("weatherDetails"),
  newsList: document.getElementById("newsList"),
  musicList: document.getElementById("musicList"),
  quoteBlock: document.getElementById("quoteBlock"),
  commuteChips: document.getElementById("commuteChips"),
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
function resolveStopIds() {
  if (resolvedStopIds) return Promise.resolve(resolvedStopIds);

  const url = API_BASE + "/v1/geocode?text=" + encodeURIComponent(CONFIG.stopQuery) +
    "&type=STOP&numResults=10";

  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error("Haltestellensuche fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const stops = (Array.isArray(data) ? data : []).filter(function (loc) {
      return loc && loc.id;
    });

    if (!stops.length) {
      throw new Error('Keine Haltestelle für "' + CONFIG.stopQuery + '" gefunden');
    }

    resolvedStopIds = stops.slice(0, CONFIG.stopLimit).map(function (s) {
      return s.id;
    });

    // Koordinaten der ersten gefundenen Haltestelle merken (für die
    // Gehzeit-Berechnung — beide Föhrenstraße-Halte liegen direkt
    // gegenüber, die kleine Differenz spielt für die Gehzeit keine Rolle).
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

function ensureWeatherFxLayers() {
  if (weatherFxBuilt || !els.weatherBig) return;
  weatherFxBuilt = true;

  // Regen: drei Tiefenebenen (fern/mittel/nah) mit eigener Geschwindigkeit,
  // Deckkraft und leichtem Wind-Drift (via CSS-Var, siehe style.css),
  // plus ein paar Spritzer-Ringe am unteren Rand — dem Lottie-Referenz-
  // Regen nachempfunden, aber als reine Transform/Opacity-Animation.
  const rainLayer = document.createElement("div");
  rainLayer.className = "weather-fx-layer weather-fx-rain";
  [
    { cls: "layer-far", positions: [4, 22, 40, 58, 76, 94], duration: 1.9 },
    { cls: "layer-mid", positions: [12, 30, 48, 66, 84], duration: 1.4 },
    { cls: "layer-near", positions: [8, 34, 60, 88], duration: 1.0 },
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
  [10, 32, 54, 76, 92].forEach(function (left, i) {
    const splash = document.createElement("span");
    splash.className = "fx-splash";
    splash.style.left = left + "%";
    splash.style.animationDelay = (i * 0.28) + "s";
    rainLayer.appendChild(splash);
  });

  // Gewitter nutzt dieselbe Regenebene (s.o.) + ein Blitz-Overlay, das
  // per Klasse auf .weather-big nur bei "fx-storm" überhaupt aktiv wird.
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
    els.weatherBig.insertBefore(layer, els.weatherBig.firstChild);
  });
}

// ---------- Wetter-Panel: Bremen-Fotohintergrund ----------
// Da es keine kostenlose Live-Wetterfoto-API gibt, wird stattdessen ein
// bekanntes Bremer Wahrzeichen als Hintergrund geladen (über die
// Wikipedia-REST-API, kostenlos/kein Key) und farblich per Verlauf zur
// aktuellen Wetterlage/Tageszeit getönt — kein echtes Live-Wetterfoto,
// aber deutlich "wohnlicher" als reines Icon+Text. Schlägt der Abruf
// fehl (Artikel/Bild nicht da, Netzwerkfehler), bleibt einfach der
// bisherige Verlaufshintergrund + die Animationen — nichts bricht.
const BREMEN_PHOTO_TITLES = [
  "Bremer Rathaus",
  "Bremer Roland",
  "Bremer Stadtmusikanten",
  "Böttcherstraße",
  "Schlachte (Bremen)",
  "Bremer Dom",
  "Weserstadion",
  "Universum Bremen",
];

let weatherPhotoEl = null;
let lastWeatherPhotoTitle = null;
let weatherPhotoFetchedAt = 0;

function ensureWeatherPhotoLayer() {
  if (weatherPhotoEl || !els.weatherBig) return;
  weatherPhotoEl = document.createElement("div");
  weatherPhotoEl.className = "weather-photo";
  els.weatherBig.insertBefore(weatherPhotoEl, els.weatherBig.firstChild);
}

function pickPhotoTitle() {
  let title = BREMEN_PHOTO_TITLES[Math.floor(Math.random() * BREMEN_PHOTO_TITLES.length)];
  let tries = 0;
  while (title === lastWeatherPhotoTitle && tries < 5) {
    title = BREMEN_PHOTO_TITLES[Math.floor(Math.random() * BREMEN_PHOTO_TITLES.length)];
    tries++;
  }
  return title;
}

// Wikipedia liefert die Thumb-URL standardmäßig recht klein
// (.../320px-Datei.jpg) — Breite im Pfad einfach hochsetzen, spart einen
// zweiten Request.
function upsizeThumb(url) {
  return url.replace(/\/\d+px-/, "/900px-");
}

function weatherPhotoTint(code, isDay) {
  const hour = new Date().getHours();
  if (hour >= 21 || hour < 6) return "rgba(8,12,22,0.68)";
  const cat = weatherFxCategory(code, isDay);
  if (cat === "storm") return "rgba(24,28,42,0.62)";
  if (cat === "rain") return "rgba(32,52,72,0.55)";
  if (cat === "snow") return "rgba(190,204,216,0.5)";
  if (cat === "fog") return "rgba(120,124,128,0.5)";
  if (cat === "cloud") return "rgba(54,58,64,0.55)";
  return "rgba(198,146,58,0.42)"; // klar/sonnig — warmer Ton
}

function applyWeatherPhotoTint(code, isDay) {
  if (!weatherPhotoEl) return;
  const bgUrl = weatherPhotoEl.getAttribute("data-bg-url");
  if (!bgUrl) return;
  const tint = weatherPhotoTint(code, isDay);
  weatherPhotoEl.style.backgroundImage = "linear-gradient(" + tint + "," + tint + "), " + bgUrl;
  // Textfarbe/Schatten ans Foto anpassen — className von updateWeather()
  // wird bei jedem Refresh neu gesetzt, deshalb hier statt einmalig beim
  // Laden, damit es auch nach dem Cache-Pfad (kein neuer Fetch) stimmt.
  if (els.weatherBig) els.weatherBig.classList.add("has-photo");
}

function fetchWeatherPhoto(code, isDay) {
  if (!els.weatherBig) return;
  ensureWeatherPhotoLayer();

  const now = Date.now();
  if (weatherPhotoEl.getAttribute("data-loaded") === "1" &&
      (now - weatherPhotoFetchedAt) < CONFIG.refreshWeatherMs) {
    // Foto ist noch frisch genug — nur Tönung an Wetter/Tageszeit anpassen.
    applyWeatherPhotoTint(code, isDay);
    return;
  }

  const title = pickPhotoTitle();
  const url = "https://de.wikipedia.org/api/rest_v1/page/summary/" +
    encodeURIComponent(title) + "?redirect=true";

  fetch(url).then(function (res) {
    if (!res.ok) throw new Error("Foto-Abruf fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const src = data && data.thumbnail && data.thumbnail.source;
    if (!src || !weatherPhotoEl) return;

    const bigSrc = "url('" + upsizeThumb(src) + "')";
    weatherPhotoEl.setAttribute("data-bg-url", bigSrc);
    weatherPhotoEl.setAttribute("data-loaded", "1");
    lastWeatherPhotoTitle = title;
    weatherPhotoFetchedAt = now;
    applyWeatherPhotoTint(code, isDay);
    weatherPhotoEl.classList.add("loaded");
  }).catch(function (err) {
    // Kein Foto? Kein Beinbruch — Verlaufshintergrund/Animation bleiben.
    console.error(err);
  });
}

// ---------- Wetter-Panel: echte Video-Loops statt reiner CSS-Animation ----------
// Für die Kategorien, wo ein passendes freies Loop-Video existiert (siehe
// CONFIG.weatherVideos — kurze Vorschau-Clips von echten Lottie-Animationen),
// läuft ein natives <video> als Hintergrund statt/über der CSS-Animation.
// Hardware-Videodecoder statt JS/CSS-Rendering — auf dem alten iPad
// tatsächlich günstiger als noch mehr CSS-Layer, und wirkt "flüssiger".
// Kein <video>-Fehlschlag reißt was mit: schlägt das Laden fehl oder gibt
// es für eine Kategorie kein Video, bleiben Foto + CSS-Effekt (s.o.)
// einfach wie gehabt sichtbar.
let weatherVideoEl = null;
let weatherVideoCategory = null;
const weatherVideoFailedFor = {};

function ensureWeatherVideoLayer() {
  if (weatherVideoEl || !els.weatherBig) return;
  weatherVideoEl = document.createElement("video");
  weatherVideoEl.className = "weather-video";
  weatherVideoEl.muted = true;
  weatherVideoEl.setAttribute("muted", "");
  weatherVideoEl.autoplay = true;
  weatherVideoEl.loop = true;
  weatherVideoEl.playsInline = true;
  weatherVideoEl.setAttribute("playsinline", "");
  weatherVideoEl.setAttribute("webkit-playsinline", "");
  weatherVideoEl.setAttribute("preload", "auto");

  weatherVideoEl.addEventListener("error", function () {
    if (weatherVideoCategory) weatherVideoFailedFor[weatherVideoCategory] = true;
    weatherVideoEl.classList.remove("playing");
    if (els.weatherBig) els.weatherBig.classList.remove("has-video");
  });

  weatherVideoEl.addEventListener("loadeddata", function () {
    weatherVideoEl.classList.add("playing");
    if (els.weatherBig) els.weatherBig.classList.add("has-video");
    const p = weatherVideoEl.play();
    if (p && p.catch) {
      p.catch(function () {
        // Autoplay evtl. blockiert — dann bleibt Foto/CSS-Effekt als Bild stehen.
      });
    }
  });

  els.weatherBig.appendChild(weatherVideoEl);
}

function applyWeatherVideo(category) {
  if (!els.weatherBig) return;
  ensureWeatherVideoLayer();

  const src = CONFIG.weatherVideos && CONFIG.weatherVideos[category];
  weatherVideoCategory = category;

  if (!src || weatherVideoFailedFor[category]) {
    weatherVideoEl.classList.remove("playing");
    els.weatherBig.classList.remove("has-video");
    return;
  }

  if (weatherVideoEl.getAttribute("data-src") === src) {
    // Läuft schon — Sichtbarkeits-Klasse trotzdem neu setzen, da
    // updateWeather() die className von .weather-big jedes Mal ersetzt.
    if (weatherVideoEl.readyState >= 2) {
      weatherVideoEl.classList.add("playing");
      els.weatherBig.classList.add("has-video");
    }
    return;
  }

  weatherVideoEl.setAttribute("data-src", src);
  weatherVideoEl.classList.remove("playing");
  els.weatherBig.classList.remove("has-video");
  weatherVideoEl.src = src;
  weatherVideoEl.load();
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
      value: new Date(d.sunrise[0]).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
      label: "Aufgang",
    });
  }
  if (d.sunset && d.sunset[0]) {
    chips.push({
      icon: "🌇",
      value: new Date(d.sunset[0]).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
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
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + CONFIG.weatherLat +
    "&longitude=" + CONFIG.weatherLon +
    "&current=temperature_2m,weather_code,is_day,relative_humidity_2m,apparent_temperature,wind_speed_10m" +
    "&hourly=temperature_2m,weather_code" +
    "&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max" +
    "&timezone=Europe%2FBerlin";

  fetch(url).then(function (res) {
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

    if (els.weatherBig) {
      ensureWeatherFxLayers();
      const fxCategory = weatherFxCategory(code, isDay);
      els.weatherBig.className = "weather-big" + (fxCategory ? " fx-" + fxCategory : "");
      fetchWeatherPhoto(code, isDay);
      applyWeatherVideo(fxCategory);
    }

    renderWeatherDetails(data);

    if (els.weatherHours && data.hourly && data.hourly.time) {
      const nowIso = data.current.time;
      let startIdx = data.hourly.time.indexOf(nowIso);
      if (startIdx === -1) startIdx = 0;

      els.weatherHours.innerHTML = "";
      for (let i = 1; i <= CONFIG.weatherHourCount; i++) {
        const idx = startIdx + i;
        if (idx >= data.hourly.time.length) break;

        const hTime = new Date(data.hourly.time[idx]);
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

  return fetch(detailUrl).then(function (res) {
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
  return fetch(url).then(function (res) {
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
function updateMusic() {
  if (!els.musicList) return;

  const url = "https://rss.marketingtools.apple.com/api/v2/de/music/most-played/" +
    CONFIG.musicCount + "/songs.json";

  fetch(url).then(function (res) {
    if (!res.ok) throw new Error("Musik-Abruf fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const results = (data && data.feed && Array.isArray(data.feed.results)) ? data.feed.results : [];
    if (!results.length) throw new Error("Keine Musikdaten erhalten");

    els.musicList.innerHTML = "";
    results.slice(0, CONFIG.musicCount).forEach(function (song, i) {
      const row = document.createElement("div");
      row.className = "music-item";

      const rank = document.createElement("span");
      rank.className = "music-rank";
      rank.textContent = (i + 1) + ".";

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

// ---------- Kartendarstellung (Leaflet + OpenStreetMap-Kacheln, kein
// API-Key nötig). Die Routenlinien kommen direkt aus der Transitous-Antwort
// (legGeometry, Google-Polyline-Format mit Präzision 1e6) — dieselbe API,
// keine zusätzliche Abhängigkeit. Läuft Leaflet auf dem alten Safari aus
// irgendeinem Grund nicht an, bleibt das Panel bei den Zeit-Chips oben und
// die Karte bleibt einfach leer, statt das ganze Panel zu zerschießen.
function decodePolyline(encoded, precisionDivisor) {
  precisionDivisor = precisionDivisor || 1e6;
  const points = [];
  let index = 0, lat = 0, lon = 0;
  const len = encoded.length;

  while (index < len) {
    let result = 1, shift = 0, b;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    result = 1;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lon += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push([lat / precisionDivisor, lon / precisionDivisor]);
  }

  return points;
}

function legLatLngs(leg) {
  try {
    const geom = leg && leg.legGeometry;
    if (!geom || !geom.points) return [];
    return decodePolyline(geom.points, 1e6);
  } catch (e) {
    console.error(e);
    return [];
  }
}

let commuteMap = null;
let commuteMapFailed = false;
let commuteLayers = [];

function ensureCommuteMap() {
  if (commuteMap || commuteMapFailed) return commuteMap;
  if (typeof window.L === "undefined" || !document.getElementById("commuteMap")) {
    commuteMapFailed = true;
    return null;
  }

  try {
    commuteMap = L.map("commuteMap", {
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      tap: false,
    });

    L.tileLayer(CONFIG.mapTileUrl, {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap-Mitwirkende",
    }).addTo(commuteMap);
  } catch (e) {
    console.error(e);
    commuteMapFailed = true;
    commuteMap = null;
  }

  return commuteMap;
}

function pinDivIcon(emoji) {
  return L.divIcon({
    className: "commute-pin-wrap",
    html: '<span class="commute-pin-pulse"></span><span class="commute-pin">' + emoji + "</span>",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function renderCommuteMap(coords, results) {
  const map = ensureCommuteMap();
  if (!map) return;

  commuteLayers.forEach(function (l) { map.removeLayer(l); });
  commuteLayers = [];

  const homeMarker = L.marker([coords.home.lat, coords.home.lon], { icon: pinDivIcon("🏠") }).addTo(map);
  const workMarker = L.marker([coords.work.lat, coords.work.lon], { icon: pinDivIcon("🏢") }).addTo(map);
  commuteLayers.push(homeMarker, workMarker);

  const allPoints = [[coords.home.lat, coords.home.lon], [coords.work.lat, coords.work.lon]];
  const drawnLines = [];

  COMMUTE_MODES.forEach(function (m, modeIndex) {
    const res = results[m.key];
    if (!res || !res.itinerary) return;

    const color = (CONFIG.commuteMapColors && CONFIG.commuteMapColors[m.key]) || "#5b6b78";
    const legs = (res.itinerary.legs && res.itinerary.legs.length) ? res.itinerary.legs : [res.itinerary];

    legs.forEach(function (leg) {
      const latlngs = legLatLngs(leg);
      if (!latlngs.length) return;

      // Breite, sehr transparente "Glow"-Linie drunter für etwas Tiefe,
      // die eigentliche Route obendrauf schön kräftig.
      const glow = L.polyline(latlngs, {
        color: color,
        weight: 12,
        opacity: 0.18,
        lineCap: "round",
      }).addTo(map);
      commuteLayers.push(glow);

      const line = L.polyline(latlngs, {
        color: color,
        weight: 5,
        opacity: 0.9,
        lineCap: "round",
      }).addTo(map);

      commuteLayers.push(line);
      // Pro Verkehrsmittel zeitversetzt einzeichnen (Rad zuerst, dann Bus,
      // dann Auto) statt alle drei Routen gleichzeitig hinzuklatschen.
      drawnLines.push({ line: line, delayMs: modeIndex * 220 });
      latlngs.forEach(function (p) { allPoints.push(p); });
    });
  });

  if (allPoints.length > 1) {
    map.fitBounds(allPoints, { padding: [26, 26] });
  } else {
    map.setView([coords.home.lat, coords.home.lon], 13);
  }

  // Routen "einzeichnen" lassen statt sie einfach hinzuklatschen.
  setTimeout(function () {
    drawnLines.forEach(function (entry) {
      try {
        const el = entry.line.getElement();
        if (!el || !el.getTotalLength) return;
        const length = el.getTotalLength();
        el.style.transition = "none";
        el.style.strokeDasharray = length + " " + length;
        el.style.strokeDashoffset = String(length);
        void el.getBoundingClientRect();
        el.style.transition = "stroke-dashoffset 1.1s ease " + entry.delayMs + "ms";
        el.style.strokeDashoffset = "0";
      } catch (e) {
        console.error(e);
      }
    });
  }, 60);
}

function renderCommuteChips(results) {
  if (!els.commuteChips) return;
  els.commuteChips.innerHTML = "";

  let anyOk = false;

  COMMUTE_MODES.forEach(function (m) {
    const res = results[m.key];
    const color = (CONFIG.commuteMapColors && CONFIG.commuteMapColors[m.key]) || "#5b6b78";

    const chip = document.createElement("div");
    chip.className = "commute-chip" + (res && res.minutes != null ? "" : " unavailable");
    // Dezenter Farbring passend zur Kartenfarbe des Verkehrsmittels —
    // Hex+Alpha statt color-mix()/rgba(var), da auf Safari 12 sicher.
    chip.style.boxShadow = "var(--glass-shadow), 0 0 0 1.5px " + color + "40";

    const dot = document.createElement("span");
    dot.className = "commute-chip-dot";
    dot.style.background = color;

    const icon = document.createElement("span");
    icon.className = "commute-chip-icon";
    icon.textContent = m.icon;

    const text = document.createElement("span");
    text.className = "commute-chip-text";

    const time = document.createElement("span");
    time.className = "commute-chip-time";
    time.textContent = res && res.minutes != null ? (res.minutes + " min") : "–";
    if (res && res.estimated) {
      const estimateTag = document.createElement("span");
      estimateTag.className = "commute-chip-estimated";
      estimateTag.textContent = "geschätzt";
      time.appendChild(estimateTag);
    }
    text.appendChild(time);

    const noteText = res ? (res.note || m.label) : "nicht verfügbar";
    const note = document.createElement("span");
    note.className = "commute-chip-note";
    note.textContent = noteText;
    text.appendChild(note);

    // Bus/ÖPNV: zusätzlich Linie(n) + wirkliche nächste Abfahrtszeit
    // zeigen, statt nur einer nackten Minutenzahl — deutlich planbarer.
    if (m.key === "bus" && res) {
      const lineText = res.lines && res.lines.length ? "Linie " + res.lines.join("/") : "";
      const depText = res.departure
        ? "ab " + res.departure.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
        : "";
      const extraText = [lineText, depText].filter(function (s) { return !!s; }).join(" · ");
      if (extraText) {
        const extra = document.createElement("span");
        extra.className = "commute-chip-extra";
        extra.textContent = extraText;
        text.appendChild(extra);
      }
    }

    chip.appendChild(dot);
    chip.appendChild(icon);
    chip.appendChild(text);
    els.commuteChips.appendChild(chip);

    if (res && res.minutes != null) anyOk = true;
  });

  commuteAvailable = anyOk;
}

function updateCommute() {
  if (!els.commuteChips) return;

  resolveCommuteCoords().then(function (coords) {
    const distanceMeters = haversineMeters(coords.home, coords.work);

    return Promise.all([
      fetchDirectItinerary(coords.home, coords.work, "BIKE")
        .then(function (it) {
          const check = plausibleMinutesOrFallback(
            itineraryDurationMin(it), estimateBikeMinutes(distanceMeters), "Fahrrad"
          );
          return { itinerary: it, minutes: check.minutes, estimated: check.estimated };
        })
        .catch(function (err) {
          console.error(err);
          return { itinerary: null, minutes: estimateBikeMinutes(distanceMeters), estimated: true };
        }),
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
      fetchDirectItinerary(coords.home, coords.work, "CAR")
        .then(function (it) {
          const check = plausibleMinutesOrFallback(
            itineraryDurationMin(it), estimateCarMinutes(distanceMeters), "Auto"
          );
          return { itinerary: it, minutes: check.minutes, estimated: check.estimated };
        })
        .catch(function (err) {
          console.error(err);
          return { itinerary: null, minutes: estimateCarMinutes(distanceMeters), estimated: true };
        }),
    ]).then(function (all) {
      const results = { bike: all[0], bus: all[1], car: all[2] };
      renderCommuteChips(results);
      renderCommuteMap(coords, results);
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
    return { teamName: teamName, next: next, last: last };
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
    els.sportBlock.appendChild(buildSportSlide(entry, index));
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

  Promise.all(teams.map(fetchTeamMatches)).then(function (results) {
    const entries = results.filter(function (r) { return !!r; });
    renderSport(entries);
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
    if (ids[i] === name) {
      el.className = "panel-view active";
    } else {
      el.className = "panel-view";
    }
  }

  if (name === "commute" && commuteMap) {
    // Karte war ggf. unsichtbar (opacity:0), Leaflet braucht nach dem
    // Sichtbarwerden einen Anstoß, um die Kachelgröße neu zu berechnen.
    setTimeout(function () {
      commuteMap.invalidateSize();
    }, 80);
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
