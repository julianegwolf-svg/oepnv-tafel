// Probe Hue-artige Szenen (Sitzung 7) – nur gegen den Simulator, nie gegen
// ein echtes Home Assistant. Liest die (private) scenes.yaml zur Laufzeit.
//   A. Datei: ids/Namen eindeutig, "<Raum> · <Szene>", je Lampe höchstens
//      eine Farbangabe, nur brightness (kein brightness_pct), keine Hue-
//      Raumgruppen, Farbangabe passt zur Lampe, Kelvin in ihren Grenzen,
//      je Raum alle Hue-Klassiker + Farbszenen
//   B. Simulator: jede Szene auslösen → jede Lampe hat genau den Zielzustand,
//      Lampen anderer Räume bleiben unberührt
//   C. Tafel ohne Bereich (frisch eingebaut): Szenen per Namensanfang im
//      richtigen Raum, kurze Namen, eigene vor gleichnamigen Hue-Szenen,
//      Antippen schaltet + Farbschleier (Bildstreifen + Video)
//   D. Tafel mit Bereich (in HA zugeordnet): dieselben Räume
//
//   HA_SIM_SZENEN=ha-vorschlag/scenes.yaml PORT=8143 node tool/ha-simulator/server.js &
//   HA_SIM_SZENEN=ha-vorschlag/scenes.yaml HA_SIM_SZENEN_BEREICH=1 PORT=8144 node tool/ha-simulator/server.js &
//   node tool/pruefe-szenen.js --datei ha-vorschlag/scenes.yaml --sim http://localhost:8143 --sim-bereich http://localhost:8144 --out belege/…/szenen
"use strict";
const { webkit } = require("playwright");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const { parseYaml } = require("./ha-simulator/yaml.js");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const DATEI = arg("datei", "ha-vorschlag/scenes.yaml");
const SIM = arg("sim", "http://localhost:8143");
const SIM_B = arg("sim-bereich", "");
const OUT = arg("out", "belege/szenen");
const TOKEN = process.env.HA_SIM_TOKEN || "tafel-sim-token";

let fehler = 0;
function log(ok, text) { if (!ok) fehler++; console.log((ok ? "✓ " : "✗ ") + text); }

const KLASSIKER = ["Hell", "Konzentrieren", "Lesen", "Entspannen", "Gedimmt", "Nachtlicht", "Energie tanken"];
const FARBE = ["color_temp_kelvin", "xy_color", "hs_color", "rgb_color", "rgbw_color", "rgbww_color", "color_temp", "color_name", "kelvin"];
const ERLAUBT = ["state", "brightness", "color_temp_kelvin", "xy_color", "hs_color", "rgb_color"];

