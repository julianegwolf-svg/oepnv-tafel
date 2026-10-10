// Prototypen aus KONZEPTE.md (Sitzung 7) – alle standardmäßig AUS
// (CONFIG.konzepte), nur mit Home Assistant. Klassisches Skript, Safari 12.
//   K2 Tür-Check: Scan des NFC-Tags an der Tür → "Tschüss"-Karte
//   K1 Wecklicht passend zur ersten Bahn
//   K3 Werder-Tor-Licht im Wohnzimmer
(function () {
  "use strict";

  const KC = (typeof CONFIG !== "undefined" && CONFIG.konzepte) || {};

  function HA() { return window.TafelHA || null; }
  function UI() { return window.TafelHAUI || null; }
  function esc(s) { return UI() ? UI().esc(s) : String(s == null ? "" : s); }
  function icon(n, cls) { return UI() ? UI().icon(n, cls) : ""; }
  function fmt(ms) { return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }); }
  function vorname() {
    const h = HA();
    const g = h.model().global;
    const home = h.personsHome();
    const id = home[0] || g.persons[0];
    return id ? h.name(id).split(" ")[0] : "";
  }

  // ======================================================================
  // K2 · Tür-Check
  // Ein Nicht-Admin ("tafel") darf tag_scanned nicht abonnieren – die
  // Tag-Entität (tag.*, HA ≥ 2024.6) setzt beim Scan aber ihren Zustand auf
  // die Scanzeit, und state_changed sieht die Tafel.
  // ======================================================================
  const TUER_MS = 90 * 1000;
  let tuerOffen = false;
  let tuerTimer = null;
  let tuerTakt = null;
  let tuerGesendet = false;

  function tuerTagId() {
    if (KC.tuerTag) return KC.tuerTag;
    const states = HA().states();
    const ids = Object.keys(states).filter(function (id) { return id.indexOf("tag.") === 0; });
    for (let i = 0; i < ids.length; i++) {
      const n = (HA().name(ids[i]) + " " + ids[i]).toLowerCase();
      if (/(^|[^a-zäöü])(t(ü|ue|u)r|haust|wohnungst|door|eingang)/.test(n)) return ids[i];
    }
    return null;
  }

  function istFrischerScan(neu, alt) {
    if (!neu || !neu.state || (alt && alt.state === neu.state)) return false;
    const t = Date.parse(neu.state);
    return isFinite(t) && Math.abs(Date.now() - t) < 2 * 60 * 1000;
  }

  // Bahn: an Arbeitstagen die Bahn zur Arbeit (dieselbe Rechnung wie
  // Morgengruß/Tagesblick), sonst die nächsten, die man zu Fuß noch schafft.
  function tuerBahnen() {
    const snap = typeof tafelSnapshot === "function" ? tafelSnapshot() : null;
    const now = Date.now();
    const liste = ((snap && snap.departures) || []).filter(function (d) { return d.whenMs && d.leaveByMs >= now - 30000; });
    let haupt = null;
    let arbeit = false;
    const ab = typeof arbeitsBahnHeute === "function" ? arbeitsBahnHeute() : null;
    if (ab && ab.dep && ab.dep.leaveByMs >= now - 30000) { haupt = ab.dep; arbeit = true; }
    if (!haupt) haupt = liste[0] || null;
    const danach = liste.filter(function (d) { return d !== haupt && !(haupt && d.line === haupt.line && d.whenMs === haupt.whenMs); }).slice(0, 2);
    return { haupt: haupt, arbeit: arbeit, danach: danach };
  }

  function regenSatz() {
    const snap = typeof tafelSnapshot === "function" ? tafelSnapshot() : null;
    if (!snap) return "";
    if (snap.rainStartMinutes != null && snap.rainStartMinutes <= 0) return "Es regnet – Schirm mit";
    const w = snap.weather;
    const h = w && w.hourly;
    if (!h || !h.time) return "";
    const now = Date.now();
    const bis = now + 12 * 3600 * 1000; // bis heute Abend zurück
    for (let i = 0; i < h.time.length; i++) {
      if (h.time[i] < now - 3600 * 1000 || h.time[i] > bis) continue;
      const pp = h.pp ? h.pp[i] : null;
      if (pp != null && pp >= 50) {
        return "Ab " + new Date(Math.max(h.time[i], now)).getHours() + " Uhr Regen (" + Math.round(pp) + " %) – Schirm mit";
      }
    }
    return "";
  }

  function lichterAn() {
    const g = HA().model().global;
    return g.lightsAll.filter(function (id) { const s = HA().state(id); return s && s.state === "on"; });
  }

  function lichtZeile() {
    const an = lichterAn();
    if (!an.length) return { ok: true, html: icon("check", "k-ico") + "<span>Licht: alles aus</span>" };
    const raeume = {};
    an.forEach(function (id) { const n = HA().areaName(HA().areaIdOf(id)) || "sonst"; raeume[n] = (raeume[n] || 0) + 1; });
    const text = Object.keys(raeume).map(function (r) { return r + " (" + raeume[r] + ")"; }).join(", ");
    return {
      ok: false,
      html: icon("bulb", "k-ico") + "<span>Noch an: " + esc(text) + "</span>" +
        '<button type="button" class="k-knopf" data-k="licht-aus">Aus</button>',
    };
  }

  function einkaufListe() {
    const g = HA().model().global;
    const id = g.todos[0];
    if (!id) return null;
    const items = (HA().todoItems(id) || []).filter(function (it) { return it && it.status !== "completed" && it.summary; });
    return items.length ? { id: id, items: items } : null;
  }

  function notifyZiel() {
    if (KC.tuerNotify) return KC.tuerNotify;
    const ids = Object.keys(HA().states()).filter(function (id) { return id.indexOf("notify.") === 0; });
    return ids[0] || null;
  }

  function tuerHtml() {
    const b = tuerBahnen();
    const now = Date.now();
    let bahn = "";
    if (b.haupt) {
      const d = b.haupt;
      const min = Math.max(0, Math.round((d.leaveByMs - now) / 60000));
      const style = d.color ? ' style="background:#' + esc(String(d.color).replace("#", "")) + ";color:#" + esc(String(d.textColor || "ffffff").replace("#", "")) + '"' : "";
      bahn = '<div class="k-bahn">' +
        '<span class="k-linie"' + style + ">" + esc(d.line) + "</span>" +
        '<div class="k-bahn-text"><div class="k-bahn-ziel">' + esc(d.dest || "") + "</div>" +
        '<div class="k-bahn-sub">' + (b.arbeit ? "Bahn zur Arbeit · " : "") + "ab " + esc(d.clock) + "</div></div>" +
        '<div class="k-los' + (min <= 1 ? " is-jetzt" : "") + '">' +
        (min <= 1 ? '<span class="k-los-zahl">jetzt</span><span class="k-los-text">los</span>'
          : '<span class="k-los-zahl num">' + min + '</span><span class="k-los-text">Min bis los</span>') +
        "</div></div>";
      if (b.danach.length) {
        bahn += '<div class="k-danach">danach ' + b.danach.map(function (x) { return esc(x.line) + " um " + esc(x.clock); }).join(" · ") + "</div>";
      }
    } else {
      bahn = '<div class="k-danach">Keine Abfahrt in der nächsten Stunde bekannt</div>';
    }
    const zeilen = [];
    const regen = regenSatz();
    if (regen) zeilen.push('<div class="k-zeile is-warn">' + icon("umbrella", "k-ico") + "<span>" + esc(regen) + "</span></div>");
    const warn = window.TafelWarn ? TafelWarn.aktuelle()[0] : null;
    if (warn) zeilen.push('<div class="k-zeile is-alert">' + icon("alert", "k-ico") + "<span>" + esc(TafelWarn.kurz(warn)) + "</span></div>");
    const l = lichtZeile();
    zeilen.push('<div class="k-zeile' + (l.ok ? " is-ok" : "") + '">' + l.html + "</div>");
    const e = einkaufListe();
    if (e) {
      const namen = e.items.slice(0, 4).map(function (it) { return it.summary; }).join(", ") + (e.items.length > 4 ? " …" : "");
      zeilen.push('<div class="k-zeile">' + icon("cart", "k-ico") + "<span>" + esc(namen) + "</span>" +
        (notifyZiel() ? (tuerGesendet ? '<span class="k-gesendet">' + icon("check", "k-ico") + "aufs iPhone geschickt</span>"
          : '<button type="button" class="k-knopf" data-k="liste-senden">' + icon("phone", "k-ico") + "Aufs iPhone</button>") : "") +
        "</div>");
    }
    const name = vorname();
    return '<div class="k-tuer-inner">' +
      '<div class="ha-eyebrow">' + icon("door") + "Tür · " + fmt(now) + "</div>" +
      '<div class="k-tuer-titel">Tschüss' + (name ? ", " + esc(name) : "") + "!</div>" +
      bahn + '<div class="k-zeilen">' + zeilen.join("") + "</div></div>" +
      '<div class="k-ablauf"><span class="k-ablauf-balken"></span></div>';
  }

  function tuerRender() {
    const el = document.getElementById("kTuer");
    if (!el || !tuerOffen) return;
    const balken = el.querySelector(".k-ablauf-balken");
    // Ablaufbalken nicht neu starten: nur den Inhalt darüber erneuern.
    const inner = el.querySelector(".k-tuer-inner");
    const tmp = document.createElement("div");
    tmp.innerHTML = tuerHtml();
    if (inner && balken) el.replaceChild(tmp.firstChild, inner);
    else el.innerHTML = tmp.innerHTML;
  }

  function zeigeTuerCheck() {
    if (!KC.tuerCheck || !HA() || !HA().isConnected()) return;
    let el = document.getElementById("kTuer");
    if (!el) {
      el = document.createElement("div");
      el.id = "kTuer";
      el.className = "k-tuer ds-dark";
      (document.querySelector(".panel") || document.body).appendChild(el);
      el.addEventListener("click", tuerKlick);
    }
    tuerGesendet = false;
    tuerOffen = true;
    el.innerHTML = tuerHtml();
    if (typeof wakeByPresence === "function") wakeByPresence();
    void el.offsetWidth;
    el.classList.add("is-open");
    const balken = el.querySelector(".k-ablauf-balken");
    if (balken) {
      balken.style.transitionDuration = TUER_MS + "ms";
      void balken.offsetWidth;
      balken.classList.add("is-laeuft");
    }
    if (tuerTimer) clearTimeout(tuerTimer);
    tuerTimer = setTimeout(schliesseTuerCheck, TUER_MS);
    if (tuerTakt) clearInterval(tuerTakt);
    tuerTakt = setInterval(tuerRender, 15000);
  }

  function schliesseTuerCheck() {
    tuerOffen = false;
    if (tuerTimer) { clearTimeout(tuerTimer); tuerTimer = null; }
    if (tuerTakt) { clearInterval(tuerTakt); tuerTakt = null; }
    const el = document.getElementById("kTuer");
    if (!el) return;
    el.classList.remove("is-open");
    setTimeout(function () { if (!tuerOffen) el.innerHTML = ""; }, 600);
  }

  function tuerKlick(ev) {
    ev.stopPropagation();
    const btn = ev.target && ev.target.closest ? ev.target.closest("[data-k]") : null;
    if (!btn) { schliesseTuerCheck(); return; }
    const k = btn.getAttribute("data-k");
    if (k === "licht-aus") {
      const an = lichterAn();
      if (an.length) HA().callService("light", "turn_off", null, { entity_id: an }).catch(function () {});
      btn.disabled = true;
    } else if (k === "liste-senden") {
      const e = einkaufListe();
      const ziel = notifyZiel();
      if (!e || !ziel) return;
      const text = e.items.map(function (it) { return "• " + it.summary; }).join("\n");
      btn.disabled = true;
      HA().callService("notify", "send_message", { title: "Einkaufsliste", message: text }, { entity_id: ziel }).then(function () {
        tuerGesendet = true;
        tuerRender();
      }).catch(function () { btn.disabled = false; });
    }
  }

  // ======================================================================
  // K1 · Wecklicht passend zur ersten Bahn
  // Abends (ab 19 Uhr) schlägt die Tafel für den nächsten Arbeitstag vor,
  // wann das Schlafzimmerlicht aufgehen soll: Losgehzeit der Bahn zur
  // Arbeit (arbeitsBahnAm – dieselbe Rechnung wie Tagesblick/Morgengruß)
  // minus Vorlauf, bei einem frühen Termin entsprechend früher. Ein Tipp
  // setzt den HA-Helfer (input_datetime); den Sonnenaufgang macht dann
  // eine HA-Automation – die Tafel muss nachts nicht laufen. Nie von selbst.
  // ======================================================================
  const WECK_NEIN_KEY = "tafelWecklichtNein";

  function weckHelfer() {
    const id = KC.wecklichtHelfer || "input_datetime.wecklicht";
    return HA().state(id) ? id : null;
  }

  function tagSchluessel(d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  const WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

  function weckPlan() {
    if (typeof arbeitsBahnAm !== "function") return null;
    const now = new Date();
    const abStunde = KC.wecklichtVorschlagAb != null ? KC.wecklichtVorschlagAb : 19;
    if (!(now.getHours() >= abStunde || now.getHours() < 4)) return null;
    const tag = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (now.getHours() >= 12 ? 1 : 0));
    const bahn = arbeitsBahnAm(tag);
    if (!bahn) return null; // Wochenende, Feiertag oder keine Fahrzeit bekannt
    const losMs = bahn.dep ? bahn.dep.leaveByMs : bahn.losMs;
    if (!losMs) return null;
    let ende = losMs - (KC.wecklichtVorlaufMin || 45) * 60000;
    let grund = bahn.dep ? "Bahn " + bahn.dep.line + " um " + bahn.dep.clock : "los um " + fmt(losMs);
    // Früher Termin an dem Tag? Dann 90 min davor wach.
    const snap = typeof tafelSnapshot === "function" ? tafelSnapshot() : null;
    const evs = (snap && snap.calendar) || [];
    const tagEnde = tag.getTime() + 86400000;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.allDay || e.start < tag.getTime() || e.start >= tagEnde) continue;
      if (e.start - 90 * 60000 < ende) {
        ende = e.start - 90 * 60000;
        grund = "Termin um " + fmt(e.start);
      }
      break;
    }
    ende = Math.floor(ende / 300000) * 300000;
    const dauer = (KC.wecklichtDauerMin || 20) * 60000;
    const heute = tag.getDate() === now.getDate();
    return {
      tag: tag, key: tagSchluessel(tag), startMs: ende - dauer, endeMs: ende, grund: grund,
      wann: heute ? "heute" : "morgen", wochentag: WOCHENTAGE[tag.getDay()],
    };
  }

  function weckGesetzt(id, plan) {
    const st = HA().state(id);
    return !!(st && String(st.state).indexOf(plan.key + " ") === 0);
  }

  function weckAbgelehnt(plan) {
    try { return window.localStorage.getItem(WECK_NEIN_KEY) === plan.key; } catch (e) { return false; }
  }

  function stelleWecklicht(id, plan) {
    const d = new Date(plan.startMs);
    const text = tagSchluessel(d) + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + ":00";
    HA().callService("input_datetime", "set_datetime", { datetime: text }, { entity_id: id }).then(function () {
      if (UI()) {
        UI().refresh();
        UI().showGreeting("Wecklicht", plan.wochentag + " " + fmt(plan.startMs) + "–" + fmt(plan.endeMs),
          [Math.round((plan.endeMs - plan.startMs) / 60000) + " Minuten Sonnenaufgang im Schlafzimmer", plan.grund], 5000);
      }
    }).catch(function () {});
  }

  function wecklichtHinweise() {
    if (!KC.wecklicht || !HA() || !HA().isConnected()) return [];
    const id = weckHelfer();
    if (!id) return [];
    const plan = weckPlan();
    if (!plan) return [];
    if (weckGesetzt(id, plan)) {
      // Info (nur auf dem Zuhause-Panel): steht schon
      const st = HA().state(id);
      const ts = HA().attr(st, "timestamp");
      const start = ts ? ts * 1000 : plan.startMs;
      return [{ key: "wecklicht-steht", prio: 4, icon: "sunrise", text: "Wecklicht " + plan.wochentag + " " + fmt(start) + "–" + fmt(start + (KC.wecklichtDauerMin || 20) * 60000) }];
    }
    if (weckAbgelehnt(plan)) return [];
    return [{
      key: "wecklicht|" + plan.key, prio: 2, icon: "sunrise",
      text: "Wecklicht " + plan.wann + " " + fmt(plan.endeMs) + "? " + plan.grund,
      onTap: function () { stelleWecklicht(id, plan); },
    }];
  }

  // ======================================================================
  // Verdrahtung
  // ======================================================================
  let tuerTagCache = null;
  let tuerTagVersion = -1;
  let tuerRenderGeplant = null;

  function onState(id, neu, alt) {
    if (KC.tuerCheck && id.indexOf("tag.") === 0) {
      if (tuerTagVersion !== HA().version()) { tuerTagCache = tuerTagId(); tuerTagVersion = HA().version(); }
      if (id === tuerTagCache && istFrischerScan(neu, alt)) zeigeTuerCheck();
    }
    if (tuerOffen && (id.indexOf("light.") === 0 || id.indexOf("todo.") === 0)) {
      // Lichter gehen durch "Rausgehen" gerade aus → Zeile live nachziehen
      if (!tuerRenderGeplant) {
        tuerRenderGeplant = setTimeout(function () { tuerRenderGeplant = null; tuerRender(); }, 400);
      }
    }
  }

  function init() {
    if (!HA()) return;
    HA().on(function (type, a, b, c) {
      if (type === "state") onState(a, b, c);
      else if (type === "todo" && tuerOffen) tuerRender();
    });
  }

  function hinweise() {
    let out = [];
    try { out = out.concat(wecklichtHinweise()); } catch (e) { /* Prototyp darf nie die Hinweise stören */ }
    return out;
  }

  function ablehnen(key) {
    if (key.indexOf("wecklicht|") === 0) {
      try { window.localStorage.setItem(WECK_NEIN_KEY, key.slice(10)); } catch (e) { /* egal */ }
    }
  }

  window.TafelKonzepte = {
    init: init,
    hinweise: hinweise,
    ablehnen: ablehnen,
    wecklichtPlan: weckPlan,
    tuerCheck: zeigeTuerCheck,
    tuerSchliessen: schliesseTuerCheck,
    debug: function () { return { tuerOffen: tuerOffen, tuerTakt: !!tuerTakt }; },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
