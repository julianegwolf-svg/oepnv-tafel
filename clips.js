// ---------------------------------------------------------------
// clips.js — bewegte Bilder auf der Tafel (AUSBAU Abschnitt 5)
//
// 1. Regenradar im Wetter-Panel: die letzten ~2 Stunden Niederschlag als
//    flüssige Bildfolge über einer dunklen Karte rund um Zuhause.
//    Quelle: RainViewer (schlüsselfrei, CORS *), Karte: Esri "Dark Gray
//    Canvas" (schlüsselfrei; CARTO verlangt inzwischen einen API-Schlüssel).
//    Nur wenn Regen relevant ist (es regnet oder kommt in den nächsten
//    3 Stunden), nur solange das Wetter-Panel sichtbar ist. Speicher: zwei
//    Bildebenen à 4 Kacheln — die übrigen Bilder liegen nur im HTTP-Cache.
//
// 2. "tagesschau in 100 Sekunden" als eigenes Panel morgens und abends:
//    stumm, mit Titelzeile. Safari 12: H.264-MP4, muted + playsinline.
//    Immer nur EIN Video-Element; beim Verlassen src leeren und entfernen.
//
// Nur ES2017 (Safari 12).
// ---------------------------------------------------------------
(function () {
  "use strict";

  const CFG = (typeof CONFIG !== "undefined" && CONFIG.clips) ? CONFIG.clips : {};

  // ---------- Kartenrechnung (Web-Mercator) ----------
  const ZOOM = 7;
  function tileXY(lat, lon, z) {
    const n = Math.pow(2, z);
    const x = (lon + 180) / 360 * n;
    const r = lat * Math.PI / 180;
    const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
    return { x: x, y: y };
  }

  // ---------- Regenradar ----------
  const radar = {
    el: null,
    frames: [],
    framesAt: 0,
    loading: false,
    timer: null,
    index: 0,
    layer: 0,
    active: false,
  };

  function radarRelevant() {
    const mode = CFG.regenradar || "auto";
    if (mode === "aus") return false;
    if (mode === "immer") return true;
    // rainStartMinutes (app.js): Minuten bis Regen laut Open-Meteo, ≤0 = regnet.
    return typeof rainStartMinutes !== "undefined" && rainStartMinutes != null && rainStartMinutes <= 180;
  }

  function fetchFrames() {
    if (radar.loading || Date.now() - radar.framesAt < 5 * 60 * 1000) return Promise.resolve(radar.frames);
    radar.loading = true;
    return new Promise(function (resolve) {
      let done = false;
      const timer = setTimeout(function () { if (!done) { done = true; radar.loading = false; resolve(radar.frames); } }, 10000);
      fetch("https://api.rainviewer.com/public/weather-maps.json", { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const past = (d && d.radar && d.radar.past) || [];
          const now = (d && d.radar && d.radar.nowcast) || [];
          radar.frames = past.concat(now).slice(-14).map(function (f) {
            return { time: f.time * 1000, url: (d.host || "https://tilecache.rainviewer.com") + f.path };
          });
          radar.framesAt = Date.now();
          radar.loading = false;
          resolve(radar.frames);
        })
        .catch(function () {
          if (done) return;
          done = true;
          clearTimeout(timer);
          radar.loading = false;
          resolve(radar.frames);
        });
    });
  }

  function radarGeometry() {
    const lat = (typeof CONFIG !== "undefined" && CONFIG.weatherLat) || 53.073;
    const lon = (typeof CONFIG !== "undefined" && CONFIG.weatherLon) || 8.887;
    const t = tileXY(lat, lon, ZOOM);
    // 2×2 Kacheln so wählen, dass Zuhause möglichst mittig liegt.
    const x0 = Math.floor(t.x - 0.5);
    const y0 = Math.floor(t.y - 0.5);
    return { x0: x0, y0: y0, hx: (t.x - x0) * 256, hy: (t.y - y0) * 256 };
  }

  function mapTileUrl(x, y) {
    const tpl = CFG.karte || "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
    return tpl.replace("{z}", ZOOM).replace("{x}", x).replace("{y}", y);
  }

  function buildRadar(panel) {
    const g = radarGeometry();
    const W = 400;
    const H = 330;
    const left = Math.round(Math.min(0, Math.max(W - 512, W / 2 - g.hx)));
    const top = Math.round(Math.min(0, Math.max(H - 512, H / 2 - g.hy)));
    const el = document.createElement("div");
    el.className = "clip-radar";
    let html = '<div class="clip-radar-map" style="left:' + left + "px;top:" + top + 'px">';
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        html += '<img class="clip-radar-tile" alt="" style="left:' + dx * 256 + "px;top:" + dy * 256 + 'px" src="' + mapTileUrl(g.x0 + dx, g.y0 + dy) + '">';
      }
    }
    for (let L = 0; L < 2; L++) {
      html += '<div class="clip-radar-layer" data-layer="' + L + '">';
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          html += '<img class="clip-radar-tile" alt="" style="left:' + dx * 256 + "px;top:" + dy * 256 + 'px">';
        }
      }
      html += "</div>";
    }
    html += '<span class="clip-radar-home" style="left:' + Math.round(g.hx) + "px;top:" + Math.round(g.hy) + 'px"></span>';
    html += "</div>" +
      '<div class="clip-radar-label"><span class="clip-radar-title">Regenradar</span><span class="clip-radar-time" id="clipRadarTime"></span></div>' +
      '<div class="clip-radar-credit">Radar: RainViewer · Karte: Esri, OpenStreetMap</div>' +
      '<div class="clip-radar-steps" id="clipRadarSteps"></div>';
    el.innerHTML = html;
    panel.appendChild(el);
    radar.el = el;
    radar.geo = g;
  }

  function frameTiles(frame) {
    const g = radar.geo;
    const out = [];
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        // 256er-Kacheln, Farbschema 4, geglättet + Schnee.
        out.push(frame.url + "/256/" + ZOOM + "/" + (g.x0 + dx) + "/" + (g.y0 + dy) + "/4/1_1.png");
      }
    }
    return out;
  }

  // Alter relativ zum neuesten Radarbild (das ist "jetzt") — unabhängig
  // von der Geräteuhr bzw. dem Zeit-Debug-Parameter.
  function fmtAge(t) {
    const newest = radar.frames.length ? radar.frames[radar.frames.length - 1].time : t;
    const min = Math.round((newest - t) / 60000);
    if (min <= 5) return "jetzt";
    if (min < 60) return "vor " + min + " Min";
    const h = Math.floor(min / 60);
    const m = min % 60;
    return "vor " + h + " Std" + (m >= 10 ? " " + m + " Min" : "");
  }

  // Nächstes Bild in die verdeckte Ebene laden; erst wenn alle 4 Kacheln
  // da sind, überblenden (keine halben Bilder).
  function showFrame(i) {
    if (!radar.active || !radar.el || !radar.frames.length) return;
    const frame = radar.frames[i];
    const next = 1 - radar.layer;
    const layerEl = radar.el.querySelector('.clip-radar-layer[data-layer="' + next + '"]');
    const imgs = layerEl.querySelectorAll("img");
    const urls = frameTiles(frame);
    let pending = imgs.length;
    let finished = false;
    const finish = function () {
      if (finished || !radar.active) return;
      finished = true;
      layerEl.classList.add("is-shown");
      const old = radar.el.querySelector('.clip-radar-layer[data-layer="' + radar.layer + '"]');
      if (old) old.classList.remove("is-shown");
      radar.layer = next;
      const t = document.getElementById("clipRadarTime");
      if (t) t.textContent = fmtAge(frame.time);
      const steps = document.getElementById("clipRadarSteps");
      if (steps) steps.style.transform = "scaleX(" + ((i + 1) / radar.frames.length).toFixed(3) + ")";
      const last = i === radar.frames.length - 1;
      radar.timer = setTimeout(function () {
        radar.index = last ? 0 : i + 1;
        showFrame(radar.index);
      }, last ? 2600 : 650);
    };
    for (let k = 0; k < imgs.length; k++) {
      imgs[k].onload = imgs[k].onerror = function () {
        this.onload = this.onerror = null;
        pending--;
        if (pending <= 0) finish();
      };
      imgs[k].src = urls[k];
    }
    // Sicherheitsnetz: langsame Kachel hält die Schleife nicht an.
    setTimeout(finish, 4000);
  }

  function radarShow() {
    const panel = document.getElementById("panel-weather");
    if (!panel || !radarRelevant()) { radarHide(); return; }
    radar.active = true;
    fetchFrames().then(function (frames) {
      if (!radar.active || !frames.length) return;
      if (!radar.el) buildRadar(panel);
      void radar.el.offsetWidth;
      radar.el.classList.add("is-shown");
      panel.classList.add("has-radar");
      radar.index = Math.max(0, frames.length - 8);
      if (radar.timer) clearTimeout(radar.timer);
      showFrame(radar.index);
    });
  }

  function radarHide() {
    radar.active = false;
    const wp = document.getElementById("panel-weather");
    if (wp) wp.classList.remove("has-radar");
    if (radar.timer) { clearTimeout(radar.timer); radar.timer = null; }
    if (!radar.el) return;
    // Bilder sofort freigeben, Element nach dem Ausblenden entfernen.
    const imgs = radar.el.querySelectorAll("img");
    for (let i = 0; i < imgs.length; i++) {
      imgs[i].onload = imgs[i].onerror = null;
      imgs[i].removeAttribute("src");
    }
    if (radar.el.parentNode) radar.el.parentNode.removeChild(radar.el);
    radar.el = null;
  }

  // ---------- tagesschau in 100 Sekunden ----------
  const ts = {
    item: null,
    fetchedAt: 0,
    loading: false,
    video: null,
  };

  function videoWindow() {
    const h = new Date().getHours();
    return (h >= 6 && h < 10) || (h >= 18 && h < 23);
  }

  function fetchTagesschau() {
    if (ts.loading || Date.now() - ts.fetchedAt < 20 * 60 * 1000) return;
    ts.loading = true;
    let done = false;
    const timer = setTimeout(function () { if (!done) { done = true; ts.loading = false; } }, 10000);
    fetch("https://www.tagesschau.de/api2u/channels", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ts.loading = false;
        ts.fetchedAt = Date.now();
        const c = ((d && d.channels) || []).filter(function (x) { return /100 Sekunden/i.test(x.title || ""); })[0];
        const st = c && c.streams ? c.streams : null;
        const url = st ? (st.h264m || st.h264s) : null;
        const date = c ? Date.parse(c.date) : NaN;
        ts.item = url && isFinite(date) ? { url: url, date: date, title: c.title, poster: c.teaserImage && c.teaserImage.imageVariants ? c.teaserImage.imageVariants["16x9-960"] : null } : null;
      })
      .catch(function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ts.loading = false;
        ts.fetchedAt = Date.now() - 15 * 60 * 1000;
      });
  }

  function tagesschauAvailable() {
    if (CFG.tagesschau === false) return false;
    if (!videoWindow()) return false;
    fetchTagesschau();
    return !!(ts.item && Date.now() - ts.item.date < 14 * 3600 * 1000);
  }

  function tsShow() {
    const panel = document.getElementById("panel-tagesschau");
    if (!panel || !ts.item) return;
    tsHide();
    const box = panel.querySelector(".clip-video-box");
    const v = document.createElement("video");
    v.className = "clip-video";
    v.muted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.setAttribute("preload", "auto");
    if (ts.item.poster) v.setAttribute("poster", ts.item.poster);
    v.src = ts.item.url;
    box.appendChild(v);
    ts.video = v;
    const label = panel.querySelector(".clip-video-date");
    if (label) {
      const d = new Date(ts.item.date);
      label.textContent = "vom " + d.toLocaleDateString("de-DE", { weekday: "long" }) + ", " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
    }
    const bar = panel.querySelector(".clip-video-progress");
    v.addEventListener("timeupdate", function () {
      if (bar && v.duration) bar.style.transform = "scaleX(" + (v.currentTime / v.duration).toFixed(3) + ")";
    });
    const p = v.play();
    if (p && p.catch) p.catch(function () { /* Autoplay verweigert: Standbild bleibt */ });
  }

  function tsHide() {
    if (!ts.video) return;
    const v = ts.video;
    ts.video = null;
    try { v.pause(); } catch (e) { /* egal */ }
    v.removeAttribute("src");
    try { v.load(); } catch (e) { /* egal */ }
    if (v.parentNode) v.parentNode.removeChild(v);
  }

  // ---------- Anbindung an app.js ----------
  function onPanelShown(name) {
    if (name === "weather") radarShow(); else radarHide();
    if (name === "tagesschau") tsShow(); else tsHide();
  }

  function init() {
    if (CFG.tagesschau !== false) {
      fetchTagesschau();
      setInterval(function () { if (videoWindow()) fetchTagesschau(); }, 30 * 60 * 1000);
    }
  }

  window.TafelClips = {
    init: init,
    onPanelShown: onPanelShown,
    tagesschauAvailable: tagesschauAvailable,
    radarRelevant: radarRelevant,
    debug: function () {
      return {
        radarAktiv: radar.active,
        radarBilder: radar.el ? radar.el.querySelectorAll("img[src]").length : 0,
        videos: document.getElementsByTagName("video").length,
        frames: radar.frames.length,
        tagesschau: ts.item ? ts.item.url : null,
      };
    },
  };
})();
