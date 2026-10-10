// ---------------------------------------------------------------
// lernen.js — die Tafel lernt Julians Rhythmus (AUSBAU Abschnitt 5)
//
// Zwei Datenquellen, beide bleiben lokal:
//  1. Home-Assistant-Verlauf (nur wenn verbunden): wann jemand das Haus
//     verlässt/heimkommt (person.*) und wann die Automationen hinter den
//     Schnellaktionen laufen (Logbuch). Wird einmal täglich frisch geholt
//     und ERSETZT den alten Stand — wächst also nie.
//  2. Bedienung der Tafel: welche Panels jemand selbst aufruft und welche
//     Schnellaktionen er nutzt — als Zähler je Wochentag × halbe Stunde in
//     localStorage, gedeckelt (beim Überlauf wird alles halbiert).
//
// Daraus entstehen höchstens ein, zwei ruhige Vorschläge zur passenden
// Zeit ("Wie jeden Abend: Gute Nacht?"). Regeln: erst ab 3 gleichen
// Beobachtungen, nie automatisch schalten, Ablehnen/Ignorieren macht den
// Vorschlag seltener. "Was die Tafel gelernt hat" + "Vergessen" in den
// Einstellungen (lange auf die Uhr drücken).
//
// Nur ES2017 (Safari 12), siehe ha.js.
// ---------------------------------------------------------------
(function () {
  "use strict";

  const KEY = "tafelLernen";
  const SLOTS = 48;
  const MAX_ZAEHLER = 40;
  const MIN_BEOBACHTUNGEN = 3;
  const TAG_MS = 24 * 3600 * 1000;
  const WOCHENTAGE = ["sonntags", "montags", "dienstags", "mittwochs", "donnerstags", "freitags", "samstags"];

  function leer() {
    return { v: 1, panel: {}, aktion: {}, ha: {}, haStand: 0, abgelehnt: {}, ignoriert: {} };
  }

  function laden() {
    try {
      const d = JSON.parse(window.localStorage.getItem(KEY) || "null");
      if (d && d.v === 1) return d;
    } catch (e) { /* kaputt → neu */ }
    return leer();
  }

  let daten = laden();
  let speichernTimer = null;

  function speichern() {
    if (speichernTimer) return;
    speichernTimer = setTimeout(function () {
      speichernTimer = null;
      try { window.localStorage.setItem(KEY, JSON.stringify(daten)); } catch (e) { /* voll/privat */ }
    }, 2000);
  }

  function slotIndex(d) {
    return d.getDay() * SLOTS + d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0);
  }

  function zaehle(tabelle, name) {
    let arr = tabelle[name];
    if (!arr || arr.length !== 7 * SLOTS) {
      arr = [];
      for (let i = 0; i < 7 * SLOTS; i++) arr.push(0);
      tabelle[name] = arr;
    }
    const i = slotIndex(new Date());
    arr[i]++;
    // Deckel: statt endlos hochzuzählen, alles halbieren — ältere
    // Gewohnheiten verblassen dadurch von selbst.
    if (arr[i] > MAX_ZAEHLER) {
      for (let k = 0; k < arr.length; k++) arr[k] = Math.floor(arr[k] / 2);
    }
    speichern();
  }

  // ---------- Datenquelle 2: Bedienung der Tafel ----------
  function merkePanel(name) {
    if (!name) return;
    zaehle(daten.panel, name);
  }

  function merkeAktion(id) {
    if (!id) return;
    zaehle(daten.aktion, id);
    // Wer den Vorschlag (oder die Aktion selbst) nutzt, ignoriert ihn nicht.
    delete daten.ignoriert["aktion|" + id];
  }

  // Panels, die um diese Zeit (±30 min, gleicher Wochentag) mindestens 3×
  // selbst aufgerufen wurden — das Karussell zeigt sie dann zuerst.
  function bevorzugtePanels() {
    const i = slotIndex(new Date());
    const out = [];
    Object.keys(daten.panel).forEach(function (name) {
      const arr = daten.panel[name];
      const n = (arr[i] || 0) + (arr[i - 1] || 0) + (arr[i + 1] || 0);
      if (n >= MIN_BEOBACHTUNGEN) out.push({ name: name, n: n });
    });
    out.sort(function (a, b) { return b.n - a.n; });
    return out.slice(0, 3).map(function (x) { return x.name; });
  }

  // ---------- Datenquelle 1: Home-Assistant-Verlauf ----------
  // daten.ha[art] = [{d: Wochentag, m: Minute des Tages, t: Zeitstempel}]
  function ereignis(t) {
    const d = new Date(t);
    return { d: d.getDay(), m: d.getHours() * 60 + d.getMinutes(), t: t };
  }

  function aktionsZiele() {
    if (!window.TafelHAUI || !TafelHAUI.quickActions) return [];
    return TafelHAUI.quickActions().filter(function (a) { return !!a.ziel; });
  }

  function haHolen() {
    const HA = window.TafelHA;
    if (!HA || !HA.isConnected()) return Promise.resolve(false);
    if (Date.now() - daten.haStand < 20 * 3600 * 1000) return Promise.resolve(false);
    const start = new Date(Date.now() - 28 * TAG_MS).toISOString();
    const neu = {};
    const personen = HA.model().global.persons.slice(0, 1);
    const aktionen = aktionsZiele();

    const verlauf = personen.length
      ? HA.ws({ type: "history/history_during_period", start_time: start, entity_ids: personen, minimal_response: true, no_attributes: true, significant_changes_only: false }, 45000)
        .then(function (res) {
          const liste = (res && res[personen[0]]) || [];
          const weg = [];
          const heim = [];
          let vorher = null;
          for (let i = 0; i < liste.length; i++) {
            const st = liste[i].s != null ? liste[i].s : liste[i].state;
            const t = liste[i].lu != null ? liste[i].lu * 1000 : Date.parse(liste[i].last_changed);
            if (vorher === "home" && st !== "home") weg.push(ereignis(t));
            if (vorher && vorher !== "home" && st === "home") heim.push(ereignis(t));
            vorher = st;
          }
          neu.weg = weg.slice(-80);
          neu.heim = heim.slice(-80);
        }).catch(function () {})
      : Promise.resolve();

    const logbuch = aktionen.length
      ? HA.ws({ type: "logbook/get_events", start_time: start, entity_ids: aktionen.map(function (a) { return a.ziel; }) }, 45000)
        .then(function (res) {
          (res || []).forEach(function (e) {
            const a = aktionen.filter(function (x) { return x.ziel === e.entity_id; })[0];
            if (!a || e.when == null) return;
            // Bei Skripten/Szenen zählt jeder Eintrag, bei Automationen nur
            // tatsächliche Auslösungen (nicht an/aus-Schalten).
            if (/^automation\./.test(e.entity_id) && e.state && e.state !== "on") return;
            if (/^automation\./.test(e.entity_id) && e.message && !/trigger|ausgelöst/i.test(e.message)) return;
            const art = "aktion:" + a.id;
            (neu[art] = neu[art] || []).push(ereignis(e.when * 1000));
          });
          Object.keys(neu).forEach(function (k) { if (k.indexOf("aktion:") === 0) neu[k] = neu[k].slice(-80); });
        }).catch(function () {})
      : Promise.resolve();

    return Promise.all([verlauf, logbuch]).then(function () {
      daten.ha = neu;
      daten.haStand = Date.now();
      speichern();
      // Hinweisband sofort neu berechnen, nicht erst beim nächsten Ereignis.
      if (window.TafelHAUI && TafelHAUI.refresh) TafelHAUI.refresh();
      return true;
    });
  }

  // ---------- Muster finden ----------
  const TAGESARTEN = {
    werktags: function (d) { return d >= 1 && d <= 5; },
    wochenende: function (d) { return d === 0 || d === 6; },
  };

  // Dichtestes 60-Minuten-Fenster; Median darin = typische Uhrzeit.
  function typischeZeit(liste, passt) {
    const m = (liste || []).filter(function (e) { return passt(e.d); }).map(function (e) { return e.m; });
    if (m.length < MIN_BEOBACHTUNGEN) return null;
    m.sort(function (a, b) { return a - b; });
    let besterStart = 0;
    let besteAnzahl = 0;
    for (let i = 0; i < m.length; i++) {
      let j = i;
      while (j + 1 < m.length && m[j + 1] - m[i] <= 60) j++;
      if (j - i + 1 > besteAnzahl) { besteAnzahl = j - i + 1; besterStart = i; }
    }
    if (besteAnzahl < MIN_BEOBACHTUNGEN) return null;
    const fenster = m.slice(besterStart, besterStart + besteAnzahl);
    return { minute: fenster[Math.floor(fenster.length / 2)], anzahl: besteAnzahl };
  }

  function tagesart(d) {
    return TAGESARTEN.werktags(d) ? "werktags" : "wochenende";
  }

  // Muster für heute: Werktag/Wochenende — der konkrete Wochentag nur,
  // wenn er davon spürbar abweicht (z. B. "dienstags später") oder es für
  // die Tagesart allein kein Muster gibt.
  function musterHeute(art, jetzt) {
    const liste = daten.ha[art];
    if (!liste || !liste.length) return null;
    const tag = jetzt.getDay();
    const art2 = tagesart(tag);
    const allg = typischeZeit(liste, TAGESARTEN[art2]);
    const konkret = typischeZeit(liste, function (d) { return d === tag; });
    if (allg && (!konkret || Math.abs(konkret.minute - allg.minute) <= 20)) {
      // Nur echte Gewohnheit dieser Tagesart: am heutigen Wochentag muss es
      // auch vorkommen (sonst schlägt die Tafel samstags Werktags-Dinge vor).
      if (!konkret && !(liste.some(function (e) { return e.d === tag; }))) return null;
      allg.wann = art2;
      return allg;
    }
    if (konkret) { konkret.wann = WOCHENTAGE[tag]; return konkret; }
    return null;
  }

  function wannText(wann) {
    if (wann === "wochenende") return "Am Wochenende";
    return wann.charAt(0).toUpperCase() + wann.slice(1);
  }

  function uhr(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  // ---------- Vorschläge ----------
  function gesperrt(key, jetzt) {
    const a = daten.abgelehnt[key];
    if (a && a.bis > jetzt.getTime()) return true;
    const ig = daten.ignoriert[key];
    if (ig && ig.n >= 3 && jetzt.getTime() - ig.zuletzt < 7 * TAG_MS) return true;
    return false;
  }

  function strenger(key) {
    const a = daten.abgelehnt[key];
    return a && a.n >= 3;
  }

  let zuletztGezeigt = {};

  // Liefert höchstens zwei Vorschläge: {key, text, aktion?, panel?}
  function vorschlaege() {
    const jetzt = new Date();
    const minute = jetzt.getHours() * 60 + jetzt.getMinutes();
    const out = [];
    const HA = window.TafelHA;
    const zuHause = HA && HA.isConnected() ? HA.anwesenheit().stand !== "weg" : true;

    // a) Schnellaktionen zur gewohnten Zeit (Gute Nacht, Arbeiten …)
    aktionsZiele().forEach(function (a) {
      if (a.id === "raus") return; // dafür gibt es den Abfahrts-Vorschlag
      const key = "aktion|" + a.id;
      const mu = musterHeute("aktion:" + a.id, jetzt);
      if (!mu || gesperrt(key, jetzt)) return;
      if (strenger(key) && mu.anzahl < 5) return;
      const d = minute - mu.minute;
      if (d < -20 || d > 10 || !zuHause) return;
      // Heute schon ausgelöst? Dann nichts mehr vorschlagen.
      const st = HA ? HA.state(a.ziel) : null;
      const zuletzt = st && st.attributes && st.attributes.last_triggered ? Date.parse(st.attributes.last_triggered) : 0;
      if (zuletzt && jetzt.getTime() - zuletzt < 3 * 3600 * 1000) return;
      let text;
      if (a.id === "nacht") text = mu.anzahl >= 10 ? "Wie jeden Abend: Gute Nacht?" : "Gute Nacht? Sonst meist um " + uhr(mu.minute);
      else text = a.name + "? " + wannText(mu.wann) + " meist ab " + uhr(mu.minute);
      out.push({ key: key, text: text, aktion: a.id, minute: mu.minute });
    });

    // b) Losgehen am Morgen: gewohnte Uhrzeit + passende Bahn
    const weg = musterHeute("weg", jetzt);
    if (weg && zuHause && !gesperrt("weg", jetzt)) {
      const d = minute - weg.minute;
      if (d >= -30 && d <= 5) {
        let text = "Du gehst " + (weg.wann === "wochenende" ? "am Wochenende" : weg.wann) + " meist um " + uhr(weg.minute) + " los";
        // Passende Bahn: die erste, die man zur gewohnten Zeit noch schafft.
        const gewohnt = new Date(jetzt.getTime());
        gewohnt.setHours(Math.floor(weg.minute / 60), weg.minute % 60 - 3, 0, 0);
        const ab = Math.max(Date.now() - 60000, gewohnt.getTime());
        const snap = typeof tafelSnapshot === "function" ? tafelSnapshot() : null;
        const bahn = snap && snap.departures ? snap.departures.filter(function (x) {
          return x.leaveByMs && x.leaveByMs >= ab;
        })[0] : null;
        // Werktags dieselbe Bahn wie Morgengruß/Tagesblick (Arbeitslinie in
        // der richtigen Richtung, späteste pünktliche) – vorher stand hier
        // irgendeine Linie ("Linie 29 um 07:37"), dort "die 23 um 07:35".
        const arbeit = weg.wann !== "wochenende" && typeof arbeitsBahnHeute === "function" ? arbeitsBahnHeute() : null;
        if (arbeit && arbeit.dep) {
          const inMin = Math.max(0, Math.round((arbeit.dep.leaveByMs - Date.now()) / 60000));
          text += " – für die " + arbeit.dep.line + " um " + arbeit.dep.clock + (inMin <= 1 ? ": jetzt los" : " los in " + inMin + " Min");
        } else if (bahn) {
          const inMin = Math.max(0, Math.round((bahn.leaveByMs - Date.now()) / 60000));
          text += " – Linie " + bahn.line + " um " + bahn.clock + (inMin <= 1 ? ": jetzt los" : ", in " + inMin + " Min los");
        }
        out.push({ key: "weg", text: text, panel: "departures", minute: weg.minute });
      }
    }

    out.sort(function (a, b) { return Math.abs(a.minute - minute) - Math.abs(b.minute - minute); });
    const res = out.slice(0, 2);
    // Ignorieren mitzählen: Vorschlag war sichtbar, Fenster ist vorbei,
    // nicht genutzt → beim nächsten Mal zurückhaltender.
    const jetztKeys = {};
    res.forEach(function (v) { jetztKeys[v.key] = true; zuletztGezeigt[v.key] = Date.now(); });
    Object.keys(zuletztGezeigt).forEach(function (k) {
      if (jetztKeys[k]) return;
      if (Date.now() - zuletztGezeigt[k] > 15 * 60 * 1000) {
        const ig = daten.ignoriert[k] || { n: 0, zuletzt: 0 };
        ig.n++;
        ig.zuletzt = Date.now();
        daten.ignoriert[k] = ig;
        delete zuletztGezeigt[k];
        speichern();
      }
    });
    return res;
  }

  function annehmen(key) {
    delete daten.ignoriert[key];
    delete zuletztGezeigt[key];
    if (daten.abgelehnt[key]) daten.abgelehnt[key].n = Math.max(0, daten.abgelehnt[key].n - 1);
    speichern();
  }

  function ablehnen(key) {
    const a = daten.abgelehnt[key] || { n: 0, bis: 0 };
    a.n++;
    const morgen = new Date();
    morgen.setHours(24, 0, 0, 0);
    a.bis = morgen.getTime();
    daten.abgelehnt[key] = a;
    delete zuletztGezeigt[key];
    speichern();
  }

  // ---------- "Was die Tafel gelernt hat" ----------
  const PANEL_NAMEN = {
    departures: "Abfahrten", commute: "Arbeitsweg", weather: "Wetter", news: "Nachrichten", music: "Musik",
    sport: "Fußball", quote: "Spruch", trivia: "Auf den Tag genau", quiz: "Allgemeinwissen", riddle: "Rätsel",
    events: "Veranstaltungen", calendar: "Termine", home: "Zuhause", klima: "Raumklima", medien: "Medien",
  };

  function beschreibung() {
    const out = [];
    const jetzt = new Date();
    const weg = daten.ha.weg ? typischeZeit(daten.ha.weg, TAGESARTEN.werktags) : null;
    if (weg) out.push("Werktags verlässt du meist um " + uhr(weg.minute) + " das Haus (" + weg.anzahl + "× in 4 Wochen).");
    const heim = daten.ha.heim ? typischeZeit(daten.ha.heim, TAGESARTEN.werktags) : null;
    if (heim) out.push("Werktags kommst du meist um " + uhr(heim.minute) + " heim (" + heim.anzahl + "×).");
    aktionsZiele().forEach(function (a) {
      const liste = daten.ha["aktion:" + a.id];
      if (!liste) return;
      ["werktags", "wochenende"].forEach(function (art) {
        const mu = typischeZeit(liste, TAGESARTEN[art]);
        if (mu) out.push("„" + a.name + "“ " + (art === "werktags" ? "werktags" : "am Wochenende") + " meist um " + uhr(mu.minute) + " (" + mu.anzahl + "×).");
      });
    });
    const panels = Object.keys(daten.panel).map(function (name) {
      return { name: name, n: daten.panel[name].reduce(function (s2, x) { return s2 + x; }, 0) };
    }).filter(function (x) { return x.n >= MIN_BEOBACHTUNGEN; }).sort(function (a, b) { return b.n - a.n; });
    if (panels.length) {
      out.push("Am häufigsten selbst aufgerufen: " + panels.slice(0, 3).map(function (x) { return (PANEL_NAMEN[x.name] || x.name) + " (" + x.n + "×)"; }).join(", ") + ".");
    }
    const abgelehnt = Object.keys(daten.abgelehnt).filter(function (k) { return daten.abgelehnt[k].n > 0; });
    if (abgelehnt.length) out.push(abgelehnt.length + " Vorschlag/Vorschläge hast du abgelehnt – die kommen jetzt seltener.");
    if (!out.length) out.push("Noch nichts – die Tafel braucht ein paar Tage mit mindestens 3 gleichen Situationen, bevor sie etwas vorschlägt.");
    void jetzt;
    return out;
  }

  function vergessen() {
    daten = leer();
    zuletztGezeigt = {};
    try { window.localStorage.removeItem(KEY); } catch (e) { /* egal */ }
  }

  // HA-Verlauf nach dem Verbinden und danach täglich holen.
  function init() {
    if (window.TafelHA) {
      TafelHA.on(function (type) {
        if (type === "sync") setTimeout(haHolen, 20000);
      });
    }
    setInterval(haHolen, 6 * 3600 * 1000);
  }

  window.TafelLernen = {
    init: init,
    merkePanel: merkePanel,
    merkeAktion: merkeAktion,
    bevorzugtePanels: bevorzugtePanels,
    vorschlaege: vorschlaege,
    annehmen: annehmen,
    ablehnen: ablehnen,
    beschreibung: beschreibung,
    vergessen: vergessen,
    // Gewohnte Uhrzeit (Minute des Tages) für einen Tag, z. B. "weg" =
    // Losgehen — für "Morgen früh" im Tagesblick. null, wenn nicht gelernt.
    typischeZeit: function (art, tag) {
      const mu = musterHeute(art, tag);
      return mu ? mu.minute : null;
    },
    // Für Tests (Simulator mit Wochen-Verlauf): sofort neu lernen.
    neuLernen: function () { daten.haStand = 0; return haHolen(); },
    _daten: function () { return daten; },
  };
})();
