// ---------------------------------------------------------------
// Föhrenstraße Abfahrtstafel — app.js
// Datenquelle ÖPNV: v6.db.transport.rest (kostenlos, kein API-Key, CORS-frei)
// Datenquelle Wetter: Open-Meteo (kostenlos, kein API-Key)
// Bewusst ohne Optional Chaining (?.), Array.flat() etc. geschrieben,
// damit das auch auf Safari 12 (iPad Air 1 / iOS 12.5.x) läuft.
// Aktualisiert Abfahrten automatisch alle CONFIG.refreshDeparturesMs.
// ---------------------------------------------------------------

const API_BASE = "https://v6.db.transport.rest";

const els = {
  rows: document.getElementById("departureRows"),
  status: document.getElementById("statusText"),
  lastUpdate: document.getElementById("lastUpdate"),
  clockTime: document.getElementById("clockTime"),
  clockDate: document.getElementById("clockDate"),
  weatherIcon: document.getElementById("weatherIcon"),
  weatherTemp: document.getElementById("weatherTemp"),
};

let resolvedStopIds = (CONFIG.stopIds && CONFIG.stopIds.length)
  ? CONFIG.stopIds.slice()
  : null;

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

// ---------- Haltestellen auflösen ----------
function resolveStopIds() {
  if (resolvedStopIds) return Promise.resolve(resolvedStopIds);

  const url = API_BASE + "/locations?query=" + encodeURIComponent(
    CONFIG.stopQuery
  ) + "&fuzzy=true&results=10&poi=false&addresses=false";

  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error("Haltestellensuche fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const stops = (Array.isArray(data) ? data : []).filter(function (loc) {
      return loc && (loc.type === "stop" || loc.type === "station") && loc.id;
    });

    if (!stops.length) {
      throw new Error('Keine Haltestelle für "' + CONFIG.stopQuery + '" gefunden');
    }

    resolvedStopIds = stops.slice(0, CONFIG.stopLimit).map(function (s) {
      return s.id;
    });
    return resolvedStopIds;
  });
}

// ---------- Abfahrten laden ----------
function fetchDeparturesForStop(stopId) {
  const profileParam = CONFIG.apiProfile ? "&profile=" + CONFIG.apiProfile : "";
  const url = API_BASE + "/stops/" + encodeURIComponent(stopId) + "/departures?duration=60&results=" +
    (CONFIG.maxRows * 3) + profileParam;

  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error("Abfahrten-Abruf fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.departures)) return data.departures;
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

function productClass(product) {
  if (product === "tram") return "tram";
  if (product === "bus") return "bus";
  return "bus";
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

  departures.slice(0, CONFIG.maxRows).forEach(function (dep) {
    const when = dep.when || dep.plannedWhen;
    const whenDate = when ? new Date(when) : null;
    const minutes = whenDate ? Math.round((whenDate.getTime() - now) / 60000) : null;

    const row = document.createElement("div");
    row.className = "row";
    if (dep.cancelled) row.style.opacity = "0.45";

    const lineName = (dep.line && dep.line.name) || "?";
    const lineProduct = dep.line && dep.line.product;

    const lineBadge = document.createElement("span");
    lineBadge.className = "line-badge " + productClass(lineProduct);
    lineBadge.textContent = lineName;

    const dest = document.createElement("span");
    dest.className = "dest";
    dest.textContent = dep.cancelled
      ? (dep.direction || "") + " (fällt aus)"
      : (dep.direction || "—");

    const timeCell = document.createElement("span");
    timeCell.className = "time-cell";

    const timeMin = document.createElement("span");
    timeMin.className = "time-min" + (minutes !== null && minutes <= 0 ? " now" : "");
    timeMin.textContent =
      minutes === null ? "–" : (minutes <= 0 ? "jetzt" : minutes + " min");

    timeCell.appendChild(timeMin);

    const delaySec = dep.delay;
    if (typeof delaySec === "number" && delaySec >= 60) {
      const d = document.createElement("span");
      d.className = "time-delay";
      d.textContent = "+" + Math.round(delaySec / 60);
      timeCell.appendChild(d);
    }

    row.appendChild(lineBadge);
    row.appendChild(dest);
    row.appendChild(timeCell);
    els.rows.appendChild(row);
  });
}

function updateDepartures() {
  resolveStopIds().then(function (stopIds) {
    return Promise.all(stopIds.map(fetchDeparturesForStop));
  }).then(function (results) {
    let all = [].concat.apply([], results);

    all = all.filter(function (dep) {
      return passesDirectionFilter(dep.direction);
    });

    const seen = {};
    all = all.filter(function (dep) {
      const lineName = dep.line && dep.line.name;
      const key = (dep.tripId || lineName) + "-" + (dep.when || dep.plannedWhen);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });

    all.sort(function (a, b) {
      const ta = new Date(a.when || a.plannedWhen).getTime();
      const tb = new Date(b.when || b.plannedWhen).getTime();
      return ta - tb;
    });

    renderDepartures(all);
    els.status.textContent = "Live";
    els.lastUpdate.textContent = "Aktualisiert " + new Date().toLocaleTimeString("de-DE");
  }).catch(function (err) {
    console.error(err);
    els.status.textContent = "Fehler: " + err.message;
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

function updateWeather() {
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + CONFIG.weatherLat +
    "&longitude=" + CONFIG.weatherLon + "&current=temperature_2m,weather_code&timezone=Europe%2FBerlin";

  fetch(url).then(function (res) {
    if (!res.ok) throw new Error("Wetter-Abruf fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const temp = Math.round(data.current.temperature_2m);
    const code = data.current.weather_code;
    const entry = WEATHER_CODES[code] || ["🌡️"];

    els.weatherIcon.textContent = entry[0];
    els.weatherTemp.textContent = temp + "°";
  }).catch(function (err) {
    console.error(err);
  });
}

// ---------- Start ----------
function init() {
  tickClock();
  setInterval(tickClock, CONFIG.refreshClockMs);

  updateDepartures();
  setInterval(updateDepartures, CONFIG.refreshDeparturesMs);

  updateWeather();
  setInterval(updateWeather, CONFIG.refreshWeatherMs);

  if (CONFIG.fullReloadMs) {
    setTimeout(function () {
      window.location.reload();
    }, CONFIG.fullReloadMs);
  }
}

init();
