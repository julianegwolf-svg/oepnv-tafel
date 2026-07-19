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
  commuteList: document.getElementById("commuteList"),
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

    const row = document.createElement("div");
    row.className = "row";
    if (cancelled) row.style.opacity = "0.45";

    const lineName = dep.routeShortName || dep.tripShortName || dep.displayName || "?";

    const lineBadge = document.createElement("span");
    lineBadge.className = "line-badge " + productClass(dep.mode);
    lineBadge.textContent = lineName;

    const dest = document.createElement("span");
    dest.className = "dest";
    dest.textContent = cancelled
      ? (dep.headsign || "") + " (fällt aus)"
      : (dep.headsign || "—");

    const timeCell = document.createElement("span");
    timeCell.className = "time-cell";

    const timeMin = document.createElement("span");
    timeMin.className = "time-min" + (minutes !== null && minutes <= 0 ? " now" : "");
    timeMin.textContent =
      minutes === null ? "–" : (minutes <= 0 ? "jetzt" : minutes + " min");

    timeCell.appendChild(timeMin);

    if (when && scheduled && when !== scheduled) {
      const delaySec = Math.round((new Date(when).getTime() - new Date(scheduled).getTime()) / 1000);
      if (delaySec >= 60) {
        const d = document.createElement("span");
        d.className = "time-delay";
        d.textContent = "+" + Math.round(delaySec / 60);
        timeCell.appendChild(d);
      }
    }

    row.appendChild(lineBadge);
    row.appendChild(dest);
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

function fetchDirectItinerary(from, to, mode) {
  const url = API_BASE + "/v6/plan?fromPlace=" + from.lat + "," + from.lon +
    "&toPlace=" + to.lat + "," + to.lon +
    "&directModes=" + mode + "&transitModes=";

  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error("Routenabruf (" + mode + ") fehlgeschlagen (" + res.status + ")");
    return res.json();
  }).then(function (data) {
    const items = (data && Array.isArray(data.direct)) ? data.direct : [];
    if (!items.length) throw new Error("Keine " + mode + "-Route gefunden");
    return items[0];
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
    if (!items.length) throw new Error("Keine ÖPNV-Route gefunden");
    return items[0];
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

function renderCommute(results) {
  if (!els.commuteList) return;
  els.commuteList.innerHTML = "";

  let anyOk = false;

  COMMUTE_MODES.forEach(function (m) {
    const res = results[m.key];

    const item = document.createElement("div");
    item.className = "commute-item" + (res ? "" : " unavailable");

    const icon = document.createElement("span");
    icon.className = "commute-icon";
    icon.textContent = m.icon;

    const text = document.createElement("span");
    text.className = "commute-text";

    const modeEl = document.createElement("span");
    modeEl.className = "commute-mode";
    modeEl.textContent = m.label;
    text.appendChild(modeEl);

    const noteEl = document.createElement("span");
    noteEl.className = "commute-note";
    noteEl.textContent = res ? (res.note || "") : "Route gerade nicht verfügbar";
    if (noteEl.textContent) text.appendChild(noteEl);

    const dur = document.createElement("span");
    dur.className = "commute-duration";
    dur.textContent = res && res.minutes != null ? (res.minutes + " min") : "–";

    item.appendChild(icon);
    item.appendChild(text);
    item.appendChild(dur);
    els.commuteList.appendChild(item);

    if (res && res.minutes != null) anyOk = true;
  });

  commuteAvailable = anyOk;
}

function updateCommute() {
  if (!els.commuteList) return;

  resolveCommuteCoords().then(function (coords) {
    return Promise.all([
      fetchDirectItinerary(coords.home, coords.work, "BIKE")
        .then(function (it) { return { minutes: itineraryDurationMin(it) }; })
        .catch(function (err) { console.error(err); return null; }),
      fetchTransitItinerary(coords.home, coords.work)
        .then(function (it) {
          return { minutes: itineraryDurationMin(it), note: itineraryRealtimeNote(it) };
        })
        .catch(function (err) { console.error(err); return null; }),
      fetchDirectItinerary(coords.home, coords.work, "CAR")
        .then(function (it) { return { minutes: itineraryDurationMin(it) }; })
        .catch(function (err) { console.error(err); return null; }),
    ]);
  }).then(function (all) {
    renderCommute({ bike: all[0], bus: all[1], car: all[2] });
  }).catch(function (err) {
    console.error(err);
    commuteAvailable = false;
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
  quote: function () { return quoteAvailable; },
};

function showPanel(name) {
  const ids = ["departures", "commute", "weather", "news", "music", "quote"];
  for (let i = 0; i < ids.length; i++) {
    const el = document.getElementById("panel-" + ids[i]);
    if (!el) continue;
    if (ids[i] === name) {
      el.className = "panel-view active";
    } else {
      el.className = "panel-view";
    }
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

  scheduleCarousel();

  if (CONFIG.fullReloadMs) {
    setTimeout(function () {
      window.location.reload();
    }, CONFIG.fullReloadMs);
  }
}

init();
