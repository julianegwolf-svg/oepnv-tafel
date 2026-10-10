// ---------------------------------------------------------------
// warnungen.js — amtliche Unwetterwarnungen des DWD (AUSBAU D16)
//
// Quelle: Bright Sky (api.brightsky.dev/alerts, schlüsselfrei, CORS *),
// die DWD-Warnungen für die Warnzelle am Wohnort. Erscheinen als Chip in
// der Hinweiszeile auf allen Panels — auch ohne Home Assistant:
// Stufe 1 (minor) ruhig in Bernstein, ab Stufe 2 rot mit kurzem Puls.
// Antippen zeigt Überschrift, Beschreibung und DWD-Handlungsempfehlung.
//
// Dazu Umweltwerte (AUSBAU D18) aus Open-Meteo Air Quality (schlüsselfrei,
// CORS *): UV-Index, Luftqualität (EAQI) und Pollen — als ruhiger Chip
// NUR, wenn es relevant ist (UV ≥ 6 tagsüber, EAQI ≥ 60, Pollen stark).
//
// Alle 15 Minuten (Umwelt stündlich), 10-s-Zeitdeckel; bei Fehler bleibt
// der letzte Stand.
// Nur ES2017 (Safari 12).
// ---------------------------------------------------------------
(function () {
  "use strict";

  const CFG = (typeof CONFIG !== "undefined" && CONFIG.warnungen) ? CONFIG.warnungen : {};
  let alerts = [];
  let umwelt = null;
  let box = null;
  let detail = null;

  const STUFE = { minor: 1, moderate: 2, severe: 3, extreme: 4 };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // "ORKANARTIGE BÖEN" → "Orkanartige Böen"
  function schoen(t) {
    return String(t || "").toLowerCase().replace(/(^|\s|-)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
  }

  function uhr(ms) {
    const d = new Date(ms);
    const heute = new Date();
    const tag = d.getDate() === heute.getDate() ? "" : (d.getDate() === new Date(heute.getTime() + 86400000).getDate() ? "morgen " : d.toLocaleDateString("de-DE", { weekday: "short" }) + " ");
    return tag + d.getHours() + (d.getMinutes() ? ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes() : "") + " Uhr";
  }

  // Aktiv oder in den nächsten 12 Stunden, schwerste zuerst.
  function aktuelle() {
    const now = Date.now();
    return alerts.filter(function (a) {
      const on = Date.parse(a.onset || a.effective);
      const ex = Date.parse(a.expires);
      return (!isFinite(ex) || ex > now) && (!isFinite(on) || on < now + 12 * 3600 * 1000);
    }).sort(function (a, b) { return (STUFE[b.severity] || 0) - (STUFE[a.severity] || 0); });
  }

  function kurz(a) {
    const on = Date.parse(a.onset || a.effective);
    const ex = Date.parse(a.expires);
    const name = schoen(a.event_de || a.event_en || "Warnung");
    if (isFinite(on) && on > Date.now()) return name + " ab " + uhr(on);
    return name + (isFinite(ex) ? " bis " + uhr(ex) : "");
  }

  function holen() {
    const lat = (typeof CONFIG !== "undefined" && CONFIG.weatherLat) || 53.073;
    const lon = (typeof CONFIG !== "undefined" && CONFIG.weatherLon) || 8.887;
    let fertig = false;
    const timer = setTimeout(function () { fertig = true; }, 10000);
    fetch("https://api.brightsky.dev/alerts?lat=" + lat + "&lon=" + lon, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        if (fertig) return;
        fertig = true;
        clearTimeout(timer);
        alerts = (d && d.alerts ? d.alerts : []).slice(0, 10);
        render();
      })
      .catch(function () { if (!fertig) { fertig = true; clearTimeout(timer); } });
  }

  // ---------- Umweltwerte (D18) ----------
  const POLLEN = {
    alder_pollen: { name: "Erlenpollen", stark: 100 },
    birch_pollen: { name: "Birkenpollen", stark: 100 },
    grass_pollen: { name: "Gräserpollen", stark: 50 },
    mugwort_pollen: { name: "Beifußpollen", stark: 50 },
    ragweed_pollen: { name: "Ambrosiapollen", stark: 20 },
  };

  function holeUmwelt() {
    if (CFG.umwelt === false) return;
    const lat = (typeof CONFIG !== "undefined" && CONFIG.weatherLat) || 53.073;
    const lon = (typeof CONFIG !== "undefined" && CONFIG.weatherLon) || 8.887;
    let fertig = false;
    const timer = setTimeout(function () { fertig = true; }, 10000);
    fetch("https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + lat + "&longitude=" + lon +
      "&current=european_aqi,uv_index," + Object.keys(POLLEN).join(",") +
      "&hourly=uv_index&forecast_days=1&timezone=Europe%2FBerlin", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        if (fertig) return;
        fertig = true;
        clearTimeout(timer);
        const uvs = (d.hourly && d.hourly.uv_index) || [];
        let uvMax = 0;
        uvs.forEach(function (v) { if (v != null && v > uvMax) uvMax = v; });
        umwelt = { aqi: d.current ? d.current.european_aqi : null, uvJetzt: d.current ? d.current.uv_index : null, uvMax: uvMax, pollen: d.current || {} };
        render();
      })
      .catch(function () { if (!fertig) { fertig = true; clearTimeout(timer); } });
  }

  // Liefert höchstens zwei relevante Umwelt-Hinweise {text, stark}.
  function umweltHinweise() {
    if (!umwelt) return [];
    const out = [];
    const h = new Date().getHours();
    if (umwelt.aqi != null && umwelt.aqi >= 60) {
      out.push({ text: "Luft " + (umwelt.aqi >= 80 ? "sehr schlecht" : "schlecht") + " (Index " + Math.round(umwelt.aqi) + ") – lieber nicht lüften", stark: umwelt.aqi >= 80 });
    }
    if (h >= 9 && h < 17 && umwelt.uvMax >= 6) {
      out.push({ text: "UV " + Math.round(umwelt.uvMax) + " heute – " + (umwelt.uvMax >= 8 ? "sehr hoch, Sonnenschutz" : "Sonnenschutz"), stark: umwelt.uvMax >= 8 });
    }
    Object.keys(POLLEN).forEach(function (k) {
      const v = umwelt.pollen[k];
      if (v != null && v >= POLLEN[k].stark) out.push({ text: POLLEN[k].name + " stark", stark: false });
    });
    return out.slice(0, 2);
  }

  function render() {
    if (!box) {
      const bar = document.querySelector(".statusbar");
      if (!bar) return;
      box = document.createElement("div");
      box.className = "warn-hints";
      box.id = "warnHints";
      // Vor den HA-Hinweisen: amtliche Warnungen haben Vorrang.
      const ha = document.getElementById("haHints");
      bar.insertBefore(box, ha || null);
      box.addEventListener("click", function (ev) {
        const b = ev.target.closest ? ev.target.closest("[data-warn]") : null;
        if (!b) return;
        ev.stopPropagation();
        zeigeDetail(parseInt(b.getAttribute("data-warn"), 10));
      });
      bar.classList.add("has-ha-hints");
    }
    const liste = CFG.aktiv === false ? [] : aktuelle().slice(0, 2);
    const umweltChips = umweltHinweise().slice(0, Math.max(0, 2 - liste.length)).map(function (u) {
      return '<button type="button" class="ha-hint ' + (u.stark ? "is-p2" : "is-p3") + '" data-key="umwelt-' + esc(u.text) + '">' +
        '<svg class="ha-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>' +
        "<span>" + esc(u.text) + "</span></button>";
    }).join("");
    const html = liste.map(function (a, i) {
      const stufe = STUFE[a.severity] || 1;
      return '<button type="button" class="ha-hint ' + (stufe >= 2 ? "is-p1" : "is-p2") + '" data-key="dwd-' + esc(a.id) + '" data-warn="' + i + '">' +
        '<svg class="ha-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9 16H3z"/><path d="M12 10v4.3M12 17.2v.3"/></svg>' +
        "<span>" + esc((stufe >= 3 ? "Unwetter: " : "") + kurz(a)) + "</span></button>";
    }).join("") + umweltChips;
    if (box._html !== html) {
      box._html = html;
      box.innerHTML = html;
    }
    if (typeof updateHintBar === "function") updateHintBar();
  }

  function zeigeDetail(i) {
    const a = aktuelle()[i];
    if (!a) return;
    if (!detail) {
      detail = document.createElement("div");
      detail.className = "warn-detail";
      (document.querySelector(".panel") || document.body).appendChild(detail);
      detail.addEventListener("click", function (ev) {
        ev.stopPropagation();
        detail.classList.remove("is-open");
        if (typeof deferCarouselAdvance === "function") deferCarouselAdvance();
      });
    }
    const stufe = STUFE[a.severity] || 1;
    detail.innerHTML = '<div class="warn-card stufe-' + stufe + '">' +
      '<div class="warn-stufe">Warnstufe ' + stufe + " von 4 · DWD</div>" +
      '<div class="warn-title">' + esc(a.headline_de || a.headline_en || "") + "</div>" +
      '<div class="warn-zeit">' + esc(kurz(a)) + "</div>" +
      '<p class="warn-text">' + esc(a.description_de || a.description_en || "") + "</p>" +
      (a.instruction_de ? '<p class="warn-rat">' + esc(a.instruction_de) + "</p>" : "") +
      '<div class="warn-close">Tippen zum Schließen</div></div>';
    void detail.offsetWidth;
    detail.classList.add("is-open");
    if (typeof pauseCarouselIndefinitely === "function") pauseCarouselIndefinitely();
  }

  function init() {
    if (CFG.aktiv === false) return;
    holen();
    setInterval(holen, 15 * 60 * 1000);
    holeUmwelt();
    setInterval(holeUmwelt, 60 * 60 * 1000);
    // Zeitangaben ("bis 19 Uhr") und abgelaufene Warnungen minütlich prüfen.
    setInterval(render, 60 * 1000);
  }

  window.TafelWarn = {
    init: init,
    aktuelle: aktuelle,
    kurz: kurz,
    stufe: function (a) { return STUFE[a.severity] || 1; },
    umweltHinweise: umweltHinweise,
    // Nur für Tests/Belege: Umweltwerte setzen und neu zeichnen.
    _setUmwelt: function (u) { umwelt = u; render(); },
  };
})();
