// Nimmt die bedeutungstragenden Animationen der HA-Oberfläche als kurze
// Videos (WebM, Playwright recordVideo, WebKit 1024×768) und zusätzlich als
// Bildstreifen (PNG, 5 Momente nebeneinander) auf — für MORGEN.html.
//
//   node tool/aufnahme-animationen.js --sim http://localhost:8125 --out belege/2026-10-10/animationen
//
// Jede Szene läuft in einem eigenen Browser-Kontext (eigenes Video).
const { webkit } = require("playwright");
const path = require("path");
const fs = require("fs");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SIM = arg("sim", "http://localhost:8125");
const OUT = arg("out", "belege/animationen");
const NUR = arg("nur", "");
const USER = arg("user", "tafel");
const PASS = arg("pass", "tafel-passwort");

async function sim(pfad, body) {
  try {
    await fetch(SIM + pfad, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  } catch (e) { /* egal */ }
}

async function login(page) {
  await page.goto(SIM + "/local/tafel/index.html");
  await page.evaluate(() => { CONFIG.nightDim = null; CONFIG.nightSleep = null; tickClock(); });
  await page.waitForSelector("#haLogin.is-open", { timeout: 10000 });
  await page.fill("#haLoginUser", USER);
  await page.fill("#haLoginPass", PASS);
  await page.tap("#haLoginSubmit");
  await page.waitForFunction(() => window.TafelHA && TafelHA.isConnected(), null, { timeout: 15000 });
  await page.waitForSelector("#haLogin:not(.is-open)", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

// Bildstreifen: Einzelbilder (verkleinert) nebeneinander in eine PNG.
async function streifen(browser, bilder, datei, titel) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 330 } });
  const p = await ctx.newPage();
  const html = "<html><body style='margin:0;background:#0d1219;font-family:-apple-system,sans-serif;color:#efe9df'>" +
    "<div style='padding:8px 12px;font-size:15px;font-weight:700'>" + titel + "</div><div style='display:flex;padding:0 6px'>" +
    bilder.map((b, i) => "<div style='margin:0 6px;text-align:center'><img src='data:image/png;base64," + b.png.toString("base64") +
      "' style='width:300px;height:225px;border-radius:8px;display:block'><div style='font-size:13px;color:#b8b0a3;margin-top:6px'>" + b.label + "</div></div>").join("") +
    "</div></body></html>";
  await p.setContent(html);
  await p.screenshot({ path: datei });
  await ctx.close();
}

