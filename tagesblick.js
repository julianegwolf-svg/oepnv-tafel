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
  // Heute früh: Abfahrten rund um die nötige Bahn zur Arbeit, solange sie
  // noch nicht in der normalen Abfahrtsliste (nächste Stunde) steht.
  const frueh = { deps: null, fuer: "", laedt: false, stand: 0 };

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

  // Kurzwort je Wettercode für die Stundenzeilen (passt auch in die
  // schmale Wetterspalte bei 4–5 Karten, statt "Teilweise b…").
  function kurzWetter(code) {
    if (code === 0) return "Klar";
    if (code === 1) return "Meist klar";
    if (code === 2) return "Wolkig";
    if (code === 3) return "Bedeckt";
    if (code === 45 || code === 48) return "Nebel";
    if (code >= 51 && code <= 57) return "Niesel";
    if (code >= 61 && code <= 67) return "Regen";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "Schnee";
    if (code >= 80 && code <= 82) return "Schauer";
    if (code >= 95) return "Gewitter";
    return wetterBeschreibung(code);
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
      if (pp >= 50) return { text: "Regen ab " + new Date(h.time[i]).getHours() + " Uhr (" + pp + " %)", nass: true, ab: h.time[i] };
    }
    if (maxPp >= 30) return { text: "Schauer möglich (" + maxPp + " %)", nass: false };
    return { text: "Bleibt trocken", nass: false };
  }

  // Kleine Stundenleiste: Symbol, Temperatur, Regenwahrscheinlichkeit.
  function stundenLeiste(w, zeiten) {
    const h = w.hourly;
    if (!h) return "";
    const idx = zeiten.map(function (ms) { return stundenIndex(h, ms); }).filter(function (i) { return i !== -1; });
    // Bleibt es in allen Zeilen trocken (< 20 %), sagt eine Spalte leerer
    // Balken nichts – dann steht dort, wie der Himmel aussieht.
    const trocken = idx.every(function (i) { return (h.pp[i] || 0) < 20; });
    const zellen = idx.map(function (i) {
      const st = new Date(h.time[i]).getHours();
      // Eine Zeile je Stunde: Zeit, Symbol, Temperatur, Regenbalken (Länge =
      // Regenwahrscheinlichkeit) – füllt die hohe Karte und ist aus 3 m lesbar.
      const pp = h.pp[i] != null ? Math.max(0, Math.min(100, h.pp[i])) : null;
      const rest = trocken
        ? '<span class="tb-hour-d">' + esc(kurzWetter(h.code[i])) + "</span>"
        : '<span class="tb-hour-bar"><span class="tb-hour-fill" style="width:' + (pp || 0) + '%"></span></span>' +
          '<span class="tb-hour-p num">' + (pp != null ? pp + " %" : "") + "</span>";
      return '<div class="tb-hour' + ((pp || 0) >= 50 ? " is-nass" : "") + '"><span class="tb-hour-t num">' + st + ' Uhr</span><span class="tb-hour-i">' +
        iconHtml(h.code[i], st >= 7 && st < 19) + '</span><span class="tb-hour-v num">' + Math.round(h.temp[i]) + "°</span>" + rest + "</div>";
    });
    return zellen.length ? '<div class="tb-hours">' + zellen.join("") + "</div>" : "";
  }

  // Die nächsten 4 Stunden einzeln, danach in 2-Stunden-Schritten. Steht
  // oben "Regen ab 14 Uhr", liegt 14 Uhr auch auf diesem Raster – vorher
  // sprang die Liste von 13 auf 15 Uhr, genau an der angekündigten Stunde
  // vorbei.
  function stundenHeute(regenAbMs) {
    const jetzt = Date.now();
    let start = 6;
    if (regenAbMs) {
      const n = Math.round((regenAbMs - (jetzt - jetzt % 3600000)) / 3600000);
      if (n > 4 && n % 2 === 1) start = 5;
    }
    const stunden = [1, 2, 3, 4];
    for (let n = start; n <= start + 6; n += 2) stunden.push(n);
    return stunden.map(function (n) { return jetzt + n * 3600000; });
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
        (w.hi != null ? '<span class="tb-hilo"><span>bis ' + esc(w.hi) + '°</span><span class="tb-sep"> · </span><span>nachts ' + esc(w.lo) + "°</span></span>" : "") + "</span></div>" +
        (regen ? '<div class="tb-line' + (regen.nass ? " is-nass" : "") + '">' + (regen.nass ? "☔ " : "") + esc(regen.text) + "</div>" : "") +
        stundenLeiste(w, stundenHeute(regen && regen.ab)) +
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
      stundenLeiste(w, [7, 8, 9, 11, 13, 15, 17, 19].map(function (st) { return new Date(tag.getFullYear(), tag.getMonth(), tag.getDate(), st, 30).getTime(); })) +
      "</div>";
  }

  // ---------- Bahn ----------
  function zielText(dest) {
    return typeof zielAnzeige === "function" ? zielAnzeige(dest).haupt : dest;
  }

  function badge(line, color, text) {
    const dunkel = typeof istDunkleFarbe === "function" && istDunkleFarbe(color);
    return '<span class="tb-badge' + (dunkel ? " is-dunkel" : "") + '"' + (color ? ' style="background:#' + esc(color) + ";color:#" + esc(text || "ffffff") + '"' : "") + ">" + esc(line) + "</span>";
  }

  // Fahrplan der Arbeitslinie rund um die empfohlene Bahn: eine davor, die
  // empfohlene, zwei danach – je mit Losgehzeit, Ankunft und "pünktlich /
  // knapp / N min zu spät". Beantwortet die Frage nach dem ersten Blick:
  // "Und wenn ich die nicht schaffe?"
  function fahrplanHtml(deps, pick, ptMin, walkMin, tag) {
    if (!deps || !pick || ptMin == null) return "";
    const t = String(CONFIG.workArrivalTarget || "").split(":");
    if (t.length !== 2) return "";
    const ziel = new Date(tag.getFullYear(), tag.getMonth(), tag.getDate(), parseInt(t[0], 10) || 0, parseInt(t[1], 10) || 0).getTime();
    const i = deps.indexOf(pick);
    if (i === -1) return "";
    const von = Math.max(0, i - 1);
    const zeilen = deps.slice(von, von + 4);
    if (zeilen.length < 2) return "";
    return '<div class="tb-plan"><div class="tb-plan-kopf">Ankunft bei der Arbeit · Ziel ' + hhmm(ziel) + "</div>" +
      zeilen.map(function (d) {
        const an = d.whenMs + ptMin * 60000;
        const spaet = Math.round((an - ziel) / 60000);
        let cls, text;
        if (spaet > 0) { cls = "is-spaet"; text = spaet + " min zu spät"; }
        else if (spaet > -5) { cls = "is-knapp"; text = "knapp"; }
        else { cls = "is-ok"; text = "pünktlich"; }
        const los = d.leaveByMs || d.whenMs - walkMin * 60000;
        // Lage zur empfohlenen Bahn – halbhohe Karten zeigen nur pick + nach-1.
        const k = zeilen.indexOf(d) - zeilen.indexOf(pick);
        const lage = k === 0 ? " is-pick" : (k < 0 ? " is-vor" : " is-nach-" + k);
        return '<div class="tb-plan-row ' + cls + lage + '">' +
          '<span class="tb-plan-t num">' + hhmm(d.whenMs) + "</span>" +
          '<span class="tb-plan-los num">los ' + hhmm(los) + "</span>" +
          '<span class="tb-plan-an num">an ' + hhmm(an) + "</span>" +
          '<span class="tb-plan-s">' + text + "</span></div>";
      }).join("") + "</div>";
  }

  function arbeitsKarte(s, ab) {
    if (!ab.dep) {
      return '<div class="tb-card tb-bahn">' +
        '<div class="tb-eyebrow">Arbeitsweg</div>' +
        '<div class="tb-big num">' + hhmm(ab.losMs) + "</div>" +
        '<div class="tb-line">Spätestens dann los' + (ab.linie ? " – mit der " + esc(ab.linie) : "") + "</div></div>";
    }
    const d = ab.dep;
    const inMin = Math.max(0, Math.round((d.leaveByMs - Date.now()) / 60000));
    return '<div class="tb-card tb-bahn">' +
      '<div class="tb-eyebrow">Bahn zur Arbeit</div>' +
      '<div class="tb-bahn-main">' + badge(d.line, d.color, d.textColor) + '<span class="tb-big num">' + esc(d.clock) + "</span></div>" +
      '<div class="tb-bahn-dest">→ ' + esc(zielText(d.dest)) + "</div>" +
      (inMin <= 4 ? '<div class="tb-pill' + (inMin <= 1 ? " is-now" : " is-soon") + '">' + (inMin <= 1 ? "jetzt los" : "in " + inMin + " min los") + "</div>" : "") +
      '<div class="tb-line tb-bahn-sum">Los um ' + hhmm(d.leaveByMs) + " · Arbeit ca. " + hhmm(ab.ankunftMs) + (ab.spaet ? " (zu spät)" : "") + "</div>" +
      fahrplanHtml(ab.alle, d, ab.ptMin, s.walkMinutes || 0, startOfDay(new Date())) +
      "</div>";
  }

  function freiBahnKarte(deps) {
    return '<div class="tb-card tb-bahn"><div class="tb-eyebrow">Nächste Bahnen</div><div class="tb-abf">' +
      deps.map(function (d) {
        const inMin = Math.max(0, Math.round((d.whenMs - Date.now()) / 60000));
        return '<div class="tb-abf-row">' + badge(d.line, d.color, d.textColor) +
          '<span class="tb-abf-dest">' + esc(zielText(d.dest)) + "</span>" +
          '<span class="tb-abf-in num">' + (inMin < 1 ? "jetzt" : inMin + " min") + "</span></div>";
      }).join("") + "</div></div>";
  }

  function bahnKarte(s, m, tag) {
    if (m === "heute") {
      const frei = freierTag(tag);
      // Arbeitstag vor Arbeitsbeginn: die Bahn zur Arbeit statt irgendeiner
      // nächsten Bahn – gleiche Rechnung wie der Morgengruß.
      const ab = !frei && typeof arbeitsBahnHeute === "function" ? arbeitsBahnHeute() : null;
      if (ab) return arbeitsKarte(s, ab);
      const naechste = (s.departures || []).filter(function (d) { return d.leaveByMs && d.leaveByMs >= Date.now() - 60000; });
      // Freier Tag: keine Dringlichkeit ("jetzt los" in Rot um 06:40 am
      // Samstag ist nur Unruhe) – die nächsten Bahnen als ruhige Liste.
      if (frei) return naechste.length ? freiBahnKarte(naechste.slice(0, 4)) : "";
      const dep = naechste[0];
      if (!dep) return "";
      const inMin = Math.max(0, Math.round((dep.leaveByMs - Date.now()) / 60000));
      let arbeit = "";
      const arbeitsLinie = typeof lastCommuteFirstLine !== "undefined" ? lastCommuteFirstLine : null;
      if (!frei && s.commutePtMinutes != null && dep.whenMs && (!arbeitsLinie || istArbeitsBahn(dep.line, dep.dest))) {
        arbeit = '<div class="tb-line">Bei der Arbeit ca. ' + hhmm(dep.whenMs + s.commutePtMinutes * 60000) + "</div>";
      }
      return '<div class="tb-card tb-bahn">' +
        '<div class="tb-eyebrow">Nächste Bahn</div>' +
        '<div class="tb-bahn-main">' + badge(dep.line, dep.color, dep.textColor) + '<span class="tb-big num">' + esc(dep.clock) + "</span></div>" +
        '<div class="tb-bahn-dest">→ ' + esc(zielText(dep.dest)) + "</div>" +
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
    const ab = morgen.deps.filter(function (d) { return d.whenMs - walk * 60000 >= los.getTime() - 3 * 60000; });
    // Bevorzugt die Bahn des Arbeitswegs (Linie + Richtung).
    const istArbeit = function (d) {
      return typeof istArbeitsBahn === "function" && typeof lastCommuteFirstLine !== "undefined" && lastCommuteFirstLine && istArbeitsBahn(d.line, d.dest);
    };
    const dep = ab.filter(istArbeit)[0] || ab[0];
    if (!dep) return "";
    return '<div class="tb-card tb-bahn">' +
      '<div class="tb-eyebrow">Bahn morgen früh</div>' +
      '<div class="tb-bahn-main">' + badge(dep.line, dep.color, dep.textColor) + '<span class="tb-big num">' + hhmm(dep.whenMs) + "</span></div>" +
      '<div class="tb-bahn-dest">→ ' + esc(zielText(dep.dest)) + "</div>" +
      '<div class="tb-line tb-bahn-sum">Los um ' + hhmm(dep.whenMs - walk * 60000) + (s.commutePtMinutes != null ? " · Arbeit ca. " + hhmm(dep.whenMs + s.commutePtMinutes * 60000) : "") + "</div>" +
      fahrplanHtml(morgen.deps.filter(istArbeit), dep, s.commutePtMinutes, walk, tag) +
      "</div>";
  }

  // Erste Abfahrten morgen ab der gewohnten Losgehzeit (eigener Abruf mit
  // Uhrzeit, höchstens alle 30 Minuten, mit Zeitdeckel).
  function holeBahnMorgen(tag) {
    holeAbfahrten(morgen, String(tag.getTime()), losgehzeit(tag).getTime() - 15 * 60000);
  }

  // Abfahrten ab einem Zeitpunkt (Losgehen; die Gehzeit wird
  // aufgeschlagen) in einen Speicher (morgen / frueh) holen.
  function holeAbfahrten(ziel, key, abMs) {
    if (ziel.laedt || (ziel.fuer === key && Date.now() - ziel.stand < 30 * 60 * 1000)) return;
    if (typeof resolvedStopIds === "undefined" || !resolvedStopIds || !resolvedStopIds.length) return;
    ziel.laedt = true;
    const walk = typeof walkMinutesToStop !== "undefined" && walkMinutesToStop != null ? walkMinutesToStop : 0;
    const t = new Date(abMs + walk * 60000).toISOString();
    const abrufe = resolvedStopIds.map(function (id) {
      const url = API_BASE + "/v6/stoptimes?stopId=" + encodeURIComponent(id) + "&n=40&time=" + encodeURIComponent(t);
      return Promise.race([
        fetch(url).then(function (r) { return r.ok ? r.json() : { stopTimes: [] }; }),
        new Promise(function (resolve) { setTimeout(function () { resolve({ stopTimes: [] }); }, 10000); }),
      ]).catch(function () { return { stopTimes: [] }; });
    });
    Promise.all(abrufe).then(function (res) {
      const alle = [];
      res.forEach(function (r) { (r.stopTimes || []).forEach(function (d) { alle.push(d); }); });
      ziel.deps = alle.filter(function (d) {
        return !d.cancelled && !d.tripCancelled && (typeof passesDirectionFilter !== "function" || passesDirectionFilter(d.headsign || ""));
      }).map(function (d) {
        const p = d.place || {};
        return {
          line: d.routeShortName || d.tripShortName || d.displayName || "?",
          dest: d.headsign || "",
          whenMs: new Date(p.departure || p.scheduledDeparture).getTime(),
          color: d.routeColor || null,
          textColor: d.routeTextColor || null,
        };
      }).sort(function (a, b) { return a.whenMs - b.whenMs; });
      ziel.fuer = key;
      ziel.stand = Date.now();
      ziel.laedt = false;
      render();
    });
  }

  // Für arbeitsBahnHeute (app.js): Abfahrten heute ab abMs (Losgehen).
  // Liefert die schon geholten (oder null) und holt bei Bedarf neu.
  function bahnenAb(abMs) {
    const key = String(Math.floor(abMs / (15 * 60000)));
    holeAbfahrten(frueh, key, abMs);
    return frueh.fuer === key ? frueh.deps : null;
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
    // Wo brennt Licht? Räume mit Lampenzahl, hellste Räume zuerst.
    const raeume = HA.model().rooms.map(function (r) {
      return { name: r.name, an: HA.roomSummary(r).lightsOn };
    }).filter(function (r) { return r.an > 0; }).sort(function (a, b) { return b.an - a.an; });
    const hinweise = window.TafelHAUI ? TafelHAUI.hints().filter(function (h) { return h.prio <= 2 && !h.vorschlag; }) : [];
    return '<div class="tb-card tb-zuhause"><div class="tb-eyebrow">Zuhause</div>' +
      '<div class="tb-mid">' + esc(an ? an + (an === 1 ? " Licht an" : " Lichter an") : "Alle Lichter aus") + "</div>" +
      (raeume.length ? '<div class="tb-raeume">' + raeume.slice(0, 4).map(function (r) {
        return '<div class="tb-raum"><span class="tb-raum-dot"></span><span class="tb-raum-n">' + esc(r.name) + '</span><span class="tb-raum-z num">' + r.an + "</span></div>";
      }).join("") + "</div>" : "") +
      hinweise.slice(0, 2).map(function (h) { return '<div class="tb-line is-hinweis">' + esc(h.text) + "</div>"; }).join("") +
      "</div>";
  }

  // ---------- Amtliche Warnung (warnungen.js) ----------
  // Als Streifen über den Karten statt als eigene Karte: Die Karte war zu
  // zwei Dritteln leer und nahm der Bahn zur Arbeit den Fahrplan weg.
  // Dafür steht hier alles, was man morgens wissen muss: wann, wie stark,
  // was tun – und das Hinweisband unten wiederholt sie auf diesem Panel nicht.
  function schoen(t) {
    return String(t || "").toLowerCase().replace(/(^|\s|-)(\S)/g, function (x, a, b) { return a + b.toUpperCase(); });
  }

  function warnZeit(a) {
    const on = Date.parse(a.onset || a.effective);
    const ex = Date.parse(a.expires);
    const heute = startOfDay(new Date()).getTime();
    const tagWort = function (ms) {
      const t = startOfDay(new Date(ms)).getTime();
      if (t === heute) return "heute";
      if (t === addDays(new Date(heute), 1).getTime()) return "morgen";
      return new Date(ms).toLocaleDateString("de-DE", { weekday: "short" });
    };
    const uhr = function (ms) {
      const d = new Date(ms);
      return d.getHours() + (d.getMinutes() ? ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes() : "");
    };
    if (isFinite(on) && on > Date.now()) {
      if (!isFinite(ex)) return "ab " + tagWort(on) + " " + uhr(on) + " Uhr";
      return tagWort(on) === tagWort(ex)
        ? tagWort(on) + " " + uhr(on) + "–" + uhr(ex) + " Uhr"
        : tagWort(on) + " " + uhr(on) + " Uhr bis " + tagWort(ex) + " " + uhr(ex) + " Uhr";
    }
    if (!isFinite(ex)) return "jetzt";
    return "bis " + (tagWort(ex) === "heute" ? "" : tagWort(ex) + " ") + uhr(ex) + " Uhr";
  }

  // "Es treten Windböen mit Geschwindigkeiten um 55 km/h (15 m/s, 30 kn,
  // Bft 7) aus südwestlicher Richtung auf." → "Windböen um 55 km/h aus
  // südwestlicher Richtung"; dazu die erste Handlungsempfehlung des DWD.
  function warnText(a, name) {
    const saetze = String(a.description_de || "").split(/\.\s+(?=[A-ZÄÖÜ])/);
    let text = "";
    for (let i = 0; i < saetze.length && i < 2 && text.length < 30; i++) {
      let t = saetze[i].replace(/\s*\([^)]*\)/g, "").replace(/\.\s*$/, "").trim();
      const m = /^Es (?:tritt|treten) (.+) auf$/.exec(t);
      if (m) t = m[1].charAt(0).toUpperCase() + m[1].slice(1);
      t = t.replace(/ mit Geschwindigkeiten /, " ");
      if (t) text += (text ? ". " : "") + t;
    }
    // Steht schon fett davor: "Orkanartige Böen zwischen 100 und …" →
    // "Zwischen 100 und …".
    const lower = name.toLowerCase() + " ";
    if (text.toLowerCase().indexOf(lower) === 0) text = text.charAt(lower.length).toUpperCase() + text.slice(lower.length + 1);
    const r = /Handlungsempfehlungen:\s*([^;\n]+)/.exec(String(a.instruction_de || ""));
    const rat = r ? r[1].trim().replace(/\.$/, "") : "";
    return [text, rat ? rat.charAt(0).toUpperCase() + rat.slice(1) : ""].filter(function (x) { return !!x; }).join(". ") + (text || rat ? "." : "");
  }

  function warnStreifen() {
    if (!window.TafelWarn) return "";
    const a = TafelWarn.aktuelle()[0];
    if (!a) return "";
    const stufe = TafelWarn.stufe(a);
    const name = schoen(a.event_de || a.event_en || "Warnung");
    const text = warnText(a, name);
    return '<div class="tb-warnstreifen stufe-' + stufe + '">' +
      '<span class="tb-warn-ico"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9 16H3z"/><path d="M12 10v4.3M12 17.2v.3"/></svg></span>' +
      '<div class="tb-warn-text"><div class="tb-warn-kopf">' +
      '<span class="tb-warn-name">' + esc(name) + "</span>" +
      '<span class="tb-warn-zeit">' + esc(warnZeit(a)) + "</span>" +
      '<span class="tb-warn-quelle">' + (stufe >= 3 ? "Unwetter" : "DWD") + " · Stufe " + stufe + "</span></div>" +
      (text ? '<div class="tb-warn-rat">' + esc(text) + "</div>" : "") +
      "</div></div>";
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

    const streifen = warnStreifen();
    warnImPanel(!!streifen);
    const karten = [wetterKarte(s, m, tag), bahnKarte(s, m, tag), terminKarte(s, m, tag), muellKarte(s, m, tag), zuhauseKarte()]
      .filter(function (k) { return !!k; })
      .slice(0, 5); // mehr passt nicht lesbar auf 1024×768 (Reihenfolge = Wichtigkeit)
    // Ohne Wetterkarte übernimmt die erste Karte deren hohen Platz links.
    const mitWetter = karten.length && karten[0].indexOf("tb-wetter") !== -1;
    const html = '<div class="tb-head"><div class="tb-title">' + esc(kopf) + '</div><div class="tb-sub">' + esc(datum) + "</div></div>" + streifen +
      '<div class="tb-grid n-' + karten.length + (mitWetter ? "" : " kein-wetter") + '">' + karten.join("") + "</div>";
    // Höhe gehört zum Vergleich: kommt die Hinweiszeile unten dazu oder
    // geht sie, wird neu gezeichnet und neu eingepasst.
    const key = html + "|" + bodyEl.clientHeight;
    if (bodyEl._html !== key) {
      bodyEl._html = key;
      bodyEl.innerHTML = html;
      einpassen();
    }
  }

  // Steht die Warnung als Streifen im Panel, blendet das Hinweisband sie
  // aus (app.js updateHintBar, style.css .warn-im-panel) – vor dem Messen
  // der Höhe, damit gleich mit dem gewonnenen Platz eingepasst wird.
  function warnImPanel(an) {
    const shell = document.querySelector(".panel");
    const soll = !!(an && panel && panel.classList.contains("active"));
    if (!shell || shell.classList.contains("warn-im-panel") === soll) return;
    shell.classList.toggle("warn-im-panel", soll);
    if (typeof updateHintBar === "function") updateHintBar();
  }

  // Nur sichtbare Kandidaten (per CSS ausgeblendete Zeilen zählen nicht).
  function letztes(el, sel) {
    const alle = el.querySelectorAll(sel);
    for (let i = alle.length - 1; i >= 0; i--) if (alle[i].offsetHeight) return alle[i];
    return null;
  }

  function erstes(el, sel) {
    const alle = el.querySelectorAll(sel);
    for (let i = 0; i < alle.length; i++) if (alle[i].offsetHeight) return alle[i];
    return null;
  }

  // Jede Karte so kürzen, dass nichts unten abgeschnitten wird (Hinweis-
  // zeile, lange Termine, 5 Karten): zuerst die Bahn davor, dann von
  // hinten Fahrplan-, Stunden- und Raumzeilen. Nur sichtbar messbar.
  function einpassen() {
    if (!bodyEl.clientHeight) return;
    const karten = bodyEl.querySelectorAll(".tb-card");
    for (let k = 0; k < karten.length; k++) {
      const karte = karten[k];
      for (let n = 0; n < 12 && karte.scrollHeight > karte.clientHeight + 1; n++) {
        // Die Zusammenfassung "Los um … · Arbeit ca. …" steht auch in der
        // markierten Fahrplanzeile – lieber sie opfern als die nächste Bahn.
        const sum = erstes(karte, ".tb-plan-row.is-pick") && erstes(karte, ".tb-plan-row.is-nach-1") ? erstes(karte, ".tb-bahn-sum") : null;
        const weg = erstes(karte, ".tb-plan-row.is-vor") || letztes(karte, ".tb-plan-row.is-nach-3, .tb-plan-row.is-nach-2") ||
          letztes(karte, ".tb-hour") || sum || letztes(karte, ".tb-plan-row:not(.is-pick)") || letztes(karte, ".tb-raum") || letztes(karte, ".tb-abf-row") || erstes(karte, ".tb-plan");
        if (!weg) break;
        weg.parentNode.removeChild(weg);
      }
    }
  }

  function onPanelShown(name) {
    if (name === "tagesblick") {
      render();
      if (!ticker) ticker = setInterval(render, 20 * 1000);
    } else {
      warnImPanel(false);
      if (ticker) {
        clearInterval(ticker);
        ticker = null;
      }
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
    bahnenAb: bahnenAb,
  };
})();
