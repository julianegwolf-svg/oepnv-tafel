// ---------------------------------------------------------------
// Föhrenstraße Abfahrtstafel — app.js
// Datenquelle ÖPNV: v6.db.transport.rest (kostenlos, kein API-Key, CORS-frei)
// Datenquelle Wetter: Open-Meteo (kostenlos, kein API-Key)
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

let resolvedStopIds = Array.isArray(CONFIG.stopIds) && CONFIG.stopIds.length
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
async function resolveStopIds() {
  if (resolvedStopIds) return resolvedStopIds;

  const url = `${API_BASE}/locations?query=${encodeURIComponent(
    CONFIG.stopQuery
  )}&fuzzy=true&results=10&poi=false&addresses=false`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Haltestellensuche fehlgeschlagen (${res.status})`);
  const data = await res.json();

  const stops = (Array.isArray(data) ? data : []).filter(
    (loc) => loc && (loc.type === "stop" || loc.type === "station") && loc.id
  );

  if (!stops.length) {
    throw new Error(`Keine Haltestelle für "${CONFIG.stopQuery}" gefunden`);
  }

  resolvedStopIds = stops.slice(0, CONFIG.stopLimit).map((s) => s.id);
  return resolvedStopIds;
}

// ---------- Abfahrten laden ----------
async function fetchDeparturesForStop(stopId) {
  const profileParam = CONFIG.apiProfile ? `&profile=${CONFIG.apiProfile}` : "";
  const url = `${API_BASE}/stops/${encodeURIComponent(stopId)}/departures?duration=60&results=${
    CONFIG.maxRows * 3
  }${profileParam}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Abfahrten-Abruf fehlgeschlagen (${res.status})`);
  const data = await res.json();

  if (Array.isArray(data)) return data;
  if (Array.isArray(data.departures)) return data.departures;
  return [];
}

function passesDirectionFilter(direction) {
  const dir = (direction || "").toLowerCase();

  if (CONFIG.onlyDestinations && CONFIG.onlyDestinations.length) {
    return CONFIG.onlyDestinations.some((d) => dir.includes(d.toLowerCase()));
  }

  if (CONFIG.excludeDestinations && CONFIG.excludeDestinations.length) {
    return !CONFIG.excludeDestinations.some((d) => dir.includes(d.toLowerCase()));
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

  departures.slice(0, CONFIG.maxRows).forEach((dep) => {
    const when = dep.when || dep.plannedWhen;
    const whenDate = when ? new Date(when) : null;
    const minutes = whenDate ? Math.round((whenDate.getTime() - now) / 60000) : null;

    const row = document.createElement("div");
    row.className = "row";
    if (dep.cancelled) row.style.opacity = "0.45";

    const lineBadge = document.createElement("span");
    lineBadge.className = `line-badge ${productClass(dep.line && dep.line.product)}`;
    lineBadge.textContent = (dep.line && dep.line.name) || "?";

    const dest = document.createElement("span");
    dest.className = "dest";
    dest.textContent = dep.cancelled
      ? `${dep.direction || ""} (fällt aus)`
      : dep.direction || "—";

    const timeCell = document.createElement("span");
    timeCell.className = "time-cell";

    const timeMin = document.createElement("span");
    timeMin.className = "time-min" + (minutes !== null && minutes <= 0 ? " now" : "");
    timeMin.textContent =
      minutes === null ? "–" : minutes <= 0 ? "jetzt" : `${minutes} min`;

    timeCell.appendChild(timeMin);

    const delaySec = dep.delay;
    if (typeof delaySec === "number" && delaySec >= 60) {
      const d = document.createElement("span");
      d.className = "time-delay";
      d.textContent = `+${Math.round(delaySec / 60)}`;
      timeCell.appendChild(d);
    }

    row.appendChild(lineBadge);
    row.appendChild(dest);
    row.appendChild(timeCell);
    els.rows.appendChild(row);
  });
}

async function updateDepartures() {
  try {
    const stopIds = await resolveStopIds();

    const results = await Promise.all(stopIds.map(fetchDeparturesForStop));
    let all = results.flat();

    all = all.filter((dep) => passesDirectionFilter(dep.direction));

    // Duplikate (gleiche Fahrt, an beiden Haltestellen erfasst) entfernen
    const seen = new Set();
    all = all.filter((dep) => {
      const key = `${dep.tripId || dep.line?.name}-${dep.when || dep.plannedWhen}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    all.sort((a, b) => {
      const ta = new Date(a.when || a.plannedWhen).getTime();
      const tb = new Date(b.when || b.plannedWhen).getTime();
      return ta - tb;
    });

    renderDepartures(all);
    els.status.textContent = "Live";
    els.lastUpdate.textContent = `Aktualisiert ${new Date().toLocaleTimeString("de-DE")}`;
  } catch (err) {
    console.error(err);
    els.status.textContent = `Fehler: ${err.message}`;
  }
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

async function updateWeather() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${CONFIG.weatherLat}&longitude=${CONFIG.weatherLon}&current=temperature_2m,weather_code&timezone=Europe%2FBerlin`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Wetter-Abruf fehlgeschlagen (${res.status})`);
    const data = await res.json();
    const temp = Math.round(data.current.temperature_2m);
    const code = data.current.weather_code;
    const [icon] = WEATHER_CODES[code] || ["🌡️"];

    els.weatherIcon.textContent = icon;
    els.weatherTemp.textContent = `${temp}°`;
  } catch (err) {
    console.error(err);
  }
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
    setTimeout(() => window.location.reload(), CONFIG.fullReloadMs);
  }
}

init();
