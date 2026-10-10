// ---------------------------------------------------------------
// Zeit-Debug-Parameter (nur zum Prüfen, ohne Parameter wirkungslos)
//
//   ?jetzt=2026-10-12T07:20   Uhr der ganzen Seite auf diesen Zeitpunkt
//                             (lokale Zeit) stellen; läuft ab da weiter.
//   ?jetzt=07:20              heute, 07:20 Uhr
//   ?tempo=60                 Zeitraffer: Zeit läuft 60× schneller. Auch
//                             setTimeout/setInterval laufen dann 60×
//                             schneller, damit Karussell, Ambient-Timer,
//                             Nachtdimmung usw. zur Uhr passen.
//   &timer=echt               (mit tempo) Timer NICHT beschleunigen.
//
// Muss VOR config.js/app.js geladen werden (siehe index.html).
// Safari 12: bewusst ES5-Stil, kein class extends Date — Date wird durch
// einen Funktions-Wrapper mit übernommenem Prototyp ersetzt. Dadurch
// funktionieren new Date(ms), new Date("…"), new Date(y, m, d, …),
// Date.UTC, Date.parse und "x instanceof Date" unverändert; nur
// new Date() / Date() / Date.now() liefern die verschobene Zeit.
//
// Damit Abfahrten zur verschobenen Zeit passen, bekommt die Transitous-
// Abfrage (stoptimes) im Debug-Modus den Parameter time=… angehängt.
// Im Zeitraffer gehen externe Abrufe höchstens alle 20 s (echte Zeit) je
// Adresse raus, sonst wird die letzte Antwort wiederverwendet – damit
// beschleunigte Intervalle keine fremden Server fluten.
//
// Die App lädt sich regelmäßig selbst neu (URL "?_=…", ohne unsere
// Parameter). Damit eine Zeitraffer-Probe über so einen Neustart hinweg
// weiterläuft, merkt sich das Skript seinen Zustand in sessionStorage
// (nur dieser Tab) und setzt ihn bei einer "?_="-Adresse fort.
// ---------------------------------------------------------------
(function () {
  "use strict";

  var SPEICHER_KEY = "tafelDebugZeit";
  var OrigDate = window.Date;
  var suche = window.location.search || "";

  function param(name) {
    var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(suche);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : null;
  }

  // "2026-10-12T07:20[:ss]", "2026-10-12 07:20", "2026-10-12" oder "07:20"
  // – immer als LOKALE Zeit. Bewusst von Hand geparst: Safari 12 legt
  // "YYYY-MM-DDTHH:mm" ohne Zeitzone nicht zuverlässig als Ortszeit aus.
  function parseJetzt(text) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
    if (m) {
      return new OrigDate(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
    }
    m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
    if (m) {
      var d = new OrigDate();
      d.setHours(+m[1], +m[2], +(m[3] || 0), 0);
      return d.getTime();
    }
    return NaN;
  }

  var jetztText = param("jetzt");
  var tempoText = param("tempo");
  var timerText = param("timer");
  var startFake = null;
  var tempo = 1;
  var timerEcht = timerText === "echt";

  var seit = OrigDate.now(); // echter Beginn der Debug-Sitzung
  var gespeichert = null;
  try { gespeichert = JSON.parse(window.sessionStorage.getItem(SPEICHER_KEY) || "null"); } catch (e) { gespeichert = null; }

  if (jetztText !== null || tempoText !== null) {
    if (jetztText !== null) {
      startFake = parseJetzt(jetztText);
      if (isNaN(startFake)) {
        console.warn("debug-zeit: ?jetzt=" + jetztText + " nicht verstanden (erwartet z. B. 2026-10-12T07:20)");
        startFake = null;
      }
    }
    if (tempoText !== null) {
      tempo = parseFloat(tempoText);
      if (!(tempo > 0)) {
        console.warn("debug-zeit: ?tempo=" + tempoText + " nicht verstanden");
        tempo = 1;
      }
    }
  } else if (gespeichert && /[?&]_=\d/.test(suche) &&
             OrigDate.now() - gespeichert.gemerkt < 2 * 60 * 1000 &&
             OrigDate.now() - gespeichert.seit < 30 * 60 * 60 * 1000) {
    // Selbst-Neuladen der App während einer Debug-Sitzung (gerade eben
    // gemerkt, Sitzung jünger als 30 h): fortsetzen. Eine vergessene
    // Debug-Sitzung kann so nie dauerhaft hängen bleiben.
    startFake = gespeichert.fake;
    seit = gespeichert.seit;
    tempo = gespeichert.tempo || 1;
    timerEcht = !!gespeichert.timerEcht;
  } else {
    if (gespeichert) {
      try { window.sessionStorage.removeItem(SPEICHER_KEY); } catch (e) { /* egal */ }
    }
    return; // Kein Parameter: absolut keine Wirkung.
  }

  if (startFake === null && tempo === 1) return;

  var startEcht = OrigDate.now();
  if (startFake === null) startFake = startEcht;

  function fakeNow() {
    return Math.floor(startFake + (OrigDate.now() - startEcht) * tempo);
  }

  // ---------- Date ersetzen ----------
  function DebugDate(a, b, c, d, e, f, g) {
    if (!(this instanceof DebugDate)) {
      // Date() als Funktion aufgerufen liefert einen String der aktuellen Zeit.
      return new OrigDate(fakeNow()).toString();
    }
    if (arguments.length === 0) return new OrigDate(fakeNow());
    // Argumente unverändert (inkl. Anzahl!) weiterreichen: new OrigDate(2026, 9)
    // ist etwas anderes als new OrigDate(2026, 9, undefined).
    var args = [null];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    return new (Function.prototype.bind.apply(OrigDate, args))();
  }
  DebugDate.prototype = OrigDate.prototype; // instanceof Date bleibt wahr
  DebugDate.now = function () { return fakeNow(); };
  DebugDate.parse = OrigDate.parse;
  DebugDate.UTC = OrigDate.UTC;
  DebugDate.toString = function () { return OrigDate.toString(); };
  window.Date = DebugDate;

  // ---------- Timer im Zeitraffer beschleunigen ----------
  if (tempo !== 1 && !timerEcht) {
    var origSetTimeout = window.setTimeout;
    var origSetInterval = window.setInterval;
    var skaliere = function (ms) {
      ms = +ms || 0;
      return ms / tempo;
    };
    window.setTimeout = function (fn, ms) {
      var args = Array.prototype.slice.call(arguments);
      args[1] = skaliere(ms);
      return origSetTimeout.apply(window, args);
    };
    window.setInterval = function (fn, ms) {
      var args = Array.prototype.slice.call(arguments);
      args[1] = Math.max(skaliere(ms), 4);
      return origSetInterval.apply(window, args);
    };
  }

  // ---------- fetch: Abfahrten zur verschobenen Zeit, Drossel im Zeitraffer ----------
  var origFetch = window.fetch;
  if (typeof origFetch === "function") {
    var puffer = {}; // Schlüssel → { t: echte Zeit, p: Promise<Response> }
    var DROSSEL_MS = 20000;

    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url);
      if (!url) return origFetch.apply(window, arguments);

      var schluessel = url.replace(/([?&])_=\d+&?/, "$1");
      if (/api\.transitous\.org\/api\/v\d+\/stoptimes/.test(url) && !/[?&]time=/.test(url)) {
        url += (url.indexOf("?") === -1 ? "?" : "&") + "time=" +
          encodeURIComponent(new OrigDate(fakeNow()).toISOString());
        input = url;
      }

      var extern = /^https?:\/\//.test(url) && url.indexOf(window.location.origin) !== 0;
      if (tempo === 1 || !extern) return origFetch.call(window, input, init);

      var t = OrigDate.now();
      for (var k in puffer) {
        if (t - puffer[k].t > DROSSEL_MS) delete puffer[k];
      }
      var eintrag = puffer[schluessel];
      if (!eintrag) {
        eintrag = { t: t, p: origFetch.call(window, input, init) };
        puffer[schluessel] = eintrag;
        eintrag.p.catch(function () { delete puffer[schluessel]; });
      }
      return eintrag.p.then(function (res) { return res.clone(); });
    };
  }

  // ---------- Zustand für Selbst-Neuladen merken ----------
  function merke() {
    try {
      window.sessionStorage.setItem(SPEICHER_KEY, JSON.stringify({
        fake: fakeNow(), tempo: tempo, timerEcht: timerEcht, seit: seit, gemerkt: OrigDate.now(),
      }));
    } catch (e) { /* privater Modus o. ä. – dann eben nicht */ }
  }
  merke();
  window.addEventListener("pagehide", merke);
  window.addEventListener("beforeunload", merke);

  window.debugZeit = {
    aktiv: true, tempo: tempo, jetzt: fakeNow, echtesDate: OrigDate,
    // Nur für Proben: Uhr auf einen anderen Zeitpunkt (ms) springen lassen
    springe: function (ms) { startFake = ms; startEcht = OrigDate.now(); merke(); },
  };
  console.info("debug-zeit: Uhr verstellt auf " + new OrigDate(fakeNow()).toString() + (tempo !== 1 ? ", Tempo ×" + tempo : ""));
})();
