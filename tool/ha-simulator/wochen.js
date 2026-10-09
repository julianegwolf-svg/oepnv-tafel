'use strict';
/*
 * Mehrwöchiger Verlauf (Standard 4 Wochen, HA_SIM_WOCHEN) für Lichter, Personen, Bewegung/Fenster,
 * Tags und Automationen – mit Werktag/Wochenende-Rhythmus, der zu den Automationen des Haushalts passt.
 * Grundlage für history/history_during_period und logbook/get_events (Lern-Vorschläge der Tafel).
 *
 * Automationen werden nach ihrer Wirkung eingeordnet (keine Namen im Code):
 *   zeit   – Zeit-Auslöser: täglich zur angegebenen Uhrzeit (Wochentags-Bedingung wird beachtet)
 *   gehen  – schaltet nur Lichter aus: werktags ~7:30 ± 10 min
 *   arbeit – schaltet Lichter an (Auslöser z. B. NFC-Tag): werktags ~8:50 ± 10 min, samstags ~10:00 ± 15 min
 *   abend  – Abend-Bedingung (ab 19 Uhr) oder Bewegungs-/Belegungs-Auslöser: täglich ~22:30 ± 20 min
 * Ohne passende Automation passiert dasselbe „von Hand“ (Kontext mit user_id).
 */
const { iso, ulid, zufall, hexId } = require('./werkzeuge');
const { zeitInStunden } = require('./modelle');

const RAUM_MUSTER = {
  schlaf: /schlaf|bed/i, wohn: /wohn|living/i, buero: /b(ü|u|ue)ro|office|arbeit/i,
  kueche: /k(ü|u|ue)che|kitchen/i, bad: /bad|bath/i, flur: /flur|diele|hall/i
};
const FARB_REIHENFOLGE = ['color_temp_kelvin', 'xy_color', 'hs_color', 'rgb_color', 'color_name'];
const tagFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', weekday: 'short' });

