// ---------------------------------------------------------------
// ha.js — Home-Assistant-Anbindung der Tafel, Teil 1: Verbindung + Daten
//
// Eigener, schlanker WebSocket-Client statt "home-assistant-js-websocket":
// die Bibliothek setzt Sprachmittel voraus, die Safari 12 (iPad Air 1)
// nicht kann. Hier deshalb nur ES2017: kein ?., kein ??, keine
// Klassenfelder, keine Module.
//
// Ablauf: Einstellungen lesen (Adresse + Token aus localStorage, nie aus
// dem Repo) → WebSocket /api/websocket → auth → state_changed abonnieren
// → get_states + Registries (Räume/Geräte/Entitäten) → danach nur noch
// Einzeländerungen. Bei Abbruch Wiederverbindung mit Backoff, Ping alle
// 30 s erkennt "halb tote" Verbindungen (WLAN weg, HA-Neustart).
//
// Ohne Adresse/Token, auf HTTPS mit http-Ziel (Mixed Content) oder bei
// ungültigem Token passiert schlicht nichts: TafelHA.status() meldet den
// Grund, alle HA-Panels bleiben ausgeblendet, keine Konsolenfehler.
// ---------------------------------------------------------------
(function () {
  "use strict";

  const HA_CFG = (typeof CONFIG !== "undefined" && CONFIG.homeAssistant) ? CONFIG.homeAssistant : {};
  const TOKEN_KEY = "tafelHaToken";
  const URL_KEY = "tafelHaUrl";
  // Anmeldung per Benutzername/Passwort (offizieller HA-Login-Ablauf):
  // gespeichert wird NUR das Refresh-Token ({base, clientId, refresh}),
  // nie das Passwort. Das kurzlebige Access-Token lebt nur im Speicher.
  const AUTH_KEY = "tafelHaAuth";

  const BACKOFF_S = [1, 2, 4, 8, 15, 30, 60];
  const PING_EVERY_MS = 30 * 1000;
  const PING_TIMEOUT_MS = 10 * 1000;
  const REQUEST_TIMEOUT_MS = 20 * 1000;
  const CONNECT_TIMEOUT_MS = 12 * 1000;

  // ---------- Einstellungen ----------
  // localStorage kann im privaten Modus von Safari beim Schreiben werfen —
  // dann eben ohne Speichern weiter, statt die ganze Tafel abstürzen zu lassen.
  function lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try {
      if (value) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
    } catch (e) { /* privat-Modus: ignorieren */ }
  }

  function normalizeBaseUrl(raw) {
    let url = String(raw || "").trim();
    if (!url) return "";
    url = url.replace(/\/api\/websocket\/?$/, "").replace(/\/+$/, "");
    url = url.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
    if (!/^https?:\/\//.test(url)) url = "http://" + url;
    return url;
  }

  // Einmalige Übergabe per URL (?ha_token=…&ha_url=…), z. B. per AirDrop-
  // Link aufs iPad: sofort in localStorage übernehmen und aus der
  // Adresszeile entfernen, damit der Token weder im Verlauf noch in einem
  // Lesezeichen/Home-Bildschirm-Icon landet. ?ha_aus=1 löscht beides.
  function takeUrlParams() {
    const search = window.location.search;
    if (!search || search.length < 2) return;
    const parts = search.slice(1).split("&");
    const keep = [];
    let changed = false;
    for (let i = 0; i < parts.length; i++) {
      const eq = parts[i].indexOf("=");
      const key = decodeURIComponent(eq === -1 ? parts[i] : parts[i].slice(0, eq));
      let value = eq === -1 ? "" : parts[i].slice(eq + 1);
      try { value = decodeURIComponent(value.replace(/\+/g, " ")); } catch (e) { value = ""; }
      if (key === "ha_token") { lsSet(TOKEN_KEY, value.trim()); changed = true; }
      else if (key === "ha_url") { lsSet(URL_KEY, normalizeBaseUrl(value)); changed = true; }
      else if (key === "ha_aus") { lsSet(TOKEN_KEY, null); lsSet(URL_KEY, null); changed = true; }
      else keep.push(parts[i]);
    }
    if (changed && window.history && window.history.replaceState) {
      const rest = keep.length ? "?" + keep.join("&") : "";
      window.history.replaceState(null, "", window.location.pathname + rest + window.location.hash);
    }
  }

  // Wird die Tafel direkt aus Home Assistant ausgeliefert (/local/tafel/…),
  // ist HA die eigene Herkunft: kein CORS, kein Mixed Content, keine
  // Adresse nötig.
  function servedFromHomeAssistant() {
    return /^\/(local|hacsfiles)\//.test(window.location.pathname) &&
      /^https?:$/.test(window.location.protocol);
  }

  function readAuth() {
    try {
      const a = JSON.parse(lsGet(AUTH_KEY) || "null");
      return a && a.refresh && a.base ? a : null;
    } catch (e) { return null; }
  }

  function resolveSettings() {
    const token = lsGet(TOKEN_KEY) || "";
    const auth = readAuth();
    let base = lsGet(URL_KEY) || "";
    let source = base ? "gespeichert" : "";
    if (!base && servedFromHomeAssistant()) {
      base = window.location.protocol + "//" + window.location.host;
      source = "herkunft";
    }
    if (!base && HA_CFG.url) {
      base = normalizeBaseUrl(HA_CFG.url);
      source = "config";
    }
    // Gespeicherte Anmeldung gehört zu genau einer Adresse.
    const login = auth && (!base || auth.base === base) ? auth : null;
    if (!base && login) { base = login.base; source = "anmeldung"; }
    const s = {
      base: base, token: token, source: source, wsUrl: "", problem: null,
      mode: token ? "token" : (login ? "login" : null), auth: login,
    };
    if (HA_CFG.aktiv === false) s.problem = "abgeschaltet";
    else if (!base) s.problem = "keine-adresse";
    else if (window.location.protocol === "https:" && /^http:/.test(base)) s.problem = "mixed-content";
    else if (!s.mode) s.problem = "login-noetig";
    else if (typeof window.WebSocket === "undefined") s.problem = "kein-websocket";
    if (!s.problem) s.wsUrl = base.replace(/^http/, "ws") + "/api/websocket";
    return s;
  }

  // ---------- WebSocket-Verbindung ----------
  // getToken(): Promise mit dem Token für die auth-Nachricht (Langzeit-
  // Token oder frisch erneuertes Access-Token).
  // hooks: onState(state, detail), onReady(), onDisconnect(), onAuthInvalid()
  // Zustände: "verbinde" | "verbunden" | "getrennt" | "token-ungueltig" |
  // "login-noetig" | "gestoppt"
  function createConnection(wsUrl, getToken, hooks) {
    let ws = null;
    let nextId = 1;
    let pending = {};
    let eventHandlers = {};
    let state = "getrennt";
    let attempt = 0;
    let reconnectTimer = null;
    let pingTimer = null;
    let connectWatchdog = null;
    let stopped = false;
    let lastMessageAt = 0;

    function setState(next, detail) {
      if (state === next) return;
      state = next;
      if (hooks.onState) hooks.onState(next, detail || "");
    }

    function sendRaw(obj) {
      if (!ws || ws.readyState !== 1) return false;
      try { ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    }

    function open() {
      if (stopped || ws) return;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      setState("verbinde");
      let sock;
      try {
        sock = new WebSocket(wsUrl);
      } catch (e) {
        setState("getrennt", "Adresse ungültig");
        scheduleReconnect();
        return;
      }
      ws = sock;
      nextId = 1;
      // iOS hält einen hängenden Verbindungsaufbau gern minutenlang offen —
      // eigener Zeitdeckel statt auf den Browser zu warten.
      connectWatchdog = setTimeout(function () {
        connectWatchdog = null;
        if (ws === sock && state !== "verbunden") dropSocket(sock);
      }, CONNECT_TIMEOUT_MS);
      sock.onmessage = function (ev) {
        if (ws !== sock) return;
        lastMessageAt = Date.now();
        handleRaw(ev.data);
      };
      sock.onclose = function () { handleClose(sock); };
      sock.onerror = function () { /* onclose folgt immer */ };
    }

    function dropSocket(sock) {
      try { sock.close(); } catch (e) { /* egal */ }
      handleClose(sock);
    }

    function handleClose(sock) {
      if (ws !== sock) return;
      ws = null;
      sock.onmessage = null;
      sock.onclose = null;
      sock.onerror = null;
      if (connectWatchdog) { clearTimeout(connectWatchdog); connectWatchdog = null; }
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      // Offene Anfragen sofort abschließen statt sie bis zum Timeout im
      // Speicher hängen zu lassen.
      const ids = Object.keys(pending);
      const old = pending;
      pending = {};
      eventHandlers = {};
      for (let i = 0; i < ids.length; i++) {
        clearTimeout(old[ids[i]].timer);
        old[ids[i]].reject(new Error("Verbindung getrennt"));
      }
      if (stopped || state === "token-ungueltig") return;
      setState("getrennt");
      if (hooks.onDisconnect) hooks.onDisconnect();
      scheduleReconnect();
    }

    function scheduleReconnect() {
      if (stopped || reconnectTimer) return;
      const base = BACKOFF_S[Math.min(attempt, BACKOFF_S.length - 1)] * 1000;
      attempt++;
      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        open();
      }, base + Math.floor(Math.random() * 800));
    }

    function handleRaw(data) {
      let msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      // Mit coalesce_messages bündelt HA mehrere Nachrichten in einem Array.
      if (Array.isArray(msg)) {
        for (let i = 0; i < msg.length; i++) handleMessage(msg[i]);
      } else {
        handleMessage(msg);
      }
    }

    function handleMessage(msg) {
      if (!msg || !msg.type) return;
      if (msg.type === "auth_required") {
        const sock = ws;
        getToken().then(function (token) {
          if (ws === sock) sendRaw({ type: "auth", access_token: token });
        }, function (err) {
          if (ws !== sock) return;
          if (err && err.code === "invalid_grant") {
            // Anmeldung widerrufen/abgelaufen: neu anmelden statt endlos zu versuchen.
            stopped = true;
            setState("login-noetig", "Anmeldung abgelaufen");
          }
          dropSocket(sock);
        });
      } else if (msg.type === "auth_ok") {
        if (connectWatchdog) { clearTimeout(connectWatchdog); connectWatchdog = null; }
        attempt = 0;
        setState("verbunden", msg.ha_version || "");
        request({ type: "supported_features", features: { coalesce_messages: 1 } }).catch(function () {});
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(ping, PING_EVERY_MS);
        if (hooks.onReady) hooks.onReady();
      } else if (msg.type === "auth_invalid") {
        // Langzeit-Token: kein Wiederverbinden — mit demselben Token klappt
        // es nie, und HA sperrt IPs nach zu vielen Fehlversuchen. Bei
        // Anmeldung: Access-Token war abgelaufen → einmal erneuern.
        const retry = hooks.onAuthInvalid ? hooks.onAuthInvalid() : false;
        if (!retry) {
          setState("token-ungueltig", msg.message || "");
          stopped = true;
        }
        if (ws) dropSocket(ws);
      } else if (msg.type === "result" || msg.type === "pong") {
        const p = pending[msg.id];
        if (!p) return;
        delete pending[msg.id];
        clearTimeout(p.timer);
        if (msg.type === "pong" || msg.success) {
          p.resolve(msg.result);
        } else {
          const err = new Error((msg.error && msg.error.message) || "Fehler");
          err.code = msg.error ? msg.error.code : "";
          // Ein fehlgeschlagenes Abo braucht keinen Event-Handler mehr.
          delete eventHandlers[msg.id];
          p.reject(err);
        }
      } else if (msg.type === "event") {
        const handler = eventHandlers[msg.id];
        if (handler) {
          try { handler(msg.event); } catch (e) {
            if (window.console) console.warn("HA: Fehler bei Ereignis", e);
          }
        }
      }
    }

    function ping() {
      if (!ws || state !== "verbunden") return;
      // Kam in den letzten Sekunden ohnehin etwas an, lebt die Verbindung.
      if (Date.now() - lastMessageAt < 5000) return;
      const sock = ws;
      request({ type: "ping" }, PING_TIMEOUT_MS).catch(function () {
        if (ws === sock) dropSocket(sock);
      });
    }

    // onEvent: Handler für Abos (subscribe_events) — vor dem Senden
    // registriert, damit kein Ereignis zwischen Antwort und Registrierung
    // verloren geht.
    function request(msg, timeoutMs, onEvent) {
      return new Promise(function (resolve, reject) {
        if (!ws || ws.readyState !== 1 || state !== "verbunden") {
          reject(new Error("nicht verbunden"));
          return;
        }
        const id = nextId++;
        msg.id = id;
        const timer = setTimeout(function () {
          if (!pending[id]) return;
          delete pending[id];
          delete eventHandlers[id];
          reject(new Error("Zeitüberschreitung"));
        }, timeoutMs || REQUEST_TIMEOUT_MS);
        pending[id] = { resolve: resolve, reject: reject, timer: timer };
        if (onEvent) eventHandlers[id] = onEvent;
        if (!sendRaw(msg)) {
          clearTimeout(timer);
          delete pending[id];
          delete eventHandlers[id];
          reject(new Error("Senden fehlgeschlagen"));
        }
      });
    }

    function reconnectNow() {
      if (stopped || ws) return;
      attempt = 0;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      open();
    }

    function stop() {
      stopped = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (ws) dropSocket(ws);
      setState("gestoppt");
    }

    return {
      open: open,
      stop: stop,
      request: request,
      reconnectNow: reconnectNow,
      forceReconnect: function () { if (ws) dropSocket(ws); },
      state: function () { return state; },
      isOpen: function () { return state === "verbunden"; },
      pendingCount: function () { return Object.keys(pending).length; },
    };
  }

  // ---------- HTTP + Anmeldung (Login-Ablauf, Token-Erneuerung) ----------
  // fetch ohne AbortController (gibt es erst ab Safari 12.1): eigener
  // Zeitdeckel per Promise-Wettlauf.
  function httpPost(url, body, contentType, timeoutMs) {
    return new Promise(function (resolve, reject) {
      let done = false;
      const timer = setTimeout(function () {
        if (done) return;
        done = true;
        const err = new Error("Zeitüberschreitung");
        err.code = "netz";
        reject(err);
      }, timeoutMs || 15000);
      fetch(url, { method: "POST", headers: { "Content-Type": contentType }, body: body, credentials: "omit" })
        .then(function (res) {
          return res.text().then(function (text) {
            let data = null;
            try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
            return { status: res.status, data: data };
          });
        })
        .then(function (r) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (r.status >= 200 && r.status < 300) { resolve(r.data); return; }
          const err = new Error((r.data && (r.data.error_description || r.data.message || r.data.error)) || ("HTTP " + r.status));
          err.code = r.data && r.data.error ? r.data.error : "http_" + r.status;
          err.status = r.status;
          reject(err);
        }, function () {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const err = new Error("Home Assistant nicht erreichbar");
          err.code = "netz";
          reject(err);
        });
    });
  }

  function postForm(url, fields) {
    const body = Object.keys(fields).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(fields[k]);
    }).join("&");
    return httpPost(url, body, "application/x-www-form-urlencoded");
  }

  function postJson(url, obj) {
    return httpPost(url, JSON.stringify(obj), "application/json");
  }

  let accessToken = null;
  let accessExpires = 0;
  let refreshing = null;
  let authInvalidCount = 0;
  let pendingLogin = null;

  function getAccessToken() {
    if (settings.mode === "token") return Promise.resolve(settings.token);
    if (accessToken && Date.now() < accessExpires - 60 * 1000) return Promise.resolve(accessToken);
    return refreshAccess();
  }

  function refreshAccess() {
    if (refreshing) return refreshing;
    const auth = settings.auth;
    if (!auth) {
      const err = new Error("Nicht angemeldet");
      err.code = "invalid_grant";
      return Promise.reject(err);
    }
    refreshing = postForm(auth.base + "/auth/token", {
      grant_type: "refresh_token",
      refresh_token: auth.refresh,
      client_id: auth.clientId,
    }).then(function (res) {
      refreshing = null;
      if (!res || !res.access_token) throw new Error("Keine Antwort");
      accessToken = res.access_token;
      accessExpires = Date.now() + (res.expires_in || 1800) * 1000;
      return accessToken;
    }, function (err) {
      refreshing = null;
      // Refresh-Token widerrufen/abgelaufen: Anmeldung löschen, neu anmelden.
      if (err && (err.code === "invalid_grant" || err.status === 400 || err.status === 401)) {
        err.code = "invalid_grant";
        lsSet(AUTH_KEY, null);
        settings.auth = null;
      }
      throw err;
    });
    return refreshing;
  }

  // Die Tafel-Seite selbst ist der "Client" im Sinne von HA (IndieAuth):
  // client_id = eigene Herkunft, redirect_uri = eigene Seite.
  function ownOrigin() {
    return window.location.protocol + "//" + window.location.host;
  }

  function describeStep(res) {
    if (!res) return { fehler: "keine_antwort" };
    if (res.type === "form") {
      return {
        schritt: res.step_id,
        fehler: res.errors && res.errors.base ? res.errors.base : null,
        felder: (res.data_schema || []).map(function (f) { return f.name; }),
        mfaName: res.description_placeholders && res.description_placeholders.mfa_module_name,
      };
    }
    if (res.type === "abort") return { abbruch: res.reason || "abgebrochen" };
    if (res.type === "create_entry") return { code: res.result };
    return { fehler: "unbekannt" };
  }

  function loginBegin(baseRaw) {
    const base = normalizeBaseUrl(baseRaw) || settings.base;
    if (!base) return Promise.reject(new Error("Keine Adresse"));
    if (window.location.protocol === "https:" && /^http:/.test(base)) {
      return Promise.reject(new Error("Von dieser HTTPS-Seite aus blockiert Safari http://-Adressen"));
    }
    const clientId = ownOrigin() + "/";
    return postJson(base + "/auth/login_flow", {
      client_id: clientId,
      handler: ["homeassistant", null],
      redirect_uri: ownOrigin() + window.location.pathname,
    }).then(function (res) {
      pendingLogin = { base: base, clientId: clientId, flowId: res && res.flow_id };
      return describeStep(res);
    });
  }

  // data: {username, password} bzw. {code} im MFA-Schritt.
  function loginSubmit(data) {
    if (!pendingLogin || !pendingLogin.flowId) return Promise.reject(new Error("Kein Anmeldevorgang"));
    const p = pendingLogin;
    const body = { client_id: p.clientId };
    Object.keys(data || {}).forEach(function (k) { body[k] = data[k]; });
    return postJson(p.base + "/auth/login_flow/" + encodeURIComponent(p.flowId), body).then(function (res) {
      const step = describeStep(res);
      if (!step.code) {
        if (step.abbruch) pendingLogin = null;
        return step;
      }
      return postForm(p.base + "/auth/token", {
        grant_type: "authorization_code",
        code: step.code,
        client_id: p.clientId,
      }).then(function (tok) {
        pendingLogin = null;
        lsSet(AUTH_KEY, JSON.stringify({ base: p.base, clientId: p.clientId, refresh: tok.refresh_token }));
        lsSet(TOKEN_KEY, null);
        lsSet(URL_KEY, p.base === ownOrigin() && servedFromHomeAssistant() ? null : p.base);
        accessToken = tok.access_token;
        accessExpires = Date.now() + (tok.expires_in || 1800) * 1000;
        restart();
        return { fertig: true };
      });
    });
  }

  function logout() {
    const a = settings.auth || readAuth();
    if (a) postForm(a.base + "/auth/token", { action: "revoke", token: a.refresh }).catch(function () {});
    lsSet(AUTH_KEY, null);
    lsSet(TOKEN_KEY, null);
    accessToken = null;
    accessExpires = 0;
    restart();
  }

  // ---------- Datenbestand ----------
  const store = {
    states: {},
    areas: [],
    areaById: {},
    devices: {},
    entities: {},
    hasRegistry: false,
    everReady: false,
    lastSyncAt: 0,
    lastChangeAt: 0,
    disconnectedAt: 0,
    version: 0,
    userName: "",
  };

  let settings = resolveSettings();
  let conn = null;
  let status = "aus";
  let statusDetail = "";
  const listeners = [];

  function emit(type, a, b, c) {
    for (let i = 0; i < listeners.length; i++) {
      try { listeners[i](type, a, b, c); } catch (e) {
        if (window.console) console.warn("HA: Listener-Fehler", e);
      }
    }
  }

  function setStatus(next, detail) {
    status = next;
    statusDetail = detail || "";
    if (next === "getrennt" && !store.disconnectedAt) store.disconnectedAt = Date.now();
    if (next === "verbunden") store.disconnectedAt = 0;
    emit("status", next, statusDetail);
  }

  // Kompaktformat von list_for_display (HA ≥ 2023.3) und Vollformat von
  // list auf dieselbe kleine Struktur bringen.
  function registryFromDisplay(res) {
    const cats = (res && res.entity_categories) || {};
    const list = (res && res.entities) || [];
    const out = {};
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      out[e.ei] = {
        area_id: e.ai || null,
        device_id: e.di || null,
        hidden: !!e.hb,
        category: e.ec != null ? (cats[e.ec] || "andere") : null,
        name: e.en || null,
        platform: e.pl || "",
      };
    }
    return out;
  }

  function registryFromFull(list) {
    const out = {};
    for (let i = 0; i < (list || []).length; i++) {
      const e = list[i];
      if (e.disabled_by) continue;
      out[e.entity_id] = {
        area_id: e.area_id || null,
        device_id: e.device_id || null,
        hidden: !!e.hidden_by,
        category: e.entity_category || null,
        name: e.name || null,
        platform: e.platform || "",
      };
    }
    return out;
  }

  // ---------- To-do-Listen (z. B. Einkaufsliste) ----------
  // HA ≥ 2023.11: todo/item/subscribe schickt die Liste sofort und bei
  // jeder Änderung. Ältere Versionen: einmal laden und bei jeder
  // Zustandsänderung der todo-Entität (Anzahl offener Einträge) neu laden.
  const todoItems = {};
  const todoSubscribed = {};

  function listTodo(c, id) {
    c.request({ type: "todo/item/list", entity_id: id }).then(function (res) {
      todoItems[id] = (res && res.items) || [];
      store.version++;
      emit("todo", id);
    }).catch(function () {});
  }

  // Höchstens drei Listen abonnieren – aber die, die die Tafel zeigt
  // (eingestellte Einkaufsliste bzw. "einkauf|shopping"), immer zuerst.
  function syncTodos(c) {
    const cfg = typeof CONFIG !== "undefined" && CONFIG.homeAssistant ? CONFIG.homeAssistant.einkaufsliste : "";
    const alle = model().global.todos;
    const rang = function (id) {
      if (cfg && id === cfg) return 0;
      return /einkauf|shopping/i.test(id + " " + friendlyName(id)) ? 1 : 2;
    };
    const ids = alle.slice().sort(function (a, b) {
      return (rang(a) - rang(b)) || (alle.indexOf(a) - alle.indexOf(b));
    }).slice(0, 3);
    ids.forEach(function (id) {
      todoSubscribed[id] = false;
      c.request({ type: "todo/item/subscribe", entity_id: id }, REQUEST_TIMEOUT_MS, function (ev) {
        todoItems[id] = (ev && ev.items) || [];
        store.version++;
        emit("todo", id);
      }).then(function () {
        todoSubscribed[id] = true;
      }).catch(function () {
        todoSubscribed[id] = false;
      });
      listTodo(c, id);
    });
  }

  function onStateChanged(event) {
    const d = event && event.data;
    if (!d || !d.entity_id) return;
    if (domainOf(d.entity_id) === "todo" && !todoSubscribed[d.entity_id] && conn) listTodo(conn, d.entity_id);
    if (d.new_state) store.states[d.entity_id] = d.new_state;
    else delete store.states[d.entity_id];
    store.version++;
    store.lastChangeAt = Date.now();
    emit("state", d.entity_id, d.new_state, d.old_state);
  }

  function syncAll() {
    const c = conn;
    if (!c) return;
    // Erst abonnieren, dann Zustände holen: HA arbeitet die Nachrichten
    // einer Verbindung der Reihe nach ab, dadurch geht zwischen Snapshot
    // und Abo keine Änderung verloren.
    const sub = c.request({ type: "subscribe_events", event_type: "state_changed" }, REQUEST_TIMEOUT_MS, onStateChanged);
    const states = c.request({ type: "get_states" }, 30000);
    // Registries sind "nice to have" (Raumzuordnung) — schlägt eine fehl,
    // läuft die Tafel trotzdem, nur ohne Räume.
    const areas = c.request({ type: "config/area_registry/list" }, 30000).catch(function () { return null; });
    const devices = c.request({ type: "config/device_registry/list" }, 30000).catch(function () { return null; });
    const entities = c.request({ type: "config/entity_registry/list_for_display" }, 30000)
      .then(registryFromDisplay)
      .catch(function () {
        return c.request({ type: "config/entity_registry/list" }, 30000)
          .then(registryFromFull)
          .catch(function () { return null; });
      });

    c.request({ type: "auth/current_user" }).then(function (u) {
      store.userName = u && u.name ? u.name : "";
    }).catch(function () {});

    Promise.all([sub, states, areas, devices, entities]).then(function (r) {
      if (c !== conn) return;
      const nextStates = {};
      const list = r[1] || [];
      for (let i = 0; i < list.length; i++) nextStates[list[i].entity_id] = list[i];
      store.states = nextStates;

      if (r[2]) {
        store.areas = r[2].map(function (a) { return { area_id: a.area_id, name: a.name, icon: a.icon || null }; });
        store.areaById = {};
        for (let i = 0; i < store.areas.length; i++) store.areaById[store.areas[i].area_id] = store.areas[i];
      }
      if (r[3]) {
        const devs = {};
        for (let i = 0; i < r[3].length; i++) {
          const d = r[3][i];
          devs[d.id] = { area_id: d.area_id || null, name: d.name_by_user || d.name || "" };
        }
        store.devices = devs;
      }
      if (r[4]) {
        store.entities = r[4];
        store.hasRegistry = true;
      }
      store.version++;
      store.lastSyncAt = Date.now();
      const first = !store.everReady;
      store.everReady = true;
      emit("sync", first);
      syncTodos(c);
    }).catch(function (err) {
      if (c !== conn) return;
      if (window.console) console.warn("HA: Synchronisierung fehlgeschlagen –", err && err.message);
      c.forceReconnect();
    });
  }

  function start() {
    takeUrlParams();
    settings = resolveSettings();
    authInvalidCount = 0;
    if (settings.problem) {
      const quiet = settings.problem === "keine-adresse" || settings.problem === "abgeschaltet";
      setStatus(quiet ? "aus" : settings.problem, settings.problem);
      return;
    }
    conn = createConnection(settings.wsUrl, getAccessToken, {
      onState: function (s, detail) {
        if (s === "login-noetig") { lsSet(AUTH_KEY, null); settings.auth = null; }
        setStatus(s, detail);
      },
      onReady: function () { authInvalidCount = 0; syncAll(); },
      onDisconnect: function () { emit("getrennt"); },
      // Access-Token abgelehnt: bei Anmeldung höchstens zweimal erneuern.
      onAuthInvalid: function () {
        if (settings.mode !== "login") return false;
        accessToken = null;
        accessExpires = 0;
        authInvalidCount++;
        return authInvalidCount <= 2;
      },
    });
    conn.open();
  }

  function restart() {
    if (conn) { const old = conn; conn = null; old.stop(); }
    store.states = {};
    store.everReady = false;
    store.version++;
    start();
    emit("sync", true);
  }

  // Display wieder an / App wieder im Vordergrund / Netz wieder da:
  // sofort neu verbinden statt den Backoff (bis 60 s) abzuwarten.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && conn) conn.reconnectNow();
  });
  window.addEventListener("online", function () { if (conn) conn.reconnectNow(); });

  // ---------- Dienste & Verlauf ----------
  function callService(domain, service, data, target) {
    if (!conn || !conn.isOpen()) return Promise.reject(new Error("Keine Verbindung zu Home Assistant"));
    const msg = { type: "call_service", domain: domain, service: service };
    if (data) msg.service_data = data;
    if (target) msg.target = target;
    return conn.request(msg, 15000);
  }

  // Liefert {entity_id: [[ms, wert], …]} — nur Zahlen, für Mini-Kurven.
  function fetchHistory(entityIds, hours) {
    if (!conn || !conn.isOpen() || !entityIds.length) return Promise.resolve({});
    const start = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    return conn.request({
      type: "history/history_during_period",
      start_time: start,
      entity_ids: entityIds,
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
    }, 30000).then(function (res) {
      const out = {};
      const ids = Object.keys(res || {});
      for (let i = 0; i < ids.length; i++) {
        const raw = res[ids[i]] || [];
        const pts = [];
        for (let j = 0; j < raw.length; j++) {
          const p = raw[j];
          const v = parseFloat(p.s != null ? p.s : p.state);
          let t = p.lu != null ? p.lu * 1000 : Date.parse(p.last_updated || p.last_changed);
          if (p.lc != null && p.lu == null) t = p.lc * 1000;
          if (isFinite(v) && isFinite(t)) pts.push([t, v]);
        }
        out[ids[i]] = pts;
      }
      return out;
    });
  }

  // Verbindung nur zum Prüfen (Einrichtungsdialog): auth und sofort wieder zu.
  function testConnection(baseRaw, token) {
    return new Promise(function (resolve) {
      const base = normalizeBaseUrl(baseRaw);
      if (!base) { resolve({ ok: false, grund: "Keine Adresse" }); return; }
      if (window.location.protocol === "https:" && /^http:/.test(base)) {
        resolve({ ok: false, grund: "Diese Seite läuft über HTTPS – eine http://-Adresse blockiert Safari (Mixed Content). Tafel direkt aus Home Assistant öffnen (siehe HOME_ASSISTANT.md)." });
        return;
      }
      let sock;
      let done = false;
      function finish(result) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (sock) {
          sock.onmessage = null; sock.onclose = null; sock.onerror = null;
          try { sock.close(); } catch (e) { /* egal */ }
        }
        resolve(result);
      }
      const timer = setTimeout(function () { finish({ ok: false, grund: "Keine Antwort (Adresse/WLAN prüfen)" }); }, 8000);
      try {
        sock = new WebSocket(base.replace(/^http/, "ws") + "/api/websocket");
      } catch (e) {
        finish({ ok: false, grund: "Adresse ungültig" });
        return;
      }
      sock.onmessage = function (ev) {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.type === "auth_required") {
          try { sock.send(JSON.stringify({ type: "auth", access_token: token })); } catch (e) { finish({ ok: false, grund: "Senden fehlgeschlagen" }); }
        } else if (msg.type === "auth_ok") {
          finish({ ok: true, version: msg.ha_version || "" });
        } else if (msg.type === "auth_invalid") {
          finish({ ok: false, grund: "Token ungültig" });
        }
      };
      sock.onclose = function () { finish({ ok: false, grund: "Verbindung abgelehnt (Adresse/Port prüfen)" }); };
      sock.onerror = function () { /* onclose folgt */ };
    });
  }

  // ---------- Modell: Räume, Namen, Zustände ----------
  function domainOf(id) { return id.slice(0, id.indexOf(".")); }

  function attr(st, key) {
    return st && st.attributes ? st.attributes[key] : undefined;
  }

  function isUnavailable(st) {
    return !st || st.state === "unavailable";
  }

  function numState(st) {
    if (!st) return null;
    const v = parseFloat(st.state);
    return isFinite(v) ? v : null;
  }

  function areaIdOf(entityId) {
    const reg = store.entities[entityId];
    if (!reg) return null;
    if (reg.area_id) return reg.area_id;
    const dev = reg.device_id ? store.devices[reg.device_id] : null;
    return dev ? dev.area_id : null;
  }

  function friendlyName(entityId) {
    const st = store.states[entityId];
    const fn = attr(st, "friendly_name");
    if (fn) return String(fn);
    const reg = store.entities[entityId];
    if (reg && reg.name) return reg.name;
    return entityId.slice(entityId.indexOf(".") + 1).replace(/_/g, " ");
  }

  // "Wohnzimmer Stehlampe" im Raum Wohnzimmer → "Stehlampe".
  function shortName(entityId, roomName) {
    const st = store.states[entityId];
    // Hue-Szenen bringen ihren Kurznamen selbst mit.
    if (domainOf(entityId) === "scene" && attr(st, "name")) return String(attr(st, "name"));
    const full = friendlyName(entityId);
    const group = attr(st, "group_name");
    if (group && full.indexOf(group + " ") === 0) return full.slice(group.length + 1);
    if (roomName) {
      const lower = full.toLowerCase();
      const prefix = roomName.toLowerCase();
      if (lower.indexOf(prefix) === 0 && full.length > roomName.length + 1) {
        const rest = full.slice(roomName.length).replace(/^[\s:\-–]+/, "");
        if (rest) return rest.charAt(0).toUpperCase() + rest.slice(1);
      }
    }
    return full;
  }

  function isLightGroup(st) {
    return !!(attr(st, "is_hue_group") || Array.isArray(attr(st, "entity_id")) || Array.isArray(attr(st, "lights")));
  }

  function listHas(list, value) {
    return !!(list && list.indexOf(value) !== -1);
  }

  function isExcluded(entityId) {
    return listHas(HA_CFG.ausblenden, entityId);
  }

  const MOTION_CLASSES = ["motion", "occupancy", "presence"];
  const OPENING_CLASSES = ["window", "door", "opening", "garage_door"];

  function emptyRoom(id, name) {
    return {
      id: id, name: name,
      lights: [], lightGroups: [], scenes: [], sceneSelects: [], climates: [], temps: [], hums: [],
      illums: [], openings: [], motions: [], media: [], switches: [], powers: [], vacuums: [], others: [],
    };
  }

  let roomsCache = null;
  let roomsCacheVersion = -1;

  function buildModel() {
    const rooms = {};
    const order = [];
    const global = {
      persons: [], scripts: [], scenes: [], batteries: [], unavailable: [], vacuums: [],
      media: [], powerTotal: null, washers: [], inputBooleans: [], automations: [], lightsAll: [],
      todos: [], weather: null,
    };
    const ids = Object.keys(store.states);
    ids.sort();

    function roomFor(areaId) {
      if (!rooms[areaId]) {
        const area = store.areaById[areaId];
        rooms[areaId] = emptyRoom(areaId, area ? area.name : (areaId === "_ohne" ? "Weitere Geräte" : areaId));
      }
      return rooms[areaId];
    }

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (isExcluded(id)) continue;
      const st = store.states[id];
      const dom = domainOf(id);
      const reg = store.entities[id];
      const dc = attr(st, "device_class");

      // Batterien sind meist "diagnostic" — trotzdem für Hinweise sammeln.
      if (dom === "sensor" && dc === "battery") {
        global.batteries.push(id);
        continue;
      }
      if (reg && (reg.hidden || reg.category)) continue;

      if (dom === "person") { global.persons.push(id); continue; }
      if (dom === "script") { global.scripts.push(id); continue; }
      if (dom === "input_boolean") { global.inputBooleans.push(id); continue; }
      if (dom === "automation") { global.automations.push(id); continue; }
      if (dom === "todo") { global.todos.push(id); continue; }
      if (dom === "weather") { if (!global.weather) global.weather = id; continue; }
      // Hue-Bridge-Automationen tauchen als Schalter auf — keine Geräte.
      if (dom === "switch" && (/_automation_/.test(id) || /^automation[:\s]/i.test(String(attr(st, "friendly_name") || "")))) continue;
      if (/wasch|washer|washing/i.test(id) && (dom === "sensor" || dom === "binary_sensor")) global.washers.push(id);

      const relevant = ["light", "scene", "select", "climate", "sensor", "binary_sensor", "media_player", "switch", "vacuum", "fan", "cover"];
      // Von den select-Entitäten interessieren nur die Hue-Szenenwähler.
      if (dom === "select" && !/szene|scene/i.test(id)) continue;
      if (!listHas(relevant, dom)) continue;

      if (st.state === "unavailable" && dom !== "scene" && dom !== "select") global.unavailable.push(id);

      let areaId = areaIdOf(id);
      if (dom === "vacuum") global.vacuums.push(id);
      if (dom === "media_player") global.media.push(id);
      if (dom === "scene") global.scenes.push(id);
      if (dom === "sensor" && dc === "power" && !areaId) {
        // Größter Leistungs-Sensor ohne Raum = Gesamtverbrauch der Wohnung.
        const v = numState(st);
        if (v != null && (global.powerTotal == null || v > (numState(store.states[global.powerTotal]) || 0))) global.powerTotal = id;
        continue;
      }
      if (!areaId) {
        // Szenen ohne Raum (z. B. per scene.create angelegte) gehören nicht
        // in die Raum-Ansicht; Lichter/Schalter/Medien ohne Raum schon.
        if (dom === "scene" || dom === "select" || dom === "sensor" || dom === "binary_sensor") continue;
        areaId = "_ohne";
      }
      const r = roomFor(areaId);

      if (dom === "light") {
        if (isLightGroup(st)) r.lightGroups.push(id);
        else { r.lights.push(id); global.lightsAll.push(id); }
      } else if (dom === "scene") r.scenes.push(id);
      else if (dom === "select") r.sceneSelects.push(id);
      else if (dom === "climate") r.climates.push(id);
      else if (dom === "sensor") {
        if (dc === "temperature") r.temps.push(id);
        else if (dc === "humidity") r.hums.push(id);
        else if (dc === "power") r.powers.push(id);
        else if (dc === "illuminance") r.illums.push(id);
      } else if (dom === "binary_sensor") {
        if (listHas(OPENING_CLASSES, dc)) r.openings.push(id);
        else if (listHas(MOTION_CLASSES, dc)) r.motions.push(id);
      } else if (dom === "media_player") r.media.push(id);
      else if (dom === "switch") r.switches.push(id);
      else if (dom === "vacuum") r.vacuums.push(id);
      else r.others.push(id);
    }

    // Reihenfolge: config.raumReihenfolge (Namen oder area_ids), dann wie in HA.
    const wanted = HA_CFG.raumReihenfolge || [];
    const seen = {};
    function pushRoom(areaId) {
      if (seen[areaId] || !rooms[areaId]) return;
      seen[areaId] = true;
      order.push(rooms[areaId]);
    }
    for (let i = 0; i < wanted.length; i++) {
      const w = String(wanted[i]).toLowerCase();
      const keys = Object.keys(rooms);
      for (let k = 0; k < keys.length; k++) {
        if (keys[k].toLowerCase() === w || rooms[keys[k]].name.toLowerCase() === w) pushRoom(keys[k]);
      }
    }
    for (let i = 0; i < store.areas.length; i++) pushRoom(store.areas[i].area_id);
    const restKeys = Object.keys(rooms).sort();
    for (let i = 0; i < restKeys.length; i++) if (restKeys[i] !== "_ohne") pushRoom(restKeys[i]);
    pushRoom("_ohne");

    // Nur Räume mit etwas Sinnvollem drin.
    const visible = order.filter(function (r) {
      return r.lights.length || r.climates.length || r.temps.length || r.openings.length ||
        r.media.length || r.switches.length || r.scenes.length;
    });

    return { rooms: visible, byId: rooms, global: global };
  }

  function model() {
    if (!roomsCache || roomsCacheVersion !== store.version) {
      roomsCache = buildModel();
      roomsCacheVersion = store.version;
    }
    return roomsCache;
  }

  function average(values) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < values.length; i++) {
      if (values[i] != null && isFinite(values[i])) { sum += values[i]; n++; }
    }
    return n ? sum / n : null;
  }

  // Kennzahlen eines Raums für Kacheln/Hinweise.
  function roomSummary(room) {
    const s = store.states;
    let lightsOn = 0;
    let lightsAvail = 0;
    let brightnessSum = 0;
    for (let i = 0; i < room.lights.length; i++) {
      const st = s[room.lights[i]];
      if (isUnavailable(st)) continue;
      lightsAvail++;
      if (st.state === "on") {
        lightsOn++;
        brightnessSum += attr(st, "brightness") != null ? attr(st, "brightness") : 255;
      }
    }
    const temps = room.temps.map(function (id) { return numState(s[id]); });
    let temp = average(temps);
    let heating = false;
    let target = null;
    let climateOn = false;
    for (let i = 0; i < room.climates.length; i++) {
      const st = s[room.climates[i]];
      if (isUnavailable(st)) continue;
      if (temp == null && attr(st, "current_temperature") != null) temp = attr(st, "current_temperature");
      if (st.state !== "off") climateOn = true;
      if (attr(st, "hvac_action") === "heating") heating = true;
      if (attr(st, "temperature") != null) target = attr(st, "temperature");
    }
    const hum = average(room.hums.map(function (id) { return numState(s[id]); }));
    const open = room.openings.filter(function (id) { return s[id] && s[id].state === "on"; });
    const motion = room.motions.some(function (id) { return s[id] && s[id].state === "on"; });
    const playing = room.media.filter(function (id) { return s[id] && s[id].state === "playing"; });
    return {
      lightsOn: lightsOn,
      lightsAvail: lightsAvail,
      brightnessPct: lightsOn ? Math.round(brightnessSum / lightsOn / 2.55) : 0,
      temp: temp,
      hum: hum,
      heating: heating,
      climateOn: climateOn,
      target: target,
      openIds: open,
      motion: motion,
      playing: playing,
    };
  }

  function personsHome() {
    const g = model().global;
    const home = [];
    for (let i = 0; i < g.persons.length; i++) {
      const st = store.states[g.persons[i]];
      if (st && st.state === "home") home.push(g.persons[i]);
    }
    return home;
  }

  function on(fn) {
    if (listeners.indexOf(fn) === -1) listeners.push(fn);
  }

  window.TafelHA = {
    cfg: HA_CFG,
    start: start,
    restart: restart,
    on: on,
    status: function () { return status; },
    statusDetail: function () { return statusDetail; },
    settings: function () { return settings; },
    saveSettings: function (url, token) {
      lsSet(URL_KEY, normalizeBaseUrl(url));
      lsSet(TOKEN_KEY, String(token || "").trim());
      restart();
    },
    clearSettings: function () {
      lsSet(URL_KEY, null);
      lsSet(TOKEN_KEY, null);
      lsSet(AUTH_KEY, null);
      accessToken = null;
      restart();
    },
    todoItems: function (id) { return todoItems[id] || null; },
    // Allgemeine WebSocket-Anfrage (z. B. logbook/get_events fürs Lernen).
    ws: function (msg, timeoutMs) {
      if (!conn || !conn.isOpen()) return Promise.reject(new Error("nicht verbunden"));
      return conn.request(msg, timeoutMs || 30000);
    },
    loginBegin: loginBegin,
    loginSubmit: loginSubmit,
    logout: logout,
    userName: function () { return store.userName || ""; },
    servedFromHomeAssistant: servedFromHomeAssistant,
    testConnection: testConnection,
    isConnected: function () { return status === "verbunden" && store.everReady; },
    everReady: function () { return store.everReady; },
    disconnectedSince: function () { return store.disconnectedAt; },
    lastSyncAt: function () { return store.lastSyncAt; },
    version: function () { return store.version; },
    state: function (id) { return store.states[id] || null; },
    states: function () { return store.states; },
    model: model,
    roomSummary: roomSummary,
    personsHome: personsHome,
    callService: callService,
    fetchHistory: fetchHistory,
    name: friendlyName,
    shortName: shortName,
    areaIdOf: areaIdOf,
    areaName: function (areaId) {
      const a = store.areaById[areaId];
      return a ? a.name : "";
    },
    deviceIdOf: function (entityId) {
      const reg = store.entities[entityId];
      return reg ? reg.device_id : null;
    },
    attr: attr,
    numState: numState,
    domainOf: domainOf,
    isUnavailable: isUnavailable,
    isLightGroup: isLightGroup,
    debug: function () {
      return {
        status: status,
        entities: Object.keys(store.states).length,
        pending: conn ? conn.pendingCount() : 0,
        listeners: listeners.length,
        version: store.version,
      };
    },
  };
})();
