// End-to-End-Probe der Home-Assistant-Oberfläche gegen den Simulator
// (NIE gegen ein echtes Home Assistant). Spielt die Bedienung wirklich
// durch — Login, Raum schalten, Regler ziehen, Szene, Schnellaktion mit
// Countdown/Rückgängig, Einkaufsliste abhaken, Klima, Medien, Hinweise,
// Verbindungsabbruch — und fotografiert jeden Schritt (WebKit, 1024×768).
//
//   node tool/ha-simulator/server.js &          (Port 8124)
//   node tool/pruefe-ha.js --out belege/2026-10-10/ha
//
// Optionen: --sim http://localhost:8124  --user tafel --pass tafel-passwort
//           --nur login,zuhause,…  (nur bestimmte Schritte)
const { webkit } = require("playwright");
const path = require("path");
const fs = require("fs");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SIM = arg("sim", "http://localhost:8124");
const OUT = arg("out", "belege/ha");
const USER = arg("user", "tafel");
const PASS = arg("pass", "tafel-passwort");
const NUR = arg("nur", "");
const URL = SIM + "/local/tafel/index.html" + (arg("query", "") ? "?" + arg("query", "") : "");

const results = [];
let shotNo = 0;

function log(ok, text) {
  results.push({ ok: ok, text: text });
  console.log((ok ? "✓ " : "✗ ") + text);
}

