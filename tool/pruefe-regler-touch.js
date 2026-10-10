// Touch-Logik der Helligkeitsregler gegen den Simulator (NIE echtes HA):
// senkrechter Wisch über einen Regler darf nichts schalten und das
// Scrollen nicht blockieren; waagerechtes Ziehen stellt die Helligkeit;
// ein kurzer Tipp setzt den Wert mit genau einem Aufruf.
// Desktop-WebKit kann keine echten TouchEvents bauen – die Ereignisse
// sind nachgebaut (Event + touches-Liste), geprüft wird die Logik der
// Tafel, nicht das Scrollverhalten von iOS.
//
//   node tool/pruefe-regler-touch.js --sim http://localhost:8125 [--alt /tmp/ha-panels-alt.js]
const { webkit } = require("playwright");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const SIM = arg("sim", "http://localhost:8125");
const results = [];
function log(ok, text) { results.push(ok); console.log((ok ? "✓ " : "✗ ") + text); }

(async () => {
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (!/access control|Load failed|NetworkError/i.test(e.message)) errors.push(e.message); });
  // --alt <datei>: alte Fassung von ha-panels.js ausliefern (Vorher-Vergleich).
  if (arg("alt", "")) {
    const body = require("fs").readFileSync(arg("alt", ""), "utf8");
    await page.route("**/ha-panels.js*", (route) => route.fulfill({ body: body, contentType: "application/javascript" }));
  }
  await page.goto(SIM + "/local/tafel/index.html");
  await page.evaluate(() => { CONFIG.nightDim = null; CONFIG.nightSleep = null; });
  await page.waitForSelector("#haLogin.is-open", { timeout: 10000 });
  await page.fill("#haLoginUser", "tafel");
  await page.fill("#haLoginPass", "tafel-passwort");
  await page.tap("#haLoginSubmit");
  await page.waitForFunction(() => window.TafelHA && TafelHA.isConnected(), null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => jumpToPanel("home"));
  await page.waitForTimeout(800);
  const raum = await page.evaluate(() => {
    const r = TafelHA.model().rooms.filter((x) => x.lights.length > 1)[0];
    TafelHA.callService("light", "turn_on", { brightness_pct: 60 }, { entity_id: r.lights });
    return r.id;
  });
  await page.waitForTimeout(800);
  await page.tap('#haRooms .ha-room[data-raum="' + raum + '"] .ha-room-name');
  await page.waitForSelector("#haRoomOverlay.is-open", { timeout: 3000 });
  await page.waitForTimeout(600);

  // Aufrufe an HA mitzählen.
  await page.evaluate(() => {
    window.__aufrufe = [];
    const orig = TafelHA.callService;
    TafelHA.callService = function (d, s, data, target) {
      window.__aufrufe.push(d + "." + s + " " + JSON.stringify(data || {}));
      return orig.apply(this, arguments);
    };
  });

  async function geste(punkte, ende) {
    return page.evaluate((a) => {
      const el = document.querySelector("#haOvMain .ha-light .ha-slider-hell");
      const r = el.getBoundingClientRect();
      const y0 = r.top + r.height / 2;
      const id = el.getAttribute("data-id");
      let verhindert = 0;
      function ev(type, fx, dy) {
        const e = new Event(type, { bubbles: true, cancelable: true });
        const t = { clientX: r.left + r.width * fx, clientY: y0 + dy, identifier: 1, target: el };
        Object.defineProperty(e, "touches", { value: type === "touchend" ? [] : [t] });
        Object.defineProperty(e, "changedTouches", { value: [t] });
        el.dispatchEvent(e);
        if (e.defaultPrevented) verhindert++;
      }
      window.__aufrufe.length = 0;
      ev("touchstart", a.punkte[0][0], a.punkte[0][1]);
      for (let i = 1; i < a.punkte.length; i++) ev("touchmove", a.punkte[i][0], a.punkte[i][1]);
      ev("touchend", a.ende[0], a.ende[1]);
      return { id: id, verhindert: verhindert };
    }, { punkte: punkte, ende: ende });
  }
  const hell = (id) => page.evaluate((x) => { const b = TafelHA.attr(TafelHA.state(x), "brightness"); return b == null ? null : Math.round(b / 2.55); }, id);
  const aufrufe = () => page.evaluate(() => window.__aufrufe.slice());

  // 1. Senkrechter Wisch (Scrollen), beginnt auf dem Regler bei 20 %.
  const vorher = await hell(await page.evaluate(() => document.querySelector("#haOvMain .ha-light .ha-slider-hell").getAttribute("data-id")));
  const w = await geste([[0.2, 0], [0.205, 6], [0.21, 18], [0.215, 40], [0.22, 80]], [0.22, 80]);
  await page.waitForTimeout(1200);
  const a1 = await aufrufe();
  log(a1.length === 0 && w.verhindert === 0 && (await hell(w.id)) === vorher,
    "Senkrechter Wisch über den Regler: keine Änderung (" + a1.length + " Aufrufe), Scrollen nicht blockiert, Helligkeit bleibt " + vorher + " %");

  // 2. Waagerechtes Ziehen von 60 % auf 30 %.
  const z = await geste([[0.6, 0], [0.56, 1], [0.48, 2], [0.4, 2], [0.3, 3]], [0.3, 3]);
  await page.waitForTimeout(1500);
  const h2 = await hell(z.id);
  log(z.verhindert >= 3 && h2 != null && Math.abs(h2 - 30) <= 3, "Waagerechtes Ziehen: Helligkeit " + h2 + " % (Ziel 30), Scrollen währenddessen blockiert (" + z.verhindert + "×)");

  // 3. Kurzer Tipp bei 80 %.
  const t = await geste([[0.8, 0]], [0.8, 0]);
  await page.waitForTimeout(1500);
  const a3 = await aufrufe();
  const h3 = await hell(t.id);
  log(a3.length === 1 && h3 != null && Math.abs(h3 - 80) <= 3, "Kurzer Tipp: " + a3.length + " Aufruf, Helligkeit " + h3 + " % (Ziel 80)");

  log(errors.length === 0, errors.length ? "Seitenfehler: " + errors.join(" / ") : "Keine Seitenfehler");
  await browser.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
