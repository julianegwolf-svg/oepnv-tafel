// ---------------------------------------------------------------
// tagesblick.js — "Heute" am Morgen, "Morgen früh" am Abend (AUSBAU D15/D22)
//
// Ein Panel, das die Fragen des Moments auf einen Blick beantwortet,
// statt dass man Wetter, Abfahrten, Termine und Müll einzeln abwarten muss:
//  - morgens (5–10 Uhr): Wetter + wann Regen kommt, die nächste Bahn mit
//    "in X min los", der nächste Termin, Müll heute, Zuhause-Status (HA)
//  - abends (18–1 Uhr): Wetter zur gewohnten Losgehzeit morgen, die erste
//    passende Bahn morgen früh (eigener Abruf mit Uhrzeit), der erste
//    Termin morgen, "Müll heute Abend rausstellen" — und an Wochenenden/
//    Feiertagen ehrlich "morgen frei" statt eines Arbeitswegs (D19).
//
// Alle Daten kommen aus app.js (tafelSnapshot) — bis auf die Bahn für
// morgen früh, die einmal pro halbe Stunde gezielt abgefragt wird.
// Nur ES2017 (Safari 12).
// ---------------------------------------------------------------
(function () {
  "use strict";

  const CFG = (typeof CONFIG !== "undefined" && CONFIG.tagesblick) ? CONFIG.tagesblick : {};
  let panel = null;
  let bodyEl = null;
  let ticker = null;
  const morgen = { deps: null, fuer: "", laedt: false, stand: 0 };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function hhmm(ms) {
    return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }

  function modus(now) {
    const h = now.getHours();
    if (h >= 5 && h < 10) return "heute";
    if (h >= 18 || h < 1) return "morgen";
    return null;
  }

  function snap() {
    return typeof tafelSnapshot === "function" ? tafelSnapshot() : null;
  }

  function available() {
    if (CFG.aktiv === false) return false;
    const s = snap();
    return !!(modus(new Date()) && s && s.weather);
  }

  // ---------- Kalendertage ----------
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

  function zielTag(now, m) {
    // "Morgen früh" nach Mitternacht (0–1 Uhr) meint den heutigen Morgen.
    if (m === "morgen" && now.getHours() >= 18) return addDays(startOfDay(now), 1);
    return startOfDay(now);
  }

  function freierTag(tag) {
    const fei = typeof holidayOn === "function" ? holidayOn(tag) : null;
    if (fei) return fei.name;
    if (tag.getDay() === 0) return "Sonntag";
    if (tag.getDay() === 6) return "Samstag";
    return null;
  }

  // Gewohnte Losgehzeit (gelernt aus HA, sonst CONFIG.commuteTypicalDepartTime).
  function losgehzeit(tag) {
    let min = null;
    if (window.TafelLernen && TafelLernen.typischeZeit) min = TafelLernen.typischeZeit("weg", tag);
    if (min == null) {
      const p = String(CONFIG.commuteTypicalDepartTime || "07:30").split(":");
      min = (parseInt(p[0], 10) || 7) * 60 + (parseInt(p[1], 10) || 0);
    }
    return new Date(tag.getFullYear(), tag.getMonth(), tag.getDate(), Math.floor(min / 60), min % 60);
  }

  // ---------- Wetter ----------
  function wetterBeschreibung(code) {
    const e = typeof WEATHER_CODES !== "undefined" ? WEATHER_CODES[code] : null;
    return e ? e[1] : "";
  }

  function iconHtml(code, isDay) {
    return typeof weatherIconMarkup === "function" ? weatherIconMarkup(code, isDay) : "";
  }

  // Index der Stunde, die einen Zeitpunkt enthält.
  function stundenIndex(h, ms) {
    if (!h) return -1;
    for (let i = 0; i < h.time.length; i++) {
      if (h.time[i] <= ms && ms < h.time[i] + 3600000) return i;
    }
    return -1;
  }

  function regenSatz(w, vonMs, bisMs, jetztRegen) {
    const h = w.hourly;
    if (jetztRegen) return { text: "Es regnet gerade", nass: true };
    if (!h) return null;
    let maxPp = 0;
    for (let i = 0; i < h.time.length; i++) {
      if (h.time[i] + 3600000 <= vonMs || h.time[i] >= bisMs) continue;
      const pp = h.pp[i] || 0;
      if (pp > maxPp) maxPp = pp;
      if (pp >= 50) return { text: "Regen ab " + new Date(h.time[i]).getHours() + " Uhr (" + pp + " %)", nass: true };
    }
    if (maxPp >= 30) return { text: "Schauer möglich (" + maxPp + " %)", nass: false };
    return { text: "Bleibt trocken", nass: false };
  }

  // Kleine Stundenleiste: Symbol, Temperatur, Regenwahrscheinlichkeit.
  function stundenLeiste(w, zeiten) {
    const h = w.hourly;
    if (!h) return "";
    const zellen = [];
    zeiten.forEach(function (ms) {
      const i = stundenIndex(h, ms);
      if (i === -1) return;
      const st = new Date(h.time[i]).getHours();
      zellen.push('<div class="tb-hour"><span class="tb-hour-t">' + st + ' Uhr</span><span class="tb-hour-i">' +
        iconHtml(h.code[i], st >= 7 && st < 19) + '</span><span class="tb-hour-v num">' + Math.round(h.temp[i]) + "°</span>" +
        '<span class="tb-hour-p' + ((h.pp[i] || 0) >= 50 ? " is-nass" : "") + '">' + (h.pp[i] != null ? h.pp[i] + " %" : "") + "</span></div>");
    });
    return zellen.length ? '<div class="tb-hours">' + zellen.join("") + "</div>" : "";
  }

  function wetterKarte(s, m, tag) {
    const w = s.weather;
    if (!w) return "";
    if (m === "heute") {
      const ende = new Date(tag.getTime()); ende.setHours(22);
      const jetztRegen = s.rainStartMinutes != null && s.rainStartMinutes <= 0;
      const regen = regenSatz(w, Date.now(), ende.getTime(), jetztRegen);
      return '<div class="tb-card tb-wetter">' +
        '<div class="tb-eyebrow">Wetter heute</div>' +
        '<div class="tb-wetter-main"><span class="tb-wetter-icon">' + iconHtml(w.code, w.isDay !== false) + "</span>" +
        '<span class="tb-big num">' + esc(w.temp) + "°</span>" +
        '<span class="tb-wetter-text"><b>' + esc(w.desc) + "</b>" +
        (w.hi != null ? "<span>bis " + esc(w.hi) + "° · nachts " + esc(w.lo) + "°</span>" : "") + "</span></div>" +
        (regen ? '<div class="tb-line' + (regen.nass ? " is-nass" : "") + '">' + (regen.nass ? "☔ " : "") + esc(regen.text) + "</div>" : "") +
        stundenLeiste(w, [1, 2, 3, 5, 8].map(function (n) { return Date.now() + n * 3600000; })) +
        "</div>";
    }
    // Abends: Wetter zur gewohnten Losgehzeit morgen bzw. um 9 Uhr am freien Tag.
    const frei = freierTag(tag);
    const t = frei ? new Date(tag.getFullYear(), tag.getMonth(), tag.getDate(), 9, 0) : losgehzeit(tag);
    const i = stundenIndex(w.hourly, t.getTime());
    if (i === -1) return "";
    const h = w.hourly;
    let maxT = -99;
    for (let k = 0; k < h.time.length; k++) {
      const hr = new Date(h.time[k]);
      if (startOfDay(hr).getTime() === tag.getTime() && hr.getHours() >= 8 && hr.getHours() <= 20 && h.temp[k] > maxT) maxT = h.temp[k];
    }
    const abends = new Date(tag.getTime()); abends.setHours(20);
    const regen = regenSatz(w, t.getTime(), abends.getTime(), false);
    return '<div class="tb-card tb-wetter">' +
      '<div class="tb-eyebrow">Wetter morgen ' + hhmm(t.getTime()) + "</div>" +
      '<div class="tb-wetter-main"><span class="tb-wetter-icon">' + iconHtml(h.code[i], true) + "</span>" +
      '<span class="tb-big num">' + Math.round(h.temp[i]) + "°</span>" +
      '<span class="tb-wetter-text"><b>' + esc(wetterBeschreibung(h.code[i])) + "</b>" +
      (maxT > -99 ? "<span>tagsüber bis " + Math.round(maxT) + "°</span>" : "") + "</span></div>" +
      (regen ? '<div class="tb-line' + (regen.nass ? " is-nass" : "") + '">' + (regen.nass ? "☔ " : "") + esc(regen.text) + "</div>" : "") +
      stundenLeiste(w, [7, 9, 12, 15, 18].map(function (st) { return new Date(tag.getFullYear(), tag.getMonth(), tag.getDate(), st, 30).getTime(); })) +
      "</div>";
  }

  // ---------- Bahn ----------
  function badge(line, color, text) {
    return '<span class="tb-badge"' + (color ? ' style="background:#' + esc(color) + ";color:#" + esc(text || "ffffff") + '"' : "") + ">" + esc(line) + "</span>";
  }

  function bahnKarte(s, m, tag) {
    if (m === "heute") {
      const frei = freierTag(tag);
      const dep = (s.departures || []).filter(function (d) { return d.leaveByMs && d.leaveByMs >= Date.now() - 60000; })[0];
      if (!dep) return "";
      const inMin = Math.max(0, Math.round((dep.leaveByMs - Date.now()) / 60000));
      let arbeit = "";
      if (!frei && s.commutePtMinutes != null && dep.whenMs) {
        arbeit = '<div class="tb-line">Bei der Arbeit ca. ' + hhmm(dep.whenMs + s.commutePtMinutes * 60000) + "</div>";
      }
      return '<div class="tb-card tb-bahn">' +
        '<div class="tb-eyebrow">Nächste Bahn</div>' +
        '<div class="tb-bahn-main">' + badge(dep.line) + '<span class="tb-big num">' + esc(dep.clock) + "</span></div>" +
        '<div class="tb-bahn-dest">→ ' + esc(dep.dest) + "</div>" +
        '<div class="tb-pill' + (inMin <= 1 ? " is-now" : (inMin <= 4 ? " is-soon" : "")) + '">' + (inMin <= 1 ? "jetzt los" : "in " + inMin + " min los") + "</div>" +
        arbeit + "</div>";
    }
    const frei = freierTag(tag);
    if (frei) {
      return '<div class="tb-card tb-bahn tb-frei">' +
        '<div class="tb-eyebrow">Arbeitsweg</div>' +
        '<div class="tb-big">Frei</div>' +
        '<div class="tb-line">Morgen ist ' + esc(frei) + " – kein Arbeitsweg.</div></div>";
    }
    holeBahnMorgen(tag);
    if (!morgen.deps || morgen.fuer !== String(tag.getTime())) {
      return '<div class="tb-card tb-bahn"><div class="tb-eyebrow">Bahn morgen früh</div><div class="tb-line">wird abgefragt …</div></div>';
    }
    const walk = s.walkMinutes || 0;
    const los = losgehzeit(tag);
    const dep = morgen.deps.filter(function (d) { return d.whenMs - walk * 60000 >= los.getTime() - 3 * 60000; })[0];
    if (!dep) return "";
    return '<div class="tb-card tb-bahn">' +
      '<div class="tb-eyebrow">Bahn morgen früh</div>' +
      '<div class="tb-bahn-main">' + badge(dep.line, dep.color, dep.textColor) + '<span class="tb-big num">' + hhmm(dep.whenMs) + "</span></div>" +
      '<div class="tb-bahn-dest">→ ' + esc(dep.dest) + "</div>" +
      '<div class="tb-line">Los um ' + hhmm(dep.whenMs - walk * 60000) + (s.commutePtMinutes != null ? " · Arbeit ca. " + hhmm(dep.whenMs + s.commutePtMinutes * 60000) : "") + "</div>" +
      "</div>";
  }

  // Erste Abfahrten morgen ab der gewohnten Losgehzeit (eigener Abruf mit
  // Uhrzeit, höchstens alle 30 Minuten, mit Zeitdeckel).
  function holeBahnMorgen(tag) {
    const key = String(tag.getTime());
    if (morgen.laedt || (morgen.fuer === key && Date.now() - morgen.stand < 30 * 60 * 1000)) return;
    if (typeof resolvedStopIds === "undefined" || !resolvedStopIds || !resolvedStopIds.length) return;
    morgen.laedt = true;
    const ab = new Date(losgehzeit(tag).getTime() - 5 * 60000);
    const walk = typeof walkMinutesToStop !== "undefined" && walkMinutesToStop != null ? walkMinutesToStop : 0;
    const t = new Date(ab.getTime() + walk * 60000).toISOString();
    const abrufe = resolvedStopIds.map(function (id) {
      const url = API_BASE + "/v6/stoptimes?stopId=" + encodeURIComponent(id) + "&n=12&time=" + encodeURIComponent(t);
      return Promise.race([
        fetch(url).then(function (r) { return r.ok ? r.json() : { stopTimes: [] }; }),
        new Promise(function (resolve) { setTimeout(function () { resolve({ stopTimes: [] }); }, 10000); }),
      ]).catch(function () { return { stopTimes: [] }; });
    });
    Promise.all(abrufe).then(function (res) {
      const alle = [];
      res.forEach(function (r) { (r.stopTimes || []).forEach(function (d) { alle.push(d); }); });
      morgen.deps = alle.filter(function (d) {
        return !d.cancelled && !d.tripCancelled && (typeof passesDirectionFilter !== "function" || passesDirectionFilter(d.headsign || ""));
      }).map(function (d) {
        const p = d.place || {};
        return {
          line: d.routeShortName || d.displayName || "?",
          dest: d.headsign || "",
          whenMs: new Date(p.departure || p.scheduledDeparture).getTime(),
          color: d.routeColor || null,
          textColor: d.routeTextColor || null,
        };
      }).sort(function (a, b) { return a.whenMs - b.whenMs; });
      morgen.fuer = key;
      morgen.stand = Date.now();
      morgen.laedt = false;
      render();
    });
  }

  // ---------- Termin ----------
  function terminKarte(s, m, tag) {
    const ende = addDays(tag, 1).getTime();
    const ab = m === "heute" ? Date.now() - 30 * 60000 : tag.getTime();
    const evs = (s.calendar || []).filter(function (e) {
      return e.start >= (e.allDay ? tag.getTime() : ab) && e.start < ende;
    });
    const titel = m === "heute" ? "Termine heute" : "Termine morgen";
    if (!evs.length) {
      return (s.calendar && s.calendar.length)
        ? '<div class="tb-card tb-termin"><div class="tb-eyebrow">' + titel + '</div><div class="tb-mid">Keine</div><div class="tb-line">Der Kalender ist frei.</div></div>'
        : "";
    }
    const e = evs[0];
    return '<div class="tb-card tb-termin">' +
      '<div class="tb-eyebrow">' + titel + "</div>" +
      (e.allDay ? '<div class="tb-mid tb-dim">Ganztägig</div>' : '<div class="tb-big num">' + hhmm(e.start) + "</div>") +
      '<div class="tb-termin-title">' + esc(e.title) + "</div>" +
      (e.location ? '<div class="tb-line">' + esc(e.location) + "</div>" : "") +
      (evs.length > 1 ? '<div class="tb-line tb-dim">+ ' + (evs.length - 1) + (evs.length === 2 ? " weiterer" : " weitere") + "</div>" : "") +
      "</div>";
  }

  // ---------- Müll ----------
  function muellKarte(s, m, tag) {
    const w = s.waste;
    if (!w || !w.date) return "";
    const tage = Math.round((startOfDay(w.date).getTime() - startOfDay(new Date()).getTime()) / 86400000);
    const namen = { restbio: "Restmüll & Bio", papier: "Papier & Gelber Sack" };
    const was = w.type === "exception" ? w.label : namen[w.type];
    if (!was) return "";
    let text = "";
    if (m === "heute" && tage === 0) text = "Heute: bis 7 Uhr an die Straße";
    else if (m === "morgen" && tage === 1) text = "Heute Abend rausstellen";
    else return "";
    return '<div class="tb-card tb-muell"><div class="tb-eyebrow">Müll</div>' +
      '<div class="tb-mid">🗑️ ' + esc(was) + "</div>" +
      '<div class="tb-line">' + esc(text) + (w.shiftedBecause ? " (verschoben wegen " + esc(w.shiftedBecause) + ")" : "") + "</div></div>";
  }

  // ---------- Zuhause (nur mit HA) ----------
  function zuhauseKarte() {
    const HA = window.TafelHA;
    if (!HA || !HA.isConnected()) return "";
    const g = HA.model().global;
    const an = g.lightsAll.filter(function (id) { const st = HA.state(id); return st && st.state === "on"; }).length;
    const zeilen = [];
    zeilen.push(an ? an + (an === 1 ? " Licht an" : " Lichter an") : "Alle Lichter aus");
    const hinweise = window.TafelHAUI ? TafelHAUI.hints().filter(function (h) { return h.prio <= 2 && !h.vorschlag; }) : [];
    hinweise.slice(0, 2).forEach(function (h) { zeilen.push(h.text); });
    return '<div class="tb-card tb-zuhause"><div class="tb-eyebrow">Zuhause</div>' +
      zeilen.map(function (z, i) { return '<div class="' + (i === 0 ? "tb-mid" : "tb-line is-hinweis") + '">' + esc(z) + "</div>"; }).join("") +
      "</div>";
  }

  // ---------- Darstellung ----------
  function render() {
    if (!bodyEl) return;
    const now = new Date();
    const m = modus(now) || "heute";
    const s = snap();
    if (!s) return;
    const tag = zielTag(now, m);
    const name = (function () {
      const HA = window.TafelHA;
      if (!HA || !HA.isConnected()) return "";
      const home = HA.personsHome();
      return home.length ? HA.name(home[0]).split(" ")[0] : "";
    })();
    const frei = freierTag(tag);
    const kopf = m === "heute"
      ? (now.getHours() < 11 ? "Guten Morgen" + (name ? ", " + name : "") : "Heute")
      : "Morgen früh";
    const datum = tag.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }) +
      (frei && frei !== "Samstag" && frei !== "Sonntag" ? " · " + frei : "");

    const karten = [wetterKarte(s, m, tag), bahnKarte(s, m, tag), terminKarte(s, m, tag), muellKarte(s, m, tag), zuhauseKarte()]
      .filter(function (k) { return !!k; });
    const html = '<div class="tb-head"><div class="tb-title">' + esc(kopf) + '</div><div class="tb-sub">' + esc(datum) + "</div></div>" +
      '<div class="tb-grid n-' + karten.length + '">' + karten.join("") + "</div>";
    if (bodyEl._html !== html) {
      bodyEl._html = html;
      bodyEl.innerHTML = html;
    }
  }

  function onPanelShown(name) {
    if (name === "tagesblick") {
      render();
      if (!ticker) ticker = setInterval(render, 20 * 1000);
    } else if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function init() {
    panel = document.getElementById("panel-tagesblick");
    bodyEl = panel ? panel.querySelector(".tb-body") : null;
  }

  window.TafelTag = {
    init: init,
    available: available,
    onPanelShown: onPanelShown,
    render: render,
  };
})();