// ---------- kleiner WebSocket-Client ----------
function verbinde(sim) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(sim.replace(/^http/, "ws") + "/api/websocket");
    let nr = 0;
    const offen = new Map();
    ws.on("message", (roh) => {
      const liste = [].concat(JSON.parse(roh));
      for (const m of liste) {
        if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: TOKEN }));
        else if (m.type === "auth_ok") resolve(api);
        else if (m.type === "auth_invalid") reject(new Error("auth_invalid"));
        else if (m.type === "result" && offen.has(m.id)) {
          const p = offen.get(m.id);
          offen.delete(m.id);
          if (m.success) p.ok(m.result); else p.nein(new Error(JSON.stringify(m.error)));
        }
      }
    });
    ws.on("error", reject);
    const api = {
      cmd(o) {
        return new Promise((ok, nein) => {
          const id = ++nr;
          offen.set(id, { ok, nein });
          ws.send(JSON.stringify(Object.assign({ id }, o)));
        });
      },
      async states() {
        const l = await api.cmd({ type: "get_states" });
        const m = {};
        l.forEach((s) => { m[s.entity_id] = s; });
        return m;
      },
      zu() { ws.close(); },
    };
  });
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function nah(a, b, tol) { return typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol; }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const liste = parseYaml(fs.readFileSync(DATEI, "utf8"));

  // ---------- A. Datei ----------
  const ha = await verbinde(SIM);
  const areas = await ha.cmd({ type: "config/area_registry/list" });
  const st0 = await ha.states();
  log(Array.isArray(liste) && liste.length > 0, "scenes.yaml ist eine Liste mit " + (liste ? liste.length : 0) + " Szenen");
  const ids = new Set();
  const namen = new Set();
  const proRaum = {};
  const regelFehler = [];
  for (const s of liste) {
    if (!s.id || ids.has(s.id)) regelFehler.push("id fehlt/doppelt: " + s.id);
    ids.add(s.id);
    if (namen.has(s.name)) regelFehler.push("Name doppelt: " + s.name);
    namen.add(s.name);
    if (!s.icon || !/^mdi:[a-z0-9-]+$/.test(s.icon)) regelFehler.push("Icon fehlt: " + s.name);
    const m = /^(.+?) · (.+)$/.exec(s.name || "");
    const raum = m && areas.find((a) => a.name === m[1]);
    if (!raum) { regelFehler.push("Name ohne bekannten Raum: " + s.name); continue; }
    (proRaum[raum.name] = proRaum[raum.name] || []).push(m[2]);
    for (const eid of Object.keys(s.entities || {})) {
      const z = s.entities[eid];
      const st = st0[eid];
      if (!st) { regelFehler.push(s.name + ": " + eid + " gibt es nicht"); continue; }
      const a = st.attributes || {};
      if (eid.indexOf("light.") !== 0) continue;
      if (a.is_hue_group || Array.isArray(a.entity_id) || Array.isArray(a.lights)) regelFehler.push(s.name + ": Raumgruppe " + eid + " gesetzt");
      Object.keys(z).forEach((k) => { if (ERLAUBT.indexOf(k) === -1) regelFehler.push(s.name + ": " + eid + " unzulässiges Feld " + k); });
      const farben = Object.keys(z).filter((k) => FARBE.indexOf(k) !== -1);
      if (farben.length > 1) regelFehler.push(s.name + ": " + eid + " hat " + farben.join("+"));
      if (z.state === "on" && !(Number.isInteger(z.brightness) && z.brightness >= 1 && z.brightness <= 255)) regelFehler.push(s.name + ": " + eid + " brightness " + z.brightness);
      const modi = a.supported_color_modes || [];
      if (z.color_temp_kelvin !== undefined) {
        if (modi.indexOf("color_temp") === -1) regelFehler.push(s.name + ": " + eid + " kann keine Farbtemperatur");
        else if (z.color_temp_kelvin < a.min_color_temp_kelvin || z.color_temp_kelvin > a.max_color_temp_kelvin) regelFehler.push(s.name + ": " + eid + " " + z.color_temp_kelvin + " K außerhalb " + a.min_color_temp_kelvin + "–" + a.max_color_temp_kelvin);
      }
      if ((z.xy_color || z.hs_color || z.rgb_color) && !modi.some((x) => ["xy", "hs", "rgb", "rgbw", "rgbww"].indexOf(x) !== -1)) regelFehler.push(s.name + ": " + eid + " kann keine Farbe");
      if (z.xy_color && modi.indexOf("xy") === -1) regelFehler.push(s.name + ": " + eid + " xy an Lampe ohne xy (" + modi.join(",") + ")");
      if (z.hs_color && modi.indexOf("hs") === -1) regelFehler.push(s.name + ": " + eid + " hs an Lampe ohne hs (" + modi.join(",") + ")");
    }
  }
  log(!regelFehler.length, "Regeln je Lampe (eine Farbangabe, brightness 1–255, Fähigkeiten, Kelvin-Grenzen, keine Raumgruppe)" + (regelFehler.length ? ":\n    " + regelFehler.slice(0, 12).join("\n    ") : ""));
  for (const raum of Object.keys(proRaum)) {
    const fehlt = KLASSIKER.filter((k) => proRaum[raum].indexOf(k) === -1);
    const farb = proRaum[raum].filter((n) => KLASSIKER.indexOf(n) === -1 && ["Filmabend", "Aufwachen"].indexOf(n) === -1);
    log(!fehlt.length && farb.length >= 3, raum + ": alle 7 Hue-Klassiker" + (fehlt.length ? " (fehlt: " + fehlt.join(", ") + ")" : "") + " + " + farb.length + " Farbszenen (" + farb.join(", ") + ")");
  }
  const lichtRaeume = areas.filter((a) => Object.keys(st0).some((id) => id.indexOf("light.") === 0 && !st0[id].attributes.is_hue_group && proRaum[a.name]));
  log(lichtRaeume.length >= 3, "Szenen für " + Object.keys(proRaum).join(", "));

  // ---------- B. Simulator: jede Szene auslösen ----------
  const sceneId = {};
  Object.keys(st0).filter((id) => id.indexOf("scene.") === 0).forEach((id) => {
    const fn = st0[id].attributes.friendly_name;
    if (fn) sceneId[fn] = id;
  });
  const fehlendeEntitaet = liste.filter((s) => !sceneId[s.name]).map((s) => s.name);
  log(!fehlendeEntitaet.length, "Simulator kennt alle Szenen als scene.* (" + Object.keys(sceneId).filter((n) => namen.has(n)).length + ")" + (fehlendeEntitaet.length ? " – fehlt: " + fehlendeEntitaet.join(", ") : ""));
  const abweichungen = [];
  let geprueft = 0;
  for (const s of liste) {
    const id = sceneId[s.name];
    if (!id) continue;
    const vorher = await ha.states();
    await ha.cmd({ type: "call_service", domain: "scene", service: "turn_on", target: { entity_id: id } });
    await pause(120);
    const nach = await ha.states();
    for (const eid of Object.keys(s.entities)) {
      const z = s.entities[eid];
      const a = (nach[eid] || {}).attributes || {};
      const ist = (nach[eid] || {}).state;
      geprueft++;
      if (ist !== z.state) { abweichungen.push(s.name + ": " + eid + " " + ist + " statt " + z.state); continue; }
      if (z.state !== "on") continue;
      if (!nah(a.brightness, z.brightness, 1)) abweichungen.push(s.name + ": " + eid + " Helligkeit " + a.brightness + " statt " + z.brightness);
      if (z.color_temp_kelvin !== undefined && !(a.color_mode === "color_temp" && nah(a.color_temp_kelvin, z.color_temp_kelvin, 2))) abweichungen.push(s.name + ": " + eid + " " + a.color_mode + "/" + a.color_temp_kelvin + " K statt " + z.color_temp_kelvin);
      if (z.xy_color && !(a.color_mode === "xy" && a.xy_color && nah(a.xy_color[0], z.xy_color[0], 0.005) && nah(a.xy_color[1], z.xy_color[1], 0.005))) abweichungen.push(s.name + ": " + eid + " xy " + JSON.stringify(a.xy_color) + " statt " + JSON.stringify(z.xy_color));
      if (z.hs_color && !(a.color_mode === "hs" && a.hs_color && nah(a.hs_color[0], z.hs_color[0], 1.5) && nah(a.hs_color[1], z.hs_color[1], 1.5))) abweichungen.push(s.name + ": " + eid + " hs " + JSON.stringify(a.hs_color) + " statt " + JSON.stringify(z.hs_color));
    }
    // Lampen anderer Räume unberührt
    Object.keys(nach).filter((x) => x.indexOf("light.") === 0 && !s.entities[x] && !nach[x].attributes.is_hue_group).forEach((x) => {
      if (vorher[x] && (vorher[x].state !== nach[x].state || vorher[x].attributes.brightness !== nach[x].attributes.brightness)) abweichungen.push(s.name + ": fremde Lampe " + x + " geändert");
    });
    if (!(Date.now() - Date.parse(nach[id].state) < 5000)) abweichungen.push(s.name + ": Zustand der Szene nicht der Aktivierungszeitpunkt (" + nach[id].state + ")");
  }
  log(!abweichungen.length, "Alle " + liste.length + " Szenen ausgelöst, " + geprueft + " Lampenzustände = Ziel, fremde Lampen unberührt" + (abweichungen.length ? ":\n    " + abweichungen.slice(0, 12).join("\n    ") : ""));
  ha.zu();

  // ---------- C./D. Tafel ----------
  const browser = await webkit.launch();
  async function tafel(sim, name, mitVideo) {
    const context = await browser.newContext(Object.assign({
      viewport: { width: 1024, height: 768 }, hasTouch: true,
      userAgent: "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
    }, mitVideo ? { recordVideo: { dir: OUT, size: { width: 1024, height: 768 } } } : {}));
    const page = await context.newPage();
    page.codeFehler = [];
    page.on("pageerror", (e) => { if (!/access control checks/.test(e.message)) page.codeFehler.push(e.message); });
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (/access control|Access-Control|Failed to load resource|NetworkError|Load failed|status of [45]\d\d|cannot load|Kalender-Abruf|Veranstaltungen-Abruf|Keine anstehenden|Musik/i.test(t)) return;
      page.codeFehler.push(t);
    });
    await page.goto(sim + "/local/tafel/index.html");
    await page.evaluate(() => { const d = new Date(); localStorage.setItem("tafelMorgengruss", d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate()); });
    await page.waitForSelector("#haLogin.is-open", { timeout: 10000 });
    await page.fill("#haLoginUser", "tafel");
    await page.fill("#haLoginPass", "tafel-passwort");
    await page.tap("#haLoginSubmit");
    await page.waitForFunction(() => window.TafelHA && TafelHA.isConnected(), null, { timeout: 15000 });
    await page.evaluate(() => { CONFIG.nightDim = null; CONFIG.nightSleep = null; tickClock(); });
    await page.waitForTimeout(1500);
    return { page, context, name };
  }

  async function raumAuf(page, raumName) {
    await page.evaluate(() => jumpToPanel("home"));
    await page.waitForTimeout(900);
    const rid = await page.evaluate((n) => { const r = TafelHA.model().rooms.filter((x) => x.name === n)[0]; return r ? r.id : null; }, raumName);
    if (!rid) return null;
    await page.tap('#haRooms .ha-room[data-raum="' + rid + '"] .ha-room-name');
    await page.waitForSelector("#haRoomOverlay.is-open", { timeout: 4000 });
    await page.waitForTimeout(500);
    return rid;
  }

  async function knoepfe(page) {
    return page.evaluate(() => [].map.call(document.querySelectorAll("#haOvSide .ha-scene"), (b) => ({
      id: b.getAttribute("data-id"), name: b.querySelector(".ha-scene-name").textContent, aktiv: b.classList.contains("is-active"),
      ganzSichtbar: (function () { const r = b.getBoundingClientRect(); const p = document.getElementById("haOvSide").getBoundingClientRect(); return r.bottom <= Math.min(p.bottom, 768) + 1 && r.top >= p.top - 1; })(),
    })));
  }

  async function raeumePruefen(t, label) {
    const { page } = t;
    const zuordnung = await page.evaluate(() => {
      const m = TafelHA.model();
      const o = {};
      m.rooms.forEach((r) => { o[r.name] = r.scenes.slice(); });
      return o;
    });
    const falsch = [];
    for (const s of liste) {
      const raum = s.name.split(" · ")[0];
      const id = sceneId[s.name];
      if (!(zuordnung[raum] || []).some((x) => x === id)) falsch.push(s.name + " (" + id + ")");
    }
    log(!falsch.length, label + ": jede Szene im Raum ihres Namens" + (falsch.length ? " – fehlt: " + falsch.slice(0, 6).join(", ") : ""));
    log(!zuordnung["Weitere Geräte"] || !zuordnung["Weitere Geräte"].length, label + ": keine Szene unter „Weitere Geräte“");
    for (const raum of Object.keys(proRaum)) {
      const rid = await raumAuf(page, raum);
      if (!rid) { log(false, label + ": Raum " + raum + " nicht gefunden"); continue; }
      const k = await knoepfe(page);
      const namenK = k.map((x) => x.name);
      const doppelt = namenK.filter((n, i) => namenK.indexOf(n) !== i);
      const mitPraefix = namenK.filter((n) => n.indexOf(raum) === 0 || n.indexOf("·") !== -1);
      const eigeneVorn = KLASSIKER.every((n) => { const b = k.filter((x) => x.name === n)[0]; return b && liste.some((s) => sceneId[s.name] === b.id); });
      const unsichtbar = k.filter((x) => !x.ganzSichtbar).map((x) => x.name);
      log(!doppelt.length && !mitPraefix.length && eigeneVorn, label + " " + raum + ": " + k.length + " Knöpfe, kurze Namen, keine Doppelten, Klassiker = eigene Szenen (" + namenK.join(", ") + ")" + (doppelt.length ? " – doppelt: " + doppelt.join(", ") : "") + (mitPraefix.length ? " – mit Raum: " + mitPraefix.join(", ") : ""));
      log(!unsichtbar.length, label + " " + raum + ": alle Szenen-Knöpfe ganz sichtbar" + (unsichtbar.length ? " – abgeschnitten: " + unsichtbar.join(", ") : ""));
      await page.screenshot({ path: path.join(OUT, label + "-raum-" + rid + ".png") });
      await page.tap("#haRoomOverlay .ha-ov-back");
      await page.waitForTimeout(400);
    }
  }

  // C. ohne Bereich + Antippen mit Bildstreifen/Video
  const t1 = await tafel(SIM, "ohne-bereich", true);
  await raeumePruefen(t1, "ohne-bereich");
  {
    const page = t1.page;
    const szene = liste.filter((s) => / · Sonnenuntergang$/.test(s.name))[0];
    const raum = szene.name.split(" · ")[0];
    const rid = await raumAuf(page, raum);
    const sid = sceneId[szene.name];
    await page.evaluate((r) => TafelHA.callService("light", "turn_off", null, { entity_id: TafelHA.model().byId[r].lights }), rid);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, "tipp-0-vorher.png") });
    await page.tap('#haOvSide .ha-scene[data-id="' + sid + '"]');
    const t0 = Date.now();
    const sichtbar = [];
    for (const ms of [80, 200, 330, 480]) {
      await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)));
      sichtbar.push(await page.evaluate((id) => {
        const e = document.querySelector('#haOvSide .ha-scene[data-id="' + id + '"] .ha-scene-sweep');
        return e ? Number(getComputedStyle(e).opacity) : 0;
      }, sid));
      await page.screenshot({ path: path.join(OUT, "tipp-" + ms + "ms.png") });
    }
    log(sichtbar.slice(0, 3).every((o) => o > 0.5), "Farbschleier läuft durch, auch nachdem HA den neuen Zustand meldet (Deckkraft bei 80/200/330/480 ms: " + sichtbar.map((o) => o.toFixed(2)).join(" / ") + ")");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, "tipp-9-nachher.png") });
    const ist = await page.evaluate((ids) => ids.map((id) => { const s = TafelHA.state(id); return { id: id, state: s && s.state, a: s && s.attributes }; }), Object.keys(szene.entities));
    const ok = ist.every((x) => {
      const z = szene.entities[x.id];
      if (x.state !== z.state) return false;
      if (z.xy_color) return x.a.xy_color && nah(x.a.xy_color[0], z.xy_color[0], 0.005);
      if (z.hs_color) return x.a.hs_color && nah(x.a.hs_color[0], z.hs_color[0], 1.5);
      if (z.color_temp_kelvin) return nah(x.a.color_temp_kelvin, z.color_temp_kelvin, 2);
      return true;
    });
    log(ok, "Antippen von „Sonnenuntergang“ im " + raum + ": alle Lampen in den Szenenfarben (Zustand aus HA zurück)");
    const aktiv = await page.evaluate((id) => { const b = document.querySelector('#haOvSide .ha-scene[data-id="' + id + '"]'); return !!b && b.classList.contains("is-active"); }, sid);
    log(aktiv, "Knopf danach als aktiv markiert");
    const schleier = await page.evaluate((id) => { const b = document.querySelector('#haOvSide .ha-scene[data-id="' + id + '"] .ha-scene-sweep'); return b ? b.style.background : ""; }, sid);
    log((schleier.match(/rgb\(/g) || []).length >= 4, "Farbschleier in den vier Szenenfarben: " + schleier.slice(0, 90) + "…");
    log(!page.codeFehler.length, "ohne Bereich: keine Code-Fehler" + (page.codeFehler.length ? " – " + page.codeFehler.join(" | ") : ""));
    const video = page.video();
    await t1.context.close();
    if (video) {
      const p = await video.path();
      fs.renameSync(p, path.join(OUT, "szene-antippen.webm"));
    }
  }

  // D. mit Bereich
  if (SIM_B) {
    const t2 = await tafel(SIM_B, "mit-bereich", false);
    await raeumePruefen(t2, "mit-bereich");
    log(!t2.page.codeFehler.length, "mit Bereich: keine Code-Fehler" + (t2.page.codeFehler.length ? " – " + t2.page.codeFehler.join(" | ") : ""));
    await t2.context.close();
  }

  await browser.close();
  console.log(fehler ? "\nFEHLER ✗ (" + fehler + ")" : "\nALLES ✓");
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
