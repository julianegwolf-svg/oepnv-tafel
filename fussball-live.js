// fussball-live.js – Live-Stand der verfolgten Vereine (FEEDBACK 10.10. 09:07:
// „Bei Fußball will ich Live-Ergebnisse“).
//
// Außerhalb von Spielen ruft dieses Modul nichts ab: app.js meldet die
// Spiele (fetchTeamMatches, alle 30 min). Ab 10 min vor Anstoß bis zum
// Abpfiff holt es alle 45 s den Spieltag bei OpenLigaDB – EINE Anfrage je
// Liga und Spieltag, auch wenn mehrere verfolgte Vereine gleichzeitig spielen.
//
// Anzeige:
//  - Chip auf allen Panels: ab 30 min vorher „Heute 15:30 · Bremen – Paderborn“,
//    dann „● LIVE Bremen 1:0 Paderborn · ~23'“, „Halbzeit …“, „Endstand …“
//    (45 min lang). Antippen öffnet die Spielkarte.
//  - Spielkarte im Sport-Panel: Stand groß, Spielminute, Torschützen.
//  - Tor eines verfolgten Vereins: Sport-Panel springt einmal nach vorn,
//    kurzes „TOR!“ (nicht nachts/im Ruhemodus).
// Ehrlich: OpenLigaDB kennt keine Live-Minute – sie wird aus dem Anstoß
// geschätzt und mit „~“ gekennzeichnet. Schlägt der Abruf fehl, steht im
// Chip „Stand 15:58“.
(function () {
  "use strict";

  // const CONFIG (config.js) ist keine window-Eigenschaft – daher typeof
  const CFG = (typeof CONFIG !== "undefined" && CONFIG.fussballLive) || {};
  const TAKT_MS = CFG.taktMs || 45000;
  const VORLAUF_MS = 30 * 60000;
  const ABRUF_AB_MS = 10 * 60000;
  const SPIEL_MAX_MS = 150 * 60000; // inkl. Verlängerung/Elfmeterschießen
  const ENDSTAND_MS = 45 * 60000;

  const spiele = {}; // matchID → { m, team, rang, tore: [a, b] | null, abgerufen, fehlerSeit, endeSeit }
  let timer = null;
  let laeuftAbruf = false;
  const gefeiert = {}; // matchID-Stand → true (jedes Tor nur einmal)

  function teamRang(name) {
    const i = (CONFIG.sportTeams || []).indexOf(name);
    return i === -1 ? 99 : i;
  }

  function kurzName(t) {
    return (t && (t.shortName || t.teamName)) || "?";
  }

  // Stand aus Toren bzw. Ergebnissen; vor dem ersten Tor 0:0 (erst ab Anstoß)
  function standVon(m) {
    const tore = (m.goals || []).filter(function (g) { return g && g.scoreTeam1 != null && g.scoreTeam2 != null; });
    if (tore.length) {
      let best = tore[0];
      tore.forEach(function (g) { if (g.scoreTeam1 + g.scoreTeam2 >= best.scoreTeam1 + best.scoreTeam2) best = g; });
      return [best.scoreTeam1, best.scoreTeam2];
    }
    const res = (m.matchResults || []).filter(function (r) { return r && r.pointsTeam1 != null; });
    if (res.length) {
      let best = res[0];
      res.forEach(function (r) { if (r.resultTypeID === 2 || (best.resultTypeID !== 2 && r.resultOrderID > best.resultOrderID)) best = r; });
      return [best.pointsTeam1, best.pointsTeam2];
    }
    return [0, 0];
  }

  function phase(e, jetzt) {
    const k = anstoss(e.m).getTime();
    const d = jetzt - k;
    if (e.m.matchIsFinished || d > SPIEL_MAX_MS) {
      const seit = e.endeSeit || Math.min(jetzt, k + SPIEL_MAX_MS);
      return jetzt - seit <= ENDSTAND_MS ? "ende" : "weg";
    }
    if (d < -VORLAUF_MS) return "weg";
    if (d < 0) return "vorlauf";
    const min = Math.floor(d / 60000);
    if (min >= 48 && min < 63) return "halbzeit";
    return "live";
  }

  // Geschätzte Spielminute aus dem Anstoß (Pause ~15 min)
  function minuteText(e, jetzt) {
    const min = Math.floor((jetzt - anstoss(e.m).getTime()) / 60000);
    if (min < 0) return "";
    if (min < 45) return "~" + (min + 1) + "'";
    if (min < 48) return "45'+";
    if (min < 63) return "Halbzeit";
    if (min < 108) return "~" + (min - 17) + "'";
    return "90'+";
  }

  // Torschützen kurz wie im Videotext: "N. Füllkrug" → "Füllkrug",
  // "Daniel Svensson" → "Svensson", "Kevin De Bruyne" → "De Bruyne".
  function spielerName(name) {
    const teile = String(name || "").replace(/^(\s*[A-ZÄÖÜ]\.\s*)+/, "").trim().split(/\s+/);
    if (teile.length <= 1) return teile[0] || "";
    for (let i = 1; i < teile.length - 1; i++) {
      if (/^(de|da|di|do|dos|das|du|van|von|der|den|ten|ter|el|al|le|la|mac)$/i.test(teile[i])) return teile.slice(i).join(" ");
    }
    return teile[teile.length - 1];
  }

  // OpenLigaDB: matchMinute 92 + isOvertime = Nachspielzeit → "90+2'";
  // 47 + isOvertime = Nachspielzeit der ersten Halbzeit → "45+2'"
  // (Code-Review S8: alle 27 solchen Tore 2024/25 fielen vor der Pause).
  function torMinute(g) {
    const m = g.matchMinute;
    if (!m) return "";
    if (g.isOvertime && m > 90 && m < 100) return "90+" + (m - 90) + "'";
    if (g.isOvertime && m > 45 && m < 60) return "45+" + (m - 45) + "'";
    return m + "'";
  }

  // Je Mannschaft die Tore als "80' Svensson", "90+2' Füllkrug (Elfm.)".
  // streng: nur zurückgeben, wenn für die Mannschaft so viele benannte Tore
  // da sind, wie sie laut Stand geschossen hat (OpenLigaDB trägt Namen oft
  // erst später nach) – eine halbe Liste sähe wie die ganze aus.
  function torschuetzen(m, streng) {
    const t1 = [];
    const t2 = [];
    const zahl = [0, 0];
    let vorher = [0, 0];
    (m.goals || []).slice().sort(function (a, b) { return (a.scoreTeam1 + a.scoreTeam2) - (b.scoreTeam1 + b.scoreTeam2); }).forEach(function (g) {
      if (g.scoreTeam1 == null) return;
      const fuerEins = g.scoringTeamId && m.team1 && m.team1.teamId ? g.scoringTeamId === m.team1.teamId : g.scoreTeam1 > vorher[0];
      vorher = [g.scoreTeam1, g.scoreTeam2];
      zahl[fuerEins ? 0 : 1]++;
      // ohne Namen nichts erfinden
      if (!g.goalGetterName) return;
      const zeit = torMinute(g);
      const text = (zeit ? zeit + " " : "") + spielerName(g.goalGetterName) + (g.isOwnGoal ? " (ET)" : g.isPenalty ? " (Elfm.)" : "");
      (fuerEins ? t1 : t2).push(text);
    });
    if (streng) {
      // Gegen das amtliche Endergebnis prüfen, nicht gegen die Torliste selbst
      const end = (m.matchResults || []).filter(function (r) { return r && r.resultTypeID === 2 && r.pointsTeam1 != null; })[0];
      const s = end ? [end.pointsTeam1, end.pointsTeam2] : standVon(m);
      return [t1.length === s[0] && zahl[0] === s[0] ? t1 : [], t2.length === s[1] && zahl[1] === s[1] ? t2 : []];
    }
    return [t1, t2];
  }

  // ---------- Daten ----------
  function melden(teamName, matches) {
    const jetzt = Date.now();
    (matches || []).forEach(function (m) {
      if (!m || m.matchID == null) return;
      const k = anstoss(m).getTime();
      if (k - jetzt > 24 * 3600000 || jetzt - k > SPIEL_MAX_MS + ENDSTAND_MS) return;
      const alt = spiele[m.matchID];
      if (alt) {
        // Live-Daten nicht durch den älteren 30-min-Abruf überschreiben
        if (!alt.abgerufen) { alt.m = m; alt.gemeldet = jetzt; }
        if (teamRang(teamName) < alt.rang) { alt.team = teamName; alt.rang = teamRang(teamName); }
        return;
      }
      spiele[m.matchID] = { m: m, team: teamName, rang: teamRang(teamName), tore: null, abgerufen: 0, gemeldet: jetzt, fehlerSeit: 0, endeSeit: m.matchIsFinished ? Math.min(jetzt, k + 110 * 60000) : 0 };
    });
    Object.keys(spiele).forEach(function (id) {
      if (phase(spiele[id], jetzt) === "weg" && jetzt - anstoss(spiele[id].m).getTime() > 0) {
        delete spiele[id];
        Object.keys(gefeiert).forEach(function (k) { if (k.indexOf(id + "-") === 0) delete gefeiert[k]; });
      }
    });
    render();
    planen();
  }

  function aktualisieren(m, jetzt) {
    const e = spiele[m.matchID];
    if (!e) return;
    const neu = standVon(m);
    const alt = e.tore;
    e.m = m;
    e.abgerufen = jetzt;
    e.fehlerSeit = 0;
    if (m.matchIsFinished && !e.endeSeit) e.endeSeit = jetzt;
    const begonnen = jetzt >= anstoss(m).getTime();
    if (!begonnen) return;
    e.tore = neu;
    if (!alt) return; // erste Beobachtung: nichts feiern (Tafel gerade erst gestartet)
    for (let seite = 0; seite < 2; seite++) {
      if (neu[seite] > alt[seite]) tor(e, seite, neu);
    }
  }

  function abrufen() {
    const jetzt = Date.now();
    const gruppen = {};
    Object.keys(spiele).forEach(function (id) {
      const e = spiele[id];
      const k = anstoss(e.m).getTime();
      if (e.m.matchIsFinished || jetzt < k - ABRUF_AB_MS || jetzt - k > SPIEL_MAX_MS) return;
      const g = e.m.group || {};
      if (!e.m.leagueShortcut || !e.m.leagueSeason || g.groupOrderID == null) return;
      gruppen[e.m.leagueShortcut + "/" + e.m.leagueSeason + "/" + g.groupOrderID] = true;
    });
    const pfade = Object.keys(gruppen);
    if (!pfade.length || laeuftAbruf) return Promise.resolve(false);
    laeuftAbruf = true;
    return Promise.all(pfade.map(function (p) {
      return fetch("https://api.openligadb.de/getmatchdata/" + p, { cache: "no-store" }).then(function (res) {
        if (!res.ok) throw new Error("OpenLigaDB live: HTTP " + res.status);
        return res.json();
      }).then(function (liste) {
        const t = Date.now();
        (Array.isArray(liste) ? liste : [liste]).forEach(function (m) { if (m && spiele[m.matchID]) aktualisieren(m, t); });
      }).catch(function (err) {
        console.error(err);
        const t = Date.now();
        Object.keys(spiele).forEach(function (id) { if (!spiele[id].fehlerSeit) spiele[id].fehlerSeit = t; });
      });
    })).then(function () { laeuftAbruf = false; return true; });
  }

  function takt() {
    timer = null;
    return abrufen().then(function () {
      render();
      planen();
    });
  }

  // Nächster Weckzeitpunkt: im Spiel alle 45 s, sonst kurz vor dem nächsten
  // Anstoß bzw. zum Ende eines Vorlaufs/Endstands (für den Chip).
  function planen() {
    if (timer) { clearTimeout(timer); timer = null; }
    const jetzt = Date.now();
    let warte = Infinity;
    Object.keys(spiele).forEach(function (id) {
      const e = spiele[id];
      const k = anstoss(e.m).getTime();
      const ph = phase(e, jetzt);
      if (ph === "live" || ph === "halbzeit" || (ph === "vorlauf" && jetzt >= k - ABRUF_AB_MS)) warte = Math.min(warte, TAKT_MS);
      else if (ph === "vorlauf") warte = Math.min(warte, k - ABRUF_AB_MS - jetzt);
      else if (ph === "ende") warte = Math.min(warte, 60000);
      else if (k - VORLAUF_MS > jetzt) warte = Math.min(warte, k - VORLAUF_MS - jetzt);
    });
    if (warte === Infinity) return;
    timer = setTimeout(takt, Math.max(5000, Math.min(warte, 30 * 60000)));
  }

  // ---------- Tor ----------
  function tor(e, seite, stand) {
    const key = e.m.matchID + "-" + stand[0] + ":" + stand[1];
    if (gefeiert[key]) return;
    gefeiert[key] = true;
    const team = seite === 0 ? e.m.team1 : e.m.team2;
    const unserer = isFollowedTeam(team, e.team) || (CONFIG.sportTeams || []).some(function (n) { return isFollowedTeam(team, n); });
    render();
    const chip = document.querySelector('#liveHints [data-match="' + e.m.matchID + '"]');
    if (chip) {
      chip.classList.add("is-flash");
      setTimeout(function () { chip.classList.remove("is-flash"); }, 2000);
    }
    if (!unserer) return;
    // Prototyp K3 (konzepte.js): Tor-Licht – prüft selbst, ob es an ist
    // Wer hat getroffen? e.team ist der höchstrangige verfolgte Verein des
    // Spiels – bei Werder gegen St. Pauli wäre das auch beim Gegentor Werder.
    const torVerein = (CONFIG.sportTeams || []).filter(function (n) { return isFollowedTeam(team, n); })[0] ||
      (isFollowedTeam(team, e.team) ? e.team : null);
    if (window.TafelKonzepte && TafelKonzepte.tor && torVerein) {
      try { TafelKonzepte.tor({ team: torVerein, stand: stand }); } catch (err) { /* nie das Tor stören */ }
    }
    const dunkel = typeof tafelIstDunkel === "function" && tafelIstDunkel();
    const beschaeftigt = (typeof recentlyTouched !== "undefined" && recentlyTouched) || (typeof panelNavOpen !== "undefined" && panelNavOpen);
    if (dunkel || beschaeftigt || CFG.springen === false) return;
    zeigeSpiel(e.m.matchID);
    const panel = document.getElementById("panel-sport");
    if (!panel) return;
    const alt = panel.querySelector(".tor-overlay");
    if (alt) alt.parentNode.removeChild(alt);
    const o = document.createElement("div");
    o.className = "tor-overlay";
    o.style.setProperty("--team-color", typeof teamColorFor === "function" ? teamColorFor(torVerein || e.team) : "#2e8b57");
    o.innerHTML = '<span class="tor-wort">Tor!</span><span class="tor-stand num"></span>';
    o.lastChild.textContent = kurzName(e.m.team1) + " " + stand[0] + ":" + stand[1] + " " + kurzName(e.m.team2);
    panel.appendChild(o);
    void o.offsetWidth;
    o.classList.add("is-an");
    setTimeout(function () { o.classList.remove("is-an"); }, 2600);
    setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 3200);
  }

  function zeigeSpiel(matchID) {
    if (typeof jumpToPanel !== "function") return;
    jumpToPanel("sport");
    const slides = document.querySelectorAll("#sportBlock .sport-slide");
    for (let i = 0; i < slides.length; i++) {
      if (slides[i].getAttribute("data-match") === String(matchID) && typeof showSportSlide === "function") { showSportSlide(i); break; }
    }
  }

  // ---------- Anzeige ----------
  function chipText(e, ph, jetzt) {
    const s = e.tore || standVon(e.m);
    const paar = kurzName(e.m.team1) + " " + s[0] + ":" + s[1] + " " + kurzName(e.m.team2);
    // Live-Abruf scheitert: ehrlich, von wann der Stand ist (letzter
    // erfolgreicher Live-Abruf, sonst der 30-min-Abruf von app.js)
    const standZeit = e.abgerufen || e.gemeldet;
    const alt = e.fehlerSeit && standZeit && jetzt - standZeit > 3 * 60000
      ? " · Stand " + new Date(standZeit).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "";
    if (ph === "vorlauf") {
      return { wort: "", text: "Heute " + anstoss(e.m).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " · " + kurzName(e.m.team1) + " – " + kurzName(e.m.team2) };
    }
    if (ph === "halbzeit") return { wort: "Halbzeit", text: paar + alt };
    if (ph === "ende") return { wort: e.m.matchIsFinished ? "Endstand" : "Spielende", text: paar };
    return { wort: "Live", text: paar + " · " + minuteText(e, jetzt) + alt };
  }

  function render() {
    const jetzt = Date.now();
    const aktiv = Object.keys(spiele).map(function (id) { return spiele[id]; })
      .map(function (e) { return { e: e, ph: phase(e, jetzt) }; })
      .filter(function (x) { return x.ph !== "weg"; })
      .sort(function (a, b) { return a.e.rang - b.e.rang || anstoss(a.e.m) - anstoss(b.e.m); });

    // Chips (höchstens zwei, nach Reihenfolge der Vereine in config.js)
    const bar = document.querySelector(".statusbar");
    if (bar) {
      let box = document.getElementById("liveHints");
      if (!box) {
        box = document.createElement("div");
        box.className = "warn-hints live-hints";
        box.id = "liveHints";
        const eil = document.getElementById("eilHints");
        bar.insertBefore(box, eil ? eil.nextSibling : (document.getElementById("warnHints") || document.getElementById("haHints") || null));
        box.addEventListener("click", function (ev) {
          const b = ev.target.closest ? ev.target.closest("[data-match]") : null;
          if (!b) return;
          ev.stopPropagation();
          zeigeSpiel(b.getAttribute("data-match"));
        });
      }
      let html = "";
      aktiv.slice(0, 2).forEach(function (x) {
        const c = chipText(x.e, x.ph, jetzt);
        html += '<button type="button" class="ha-hint fussball-hint is-' + x.ph + '" data-match="' + x.e.m.matchID + '">' +
          (x.ph === "live" ? '<span class="live-punkt"></span>' : "") +
          (c.wort ? '<span class="live-wort">' + c.wort + "</span>" : '<span class="live-ball">⚽</span>') +
          '<span class="live-text num">' + esc(c.text) + "</span></button>";
      });
      if (box._html !== html) { box._html = html; box.innerHTML = html; }
    }

    // Spielkarten im Sport-Panel
    aktiv.forEach(function (x) {
      if (x.ph === "vorlauf") return;
      const slide = document.querySelector('#sportBlock .sport-slide[data-match="' + x.e.m.matchID + '"]');
      if (!slide) return;
      const s = x.e.tore || standVon(x.e.m);
      const center = slide.querySelector(".sport-slide-center");
      if (center) {
        let score = center.querySelector(".sport-slide-score");
        if (!score) {
          center.innerHTML = "";
          score = document.createElement("span");
          score.className = "sport-slide-score";
          center.appendChild(score);
        }
        score.textContent = s[0] + ":" + s[1];
      }
      slide.classList.add("is-live");
      const label = slide.querySelector(".sport-slide-label");
      if (label) {
        label.textContent = x.ph === "ende" ? (x.e.m.matchIsFinished ? "Endstand" : "Spielende") : x.ph === "halbzeit" ? "Halbzeit" : "Live · " + minuteText(x.e, jetzt);
        label.classList.toggle("is-live", x.ph === "live");
      }
      const kick = slide.querySelector(".sport-slide-kickoff");
      if (kick) kick.style.display = "none";
      const ts = torschuetzen(x.e.m);
      const teams = slide.querySelectorAll(".sport-slide-team");
      for (let i = 0; i < teams.length && i < 2; i++) {
        let el = teams[i].querySelector(".sport-live-tore");
        if (!el) {
          el = document.createElement("span");
          el.className = "sport-live-tore";
          teams[i].appendChild(el);
        }
        el.textContent = ts[i].join(" · ");
      }
    });
    if (typeof updateHintBar === "function") updateHintBar();
  }

  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  window.FussballLive = {
    melden: melden,
    render: render,
    // Für Proben: sofort abrufen statt auf den Takt zu warten
    takt: takt,
    zustand: function (id) { return spiele[id] || null; },
    // Auch fürs letzte Ergebnis im Sport-Panel (app.js, buildSportSlide)
    torschuetzen: function (m) { return torschuetzen(m, true); },
    anzahl: function () { return Object.keys(spiele).length; },
  };
  if (CFG.aktiv === false) {
    window.FussballLive.melden = function () {};
  }
})();
