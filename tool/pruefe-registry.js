// Probe: Übernimmt die Tafel Änderungen an der HA-Registry sofort – ohne
// Neuverbinden und ohne Neuladen? (NIE gegen ein echtes Home Assistant.)
// Verschiebt eine Lampe in einen anderen Raum, benennt sie um, blendet sie
// aus und stellt am Ende alles wieder her (Simulator: POST /sim/registry).
//
//   PORT=8134 node tool/ha-simulator/server.js &
//   node tool/pruefe-registry.js --sim http://localhost:8134 --out belege/2026-10-10/registry
//   Gegenprobe mit alter Fassung: --alt /tmp/ha-alt.js (liefert diese statt ha.js aus)
const { webkit } = require("playwright");
const path = require("path");
const fs = require("fs");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const SIM = arg("sim", "http://localhost:8134");
const OUT = arg("out", "belege/registry");
const results = [];
function log(ok, text) { results.push(ok); console.log((ok ? "✓ " : "✗ ") + text); }

async function registry(body) {
  const r = await fetch(SIM + "/sim/registry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch();
  const page = await (await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true })).newPage();
  if (arg("alt", "")) {
    const alt = fs.readFileSync(arg("alt", ""), "utf8");
    await page.route(/\/ha\.js(\?|$)/, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: alt }));
  }
  const errors = [];
  page.on("pageerror", (e) => { if (!/access control/i.test(e.message)) errors.push(e.message); });
  let n = 0;
  const shot = async (name) => { n++; const f = path.join(OUT, String(n).padStart(2, "0") + "-" + name + ".png"); await page.screenshot({ path: f }); console.log("   📷 " + f); };

  await page.goto(SIM + "/local/tafel/index.html?ha_token=tafel-sim-token");
  await page.waitForFunction(() => window.TafelHA && TafelHA.isConnected(), null, { timeout: 15000 });
  await page.evaluate(() => {
    CONFIG.nightDim = null; CONFIG.nightSleep = null;
    const d = new Date(); localStorage.setItem("tafelMorgengruss", d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate());
    window.__syncs = 0; window.__ladeStart = performance.timing.navigationStart;
    TafelHA.on(function (t, first) { if (t === "sync" && first) window.__syncs++; });
    jumpToPanel("home");
  });
  await page.waitForTimeout(2000);
  const raeume = () => page.evaluate(() => TafelHA.model().rooms.map((r) => ({ id: r.id, name: r.name, lights: r.lights.slice() })));
  const vorher = await raeume();
  const quelle = vorher.filter((r) => r.lights.length >= 2)[0];
  const ziel = vorher.filter((r) => r.id !== quelle.id && r.lights.length >= 1)[0];
  const lampe = quelle.lights.filter((id) => !/_(living_room|bedroom|office)_/.test(id))[0] || quelle.lights[0];
  console.log("   Lampe " + lampe + ": " + quelle.name + " → " + ziel.name);
  await shot("vorher");

  // 1. Raum wechseln
  await registry({ entity_id: lampe, area_id: ziel.id });
  const verschoben = await page.waitForFunction((a) => {
    const m = TafelHA.model();
    return m.byId[a.ziel] && m.byId[a.ziel].lights.indexOf(a.lampe) !== -1 && m.byId[a.quelle].lights.indexOf(a.lampe) === -1;
  }, { lampe: lampe, ziel: ziel.id, quelle: quelle.id }, { timeout: 10000 }).then(() => true).catch(() => false);
  log(verschoben, "Lampe erscheint ohne Neuladen im neuen Raum (" + ziel.name + ")");
  await page.waitForTimeout(800);
  await shot("verschoben");

  // 2. Umbenennen
  await registry({ entity_id: lampe, name: "Neue Leselampe" });
  const umbenannt = await page.waitForFunction((l) => TafelHA.name(l) === "Neue Leselampe", lampe, { timeout: 10000 }).then(() => true).catch(() => false);
  log(umbenannt, "Neuer Name kommt an: " + (await page.evaluate((l) => TafelHA.name(l), lampe)));
  await page.evaluate((r) => TafelHAUI.openRoom(r), ziel.id);
  await page.waitForTimeout(1200);
  const imRaum = await page.evaluate(() => document.body.textContent.indexOf("Neue Leselampe") !== -1);
  log(imRaum, "Raumansicht zeigt den neuen Namen");
  await shot("umbenannt-raum");
  await page.evaluate(() => TafelHAUI.closeRoom());

  // 3. Ausblenden
  await registry({ entity_id: lampe, hidden: true });
  const weg = await page.waitForFunction((l) => TafelHA.model().rooms.every((r) => r.lights.indexOf(l) === -1), lampe, { timeout: 10000 }).then(() => true).catch(() => false);
  log(weg, "Ausgeblendete Lampe verschwindet von der Tafel");

  // 4. Wiederherstellen
  await registry({ entity_id: lampe, area_id: quelle.id, name: "", hidden: false });
  const zurueck = await page.waitForFunction((a) => TafelHA.model().byId[a.quelle].lights.indexOf(a.lampe) !== -1, { lampe: lampe, quelle: quelle.id }, { timeout: 10000 }).then(() => true).catch(() => false);
  log(zurueck, "Wiederhergestellt: wieder in " + quelle.name);
  await page.waitForTimeout(800);
  await shot("zurueck");

  const stats = await page.evaluate(() => ({ syncs: window.__syncs, status: TafelHA.status(), neugeladen: performance.timing.navigationStart !== window.__ladeStart }));
  log(stats.syncs === 0 && stats.status === "verbunden" && !stats.neugeladen, "Ohne Neuverbinden und Neuladen (Voll-Sync: " + stats.syncs + ", Status: " + stats.status + ")");
  log(errors.length === 0, "Keine Seitenfehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  const bad = results.filter((r) => !r).length;
  console.log(bad ? "\n" + bad + " Prüfung(en) fehlgeschlagen." : "\nAlle Prüfungen bestanden.");
  process.exit(bad ? 1 : 0);
})();
