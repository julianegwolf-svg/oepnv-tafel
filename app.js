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
  weatherIcon: document.getElementById("weatherIcon"),
  weatherTemp: document.getElementById("weatherTemp"),
  weatherMinMax: document.getElementById("weatherMinMax"),
  weatherBigIcon: document.getElementById("weatherBigIcon"),
  weatherBigTemp: document.getElementById("weatherBigTemp"),
  weatherBigDesc: document.getElementById("weatherBigDesc"),
  weatherHours: document.getElementById("weatherHours"),
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
    "&n=" + (CONFIG.maxRows * 3) + "&arriveBy=false";

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

  departures.slice(0, CONFIG.maxRows).forEach(function (dep) {
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

function updateWeather() {
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + CONFIG.weatherLat +
    "&longitude=" + CONFIG.weatherLon +
    "&current=temperature_2m,weather_code" +
    "&hourly=temperature_2m,weather_code" +
    "&daily=temperature_2m_max,temperature_2m_min" +
    "&timezone=Europe%2FBerlin";

  fetch(url).then(function (res) {
    if (!res.ok) throw new Error("Wetter-Abruf fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const temp = Math.round(data.current.temperature_2m);
    const code = data.current.weather_code;
    const entry = WEATHER_CODES[code] || ["🌡️", ""];

    els.weatherIcon.textContent = entry[0];
    els.weatherTemp.textContent = temp + "°";

    if (els.weatherMinMax && data.daily && data.daily.temperature_2m_max) {
      const max = Math.round(data.daily.temperature_2m_max[0]);
      const min = Math.round(data.daily.temperature_2m_min[0]);
      els.weatherMinMax.textContent = min + "° / " + max + "°";
    }

    if (els.weatherBigIcon) {
      els.weatherBigIcon.textContent = entry[0];
      els.weatherBigTemp.textContent = temp + "°";
      els.weatherBigDesc.textContent = entry[1] || "";
    }

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

// ---------- Nachrichten (Tagesschau) ----------
// Für die ersten CONFIG.newsFullCount Meldungen wird zusätzlich der volle
// Artikeltext nachgeladen (zum Scrollen), der Rest bleibt Kurz-Headline.
// Klappt der Detail-Abruf mal nicht, fällt die Karte automatisch auf den
// kurzen Teaser (firstSentence/topline) zurück statt kaputt zu gehen.
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

function updateNews() {
  if (!els.newsList) return;

  const url = "https://www.tagesschau.de/api2u/news/?regions=" + CONFIG.newsRegion +
    "&pageSize=" + CONFIG.newsCount;

  fetch(url).then(function (res) {
    if (!res.ok) throw new Error("News-Abruf fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const items = (data && Array.isArray(data.news)) ? data.news.slice(0, CONFIG.newsCount) : [];
    if (!items.length) throw new Error("Keine News erhalten");

    return Promise.all(items.map(function (item, i) {
      const wantsFullText = i < CONFIG.newsFullCount;
      const bodyPromise = wantsFullText ? fetchArticleBody(item) : Promise.resolve(null);
      return bodyPromise.then(function (body) {
        return { item: item, body: body };
      });
    }));
  }).then(function (entries) {
    els.newsList.innerHTML = "";

    entries.forEach(function (entry) {
      const item = entry.item;
      const body = entry.body;

      const card = document.createElement("div");
      card.className = "news-item" + (body ? " full" : "");

      if (item.topline) {
        const top = document.createElement("div");
        top.className = "news-item-topline";
        top.textContent = item.topline;
        card.appendChild(top);
      }

      const title = document.createElement("div");
      title.className = "news-item-title";
      title.textContent = item.title || "";
      card.appendChild(title);

      if (body) {
        const bodyEl = document.createElement("div");
        bodyEl.className = "news-item-body";
        bodyEl.innerHTML = body;
        card.appendChild(bodyEl);
      } else if (item.firstSentence) {
        const teaser = document.createElement("div");
        teaser.className = "news-item-body";
        teaser.textContent = item.firstSentence;
        card.appendChild(teaser);
      }

      els.newsList.appendChild(card);
    });

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

    els.quoteBlock.innerHTML = "";

    const text = document.createElement("div");
    text.className = "quote-text";
    text.textContent = "“" + advice + "”";

    els.quoteBlock.appendChild(text);

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

  COMMUTE_MODES.forEach(function (m) {
    const res = results[m.key];
    if (!res || !res.itinerary) return;

    const color = (CONFIG.commuteMapColors && CONFIG.commuteMapColors[m.key]) || "#5b6b78";
    const legs = (res.itinerary.legs && res.itinerary.legs.length) ? res.itinerary.legs : [res.itinerary];

    legs.forEach(function (leg) {
      const latlngs = legLatLngs(leg);
      if (!latlngs.length) return;

      const line = L.polyline(latlngs, {
        color: color,
        weight: 5,
        opacity: 0.85,
        lineCap: "round",
      }).addTo(map);

      commuteLayers.push(line);
      drawnLines.push(line);
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
    drawnLines.forEach(function (line) {
      try {
        const el = line.getElement();
        if (!el || !el.getTotalLength) return;
        const length = el.getTotalLength();
        el.style.transition = "none";
        el.style.strokeDasharray = length + " " + length;
        el.style.strokeDashoffset = String(length);
        void el.getBoundingClientRect();
        el.style.transition = "stroke-dashoffset 1.3s ease";
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

    const chip = document.createElement("div");
    chip.className = "commute-chip" + (res && res.minutes != null ? "" : " unavailable");

    const dot = document.createElement("span");
    dot.className = "commute-chip-dot";
    dot.style.background = (CONFIG.commuteMapColors && CONFIG.commuteMapColors[m.key]) || "#5b6b78";

    const icon = document.createElement("span");
    icon.className = "commute-chip-icon";
    icon.textContent = m.icon;

    const text = document.createElement("span");
    text.className = "commute-chip-text";

    const time = document.createElement("span");
    time.className = "commute-chip-time";
    time.textContent = res && res.minutes != null ? (res.minutes + " min") : "–";
    text.appendChild(time);

    const noteText = res ? (res.note || m.label) : "nicht verfügbar";
    const note = document.createElement("span");
    note.className = "commute-chip-note";
    note.textContent = noteText;
    text.appendChild(note);

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
    return Promise.all([
      fetchDirectItinerary(coords.home, coords.work, "BIKE")
        .then(function (it) { return { itinerary: it, minutes: itineraryDurationMin(it) }; })
        .catch(function (err) { console.error(err); return null; }),
      fetchTransitItinerary(coords.home, coords.work)
        .then(function (it) {
          return { itinerary: it, minutes: itineraryDurationMin(it), note: itineraryRealtimeNote(it) };
        })
        .catch(function (err) { console.error(err); return null; }),
      fetchDirectItinerary(coords.home, coords.work, "CAR")
        .then(function (it) { return { itinerary: it, minutes: itineraryDurationMin(it) }; })
        .catch(function (err) { console.error(err); return null; }),
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

function buildSportRow(entry) {
  const useNext = !!entry.next;
  const match = useNext ? entry.next : entry.last;

  const row = document.createElement("div");
  row.className = "sport-card";

  const text = document.createElement("span");
  text.className = "sport-text";

  const labelEl = document.createElement("span");
  labelEl.className = "sport-label";
  labelEl.textContent = useNext ? "Nächstes Spiel" : "Letztes Spiel";
  text.appendChild(labelEl);

  const teams = document.createElement("span");
  teams.className = "sport-teams";
  const t1 = (match.team1 && (match.team1.shortName || match.team1.teamName)) || "?";
  const t2 = (match.team2 && (match.team2.shortName || match.team2.teamName)) || "?";
  teams.textContent = t1 + " – " + t2;
  text.appendChild(teams);

  const meta = document.createElement("span");
  meta.className = "sport-meta";
  const groupName = match.group && match.group.groupName;
  meta.textContent = formatMatchDate(match.matchDateTime) + (groupName ? " · " + groupName : "");
  text.appendChild(meta);

  row.appendChild(text);

  if (!useNext) {
    const score = finalScore(match);
    if (score) {
      const outcome = matchOutcome(match, score, entry.teamName);
      const scoreEl = document.createElement("span");
      scoreEl.className = "sport-score" + (outcome ? " sport-result-" + outcome : "");
      scoreEl.textContent = score;
      row.appendChild(scoreEl);
    }
  }

  return row;
}

function renderSport(entries) {
  if (!els.sportBlock) return;
  els.sportBlock.innerHTML = "";

  if (!entries.length) {
    els.sportBlock.innerHTML = '<div class="view-placeholder">Keine Spiele gefunden</div>';
    sportAvailable = false;
    return;
  }

  entries.forEach(function (entry) {
    els.sportBlock.appendChild(buildSportRow(entry));
  });

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
  progressFillEl.style.transition = "none";
  progressFillEl.style.width = "0%";
  // Reflow erzwingen, damit der Browser die Reset-Breite wirklich anwendet,
  // bevor die neue Transition startet.
  void progressFillEl.offsetWidth;
  progressFillEl.style.transition = "width " + durationMs + "ms linear";
  progressFillEl.style.width = "100%";
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