const SZENEN = [
  {
    name: "licht-kachel",
    titel: "Licht an/aus: Schein + Glühbirne füllt sich",
    run: async (page, snap) => {
      await page.evaluate(() => jumpToPanel("home"));
      await page.waitForTimeout(1200);
      const btn = await page.$("#haRooms .ha-light-btn");
      const raum = await btn.getAttribute("data-raum");
      const sel = '#haRooms .ha-light-btn[data-raum="' + raum + '"]';
      await snap("vorher");
      await page.tap(sel);
      await page.waitForTimeout(150); await snap("+150 ms");
      await page.waitForTimeout(500); await snap("+650 ms");
      await page.waitForTimeout(1200);
      await page.tap(sel);
      await page.waitForTimeout(200); await snap("wieder +200 ms");
      await page.waitForTimeout(800); await snap("wieder +1 s");
    },
  },
  {
    name: "regler",
    titel: "Helligkeitsregler folgt dem Finger, Zahl zählt mit",
    run: async (page, snap) => {
      await page.evaluate(() => jumpToPanel("home"));
      await page.waitForTimeout(800);
      const r = await page.evaluate(() => TafelHA.model().rooms.filter((x) => x.lights.length > 1)[0].id);
      await page.evaluate((rid) => TafelHA.callService("light", "turn_on", { brightness_pct: 70 }, { entity_id: TafelHA.model().byId[rid].lights }), r);
      await page.waitForTimeout(600);
      await page.evaluate((rid) => TafelHAUI.openRoom(rid), r);
      await page.waitForTimeout(700);
      const s = await page.$("#haOvMain .ha-slider-hell");
      const b = await s.boundingBox();
      await snap("vorher");
      await page.mouse.move(b.x + b.width * 0.7, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * 0.45, b.y + b.height / 2, { steps: 8 });
      await snap("ziehen");
      await page.mouse.move(b.x + b.width * 0.15, b.y + b.height / 2, { steps: 8 });
      await snap("weiter");
      await page.mouse.up();
      await page.waitForTimeout(900); await snap("losgelassen");
      await page.waitForTimeout(800); await snap("HA bestätigt");
    },
  },
  {
    name: "szene",
    titel: "Szene: Farbschleier wischt über den Knopf",
    run: async (page, snap) => {
      const r = await page.evaluate(() => {
        const m = TafelHA.model().rooms.filter((x) => x.scenes.length || x.sceneSelects.length)[0];
        return m ? m.id : null;
      });
      await page.evaluate((rid) => TafelHAUI.openRoom(rid), r);
      await page.waitForTimeout(700);
      const sc = await page.$("#haOvSide .ha-scene");
      await snap("vorher");
      await sc.tap();
      await page.waitForTimeout(120); await snap("+120 ms");
      await page.waitForTimeout(250); await snap("+370 ms");
      await page.waitForTimeout(400); await snap("+770 ms");
      await page.waitForTimeout(1000); await snap("aktiv");
    },
  },
  {
    name: "schnellaktion",
    titel: "Schnellaktion: Countdown → Kacheln gehen gestaffelt aus → Rückgängig",
    run: async (page, snap) => {
      await page.evaluate(() => TafelHA.callService("light", "turn_on", null, { entity_id: TafelHA.model().global.lightsAll }));
      await page.evaluate(() => jumpToPanel("home"));
      await page.waitForTimeout(1500);
      await snap("alles an");
      await page.tap('#haHomeActions [data-aktion="licht-aus"]');
      await page.waitForTimeout(1800); await snap("Countdown");
      await page.waitForTimeout(2400); await snap("gestaffelt aus");
      await page.waitForTimeout(1200); await snap("erledigt");
      const undo = await page.$('#haHomeActions [data-act="rueckgaengig"]');
      if (undo) await undo.tap();
      await page.waitForTimeout(1500); await snap("rückgängig");
    },
  },
  {
    name: "einkauf",
    titel: "Einkaufsliste: Haken + Durchstreichen, dann verschwindet der Eintrag",
    run: async (page, snap) => {
      await page.evaluate(() => jumpToPanel("home"));
      await page.waitForTimeout(1000);
      await snap("vorher");
      const it = await page.$("#panel-home .ha-todo-item:not(.is-done)");
      if (it) await it.tap();
      await page.waitForTimeout(150); await snap("+150 ms");
      await page.waitForTimeout(400); await snap("+550 ms");
      await page.waitForTimeout(1200); await snap("+1,7 s");
      await page.waitForTimeout(1500); await snap("weg");
    },
  },
  {
    name: "verbindung",
    titel: "Verbindung weg: Punkt atmet, Bedienung graut aus, kommt von selbst zurück",
    run: async (page, snap) => {
      await page.evaluate(() => jumpToPanel("home"));
      await page.waitForTimeout(800);
      await snap("verbunden");
      await sim("/sim/pause?sekunden=8");
      await sim("/sim/trennen");
      await page.waitForTimeout(700); await snap("getrennt");
      await page.waitForTimeout(1200); await snap("+2 s");
      await page.waitForFunction(() => TafelHA.isConnected(), null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(500); await snap("wieder da");
      await page.waitForTimeout(800); await snap("bedienbar");
    },
  },
  {
    name: "ziffern",
    titel: "Zahlenwechsel: nur die geänderte Ziffer rollt",
    run: async (page, snap) => {
      await page.evaluate(() => jumpToPanel("home"));
      await page.waitForTimeout(800);
      const temp = await page.evaluate(() => {
        const r = TafelHA.model().rooms.filter((x) => x.temps.length)[0];
        return r ? r.temps[0] : null;
      });
      await snap("vorher");
      if (temp) await sim("/sim/state", { entity_id: temp, state: "23.4" });
      await page.waitForTimeout(450); await snap("+150 ms");
      await page.waitForTimeout(300); await snap("+450 ms");
      if (temp) await sim("/sim/state", { entity_id: temp, state: "23.8" });
      await page.waitForTimeout(450); await snap("2. Wechsel");
      await page.waitForTimeout(700); await snap("ruhig");
    },
  },
  {
    name: "begruessung",
    titel: "Heimkommen: Tafel springt auf Zuhause und begrüßt",
    run: async (page, snap) => {
      await page.evaluate(() => jumpToPanel("weather"));
      await sim("/sim/szenario/alle-weg");
      await page.waitForTimeout(1500);
      await snap("unterwegs");
      await sim("/sim/szenario/alle-da");
      await page.waitForTimeout(250); await snap("+250 ms");
      await page.waitForTimeout(500); await snap("+750 ms");
      await page.waitForTimeout(1200); await snap("Begrüßung");
      await page.waitForTimeout(6500); await snap("danach");
    },
  },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  for (const sz of SZENEN) {
    if (NUR && NUR.split(",").indexOf(sz.name) === -1) continue;
    const vdir = path.join(OUT, "_roh-" + sz.name);
    fs.mkdirSync(vdir, { recursive: true });
    const ctx = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      hasTouch: true,
      recordVideo: { dir: vdir, size: { width: 1024, height: 768 } },
    });
    const page = await ctx.newPage();
    const bilder = [];
    const snap = async (label) => { bilder.push({ label, png: await page.screenshot() }); };
    try {
      await login(page);
      await sz.run(page, snap);
      await page.waitForTimeout(400);
    } catch (e) {
      console.log("✗ " + sz.name + ": " + e.message);
    }
    const video = page.video();
    await ctx.close();
    if (video) {
      const src = await video.path();
      const dest = path.join(OUT, sz.name + ".webm");
      fs.renameSync(src, dest);
      fs.rmSync(vdir, { recursive: true, force: true });
      console.log("🎬 " + dest);
    }
    if (bilder.length) {
      const f = path.join(OUT, sz.name + "-streifen.png");
      await streifen(browser, bilder.slice(0, 5), f, sz.titel);
      console.log("🖼  " + f);
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(2); });
