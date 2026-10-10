// kalender.js – Termine aus einer ICS-Datei (privater Kalender über den
// Cloudflare-Worker) so lesen, wie ein Kalenderprogramm sie zeigt:
// wiederkehrende Termine (RRULE, EXDATE, einzeln verschobene Termine per
// RECURRENCE-ID), abgesagte Termine, mehrtägige Termine und Zeitzonen.
//
// Vorher (app.js bis Sitzung 5) las die Tafel nur DTSTART: Ein jährlicher
// Geburtstag erschien nie, weil sein erster Termin in der Vergangenheit lag,
// ein laufender Urlaub ebenso wenig, und Uhrzeiten wie
// DTSTART;TZID=Europe/Berlin:20261012T090000 wurden per
// new Date("2026-10-12T09:00:00") gelesen – Safari 12 versteht das als UTC,
// auf dem iPad stand der Termin um 11:00.
//
// Alles wird aus Zahlen-Komponenten gerechnet (Date.UTC / new Date(j, m, t)),
// nie über einen Text-Parser. Jede Serie hat eine Notbremse, damit eine
// kaputte Regel die Tafel nicht einfrieren kann.
(function () {
  "use strict";

  const WOCHENTAG = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const MAX_PERIODEN = 20000; // täglich über ~55 Jahre
  const TAG_MS = 86400000;

  // Mitteleuropäische Regel für TZIDs ohne VTIMEZONE-Block (z. B. Outlook-
  // Namen): MEZ +1, MESZ +2 von letztem März- bis letztem Oktobersonntag.
  const MEZ = {
    teile: [
      { offset: 60, regel: { monat: 9, n: -1, wt: 0 }, h: 3, mi: 0, abJahr: 1996 },
      { offset: 120, regel: { monat: 2, n: -1, wt: 0 }, h: 2, mi: 0, abJahr: 1981 },
    ],
  };
  const MEZ_NAMEN = /^(Europe\/(Berlin|Amsterdam|Brussels|Paris|Rome|Madrid|Vienna|Zurich|Copenhagen|Oslo|Stockholm|Prague|Warsaw|Budapest|Luxembourg|Monaco|Belgrade|Bratislava|Ljubljana|Zagreb|Malta|Andorra|Vaduz|Busingen)|W\. Europe Standard Time|Romance Standard Time|Central Europe(an)? Standard Time|CET|MET)$/;

  function entfalten(text) {
    return String(text || "").replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "");
  }

  function textWert(s) {
    return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
  }

  // "DTSTART;TZID=Europe/Berlin:20261012T090000" → { name, params, wert }
  function zeileLesen(line) {
    let i = 0;
    let inQ = false;
    for (; i < line.length; i++) {
      const c = line.charAt(i);
      if (c === '"') inQ = !inQ;
      else if (c === ":" && !inQ) break;
    }
    if (i >= line.length) return null;
    const kopf = line.slice(0, i).split(";");
    const params = {};
    for (let k = 1; k < kopf.length; k++) {
      const eq = kopf[k].indexOf("=");
      if (eq > 0) params[kopf[k].slice(0, eq).toUpperCase()] = kopf[k].slice(eq + 1).replace(/^"|"$/g, "");
    }
    return { name: kopf[0].toUpperCase(), params: params, wert: line.slice(i + 1).trim() };
  }

  // "+0200" / "-0600" / "+020000" → Minuten
  function offsetMin(s) {
    const m = /^([+-])(\d{2})(\d{2})/.exec(s || "");
    if (!m) return 0;
    return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  }

  // "20261012" oder "20261012T090000(Z)" → Komponenten
  function komponenten(wert) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(wert || "");
    if (!m) return null;
    return {
      j: Number(m[1]), mo: Number(m[2]) - 1, t: Number(m[3]),
      h: m[4] ? Number(m[4]) : 0, mi: m[5] ? Number(m[5]) : 0, s: m[6] ? Number(m[6]) : 0,
      nurDatum: !m[4], utc: !!m[7],
    };
  }

  // n-ter Wochentag wt im Monat (n < 0: vom Monatsende), 0 = gibt es nicht
  function nterWochentag(j, mo, n, wt) {
    const tage = new Date(Date.UTC(j, mo + 1, 0)).getUTCDate();
    if (n > 0) {
      const erster = new Date(Date.UTC(j, mo, 1)).getUTCDay();
      const t = 1 + ((wt - erster + 7) % 7) + (n - 1) * 7;
      return t <= tage ? t : 0;
    }
    const letzter = new Date(Date.UTC(j, mo, tage)).getUTCDay();
    const t = tage - ((letzter - wt + 7) % 7) + (n + 1) * 7;
    return t >= 1 ? t : 0;
  }

  // ---------- Zeitzonen ----------
  function zoneLesen(zeilen) {
    const teile = [];
    let teil = null;
    zeilen.forEach(function (z) {
      if (z.name === "BEGIN" && (z.wert === "STANDARD" || z.wert === "DAYLIGHT")) { teil = {}; return; }
      if (z.name === "END" && (z.wert === "STANDARD" || z.wert === "DAYLIGHT")) {
        if (teil && teil.start) {
          const c = teil.start;
          let regel = null;
          let bisWand = Infinity;
          if (teil.rrule) {
            const r = regelLesen(teil.rrule);
            if (r && r.bymonth && r.bymonth.length && r.byday && r.byday.length && r.byday[0].n) {
              regel = { monat: r.bymonth[0] - 1, n: r.byday[0].n, wt: r.byday[0].wt };
            }
            // Historische Regeln (z. B. "bis 1918 im April") enden per UNTIL.
            const u = r && r.until ? komponenten(r.until) : null;
            if (u) bisWand = Date.UTC(u.j, u.mo, u.t, u.h, u.mi, u.s);
          }
          teile.push({ offset: teil.offset || 0, regel: regel, h: c.h, mi: c.mi, abJahr: c.j, bisWand: bisWand, startWand: Date.UTC(c.j, c.mo, c.t, c.h, c.mi) });
        }
        teil = null;
        return;
      }
      if (!teil) return;
      if (z.name === "DTSTART") teil.start = komponenten(z.wert);
      else if (z.name === "TZOFFSETTO") teil.offset = offsetMin(z.wert);
      else if (z.name === "RRULE") teil.rrule = z.wert;
    });
    return teile.length ? { teile: teile } : null;
  }

  // Versatz in Minuten, der zur Wandzeit (als UTC-Zahl) in der Zone gilt:
  // der Teil mit dem letzten Übergang davor (dieses oder voriges Jahr).
  function zonenVersatz(zone, wand) {
    const j = new Date(wand).getUTCFullYear();
    let bester = null;
    let besterT = -Infinity;
    zone.teile.forEach(function (teil) {
      [j - 1, j].forEach(function (jahr) {
        let tw;
        if (teil.regel) {
          if (jahr < teil.abJahr) return;
          const tag = nterWochentag(jahr, teil.regel.monat, teil.regel.n, teil.regel.wt);
          if (!tag) return;
          tw = Date.UTC(jahr, teil.regel.monat, tag, teil.h, teil.mi);
          if (tw > teil.bisWand) return;
        } else {
          tw = teil.startWand;
          if (tw === undefined) return;
        }
        if (tw <= wand && tw > besterT) { besterT = tw; bester = teil; }
      });
    });
    return (bester || zone.teile[0]).offset;
  }

  // Bezugsrahmen eines Datumswerts: "tag" (ganztägig), "utc", "lokal"
  // (schwebende Zeit = Ortszeit des iPads) oder eine Zone.
  function rahmen(params, c, zonen) {
    if (c.nurDatum || params.VALUE === "DATE") return "tag";
    if (c.utc) return "utc";
    const tzid = params.TZID;
    if (!tzid) return "lokal";
    if (/^(UTC|GMT|Etc\/UTC|Etc\/GMT|Z)$/i.test(tzid)) return "utc";
    if (zonen[tzid]) return zonen[tzid];
    if (MEZ_NAMEN.test(tzid)) return MEZ;
    const fest = /^(?:GMT|UTC)([+-]\d{2}):?(\d{2})$/.exec(tzid);
    if (fest) return { teile: [{ offset: offsetMin(fest[1] + fest[2]), regel: null, startWand: -Infinity }] };
    return "lokal";
  }

  function wandZuMs(r, j, mo, t, h, mi, s) {
    if (r === "tag" || r === "lokal") return new Date(j, mo, t, h, mi, s).getTime();
    const wand = Date.UTC(j, mo, t, h, mi, s);
    if (r === "utc") return wand;
    return wand - zonenVersatz(r, wand) * 60000;
  }

  function wertZuMs(params, wert, zonen) {
    const c = komponenten(wert);
    if (!c) return null;
    const r = rahmen(params, c, zonen);
    return { ms: wandZuMs(r, c.j, c.mo, c.t, c.h, c.mi, c.s), c: c, rahmen: r };
  }

  // ---------- Wiederholungsregel ----------
  function regelLesen(text) {
    const r = { freq: null, interval: 1, count: 0, until: null, byday: null, bymonthday: null, bymonth: null, bysetpos: null, wkst: 1, unbekannt: false };
    String(text || "").split(";").forEach(function (teil) {
      const eq = teil.indexOf("=");
      if (eq < 0) return;
      const k = teil.slice(0, eq).toUpperCase();
      const v = teil.slice(eq + 1);
      if (k === "FREQ") r.freq = v.toUpperCase();
      else if (k === "INTERVAL") r.interval = Math.max(1, parseInt(v, 10) || 1);
      else if (k === "COUNT") r.count = Math.max(0, parseInt(v, 10) || 0);
      else if (k === "UNTIL") r.until = v;
      else if (k === "WKST") r.wkst = WOCHENTAG[v.toUpperCase()] != null ? WOCHENTAG[v.toUpperCase()] : 1;
      else if (k === "BYDAY") {
        r.byday = v.split(",").map(function (x) {
          const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(x.trim());
          return m ? { n: m[1] ? parseInt(m[1], 10) : 0, wt: WOCHENTAG[m[2].toUpperCase()] } : null;
        }).filter(Boolean);
      } else if (k === "BYMONTHDAY") r.bymonthday = v.split(",").map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x && Math.abs(x) <= 31; });
      else if (k === "BYMONTH") r.bymonth = v.split(",").map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x >= 1 && x <= 12; });
      else if (k === "BYSETPOS") r.bysetpos = v.split(",").map(function (x) { return parseInt(x, 10); }).filter(Boolean);
      else if (k === "BYYEARDAY") r.byyearday = v.split(",").map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x && Math.abs(x) <= 366; });
      else if (k === "BYWEEKNO" || k === "BYHOUR" || k === "BYMINUTE" || k === "BYSECOND" || k === "RSCALE") r.unbekannt = true;
    });
    if (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].indexOf(r.freq) === -1) r.unbekannt = true;
    if (r.byyearday && r.freq !== "YEARLY") r.unbekannt = true; // nur jährlich unterstützt
    return r;
  }

  // Tage (1–31) eines Monats, die zur Regel passen; null = Regel greift nicht
  // BYSETPOS: Positionen aus der sortierten Kandidatenliste einer Periode
  function setposAnwenden(liste, r) {
    if (!r.bysetpos || !liste.length) return liste;
    const aus = [];
    r.bysetpos.forEach(function (p) {
      const d = p > 0 ? liste[p - 1] : liste[liste.length + p];
      if (d && aus.indexOf(d) === -1) aus.push(d);
    });
    return aus.sort(function (a, b) { return Date.UTC(a.j, a.mo, a.t) - Date.UTC(b.j, b.mo, b.t); });
  }

  function tageImMonat(r, j, mo, starttag, ohneSetpos) {
    const anzahl = new Date(Date.UTC(j, mo + 1, 0)).getUTCDate();
    let tage = [];
    if (r.bymonthday) {
      r.bymonthday.forEach(function (d) {
        const t = d > 0 ? d : anzahl + d + 1;
        if (t >= 1 && t <= anzahl) tage.push(t);
      });
      if (r.byday) {
        tage = tage.filter(function (t) {
          const wt = new Date(Date.UTC(j, mo, t)).getUTCDay();
          return r.byday.some(function (b) { return b.wt === wt; });
        });
      }
    } else if (r.byday) {
      r.byday.forEach(function (b) {
        if (b.n) {
          const t = nterWochentag(j, mo, b.n, b.wt);
          if (t) tage.push(t);
        } else {
          for (let t = 1; t <= anzahl; t++) if (new Date(Date.UTC(j, mo, t)).getUTCDay() === b.wt) tage.push(t);
        }
      });
    } else if (starttag <= anzahl) {
      tage.push(starttag);
    }
    tage.sort(function (a, b) { return a - b; });
    tage = tage.filter(function (t, i) { return i === 0 || tage[i - 1] !== t; });
    if (r.bysetpos && tage.length && !ohneSetpos) {
      const alle = tage;
      tage = [];
      r.bysetpos.forEach(function (p) {
        const t = p > 0 ? alle[p - 1] : alle[alle.length + p];
        if (t && tage.indexOf(t) === -1) tage.push(t);
      });
      tage.sort(function (a, b) { return a - b; });
    }
    return tage;
  }

  // Kandidaten-Daten {j, mo, t} der Periode k (aufsteigend)
  function periode(r, c, k) {
    if (r.freq === "DAILY") {
      const d = new Date(Date.UTC(c.j, c.mo, c.t + k * r.interval));
      const kand = { j: d.getUTCFullYear(), mo: d.getUTCMonth(), t: d.getUTCDate() };
      if (r.bymonth && r.bymonth.indexOf(kand.mo + 1) === -1) return [];
      if (r.byday && !r.byday.some(function (b) { return b.wt === d.getUTCDay(); })) return [];
      if (r.bymonthday && tageImMonat({ bymonthday: r.bymonthday }, kand.j, kand.mo, kand.t).indexOf(kand.t) === -1) return [];
      return [kand];
    }
    if (r.freq === "WEEKLY") {
      const startWt = new Date(Date.UTC(c.j, c.mo, c.t)).getUTCDay();
      const wochenAnfang = c.t - ((startWt - r.wkst + 7) % 7) + k * 7 * r.interval;
      const wts = r.byday && r.byday.length ? r.byday.map(function (b) { return b.wt; }) : [startWt];
      const liste = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(Date.UTC(c.j, c.mo, wochenAnfang + i));
        if (wts.indexOf(d.getUTCDay()) === -1) continue;
        if (r.bymonth && r.bymonth.indexOf(d.getUTCMonth() + 1) === -1) continue;
        liste.push({ j: d.getUTCFullYear(), mo: d.getUTCMonth(), t: d.getUTCDate() });
      }
      return setposAnwenden(liste, r);
    }
    if (r.freq === "MONTHLY") {
      const m = new Date(Date.UTC(c.j, c.mo + k * r.interval, 1));
      const j = m.getUTCFullYear();
      const mo = m.getUTCMonth();
      if (r.bymonth && r.bymonth.indexOf(mo + 1) === -1) return [];
      return tageImMonat(r, j, mo, c.t).map(function (t) { return { j: j, mo: mo, t: t }; });
    }
    // YEARLY
    const j = c.j + k * r.interval;
    if (r.byyearday) {
      const ende = Date.UTC(j + 1, 0, 1);
      return r.byyearday.map(function (n) { return new Date(n > 0 ? Date.UTC(j, 0, n) : ende + n * TAG_MS); })
        .filter(function (d) { return d.getUTCFullYear() === j && (!r.bymonth || r.bymonth.indexOf(d.getUTCMonth() + 1) !== -1); })
        .sort(function (a, b) { return a - b; })
        .map(function (d) { return { j: j, mo: d.getUTCMonth(), t: d.getUTCDate() }; });
    }
    const ganzesJahr = !(r.bymonth && r.bymonth.length) && !!(r.byday || r.bymonthday);
    // "20. Montag des Jahres" (BYDAY mit Zahl, ohne BYMONTH): im ganzen Jahr zählen
    if (ganzesJahr && r.byday && !r.bymonthday && r.byday.some(function (b) { return b.n; })) {
      const tageImJahr = [];
      r.byday.forEach(function (b) {
        const alle = [];
        for (let d = new Date(Date.UTC(j, 0, 1)); d.getUTCFullYear() === j; d = new Date(d.getTime() + TAG_MS)) {
          if (d.getUTCDay() === b.wt) alle.push({ j: j, mo: d.getUTCMonth(), t: d.getUTCDate() });
        }
        if (!b.n) alle.forEach(function (x) { tageImJahr.push(x); });
        else {
          const x = b.n > 0 ? alle[b.n - 1] : alle[alle.length + b.n];
          if (x) tageImJahr.push(x);
        }
      });
      tageImJahr.sort(function (a, b) { return Date.UTC(a.j, a.mo, a.t) - Date.UTC(b.j, b.mo, b.t); });
      return setposAnwenden(tageImJahr, r);
    }
    const monate = r.bymonth && r.bymonth.length ? r.bymonth.map(function (x) { return x - 1; })
      : (ganzesJahr ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : [c.mo]);
    const liste = [];
    monate.sort(function (a, b) { return a - b; }).forEach(function (mo) {
      const nurStarttag = !r.byday && !r.bymonthday;
      tageImMonat(r, j, mo, c.t, true).forEach(function (t) {
        // 29. Februar: nur in Schaltjahren (kein Ausweichen auf den 28.)
        if (nurStarttag && t !== c.t) return;
        liste.push({ j: j, mo: mo, t: t });
      });
    });
    return setposAnwenden(liste, r);
  }

  // Startzeitpunkte (ms) einer Serie bis bisMs, inkl. DTSTART als erstem
  function serie(ev, vonMs, bisMs) {
    const r = ev.regel;
    const c = ev.c;
    const liste = [ev.startMs];
    if (!r || r.unbekannt) return liste;
    let untilMs = Infinity;
    if (r.until) {
      const u = komponenten(r.until);
      if (u) {
        untilMs = u.utc ? Date.UTC(u.j, u.mo, u.t, u.h, u.mi, u.s)
          : wandZuMs(ev.rahmen, u.j, u.mo, u.t, u.nurDatum ? 23 : u.h, u.nurDatum ? 59 : u.mi, u.nurDatum ? 59 : u.s);
      }
    }
    const grenze = Math.min(bisMs, untilMs);
    let gezaehlt = 1;
    // Ohne COUNT muss nicht ab DTSTART gezählt werden: kurz vor dem Zeitraum
    // einsteigen (Periodenlänge großzügig, damit nichts übersprungen wird).
    // Sonst verschwand ein täglicher Termin seit 1965 (Notbremse) und eine
    // alte Serie kostete bei jedem Abruf spürbar Rechenzeit.
    let k0 = 0;
    if (!r.count && vonMs > ev.startMs) {
      const tage = { DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366 }[r.freq] * r.interval;
      k0 = Math.max(0, Math.floor((vonMs - ev.startMs) / (tage * TAG_MS)) - 2);
    }
    for (let k = k0; k < k0 + MAX_PERIODEN; k++) {
      // Periode beginnt erst hinter der Grenze → fertig (auch wenn die
      // Perioden davor leer waren, z. B. täglich nur im Dezember).
      if (periodenAnfang(r, c, k) > grenze + TAG_MS) break;
      const kand = periode(r, c, k);
      let ende = false;
      for (let i = 0; i < kand.length; i++) {
        const d = kand[i];
        const ms = wandZuMs(ev.rahmen, d.j, d.mo, d.t, c.h, c.mi, c.s);
        if (ms <= ev.startMs) continue;
        if (ms > grenze) { ende = true; break; }
        if (r.count && gezaehlt >= r.count) { ende = true; break; }
        liste.push(ms);
        gezaehlt++;
      }
      if (ende) break;
      if (r.count && gezaehlt >= r.count) break;
    }
    return liste;
  }

  // Erster Tag der Periode k als UTC-Zahl (nur zum Abbrechen)
  function periodenAnfang(r, c, k) {
    if (r.freq === "DAILY") return Date.UTC(c.j, c.mo, c.t + k * r.interval);
    if (r.freq === "WEEKLY") return Date.UTC(c.j, c.mo, c.t + (k * r.interval - 1) * 7);
    if (r.freq === "MONTHLY") return Date.UTC(c.j, c.mo + k * r.interval, 1);
    return Date.UTC(c.j + k * r.interval, 0, 1);
  }

  // Ganztägige Dauer in Tagen bzw. zeitliche Dauer in ms
  function dauerLesen(wert) {
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(wert || "");
    if (!m) return 0;
    return ((Number(m[2] || 0) * 7 + Number(m[3] || 0)) * 24 * 3600 + Number(m[4] || 0) * 3600 + Number(m[5] || 0) * 60 + Number(m[6] || 0)) * 1000;
  }

  function terminLesen(zeilen, zonen) {
    const ev = { exdates: {}, titel: "", ort: "", status: "" };
    let dtend = null;
    let dauer = null;
    zeilen.forEach(function (z) {
      if (z.name === "SUMMARY") ev.titel = textWert(z.wert);
      else if (z.name === "LOCATION") ev.ort = textWert(z.wert);
      else if (z.name === "UID") ev.uid = z.wert;
      else if (z.name === "STATUS") ev.status = z.wert.toUpperCase();
      else if (z.name === "RRULE") ev.regel = regelLesen(z.wert);
      else if (z.name === "DTSTART") {
        const w = wertZuMs(z.params, z.wert, zonen);
        if (w) { ev.startMs = w.ms; ev.c = w.c; ev.rahmen = w.rahmen; ev.ganztags = w.rahmen === "tag"; }
      } else if (z.name === "DTEND") dtend = z;
      else if (z.name === "DURATION") dauer = dauerLesen(z.wert);
      else if (z.name === "RECURRENCE-ID") {
        const w = wertZuMs(z.params, z.wert, zonen);
        if (w) ev.recurrenceId = w.ms;
      } else if (z.name === "EXDATE") {
        z.wert.split(",").forEach(function (v) {
          const w = wertZuMs(z.params, v.trim(), zonen);
          if (w) ev.exdates[w.rahmen === "tag" ? tagSchluessel(w.ms) : w.ms] = true;
        });
      }
    });
    if (ev.startMs == null) return null;
    if (ev.ganztags) {
      let tage = 1;
      if (dtend) {
        const e = komponenten(dtend.wert);
        if (e) tage = Math.max(1, Math.round((Date.UTC(e.j, e.mo, e.t) - Date.UTC(ev.c.j, ev.c.mo, ev.c.t)) / TAG_MS));
      } else if (dauer) tage = Math.max(1, Math.round(dauer / TAG_MS));
      ev.tage = tage;
    } else {
      let ms = 0;
      if (dtend) {
        const w = wertZuMs(dtend.params, dtend.wert, zonen);
        if (w) ms = Math.max(0, w.ms - ev.startMs);
      } else if (dauer) ms = dauer;
      ev.dauerMs = ms;
    }
    return ev;
  }

  function tagSchluessel(ms) {
    const d = new Date(ms);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  function endeVon(ev, startMs) {
    if (!ev.ganztags) return startMs + ev.dauerMs;
    const d = new Date(startMs);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + ev.tage).getTime();
  }

  // Alle Termine, die sich mit [vonMs, bisMs) überschneiden, nach Beginn
  // sortiert: { titel, ort, start, ende (ms), ganztags, wiederkehrend }.
  // Termine ohne Dauer zählen bis zu ihrem Beginn.
  function kalenderTermine(icsText, vonMs, bisMs) {
    const zeilen = entfalten(icsText).split("\n");
    const zonen = {};
    const roh = [];
    let block = null;
    let art = "";
    let tiefe = 0;
    // 1. Durchgang: Zonen und Termin-Blöcke einsammeln
    for (let i = 0; i < zeilen.length; i++) {
      const z = zeileLesen(zeilen[i]);
      if (!z) continue;
      if (z.name === "BEGIN" && !block && (z.wert === "VEVENT" || z.wert === "VTIMEZONE")) { block = []; art = z.wert; tiefe = 0; continue; }
      if (!block) continue;
      if (z.name === "BEGIN") tiefe++;
      if (z.name === "END" && z.wert === art && tiefe === 0) {
        if (art === "VTIMEZONE") {
          const tzid = block.filter(function (x) { return x.name === "TZID"; })[0];
          const zone = zoneLesen(block);
          if (tzid && zone) zonen[tzid.wert] = zone;
        } else roh.push(block);
        block = null;
        continue;
      }
      if (z.name === "END") tiefe--;
      // Erinnerungen (VALARM) gehören nicht zum Termin selbst
      if (art === "VEVENT" && tiefe > 0) continue;
      block.push(z);
    }
    // 2. Durchgang: Termine lesen, Einzeländerungen je UID merken
    const termine = [];
    const aenderungen = {};
    roh.forEach(function (b) {
      const ev = terminLesen(b, zonen);
      if (!ev) return;
      if (ev.recurrenceId != null && ev.uid) {
        (aenderungen[ev.uid] = aenderungen[ev.uid] || {})[ev.recurrenceId] = true;
        if (ev.ganztags) aenderungen[ev.uid]["t" + tagSchluessel(ev.recurrenceId)] = true;
        ev.regel = null; // eine Änderung gilt nur für ihr eigenes Vorkommen
      }
      termine.push(ev);
    });
    const aus = [];
    termine.forEach(function (ev) {
      if (ev.status === "CANCELLED") return;
      const geaendert = ev.recurrenceId == null && ev.uid ? aenderungen[ev.uid] : null;
      const starts = serie(ev, vonMs, bisMs);
      starts.forEach(function (s) {
        if (ev.exdates[s] || (ev.ganztags && ev.exdates[tagSchluessel(s)])) return;
        if (geaendert && (geaendert[s] || (ev.ganztags && geaendert["t" + tagSchluessel(s)]))) return;
        const e = endeVon(ev, s);
        if (s >= bisMs) return;
        if (e > vonMs || (e === s && s >= vonMs)) {
          aus.push({ titel: ev.titel, ort: ev.ort, start: s, ende: e, ganztags: !!ev.ganztags, wiederkehrend: !!(ev.regel && !ev.regel.unbekannt) });
        }
      });
    });
    aus.sort(function (a, b) { return a.start - b.start || (b.ganztags ? 1 : 0) - (a.ganztags ? 1 : 0); });
    return aus;
  }

  window.kalenderTermine = kalenderTermine;
})();
