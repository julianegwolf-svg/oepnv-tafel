// ---------------------------------------------------------------
// Föhrenstraße Abfahrtstafel — app.js
// Abfahrten kommen jetzt über das offizielle VBN-Widget (siehe index.html).
// Diese Datei kümmert sich nur noch um Uhrzeit + Wetter.
// Datenquelle Wetter: Open-Meteo (kostenlos, kein API-Key)
// Hinweis: bewusst ohne Optional Chaining (?.) etc. geschrieben,
// damit das auch auf Safari 12 (iPad Air 1 / iOS 12.5.x) läuft.
// ---------------------------------------------------------------

const els = {
  lastUpdate: document.getElementById("lastUpdate"),
  clockTime: document.getElementById("clockTime"),
  clockDate: document.getElementById("clockDate"),
  weatherIcon: document.getElementById("weatherIcon"),
  weatherTemp: document.getElementById("weatherTemp"),
};

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
    if (els.lastUpdate) {
      els.lastUpdate.textContent = "Wetter aktualisiert " + new Date().toLocaleTimeString("de-DE");
    }
  }).catch(function (err) {
    console.error(err);
  });
}

// ---------- Start ----------
function init() {
  tickClock();
  setInterval(tickClock, CONFIG.refreshClockMs);

  updateWeather();
  setInterval(updateWeather, CONFIG.refreshWeatherMs);

  if (CONFIG.fullReloadMs) {
    setTimeout(function () {
      window.location.reload();
    }, CONFIG.fullReloadMs);
  }
}

init();