function liste(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

// Lokale Mitternacht (Europe/Berlin) und Wochentag (0 = So) für einen Zeitpunkt
function berlinTag(sek) {
  const t = {};
  for (const p of tagFormat.formatToParts(new Date(sek * 1000))) t[p.type] = p.value;
  const lokalAlsUtc = Date.UTC(+t.year, +t.month - 1, +t.day, +t.hour, +t.minute, +t.second) / 1000;
  const versatz = lokalAlsUtc - Math.floor(sek);
  const mitternacht = Date.UTC(+t.year, +t.month - 1, +t.day) / 1000 - versatz;
  return { mitternacht: mitternacht, wochentag: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(t.weekday) };
}

function rolleVon(cfg) {
  const trig = liste(cfg.triggers);
  const akt = liste(cfg.actions);
  const bed = liste(cfg.conditions);
  if (trig.some(t => (t.trigger || t.platform) === 'time')) return 'zeit';
  const licht = akt.filter(a => /^light\./.test(a.action || a.service || ''));
  const abends = bed.some(b => b.condition === 'time' && zeitInStunden(b.after) !== null && zeitInStunden(b.after) >= 19) ||
    trig.some(t => /occupancy|motion|presence/.test(String(t.trigger || t.platform || '')));
  if (abends) return 'abend';
  if (licht.length && licht.every(a => /turn_off$/.test(a.action || a.service))) return 'gehen';
  if (licht.some(a => /turn_on$/.test(a.action || a.service))) return 'arbeit';
  return null;
}

function quelleVon(cfg) {
  const t = liste(cfg.triggers)[0];
  if (!t) return 'action automation.trigger';
  const art = t.trigger || t.platform;
  if (art === 'state') return 'state of ' + liste(t.entity_id)[0];
  if (art === 'time') return 'time';
  return String(art);
}

/*
 * Erzeugt den Verlauf und legt ihn in welt.historie bzw. sim.ausloeseLog/kontextInfo ab.
 * Muss VOR dem Schreiben der Startzustände laufen (die Startzustände folgen zeitlich danach).
 */
function erzeugeWochen(sim, wochen, jetztSek) {
  const welt = sim.welt;
  const ende = jetztSek - 120;
  const beginn = jetztSek - wochen * 7 * 86400;
  welt.aufbewahrungSek = Math.max(welt.aufbewahrungSek, wochen * 7 * 86400 + 2 * 86400);
  const verlauf = new Map();          // entity_id → [{s, a, lu, lc, nurAttr, c}]
  const benutzer = hexId('benutzer-julian');

  // Räume nach Namen finden
  const raeume = {};
  for (const k of Object.keys(RAUM_MUSTER)) {
    const b = welt.bereiche.find(x => RAUM_MUSTER[k].test(x.name));
    raeume[k] = b ? b.area_id : null;
  }
  const lampenIn = raum => raum ? welt.loeseZielAuf({ area_id: raum }, ['light'], true).ids : [];
  // Entitäten über die Haushalt-Beschreibung finden (Zustände existieren beim Erzeugen noch nicht)
  const startAttr = id => {
    const s = welt.zustand(id);
    if (s) return s.attributes;
    const e = sim.h.ENTITAETEN.find(x => x.entity_id === id);
    return e && e.start ? e.start.attributes : {};
  };
  const binaereMit = (klassen, raumMuster) => sim.h.ENTITAETEN.filter(e => e.entity_id.indexOf('binary_sensor.') === 0 && !e.deaktiviert &&
    klassen.indexOf(startAttr(e.entity_id).device_class) !== -1 &&
    (!raumMuster || raumMuster.test((welt.bereiche.find(b => b.area_id === welt.bereichVon(e.entity_id)) || {}).name || ''))).map(e => e.entity_id);

  // Zeitleisten-Zustand der Lampen (Kopien der Modelle)
  const lampen = new Map();
  for (const [id, l] of sim.lampen) lampen.set(id, Object.assign({}, l, { an: false, dynamisch: false, effekt: null }));
  const zustandVon = new Map();       // letzter Zustand je Entität (für Gruppen/Personen)

  function punkt(id, s, attrs, t, ctx, nurAttr) {
    let l = verlauf.get(id);
    if (!l) { l = []; verlauf.set(id, l); }
    const letzter = l[l.length - 1];
    if (letzter && !nurAttr && letzter.s === s) return;
    if (letzter && t <= letzter.lu) t = letzter.lu + 0.001;
    l.push({ s: s, a: welt.ordneAttribute(id, attrs), lu: t, lc: nurAttr && letzter ? letzter.lc : t, nurAttr: !!nurAttr, c: ctx });
    zustandVon.set(id, s);
  }

  function kontext(t, userId) {
    return { id: ulid(t * 1000), parent_id: null, user_id: userId || null };
  }

  // Lichter schalten (Gruppen werden zu Mitgliedern aufgelöst, danach Gruppen neu berechnet)
  function licht(t, ids, an, daten, ctx) {
    const betroffen = new Set();
    for (const id of ids) {
      const g = sim.gruppen.get(id);
      for (const m of (g ? g.mitglieder : [id])) if (lampen.has(m)) betroffen.add(m);
    }
    let n = 0;
    const d = daten || {};
    for (const id of betroffen) {
      const l = lampen.get(id);
      if (!l.verfuegbar) continue;
      l.an = an;
      if (an) {
        if (d.brightness !== undefined) l.bri = Math.max(1, Math.min(255, Math.round(d.brightness)));
        else if (d.brightness_pct !== undefined) l.bri = Math.max(1, Math.round(d.brightness_pct * 2.55));
        const farbe = FARB_REIHENFOLGE.find(k => d[k] !== undefined);
        if (!l.nurHelligkeit && farbe === 'color_temp_kelvin') { l.modus = 'color_temp'; l.kelvin = Math.max(l.minK, Math.min(l.maxK, d.color_temp_kelvin)); }
        else if (!l.nurHelligkeit && farbe === 'rgb_color' && l.farbmodus) {
          const f = require('./farben');
          if (l.farbmodus === 'xy') { l.modus = 'xy'; l.xy = f.rgbZuXy(d.rgb_color); } else { l.modus = 'hs'; l.hs = f.rgbZuHs(d.rgb_color); }
        }
        if (l.nurHelligkeit) l.modus = 'brightness';
      }
      punkt(id, an ? 'on' : 'off', sim.lichtAttribute(l), t + (n++) * 0.03, ctx);
    }
    for (const [gid, g] of sim.gruppen) {
      if (!g.mitglieder.some(m => betroffen.has(m))) continue;
      const w = sim.gruppenWerte(gid, m => lampen.get(m));
      punkt(gid, w.state, w.a, t + n * 0.03 + 0.01, ctx);
    }
  }

  // Raum-Lichter von Hand (Kontext mit Benutzer, wie ein Tipp in der App)
  function hand(t, raum, an, daten) {
    if (t > ende || t < beginn) return;
    const ids = lampenIn(raeume[raum]);
    if (!ids.length) return;
    const ctx = kontext(t, benutzer);
    sim.merkeKontext(ctx.id, { context_event_type: 'call_service', context_domain: 'light', context_service: an ? 'turn_on' : 'turn_off' });
    licht(t, ids, an, daten, ctx);
  }

  function binaer(t, id, an) {
    if (t > ende || t < beginn) return;
    punkt(id, an ? 'on' : 'off', startAttr(id), t, kontext(t));
  }

  // Personen (+ Tracker + zone.home)
  const personen = sim.h.ENTITAETEN.filter(e => e.art === 'person');
  function person(t, e, zustand) {
    if (t > ende || t < beginn) return;
    const ctx = kontext(t);
    const tracker = e.modell && e.modell.tracker;
    const ort = sim.ortFuer(zustand, e.entity_id);
    if (tracker && sim.ids.has(tracker)) {
      punkt(tracker, zustand, { source_type: 'gps', battery_level: 60, latitude: ort.lat, longitude: ort.lon, gps_accuracy: ort.gps, altitude: 12, course: -1, speed: 0, vertical_accuracy: 5 }, t, ctx);
    }
    punkt(e.entity_id, zustand, {
      editable: true, id: e.unique_id, device_trackers: tracker ? [tracker] : [], latitude: ort.lat, longitude: ort.lon,
      gps_accuracy: ort.gps, source: tracker || null, user_id: hexId('benutzer-' + e.entity_id)
    }, t + 0.01, ctx);
    if (sim.ids.has('zone.home')) {
      const daheim = personen.filter(p => (zustandVon.get(p.entity_id) || 'home') === 'home').map(p => p.entity_id);
      punkt('zone.home', String(daheim.length), { latitude: 53.073, longitude: 8.887, radius: 100, passive: false, persons: daheim, editable: true, icon: 'mdi:home', friendly_name: 'Zuhause' }, t + 0.02, ctx);
    }
  }

  // Automationen nach Rolle
  const automationen = [];
  for (const [id, a] of sim.automationen) {
    if (!a.cfg || (sim.h.BEWEGUNGSLICHT && sim.h.BEWEGUNGSLICHT.automation === id)) continue;
    automationen.push({ id: id, cfg: a.cfg, rolle: rolleVon(a.cfg), quelle: quelleVon(a.cfg), name: sim.lampenName(id), letzte: null });
  }
  const BEWEGUNG = ['occupancy', 'motion', 'presence'];
  const belegungsMelder = binaereMit(BEWEGUNG, RAUM_MUSTER.schlaf)[0] || binaereMit(BEWEGUNG)[0] || null;

  function automationLaufen(t, au) {
    if (t > ende || t < beginn) return;
    const tr = liste(au.cfg.triggers)[0] || {};
    const art = tr.trigger || tr.platform;
    // Auslöser sichtbar machen: Tag gescannt / Belegung erkannt
    if (art === 'state') {
      const ausloeser = liste(tr.entity_id)[0];
      if (ausloeser && ausloeser.indexOf('tag.') === 0 && sim.ids.has(ausloeser)) punkt(ausloeser, iso(t - 0.3), startAttr(ausloeser), t - 0.3, kontext(t - 0.3));
    } else if (/occupancy|motion|presence/.test(String(art)) && belegungsMelder) {
      binaer(t - 0.5, belegungsMelder, true);
      binaer(t + zufall(60, 150), belegungsMelder, false);
    }
    const ctx = kontext(t);
    au.letzte = t;
    sim.merkeAusloesung(au.id, t, au.quelle, ctx);
    punkt(au.id, 'on', { id: au.cfg.id, last_triggered: iso(t), mode: au.cfg.mode || 'single', current: 0 }, t, ctx, true);
    // Aktionen: Licht an/aus mit Zielen; Bedingungen (Template) stoppen den Ablauf wie in echt
    let tAkt = t + 0.1;
    for (const a of liste(au.cfg.actions)) {
      if (!a || typeof a !== 'object') continue;
      if (a.condition) break;
      if (a.delay !== undefined) {
        tAkt += require('./modelle').dauerInSekunden(a.delay);
        continue;
      }
      const name = a.action || a.service || '';
      const m = /^light\.(turn_on|turn_off)$/.exec(name);
      if (!m || tAkt > ende) continue;
      const ziel = Object.assign({}, a.target || {}, a.entity_id ? { entity_id: a.entity_id } : {});
      licht(tAkt, welt.loeseZielAuf(ziel, ['light'], true).ids, m[1] === 'turn_on', a.data || {}, ctx);
      tAkt += 0.2;
    }
  }

  function rolle(t, name, ersatz) {
    const passende = automationen.filter(a => a.rolle === name);
    if (passende.length) passende.forEach(a => automationLaufen(t, a));
    else if (ersatz) ersatz();
  }

  // Ausgangslage am Beginn: alles aus, alle daheim, Automationen an
  for (const id of lampen.keys()) {
    const l = lampen.get(id);
    punkt(id, l.verfuegbar ? 'off' : 'unavailable', sim.lichtAttribute(l), beginn - 60, kontext(beginn - 60));
  }
  for (const gid of sim.gruppen.keys()) {
    const w = sim.gruppenWerte(gid, m => lampen.get(m));
    punkt(gid, w.state, w.a, beginn - 59, kontext(beginn - 59));
  }
  personen.forEach(e => person(beginn - 58 + 60, e, 'home'));
  automationen.forEach(au => punkt(au.id, 'on', { id: au.cfg.id, last_triggered: null, mode: au.cfg.mode || 'single', current: 0 }, beginn - 57, kontext(beginn - 57)));

  const r = minuten => zufall(-minuten, minuten) / 60;
  const haupt = personen[0] || null;
  const weitere = personen.slice(1);
  const melder = binaereMit(BEWEGUNG).filter(id => id !== belegungsMelder);
  const fenster = binaereMit(['window']);
  const bl = sim.h.BEWEGUNGSLICHT;

  // Tage durchgehen (Ereignisse eines Tages chronologisch abarbeiten)
  for (let tag = berlinTag(beginn).mitternacht; tag <= ende; tag += 86400) {
    const info = berlinTag(tag + 7200);
    const m = info.mitternacht;
    const wt = info.wochentag;
    const z = h => m + h * 3600;
    const plan = [];
    const p = (t, fn) => plan.push([t, fn]);
    const werktag = wt >= 1 && wt <= 5;
    let weg = [];   // Zeitfenster, in denen die Hauptperson unterwegs ist

    if (werktag) {
      p(z(6.67 + r(10)), t => hand(t, 'schlaf', true, { brightness: 90, color_temp_kelvin: 2700 }));
      p(z(6.9 + r(5)), t => hand(t, 'kueche', true, { brightness: 230, color_temp_kelvin: 4000 }));
      p(z(6.95 + r(5)), t => hand(t, 'bad', true, { brightness: 254, color_temp_kelvin: 4000 }));
      p(z(7.2 + r(4)), t => hand(t, 'bad', false));
      const tGehen = z(7.5 + r(10));
      p(tGehen, t => rolle(t, 'gehen', () => ['schlaf', 'wohn', 'buero'].forEach(k => hand(t, k, false))));
      p(tGehen + 20, t => { hand(t, 'kueche', false); hand(t, 'flur', false); });
      const tZurueck = z(8.5 + r(10));
      weg.push([tGehen + 60, tZurueck]);
      p(z(8.83 + r(10)), t => rolle(t, 'arbeit', () => hand(t, 'buero', true, { brightness: 255, color_temp_kelvin: 5000 })));
      p(z(17.5 + r(20)), t => hand(t, 'buero', false));
      p(z(18.4 + r(20)), t => hand(t, 'wohn', true, { brightness: 180, color_temp_kelvin: 2700 }));
      p(z(19.0 + r(15)), t => hand(t, 'kueche', true, { brightness: 230, color_temp_kelvin: 3000 }));
      p(z(19.6 + r(15)), t => hand(t, 'kueche', false));
      if (wt === 2 || wt === 4) {
        const tSport = z(18.75 + r(10));
        const tSportZurueck = z(20.5 + r(15));
        p(tSport - 30, t => hand(t, 'wohn', false));
        weg.push([tSport, tSportZurueck]);
        p(tSportZurueck + 120, t => hand(t, 'wohn', true, { brightness: 160, color_temp_kelvin: 2500 }));
      }
    } else if (wt === 6) {
      p(z(8.5 + r(30)), t => hand(t, 'schlaf', true, { brightness: 120, color_temp_kelvin: 2700 }));
      p(z(9.1 + r(15)), t => hand(t, 'schlaf', false));
      p(z(9.1 + r(15)), t => hand(t, 'kueche', true, { brightness: 230, color_temp_kelvin: 3500 }));
      p(z(9.7 + r(10)), t => hand(t, 'kueche', false));
      p(z(10 + r(15)), t => rolle(t, 'arbeit', () => hand(t, 'buero', true, { brightness: 255, color_temp_kelvin: 5000 })));
      p(z(13.5 + r(20)), t => hand(t, 'buero', false));
      weg.push([z(14 + r(20)), z(18 + r(30))]);
      p(z(18.4 + r(20)), t => hand(t, 'wohn', true, { brightness: 170, color_temp_kelvin: 2700 }));
    } else {
      p(z(9 + r(30)), t => hand(t, 'schlaf', true, { brightness: 100, color_temp_kelvin: 2700 }));
      p(z(9.6 + r(15)), t => { hand(t, 'schlaf', false); hand(t, 'wohn', true, { brightness: 140, color_temp_kelvin: 3000 }); });
      const tWeg = z(11 + r(20));
      p(tWeg - 60, t => hand(t, 'wohn', false));
      weg.push([tWeg, z(15.5 + r(30))]);
      p(z(17.9 + r(20)), t => hand(t, 'wohn', true, { brightness: 170, color_temp_kelvin: 2700 }));
    }
    // jeden Abend
    p(z(22.5 + r(20)), t => rolle(t, 'abend', () => { hand(t, 'schlaf', true, { brightness: 128, color_temp_kelvin: 2471 }); hand(t, 'wohn', false); hand(t, 'buero', false); }));
    p(z(23.2 + r(15)), t => { hand(t, 'schlaf', false); hand(t, 'wohn', false); });
    // Zeit-Automationen
    for (const au of automationen.filter(a => a.rolle === 'zeit')) {
      const zeitBed = liste(au.cfg.conditions).find(b => b.condition === 'time' && b.weekday);
      if (zeitBed && liste(zeitBed.weekday).indexOf(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][wt]) === -1) continue;
      for (const tr of liste(au.cfg.triggers)) {
        if ((tr.trigger || tr.platform) !== 'time') continue;
        for (const at of liste(tr.at)) {
          const h = zeitInStunden(at);
          if (h !== null) p(z(h), t => automationLaufen(t, au));
        }
      }
    }
    // Hauptperson unterwegs/daheim
    if (haupt) {
      for (const w of weg) {
        p(w[0], t => person(t, haupt, 'not_home'));
        p(w[1], t => person(t, haupt, 'home'));
      }
    }
    // weitere Personen: werktags im Büro, samstags unterwegs
    weitere.forEach(e => {
      if (werktag) { p(z(8 + r(15)), t => person(t, e, 'not_home')); p(z(17.3 + r(30)), t => person(t, e, 'home')); }
      else if (wt === 6) { p(z(11 + r(30)), t => person(t, e, 'not_home')); p(z(16 + r(30)), t => person(t, e, 'home')); }
    });
    // Bewegung, solange jemand daheim ist (tagsüber/abends)
    const daheim = t => !weg.some(w => t >= w[0] && t <= w[1]);
    for (const id of melder) {
      const n = bl && bl.sensor === id ? 8 : 5;
      for (let i = 0; i < n; i++) {
        const t0 = z(zufall(7, 23));
        if (!daheim(t0)) continue;
        const dauer = zufall(30, 120);
        p(t0, t => {
          binaer(t, id, true);
          if (bl && bl.sensor === id && sim.automationen.get(bl.automation)) {
            const ctx = kontext(t + 0.2);
            const au = { id: bl.automation, cfg: { id: sim.automationen.get(bl.automation).eintragId, mode: 'restart' } };
            sim.merkeAusloesung(au.id, t + 0.2, 'state of ' + id, ctx);
            punkt(au.id, 'on', { id: au.cfg.id, last_triggered: iso(t + 0.2), mode: 'restart', current: 0 }, t + 0.2, ctx, true);
            licht(t + 0.3, bl.lampen, true, { brightness: 200, color_temp_kelvin: 3000 }, ctx);
            licht(t + dauer + bl.ausNachSekunden, bl.lampen, false, {}, ctx);
          }
        });
        p(t0 + dauer, t => binaer(t, id, false));
      }
    }
    // Lüften: Schlafzimmer morgens, Bad nach dem Duschen, Küche abends
    for (const id of fenster) {
      const raumName = (welt.bereiche.find(b => b.area_id === welt.bereichVon(id)) || {}).name || '';
      let von = null;
      let bis = null;
      if (RAUM_MUSTER.schlaf.test(raumName)) { von = werktag ? z(7.0 + r(5)) : z(9.5 + r(15)); bis = von + zufall(600, 1200); }
      else if (RAUM_MUSTER.bad.test(raumName)) { von = werktag ? z(7.25 + r(5)) : z(10 + r(30)); bis = von + zufall(900, 1800); }
      else if (RAUM_MUSTER.kueche.test(raumName) && Math.random() < 0.5) { von = z(19.5 + r(15)); bis = von + zufall(300, 900); }
      if (von !== null) { p(von, t => binaer(t, id, true)); p(bis, t => binaer(t, id, false)); }
    }

    plan.sort((a, b) => a[0] - b[0]);
    for (const [t, fn] of plan) if (t <= ende && t >= beginn) fn(t);
  }

  // In die Welt übernehmen (vor die Startzustände)
  let punkte = 0;
  for (const [id, l] of verlauf) {
    welt.historieVorbelegen(id, l);
    punkte += l.length;
  }
  // Logbuch der Auslösungen chronologisch halten
  sim.ausloeseLog.sort((a, b) => a.when - b.when);
  return { entitaeten: verlauf.size, punkte: punkte, ausloesungen: sim.ausloeseLog.length };
}

module.exports = { erzeugeWochen, rolleVon, berlinTag };
