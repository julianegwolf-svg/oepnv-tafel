// ---------------------------------------------------------------
// ha-panels.js — Home-Assistant-Anbindung der Tafel, Teil 2: Oberfläche
//
// Panels "Zuhause" (Räume), "Raumklima", "Medien", die Raumansicht
// (Licht/Szenen/Heizung/Medien je Raum), Schnellaktionen in der Kopfzeile,
// das Hinweisband unten links, der Einrichtungsdialog (lange auf die Uhr
// drücken) und die Reaktionen der Tafel auf HA (Bewegung weckt, niemand
// zu Hause → Ambient, Sprung bei Ereignissen).
//
// Alles wird erst gebaut, wenn Home Assistant eingerichtet ist — ohne
// Token/Adresse existiert davon nichts im DOM. Daten kommen aus ha.js
// (window.TafelHA). Nur ES2017, siehe Kopf von ha.js.
//
// Rendering: jede Kachel/Zeile wird als HTML-Text erzeugt und nur dann
// ins DOM geschrieben, wenn sich der Text geändert hat (billiger Vergleich
// statt Neuaufbau bei jedem Sensor-Zucken). Klicks laufen über Event-
// Delegation (data-act), dadurch gehen beim Ersetzen keine Listener verloren
// und es entstehen auch keine neuen.
// ---------------------------------------------------------------
(function () {
  "use strict";

  const HA = window.TafelHA;
  if (!HA) return;
  const CFG = HA.cfg || {};
  const REAKTION = CFG.reaktionen || {};

  // ---------- Kleinkram ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtNum(v, digits) {
    return v.toFixed(digits).replace(".", ",");
  }

  function fmtTemp(v) {
    return v == null ? "–" : fmtNum(v, 1) + "°";
  }

  function fmtWatt(v) {
    if (v == null) return "";
    return v >= 1000 ? fmtNum(v / 1000, 1) + " kW" : Math.round(v) + " W";
  }

  function fmtClock(ms) {
    const d = new Date(ms);
    return (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
  }

  function fmtSince(ms) {
    const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (min < 1) return "gerade eben";
    if (min < 60) return "seit " + min + " min";
    const h = Math.floor(min / 60);
    return "seit " + h + " Std.";
  }

  function fmtDuration(sec) {
    if (sec == null || !isFinite(sec)) return "";
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function changedAt(st) {
    if (!st) return Date.now();
    const t = Date.parse(st.last_changed || st.last_updated);
    return isFinite(t) ? t : Date.now();
  }

  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

  // Statt innerHTML komplett zu ersetzen, wird der neue HTML-Text mit dem
  // vorhandenen DOM abgeglichen ("Morphing"): gleiche Elemente bleiben
  // stehen, nur geänderte Attribute/Texte werden angepasst. Dadurch laufen
  // CSS-Übergänge (Lichtschein, Haken, Schalter) wirklich ab, und ein
  // gerade gezogener Schieberegler wird nicht unter dem Finger ersetzt.
  // Kinder mit data-key werden über den Schlüssel zugeordnet (neue
  // Hinweise blenden ein, statt dass alle nachrückenden neu entstehen).
  const morphBox = document.createElement("div");

  function setHtml(el, html) {
    if (!el) return;
    if (el._haHtml === html) return;
    el._haHtml = html;
    morphBox.innerHTML = html;
    morphChildren(el, morphBox);
    morphBox.innerHTML = "";
  }

  function sameNode(t, s) {
    if (t.nodeType !== s.nodeType || t.nodeName !== s.nodeName) return false;
    if (s.nodeType !== 1) return true;
    return t.getAttribute("data-key") === s.getAttribute("data-key");
  }

  function morphAttrs(t, s) {
    // Rollende Ziffer: Klasse nicht mitten in der Animation zurücksetzen.
    if (t.classList && t.classList.contains("ha-digit")) return;
    const sa = s.attributes;
    for (let i = 0; i < sa.length; i++) {
      if (t.getAttribute(sa[i].name) !== sa[i].value) t.setAttribute(sa[i].name, sa[i].value);
    }
    const ta = t.attributes;
    for (let i = ta.length - 1; i >= 0; i--) {
      if (!s.hasAttribute(ta[i].name)) t.removeAttribute(ta[i].name);
    }
  }

  function morphChildren(target, source) {
    const src = Array.prototype.slice.call(source.childNodes);
    const cur = Array.prototype.slice.call(target.childNodes);
    const keyed = {};
    let hasKeys = false;
    for (let i = 0; i < cur.length; i++) {
      const k = cur[i].nodeType === 1 ? cur[i].getAttribute("data-key") : null;
      if (k) { keyed[k] = cur[i]; hasKeys = true; }
    }
    const used = [];
    for (let i = 0; i < src.length; i++) {
      const s = src[i];
      const sk = s.nodeType === 1 ? s.getAttribute("data-key") : null;
      let t = null;
      if (sk && hasKeys) t = keyed[sk] && keyed[sk].nodeName === s.nodeName ? keyed[sk] : null;
      else if (cur[i] && used.indexOf(cur[i]) === -1 && sameNode(cur[i], s)) t = cur[i];
      const ref = target.childNodes[i] || null;
      if (!t) {
        target.insertBefore(s, ref);
        used.push(s);
        continue;
      }
      used.push(t);
      if (t !== ref) target.insertBefore(t, ref);
      if (dragging && t === dragging.el) continue;
      if (s.nodeType === 3 || s.nodeType === 8) {
        if (t.nodeValue !== s.nodeValue) {
          t.nodeValue = s.nodeValue;
          // Ziffern-Rollen: geänderte Stelle einmal von oben einrollen lassen.
          const p = t.parentNode;
          if (p && p.classList && p.classList.contains("ha-digit")) {
            p.classList.remove("is-rolling");
            void p.offsetWidth;
            p.classList.add("is-rolling");
          }
        }
        continue;
      }
      morphAttrs(t, s);
      morphChildren(t, s);
    }
    const rest = Array.prototype.slice.call(target.childNodes);
    for (let j = rest.length - 1; j >= 0; j--) {
      if (used.indexOf(rest[j]) === -1) target.removeChild(rest[j]);
    }
  }

  // Zahl/Text in einzelne Ziffern-Spans zerlegen (für das Rollen).
  function digits(text) {
    return String(text).split("").map(function (ch) {
      return /[0-9]/.test(ch) ? '<span class="ha-digit">' + ch + "</span>" : esc(ch);
    }).join("");
  }

  function mk(tag, cls, html) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  }

  // Eigene Linien-Icons (24er Raster, currentColor) statt Emoji: gleiche
  // Strichstärke überall, färbbar je Zustand, auf iOS 12 identisch.
  const ICONS = {
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/>',
    window: '<rect x="4.5" y="3" width="15" height="18" rx="1.5"/><path d="M12 3v18M4.5 12h15"/>',
    door: '<path d="M6 21V4.2c0-.7.5-1.2 1.2-1.2h9.6c.7 0 1.2.5 1.2 1.2V21"/><path d="M3.5 21h17"/><circle cx="14.6" cy="12" r="1" fill="currentColor" stroke="none"/>',
    flame: '<path d="M12 3c.8 3 4.5 4.8 4.5 9.3a4.5 4.5 0 0 1-9 0c0-2.1 1-3.4 2.1-4.4.1 1.9.9 3 2 3.2-.3-3 .4-5.7.4-8.1z"/>',
    drop: '<path d="M12 3.5s5.8 6.3 5.8 10.6a5.8 5.8 0 0 1-11.6 0C6.2 9.8 12 3.5 12 3.5z"/>',
    home: '<path d="M3.5 11L12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
    moon: '<path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z"/>',
    out: '<path d="M13.5 4H18c.6 0 1 .4 1 1v14c0 .6-.4 1-1 1h-4.5"/><path d="M9.5 16.5L14 12l-4.5-4.5M14 12H4"/>',
    lightsoff: '<path d="M9 18h6M10 21h4"/><path d="M8.2 6A6 6 0 0 0 8.4 13.8c.6.5 1 1.2 1.1 2V16h5v-.2c0-.3.1-.6.2-.9M17.6 11A6 6 0 0 0 10 3.3"/><path d="M3.5 3.5l17 17"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
    next: '<path d="M5.5 5.5v13l9-6.5z" fill="currentColor" stroke="none"/><rect x="16" y="5.5" width="2.6" height="13" rx="1" fill="currentColor" stroke="none"/>',
    prev: '<path d="M18.5 5.5v13l-9-6.5z" fill="currentColor" stroke="none"/><rect x="5.4" y="5.5" width="2.6" height="13" rx="1" fill="currentColor" stroke="none"/>',
    volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    back: '<path d="M14.5 5l-7 7 7 7"/>',
    motion: '<circle cx="13.5" cy="4.5" r="1.8"/><path d="M9.5 21l2.3-6.2 3.2 3V21"/><path d="M7 11l3.5-3.5 3.5 2 2 3h3"/><path d="M11.8 14.8L10.5 9"/>',
    vacuum: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.5"/>',
    washer: '<rect x="4.5" y="3" width="15" height="18" rx="2"/><circle cx="12" cy="13.2" r="4.3"/><path d="M7.5 6.3h2.5"/>',
    battery: '<rect x="3" y="7.5" width="15.5" height="9" rx="2"/><path d="M21 10.5v3"/><path d="M6 10.5v3"/>',
    offline: '<path d="M3.5 3.5l17 17"/><path d="M9 16.8a4.5 4.5 0 0 1 6 0M5.6 13a9 9 0 0 1 3.7-2.3M18.4 13a9 9 0 0 0-2.6-1.9M2.5 9.4a13.5 13.5 0 0 1 4.3-2.8M21.5 9.4a13.5 13.5 0 0 0-9-3.6"/>',
    thermo: '<path d="M10 14.3V5a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z"/><path d="M12 9.5V17"/>',
    sparkle: '<path d="M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7z"/><path d="M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    plug: '<path d="M9 3v5M15 3v5"/><path d="M6.5 8h11v3a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.5V21"/>',
    music: '<path d="M9 17.5V5.5l10.5-2v12"/><circle cx="6.6" cy="17.5" r="2.4"/><circle cx="17.1" cy="15.5" r="2.4"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8.5 20.5h7M12 17v3.5"/>',
    speaker: '<rect x="6" y="3" width="12" height="18" rx="3"/><circle cx="12" cy="14" r="3.2"/><circle cx="12" cy="7.3" r="1"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    undo: '<path d="M9 14.5L4 9.5l5-5"/><path d="M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    alert: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4.3M12 17.2v.3"/>',
    person: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    power: '<path d="M12 3.5v8"/><path d="M6.6 7.4a7.5 7.5 0 1 0 10.8 0"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
    work: '<rect x="3" y="7.5" width="18" height="12.5" rx="2"/><path d="M8.5 7.5V5.5c0-.6.4-1 1-1h5c.6 0 1 .4 1 1v2"/><path d="M3 12.5h18"/>',
    cart: '<path d="M3.5 4.5h2.2l2.1 10.2c.1.5.5.8 1 .8h8.3c.5 0 .9-.3 1-.8L19.8 8H6.4"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>',
    radio: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8l9-4.5"/><circle cx="15.5" cy="14" r="2.8"/><path d="M6.5 12.5h3M6.5 15.5h3"/>',
  };

  function icon(name, cls) {
    return '<svg class="ha-ico' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || "") + "</svg>";
  }

  // ---------- Zustand der Oberfläche ----------
  let built = false;
  let currentPanel = null;
  let flushTimer = null;
  let flushAt = 0;
  let setupOpen = false;
  let lastHintsAt = 0;
  let hints = [];
  const optimistic = {};
  const els = {};
  let overlayRoomId = null;
  let overlayIdleTimer = null;
  let dragging = null;
  let lastTouchAt = 0;
  let toastTimer = null;
  const thermostatPending = {};
  const sliderSend = {};
  let mediaHeroId = null;
  let mediaTicker = null;
  let historyData = {};
  let historyFetchedAt = 0;
  let historyLoading = false;
  const actionState = {};
  let absentTimer = null;
  let absentAmbient = false;
  const jumpedFor = {};

  const PANELS = ["home", "klima", "medien"];
  const OFFLINE_HIDE_MS = 10 * 60 * 1000;
  const UNDO_SCENE = "tafel_rueckgaengig";

  // ---------- Optimistische Anzeige ----------
  // Ein Tipp soll sofort sichtbar wirken (Licht-Kachel leuchtet), auch wenn
  // HA erst ein paar hundert ms später bestätigt. Kommt die Bestätigung
  // nicht, fällt die Anzeige nach 5 s auf den echten Zustand zurück und
  // es erscheint ein Hinweis.
  function setOptimistic(id, state, attributes, label) {
    optimistic[id] = { state: state, attributes: attributes || null, until: Date.now() + 5000, label: label || "" };
    scheduleFlush(5100);
  }

  function eff(id) {
    const st = HA.state(id);
    const o = optimistic[id];
    if (!o) return st;
    if (Date.now() > o.until) return st;
    const attrs = {};
    const src = (st && st.attributes) || {};
    for (const k in src) attrs[k] = src[k];
    if (o.attributes) for (const k in o.attributes) attrs[k] = o.attributes[k];
    return {
      entity_id: id,
      state: o.state != null ? o.state : (st ? st.state : "unknown"),
      attributes: attrs,
      last_changed: st ? st.last_changed : null,
    };
  }

  function sweepOptimistic() {
    const now = Date.now();
    const ids = Object.keys(optimistic);
    for (let i = 0; i < ids.length; i++) {
      const o = optimistic[ids[i]];
      if (now <= o.until) continue;
      delete optimistic[ids[i]];
      const st = HA.state(ids[i]);
      if (o.state != null && st && st.state !== o.state && o.label) {
        toast(o.label + " hat nicht reagiert", "warn");
      }
    }
  }

  function call(domain, service, data, target, label) {
    return HA.callService(domain, service, data, target).catch(function (err) {
      const msg = err && err.message ? err.message : "";
      toast((label ? label + ": " : "") + "Aktion fehlgeschlagen" + (msg ? " (" + msg + ")" : ""), "fehler");
      // Optimistische Anzeige der Ziele sofort zurücknehmen.
      const ids = target && target.entity_id ? [].concat(target.entity_id) : [];
      for (let i = 0; i < ids.length; i++) delete optimistic[ids[i]];
      scheduleFlush(0);
      throw err;
    });
  }

  function noop() {}

  // ---------- Hinweis-Toast ----------
  function toast(text, kind) {
    if (!els.toast) return;
    els.toast.textContent = text;
    els.toast.className = "ha-toast is-shown" + (kind ? " is-" + kind : "");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastTimer = null;
      els.toast.className = "ha-toast";
    }, 3800);
  }

  // ---------- Panel-Verfügbarkeit (für Karussell + Übersicht) ----------
  function usable() {
    if (!HA.everReady()) return false;
    if (HA.status() === "verbunden") return true;
    const since = HA.disconnectedSince();
    return !!since && Date.now() - since < OFFLINE_HIDE_MS;
  }

  function anyMediaActive() {
    const g = HA.model().global;
    for (let i = 0; i < g.media.length; i++) {
      const st = HA.state(g.media[i]);
      if (st && (st.state === "playing" || st.state === "paused")) return true;
    }
    return false;
  }

  function panelAvailable(name) {
    if (!usable()) return false;
    const m = HA.model();
    if (name === "home") return m.rooms.length > 0;
    if (name === "klima") return klimaRooms().length > 0;
    if (name === "medien") return anyMediaActive();
    return false;
  }

  // ---------- Grundgerüst bauen ----------
  function buildOnce() {
    if (built) return;
    built = true;
    const stage = document.getElementById("stage");
    const shell = document.querySelector(".panel");

    els.home = mk("section", "panel-view ha-panel ds-dark");
    els.home.id = "panel-home";
    els.home.innerHTML =
      '<div class="ha-head"><div class="ha-eyebrow" id="haHomeEyebrow">Zuhause</div>' +
      '<div class="ha-title" id="haHomeTitle"></div><div class="ha-subtitle" id="haHomeSub"></div></div>' +
      '<div class="ha-offline-note" id="haHomeOffline"></div>' +
      '<div class="ha-home-body"><div class="ha-rooms" id="haRooms"></div><div class="ha-side" id="haHomeSide"></div></div>' +
      '<div class="ha-actions" id="haHomeActions"></div>';

    els.klima = mk("section", "panel-view ha-panel ds-dark");
    els.klima.id = "panel-klima";
    els.klima.innerHTML =
      '<div class="ha-head"><div class="ha-eyebrow">Raumklima</div>' +
      '<div class="ha-title" id="haKlimaTitle"></div><div class="ha-subtitle" id="haKlimaSub"></div></div>' +
      '<div class="ha-offline-note" id="haKlimaOffline"></div>' +
      '<div class="ha-klima-grid" id="haKlimaGrid"></div>';

    els.medien = mk("section", "panel-view ha-panel ds-dark");
    els.medien.id = "panel-medien";
    els.medien.innerHTML =
      '<div class="ha-head"><div class="ha-eyebrow">Medien</div>' +
      '<div class="ha-title" id="haMedienTitle"></div></div>' +
      '<div class="ha-offline-note" id="haMedienOffline"></div>' +
      '<div class="ha-medien" id="haMedien"></div>';

    [els.home, els.klima, els.medien].forEach(function (sec) {
      sec.style.display = "none";
      if (stage) stage.appendChild(sec);
    });

    els.rooms = document.getElementById("haRooms");
    els.homeEyebrow = document.getElementById("haHomeEyebrow");
    els.homeTitle = document.getElementById("haHomeTitle");
    els.homeSub = document.getElementById("haHomeSub");
    els.homeActions = document.getElementById("haHomeActions");
    els.homeSide = document.getElementById("haHomeSide");
    els.klimaGrid = document.getElementById("haKlimaGrid");
    els.klimaTitle = document.getElementById("haKlimaTitle");
    els.klimaSub = document.getElementById("haKlimaSub");
    els.medienBody = document.getElementById("haMedien");
    els.medienTitle = document.getElementById("haMedienTitle");
    els.offlineNotes = [
      document.getElementById("haHomeOffline"),
      document.getElementById("haKlimaOffline"),
      document.getElementById("haMedienOffline"),
    ];

    // Raumansicht: eigenes Overlay über der Bühne, unter der Uhr-Pille.
    els.overlay = mk("div", "ha-overlay ds-dark");
    els.overlay.id = "haRoomOverlay";
    els.overlay.innerHTML =
      '<div class="ha-ov-head">' +
      '<button type="button" class="ha-ov-back" data-act="schliessen">' + icon("back") + "<span>Zuhause</span></button>" +
      '<div class="ha-ov-title"><span class="ha-ov-name" id="haOvName"></span><span class="ha-ov-meta num" id="haOvMeta"></span></div>' +
      "</div>" +
      '<div class="ha-offline-note" id="haOvOffline"></div>' +
      '<div class="ha-ov-body">' +
      '<div class="ha-ov-col ha-ov-main" id="haOvMain"></div>' +
      '<div class="ha-ov-col ha-ov-side" id="haOvSide"></div>' +
      "</div>";
    if (shell) shell.appendChild(els.overlay);
    els.ovName = document.getElementById("haOvName");
    els.ovMeta = document.getElementById("haOvMeta");
    els.ovMain = document.getElementById("haOvMain");
    els.ovSide = document.getElementById("haOvSide");
    els.offlineNotes.push(document.getElementById("haOvOffline"));

    // Hinweisband unten links, neben dem Müll-Hinweis.
    const statusbar = document.querySelector(".statusbar");
    els.hints = mk("div", "ha-hints");
    els.hints.id = "haHints";
    if (statusbar) {
      statusbar.classList.add("has-ha-hints");
      statusbar.appendChild(els.hints);
    }

    els.toast = mk("div", "ha-toast");
    if (shell) shell.appendChild(els.toast);

    // Haus-Knopf in der Kopfzeile: Schnellaktionen + Verbindungspunkt.
    const topbar = document.querySelector(".topbar");
    const radio = document.getElementById("radioWidget");
    els.houseWrap = mk("div", "ha-house-widget");
    els.houseWrap.innerHTML =
      '<button type="button" class="ha-house-toggle" id="haHouseToggle" aria-label="Zuhause">' + icon("home") +
      '<span class="ha-dot" id="haDot"></span></button>' +
      '<div class="ha-actions-menu" id="haActionsMenu"></div>';
    if (topbar) topbar.insertBefore(els.houseWrap, radio || topbar.firstChild);
    els.houseToggle = document.getElementById("haHouseToggle");
    els.dot = document.getElementById("haDot");
    els.actionsMenu = document.getElementById("haActionsMenu");

    wireEvents();
  }

  // ---------- Ereignisse (Delegation) ----------
  function wireEvents() {
    const roots = [els.home, els.klima, els.medien, els.overlay, els.actionsMenu, els.hints];
    roots.forEach(function (root) {
      if (!root) return;
      root.addEventListener("click", onClick);
    });

    els.houseToggle.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (HA.status() === "login-noetig") { openLogin(); return; }
      setActionsMenuOpen(!els.actionsMenu.classList.contains("is-open"));
    });
    // Tipp neben das offene Menü schließt es — und NUR das: der Tipp soll
    // nicht nebenbei die Kachel darunter auslösen (Capture-Phase, damit das
    // Ereignis gar nicht erst beim Ziel ankommt).
    document.addEventListener("click", function (ev) {
      if (!els.actionsMenu.classList.contains("is-open")) return;
      if (els.houseWrap.contains(ev.target)) return;
      ev.preventDefault();
      ev.stopPropagation();
      setActionsMenuOpen(false);
    }, true);

    // Schieberegler: Touch (iPad) und Maus (Test am Desktop). Nach einem
    // Touch feuert iOS zusätzlich Maus-Ereignisse — die werden ignoriert.
    const sliderRoots = [els.overlay, els.medien];
    sliderRoots.forEach(function (root) {
      root.addEventListener("touchstart", function (ev) {
        lastTouchAt = Date.now();
        const t = ev.touches && ev.touches[0];
        if (t) sliderStart(ev.target, t.clientX);
      }, { passive: true });
      root.addEventListener("touchmove", function (ev) {
        if (!dragging) return;
        const t = ev.touches && ev.touches[0];
        if (t) { ev.preventDefault(); sliderMove(t.clientX); }
      }, { passive: false });
      root.addEventListener("touchend", function () { if (dragging) sliderEnd(); });
      root.addEventListener("touchcancel", function () { if (dragging) sliderEnd(); });
      root.addEventListener("mousedown", function (ev) {
        if (Date.now() - lastTouchAt < 800) return;
        sliderStart(ev.target, ev.clientX);
      });
    });
    document.addEventListener("mousemove", function (ev) {
      if (dragging && Date.now() - lastTouchAt > 800) sliderMove(ev.clientX);
    });
    document.addEventListener("mouseup", function () {
      if (dragging && Date.now() - lastTouchAt > 800) sliderEnd();
    });

    // Raumansicht offen: jeder Touch darin verlängert die Leerlaufzeit.
    els.overlay.addEventListener("touchstart", armOverlayIdle, { passive: true });
    els.overlay.addEventListener("mousedown", armOverlayIdle);
  }

  function onClick(ev) {
    const btn = ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!btn) return;
    // Nach einem Schieberegler-Zug kein versehentlicher Klick.
    if (btn.classList.contains("ha-slider")) return;
    ev.stopPropagation();
    const act = btn.getAttribute("data-act");
    const id = btn.getAttribute("data-id");
    const raum = btn.getAttribute("data-raum");

    if (act === "raum") openRoom(raum);
    else if (act === "raum-licht") toggleRoomLights(raum);
    else if (act === "schliessen") closeRoom();
    else if (act === "licht") toggleLight(id);
    else if (act === "szene") activateScene(id, btn);
    else if (act === "szene-wahl") {
      btn.classList.add("is-pressed");
      setTimeout(function () { btn.classList.remove("is-pressed"); }, 900);
      call("select", "select_option", { option: btn.getAttribute("data-option") }, { entity_id: id }, "Szene").catch(noop);
    }
    else if (act === "farbe") setLightColor(id, btn.getAttribute("data-farbe"));
    else if (act === "temp-plus") adjustTarget(id, +1);
    else if (act === "temp-minus") adjustTarget(id, -1);
    else if (act === "hvac") setHvac(id, btn.getAttribute("data-modus"));
    else if (act === "schalter") toggleSwitch(id);
    else if (act === "media-play") mediaCmd(id, "media_play_pause");
    else if (act === "media-next") mediaCmd(id, "media_next_track");
    else if (act === "media-prev") mediaCmd(id, "media_previous_track");
    else if (act === "media-waehlen") { mediaHeroId = id; renderMedien(); }
    else if (act === "radio-ha") playRadioOn(id, btn.getAttribute("data-url"));
    else if (act === "aktion") runAction(btn.getAttribute("data-aktion"));
    else if (act === "rueckgaengig") undoAction(btn.getAttribute("data-aktion"));
    else if (act === "hinweis") openHint(btn.getAttribute("data-key"));
    else if (act === "vorschlag-weg") {
      const k = btn.getAttribute("data-key") || "";
      if (window.TafelLernen) TafelLernen.ablehnen(k.replace(/^vorschlag\|/, ""));
      lastHintsAt = 0;
      scheduleFlush(0);
    }
    else if (act === "einstellungen") { setActionsMenuOpen(false); openSetup(); }
    else if (act === "heizung-aus") setHvac(id, "off");
    else if (act === "todo") completeTodo(id, btn.getAttribute("data-uid"));
  }

  // ---------- Licht ----------
  function lightIsOn(id) {
    const st = eff(id);
    return !!st && st.state === "on";
  }

  function toggleLight(id) {
    const turnOn = !lightIsOn(id);
    setOptimistic(id, turnOn ? "on" : "off", null, HA.name(id));
    scheduleFlush(0);
    call("light", turnOn ? "turn_on" : "turn_off", null, { entity_id: id }, HA.name(id)).catch(noop);
  }

  function roomLightsOn(room) {
    let n = 0;
    for (let i = 0; i < room.lights.length; i++) if (lightIsOn(room.lights[i])) n++;
    return n;
  }

  // Mitglieder einer Hue-Raumgruppe (bzw. HA-Lichtgruppe) in diesem Raum:
  // per entity_id-Liste oder — ältere Hue-Versionen — per Namensliste.
  function groupMembers(groupId, room) {
    const st = HA.state(groupId);
    const ids = HA.attr(st, "entity_id");
    if (Array.isArray(ids) && ids.length) return room.lights.filter(function (id) { return ids.indexOf(id) !== -1; });
    const names = HA.attr(st, "lights");
    if (Array.isArray(names)) return room.lights.filter(function (id) { return names.indexOf(HA.name(id)) !== -1; });
    return [];
  }

  // Ziele für "ganzer Raum": die Hue-Raumgruppe (ein einziger Zigbee-Befehl,
  // alle Lampen gleichzeitig statt nacheinander) plus alle Lampen, die in
  // keiner Gruppe stecken (z. B. Matter-/IKEA-Lampen im selben Raum).
  function roomLightTargets(room) {
    const covered = {};
    const targets = [];
    room.lightGroups.forEach(function (gid) {
      if (HA.isUnavailable(HA.state(gid))) return;
      const members = groupMembers(gid, room);
      if (!members.length) return;
      members.forEach(function (m) { covered[m] = true; });
      targets.push(gid);
    });
    room.lights.forEach(function (id) {
      if (!covered[id] && !HA.isUnavailable(HA.state(id))) targets.push(id);
    });
    return targets;
  }

  function toggleRoomLights(roomId) {
    const room = HA.model().byId[roomId];
    if (!room || !room.lights.length) return;
    const turnOn = roomLightsOn(room) === 0;
    room.lights.forEach(function (id) {
      if (!HA.isUnavailable(HA.state(id))) setOptimistic(id, turnOn ? "on" : "off", null, "");
    });
    scheduleFlush(0);
    // Einzelne Ziele statt area_id: schaltet keine Lampen, die die Tafel
    // absichtlich ausblendet, und klappt auch ohne Raumzuordnung in HA.
    call("light", turnOn ? "turn_on" : "turn_off", null, { entity_id: roomLightTargets(room) }, room.name).catch(noop);
  }

  function setLightColor(id, preset) {
    const p = COLOR_PRESETS[preset];
    if (!p) return;
    const data = {};
    const attrs = {};
    if (p.kelvin) { data.color_temp_kelvin = p.kelvin; attrs.color_mode = "color_temp"; attrs.color_temp_kelvin = p.kelvin; }
    else { data.hs_color = p.hs; attrs.color_mode = "hs"; attrs.hs_color = p.hs; attrs.rgb_color = p.rgb; }
    setOptimistic(id, "on", attrs, HA.name(id));
    scheduleFlush(0);
    call("light", "turn_on", data, { entity_id: id }, HA.name(id)).catch(noop);
  }

  const COLOR_PRESETS = {
    warm: { kelvin: 2700, rgb: [255, 196, 137], label: "Warmweiß" },
    neutral: { kelvin: 4000, rgb: [255, 228, 206], label: "Neutral" },
    tag: { kelvin: 5600, rgb: [240, 244, 255], label: "Tageslicht" },
    rot: { hs: [4, 80], rgb: [255, 70, 51], label: "Rot" },
    orange: { hs: [28, 88], rgb: [255, 150, 31], label: "Orange" },
    gruen: { hs: [135, 65], rgb: [89, 255, 128], label: "Grün" },
    blau: { hs: [220, 75], rgb: [64, 128, 255], label: "Blau" },
    lila: { hs: [275, 65], rgb: [180, 89, 255], label: "Lila" },
  };

  function lightSupports(st, what) {
    const modes = HA.attr(st, "supported_color_modes") || [];
    if (what === "brightness") return modes.length && !(modes.length === 1 && modes[0] === "onoff");
    if (what === "ct") return modes.indexOf("color_temp") !== -1;
    if (what === "color") {
      return modes.indexOf("hs") !== -1 || modes.indexOf("xy") !== -1 || modes.indexOf("rgb") !== -1 ||
        modes.indexOf("rgbw") !== -1 || modes.indexOf("rgbww") !== -1;
    }
    return false;
  }

  function lightRgb(st) {
    if (!st || st.state !== "on") return null;
    const rgb = HA.attr(st, "rgb_color");
    if (rgb && rgb.length === 3) return rgb;
    return [255, 214, 160];
  }

  // ---------- Schieberegler ----------
  // <div class="ha-slider" data-slider="hell|ct|vol|raum" data-id="…">.
  // Während des Ziehens wird alle 350 ms gesendet (live sichtbare Lampe),
  // beim Loslassen garantiert der Endwert.
  function sliderStart(target, x) {
    const el = target && target.closest ? target.closest(".ha-slider") : null;
    if (!el || el.classList.contains("is-disabled")) return;
    const rect = el.getBoundingClientRect();
    dragging = {
      el: el,
      kind: el.getAttribute("data-slider"),
      id: el.getAttribute("data-id"),
      left: rect.left,
      width: rect.width || 1,
      value: null,
    };
    el.classList.add("is-dragging");
    sliderMove(x);
  }

  function sliderMove(x) {
    if (!dragging) return;
    const f = clamp((x - dragging.left) / dragging.width, 0, 1);
    dragging.value = f;
    const fill = dragging.el.querySelector(".ha-slider-fill");
    const knob = dragging.el.querySelector(".ha-slider-knob");
    const label = dragging.el.querySelector(".ha-slider-value");
    if (fill) fill.style.transform = "scaleX(" + f.toFixed(3) + ")";
    if (knob) knob.style.left = (f * 100).toFixed(1) + "%";
    if (label) label.textContent = sliderLabel(dragging.kind, dragging.id, f);
    sliderQueue(dragging.kind, dragging.id, f, false);
  }

  function sliderEnd() {
    const d = dragging;
    dragging = null;
    if (!d) return;
    d.el.classList.remove("is-dragging");
    if (d.value != null) sliderQueue(d.kind, d.id, d.value, true);
    scheduleFlush(400);
  }

  function ctRange(st) {
    const lo = HA.attr(st, "min_color_temp_kelvin") || 2000;
    const hi = HA.attr(st, "max_color_temp_kelvin") || 6500;
    return [lo, hi];
  }

  function sliderLabel(kind, id, f) {
    if (kind === "ct") {
      const r = ctRange(HA.state(id));
      return Math.round((r[0] + f * (r[1] - r[0])) / 50) * 50 + " K";
    }
    return Math.round(f * 100) + " %";
  }

  function sliderQueue(kind, id, f, final) {
    const key = kind + "|" + id;
    const s = sliderSend[key] || (sliderSend[key] = { last: 0, timer: null, value: f });
    s.value = f;
    const send = function () {
      s.last = Date.now();
      if (s.timer) { clearTimeout(s.timer); s.timer = null; }
      sliderApply(kind, id, s.value);
      if (final) delete sliderSend[key];
    };
    if (final) { send(); return; }
    const wait = 350 - (Date.now() - s.last);
    if (wait <= 0) send();
    else if (!s.timer) s.timer = setTimeout(function () { s.timer = null; if (sliderSend[key]) send(); }, wait);
  }

  function sliderApply(kind, id, f) {
    if (kind === "hell") {
      const pct = Math.round(f * 100);
      if (pct <= 0) {
        setOptimistic(id, "off", null, HA.name(id));
        call("light", "turn_off", null, { entity_id: id }, HA.name(id)).catch(noop);
      } else {
        setOptimistic(id, "on", { brightness: Math.round(pct * 2.55) }, HA.name(id));
        call("light", "turn_on", { brightness_pct: Math.max(1, pct) }, { entity_id: id }, HA.name(id)).catch(noop);
      }
    } else if (kind === "raum") {
      const room = HA.model().byId[id];
      if (!room) return;
      const pct = Math.round(f * 100);
      const targets = roomLightTargets(room);
      room.lights.forEach(function (lid) {
        if (HA.isUnavailable(HA.state(lid))) return;
        setOptimistic(lid, pct > 0 ? "on" : "off", pct > 0 ? { brightness: Math.round(pct * 2.55) } : null, "");
      });
      if (pct <= 0) call("light", "turn_off", null, { entity_id: targets }, room.name).catch(noop);
      else call("light", "turn_on", { brightness_pct: Math.max(1, pct) }, { entity_id: targets }, room.name).catch(noop);
    } else if (kind === "ct") {
      const r = ctRange(HA.state(id));
      const k = Math.round(r[0] + f * (r[1] - r[0]));
      setOptimistic(id, "on", { color_mode: "color_temp", color_temp_kelvin: k }, HA.name(id));
      call("light", "turn_on", { color_temp_kelvin: k }, { entity_id: id }, HA.name(id)).catch(noop);
    } else if (kind === "vol") {
      const v = Math.round(f * 100) / 100;
      setOptimistic(id, null, { volume_level: v }, "");
      call("media_player", "volume_set", { volume_level: v }, { entity_id: id }, HA.name(id)).catch(noop);
    }
  }

  function sliderHtml(kind, id, f, extraCls, disabled) {
    f = clamp(f || 0, 0, 1);
    return '<div class="ha-slider ha-slider-' + kind + (extraCls ? " " + extraCls : "") + (disabled ? " is-disabled" : "") +
      '" data-act="regler" data-slider="' + kind + '" data-id="' + esc(id) + '">' +
      '<div class="ha-slider-track">' +
      (kind === "ct"
        ? '<div class="ha-slider-knob" style="left:' + (f * 100).toFixed(1) + '%"></div>'
        : '<div class="ha-slider-fill" style="transform:scaleX(' + f.toFixed(3) + ')"></div>') +
      "</div>" +
      '<span class="ha-slider-value num">' + esc(sliderLabel(kind, id, f)) + "</span>" +
      "</div>";
  }

  function isDraggingIn(container) {
    return !!(dragging && container && container.contains(dragging.el));
  }

  // ---------- Szenen, Schalter, Heizung, Medien ----------
  function activateScene(id, btn) {
    if (btn) {
      btn.classList.add("is-pressed");
      setTimeout(function () { btn.classList.remove("is-pressed"); }, 900);
    }
    call("scene", "turn_on", null, { entity_id: id }, sceneLabel(id)).catch(noop);
  }

  function toggleSwitch(id) {
    const st = eff(id);
    const turnOn = !(st && st.state === "on");
    setOptimistic(id, turnOn ? "on" : "off", null, HA.name(id));
    scheduleFlush(0);
    call("switch", turnOn ? "turn_on" : "turn_off", null, { entity_id: id }, HA.name(id)).catch(noop);
  }

  // Plus/Minus sammelt mehrere Tipps (0,5er-Schritte) und schickt nach
  // 900 ms Ruhe einen einzigen Sollwert — statt jeden Tipp einzeln.
  function adjustTarget(id, dir) {
    const st = HA.state(id);
    if (!st) return;
    const step = HA.attr(st, "target_temp_step") || 0.5;
    const lo = HA.attr(st, "min_temp") != null ? HA.attr(st, "min_temp") : 5;
    const hi = HA.attr(st, "max_temp") != null ? HA.attr(st, "max_temp") : 30;
    const p = thermostatPending[id] || (thermostatPending[id] = { value: HA.attr(st, "temperature"), timer: null });
    let base = p.value != null ? p.value : (HA.attr(st, "current_temperature") || 20);
    base = Math.round(base / step) * step;
    p.value = clamp(base + dir * step, lo, hi);
    setOptimistic(id, st.state === "off" ? "heat" : null, { temperature: p.value }, "");
    scheduleFlush(0);
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(function () {
      const target = p.value;
      delete thermostatPending[id];
      const data = { temperature: target };
      if (st.state === "off") data.hvac_mode = "heat";
      call("climate", "set_temperature", data, { entity_id: id }, HA.name(id)).catch(noop);
    }, 900);
  }

  function setHvac(id, mode) {
    setOptimistic(id, mode, null, HA.name(id));
    scheduleFlush(0);
    call("climate", "set_hvac_mode", { hvac_mode: mode }, { entity_id: id }, HA.name(id)).catch(noop);
  }

  function mediaCmd(id, service) {
    const st = eff(id);
    if (service === "media_play_pause" && st) {
      setOptimistic(id, st.state === "playing" ? "paused" : "playing", null, "");
      scheduleFlush(0);
    }
    call("media_player", service, null, { entity_id: id }, HA.name(id)).catch(noop);
  }

  // Bitmasken aus HA (MediaPlayerEntityFeature).
  const MF = { PAUSE: 1, SEEK: 2, VOLUME_SET: 4, PREV: 16, NEXT: 32, PLAY_MEDIA: 512, PLAY: 16384 };
  function supports(st, flag) {
    return !!((HA.attr(st, "supported_features") || 0) & flag);
  }

  function playRadioOn(id, url) {
    const station = radioStations().filter(function (s) { return s.url === url; })[0];
    const name = station ? station.name : "Radio";
    setOptimistic(id, "playing", { media_title: name, media_artist: "Radio", media_content_id: url }, "");
    scheduleFlush(0);
    call("media_player", "play_media", { media_content_id: url, media_content_type: "music" }, { entity_id: id }, HA.name(id))
      .then(function () { toast(name + " läuft auf " + HA.name(id), "ok"); })
      .catch(noop);
  }

  function radioStations() {
    return (typeof CONFIG !== "undefined" && CONFIG.radioStations) ? CONFIG.radioStations : [];
  }

  // ---------- Schnellaktionen ----------
  // Erkennung über den Namen: Julians eigene Automationen/Skripte/Szenen
  // (z. B. "Rausgehen", "Gute Nacht", "Arbeiten") werden ausgelöst,
  // statt dass die Tafel eigene Logik nachbaut.
  const STANDARD_AKTIONEN = [
    { id: "raus", name: "Ich geh raus", icon: "out", muster: /raus|verlassen|abwesend|tsch(ü|ue)ss|leave|away/i },
    { id: "nacht", name: "Gute Nacht", icon: "moon", muster: /gute.?nacht|good.?night|bett|schlafen/i },
    { id: "arbeit", name: "Arbeiten", icon: "work", muster: /arbeit|work|homeoffice/i },
    { id: "da", name: "Ich bin da", icon: "home", muster: /bin.?da|heimkommen|ankommen|willkommen|welcome|arriv/i },
  ];

  function findActionTarget(pattern) {
    const g = HA.model().global;
    const pools = [g.automations, g.scripts, g.scenes];
    for (let p = 0; p < pools.length; p++) {
      for (let i = 0; i < pools[p].length; i++) {
        const id = pools[p][i];
        if (id === "scene." + UNDO_SCENE) continue;
        if (pattern.test(HA.name(id)) || pattern.test(id.replace(/_/g, " "))) return id;
      }
    }
    return null;
  }

  function quickActions() {
    const out = [];
    const custom = CFG.schnellaktionen;
    if (custom && custom.length) {
      for (let i = 0; i < custom.length; i++) {
        const a = custom[i];
        if (!a || !a.ziel || !HA.state(a.ziel)) continue;
        out.push({ id: "c" + i, name: a.name || HA.name(a.ziel), icon: a.icon || "sparkle", ziel: a.ziel });
      }
    } else {
      for (let i = 0; i < STANDARD_AKTIONEN.length; i++) {
        const s = STANDARD_AKTIONEN[i];
        const ziel = findActionTarget(s.muster);
        if (ziel) out.push({ id: s.id, name: s.name, icon: s.icon, ziel: ziel });
      }
    }
    if (CFG.alleLichterAus !== false) {
      const on = lightsOnList().length;
      out.push({ id: "licht-aus", name: "Alle Lichter aus", icon: "lightsoff", ziel: null, sub: on ? on + (on === 1 ? " Licht an" : " Lichter an") : "alles aus" });
    }
    return out;
  }

  function lightsOnList() {
    const all = HA.model().global.lightsAll;
    return all.filter(function (id) { return lightIsOn(id); });
  }

  function openWindowNames() {
    const out = [];
    HA.model().rooms.forEach(function (r) {
      r.openings.forEach(function (id) {
        const st = HA.state(id);
        if (st && st.state === "on") out.push(r.name + (HA.attr(st, "device_class") === "door" ? " (Tür)" : ""));
      });
    });
    return out;
  }

  function confirmSeconds() {
    return CFG.bestaetigungSek != null ? CFG.bestaetigungSek : 4;
  }

  // Ablauf: 1. Tipp → Countdown (erneuter Tipp bricht ab) → Ausführen →
  // 20 s lang "Rückgängig" (stellt per scene.create gesicherte Lichter/
  // Heizungen wieder her).
  function runAction(actionId) {
    const s = actionState[actionId];
    if (s && s.phase === "arming") {
      clearTimeout(s.timer);
      delete actionState[actionId];
      renderActions();
      return;
    }
    if (s && s.phase === "busy") return;
    const action = quickActions().filter(function (a) { return a.id === actionId; })[0];
    if (!action) return;
    const secs = confirmSeconds() + (actionId === "raus" && openWindowNames().length ? 4 : 0);
    actionState[actionId] = {
      phase: "arming",
      start: Date.now(),
      total: secs * 1000,
      until: Date.now() + secs * 1000,
      timer: setTimeout(function () { executeAction(action); }, secs * 1000),
    };
    renderActions();
  }

  function executeAction(action) {
    if (window.TafelLernen) TafelLernen.merkeAktion(action.id);
    actionState[action.id] = { phase: "busy" };
    renderActions();
    // Kacheln gehen gestaffelt aus — man sieht, dass wirklich alles aus ist.
    if (els.rooms) {
      els.rooms.classList.add("is-cascade");
      setTimeout(function () { els.rooms.classList.remove("is-cascade"); }, 2500);
    }
    const snapshot = [];
    const m = HA.model();
    m.global.lightsAll.forEach(function (id) { if (!HA.isUnavailable(HA.state(id))) snapshot.push(id); });
    m.rooms.forEach(function (r) {
      r.climates.forEach(function (id) { if (!HA.isUnavailable(HA.state(id))) snapshot.push(id); });
    });
    let undoable = false;
    const snap = snapshot.length
      ? HA.callService("scene", "create", { scene_id: UNDO_SCENE, snapshot_entities: snapshot }).then(function () { undoable = true; }).catch(noop)
      : Promise.resolve();

    snap.then(function () {
      if (!action.ziel) {
        const on = lightsOnList();
        on.forEach(function (id) { setOptimistic(id, "off", null, ""); });
        scheduleFlush(0);
        return on.length ? HA.callService("light", "turn_off", null, { entity_id: on }) : null;
      }
      const dom = HA.domainOf(action.ziel);
      if (dom === "automation") return HA.callService("automation", "trigger", { skip_condition: true }, { entity_id: action.ziel });
      if (dom === "script") return HA.callService("script", "turn_on", null, { entity_id: action.ziel });
      if (dom === "scene") return HA.callService("scene", "turn_on", null, { entity_id: action.ziel });
      return HA.callService("homeassistant", "turn_on", null, { entity_id: action.ziel });
    }).then(function () {
      const st = { phase: "done", undoable: undoable, timer: null };
      st.timer = setTimeout(function () { delete actionState[action.id]; renderActions(); }, 20000);
      actionState[action.id] = st;
      toast(action.name + " – erledigt", "ok");
      renderActions();
    }).catch(function (err) {
      delete actionState[action.id];
      toast(action.name + " fehlgeschlagen" + (err && err.message ? " (" + err.message + ")" : ""), "fehler");
      renderActions();
    });
  }

  function undoAction(actionId) {
    const s = actionState[actionId];
    if (s && s.timer) clearTimeout(s.timer);
    delete actionState[actionId];
    renderActions();
    call("scene", "turn_on", null, { entity_id: "scene." + UNDO_SCENE }, "Rückgängig")
      .then(function () { toast("Rückgängig gemacht", "ok"); })
      .catch(noop);
  }

  function actionButtonHtml(a) {
    const s = actionState[a.id];
    let cls = "ha-action ha-ctl";
    let inner;
    if (s && s.phase === "arming") {
      cls += " is-arming";
      // Negative Verzögerung: der Balken läuft nach jedem Neuzeichnen an
      // der richtigen Stelle weiter statt von vorn zu beginnen.
      const anim = "animation-duration:" + s.total + "ms;animation-delay:-" + (Date.now() - s.start) + "ms";
      // Beim Gehen: offene Fenster/Türen sofort im Countdown nennen.
      const offen = a.id === "raus" ? openWindowNames() : [];
      inner = icon(a.icon) + '<span class="ha-action-text"><span class="ha-action-name">' + esc(a.name) + "</span>" +
        '<span class="ha-action-sub">' + (offen.length ? "Achtung, offen: " + esc(offen.join(", ")) : "Tippen = abbrechen") + "</span></span>" +
        '<span class="ha-action-bar" style="-webkit-' + anim.replace(";", ";-webkit-") + ";" + anim + '"></span>';
      return '<button type="button" class="' + cls + '" data-act="aktion" data-aktion="' + esc(a.id) + '">' + inner + "</button>";
    }
    if (s && s.phase === "busy") {
      cls += " is-busy";
      inner = icon(a.icon) + '<span class="ha-action-text"><span class="ha-action-name">' + esc(a.name) + '</span><span class="ha-action-sub">läuft …</span></span>';
      return '<button type="button" class="' + cls + '">' + inner + "</button>";
    }
    if (s && s.phase === "done") {
      cls += " is-done";
      inner = icon("check") + '<span class="ha-action-text"><span class="ha-action-name">' + esc(a.name) + "</span>" +
        '<span class="ha-action-sub">' + (s.undoable ? "Rückgängig?" : "erledigt") + "</span></span>";
      return '<button type="button" class="' + cls + '" data-act="' + (s.undoable ? "rueckgaengig" : "") + '" data-aktion="' + esc(a.id) + '">' + inner +
        (s.undoable ? icon("undo", "ha-action-undo") : "") + "</button>";
    }
    inner = icon(a.icon) + '<span class="ha-action-text"><span class="ha-action-name">' + esc(a.name) + "</span>" +
      '<span class="ha-action-sub">' + esc(a.sub || HA.name(a.ziel)) + "</span></span>";
    return '<button type="button" class="' + cls + '" data-act="aktion" data-aktion="' + esc(a.id) + '">' + inner + "</button>";
  }

  function renderActions() {
    const list = quickActions();
    const html = list.map(actionButtonHtml).join("");
    if (els.homeActions) setHtml(els.homeActions, html);
    if (els.actionsMenu && els.actionsMenu.classList.contains("is-open")) renderActionsMenu(list);
  }

  function statusText() {
    const s = HA.status();
    if (s === "verbunden") return "Verbunden";
    if (s === "verbinde") return "Verbinde …";
    if (s === "getrennt") return "Getrennt – verbinde neu …";
    if (s === "token-ungueltig") return "Token ungültig";
    if (s === "mixed-content") return "Blockiert (HTTPS → http)";
    if (s === "login-noetig") return "Anmeldung nötig";
    return "Nicht eingerichtet";
  }

  function renderActionsMenu(list) {
    const html =
      '<div class="ha-menu-head"><span class="ha-menu-status is-' + esc(HA.status()) + '"><span class="ha-dot-inline"></span>' + esc(statusText()) + "</span>" +
      '<button type="button" class="ha-menu-gear" data-act="einstellungen" aria-label="Einstellungen">' + icon("gear") + "</button></div>" +
      '<div class="ha-menu-grid">' + (list || quickActions()).map(actionButtonHtml).join("") + "</div>";
    setHtml(els.actionsMenu, html);
  }

  function setActionsMenuOpen(open) {
    if (!els.actionsMenu) return;
    if (open) renderActionsMenu();
    els.actionsMenu.classList.toggle("is-open", open);
    if (open && typeof setRadioMenuOpen === "function") setRadioMenuOpen(false);
  }

  // ---------- Panel "Zuhause" ----------
  function personsLine() {
    const g = HA.model().global;
    if (!g.persons.length) return "";
    const home = [];
    const away = [];
    g.persons.forEach(function (id) {
      const st = HA.state(id);
      const first = esc(HA.name(id).split(" ")[0]);
      if (st && st.state === "home") home.push(first);
      else away.push(first);
    });
    if (!home.length) return "Niemand zu Hause";
    let text = home.length === 1 ? home[0] + " ist zu Hause" : home.slice(0, -1).join(", ") + " und " + home[home.length - 1] + " sind zu Hause";
    if (away.length) text += '<span class="ha-title-dim"> · ' + away.join(", ") + " unterwegs</span>";
    return text;
  }

  function homeSummaryParts() {
    const m = HA.model();
    const parts = [];
    const on = lightsOnList().length;
    parts.push(on ? on + (on === 1 ? " Licht an" : " Lichter an") : "Alle Lichter aus");
    const temps = [];
    m.rooms.forEach(function (r) {
      const s = HA.roomSummary(r);
      if (s.temp != null) temps.push(s.temp);
    });
    if (temps.length) {
      let sum = 0;
      temps.forEach(function (t) { sum += t; });
      parts.push("Innen Ø " + fmtTemp(sum / temps.length));
    }
    if (m.global.powerTotal) {
      const w = HA.numState(HA.state(m.global.powerTotal));
      if (w != null) parts.push("Strom " + fmtWatt(w));
    }
    return parts;
  }

  function lampDotsHtml(room) {
    const lamps = room.lights.slice(0, 6);
    if (!lamps.length) return "";
    return '<span class="ha-lamp-dots">' + lamps.map(function (id) {
      const st = eff(id);
      const rgb = lightRgb(st);
      if (HA.isUnavailable(st)) return '<span class="ha-lamp-dot is-gone"></span>';
      return rgb
        ? '<span class="ha-lamp-dot is-on" style="background:rgb(' + rgb.join(",") + ");box-shadow:0 0 10px rgba(" + rgb.join(",") + ',0.8)"></span>'
        : '<span class="ha-lamp-dot"></span>';
    }).join("") + "</span>";
  }

  // Mischfarbe aller brennenden Lampen für den Lichtschein der Kachel.
  function roomGlow(room) {
    let r = 0, g = 0, b = 0, n = 0, bri = 0;
    room.lights.forEach(function (id) {
      const st = eff(id);
      const rgb = lightRgb(st);
      if (!rgb) return;
      r += rgb[0]; g += rgb[1]; b += rgb[2]; n++;
      bri += HA.attr(st, "brightness") != null ? HA.attr(st, "brightness") : 255;
    });
    if (!n) return null;
    return { rgb: [Math.round(r / n), Math.round(g / n), Math.round(b / n)], level: bri / n / 255 };
  }

  function roomTileHtml(room) {
    const sum = HA.roomSummary(room);
    const lit = roomLightsOn(room);
    const avail = room.lights.filter(function (id) { return !HA.isUnavailable(HA.state(id)); }).length;
    const glow = roomGlow(room);
    let cls = "ha-room";
    if (lit) cls += " is-lit";
    if (sum.openIds.length) cls += " has-open";
    const hasClimate = sum.temp != null || sum.hum != null;

    // Große Zeile: Raumklima, sonst Lichtzustand — beides aus 3 m lesbar.
    let big;
    if (hasClimate) {
      big = (sum.temp != null ? '<span class="ha-room-temp num">' + digits(fmtTemp(sum.temp)) + "</span>" : "") +
        (sum.hum != null ? '<span class="ha-room-hum num' + (sum.hum >= humidityLimit(room) ? " is-warn" : "") + '">' + icon("drop") + digits(Math.round(sum.hum)) + " %</span>" : "");
    } else if (room.lights.length) {
      big = lit
        ? '<span class="ha-room-temp num">' + digits(lit) + '</span><span class="ha-room-of">von ' + avail + (avail === 1 ? " Lampe an" : " Lampen an") + "</span>"
        : '<span class="ha-room-temp is-off">Aus</span><span class="ha-room-of">' + avail + (avail === 1 ? " Lampe" : " Lampen") + "</span>";
    } else if (room.openings.length) {
      const offen = sum.openIds.length;
      big = offen
        ? '<span class="ha-room-temp is-warn">' + offen + '</span><span class="ha-room-of">offen</span>'
        : '<span class="ha-room-temp is-ok">Zu</span><span class="ha-room-of">' + (room.openings.length === 1 ? esc(HA.shortName(room.openings[0], room.name)) : "alle Fenster & Türen") + "</span>";
    } else {
      big = "";
    }

    // Unterzeile: Heizung, sonst was gerade brennt, sonst Belegung/Helligkeit.
    let sub = "";
    if (room.climates.length) {
      if (sum.heating) sub = '<span class="is-heat">' + icon("flame") + "heizt auf " + fmtTemp(sum.target) + "</span>";
      else if (sum.climateOn && sum.target != null) sub = "Heizung " + fmtTemp(sum.target);
      else sub = "Heizung aus";
    } else if (hasClimate && room.lights.length === 0) {
      sub = sum.hum != null && sum.hum >= humidityLimit(room) ? '<span class="is-warn">Lüften empfohlen</span>' : "Luft ok";
    } else if (sum.playing.length) {
      const mst = HA.state(sum.playing[0]);
      const t = HA.attr(mst, "media_title");
      const a = HA.attr(mst, "media_artist");
      sub = '<span class="is-media">♪ ' + esc((t || "Musik") + (a && a !== t ? " – " + a : "")) + "</span>";
    } else if (lit) {
      const names = room.lights.filter(function (id) { return lightIsOn(id); }).map(function (id) { return HA.shortName(id, room.name); });
      sub = esc(names.slice(0, 3).join(", ") + (names.length > 3 ? " …" : ""));
    }
    const extra = [];
    room.vacuums.forEach(function (vid) {
      const vst = HA.state(vid);
      if (!vst) return;
      const label = { docked: "in der Station", cleaning: "saugt gerade", returning: "fährt zur Station", idle: "bereit", paused: "pausiert", error: "braucht Hilfe" }[vst.state] || vst.state;
      extra.push(esc(HA.shortName(vid, room.name)) + " " + label);
    });
    if (sum.motion) extra.push("belegt");
    if (room.illums.length) {
      const lx = HA.numState(HA.state(room.illums[0]));
      if (lx != null) extra.push(Math.round(lx) + " lx");
    }
    if (extra.length) sub += (sub ? '<span class="ha-dim"> · </span>' : "") + extra.join(" · ");

    const chips = [];
    sum.openIds.forEach(function (id) {
      const isDoor = HA.attr(HA.state(id), "device_class") === "door";
      chips.push('<span class="ha-chip is-warn">' + icon(isDoor ? "door" : "window") + esc(isDoor ? "Tür offen" : HA.shortName(id, room.name)) + "</span>");
    });
    let lightBtn = "";
    if (room.lights.length) {
      lightBtn = '<button type="button" class="ha-light-btn ha-ctl' + (lit ? " is-on" : "") + (avail ? "" : " is-disabled") +
        '" data-act="raum-licht" data-raum="' + esc(room.id) + '" aria-label="Licht ' + esc(room.name) + '">' +
        '<span class="ha-bulb">' + icon("bulb") + '<span class="ha-bulb-fill"></span></span>' +
        "<span>" + (lit ? "Ausschalten" : "Einschalten") + "</span></button>";
    }

    const glowStyle = glow
      ? "opacity:" + clamp(0.5 + glow.level * 0.5, 0.5, 1).toFixed(2) + ";background:radial-gradient(ellipse 95% 85% at 10% 0%,rgba(" + glow.rgb.join(",") + ",0.36),rgba(" + glow.rgb.join(",") + ",0) 70%)"
      : "opacity:0";

    return '<div class="' + cls + '" data-act="raum" data-raum="' + esc(room.id) + '">' +
      '<div class="ha-room-glow" style="' + glowStyle + '"></div>' +
      '<div class="ha-room-top"><span class="ha-room-name">' + esc(room.name) + "</span>" +
      (sum.motion ? '<span class="ha-motion" title="Bewegung">' + icon("motion") + "</span>" : "") + "</div>" +
      '<div class="ha-room-climate">' + big + "</div>" +
      '<div class="ha-room-sub">' + sub + "</div>" +
      '<div class="ha-room-bottom">' + lightBtn + lampDotsHtml(room) + '<div class="ha-room-chips">' + chips.slice(0, 2).join("") + "</div></div>" +
      "</div>";
  }

  // ---------- Einkaufsliste (todo) ----------
  const todoDone = {};

  function todoEntity() {
    const list = HA.model().global.todos;
    const wanted = CFG.einkaufsliste;
    if (wanted && list.indexOf(wanted) !== -1) return wanted;
    const shop = list.filter(function (id) { return /einkauf|shopping/i.test(id + " " + HA.name(id)); })[0];
    return shop || list[0] || null;
  }

  function openTodoItems(id) {
    const items = HA.todoItems(id);
    if (!items) return null;
    const now = Date.now();
    return items.filter(function (it) {
      if (it.status !== "completed") return true;
      // Gerade abgehakt: noch kurz durchgestrichen zeigen.
      return todoDone[it.uid] && now - todoDone[it.uid] < 2500;
    });
  }

  function completeTodo(id, uid) {
    if (!id || !uid || todoDone[uid]) return;
    todoDone[uid] = Date.now();
    scheduleFlush(0);
    setTimeout(function () { scheduleFlush(0); }, 2600);
    setTimeout(function () { delete todoDone[uid]; }, 60 * 1000);
    call("todo", "update_item", { item: uid, status: "completed" }, { entity_id: id }, "Einkaufsliste").catch(function () {
      delete todoDone[uid];
      scheduleFlush(0);
    });
  }

  function todoCardHtml(id) {
    const items = openTodoItems(id);
    const st = HA.state(id);
    const name = HA.name(id);
    if (!items) {
      return '<div class="ha-todo"><div class="ha-todo-head"><span class="ds-eyebrow">' + icon("cart") + esc(name) + '</span></div><div class="ha-todo-empty">lädt …</div></div>';
    }
    const open = items.filter(function (it) { return it.status !== "completed"; }).length;
    const shown = items.slice(0, 8);
    let html = '<div class="ha-todo"><div class="ha-todo-head"><span class="ds-eyebrow">' + icon("cart") + esc(name) + "</span>" +
      '<span class="ha-todo-count num">' + (open ? open + " offen" : "") + "</span></div>";
    if (!items.length) {
      html += '<div class="ha-todo-empty">' + icon("check") + "<span>Alles erledigt</span></div>";
    } else {
      html += '<div class="ha-todo-list">' + shown.map(function (it) {
        const done = it.status === "completed" || !!todoDone[it.uid];
        return '<button type="button" class="ha-todo-item ha-ctl' + (done ? " is-done" : "") + '" data-act="todo" data-id="' + esc(id) + '" data-uid="' + esc(it.uid) + '">' +
          '<span class="ha-todo-check">' + icon("check") + "</span>" +
          '<span class="ha-todo-text">' + esc(it.summary) + "</span></button>";
      }).join("") + "</div>";
      if (items.length > shown.length) html += '<div class="ha-todo-more">+' + (items.length - shown.length) + " weitere</div>";
    }
    void st;
    return html + "</div>";
  }

  function renderHome() {
    if (!els.rooms) return;
    const m = HA.model();
    const rooms = m.rooms.slice(0, 11);
    const n = rooms.length;
    const todo = todoEntity();
    // Einkaufsliste: bei bis zu 4 Räumen als Seitenspalte, sonst als
    // zusätzliche Kachel im Raster (füllt die leeren Zellen der letzten Zeile).
    const side = !!todo && n <= 4;
    const inGrid = !!todo && !side;
    const cells = n + (inGrid ? 1 : 0);
    let cols;
    if (cells <= 1) cols = 1;
    else if (cells === 2) cols = side ? 1 : 2;
    else if (cells === 4) cols = 2;
    else if (cells <= 6) cols = 3;
    else cols = 4;
    const rows = Math.max(1, Math.ceil(cells / cols));
    els.rooms.className = "ha-rooms cols-" + cols + " rows-" + rows + (els.rooms.classList.contains("is-cascade") ? " is-cascade" : "");
    els.homeSide.style.display = side ? "" : "none";
    if (side) setHtml(els.homeSide, todoCardHtml(todo));
    // Kacheln einzeln vergleichen/ersetzen (Struktur bleibt stehen).
    const keys = rooms.map(function (r) { return r.id; }).join("|") + (inGrid ? "|todo" : "");
    if (els.rooms._haKeys !== keys) {
      els.rooms.innerHTML = "";
      rooms.forEach(function () { els.rooms.appendChild(mk("div", "ha-room-slot")); });
      if (inGrid) {
        const slot = mk("div", "ha-room-slot ha-todo-slot");
        const span = Math.max(1, cols * rows - n);
        slot.style.gridColumn = "span " + span;
        slot.style.webkitGridColumn = "span " + span;
        els.rooms.appendChild(slot);
      }
      els.rooms._haKeys = keys;
    }
    for (let i = 0; i < n; i++) setHtml(els.rooms.children[i], roomTileHtml(rooms[i]));
    if (inGrid) setHtml(els.rooms.children[n], todoCardHtml(todo));

    els.homeEyebrow.textContent = "Zuhause";
    const pl = personsLine();
    const parts = homeSummaryParts();
    setHtml(els.homeTitle, pl || esc(parts[0]));
    setHtml(els.homeSub, esc((pl ? parts : parts.slice(1)).join("  ·  ")));
    renderActions();
  }

  // ---------- Raumansicht ----------
  function openRoom(roomId) {
    if (!HA.model().byId[roomId]) return;
    overlayRoomId = roomId;
    els.overlay._haScroll = null;
    els.ovMain._haHtml = null;
    els.ovSide._haHtml = null;
    els.ovMain.scrollTop = 0;
    els.ovSide.scrollTop = 0;
    renderOverlay();
    els.overlay.classList.add("is-open");
    if (typeof pauseCarouselIndefinitely === "function") pauseCarouselIndefinitely();
    armOverlayIdle();
  }

  function closeRoom() {
    if (!overlayRoomId) return;
    overlayRoomId = null;
    els.overlay.classList.remove("is-open");
    if (overlayIdleTimer) { clearTimeout(overlayIdleTimer); overlayIdleTimer = null; }
    // Inhalt nach dem Ausblenden leeren: nichts Unsichtbares im Speicher.
    setTimeout(function () {
      if (!overlayRoomId) { setHtml(els.ovMain, ""); setHtml(els.ovSide, ""); }
    }, 400);
    if (typeof deferCarouselAdvance === "function") deferCarouselAdvance();
  }

  function armOverlayIdle() {
    if (overlayIdleTimer) clearTimeout(overlayIdleTimer);
    if (!overlayRoomId) return;
    overlayIdleTimer = setTimeout(function () { overlayIdleTimer = null; closeRoom(); }, 60 * 1000);
  }

  function lightRowHtml(id, room) {
    const st = eff(id);
    const unavailable = HA.isUnavailable(st);
    const on = !unavailable && st.state === "on";
    const bri = on ? (HA.attr(st, "brightness") != null ? HA.attr(st, "brightness") / 255 : 1) : 0;
    const rgb = lightRgb(st);
    const dot = rgb ? 'style="background:rgb(' + rgb.join(",") + ");box-shadow:0 0 14px rgba(" + rgb.join(",") + ',0.75)"' : "";
    let html = '<div class="ha-light' + (on ? " is-on" : "") + (unavailable ? " is-unavailable" : "") + '">' +
      '<div class="ha-light-head">' +
      '<span class="ha-light-dot" ' + dot + "></span>" +
      '<span class="ha-light-name">' + esc(HA.shortName(id, room.name)) + "</span>" +
      '<span class="ha-light-state num">' + (unavailable ? "nicht erreichbar" : (on ? Math.round(bri * 100) + " %" : "aus")) + "</span>" +
      '<button type="button" class="ha-toggle ha-ctl' + (on ? " is-on" : "") + (unavailable ? " is-disabled" : "") + '" data-act="licht" data-id="' + esc(id) + '" aria-label="An/Aus"><span class="ha-toggle-knob"></span></button>' +
      "</div>";
    if (!unavailable && lightSupports(st, "brightness")) {
      html += sliderHtml("hell", id, bri, "ha-ctl");
    }
    if (on && (lightSupports(st, "ct") || lightSupports(st, "color"))) {
      html += '<div class="ha-light-colors">';
      if (lightSupports(st, "ct")) {
        const r = ctRange(st);
        const k = HA.attr(st, "color_temp_kelvin");
        const f = k ? (k - r[0]) / (r[1] - r[0]) : 0.3;
        html += sliderHtml("ct", id, HA.attr(st, "color_mode") === "color_temp" ? f : 0.3, "ha-ctl");
      }
      if (lightSupports(st, "color")) {
        html += '<div class="ha-swatches">';
        ["rot", "orange", "gruen", "blau", "lila"].forEach(function (key) {
          const p = COLOR_PRESETS[key];
          html += '<button type="button" class="ha-swatch ha-ctl" data-act="farbe" data-farbe="' + key + '" data-id="' + esc(id) + '" style="background:rgb(' + p.rgb.join(",") + ')" aria-label="' + p.label + '"></button>';
        });
        html += "</div>";
      }
      html += "</div>";
    }
    return html + "</div>";
  }

  // Hue liefert seine Standardszenen mit englischen Namen (Sprache der
  // Bridge) — für die Anzeige eingedeutscht, eigene Namen bleiben.
  const SCENE_DE = {
    "relax": "Entspannen", "read": "Lesen", "concentrate": "Konzentrieren", "energize": "Energie tanken",
    "rest": "Ausruhen", "nightlight": "Nachtlicht", "natural light": "Natürliches Licht", "bright": "Hell",
    "dimmed": "Gedimmt", "rolling hills": "Sanfte Hügel", "sunset-animation": "Sonnenuntergang", "sunset animation": "Sonnenuntergang",
  };

  // Typische Farben der Hue-Szenen (für den Farbstreifen am Knopf und den
  // Farbschleier beim Aktivieren). Unbekannte Szenen: Akzentfarbe.
  const SCENE_TINT = {
    "relax": ["#ffb35c", "#ffcf8a"], "read": ["#ffe2b8", "#fff1dc"], "concentrate": ["#f3f6ff", "#d9e6ff"],
    "energize": ["#dfeaff", "#bcd3ff"], "rest": ["#ff9d4d", "#ffbe7a"], "nightlight": ["#ff7b2e", "#c4521a"],
    "natural light": ["#fff4e0", "#dbe9ff"], "bright": ["#ffffff", "#fff3dd"], "dimmed": ["#e0a96a", "#a87545"],
    "rolling hills": ["#9ccf5f", "#f2d16b"], "sunset-animation": ["#ff7a59", "#c94f9a"], "sunset animation": ["#ff7a59", "#c94f9a"],
  };

  function sceneKey(id) {
    return HA.shortName(id).toLowerCase().trim();
  }

  function sceneLabel(id, room) {
    const raw = HA.shortName(id, room ? room.name : "");
    return SCENE_DE[raw.toLowerCase().trim()] || raw;
  }

  function sceneTint(id) {
    return SCENE_TINT[sceneKey(id)] || ["#e2a65a", "#f4c879"];
  }

  // Hue legt Szenen gern doppelt an (…_2, …_3) — gleiche Namen nur einmal.
  function uniqueScenes(room) {
    const seen = {};
    const out = [];
    room.scenes.slice().sort(function (a, b) { return a.length - b.length || (a < b ? -1 : 1); }).forEach(function (id) {
      const k = sceneKey(id);
      if (seen[k]) return;
      seen[k] = true;
      out.push(id);
    });
    // Reihenfolge der Hue-App grob nachbilden: alltägliche zuerst.
    const order = ["energize", "concentrate", "read", "bright", "natural light", "relax", "dimmed", "rest", "nightlight"];
    out.sort(function (a, b) {
      const ia = order.indexOf(sceneKey(a));
      const ib = order.indexOf(sceneKey(b));
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return out;
  }

  function activeSceneId(room) {
    // Hue-Szenenwähler (select.*_szene) kennt die zuletzt aktive Szene.
    for (let i = 0; i < room.sceneSelects.length; i++) {
      const sel = HA.state(room.sceneSelects[i]);
      if (!sel || HA.isUnavailable(sel) || !sel.state || sel.state === "unknown") continue;
      const want = String(sel.state).toLowerCase();
      const hit = room.scenes.filter(function (id) { return sceneKey(id) === want; })[0];
      if (hit && roomLightsOn(room) > 0) return hit;
    }
    let best = null;
    let bestT = 0;
    room.scenes.forEach(function (id) {
      const t = Date.parse(HA.state(id) ? HA.state(id).state : "");
      if (isFinite(t) && t > bestT) { bestT = t; best = id; }
    });
    if (!best || Date.now() - bestT > 3 * 3600 * 1000 || roomLightsOn(room) === 0) return null;
    return best;
  }

  function climateCardHtml(id, room, compact) {
    const st = eff(id);
    if (!st) return "";
    const unavailable = HA.isUnavailable(st);
    const target = HA.attr(st, "temperature");
    const cur = HA.attr(st, "current_temperature");
    const heating = HA.attr(st, "hvac_action") === "heating";
    const off = st.state === "off";
    const modes = HA.attr(st, "hvac_modes") || [];
    let html = '<div class="ha-thermo' + (heating ? " is-heating" : "") + (off ? " is-off" : "") + (compact ? " is-compact" : "") + '">' +
      '<button type="button" class="ha-round ha-ctl" data-act="temp-minus" data-id="' + esc(id) + '" aria-label="kälter">' + icon("minus") + "</button>" +
      '<div class="ha-thermo-mid"><span class="ha-thermo-target num">' + (off ? "Aus" : fmtTemp(target)) + "</span>" +
      '<span class="ha-thermo-sub">' + (unavailable ? "nicht erreichbar" : (heating ? icon("flame") + "heizt" : (off ? "Heizung aus" : "Soll")) + (cur != null && !compact ? " · ist " + fmtTemp(cur) : "")) + "</span></div>" +
      '<button type="button" class="ha-round ha-ctl" data-act="temp-plus" data-id="' + esc(id) + '" aria-label="wärmer">' + icon("plus") + "</button>" +
      "</div>";
    if (!compact && modes.length > 1) {
      html += '<div class="ha-modes">';
      const labels = { heat: "Heizen", off: "Aus", auto: "Auto", cool: "Kühlen", heat_cool: "Auto" };
      modes.forEach(function (mode) {
        if (!labels[mode]) return;
        html += '<button type="button" class="ha-mode ha-ctl' + (st.state === mode ? " is-active" : "") + '" data-act="hvac" data-modus="' + mode + '" data-id="' + esc(id) + '">' + labels[mode] + "</button>";
      });
      html += "</div>";
    }
    return html;
  }

  function mediaMiniHtml(id, room) {
    const st = eff(id);
    if (!st) return "";
    const playing = st.state === "playing";
    const title = HA.attr(st, "media_title");
    const artist = HA.attr(st, "media_artist");
    const name = HA.shortName(id, room ? room.name : "");
    const vol = HA.attr(st, "volume_level");
    const canPlay = st.state === "playing" || st.state === "paused";
    return '<div class="ha-media-mini">' +
      '<div class="ha-media-mini-head">' + coverHtml(st, "ha-cover-s") +
      '<div class="ha-media-mini-text"><span class="ha-media-mini-title">' + esc(title || name) + "</span>" +
      '<span class="ha-media-mini-sub">' + esc(title ? (artist || name) : stateLabel(st.state)) + "</span></div>" +
      (canPlay ? '<button type="button" class="ha-round ha-ctl" data-act="media-play" data-id="' + esc(id) + '">' + icon(playing ? "pause" : "play") + "</button>" : "") +
      "</div>" +
      (vol != null && supports(st, MF.VOLUME_SET) ? sliderHtml("vol", id, vol, "ha-ctl ha-slider-thin") : "") +
      "</div>";
  }

  function stateLabel(s) {
    return { playing: "spielt", paused: "pausiert", idle: "bereit", off: "aus", on: "an", standby: "Standby", unavailable: "nicht erreichbar" }[s] || s;
  }

  function coverUrl(st) {
    const pic = HA.attr(st, "entity_picture");
    if (!pic) return null;
    if (/^https?:\/\//.test(pic)) return pic;
    return (HA.settings().base || "") + pic;
  }

  function coverHtml(st, cls) {
    const url = coverUrl(st);
    const isTv = HA.attr(st, "device_class") === "tv";
    return '<span class="ha-cover ' + cls + '">' + (url && st.state !== "off" ? '<img src="' + esc(url) + '" alt="">' : icon(isTv ? "tv" : "speaker")) + "</span>";
  }

  function switchRowHtml(id, room) {
    const st = eff(id);
    const on = st && st.state === "on";
    const unavailable = HA.isUnavailable(st);
    // Leistung desselben Geräts dazuschreiben (Steckdose mit Messung).
    const dev = HA.deviceIdOf(id);
    let watt = null;
    if (dev) {
      room.powers.forEach(function (pid) { if (HA.deviceIdOf(pid) === dev) watt = HA.numState(HA.state(pid)); });
    }
    return '<div class="ha-switch-row">' + icon("plug") +
      '<span class="ha-switch-name">' + esc(HA.shortName(id, room.name)) + "</span>" +
      '<span class="ha-switch-watt num">' + (watt != null && on ? fmtWatt(watt) : "") + "</span>" +
      '<button type="button" class="ha-toggle ha-ctl' + (on ? " is-on" : "") + (unavailable ? " is-disabled" : "") + '" data-act="schalter" data-id="' + esc(id) + '"><span class="ha-toggle-knob"></span></button>' +
      "</div>";
  }

  function renderOverlay() {
    if (!overlayRoomId) return;
    const room = HA.model().byId[overlayRoomId];
    if (!room) { closeRoom(); return; }
    const sum = HA.roomSummary(room);
    els.ovName.textContent = room.name;
    const meta = [];
    if (sum.temp != null) meta.push(fmtTemp(sum.temp));
    if (sum.hum != null) meta.push(Math.round(sum.hum) + " % Feuchte");
    if (sum.openIds.length) meta.push(sum.openIds.length === 1 ? "1 Fenster offen" : sum.openIds.length + " offen");
    els.ovMeta.textContent = meta.join("  ·  ");

    // Linke Spalte: Licht. Während gezogen wird, nicht neu zeichnen.
    if (!isDraggingIn(els.ovMain)) {
      let main = "";
      if (room.lights.length) {
        const lit = roomLightsOn(room);
        let avgBri = 0;
        room.lights.forEach(function (id) {
          const st = eff(id);
          if (st && st.state === "on") avgBri += (HA.attr(st, "brightness") != null ? HA.attr(st, "brightness") : 255);
        });
        avgBri = lit ? avgBri / lit / 255 : 0;
        main += '<div class="ha-sec-head"><span class="ds-eyebrow">Licht</span>' +
          '<button type="button" class="ha-pill-btn ha-ctl' + (lit ? " is-on" : "") + '" data-act="raum-licht" data-raum="' + esc(room.id) + '">' + icon(lit ? "lightsoff" : "bulb") +
          "<span>" + (lit ? "Alle aus" : "Alle an") + "</span></button></div>";
        if (room.lights.length > 1) {
          main += '<div class="ha-master"><span class="ha-master-label">Ganzer Raum</span>' + sliderHtml("raum", room.id, avgBri, "ha-ctl") + "</div>";
        }
        main += room.lights.map(function (id) { return lightRowHtml(id, room); }).join("");
      }
      if (room.switches.length) {
        main += '<div class="ha-sec-head"><span class="ds-eyebrow">Steckdosen</span></div>' +
          room.switches.map(function (id) { return switchRowHtml(id, room); }).join("");
      }
      if (!main) main = '<div class="ha-empty">Keine schaltbaren Geräte in diesem Raum.</div>';
      setHtml(els.ovMain, main);
    }

    if (!isDraggingIn(els.ovSide)) {
      let side = "";
      if (!room.scenes.length && room.sceneSelects.length) {
        // Keine Szenen-Entitäten, aber ein Hue-Szenenwähler mit Optionen:
        // Szenen über select.select_option aktivieren.
        const selId = room.sceneSelects[0];
        const sel = HA.state(selId);
        const opts = (HA.attr(sel, "options") || []).filter(function (o) { return o && !/^(unknown|none|keine|-)$/i.test(o); });
        if (opts.length) {
          side += '<div class="ha-sec-head"><span class="ds-eyebrow">Szenen</span></div><div class="ha-scenes">' +
            opts.slice(0, 10).map(function (o) {
              const key = String(o).toLowerCase();
              const t = SCENE_TINT[key] || ["#e2a65a", "#f4c879"];
              const isActive = sel && sel.state === o && roomLightsOn(room) > 0;
              return '<button type="button" class="ha-scene ha-ctl' + (isActive ? " is-active" : "") + '" data-act="szene-wahl" data-id="' + esc(selId) + '" data-option="' + esc(o) + '">' +
                '<span class="ha-scene-tint" style="background:linear-gradient(135deg,' + t[0] + "," + t[1] + ')"></span>' +
                '<span class="ha-scene-name">' + esc(SCENE_DE[key] || o) + "</span>" +
                '<span class="ha-scene-sweep" style="background:linear-gradient(90deg,rgba(0,0,0,0),' + t[0] + "," + t[1] + ',rgba(0,0,0,0))"></span></button>';
            }).join("") + "</div>";
        }
      }
      if (room.scenes.length) {
        const active = activeSceneId(room);
        const activeKey = active ? sceneKey(active) : null;
        side += '<div class="ha-sec-head"><span class="ds-eyebrow">Szenen</span></div><div class="ha-scenes">' +
          uniqueScenes(room).map(function (id) {
            const t = sceneTint(id);
            return '<button type="button" class="ha-scene ha-ctl' + (sceneKey(id) === activeKey ? " is-active" : "") + '" data-act="szene" data-id="' + esc(id) + '">' +
              '<span class="ha-scene-tint" style="background:linear-gradient(135deg,' + t[0] + "," + t[1] + ')"></span>' +
              "<span class=\"ha-scene-name\">" + esc(sceneLabel(id, room)) + "</span>" +
              '<span class="ha-scene-sweep" style="background:linear-gradient(90deg,rgba(0,0,0,0),' + t[0] + "," + t[1] + ',rgba(0,0,0,0))"></span></button>';
          }).join("") + "</div>";
      }
      if (room.climates.length) {
        side += '<div class="ha-sec-head"><span class="ds-eyebrow">Heizung</span></div>' +
          room.climates.map(function (id) { return climateCardHtml(id, room, false); }).join("");
      }
      if (sum.openIds.length && sum.heating) {
        side += '<div class="ha-warnbox">' + icon("alert") + "<span>Fenster offen und Heizung an</span>" +
          '<button type="button" class="ha-pill-btn ha-ctl" data-act="heizung-aus" data-id="' + esc(room.climates[0]) + '">Heizung aus</button></div>';
      }
      if (room.media.length) {
        side += '<div class="ha-sec-head"><span class="ds-eyebrow">Medien</span></div>' +
          room.media.map(function (id) { return mediaMiniHtml(id, room); }).join("");
      }
      setHtml(els.ovSide, side);
      // Nichts für die rechte Spalte (z. B. Raum nur mit Lampen): Lampen
      // zweispaltig über die volle Breite statt einer leeren Hälfte.
      els.overlay.classList.toggle("is-wide", !side);
    }
  }

  // ---------- Panel "Raumklima" ----------
  function klimaRooms() {
    return HA.model().rooms.filter(function (r) { return r.temps.length || r.climates.length || r.hums.length; });
  }

  function humidityLimit(room) {
    const base = CFG.feuchteGrenze || 65;
    // Bad und Küche werden beim Duschen/Kochen normal feucht.
    return /bad|dusche|wc|küche|kueche/i.test(room.name + " " + room.id) ? base + 10 : base;
  }

  function historyIds() {
    const ids = [];
    klimaRooms().forEach(function (r) {
      if (r.temps[0]) ids.push(r.temps[0]);
      if (r.hums[0]) ids.push(r.hums[0]);
    });
    return ids;
  }

  function maybeFetchHistory() {
    if (historyLoading || !HA.isConnected()) return;
    if (Date.now() - historyFetchedAt < 30 * 60 * 1000) return;
    const ids = historyIds();
    if (!ids.length) return;
    historyLoading = true;
    HA.fetchHistory(ids, 24).then(function (data) {
      historyData = data;
      historyFetchedAt = Date.now();
      historyLoading = false;
      if (currentPanel === "klima") renderKlima();
    }).catch(function () {
      historyLoading = false;
      historyFetchedAt = Date.now() - 25 * 60 * 1000; // in 5 min erneut
    });
  }

  // Live-Werte an die Kurve anhängen, alte (>24 h) abschneiden — die
  // Arrays wachsen dadurch nie über einen Tag hinaus.
  function appendHistory(id, st) {
    const pts = historyData[id];
    if (!pts) return;
    const v = HA.numState(st);
    if (v == null) return;
    const t = Date.now();
    if (pts.length && t - pts[pts.length - 1][0] < 5 * 60 * 1000) return;
    pts.push([t, v]);
    const cutoff = t - 24 * 3600 * 1000;
    while (pts.length && pts[0][0] < cutoff) pts.shift();
  }

  function sparkPath(pts, w, h, lo, hi) {
    if (!pts || pts.length < 2) return "";
    const t0 = Date.now() - 24 * 3600 * 1000;
    const span = 24 * 3600 * 1000;
    const range = (hi - lo) || 1;
    let d = "";
    // Auf höchstens ~60 Punkte ausdünnen: reicht für 280 px Breite.
    const step = Math.max(1, Math.floor(pts.length / 60));
    for (let i = 0; i < pts.length; i += step) {
      const x = clamp((pts[i][0] - t0) / span, 0, 1) * w;
      const y = h - ((pts[i][1] - lo) / range) * h;
      d += (d ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    }
    const last = pts[pts.length - 1];
    d += "L" + (clamp((last[0] - t0) / span, 0, 1) * w).toFixed(1) + " " + (h - ((last[1] - lo) / range) * h).toFixed(1);
    return d;
  }

  function minMax(pts) {
    let lo = Infinity;
    let hi = -Infinity;
    (pts || []).forEach(function (p) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; });
    return lo === Infinity ? null : [lo, hi];
  }

  // Absolute Feuchte (g/m³) aus Temperatur und relativer Feuchte —
  // entscheidet, ob Lüften wirklich trocknet: nur wenn draußen weniger
  // Wasser in der Luft ist als drinnen.
  function absHumidity(t, rh) {
    const es = 6.112 * Math.exp((17.67 * t) / (t + 243.5));
    return (es * rh * 2.1674) / (273.15 + t);
  }

  function outdoor() {
    const id = HA.model().global.weather;
    const st = id ? HA.state(id) : null;
    if (!st || HA.isUnavailable(st)) return null;
    const t = HA.attr(st, "temperature");
    const h = HA.attr(st, "humidity");
    if (t == null) return null;
    return { id: id, temp: t, hum: h, condition: st.state };
  }

  const CONDITION_DE = {
    "sunny": "sonnig", "clear-night": "klar", "partlycloudy": "teils bewölkt", "cloudy": "bewölkt",
    "rainy": "Regen", "pouring": "Starkregen", "fog": "Nebel", "snowy": "Schnee", "snowy-rainy": "Schneeregen",
    "windy": "windig", "windy-variant": "windig, bewölkt", "lightning": "Gewitter", "lightning-rainy": "Gewitter mit Regen",
    "hail": "Hagel", "exceptional": "Unwetter",
  };

  function ventilationAdvice(room, sum) {
    const out = outdoor();
    if (!out || out.hum == null || sum.temp == null || sum.hum == null) return null;
    const inside = absHumidity(sum.temp, sum.hum);
    const outside = absHumidity(out.temp, out.hum);
    const humid = sum.hum >= humidityLimit(room) - 5;
    const detail = "drinnen " + fmtNum(inside, 1) + " g/m³ · draußen " + fmtNum(outside, 1) + " g/m³";
    if (inside - outside >= 1.5) {
      return { good: true, humid: humid, text: humid ? "Jetzt lüften – draußen ist die Luft trockener" : "Lüften würde trocknen", detail: detail };
    }
    if (outside >= inside) return { good: false, humid: humid, text: "Lüften bringt gerade nichts – draußen ist es feuchter", detail: detail };
    return { good: false, humid: humid, text: "Lüften bringt gerade wenig", detail: detail };
  }

  function klimaCardHtml(room, wide) {
    const sum = HA.roomSummary(room);
    const limit = humidityLimit(room);
    const humid = sum.hum != null && sum.hum >= limit;
    const tPts = room.temps[0] ? historyData[room.temps[0]] : null;
    const hPts = room.hums[0] ? historyData[room.hums[0]] : null;
    const tmm = tPts && tPts.length > 1 ? minMax(tPts) : null;
    const hmm = hPts && hPts.length > 1 ? minMax(hPts) : null;
    const W = wide ? 600 : 280;
    const H = wide ? 190 : 54;
    let spark = "";
    if (tmm || hmm) {
      spark = '<svg class="ha-spark' + (wide ? " is-wide" : "") + '" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none">';
      if (wide) {
        // Feine Hilfslinien: Mitte + Feuchte-Grenzwert.
        spark += '<path class="ha-spark-grid" d="M0 ' + (H / 2) + "H" + W + '"/>';
        if (hmm) {
          const lo = Math.min(hmm[0] - 2, limit - 5);
          const hi = Math.max(hmm[1] + 2, limit + 5);
          const y = (H - 4) - ((limit - lo) / (hi - lo)) * (H - 4);
          spark += '<path class="ha-spark-limit" d="M0 ' + y.toFixed(1) + "H" + W + '"/>';
          spark += '<path class="ha-spark-hum" d="' + sparkPath(hPts, W, H - 4, lo, hi) + '"/>';
        }
      } else if (hmm) {
        spark += '<path class="ha-spark-hum" d="' + sparkPath(hPts, W, H - 4, hmm[0] - 2, hmm[1] + 2) + '"/>';
      }
      if (tmm) spark += '<path class="ha-spark-temp" d="' + sparkPath(tPts, W, H - 4, tmm[0] - 0.3, tmm[1] + 0.3) + '"/>';
      spark += "</svg>";
      if (wide) {
        spark += '<div class="ha-spark-axis"><span>vor 24 h</span><span>vor 12 h</span><span>jetzt</span></div>';
      }
    } else {
      // Ohne eigenen Sensor (nur Thermostat) gibt es keinen Verlauf —
      // dann das ehrlich sagen statt ewig "lädt".
      const hasSensor = room.temps.length || room.hums.length;
      const msg = !hasSensor ? "kein Verlauf (nur Thermostat)" : (historyFetchedAt ? "noch kein Verlauf" : "Verlauf lädt …");
      spark = '<div class="ha-spark ha-spark-empty' + (wide ? " is-wide" : "") + '">' + msg + "</div>";
    }
    let badge = "";
    if (sum.openIds.length && sum.heating) badge = '<span class="ha-chip is-alert">' + icon("alert") + "Fenster offen</span>";
    else if (humid) badge = '<span class="ha-chip is-warn">' + icon("drop") + "Lüften</span>";
    else if (sum.openIds.length) badge = '<span class="ha-chip is-info">' + icon("window") + "offen</span>";

    let advice = "";
    const adv = wide ? ventilationAdvice(room, sum) : null;
    if (adv) {
      advice = '<div class="ha-advice' + (adv.good && adv.humid ? " is-go" : "") + '">' + icon(adv.good ? "window" : "drop") +
        '<div><div class="ha-advice-text">' + esc(adv.text) + '</div><div class="ha-advice-detail num">' + esc(adv.detail) + "</div></div></div>";
    }

    return '<div class="ha-klima' + (humid ? " is-humid" : "") + (wide ? " is-wide" : "") + '">' +
      '<div class="ha-klima-top"><span class="ha-klima-name">' + esc(room.name) + "</span>" + badge + "</div>" +
      '<div class="ha-klima-values"><span class="ha-klima-temp num">' + digits(fmtTemp(sum.temp)) + "</span>" +
      (sum.hum != null ? '<span class="ha-klima-hum num' + (humid ? " is-warn" : "") + '">' + icon("drop") + digits(Math.round(sum.hum)) + " %</span>" : "") +
      (wide ? '<span class="ha-klima-legend"><i class="is-temp"></i>Temperatur<i class="is-hum"></i>Feuchte' + (hmm ? '<i class="is-limit"></i>Grenze ' + limit + " %" : "") + "</span>" : "") +
      "</div>" +
      spark +
      '<div class="ha-klima-range num">' + (tmm ? "24 h: " + fmtTemp(tmm[0]) + " – " + fmtTemp(tmm[1]) : "&nbsp;") +
      (hmm ? '<span class="ha-klima-range-hum">' + Math.round(hmm[0]) + "–" + Math.round(hmm[1]) + " % Feuchte</span>" : "") + "</div>" +
      advice +
      (room.climates[0] ? climateCardHtml(room.climates[0], room, true) : (wide ? "" : '<div class="ha-thermo-none">kein Thermostat</div>')) +
      "</div>";
  }

  function outdoorCardHtml(compact) {
    const out = outdoor();
    if (!out) return "";
    const ah = out.hum != null ? absHumidity(out.temp, out.hum) : null;
    if (compact) {
      return '<div class="ha-klima ha-outdoor">' +
        '<div class="ha-klima-top"><span class="ha-klima-name">Draußen</span><span class="ha-chip">' + esc(CONDITION_DE[out.condition] || out.condition) + "</span></div>" +
        '<div class="ha-klima-values"><span class="ha-klima-temp num">' + digits(fmtTemp(out.temp)) + "</span>" +
        (out.hum != null ? '<span class="ha-klima-hum num">' + icon("drop") + Math.round(out.hum) + " %</span>" : "") + "</div>" +
        (ah != null ? '<div class="ha-outdoor-ah num">' + fmtNum(ah, 1) + " g/m³<span>Wasser in der Luft – Lüften trocknet nur, wenn es drinnen mehr ist</span></div>" : "") +
        "</div>";
    }
    return '<div class="ha-klima ha-outdoor">' +
      '<div class="ha-klima-top"><span class="ha-klima-name">Draußen</span><span class="ha-chip">' + esc(CONDITION_DE[out.condition] || out.condition) + "</span></div>" +
      '<div class="ha-klima-values"><span class="ha-klima-temp num">' + fmtTemp(out.temp) + "</span>" +
      (out.hum != null ? '<span class="ha-klima-hum num">' + icon("drop") + Math.round(out.hum) + " %</span>" : "") + "</div>" +
      (ah != null ? '<div class="ha-outdoor-ah num">' + fmtNum(ah, 1) + ' g/m³<span>Wasser in der Luft</span></div>' : "") +
      '<div class="ha-outdoor-note">Lüften trocknet nur, wenn draußen weniger Wasser in der Luft ist als drinnen – die Tafel rechnet das für dich aus.</div>' +
      "</div>";
  }

  function renderKlima() {
    if (!els.klimaGrid) return;
    maybeFetchHistory();
    const rooms = klimaRooms().slice(0, 8);
    // Wenige Räume: breite Karten mit großer Kurve + Draußen-Karte daneben.
    const wide = rooms.length <= 2;
    // Draußen-Karte: bei wenigen Räumen immer, sonst wenn im Raster eine
    // Zelle frei bliebe (z. B. 5 Räume im 3×2-Raster).
    const r = rooms.length;
    const freeCell = r > 2 && ((r <= 6 && r % 3 !== 0) || (r > 6 && r % 4 !== 0));
    const withOutdoor = !!outdoor() && (wide || freeCell);
    const n = rooms.length + (withOutdoor ? 1 : 0);
    let colsCls;
    if (wide && rooms.length === 1 && withOutdoor) colsCls = "cols-wide1";
    else colsCls = "cols-" + (n <= 3 ? n : (n <= 6 ? 3 : 4));
    const cols = colsCls === "cols-wide1" ? 2 : parseInt(colsCls.slice(5), 10);
    els.klimaGrid.className = "ha-klima-grid " + colsCls + " rows-" + Math.ceil(n / Math.max(1, cols));
    const keys = rooms.map(function (r) { return r.id; }).join("|") + (withOutdoor ? "|draussen" : "");
    if (els.klimaGrid._haKeys !== keys) {
      els.klimaGrid.innerHTML = "";
      for (let i = 0; i < n; i++) els.klimaGrid.appendChild(mk("div", "ha-klima-slot"));
      els.klimaGrid._haKeys = keys;
    }
    for (let i = 0; i < rooms.length; i++) setHtml(els.klimaGrid.children[i], klimaCardHtml(rooms[i], wide));
    if (withOutdoor) setHtml(els.klimaGrid.children[rooms.length], outdoorCardHtml(!wide));

    const klimaHints = hints.filter(function (h) { return h.ziel === "klima"; });
    if (klimaHints.length) {
      setHtml(els.klimaTitle, esc(klimaHints[0].text));
    } else {
      setHtml(els.klimaTitle, "Raumklima im grünen Bereich");
    }
    const temps = [];
    let heatingRooms = 0;
    let anyClimate = false;
    rooms.forEach(function (r) {
      const s2 = HA.roomSummary(r);
      if (s2.temp != null) temps.push(s2.temp);
      if (s2.heating) heatingRooms++;
      if (r.climates.length) anyClimate = true;
    });
    const parts = [];
    if (temps.length > 1) {
      parts.push("Wärmster Raum " + fmtTemp(Math.max.apply(null, temps)));
      parts.push("kühlster " + fmtTemp(Math.min.apply(null, temps)));
    }
    if (anyClimate) parts.push(heatingRooms ? heatingRooms + (heatingRooms === 1 ? " Heizung heizt" : " Heizungen heizen") : "keine Heizung aktiv");
    const out = outdoor();
    if (out && !withOutdoor) parts.push("Draußen " + fmtTemp(out.temp));
    if (!parts.length && rooms.length === 1) parts.push("Temperatur und Luftfeuchte der letzten 24 Stunden");
    setHtml(els.klimaSub, esc(parts.join("  ·  ")));
  }

  // ---------- Panel "Medien" ----------
  function mediaPlayers() {
    return HA.model().global.media.filter(function (id) {
      const st = HA.state(id);
      return st && st.state !== "unavailable";
    });
  }

  function pickHero() {
    const players = mediaPlayers();
    if (mediaHeroId && players.indexOf(mediaHeroId) !== -1) {
      const st = HA.state(mediaHeroId);
      if (st && (st.state === "playing" || st.state === "paused")) return mediaHeroId;
    }
    let best = null;
    players.forEach(function (id) {
      const st = HA.state(id);
      if (!best && st.state === "playing") best = id;
    });
    if (!best) players.forEach(function (id) { if (!best && HA.state(id).state === "paused") best = id; });
    return best || players[0] || null;
  }

  function mediaPosition(st) {
    const pos = HA.attr(st, "media_position");
    if (pos == null) return null;
    let p = pos;
    if (st.state === "playing") {
      const at = Date.parse(HA.attr(st, "media_position_updated_at"));
      if (isFinite(at)) p += (Date.now() - at) / 1000;
    }
    const dur = HA.attr(st, "media_duration");
    return dur ? Math.min(p, dur) : p;
  }

  function playerRoomName(id) {
    const a = HA.areaIdOf(id);
    return a ? HA.areaName(a) : "";
  }

  function renderMedien() {
    if (!els.medienBody) return;
    const heroId = pickHero();
    if (!heroId) {
      setHtml(els.medienTitle, "Gerade läuft nichts");
      setHtml(els.medienBody, '<div class="ha-empty">Keine Lautsprecher gefunden.</div>');
      return;
    }
    mediaHeroId = heroId;
    const st = eff(heroId);
    const playing = st.state === "playing";
    const room = playerRoomName(heroId);
    setHtml(els.medienTitle, esc(playing ? "Läuft " + (room ? "im " + room : "auf " + HA.name(heroId)) : (st.state === "paused" ? "Pausiert" + (room ? " im " + room : "") : "Bereit")));

    if (isDraggingIn(els.medienBody)) return;
    const dur = HA.attr(st, "media_duration");
    const pos = mediaPosition(st);
    const title = HA.attr(st, "media_title") || stateLabel(st.state);
    const artist = HA.attr(st, "media_artist") || HA.attr(st, "media_album_name") || "";
    const vol = HA.attr(st, "volume_level");

    let html = '<div class="ha-hero">' + coverHtml(st, "ha-cover-l") +
      '<div class="ha-hero-info">' +
      '<span class="ha-chip is-media">' + icon(HA.attr(st, "device_class") === "tv" ? "tv" : "speaker") + esc(HA.name(heroId) + (room ? " · " + room : "")) + "</span>" +
      '<div class="ha-hero-title">' + esc(title) + "</div>" +
      '<div class="ha-hero-artist">' + esc(artist) + "</div>";
    if (dur) {
      html += '<div class="ha-progress"><div class="ha-progress-track"><div class="ha-progress-fill" id="haMediaFill" style="transform:scaleX(' + clamp((pos || 0) / dur, 0, 1).toFixed(3) + ')"></div></div>' +
        '<div class="ha-progress-times num"><span id="haMediaPos">' + fmtDuration(pos) + "</span><span>" + fmtDuration(dur) + "</span></div></div>";
    }
    html += '<div class="ha-controls">' +
      (supports(st, MF.PREV) ? '<button type="button" class="ha-round ha-round-l ha-ctl" data-act="media-prev" data-id="' + esc(heroId) + '">' + icon("prev") + "</button>" : "") +
      '<button type="button" class="ha-round ha-round-xl ha-ctl is-primary" data-act="media-play" data-id="' + esc(heroId) + '">' + icon(playing ? "pause" : "play") + "</button>" +
      (supports(st, MF.NEXT) ? '<button type="button" class="ha-round ha-round-l ha-ctl" data-act="media-next" data-id="' + esc(heroId) + '">' + icon("next") + "</button>" : "") +
      "</div>";
    if (vol != null && supports(st, MF.VOLUME_SET)) {
      html += '<div class="ha-volume">' + icon("volume") + sliderHtml("vol", heroId, vol, "ha-ctl") + "</div>";
    }
    if (supports(st, MF.PLAY_MEDIA) && radioStations().length) {
      const current = HA.attr(st, "media_content_id");
      html += '<div class="ha-radio-row"><span class="ds-eyebrow">Radio hier</span><div class="ha-radio-chips">' +
        radioStations().map(function (s) {
          return '<button type="button" class="ha-radio-chip ha-ctl' + (current === s.url && playing ? " is-active" : "") + '" data-act="radio-ha" data-id="' + esc(heroId) + '" data-url="' + esc(s.url) + '">' + esc(s.name) + "</button>";
        }).join("") + "</div></div>";
    }
    html += "</div></div>";

    const others = mediaPlayers().filter(function (id) { return id !== heroId; });
    if (others.length) {
      html += '<div class="ha-players">' + others.slice(0, 4).map(function (id) {
        const ost = eff(id);
        const canPlay = ost.state === "playing" || ost.state === "paused";
        return '<div class="ha-player' + (ost.state === "playing" ? " is-playing" : "") + '" data-act="media-waehlen" data-id="' + esc(id) + '">' +
          coverHtml(ost, "ha-cover-s") +
          '<div class="ha-player-text"><span class="ha-player-name">' + esc(HA.name(id)) + "</span>" +
          '<span class="ha-player-sub">' + esc(HA.attr(ost, "media_title") && canPlay ? HA.attr(ost, "media_title") : stateLabel(ost.state)) + "</span></div>" +
          (canPlay ? '<button type="button" class="ha-round ha-ctl" data-act="media-play" data-id="' + esc(id) + '">' + icon(ost.state === "playing" ? "pause" : "play") + "</button>" : "") +
          "</div>";
      }).join("") + "</div>";
    }
    setHtml(els.medienBody, html);
  }

  // Fortschritt läuft lokal weiter (HA meldet die Position nur bei
  // Änderungen) — ein Sekundentakt, nur solange das Panel sichtbar ist.
  function tickMedia() {
    if (currentPanel !== "medien" || !mediaHeroId) return;
    const st = HA.state(mediaHeroId);
    const dur = HA.attr(st, "media_duration");
    if (!st || !dur) return;
    const pos = mediaPosition(st);
    const fill = document.getElementById("haMediaFill");
    const label = document.getElementById("haMediaPos");
    if (fill) fill.style.transform = "scaleX(" + clamp(pos / dur, 0, 1).toFixed(3) + ")";
    if (label) label.textContent = fmtDuration(pos);
  }

  // ---------- Radio-Widget der Kopfzeile: Wiedergabe über HA ----------
  const RADIO_ZIEL_KEY = "tafelRadioZiel";
  function radioTarget() {
    let v = null;
    try { v = window.localStorage.getItem(RADIO_ZIEL_KEY); } catch (e) { v = null; }
    if (!v || v === "ipad") return null;
    const st = HA.state(v);
    if (!st || HA.isUnavailable(st) || !HA.isConnected()) return null;
    return v;
  }

  function setRadioTarget(id) {
    try { window.localStorage.setItem(RADIO_ZIEL_KEY, id || "ipad"); } catch (e) { /* egal */ }
    renderRadioTargets();
  }

  function radioCapablePlayers() {
    return mediaPlayers().filter(function (id) {
      const st = HA.state(id);
      return supports(st, MF.PLAY_MEDIA) && HA.attr(st, "device_class") !== "tv";
    });
  }

  function renderRadioTargets() {
    const menu = document.getElementById("radioMenu");
    if (!menu) return;
    let box = document.getElementById("haRadioTargets");
    const players = HA.isConnected() ? radioCapablePlayers() : [];
    if (!players.length) {
      // Nur ausblenden statt entfernen: beim Wiederverbinden kein neues
      // Element mit neuem Listener (sonst wächst das bei jedem Abbruch).
      if (box) box.style.display = "none";
      return;
    }
    if (box) box.style.display = "";
    if (!box) {
      box = mk("div", "ha-radio-targets");
      box.id = "haRadioTargets";
      box.addEventListener("click", function (ev) {
        ev.stopPropagation();
        const b = ev.target.closest ? ev.target.closest("[data-ziel]") : null;
        if (b) setRadioTarget(b.getAttribute("data-ziel") === "ipad" ? null : b.getAttribute("data-ziel"));
      });
      menu.insertBefore(box, menu.firstChild);
    }
    const current = radioTarget();
    const html = '<span class="ha-radio-targets-label">Abspielen auf</span><div class="ha-radio-targets-list">' +
      '<button type="button" class="ha-radio-target' + (current ? "" : " is-active") + '" data-ziel="ipad">iPad</button>' +
      players.map(function (id) {
        const r = playerRoomName(id);
        return '<button type="button" class="ha-radio-target' + (current === id ? " is-active" : "") + '" data-ziel="' + esc(id) + '">' + esc(HA.name(id) + (r ? " · " + r : "")) + "</button>";
      }).join("") + "</div>";
    setHtml(box, html);

    // Laufenden Sender auf dem HA-Lautsprecher im Menü markieren.
    const st = current ? HA.state(current) : null;
    const playingUrl = st && st.state === "playing" ? HA.attr(st, "media_content_id") : null;
    const items = menu.querySelectorAll(".radio-menu-item");
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle("is-playing-ha", !!playingUrl && items[i].getAttribute("data-url") === playingUrl);
    }
    const toggle = document.getElementById("radioToggle");
    if (toggle) toggle.classList.toggle("is-playing-ha", !!playingUrl);
  }

  // Von app.js (toggleRadioStation) gefragt: true = HA übernimmt.
  function radioUmleiten(url) {
    const target = radioTarget();
    if (!target) return false;
    const st = HA.state(target);
    if (st && st.state === "playing" && HA.attr(st, "media_content_id") === url) {
      mediaCmd(target, "media_pause");
    } else {
      playRadioOn(target, url);
    }
    return true;
  }

  // ---------- Hinweise ----------
  // Jeder Hinweis: key (stabil), prio (1 = wichtig … 4 = Info), icon, text,
  // ziel (Panel), raum, springen (Karussell darf hinspringen).
  const WASCH_FERTIG = ["finished", "fertig", "end", "done", "programmende", "beendet", "ende"];
  const WASCH_LAEUFT = ["run", "running", "läuft", "laeuft", "active", "aktiv", "delayedstart"];

  function computeHints() {
    const out = [];
    const m = HA.model();
    const g = m.global;
    const now = Date.now();
    const nobodyHome = g.persons.length > 0 && HA.personsHome().length === 0;

    m.rooms.forEach(function (room) {
      const sum = HA.roomSummary(room);
      sum.openIds.forEach(function (id) {
        const st = HA.state(id);
        const isDoor = HA.attr(st, "device_class") === "door";
        const since = changedAt(st);
        if (isDoor && now - since > 2 * 60 * 1000) {
          out.push({ key: "tuer|" + id, prio: 1, icon: "door", text: HA.shortName(id, room.name) + " offen " + fmtSince(since), ziel: "home", raum: room.id, springen: true });
        } else if (!isDoor && sum.heating) {
          out.push({ key: "fensterheizung|" + id, prio: 1, icon: "alert", text: room.name + ": Fenster offen, Heizung an", ziel: "klima", raum: room.id });
        } else if (nobodyHome) {
          out.push({ key: "wegoffen|" + id, prio: 1, icon: "window", text: "Niemand da – " + HA.shortName(id, room.name) + " (" + room.name + ") offen", ziel: "home", raum: room.id });
        } else if (!isDoor && now - since > 20 * 60 * 1000) {
          out.push({ key: "offen|" + id, prio: 3, icon: "window", text: room.name + ": Fenster offen " + fmtSince(since), ziel: "home", raum: room.id });
        }
      });
      if (sum.hum != null && sum.hum >= humidityLimit(room)) {
        const adv = ventilationAdvice(room, sum);
        const text = adv && !adv.good
          ? room.name + ": " + Math.round(sum.hum) + " % Feuchte – draußen ist es gerade feuchter"
          : room.name + " lüften – " + Math.round(sum.hum) + " % Feuchte";
        out.push({ key: "feuchte|" + room.id, prio: adv && !adv.good ? 3 : 2, icon: "drop", text: text, ziel: "klima", raum: room.id });
      }
    });

    if (nobodyHome) {
      const on = lightsOnList().length;
      if (on) out.push({ key: "weglicht", prio: 2, icon: "bulb", text: "Niemand da – " + on + (on === 1 ? " Licht an" : " Lichter an"), ziel: "home" });
    }

    // Waschmaschine (Home Connect o. ä.): fertig = wichtig, läuft = Info.
    let washerShown = false;
    g.washers.forEach(function (id) {
      if (washerShown) return;
      const st = HA.state(id);
      if (!st) return;
      const s = String(st.state).toLowerCase();
      const isStateSensor = /zustand|status|state|betrieb|operation/.test(id) || HA.domainOf(id) === "binary_sensor";
      if (!isStateSensor) return;
      if (WASCH_FERTIG.indexOf(s) !== -1 || (HA.domainOf(id) === "binary_sensor" && /fertig|done|finish/.test(id) && s === "on")) {
        washerShown = true;
        out.push({ key: "wasch-fertig|" + id + "|" + st.last_changed, prio: 1, icon: "washer", text: "Waschmaschine fertig " + fmtSince(changedAt(st)), ziel: "home", springen: true });
      } else if (WASCH_LAEUFT.indexOf(s) !== -1) {
        washerShown = true;
        let detail = "";
        g.washers.forEach(function (other) {
          const ost = HA.state(other);
          if (!ost) return;
          if (/fortschritt|progress/.test(other) && HA.numState(ost) != null) detail = " · " + Math.round(HA.numState(ost)) + " %";
        });
        g.washers.forEach(function (other) {
          const ost = HA.state(other);
          if (ost && /ende|finish|remaining|rest/.test(other) && HA.attr(ost, "device_class") === "timestamp") {
            const t = Date.parse(ost.state);
            if (isFinite(t) && t > now) detail += " · fertig " + fmtClock(t);
          }
        });
        out.push({ key: "wasch-laeuft|" + id, prio: 4, icon: "washer", text: "Waschmaschine läuft" + detail, ziel: "home" });
      }
    });

    g.vacuums.forEach(function (id) {
      const st = HA.state(id);
      if (!st) return;
      const name = HA.name(id);
      const bat = HA.attr(st, "battery_level");
      if (st.state === "error") out.push({ key: "saug-fehler|" + id, prio: 2, icon: "vacuum", text: name + " braucht Hilfe" + (HA.attr(st, "status") ? ": " + HA.attr(st, "status") : ""), ziel: "home" });
      else if (st.state === "cleaning") out.push({ key: "saug|" + id, prio: 4, icon: "vacuum", text: name + " saugt" + (bat != null ? " · Akku " + bat + " %" : ""), ziel: "home" });
      else if (st.state === "returning") out.push({ key: "saug|" + id, prio: 4, icon: "vacuum", text: name + " fährt zur Station", ziel: "home" });
    });

    const limit = CFG.batterieGrenze || 20;
    const low = g.batteries.filter(function (id) {
      const v = HA.numState(HA.state(id));
      return v != null && v <= limit;
    });
    if (low.length === 1) {
      const name = HA.name(low[0]).replace(/\s*(Batterie|Akku|Battery)(stand|\s*level)?\s*$/i, "");
      out.push({ key: "batterie|" + low[0], prio: 2, icon: "battery", text: "Batterie fast leer: " + name + " (" + Math.round(HA.numState(HA.state(low[0]))) + " %)", ziel: "home" });
    } else if (low.length > 1) {
      out.push({ key: "batterie|mehrere", prio: 2, icon: "battery", text: low.length + " Geräte mit schwacher Batterie", ziel: "home" });
    }

    // Nicht erreichbar erst nach 2 Minuten melden — bei einem HA-Neustart
    // ist kurz alles "unavailable", das soll keinen Alarm auslösen.
    const gone = g.unavailable.filter(function (id) {
      const st = HA.state(id);
      return st && st.state === "unavailable" && now - changedAt(st) > 2 * 60 * 1000;
    });
    if (gone.length === 1) {
      const a = HA.areaIdOf(gone[0]);
      out.push({ key: "weg|" + gone[0], prio: 3, icon: "offline", text: "Nicht erreichbar: " + HA.shortName(gone[0], a ? HA.areaName(a) : "") + (a ? " (" + HA.areaName(a) + ")" : ""), ziel: "home", raum: a });
    } else if (gone.length > 1) {
      out.push({ key: "weg|mehrere", prio: 3, icon: "offline", text: gone.length + " Geräte nicht erreichbar", ziel: "home" });
    }

    if (g.powerTotal) {
      const w = HA.numState(HA.state(g.powerTotal));
      if (w != null && w >= (CFG.stromWarnungW || 3000)) out.push({ key: "strom", prio: 3, icon: "power", text: "Hoher Stromverbrauch: " + fmtWatt(w), ziel: "home" });
    }

    // Gelernte Vorschläge (lernen.js) — nie automatisch, nur ein Tipp.
    if (window.TafelLernen && CFG.vorschlaege !== false) {
      TafelLernen.vorschlaege().forEach(function (v) {
        out.push({ key: "vorschlag|" + v.key, prio: 2, icon: "sparkle", text: v.text, vorschlag: v, ziel: v.panel || "home" });
      });
    }

    out.sort(function (a, b) { return a.prio - b.prio; });
    return out;
  }

  function hintChipHtml(h) {
    if (h.vorschlag) {
      return '<button type="button" class="ha-hint is-vorschlag" data-act="hinweis" data-key="' + esc(h.key) + '">' +
        icon(h.icon) + "<span>" + esc(h.text) + "</span>" +
        '<span class="ha-hint-weg" data-act="vorschlag-weg" data-key="' + esc(h.key) + '" aria-label="Nicht jetzt">' + icon("close") + "</span></button>";
    }
    return '<button type="button" class="ha-hint is-p' + h.prio + '" data-act="hinweis" data-key="' + esc(h.key) + '">' +
      icon(h.icon) + "<span>" + esc(h.text) + "</span></button>";
  }

  function renderHints() {
    if (!els.hints) return;
    if (!usable() || CFG.hinweise === false) { setHtml(els.hints, ""); return; }
    // Info-Hinweise (Prio 4) nur auf dem Zuhause-Panel als Band, sonst ruhig.
    const visible = hints.filter(function (h) { return h.prio <= 3 || currentPanel === "home"; });
    // Höchstens zwei Chips (plus "+n"), damit sie lesbar bleiben statt
    // zu "Badezimmer: Fenster offen, Hei…" zusammenzuschrumpfen.
    const shown = visible.slice(0, 2);
    let html = shown.map(hintChipHtml).join("");
    if (visible.length > 2) html += '<button type="button" class="ha-hint is-more" data-act="hinweis" data-key="">+' + (visible.length - 2) + "</button>";
    setHtml(els.hints, html);
  }

  function openHint(key) {
    const h = hints.filter(function (x) { return x.key === key; })[0];
    if (typeof jumpToPanel !== "function") return;
    if (!h) { jumpToPanel("home"); return; }
    if (h.vorschlag) {
      if (window.TafelLernen) TafelLernen.annehmen(h.vorschlag.key);
      if (h.vorschlag.aktion) {
        // Aktion sichtbar mit Countdown starten — abbrechen bleibt möglich.
        setActionsMenuOpen(true);
        runAction(h.vorschlag.aktion);
      } else if (h.vorschlag.panel) {
        jumpToPanel(h.vorschlag.panel);
      }
      return;
    }
    if (h.raum && h.ziel === "home" && HA.model().byId[h.raum]) {
      jumpToPanel("home");
      openRoom(h.raum);
    } else {
      jumpToPanel(h.ziel || "home");
    }
  }

  // ---------- Reaktionen der Tafel auf HA ----------
  function isWakeSensor(id) {
    const list = REAKTION.weckSensoren;
    if (list && list.length) return list.indexOf(id) !== -1;
    // Standard: jeder Bewegungs-/Belegungsmelder ist ein Zeichen, dass
    // jemand da ist — egal in welchem Raum er hängt.
    return true;
  }

  function onEntityChange(id, newState, oldState) {
    const dom = HA.domainOf(id);
    if (dom === "binary_sensor" && newState && newState.state === "on" && (!oldState || oldState.state !== "on")) {
      const dc = HA.attr(newState, "device_class");
      if ((dc === "motion" || dc === "occupancy" || dc === "presence") && REAKTION.bewegungWeckt !== false && isWakeSensor(id)) {
        if (typeof wakeByPresence === "function") wakeByPresence();
        maybeMorningGreeting();
      }
    }
    if (dom === "person") {
      checkAbsence();
      if (newState && oldState && newState.state === "home" && oldState.state !== "home" && oldState.state !== "unavailable" && oldState.state !== "unknown") {
        onPersonArrived(id);
      }
    }
    if (historyData[id]) appendHistory(id, newState);
  }

  // ---------- Begrüßung (Heimkommen, später auch Morgengruß) ----------
  // Großer, ruhiger Gruß für ~7 s: Titel + ein bis zwei Sätze, die gerade
  // wirklich zählen. Antippen schließt sofort.
  let greetTimer = null;

  function showGreeting(eyebrow, title, lines, ms) {
    let el = document.getElementById("haGreeting");
    if (!el) {
      el = mk("div", "ha-greeting ds-dark");
      el.id = "haGreeting";
      (document.querySelector(".panel") || document.body).appendChild(el);
      el.addEventListener("click", function (ev) { ev.stopPropagation(); hideGreeting(); });
    }
    el.innerHTML = '<div class="ha-greeting-inner">' +
      '<div class="ha-eyebrow">' + esc(eyebrow) + "</div>" +
      '<div class="ha-greeting-title">' + esc(title) + "</div>" +
      (lines || []).filter(Boolean).slice(0, 3).map(function (l, i) {
        return '<div class="ha-greeting-line" style="transition-delay:' + (180 + i * 120) + 'ms">' + esc(l) + "</div>";
      }).join("") + "</div>";
    void el.offsetWidth;
    el.classList.add("is-open");
    if (greetTimer) clearTimeout(greetTimer);
    greetTimer = setTimeout(hideGreeting, ms || 7000);
  }

  function hideGreeting() {
    const el = document.getElementById("haGreeting");
    if (greetTimer) { clearTimeout(greetTimer); greetTimer = null; }
    if (!el) return;
    el.classList.remove("is-open");
    setTimeout(function () { if (!el.classList.contains("is-open")) el.innerHTML = ""; }, 600);
  }

  // Was jemand beim Heimkommen wissen will — höchstens zwei Sätze.
  function arrivalLines() {
    const lines = [];
    const on = lightsOnList().length;
    lines.push(on ? on + (on === 1 ? " Licht brennt" : " Lichter brennen") : "Alle Lichter sind aus");
    // Frisch berechnen: "Niemand da …" ist mit dem Heimkommen erledigt.
    hints = computeHints();
    lastHintsAt = Date.now();
    const important = hints.filter(function (h) { return h.prio <= 2 && !h.vorschlag && !/^weg/.test(h.key); })[0];
    if (important) lines.push(important.text);
    return lines;
  }

  function onPersonArrived(id) {
    if (REAKTION.begruessung === false) return;
    const first = HA.name(id).split(" ")[0];
    if (typeof wakeByPresence === "function") wakeByPresence();
    const busy = (typeof recentlyTouched !== "undefined" && recentlyTouched) || !!overlayRoomId || loginOpen || setupOpen;
    if (!busy && typeof jumpToPanel === "function" && currentPanel !== "home" && panelAvailable("home")) jumpToPanel("home");
    showGreeting("Willkommen zurück", "Hallo " + first, arrivalLines());
  }

  // ---------- Morgengruß ----------
  // Erste Bewegung des Tages zwischen 5 und 11 Uhr: die Tafel wacht weich
  // auf und sagt den EINEN Satz, der heute zählt (Wetter, Regen, Bahn).
  const GRUSS_KEY = "tafelMorgengruss";

  function morningSentence() {
    const snap = typeof tafelSnapshot === "function" ? tafelSnapshot() : null;
    const parts = [];
    if (snap && snap.weather && snap.weather.temp != null) parts.push(snap.weather.temp + " °C");
    if (snap && snap.rainStartMinutes != null && snap.rainStartMinutes <= 180) {
      parts.push(snap.rainStartMinutes <= 0 ? "es regnet" : "ab " + fmtClock(Date.now() + snap.rainStartMinutes * 60000) + " Uhr Regen");
    } else if (snap && snap.weather && snap.weather.desc) {
      parts.push(snap.weather.desc.toLowerCase());
    }
    let sentence = parts.join(", ");
    const bahn = snap && snap.departures ? snap.departures.filter(function (d) { return d.leaveByMs && d.leaveByMs >= Date.now() + 2 * 60000; })[0] : null;
    const day = new Date().getDay();
    if (bahn && day >= 1 && day <= 5) sentence += (sentence ? " – " : "") + "nimm die " + bahn.line + " um " + bahn.clock;
    return sentence ? sentence + "." : "";
  }

  function maybeMorningGreeting() {
    if (REAKTION.morgengruss === false) return;
    const now = new Date();
    if (now.getHours() < 5 || now.getHours() >= 11) return;
    const today = now.getFullYear() + "-" + (now.getMonth() + 1) + "-" + now.getDate();
    let last = "";
    try { last = window.localStorage.getItem(GRUSS_KEY) || ""; } catch (e) { last = ""; }
    if (last === today) return;
    try { window.localStorage.setItem(GRUSS_KEY, today); } catch (e) { /* egal */ }
    const g = HA.model().global;
    const home = HA.personsHome();
    const who = home.length ? HA.name(home[0]).split(" ")[0] : (g.persons[0] ? HA.name(g.persons[0]).split(" ")[0] : "");
    const snap = typeof tafelSnapshot === "function" ? tafelSnapshot() : null;
    const second = [];
    if (snap && snap.waste && snap.waste.date) {
      const d = snap.waste.date;
      if (d.getDate() === now.getDate() && d.getMonth() === now.getMonth()) second.push("Heute wird der Müll abgeholt");
    }
    const important = hints.filter(function (h) { return h.prio <= 2 && !h.vorschlag; })[0];
    if (important) second.push(important.text);
    if (typeof jumpToPanel === "function") jumpToPanel("departures");
    showGreeting("Guten Morgen", "Guten Morgen" + (who ? ", " + who : ""), [morningSentence()].concat(second), 9000);
  }

  // Niemand zu Hause (alle person.* nicht "home", 2 min stabil) → Ambient.
  // Kommt jemand heim → aufwecken. Nur der Wechsel löst etwas aus, damit
  // ein Antippen den Ambient-Modus trotzdem beenden kann.
  function checkAbsence() {
    if (REAKTION.niemandDaAmbient === false) return;
    const g = HA.model().global;
    if (!g.persons.length) return;
    const away = HA.personsHome().length === 0;
    if (away && !absentAmbient && !absentTimer) {
      absentTimer = setTimeout(function () {
        absentTimer = null;
        if (HA.personsHome().length === 0 && typeof enterAmbientMode === "function") {
          absentAmbient = true;
          enterAmbientMode();
          const amb = document.getElementById("ambientOverlay");
          if (amb) amb.classList.add("is-absent");
        }
      }, 2 * 60 * 1000);
    } else if (!away) {
      if (absentTimer) { clearTimeout(absentTimer); absentTimer = null; }
      if (absentAmbient) {
        absentAmbient = false;
        const amb = document.getElementById("ambientOverlay");
        if (amb) amb.classList.remove("is-absent");
        if (typeof wakeByPresence === "function") wakeByPresence();
      }
    }
  }

  function maybeJump(newHints) {
    if (REAKTION.ereignisSprung === false) return;
    for (let i = 0; i < newHints.length; i++) {
      const h = newHints[i];
      if (!h.springen || jumpedFor[h.key]) continue;
      jumpedFor[h.key] = Date.now();
      const busy = (typeof recentlyTouched !== "undefined" && recentlyTouched) ||
        (typeof ambientActive !== "undefined" && ambientActive) ||
        (typeof panelNavOpen !== "undefined" && panelNavOpen) || !!overlayRoomId ||
        document.visibilityState === "hidden";
      if (busy || typeof jumpToPanel !== "function") continue;
      if (currentPanel !== "home") jumpToPanel("home");
      flashHint(h.key);
      break;
    }
    // Alte Einträge nach einem Tag vergessen (kein Wachstum).
    const keys = Object.keys(jumpedFor);
    for (let k = 0; k < keys.length; k++) {
      if (Date.now() - jumpedFor[keys[k]] > 24 * 3600 * 1000) delete jumpedFor[keys[k]];
    }
  }

  function flashHint(key) {
    setTimeout(function () {
      if (!els.hints) return;
      const chips = els.hints.querySelectorAll(".ha-hint");
      for (let i = 0; i < chips.length; i++) {
        if (chips[i].getAttribute("data-key") === key) chips[i].classList.add("is-flash");
      }
    }, 50);
  }

  // ---------- Kopfzeile: Verbindungspunkt ----------
  function renderTopbar() {
    if (!els.houseWrap) return;
    const s = HA.status();
    els.houseWrap.style.display = (s === "aus") ? "none" : "";
    els.dot.className = "ha-dot is-" + s;
    document.body.classList.toggle("ha-offline", HA.everReady() && s !== "verbunden");
    let note = "Keine Verbindung zu Home Assistant – Bedienung gesperrt, verbinde neu …";
    if (s === "token-ungueltig") note = "Home Assistant lehnt den Token ab – lange auf die Uhr drücken, um ihn neu einzugeben.";
    else if (s === "login-noetig") note = "Anmeldung abgelaufen – oben auf das Haus tippen und neu anmelden.";
    els.offlineNotes.forEach(function (n) {
      if (!n) return;
      n.textContent = (HA.everReady() && s !== "verbunden") ? note : "";
    });
  }

  // ---------- Sammel-Aktualisierung ----------
  // Nur der früheste angefragte Zeitpunkt zählt — ein später geplanter
  // Durchlauf darf einen früheren nie verdrängen.
  function scheduleFlush(delay) {
    const d = delay == null ? 250 : Math.max(0, delay);
    const at = Date.now() + d;
    if (flushTimer && flushAt <= at) return;
    if (flushTimer) clearTimeout(flushTimer);
    flushAt = at;
    flushTimer = setTimeout(flush, d);
  }

  function flush() {
    flushTimer = null;
    if (!built) return;
    sweepOptimistic();
    const now = Date.now();
    if (now - lastHintsAt > 1000) {
      lastHintsAt = now;
      const before = {};
      hints.forEach(function (h) { before[h.key] = true; });
      hints = HA.everReady() ? computeHints() : [];
      const fresh = hints.filter(function (h) { return !before[h.key]; });
      if (fresh.length) maybeJump(fresh);
    } else {
      scheduleFlush(1050 - (now - lastHintsAt));
    }
    renderHints();
    renderTopbar();
    // Ambient/Tiefschlaf: alle HA-Animationen ruhen.
    const night = document.getElementById("nightOverlay");
    document.body.classList.toggle("ha-ruhe",
      (typeof ambientActive !== "undefined" && ambientActive) || !!(night && night.classList.contains("is-active")));
    if (currentPanel === "home") renderHome();
    else if (currentPanel === "klima") renderKlima();
    else if (currentPanel === "medien") renderMedien();
    if (overlayRoomId) renderOverlay();
    if (els.actionsMenu && els.actionsMenu.classList.contains("is-open")) renderActionsMenu();
    renderRadioTargets();
    // Offene optimistische Werte: zum frühesten Ablauf nochmal prüfen.
    let next = 0;
    Object.keys(optimistic).forEach(function (id) {
      if (!next || optimistic[id].until < next) next = optimistic[id].until;
    });
    if (next) scheduleFlush(next - Date.now() + 60);
  }

  // Zeitabhängige Hinweise ("seit 4 min") und Countdown-Anzeigen
  // aktualisieren sich auch ohne neue HA-Ereignisse.
  function minuteTick() {
    if (!built) return;
    scheduleFlush(0);
  }

  // ---------- Anmeldung (Login-Bildschirm) ----------
  // Offizieller HA-Login-Ablauf (ha.js: loginBegin/loginSubmit): echte
  // HA-Benutzerkonten, gespeichert wird nur das Refresh-Token. Erscheint von
  // selbst, wenn eine HA-Adresse bekannt ist, aber keine Anmeldung — "Später"
  // blendet ihn für 12 h aus (die Tafel läuft ohne HA wie bisher weiter).
  const LOGIN_LATER_KEY = "tafelLoginSpaeter";
  let loginOpen = false;
  let loginStep = null;

  const LOGIN_FEHLER = {
    invalid_auth: "Benutzername oder Passwort stimmt nicht.",
    invalid_code: "Der Code stimmt nicht – bitte den aktuellen Code eingeben.",
    invalid_login: "Anmeldung abgelehnt.",
    login_expired: "Die Anmeldung hat zu lange gedauert – bitte noch einmal.",
    keine_antwort: "Home Assistant antwortet nicht.",
  };

  function loginLaterActive() {
    let t = 0;
    try { t = parseInt(window.localStorage.getItem(LOGIN_LATER_KEY) || "0", 10); } catch (e) { t = 0; }
    return !!t && Date.now() - t < 12 * 3600 * 1000;
  }

  function serverLabel(base) {
    return String(base || "").replace(/^https?:\/\//, "");
  }

  function loginEl() {
    let el = document.getElementById("haLogin");
    if (el) return el;
    el = mk("div", "ha-login ds-dark");
    el.id = "haLogin";
    (document.querySelector(".panel") || document.body).appendChild(el);
    el.addEventListener("click", function (ev) {
      ev.stopPropagation();
      const b = ev.target.closest ? ev.target.closest("[data-login]") : null;
      if (!b) return;
      const what = b.getAttribute("data-login");
      if (what === "spaeter") {
        try { window.localStorage.setItem(LOGIN_LATER_KEY, String(Date.now())); } catch (e) { /* egal */ }
        closeLogin();
      } else if (what === "senden") submitLogin();
      else if (what === "server") {
        const row = document.getElementById("haLoginServerRow");
        if (row) row.classList.toggle("is-open");
      }
    });
    // Enter auf der iPad-Tastatur = Anmelden.
    el.addEventListener("keydown", function (ev) {
      if (ev.keyCode === 13) { ev.preventDefault(); submitLogin(); }
    });
    return el;
  }

  function openLogin() {
    const el = loginEl();
    const base = HA.settings().base || defaultSetupUrl();
    loginStep = "init";
    el.innerHTML =
      '<div class="ha-login-intro">' +
      '<div class="ha-eyebrow">SmartTafel · Home Assistant</div>' +
      '<div class="ha-login-title">Zuhause verbinden</div>' +
      '<p class="ha-login-text">Melde dich einmal mit deinem Home-Assistant-Konto an – danach steuerst du Licht und Szenen, siehst Raumklima und Musik und bekommst Hinweise direkt an der Tafel.</p>' +
      '<ul class="ha-login-points">' +
      "<li>" + icon("bulb") + "<span>Licht &amp; Szenen mit einem Tipp</span></li>" +
      "<li>" + icon("music") + "<span>Musik und Radio auf dem HomePod</span></li>" +
      "<li>" + icon("sparkle") + "<span>Hinweise, die mitdenken</span></li>" +
      "</ul>" +
      '<p class="ha-login-fine">Das Passwort wird nicht gespeichert – nur eine widerrufbare Anmeldung (in HA unter Profil → Sicherheit sichtbar).</p>' +
      "</div>" +
      '<div class="ha-login-card">' +
      '<div class="ha-login-server"><span>' + icon("home") + esc(serverLabel(base) || "Adresse fehlt") + '</span><button type="button" class="ha-link-btn" data-login="server">ändern</button></div>' +
      '<div class="ha-login-server-row' + (base ? "" : " is-open") + '" id="haLoginServerRow">' +
      '<input class="ha-setup-input" id="haLoginUrl" type="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="http://homeassistant.local:8123" value="' + esc(base) + '"></div>' +
      '<div id="haLoginFields">' + loginFieldsHtml("init") + "</div>" +
      '<div class="ha-login-error" id="haLoginError"></div>' +
      '<button type="button" class="ha-login-submit" data-login="senden" id="haLoginSubmit">Anmelden</button>' +
      '<button type="button" class="ha-link-btn ha-login-later" data-login="spaeter">Später</button>' +
      "</div>";
    el.classList.add("is-open");
    loginOpen = true;
    if (typeof pauseCarouselIndefinitely === "function") pauseCarouselIndefinitely();
  }

  function loginFieldsHtml(step, mfaName) {
    if (step === "mfa") {
      return '<label class="ha-setup-label">Bestätigungscode' + (mfaName ? " (" + esc(mfaName) + ")" : "") + "</label>" +
        '<input class="ha-setup-input ha-login-code num" id="haLoginCode" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="8" placeholder="123456">';
    }
    return '<label class="ha-setup-label">Benutzername</label>' +
      '<input class="ha-setup-input" id="haLoginUser" type="text" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="z. B. tafel">' +
      '<label class="ha-setup-label">Passwort</label>' +
      '<input class="ha-setup-input" id="haLoginPass" type="password" autocomplete="current-password" placeholder="Passwort">';
  }

  function setLoginError(text, ok) {
    const e = document.getElementById("haLoginError");
    if (!e) return;
    e.textContent = text || "";
    e.className = "ha-login-error" + (ok ? " is-ok" : "");
  }

  function setLoginBusy(busy, label) {
    const b = document.getElementById("haLoginSubmit");
    if (!b) return;
    b.disabled = !!busy;
    b.classList.toggle("is-busy", !!busy);
    b.textContent = label || (loginStep === "mfa" ? "Bestätigen" : "Anmelden");
  }

  function submitLogin() {
    const btn = document.getElementById("haLoginSubmit");
    if (!btn || btn.disabled) return;
    setLoginError("");
    if (loginStep === "mfa") {
      const codeIn = document.getElementById("haLoginCode");
      const code = codeIn ? codeIn.value.replace(/\s+/g, "") : "";
      if (!code) { setLoginError("Bitte den Code eingeben."); return; }
      setLoginBusy(true, "Prüfe …");
      HA.loginSubmit({ code: code }).then(handleLoginResult, handleLoginFailure);
      return;
    }
    const userIn = document.getElementById("haLoginUser");
    const passIn = document.getElementById("haLoginPass");
    const urlIn = document.getElementById("haLoginUrl");
    const user = userIn ? userIn.value.trim() : "";
    const pass = passIn ? passIn.value : "";
    if (!user || !pass) { setLoginError("Bitte Benutzername und Passwort eingeben."); return; }
    // Passwort sofort aus dem Feld nehmen — es lebt nur noch in dieser Funktion.
    if (passIn) passIn.value = "";
    setLoginBusy(true, "Melde an …");
    HA.loginBegin(urlIn ? urlIn.value : "").then(function (step) {
      if (step.abbruch || step.fehler) return step;
      return HA.loginSubmit({ username: user, password: pass });
    }).then(handleLoginResult, handleLoginFailure);
  }

  function handleLoginResult(res) {
    if (res && res.fertig) {
      setLoginBusy(true, "✓ Angemeldet");
      setLoginError("Verbunden – einen Moment …", true);
      setTimeout(closeLogin, 900);
      return;
    }
    if (res && res.schritt === "mfa") {
      loginStep = "mfa";
      const f = document.getElementById("haLoginFields");
      if (f) f.innerHTML = loginFieldsHtml("mfa", res.mfaName);
      setLoginBusy(false);
      if (res.fehler) setLoginError(LOGIN_FEHLER[res.fehler] || "Code abgelehnt.");
      const c = document.getElementById("haLoginCode");
      if (c) c.focus();
      return;
    }
    if (res && res.abbruch) {
      loginStep = "init";
      const f = document.getElementById("haLoginFields");
      if (f) f.innerHTML = loginFieldsHtml("init");
      setLoginBusy(false);
      setLoginError(LOGIN_FEHLER[res.abbruch] || "Anmeldung abgebrochen (" + res.abbruch + ").");
      return;
    }
    setLoginBusy(false);
    setLoginError((res && LOGIN_FEHLER[res.fehler]) || "Anmeldung fehlgeschlagen.");
  }

  function handleLoginFailure(err) {
    setLoginBusy(false);
    setLoginError((err && err.message) || "Anmeldung fehlgeschlagen.");
  }

  function closeLogin() {
    const el = document.getElementById("haLogin");
    loginOpen = false;
    loginStep = null;
    if (!el) return;
    el.classList.remove("is-open");
    // Eingaben nicht im DOM stehen lassen.
    setTimeout(function () { if (!loginOpen) el.innerHTML = ""; }, 400);
    if (typeof deferCarouselAdvance === "function") deferCarouselAdvance();
  }

  function maybeAutoLogin() {
    if (loginOpen || HA.status() !== "login-noetig" || loginLaterActive()) return;
    if (!HA.settings().base) return;
    openLogin();
  }

  // ---------- Einstellungen (lange auf die Uhr drücken) ----------
  function openSetup() {
    let dlg = document.getElementById("haSetup");
    if (!dlg) {
      dlg = mk("div", "ha-setup");
      dlg.id = "haSetup";
      const shell = document.querySelector(".panel") || document.body;
      shell.appendChild(dlg);
      dlg.addEventListener("click", function (ev) {
        ev.stopPropagation();
        const b = ev.target.closest ? ev.target.closest("[data-setup]") : null;
        if (ev.target === dlg) { closeSetup(); return; }
        if (!b) return;
        const what = b.getAttribute("data-setup");
        const urlIn = document.getElementById("haSetupUrl");
        const tokIn = document.getElementById("haSetupToken");
        const out = document.getElementById("haSetupResult");
        if (what === "schliessen") closeSetup();
        else if (what === "anmelden") { closeSetup(); openLogin(); }
        else if (what === "vergessen") {
          if (window.TafelLernen) TafelLernen.vergessen();
          renderSetup(dlg);
          const o2 = document.getElementById("haSetupResult");
          if (o2) { o2.textContent = "Alles Gelernte gelöscht."; o2.className = "ha-setup-result is-ok"; }
        }
        else if (what === "abmelden") {
          HA.logout();
          out.textContent = "Abgemeldet – die Anmeldung wurde in Home Assistant widerrufen.";
          out.className = "ha-setup-result";
          setTimeout(function () { renderSetup(dlg); }, 400);
        } else if (what === "erweitert") {
          const box = document.getElementById("haSetupAdvanced");
          if (box) box.classList.toggle("is-open");
        } else if (what === "testen" || what === "speichern") {
          const url = urlIn.value.trim() || defaultSetupUrl();
          const token = tokIn.value.trim();
          if (!token) { out.textContent = "Bitte einen Langzeit-Token eingeben."; out.className = "ha-setup-result is-fehler"; return; }
          out.textContent = "Prüfe Verbindung …";
          out.className = "ha-setup-result";
          HA.testConnection(url, token).then(function (r) {
            if (!r.ok) {
              out.textContent = "✗ " + r.grund;
              out.className = "ha-setup-result is-fehler";
              return;
            }
            out.textContent = "✓ Verbunden mit Home Assistant " + r.version + (what === "speichern" ? " – gespeichert." : "");
            out.className = "ha-setup-result is-ok";
            if (what === "speichern") {
              tokIn.value = "";
              const keepUrl = HA.servedFromHomeAssistant() && !urlIn.value.trim() ? "" : url;
              HA.saveSettings(keepUrl, token);
              setTimeout(closeSetup, 1200);
            }
          });
        }
      });
    }
    renderSetup(dlg);
    dlg.classList.add("is-open");
    setupOpen = true;
    if (typeof pauseCarouselIndefinitely === "function") pauseCarouselIndefinitely();
  }

  function renderSetup(dlg) {
    const s = HA.settings();
    const servedHere = HA.servedFromHomeAssistant();
    let account;
    if (s.mode === "login") account = "Angemeldet" + (HA.userName() ? " als <b>" + esc(HA.userName()) + "</b>" : "") + " (Home-Assistant-Konto)";
    else if (s.mode === "token") account = "Verbunden über einen Langzeit-Token";
    else account = "Nicht angemeldet";
    dlg.innerHTML =
      '<div class="ha-setup-card ds-dark">' +
      '<div class="ha-setup-head"><span class="ha-setup-title">Einstellungen</span>' +
      '<span class="ha-menu-status is-' + esc(HA.status()) + '"><span class="ha-dot-inline"></span>' + esc(statusText()) + "</span></div>" +
      (location.protocol === "https:" ? '<p class="ha-setup-note">Diese Tafel läuft über HTTPS (GitHub Pages). Safari blockiert von hier aus Verbindungen zu <b>http://</b>-Adressen im Heimnetz. Öffne die Tafel direkt aus Home Assistant (<b>http://homeassistant.local:8123/local/tafel/index.html</b>) – siehe HOME_ASSISTANT.md.</p>' : "") +
      '<div class="ha-setup-row"><span class="ha-setup-label">Home Assistant</span>' +
      '<div class="ha-setup-account"><span>' + account + "</span>" + (s.base ? '<span class="ha-setup-server">' + esc(serverLabel(s.base)) + "</span>" : "") + "</div></div>" +
      '<div class="ha-setup-buttons">' +
      (s.mode ? '<button type="button" class="ha-pill-btn" data-setup="abmelden">Abmelden</button>' : '<button type="button" class="ha-pill-btn is-on" data-setup="anmelden">Anmelden …</button>') +
      '<button type="button" class="ha-pill-btn" data-setup="erweitert">Langzeit-Token …</button>' +
      '<button type="button" class="ha-pill-btn" data-setup="schliessen">Schließen</button>' +
      "</div>" +
      '<div class="ha-setup-advanced" id="haSetupAdvanced">' +
      '<label class="ha-setup-label">Adresse' + (servedHere ? " (leer = dieses Home Assistant)" : "") + "</label>" +
      '<input class="ha-setup-input" id="haSetupUrl" type="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="' + esc(defaultSetupUrl() || "http://homeassistant.local:8123") + '" value="' + esc(s.source === "gespeichert" ? s.base : "") + '">' +
      '<label class="ha-setup-label">Langlebiger Zugangstoken</label>' +
      '<input class="ha-setup-input" id="haSetupToken" type="password" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="HA: Profil → Sicherheit → Langlebige Zugangstoken">' +
      '<div class="ha-setup-buttons">' +
      '<button type="button" class="ha-pill-btn" data-setup="testen">Verbindung testen</button>' +
      '<button type="button" class="ha-pill-btn is-on" data-setup="speichern">Token speichern</button>' +
      "</div></div>" +
      '<div class="ha-setup-result" id="haSetupResult"></div>' +
      (window.TafelLernen
        ? '<div class="ha-setup-learned"><span class="ha-setup-label">Was die Tafel gelernt hat</span><ul>' +
          TafelLernen.beschreibung().map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" +
          '<button type="button" class="ha-pill-btn" data-setup="vergessen">Vergessen</button></div>'
        : "") +
      "</div>";
  }

  function defaultSetupUrl() {
    if (HA.servedFromHomeAssistant()) return location.protocol + "//" + location.host;
    return (CFG.url || "");
  }

  function closeSetup() {
    const dlg = document.getElementById("haSetup");
    if (!dlg) return;
    dlg.classList.remove("is-open");
    setupOpen = false;
    // Eingaben (Token!) nicht im DOM stehen lassen.
    setTimeout(function () { if (!dlg.classList.contains("is-open")) dlg.innerHTML = ""; }, 300);
    if (typeof deferCarouselAdvance === "function") deferCarouselAdvance();
  }

  // Lange (0,8 s) auf die Uhr drücken öffnet die Einrichtung — versteckt
  // genug, dass niemand aus Versehen hineingerät.
  function wireLongPress() {
    const clock = document.querySelector(".clock");
    if (!clock) return;
    let timer = null;
    const startPress = function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; openSetup(); }, 800);
    };
    const cancel = function () { if (timer) { clearTimeout(timer); timer = null; } };
    clock.addEventListener("touchstart", startPress, { passive: true });
    clock.addEventListener("touchend", cancel);
    clock.addEventListener("touchmove", cancel, { passive: true });
    clock.addEventListener("touchcancel", cancel);
    clock.addEventListener("mousedown", function () { if (Date.now() - lastTouchAt > 800) startPress(); });
    clock.addEventListener("mouseup", cancel);
    clock.addEventListener("mouseleave", cancel);
  }

  // ---------- Anbindung an app.js ----------
  function onPanelShown(name) {
    const prev = currentPanel;
    currentPanel = name;
    if (PANELS.indexOf(name) !== -1) {
      buildOnce();
      if (name === "home") renderHome();
      else if (name === "klima") renderKlima();
      else if (name === "medien") renderMedien();
    }
    if (name === "medien" && !mediaTicker) mediaTicker = setInterval(tickMedia, 1000);
    if (name !== "medien" && mediaTicker) { clearInterval(mediaTicker); mediaTicker = null; }
    // Medien-Panel beim Verlassen leeren: Cover-Bilder nicht im Speicher halten.
    if (prev === "medien" && name !== "medien" && els.medienBody) {
      setTimeout(function () { if (currentPanel !== "medien") setHtml(els.medienBody, ""); }, 900);
    }
    if (prev !== name) renderHints();
  }

  function init() {
    HA.on(function (type, a, b, c) {
      if (type === "status") {
        if (a !== "aus") buildOnce();
        if (a === "login-noetig") setTimeout(maybeAutoLogin, 300);
        scheduleFlush(0);
      } else if (type === "sync") {
        buildOnce();
        checkAbsence();
        scheduleFlush(0);
        // Verlauf für die Klima-Kurven schon vorab holen.
        setTimeout(maybeFetchHistory, 15000);
      } else if (type === "todo") {
        scheduleFlush();
      } else if (type === "state") {
        if (optimistic[a]) delete optimistic[a];
        onEntityChange(a, b, c);
        scheduleFlush();
      }
    });
    wireLongPress();
    const radioToggle = document.getElementById("radioToggle");
    if (radioToggle) radioToggle.addEventListener("click", function () { setActionsMenuOpen(false); });
    setInterval(minuteTick, 30 * 1000);
    HA.start();
  }

  window.TafelHAUI = {
    init: init,
    panelAvailable: panelAvailable,
    onPanelShown: onPanelShown,
    radioUmleiten: radioUmleiten,
    openSetup: openSetup,
    openRoom: openRoom,
    closeRoom: closeRoom,
    quickActions: function () { return HA.everReady() ? quickActions() : []; },
    refresh: function () { lastHintsAt = 0; scheduleFlush(0); },
    // Raumansicht/Einrichtung offen: Karussell bleibt stehen, auch wenn
    // darin getippt wird (siehe deferCarouselAdvance in app.js).
    showGreeting: showGreeting,
    morgengruss: function () {
      try { window.localStorage.removeItem(GRUSS_KEY); } catch (e) { /* egal */ }
      maybeMorningGreeting();
    },
    blocksCarousel: function () { return !!overlayRoomId || setupOpen || loginOpen; },
    hints: function () { return hints.slice(); },
    debug: function () {
      return {
        optimistic: Object.keys(optimistic).length,
        sliderSend: Object.keys(sliderSend).length,
        thermostatPending: Object.keys(thermostatPending).length,
        actionState: Object.keys(actionState).length,
        jumpedFor: Object.keys(jumpedFor).length,
        historyPoints: Object.keys(historyData).reduce(function (n, k) { return n + historyData[k].length; }, 0),
        domNodes: document.getElementsByTagName("*").length,
      };
    },
  };
})();