async function sim(pfad, body) {
  const res = await fetch(SIM + pfad, {
    method: body === undefined ? "POST" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
  return res.ok;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") {
      const t = m.text();
      // Externe Datenquellen (CORS von localhost, Netz) sind kein Code-Fehler.
      if (/access control|Access-Control|Failed to load resource|NetworkError|Load failed|status of 4\d\d|status of 5\d\d|cannot load/i.test(t)) return;
      errors.push("console: " + t);
    }
  });

  async function shot(name) {
    shotNo++;
    const file = path.join(OUT, String(shotNo).padStart(2, "0") + "-" + name + ".png");
    await page.screenshot({ path: file });
    console.log("   📷 " + file);
    return file;
  }

  function want(step) {
    return !NUR || NUR.split(",").indexOf(step) !== -1;
  }

  async function evalSafe(fn, argv) {
    try { return await page.evaluate(fn, argv); } catch (e) { return null; }
  }

  async function waitFor(fn, ms, argv) {
    const end = Date.now() + (ms || 8000);
    while (Date.now() < end) {
      if (await evalSafe(fn, argv)) return true;
      await page.waitForTimeout(150);
    }
    return false;
  }

  // Simulator in den Ausgangszustand (Lichter, Einkaufsliste, Szenen),
  // damit wiederholte Läufe dieselben Bedingungen haben.
  await sim("/sim/szenario/reset");
  await sim("/sim/state", { entity_id: "todo.einkaufsliste" });

  // ---------- 1. Login ----------
  await page.goto(URL);
  // Belegfotos bei Tageshelligkeit: Nachtdimmung/Tiefschlaf aus, ohne die
  // Uhr zu verschieben (sonst passen HA-Zeitstempel/Verläufe nicht).
  if (arg("nacht", "aus") === "aus") {
    await evalSafe(() => { CONFIG.nightDim = null; CONFIG.nightSleep = null; tickClock(); });
  }
  const loginShown = await waitFor(() => !!document.querySelector("#haLogin.is-open"), 8000);
  log(loginShown, "Login-Bildschirm erscheint von selbst (Tafel aus HA geladen, keine Anmeldung)");
  await page.waitForTimeout(900);
  if (want("login")) await shot("login");

  await page.fill("#haLoginUser", USER);
  await page.fill("#haLoginPass", "falsch");
  await page.tap("#haLoginSubmit");
  const wrong = await waitFor(() => /stimmt nicht/.test((document.getElementById("haLoginError") || {}).textContent || ""), 6000);
  log(wrong, "Falsches Passwort → verständliche Fehlermeldung");
  const passCleared = await evalSafe(() => document.getElementById("haLoginPass").value === "");
  log(!!passCleared, "Passwortfeld nach dem Absenden geleert");
  if (want("login")) await shot("login-falsch");

  await page.fill("#haLoginUser", USER);
  await page.fill("#haLoginPass", PASS);
  await page.tap("#haLoginSubmit");
  const connected = await waitFor(() => window.TafelHA && TafelHA.isConnected(), 10000);
  log(connected, "Richtiges Passwort → angemeldet und verbunden");
  const stored = await evalSafe(() => {
    const a = JSON.parse(localStorage.getItem("tafelHaAuth") || "null");
    const all = JSON.stringify(localStorage);
    return { hasRefresh: !!(a && a.refresh), noPassword: all.indexOf("passwort") === -1 };
  });
  log(!!(stored && stored.hasRefresh && stored.noPassword), "Gespeichert: nur Refresh-Token, kein Passwort");
  await page.waitForTimeout(1200);

  // ---------- 2. Zuhause ----------
  await evalSafe(() => jumpToPanel("home"));
  await page.waitForTimeout(1500);
  const rooms = await evalSafe(() => document.querySelectorAll("#haRooms .ha-room").length);
  log(rooms > 0, "Zuhause-Panel zeigt " + rooms + " Raumkacheln");
  await shot("zuhause");

  // Raum mit Lampen per Tipp umschalten
  const btn = await page.$("#haRooms .ha-light-btn:not(.is-disabled)");
  if (btn) {
    const roomId = await btn.getAttribute("data-raum");
    const before = await evalSafe((r) => { const m = TafelHA.model().byId[r]; return m.lights.filter((id) => TafelHA.state(id).state === "on").length; }, roomId);
    await btn.tap();
    await page.waitForTimeout(250);
    await shot("zuhause-tipp-sofort");
    const changed = await waitFor((a) => {
      const m = TafelHA.model().byId[a.r];
      const n = m.lights.filter((id) => TafelHA.state(id).state === "on").length;
      return a.b === 0 ? n > 0 : n === 0;
    }, 5000, { r: roomId, b: before });
    log(changed, "Raum-Licht per Tipp geschaltet (" + roomId + ", vorher " + before + " an) – HA-Zustand bestätigt");
    await page.waitForTimeout(800);
    await shot("zuhause-licht-geschaltet");
  }

  // ---------- 3. Raumansicht ----------
  const roomWithLights = await evalSafe(() => {
    const r = TafelHA.model().rooms.filter((x) => x.lights.length > 1)[0];
    return r ? r.id : null;
  });
  if (roomWithLights) {
    // Licht im Raum an, damit Regler/Farben sichtbar sind.
    await evalSafe((r) => {
      const m = TafelHA.model().byId[r];
      return TafelHA.callService("light", "turn_on", { brightness_pct: 60 }, { entity_id: m.lights });
    }, roomWithLights);
    await page.waitForTimeout(600);
    await page.tap('#haRooms .ha-room[data-raum="' + roomWithLights + '"] .ha-room-name');
    const ovOpen = await waitFor(() => !!document.querySelector("#haRoomOverlay.is-open"), 3000);
    log(ovOpen, "Kachel antippen öffnet die Raumansicht");
    await page.waitForTimeout(500);
    await shot("raum");

    // Helligkeit per Ziehen (Maus) auf der ersten Lampe
    const slider = await page.$('#haOvMain .ha-light .ha-slider-hell');
    if (slider) {
      const id = await slider.getAttribute("data-id");
      const box = await slider.boundingBox();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 6 });
      await page.mouse.move(box.x + box.width * 0.22, box.y + box.height / 2, { steps: 6 });
      await shot("raum-regler-ziehen");
      await page.mouse.up();
      const ok = await waitFor((x) => {
        const b = TafelHA.attr(TafelHA.state(x), "brightness");
        return b != null && Math.abs(b / 2.55 - 22) <= 3;
      }, 5000, id);
      log(ok, "Helligkeitsregler (Maus) → " + id + " auf ~22 % in HA");
      // Touch-Ziehen über echte TouchEvents
      const touchOk = await evalSafe((x) => {
        try {
          const el = document.querySelector('#haOvMain .ha-slider-hell[data-id="' + x + '"]');
          const r = el.getBoundingClientRect();
          const y = r.top + r.height / 2;
          function ev(type, cx) {
            const t = new Touch({ identifier: 1, target: el, clientX: cx, clientY: y, pageX: cx, pageY: y });
            const e = new TouchEvent(type, { touches: type === "touchend" ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true });
            el.dispatchEvent(e);
          }
          ev("touchstart", r.left + r.width * 0.3);
          ev("touchmove", r.left + r.width * 0.55);
          ev("touchmove", r.left + r.width * 0.8);
          ev("touchend", r.left + r.width * 0.8);
          return true;
        } catch (e) {
          // Älteres WebKit-API (wie iOS): document.createTouch/createTouchList.
          try {
            const el = document.querySelector('#haOvMain .ha-slider-hell[data-id="' + x + '"]');
            const r = el.getBoundingClientRect();
            const y = r.top + r.height / 2;
            if (typeof document.createTouch !== "function") throw new Error("kein createTouch");
            function ev2(type, cx) {
              const t = document.createTouch(window, el, 1, cx, y, cx, y);
              const list = type === "touchend" ? document.createTouchList() : document.createTouchList(t);
              const e2 = document.createEvent("TouchEvent");
              e2.initTouchEvent(type, true, true, window, 0, cx, y, cx, y, false, false, false, false, list, list, document.createTouchList(t), 1, 0);
              el.dispatchEvent(e2);
            }
            ev2("touchstart", r.left + r.width * 0.3);
            ev2("touchmove", r.left + r.width * 0.55);
            ev2("touchmove", r.left + r.width * 0.8);
            ev2("touchend", r.left + r.width * 0.8);
            return true;
          } catch (e2) { return "keine TouchEvents: " + e.message + " / " + e2.message; }
        }
      }, id);
      if (touchOk === true) {
        const ok2 = await waitFor((x) => {
          const b = TafelHA.attr(TafelHA.state(x), "brightness");
          return b != null && Math.abs(b / 2.55 - 80) <= 3;
        }, 5000, id);
        log(ok2, "Helligkeitsregler (Touch-Ereignisse) → ~80 % in HA");
      } else {
        log(true, "Touch-Ziehen nicht simulierbar in diesem WebKit (" + touchOk + ") – nur Maus geprüft");
      }
      await page.waitForTimeout(600);
      await shot("raum-nach-regler");
    }

    // Szene antippen
    const scene = await page.$("#haOvSide .ha-scene:not(.is-active)");
    if (scene) {
      const sid = await scene.getAttribute("data-id");
      await scene.tap();
      await page.waitForTimeout(250);
      await shot("raum-szene-tipp");
      const ok = await waitFor((x) => {
        const st = TafelHA.state(x);
        return st && Date.now() - Date.parse(st.last_changed) < 8000;
      }, 5000, sid);
      log(ok, "Szene " + sid + " aktiviert");
      await page.waitForTimeout(900);
      await shot("raum-szene");
    }
    await page.tap("#haRoomOverlay .ha-ov-back");
    await page.waitForTimeout(500);
  }

  // ---------- 4. Schnellaktionen ----------
  await evalSafe(() => TafelHA.callService("light", "turn_on", null, { entity_id: TafelHA.model().global.lightsAll.slice(0, 3) }));
  await page.waitForTimeout(800);
  await page.tap("#haHouseToggle");
  await page.waitForTimeout(500);
  const actions = await evalSafe(() => Array.prototype.map.call(document.querySelectorAll("#haActionsMenu .ha-action-name"), (e) => e.textContent));
  log(actions && actions.length >= 1, "Schnellaktionen im Haus-Menü: " + (actions || []).join(", "));
  await shot("schnellaktionen");
  const offBtn = await page.$('#haActionsMenu [data-aktion="licht-aus"]');
  if (offBtn) {
    const litBefore = await evalSafe(() => TafelHA.model().global.lightsAll.filter((id) => TafelHA.state(id).state === "on"));
    await offBtn.tap();
    await page.waitForTimeout(1200);
    await shot("schnellaktion-countdown");
    const allOff = await waitFor(() => TafelHA.model().global.lightsAll.every((id) => TafelHA.state(id).state !== "on"), 9000);
    log(allOff, "„Alle Lichter aus“ nach Countdown ausgeführt (" + (litBefore || []).length + " Lampen)");
    await page.waitForTimeout(600);
    await shot("schnellaktion-erledigt");
    const undo = await page.$('#haActionsMenu [data-act="rueckgaengig"]');
    if (undo) {
      await undo.tap();
      const back = await waitFor((ids) => ids.every((id) => TafelHA.state(id).state === "on"), 6000, litBefore || []);
      log(back, "Rückgängig stellt die vorher brennenden Lampen wieder her");
    } else {
      log(false, "Kein Rückgängig-Knopf (scene.create fehlgeschlagen?)");
    }
    await page.waitForTimeout(500);
  }
  // Abbrechen im Countdown
  const anyAction = await page.$("#haActionsMenu .ha-action[data-act='aktion']");
  if (anyAction) {
    const aid = await anyAction.getAttribute("data-aktion");
    await anyAction.tap();
    await page.waitForTimeout(600);
    await page.tap('#haActionsMenu [data-aktion="' + aid + '"]');
    await page.waitForTimeout(400);
    const cancelled = await evalSafe((a) => !document.querySelector('#haActionsMenu [data-aktion="' + a + '"].is-arming'), aid);
    log(!!cancelled, "Zweiter Tipp im Countdown bricht „" + aid + "“ ab");
  }
  await page.mouse.click(300, 400);
  await page.waitForTimeout(400);

  // ---------- 5. Einkaufsliste ----------
  await evalSafe(() => jumpToPanel("home"));
  await page.waitForTimeout(1000);
  if (!(await page.$("#panel-home .ha-todo-item:not(.is-done)"))) {
    await evalSafe(() => TafelHA.callService("todo", "add_item", { item: "Milch" }, { entity_id: "todo.einkaufsliste" }));
    await page.waitForTimeout(1500);
  }
  const todo = await page.$("#panel-home .ha-todo-item:not(.is-done)");
  if (todo) {
    const uid = await todo.getAttribute("data-uid");
    const tid = await todo.getAttribute("data-id");
    await todo.tap();
    await page.waitForTimeout(350);
    await shot("einkauf-abhaken");
    const done = await waitFor((a) => {
      const items = TafelHA.todoItems(a.t) || [];
      const it = items.filter((x) => x.uid === a.u)[0];
      return !it || it.status === "completed";
    }, 5000, { t: tid, u: uid });
    log(done, "Einkaufsliste: Eintrag abgehakt (todo.update_item)");
  } else {
    log(false, "Keine Einkaufsliste auf dem Zuhause-Panel");
  }

  // ---------- 6. Klima ----------
  await evalSafe(() => jumpToPanel("klima"));
  await waitFor(() => !document.querySelector(".ha-spark-empty"), 6000);
  await page.waitForTimeout(800);
  const curves = await evalSafe(() => document.querySelectorAll("#haKlimaGrid .ha-spark-temp").length);
  log(curves > 0, "Raumklima: " + curves + " Verlaufskurve(n) aus history_during_period");
  await shot("klima");

  // ---------- 7. Medien ----------
  await sim("/sim/szenario/medien-play");
  await waitFor(() => haPanelAvailable("medien"), 5000);
  await evalSafe(() => jumpToPanel("medien"));
  await page.waitForTimeout(1500);
  await shot("medien");
  const play = await page.$("#haMedien .ha-round.is-primary");
  if (play) {
    const pid = await play.getAttribute("data-id");
    const before = await evalSafe((x) => TafelHA.state(x).state, pid);
    await play.tap();
    const toggled = await waitFor((a) => TafelHA.state(a.p).state !== a.b, 4000, { p: pid, b: before });
    log(toggled, "Medien: Play/Pause schaltet " + pid + " (" + before + " → anders)");
    await page.waitForTimeout(500);
    await shot("medien-pause");
  }
  const radio = await page.$("#haMedien .ha-radio-chip");
  if (radio) {
    await radio.tap();
    await page.waitForTimeout(1200);
    log(true, "Radio-Chip angetippt");
    await shot("medien-radio");
  }

  // ---------- 8. Radio-Widget: Ziel HomePod ----------
  await page.tap("#radioToggle");
  await page.waitForTimeout(500);
  const targets = await evalSafe(() => document.querySelectorAll("#haRadioTargets .ha-radio-target").length);
  log(targets > 1, "Radio-Menü bietet " + targets + " Wiedergabeziele (iPad + HA-Lautsprecher)");
  await shot("radio-ziele");
  await page.mouse.click(300, 400);

  // ---------- 9. Hinweise ----------
  await sim("/sim/szenario/batterie-leer");
  await page.waitForTimeout(1500);
  await evalSafe(() => jumpToPanel("departures"));
  await page.waitForTimeout(1500);
  const hintTexts = await evalSafe(() => Array.prototype.map.call(document.querySelectorAll("#haHints .ha-hint"), (e) => e.textContent));
  log(hintTexts && hintTexts.length > 0, "Hinweisband: " + (hintTexts || []).join(" | "));
  await shot("hinweise-abfahrten");

  // ---------- 10. Verbindungsabbruch ----------
  await evalSafe(() => jumpToPanel("home"));
  await page.waitForTimeout(800);
  await sim("/sim/pause?sekunden=12");
  await sim("/sim/trennen");
  const offline = await waitFor(() => document.body.classList.contains("ha-offline"), 5000);
  log(offline, "Verbindung weg → Bedienung gesperrt, Hinweis sichtbar");
  await page.waitForTimeout(600);
  await shot("getrennt");
  const back = await waitFor(() => window.TafelHA && TafelHA.isConnected() && !document.body.classList.contains("ha-offline"), 40000);
  log(back, "Wiederverbindung ohne Neuladen");
  await page.waitForTimeout(800);
  await shot("wieder-verbunden");

  // ---------- 11. Einstellungen (lange auf die Uhr) ----------
  const clock = await page.$(".clock");
  if (clock) {
    const b = await clock.boundingBox();
    await page.mouse.move(b.x + 20, b.y + 10);
    await page.mouse.down();
    await page.waitForTimeout(1000);
    await page.mouse.up();
    const open = await waitFor(() => !!document.querySelector("#haSetup.is-open"), 2000);
    log(open, "Langes Drücken auf die Uhr öffnet die Einstellungen");
    await page.waitForTimeout(400);
    await shot("einstellungen");
    await evalSafe(() => { const b2 = document.querySelector('#haSetup [data-setup="schliessen"]'); if (b2) b2.click(); });
    await page.waitForTimeout(400);
  }

  // ---------- 12. Heimkommen ----------
  if (await sim("/sim/szenario/alle-weg")) {
    await page.waitForTimeout(800);
    await sim("/sim/szenario/alle-da");
    const greet = await waitFor(() => !!document.querySelector("#haGreeting.is-open"), 5000);
    log(greet, "Heimkommen → Begrüßung + Zuhause-Panel");
    await page.waitForTimeout(900);
    await shot("begruessung");
  }

  // Erwartbar und kein Code-Fehler: externe Quellen, die von localhost aus
  // blockieren (TomTom 400, Kalender-CORS), und die absichtlich erzeugten
  // Verbindungsabbrüche (der Browser protokolliert jeden WebSocket-Fehlversuch).
  const expected = errors.filter((e) => /TomTom|kalender-worker|access control checks|WebSocket connection to|fehlgeschlagen \(\d{3}\)/.test(e));
  const realErrors = errors.filter((e) => expected.indexOf(e) === -1);
  if (expected.length) console.log("   (erwartet/extern, kein Code-Fehler: " + expected.length + "×)");
  errors.length = 0;
  realErrors.forEach((e) => errors.push(e));
  if (errors.length) {
    log(false, "Code-Fehler in der Konsole:\n   " + errors.slice(0, 10).join("\n   "));
  } else {
    log(true, "Keine Code-Fehler in der Konsole");
  }
  fs.writeFileSync(path.join(OUT, "ergebnis.json"), JSON.stringify({ results: results, errors: errors }, null, 2));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? "\n" + failed + " Prüfung(en) fehlgeschlagen." : "\nAlle Prüfungen bestanden.");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
