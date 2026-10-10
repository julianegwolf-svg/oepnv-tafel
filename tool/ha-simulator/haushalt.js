'use strict';
/*
 * Der FIKTIVE Haushalt (Wohnung in Bremen) für den HA-Simulator – plus gemeinsame Bausteine.
 *
 * Hier steht alles, was den Haushalt ausmacht: Räume (Areas), Geräte, Entitäten mit
 * Anfangszuständen, Hue-Szenen, Playlists, Radiosender, Skripte, Automationen und die
 * Test-Szenarien. Zum Anpassen einfach Einträge ergänzen oder ändern.
 *
 * Wie in echtem Home Assistant gehören Entitäten über ihr GERÄT zu einem Raum
 * (Entität.area_id ist meist null). Ein paar Entitäten haben absichtlich eine eigene
 * area_id, die vom Gerät abweicht – die Entität hat dann Vorrang.
 *
 * Liegt eine private haushalt.json im Ordner, baut haushalt-echt.js daraus den echten
 * Haushalt (nur zur Laufzeit – nichts davon steht in eingecheckten Dateien). Dann dient
 * diese Datei nur noch als Quelle für die Extras (--extras) und für gemeinsame Teile.
 */

// ───────────────────────────── Räume (Areas) ─────────────────────────────
// temperatur/feuchte: wie in HA ≥2024.11 (Area-Felder temperature_entity_id/humidity_entity_id)
const BEREICHE = [
  { id: 'wohnzimmer', name: 'Wohnzimmer', icon: 'mdi:sofa', temperatur: 'sensor.wohnzimmer_temperatur', feuchte: 'sensor.wohnzimmer_luftfeuchtigkeit' },
  { id: 'schlafzimmer', name: 'Schlafzimmer', icon: 'mdi:bed-king', temperatur: 'sensor.schlafzimmer_temperatur', feuchte: 'sensor.schlafzimmer_luftfeuchtigkeit' },
  { id: 'kueche', name: 'Küche', icon: 'mdi:countertop', temperatur: 'sensor.kueche_temperatur', feuchte: 'sensor.kueche_luftfeuchtigkeit' },
  { id: 'bad', name: 'Bad', icon: 'mdi:shower', temperatur: 'sensor.bad_temperatur', feuchte: 'sensor.bad_luftfeuchtigkeit' },
  { id: 'flur', name: 'Flur', icon: 'mdi:door-open', temperatur: 'sensor.flur_temperatur', feuchte: null },
  { id: 'buero', name: 'Büro', icon: 'mdi:desk', temperatur: 'sensor.buero_temperatur', feuchte: 'sensor.buero_luftfeuchtigkeit' }
];

// ───────────────────────────── Gerätetypen ─────────────────────────────
const SIGNIFY = 'Signify Netherlands B.V.';
const TYPEN = {
  hue_bridge: { hersteller: SIGNIFY, modell: 'Hue Bridge', model_id: 'BSB002', sw: '1.72.1972015010', plattform: 'hue' },
  hue_raum: { hersteller: SIGNIFY, modell: 'Room', model_id: null, sw: null, plattform: 'hue', via: 'hue_bridge' },
  hue_wa: { hersteller: SIGNIFY, modell: 'Hue white ambiance', model_id: 'LTA009', sw: '1.122.2', plattform: 'hue', via: 'hue_bridge' },
  hue_spot: { hersteller: SIGNIFY, modell: 'Hue white ambiance spot', model_id: 'LTG002', sw: '1.122.2', plattform: 'hue', via: 'hue_bridge' },
  hue_color: { hersteller: SIGNIFY, modell: 'Hue color lamp', model_id: 'LCA006', sw: '1.122.2', plattform: 'hue', via: 'hue_bridge' },
  hue_strip: { hersteller: SIGNIFY, modell: 'Hue lightstrip plus', model_id: 'LCL001', sw: '1.122.2', plattform: 'hue', via: 'hue_bridge' },
  hue_motion: { hersteller: SIGNIFY, modell: 'Hue motion sensor', model_id: 'SML001', sw: '2.53.6', plattform: 'hue', via: 'hue_bridge' },
  ikea_globus: { hersteller: 'IKEA of Sweden', modell: 'KAJPLATS E27 CWS globe 1055lm', model_id: null, sw: '1.0.32', plattform: 'matter' },
  ikea_bewegung: { hersteller: 'IKEA of Sweden', modell: 'MYGGSPRAY wrlss mtn sensor', model_id: null, sw: '1.0.11', plattform: 'matter' },
  aqara_klima: { hersteller: 'LUMI', modell: 'Aqara temperature and humidity sensor', model_id: 'lumi.weather', sw: null, plattform: 'zha', zigbee: true },
  aqara_fenster: { hersteller: 'LUMI', modell: 'Aqara door & window sensor', model_id: 'lumi.sensor_magnet.aq2', sw: null, plattform: 'zha', zigbee: true },
  fritz_thermostat: { hersteller: 'AVM', modell: 'FRITZ!DECT 301', model_id: 'FRITZ!DECT 301', sw: '05.10', plattform: 'fritzbox' },
  fritz_steckdose: { hersteller: 'AVM', modell: 'FRITZ!DECT 200', model_id: 'FRITZ!DECT 200', sw: '04.27', plattform: 'fritzbox' },
  sonos_arc: { hersteller: 'Sonos', modell: 'Arc', model_id: 'S19', sw: '84.1-66270', plattform: 'sonos' },
  homepod_mini: { hersteller: 'Apple', modell: 'HomePod mini', model_id: 'AudioAccessory5,1', sw: '26.0', plattform: 'apple_tv' },
  apple_tv: { hersteller: 'Apple', modell: 'Apple TV 4K (3rd generation)', model_id: 'AppleTV14,1', sw: '26.0', plattform: 'apple_tv' },
  roborock: { hersteller: 'Roborock', modell: 'Roborock S7 MaxV', model_id: 'roborock.vacuum.a27', sw: '02.29.02', plattform: 'roborock' },
  waschmaschine: { hersteller: 'Bosch', modell: 'Serie 8 Waschmaschine', model_id: 'WGG254Z0', sw: null, plattform: 'home_connect' },
  stromzaehler: { hersteller: 'Tibber', modell: 'Pulse IR', model_id: null, sw: '1.1.0', plattform: 'tibber' },
  iphone: { hersteller: 'Apple', modell: 'iPhone 15 Pro', model_id: 'iPhone16,1', sw: '26.0', plattform: 'mobile_app' },
  ha_core: { hersteller: 'Home Assistant', modell: 'Home Assistant Core', model_id: null, sw: '2026.10.0', plattform: 'hassio', entry_type: 'service' },
  met: { hersteller: 'Met.no', modell: 'Forecast', model_id: null, sw: null, plattform: 'met', entry_type: 'service' }
};

// ───────────────────────────── Geräte ─────────────────────────────
// schluessel: [Name, Raum (area_id oder null), Typ]
const GERAETE = {
  hue_bridge: ['Hue Bridge', 'wohnzimmer', 'hue_bridge'],
  // Hue-Räume sind in HA eigene Geräte (Modell „Room“); Gruppen-Licht und Szenen hängen daran.
  raum_wohnzimmer: ['Wohnzimmer', 'wohnzimmer', 'hue_raum'],
  raum_schlafzimmer: ['Schlafzimmer', 'schlafzimmer', 'hue_raum'],
  raum_kueche: ['Küche', 'kueche', 'hue_raum'],
  raum_bad: ['Bad', 'bad', 'hue_raum'],
  raum_flur: ['Flur', null, 'hue_raum'], // absichtlich ohne Area: Raum nur über group_name erkennbar
  raum_buero: ['Büro', 'buero', 'hue_raum'],

  wz_decke: ['Wohnzimmer Decke', 'wohnzimmer', 'hue_wa'],
  wz_stehlampe: ['Wohnzimmer Stehlampe', 'wohnzimmer', 'hue_color'],
  wz_lightstrip: ['Wohnzimmer Lightstrip TV', 'wohnzimmer', 'hue_strip'],
  wz_globus: ['Wohnzimmer Globusleuchte', 'wohnzimmer', 'ikea_globus'],
  sz_decke: ['Schlafzimmer Decke', 'schlafzimmer', 'hue_wa'],
  sz_nachttisch_links: ['Schlafzimmer Nachttisch links', 'schlafzimmer', 'hue_color'],
  sz_nachttisch_rechts: ['Schlafzimmer Nachttisch rechts', 'schlafzimmer', 'hue_wa'],
  ku_decke: ['Küche Decke', 'kueche', 'hue_wa'],
  ku_arbeitsplatte: ['Küche Arbeitsplatte', 'kueche', 'hue_strip'],
  bad_spiegel: ['Bad Spiegel', 'bad', 'hue_wa'],
  bad_decke: ['Bad Decke', 'bad', 'hue_wa'],
  flur_decke: ['Flur Decke', 'flur', 'hue_wa'],
  flur_spots: ['Flur Spots', 'flur', 'hue_spot'],
  bu_schreibtisch: ['Büro Schreibtisch', 'buero', 'hue_color'],
  bu_decke: ['Büro Decke', 'buero', 'hue_wa'],
  bu_leselampe: ['Büro Leselampe', 'wohnzimmer', 'hue_wa'], // Gerät noch im Wohnzimmer, Entität im Büro

  wz_klima: ['Wohnzimmer Klimasensor', 'wohnzimmer', 'aqara_klima'],
  sz_klima: ['Schlafzimmer Klimasensor', 'schlafzimmer', 'aqara_klima'],
  ku_klima: ['Küche Klimasensor', 'kueche', 'aqara_klima'],
  bad_klima: ['Bad Klimasensor', 'bad', 'aqara_klima'],
  bu_klima: ['Büro Klimasensor', 'buero', 'aqara_klima'],

  wz_heizung: ['Wohnzimmer Heizung', 'wohnzimmer', 'fritz_thermostat'],
  sz_heizung: ['Schlafzimmer Heizung', 'schlafzimmer', 'fritz_thermostat'],
  bad_heizung: ['Bad Heizung', 'bad', 'fritz_thermostat'],
  bu_heizung: ['Büro Heizung', 'buero', 'fritz_thermostat'],

  wz_fenster: ['Wohnzimmer Fenster', 'wohnzimmer', 'aqara_fenster'],
  sz_dachfenster: ['Schlafzimmer Dachfenster', 'schlafzimmer', 'aqara_fenster'],
  ku_fenster: ['Küche Fenster', 'kueche', 'aqara_fenster'],
  bad_fenster: ['Bad Fenster', 'bad', 'aqara_fenster'],
  bu_fenster: ['Büro Fenster', 'buero', 'aqara_fenster'],
  wohnungstuer: ['Wohnungstür', 'flur', 'aqara_fenster'],

  flur_bewegungsmelder: ['Flur Bewegungsmelder', 'flur', 'hue_motion'],
  wz_bewegungsmelder: ['Wohnzimmer Bewegungsmelder', 'wohnzimmer', 'hue_motion'],
  sz_bett: ['Bewegungsmelder Bett', 'schlafzimmer', 'ikea_bewegung'],

  sonos: ['Wohnzimmer Sonos', 'wohnzimmer', 'sonos_arc'],
  homepod_kueche: ['Küche HomePod', 'kueche', 'homepod_mini'],
  homepod_schlafzimmer: ['Schlafzimmer HomePod', 'schlafzimmer', 'homepod_mini'],
  apple_tv: ['Wohnzimmer Fernseher', 'wohnzimmer', 'apple_tv'],

  kaffeemaschine: ['Kaffeemaschine', 'kueche', 'fritz_steckdose'],
  schreibtisch: ['Schreibtisch', 'wohnzimmer', 'fritz_steckdose'], // Gerät im Wohnzimmer, Entitäten im Büro
  fernseher_steckdose: ['Fernseher Steckdose', 'wohnzimmer', 'fritz_steckdose'],
  kuehlschrank: ['Kühlschrank', 'kueche', 'fritz_steckdose'],

  saugi: ['Saugi', 'flur', 'roborock'],
  waschmaschine: ['Waschmaschine', 'bad', 'waschmaschine'],
  stromzaehler: ['Stromzähler', null, 'stromzaehler'],
  iphone_julian: ['iPhone Julian', null, 'iphone'],
  iphone_alex: ['iPhone Alex', null, 'iphone'],
  ha_core: ['Home Assistant Core', null, 'ha_core'],
  met: ['Forecast', null, 'met']
};

// ───────────────────────────── Sensorarten ─────────────────────────────
const SENSORARTEN = {
  temperatur: { device_class: 'temperature', unit: '°C', state_class: 'measurement', stellen: 1 },
  feuchte: { device_class: 'humidity', unit: '%', state_class: 'measurement', stellen: 1 },
  batterie: { device_class: 'battery', unit: '%', state_class: 'measurement', stellen: 0, kategorie: 'diagnostic' },
  leistung: { device_class: 'power', unit: 'W', state_class: 'measurement', stellen: 1 },
  energie: { device_class: 'energy', unit: 'kWh', state_class: 'total_increasing', stellen: 3 },
  helligkeit: { device_class: 'illuminance', unit: 'lx', state_class: 'measurement', stellen: 0 },
  signal: { device_class: 'signal_strength', unit: 'dBm', state_class: 'measurement', stellen: 0, kategorie: 'diagnostic' },
  spannung: { device_class: 'voltage', unit: 'V', state_class: 'measurement', stellen: 1 }
};

// ───────────────────────────── Bausteine für Entitäten ─────────────────────────────
// Jede Entität: entity_id, geraet (Schlüssel oder null), name (original_name), art (Modell-Art),
// optional kategorie, versteckt, deaktiviert, bereich (eigene area_id), icon, start {state, attributes}.

function lampe(id, geraet, opt) {
  return { entity_id: id, geraet: geraet, name: null, art: 'lampe', modell: opt, bereich: opt.bereich || null };
}

function hueGruppe(id, geraet, raum) {
  return { entity_id: id, geraet: geraet, name: null, art: 'gruppe', modell: { raum: raum } };
}

function sensor(id, geraet, name, art, wert, opt) {
  opt = opt || {};
  const a = SENSORARTEN[art];
  return {
    entity_id: id, geraet: geraet, name: name, art: opt.modell ? 'raumsensor' : 'sensor',
    sensorart: art, modell: opt.modell || null, kategorie: opt.kategorie !== undefined ? opt.kategorie : (a.kategorie || null),
    bereich: opt.bereich || null, deaktiviert: !!opt.deaktiviert, versteckt: !!opt.versteckt,
    optionen: a.stellen !== undefined && (art === 'temperatur' || art === 'feuchte') ? { sensor: { suggested_display_precision: a.stellen } } : {},
    start: { state: typeof wert === 'number' ? wert.toFixed(a.stellen) : String(wert), attributes: { state_class: a.state_class, unit_of_measurement: a.unit, device_class: a.device_class } },
    profil: opt.profil || null
  };
}

function binaer(id, geraet, name, deviceClass, an, opt) {
  opt = opt || {};
  return {
    entity_id: id, geraet: geraet, name: name, art: 'binaer', kategorie: opt.kategorie || null,
    modell: opt.modell || null, bereich: opt.bereich || null,
    start: { state: an ? 'on' : 'off', attributes: { device_class: deviceClass } }
  };
}

function statisch(id, geraet, name, state, attributes, opt) {
  opt = opt || {};
  return Object.assign({ entity_id: id, geraet: geraet, name: name, art: 'statisch', start: { state: state, attributes: attributes || {} } }, opt);
}

// Steckdose = Schalter + Leistung + Energie (wie FRITZ!DECT 200)
function steckdose(objektId, geraet, opt) {
  const liste = [
    { entity_id: 'switch.' + objektId, geraet: geraet, name: null, art: 'steckdose', versteckt: !!opt.versteckt, bereich: opt.bereich || null, modell: opt },
    sensor('sensor.' + objektId + '_leistung', geraet, 'Leistung', 'leistung', 0, { bereich: opt.bereich }),
    sensor('sensor.' + objektId + '_energie', geraet, 'Energie', 'energie', opt.energie, { bereich: opt.bereich })
  ];
  if (opt.temperatur) liste.push(sensor('sensor.' + objektId + '_temperatur', geraet, 'Temperatur', 'temperatur', opt.temperatur));
  if (opt.spannung) liste.push(sensor('sensor.' + objektId + '_spannung', geraet, 'Spannung', 'spannung', 231.4, { deaktiviert: true }));
  return liste;
}

// ───────────────────────────── Hue-Szenen ─────────────────────────────
// bri = Helligkeit 0–255, kelvin für Weiß-Lampen, farbe/farben (xy) für Farblampen
const SZENEN_ARTEN = {
  'Entspannen': { bri: 144, kelvin: 2237 },
  'Konzentrieren': { bri: 254, kelvin: 4292 },
  'Lesen': { bri: 254, kelvin: 2890 },
  'Gedimmt': { bri: 77, kelvin: 2890 },
  'Nachtlicht': { bri: 3, kelvin: 2000, farbe: [0.5612, 0.4042] },
  'Hell': { bri: 254, kelvin: 2732 },
  'Aufwachen': { bri: 180, kelvin: 3500 },
  'Kochen': { bri: 254, kelvin: 4000 },
  'Gemütlich': { bri: 110, kelvin: 2400, farbe: [0.5016, 0.4151] },
  'Sonnenuntergang Savanne': { bri: 200, kelvin: 2200, farben: [[0.5794, 0.3858], [0.6185, 0.3576], [0.5219, 0.4127], [0.4862, 0.3437]], dynamisch: true }
};

// Vorgabe für beliebige Szenennamen (auch englische Hue-Standardszenen), sonst neutral warmweiß
function szenenVorgabe(name) {
  if (SZENEN_ARTEN[name]) return SZENEN_ARTEN[name];
  const n = String(name || '').toLowerCase();
  const regeln = [
    [/relax|entspann/, SZENEN_ARTEN.Entspannen],
    [/concentrat|konzentr/, SZENEN_ARTEN.Konzentrieren],
    [/read|lesen/, SZENEN_ARTEN.Lesen],
    [/energi|hell|bright/, { bri: 254, kelvin: 6410 }],
    [/night|nacht/, SZENEN_ARTEN.Nachtlicht],
    [/rest|ruhe/, { bri: 92, kelvin: 2203 }],
    [/dim|gedimmt/, SZENEN_ARTEN.Gedimmt],
    [/natural|natür/, { bri: 230, kelvin: 4000, dynamisch: true, farben: [[0.3804, 0.3768], [0.4317, 0.4031]] }],
    [/sunset|sonnenunter|savann/, SZENEN_ARTEN['Sonnenuntergang Savanne']],
    [/hill|hügel|wald|forest|ocean|meer|aurora/, { bri: 180, kelvin: 3000, dynamisch: true, farben: [[0.2857, 0.3906], [0.3591, 0.4569], [0.2015, 0.2385]] }],
    [/kochen|cook/, SZENEN_ARTEN.Kochen],
    [/gemüt|cozy|cosy/, SZENEN_ARTEN['Gemütlich']],
    [/aufwach|wake/, SZENEN_ARTEN.Aufwachen]
  ];
  for (const r of regeln) if (r[0].test(n)) return r[1];
  return { bri: 180, kelvin: 2700 };
}

const SZENEN = {
  wohnzimmer: ['Entspannen', 'Konzentrieren', 'Lesen', 'Gedimmt', 'Nachtlicht', 'Sonnenuntergang Savanne'],
  schlafzimmer: ['Entspannen', 'Nachtlicht', 'Hell', 'Aufwachen'],
  kueche: ['Hell', 'Kochen', 'Gemütlich'],
  buero: ['Konzentrieren', 'Lesen', 'Entspannen'],
  bad: ['Hell', 'Entspannen'],
  flur: ['Hell', 'Nachtlicht']
};

// zuletzt aktiviert (Minuten her); sonst Zustand „unknown“
const SZENEN_ZULETZT = { 'scene.wohnzimmer_entspannen': 185, 'scene.kueche_kochen': 320, 'scene.buero_konzentrieren': 610 };

function slug(text) {
  return text.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function hueSzenen() {
  const liste = [];
  Object.keys(SZENEN).forEach(function (raum) {
    SZENEN[raum].forEach(function (name) {
      liste.push({
        entity_id: 'scene.' + raum + '_' + slug(name), geraet: 'raum_' + raum, name: name, art: 'szene',
        modell: Object.assign({ raum: raum, name: name, gruppenName: GERAETE['raum_' + raum][0] }, SZENEN_ARTEN[name])
      });
    });
    liste.push({
      entity_id: 'select.' + raum + '_szene', geraet: 'raum_' + raum, name: 'Szene', art: 'szenenauswahl',
      modell: { raum: raum, optionen: SZENEN[raum].slice() }
    });
  });
  return liste;
}

// ───────────────────────────── Medien ─────────────────────────────
const PLAYLIST = [
  { titel: 'Blinding Lights', kuenstler: 'The Weeknd', album: 'After Hours', dauer: 200 },
  { titel: 'Wenn sie tanzt', kuenstler: 'Max Giesinger', album: 'Der Junge, der rennt', dauer: 213 },
  { titel: 'Flowers', kuenstler: 'Miley Cyrus', album: 'Endless Summer Vacation', dauer: 200 },
  { titel: 'Auf uns', kuenstler: 'Andreas Bourani', album: 'Hey', dauer: 238 },
  { titel: 'Levitating', kuenstler: 'Dua Lipa', album: 'Future Nostalgia', dauer: 203 },
  { titel: 'Chöre', kuenstler: 'Mark Forster', album: 'TAPE', dauer: 191 },
  { titel: 'As It Was', kuenstler: 'Harry Styles', album: "Harry's House", dauer: 167 },
  { titel: 'Komet', kuenstler: 'Udo Lindenberg & Apache 207', album: 'Komet', dauer: 200 },
  { titel: 'Bad Habits', kuenstler: 'Ed Sheeran', album: '=', dauer: 231 },
  { titel: 'Tage wie diese', kuenstler: 'Die Toten Hosen', album: 'Ballast der Republik', dauer: 232 }
];

const SENDER = {
  'https://streams.80s80s.de/web/mp3-192/streams.80s80s.de/': '80s80s',
  'https://icecast.wdr.de/wdr/wdr4/rheinruhr/mp3/128/stream.mp3': 'WDR 4',
  'https://stream.sunshine-live.de/live/mp3-192/stream.sunshine-live.de/': 'Sunshine Live',
  'https://radioitaliasmi.akamaized.net/hls/live/2093120/RISMI/master.m3u8': 'Radio Italia'
};

// Feature-Bits wie MediaPlayerEntityFeature
const MP = {
  PAUSE: 1, SEEK: 2, VOLUME_SET: 4, VOLUME_MUTE: 8, PREVIOUS_TRACK: 16, NEXT_TRACK: 32, TURN_ON: 128, TURN_OFF: 256,
  PLAY_MEDIA: 512, VOLUME_STEP: 1024, SELECT_SOURCE: 2048, STOP: 4096, CLEAR_PLAYLIST: 8192, PLAY: 16384,
  SHUFFLE_SET: 32768, SELECT_SOUND_MODE: 65536, BROWSE_MEDIA: 131072, REPEAT_SET: 262144, GROUPING: 524288,
  MEDIA_ANNOUNCE: 1048576, MEDIA_ENQUEUE: 2097152
};
function bits(namen) {
  return namen.reduce((s, n) => s | MP[n], 0);
}

const MEDIEN = [
  {
    entity_id: 'media_player.wohnzimmer_sonos', geraet: 'sonos', art: 'medien',
    modell: {
      typ: 'sonos', device_class: 'speaker', zustand: 'playing', titel: 0, position: 42, lautstaerke: 0.28, schritt: 0.02,
      quellen: ['TV', 'Line-in'],
      features: bits(['PAUSE', 'SEEK', 'VOLUME_SET', 'VOLUME_MUTE', 'PREVIOUS_TRACK', 'NEXT_TRACK', 'PLAY_MEDIA', 'VOLUME_STEP', 'SELECT_SOURCE', 'STOP', 'CLEAR_PLAYLIST', 'PLAY', 'SHUFFLE_SET', 'BROWSE_MEDIA', 'REPEAT_SET', 'GROUPING', 'MEDIA_ANNOUNCE', 'MEDIA_ENQUEUE'])
    }
  },
  {
    entity_id: 'media_player.kueche_homepod', geraet: 'homepod_kueche', art: 'medien',
    modell: {
      typ: 'homepod', device_class: 'speaker', zustand: 'paused', titel: 7, position: 81, lautstaerke: 0.4, schritt: 0.1,
      features: bits(['PAUSE', 'SEEK', 'VOLUME_SET', 'PREVIOUS_TRACK', 'NEXT_TRACK', 'TURN_ON', 'TURN_OFF', 'PLAY_MEDIA', 'VOLUME_STEP', 'STOP', 'PLAY', 'SHUFFLE_SET', 'BROWSE_MEDIA', 'REPEAT_SET'])
    }
  },
  {
    entity_id: 'media_player.schlafzimmer_homepod', geraet: 'homepod_schlafzimmer', art: 'medien',
    modell: {
      typ: 'homepod', device_class: 'speaker', zustand: 'idle', titel: null, position: 0, lautstaerke: 0.2, schritt: 0.1,
      features: bits(['PAUSE', 'SEEK', 'VOLUME_SET', 'PREVIOUS_TRACK', 'NEXT_TRACK', 'TURN_ON', 'TURN_OFF', 'PLAY_MEDIA', 'VOLUME_STEP', 'STOP', 'PLAY', 'SHUFFLE_SET', 'BROWSE_MEDIA', 'REPEAT_SET'])
    }
  },
  {
    entity_id: 'media_player.wohnzimmer_fernseher', geraet: 'apple_tv', art: 'medien',
    modell: {
      typ: 'appletv', device_class: 'tv', zustand: 'off', titel: null, position: 0, lautstaerke: null, schritt: 0.1,
      quellen: ['Apple TV', 'ARD Mediathek', 'Disney+', 'Musik', 'Netflix', 'YouTube', 'ZDFmediathek'],
      features: bits(['PAUSE', 'SEEK', 'PREVIOUS_TRACK', 'NEXT_TRACK', 'TURN_ON', 'TURN_OFF', 'PLAY_MEDIA', 'VOLUME_STEP', 'SELECT_SOURCE', 'STOP', 'PLAY', 'SHUFFLE_SET', 'BROWSE_MEDIA', 'REPEAT_SET'])
    }
  }
];

// ───────────────────────────── Raumklima ─────────────────────────────
// Startwerte und Tagesprofil je Raum (für Live-Schwankung und 24-h-Verlauf)
const KLIMA = {
  wohnzimmer: { temp: 21.6, feuchte: 47.5, basisTemp: 20.6, basisFeuchte: 47, amplitude: 0.6 },
  schlafzimmer: { temp: 18.9, feuchte: 56.0, basisTemp: 18.4, basisFeuchte: 52, amplitude: 0.5, besonders: 'nachtfeuchte' },
  kueche: { temp: 20.8, feuchte: 52.0, basisTemp: 20.2, basisFeuchte: 50, amplitude: 0.8 },
  bad: { temp: 20.6, feuchte: 64.0, basisTemp: 20.8, basisFeuchte: 60, amplitude: 0.5, besonders: 'dusche' },
  flur: { temp: 19.7, feuchte: null, basisTemp: 19.3, basisFeuchte: null, amplitude: 0.4 },
  buero: { temp: 20.2, feuchte: 45.0, basisTemp: 19.8, basisFeuchte: 45, amplitude: 0.7 }
};

const HEIZUNGEN = [
  { entity_id: 'climate.wohnzimmer_heizung', geraet: 'wz_heizung', raum: 'wohnzimmer', modus: 'heat', soll: 21.5, preset: 'comfort' },
  { entity_id: 'climate.schlafzimmer_heizung', geraet: 'sz_heizung', raum: 'schlafzimmer', modus: 'auto', soll: 17, preset: 'eco' },
  { entity_id: 'climate.bad_heizung', geraet: 'bad_heizung', raum: 'bad', modus: 'heat', soll: 23, preset: null },
  { entity_id: 'climate.buero_heizung', geraet: 'bu_heizung', raum: 'buero', modus: 'off', soll: 20, preset: null }
];
// Preset-Temperaturen (wie FRITZ!DECT: Komfort/Absenk), Zeitplan für „auto“
const PRESETS = { eco: 17, comfort: 21, boost: 25 };
const ZEITPLAN = { tagVon: 6.5, tagBis: 22.5, tag: 20, nacht: 17 };

// ───────────────────────────── Alle Entitäten ─────────────────────────────
function raumsensoren(raum, geraet, kurz) {
  const k = KLIMA[raum];
  const liste = [sensor('sensor.' + raum + '_temperatur', geraet, 'Temperatur', 'temperatur', k.temp, { modell: { raum: raum, groesse: 'temp' } })];
  if (k.feuchte !== null) liste.push(sensor('sensor.' + raum + '_luftfeuchtigkeit', geraet, 'Luftfeuchtigkeit', 'feuchte', k.feuchte, { modell: { raum: raum, groesse: 'feuchte' } }));
  if (kurz) liste.push(sensor('sensor.' + kurz + '_batterie', geraet, 'Batterie', 'batterie', 87));
  return liste;
}

const ENTITAETEN = [].concat(
  // ── Wohnzimmer ──
  lampe('light.wohnzimmer_decke', 'wz_decke', { an: true, bri: 180, kelvin: 2700 }),
  lampe('light.wohnzimmer_stehlampe', 'wz_stehlampe', { farbe: true, an: true, bri: 150, xy: [0.5267, 0.4133] }),
  lampe('light.wohnzimmer_lightstrip_tv', 'wz_lightstrip', { farbe: true, an: true, bri: 90, xy: [0.2485, 0.0917] }),
  lampe('light.wohnzimmer_globusleuchte', 'wz_globus', { matter: true, an: false, bri: 120, hs: [30, 70] }),
  hueGruppe('light.wohnzimmer', 'raum_wohnzimmer', 'wohnzimmer'),
  raumsensoren('wohnzimmer', 'wz_klima', 'wohnzimmer_klimasensor'),
  binaer('binary_sensor.wohnzimmer_fenster', 'wz_fenster', null, 'window', false, { modell: { raum: 'wohnzimmer', fenster: true } }),
  sensor('sensor.wohnzimmer_fenster_batterie', 'wz_fenster', 'Batterie', 'batterie', 92),
  binaer('binary_sensor.wohnzimmer_bewegung', 'wz_bewegungsmelder', 'Bewegung', 'motion', false),
  sensor('sensor.wohnzimmer_bewegungsmelder_temperatur', 'wz_bewegungsmelder', 'Temperatur', 'temperatur', 21.9, { modell: { raum: 'wohnzimmer', groesse: 'temp', versatz: 0.3 } }),
  sensor('sensor.wohnzimmer_bewegungsmelder_batterie', 'wz_bewegungsmelder', 'Batterie', 'batterie', 76),
  sensor('sensor.wohnzimmer_heizung_batterie', 'wz_heizung', 'Batterie', 'batterie', 70),

  // ── Schlafzimmer (Dachschräge) ──
  lampe('light.schlafzimmer_decke', 'sz_decke', { an: false, bri: 200, kelvin: 2700 }),
  lampe('light.schlafzimmer_nachttisch_links', 'sz_nachttisch_links', { farbe: true, an: false, bri: 120, kelvin: 2200 }),
  lampe('light.schlafzimmer_nachttisch_rechts', 'sz_nachttisch_rechts', { an: true, bri: 40, kelvin: 2200 }),
  hueGruppe('light.schlafzimmer', 'raum_schlafzimmer', 'schlafzimmer'),
  raumsensoren('schlafzimmer', 'sz_klima', 'schlafzimmer_klimasensor'),
  binaer('binary_sensor.schlafzimmer_dachfenster', 'sz_dachfenster', null, 'window', false, { modell: { raum: 'schlafzimmer', fenster: true } }),
  sensor('sensor.schlafzimmer_dachfenster_batterie', 'sz_dachfenster', 'Batterie', 'batterie', 64),
  binaer('binary_sensor.schlafzimmer_bett_belegung', 'sz_bett', 'Belegung', 'occupancy', false),
  sensor('sensor.schlafzimmer_bett_beleuchtungsstaerke', 'sz_bett', 'Beleuchtungsstärke', 'helligkeit', 3),
  sensor('sensor.schlafzimmer_bett_batterie', 'sz_bett', 'Batterie', 'batterie', 88),
  sensor('sensor.schlafzimmer_heizung_batterie', 'sz_heizung', 'Batterie', 'batterie', 81),

  // ── Küche ──
  lampe('light.kueche_decke', 'ku_decke', { an: true, bri: 230, kelvin: 4000 }),
  lampe('light.kueche_arbeitsplatte', 'ku_arbeitsplatte', { farbe: true, an: true, bri: 200, kelvin: 3000 }),
  hueGruppe('light.kueche', 'raum_kueche', 'kueche'),
  raumsensoren('kueche', 'ku_klima', 'kueche_klimasensor'),
  binaer('binary_sensor.kueche_fenster', 'ku_fenster', null, 'window', false, { modell: { raum: 'kueche', fenster: true } }),
  sensor('sensor.kueche_fenster_batterie', 'ku_fenster', 'Batterie', 'batterie', 100),
  steckdose('kaffeemaschine', 'kaffeemaschine', { an: false, energie: 41.237, temperatur: 24.6, spannung: true, profil: 'kaffee' }),
  steckdose('kuehlschrank', 'kuehlschrank', { an: true, energie: 212.904, versteckt: true, profil: 'kuehlschrank' }),

  // ── Bad ──
  lampe('light.bad_spiegel', 'bad_spiegel', { an: false, bri: 254, kelvin: 4000 }),
  lampe('light.bad_decke', 'bad_decke', { an: false, bri: 254, kelvin: 3500 }),
  hueGruppe('light.bad', 'raum_bad', 'bad'),
  raumsensoren('bad', 'bad_klima', 'bad_klimasensor'),
  binaer('binary_sensor.bad_fenster', 'bad_fenster', null, 'window', true, { modell: { raum: 'bad', fenster: true } }),
  sensor('sensor.bad_fenster_batterie', 'bad_fenster', 'Batterie', 'batterie', 71),
  sensor('sensor.bad_heizung_batterie', 'bad_heizung', 'Batterie', 'batterie', 66),
  { entity_id: 'sensor.waschmaschine_betriebszustand', geraet: 'waschmaschine', name: 'Betriebszustand', art: 'waschmaschine', tk: 'operation_state' },
  { entity_id: 'sensor.waschmaschine_programmfortschritt', geraet: 'waschmaschine', name: 'Programmfortschritt', art: 'waschmaschine', tk: 'program_progress' },
  { entity_id: 'sensor.waschmaschine_programmende', geraet: 'waschmaschine', name: 'Programmende', art: 'waschmaschine', tk: 'program_finish_time' },
  binaer('binary_sensor.waschmaschine_tuer', 'waschmaschine', 'Tür', 'door', false),

  // ── Flur ──
  lampe('light.flur_decke', 'flur_decke', { an: false, bri: 200, kelvin: 3000 }),
  lampe('light.flur_spots', 'flur_spots', { an: false, bri: 200, kelvin: 3000 }),
  hueGruppe('light.flur', 'raum_flur', 'flur'),
  raumsensoren('flur', 'flur_bewegungsmelder', null),
  binaer('binary_sensor.flur_bewegung', 'flur_bewegungsmelder', 'Bewegung', 'motion', false),
  sensor('sensor.flur_helligkeit', 'flur_bewegungsmelder', 'Helligkeit', 'helligkeit', 0),
  sensor('sensor.flur_bewegungsmelder_batterie', 'flur_bewegungsmelder', 'Batterie', 'batterie', 8),
  binaer('binary_sensor.wohnungstuer', 'wohnungstuer', null, 'door', false),
  sensor('sensor.wohnungstuer_batterie', 'wohnungstuer', 'Batterie', 'batterie', 60),
  { entity_id: 'vacuum.saugi', geraet: 'saugi', name: null, art: 'sauger' },
  sensor('sensor.saugi_batterie', 'saugi', 'Batterie', 'batterie', 100),

  // ── Büro ──
  lampe('light.buero_schreibtisch', 'bu_schreibtisch', { farbe: true, an: true, bri: 220, kelvin: 4300 }),
  lampe('light.buero_decke', 'bu_decke', { an: false, bri: 254, kelvin: 4000 }),
  lampe('light.buero_leselampe', 'bu_leselampe', { an: false, bri: 180, kelvin: 2700, nichtErreichbar: true, bereich: 'buero' }),
  hueGruppe('light.buero', 'raum_buero', 'buero'),
  raumsensoren('buero', 'bu_klima', 'buero_klimasensor'),
  binaer('binary_sensor.buero_fenster', 'bu_fenster', null, 'window', false, { modell: { raum: 'buero', fenster: true } }),
  sensor('sensor.buero_fenster_batterie', 'bu_fenster', 'Batterie', 'batterie', 83),
  sensor('sensor.buero_heizung_batterie', 'bu_heizung', 'Batterie', 'batterie', 58),
  steckdose('schreibtisch', 'schreibtisch', { an: true, energie: 96.512, bereich: 'buero', profil: 'schreibtisch' }),
  steckdose('fernseher_steckdose', 'fernseher_steckdose', { an: true, energie: 133.08, profil: 'fernseher' }),

  // ── Heizungen, Medien, Szenen ──
  HEIZUNGEN.map(h => ({ entity_id: h.entity_id, geraet: h.geraet, name: null, art: 'heizung', modell: h })),
  MEDIEN.map(m => ({ entity_id: m.entity_id, geraet: m.geraet, name: null, art: 'medien', modell: m.modell })),
  statisch('remote.wohnzimmer_fernseher', 'apple_tv', null, 'off', { activity_list: null, supported_features: 0 }, { art: 'fernbedienung' }),
  hueSzenen(),
  {
    entity_id: 'scene.filmabend', geraet: null, name: 'Filmabend', art: 'szene_ha', plattform: 'homeassistant', unique_id: '1726400000001',
    modell: {
      id: '1726400000001',
      entities: {
        'light.wohnzimmer_decke': { state: 'off' },
        'light.wohnzimmer_stehlampe': { state: 'on', brightness: 60, color_mode: 'xy', xy_color: [0.5267, 0.4133] },
        'light.wohnzimmer_lightstrip_tv': { state: 'on', brightness: 120, color_mode: 'xy', xy_color: [0.1858, 0.0794] }
      }
    }
  },

  // ── Strom gesamt ──
  { entity_id: 'sensor.stromverbrauch_wohnung', geraet: 'stromzaehler', name: 'Stromverbrauch Wohnung', hatName: false, art: 'stromgesamt' },
  sensor('sensor.stromzaehler_zaehlerstand', 'stromzaehler', 'Zählerstand', 'energie', 18452.318),

  // ── Personen ──
  { entity_id: 'person.julian', geraet: null, name: 'Julian', art: 'person', plattform: 'person', unique_id: 'julian', modell: { zustand: 'home', tracker: 'device_tracker.iphone_julian' } },
  { entity_id: 'person.alex', geraet: null, name: 'Alex', art: 'person', plattform: 'person', unique_id: 'alex', modell: { zustand: 'not_home', tracker: 'device_tracker.iphone_alex' } },
  { entity_id: 'device_tracker.iphone_julian', geraet: 'iphone_julian', name: null, art: 'tracker', modell: { zustand: 'home' } },
  { entity_id: 'device_tracker.iphone_alex', geraet: 'iphone_alex', name: null, art: 'tracker', modell: { zustand: 'not_home' } },
  sensor('sensor.iphone_julian_batterie', 'iphone_julian', 'Batterie', 'batterie', 64, { kategorie: null }),
  statisch('notify.iphone_julian', 'iphone_julian', null, 'unknown', { supported_features: 0 }),

  // ── Helfer, Skripte, Automationen ──
  statisch('input_boolean.gaestemodus', null, 'Gästemodus', 'off', { editable: true, icon: 'mdi:account-multiple' }, { plattform: 'input_boolean', art: 'helfer', unique_id: 'gaestemodus' }),
  statisch('input_boolean.urlaubsmodus', null, 'Urlaubsmodus', 'off', { editable: true, icon: 'mdi:airplane' }, { plattform: 'input_boolean', art: 'helfer', unique_id: 'urlaubsmodus' }),
  { entity_id: 'script.ich_geh_raus', geraet: null, name: 'Ich geh raus', art: 'skript', plattform: 'script', unique_id: 'ich_geh_raus', icon: 'mdi:exit-run' },
  { entity_id: 'script.gute_nacht', geraet: null, name: 'Gute Nacht', art: 'skript', plattform: 'script', unique_id: 'gute_nacht', icon: 'mdi:weather-night' },
  { entity_id: 'script.ich_bin_da', geraet: null, name: 'Ich bin da', art: 'skript', plattform: 'script', unique_id: 'ich_bin_da', icon: 'mdi:home-heart' },
  { entity_id: 'automation.flurlicht_bei_bewegung', geraet: null, name: 'Flurlicht bei Bewegung', art: 'automation', plattform: 'automation', unique_id: '1728501000001', modell: { an: true } },
  { entity_id: 'automation.morgenroutine', geraet: null, name: 'Morgenroutine', art: 'automation', plattform: 'automation', unique_id: '1728501000002', modell: { an: true } },

  // ── „Rauschen“, das echtes HA auch hat (Client muss filtern) ──
  { entity_id: 'sun.sun', geraet: null, name: 'Sun', art: 'sonne', plattform: 'sun', unique_id: 'sun_core' },
  { entity_id: 'zone.home', geraet: null, art: 'zone', ohneRegistry: true },
  { entity_id: 'weather.forecast_zuhause', geraet: 'met', name: 'Zuhause', art: 'wetter' },
  statisch('update.home_assistant_core_update', 'ha_core', null, 'off', updateAttr('Home Assistant Core', '2026.10.0', '2026.10.0', 'homeassistant'), { kategorie: 'config', name: 'Update' }),
  statisch('update.hue_bridge_firmware', 'hue_bridge', 'Firmware', 'on', updateAttr('Hue Bridge', '1.72.1972015010', '1.73.1973036000', 'hue'), { kategorie: 'config' }),
  statisch('update.saugi_firmware', 'saugi', 'Firmware', 'off', updateAttr('Roborock S7 MaxV', '02.29.02', '02.29.02', 'roborock'), { kategorie: 'config' }),
  sensor('sensor.wohnzimmer_sonos_wlan_signal', 'sonos', 'WLAN-Signal', 'signal', -58),
  statisch('binary_sensor.wohnzimmer_sonos_mikrofon', 'sonos', 'Mikrofon', 'off', {}, { kategorie: 'diagnostic', icon: null }),
  statisch('switch.wohnzimmer_sonos_loudness', 'sonos', 'Loudness', 'on', {}, { kategorie: 'config', art: 'schalter_einfach' }),
  statisch('number.wohnzimmer_sonos_bass', 'sonos', 'Bass', '0', { min: -10, max: 10, step: 1, mode: 'slider' }, { kategorie: 'config', art: 'zahl' }),
  statisch('binary_sensor.hue_bridge_entertainment_tv', 'hue_bridge', 'Entertainment-Bereich TV', 'off', { device_class: 'running' }),
  statisch('switch.hue_bridge_automation_aufwachen', 'hue_bridge', 'Automation: Aufwachen', 'on', {}, { kategorie: 'config', art: 'schalter_einfach' }),
  statisch('conversation.home_assistant', null, 'Home Assistant', 'unknown', { supported_features: 1 }, { plattform: 'conversation', unique_id: '01JCONVERSATIONHOMEASSIST' }),
  statisch('tts.google_translate_de_de', null, 'Google Translate de de', 'unknown', {}, { plattform: 'google_translate', unique_id: 'google_translate_de_de' }),
  { entity_id: 'todo.einkaufsliste', geraet: null, name: 'Einkaufsliste', art: 'todo', plattform: 'shopping_list', unique_id: 'shopping_list' },
  statisch('tag.schreibtisch', null, 'Schreibtisch', '2026-10-09T07:42:10.481920+00:00', { tag_id: 'a1f0c3e2-5b7d-4e8a-9c21-0d3f6b8e4a17', last_scanned_by_device_id: null }, { plattform: 'tag', unique_id: 'a1f0c3e2-5b7d-4e8a-9c21-0d3f6b8e4a17' })
);

function updateAttr(titel, installiert, neu, marke) {
  return {
    auto_update: false, display_precision: 0, installed_version: installiert, in_progress: false, latest_version: neu,
    release_summary: null, release_url: null, skipped_version: null, title: titel, update_percentage: null,
    entity_picture: 'https://brands.home-assistant.io/_/' + marke + '/icon.png', supported_features: 23
  };
}

// ───────────────────────────── Skripte ─────────────────────────────
// Aktionen im HA-Format (wie in scripts.yaml). Ziele über Areas, damit sie auch als Extras passen.
const SKRIPTE = {
  'script.ich_geh_raus': [
    { action: 'light.turn_off', target: { entity_id: 'all' } },
    { action: 'climate.set_preset_mode', target: { entity_id: 'all' }, data: { preset_mode: 'eco' } },
    { action: 'climate.set_temperature', target: { entity_id: 'all' }, data: { temperature: 17 } },
    { action: 'media_player.media_pause', target: { entity_id: 'all' } }
  ],
  'script.gute_nacht': [
    { action: 'light.turn_off', target: { entity_id: 'all' } },
    { action: 'light.turn_on', target: { area_id: 'schlafzimmer' }, data: { brightness: 3, color_temp_kelvin: 2000 } },
    { action: 'climate.set_temperature', target: { entity_id: 'all' }, data: { temperature: 18, hvac_mode: 'heat' } },
    { action: 'media_player.media_pause', target: { entity_id: 'all' } }
  ],
  'script.ich_bin_da': [
    { action: 'light.turn_on', target: { area_id: 'wohnzimmer' }, data: { brightness: 144, color_temp_kelvin: 2237 } },
    { action: 'climate.set_preset_mode', target: { entity_id: 'all' }, data: { preset_mode: 'comfort' } },
    { action: 'climate.set_temperature', target: { entity_id: 'all' }, data: { temperature: 21, hvac_mode: 'heat' } }
  ]
};

// ───────────────────────────── Automationen ─────────────────────────────
// Format wie automations.yaml (triggers/conditions/actions). Unterstützt: Zustands- und Zeit-Auslöser,
// Bedingungen time/state/template(immer wahr)/<domain>.is_on|is_off; Aktionen action/delay/condition.
const AUTOMATIONEN = {
  // Auslösung bei Bewegung übernimmt BEWEGUNGSLICHT (mit Ausschalten nach 60 s); hier nur für automation.trigger
  'automation.flurlicht_bei_bewegung': {
    id: '1728501000001', alias: 'Flurlicht bei Bewegung', mode: 'restart', triggers: [],
    actions: [{ action: 'light.turn_on', target: { entity_id: ['light.flur_decke', 'light.flur_spots'] }, data: { brightness: 200, color_temp_kelvin: 3000 } }]
  },
  'automation.morgenroutine': {
    id: '1728501000002', alias: 'Morgenroutine', mode: 'single',
    triggers: [{ trigger: 'time', at: '06:45:00' }],
    conditions: [{ condition: 'time', weekday: ['mon', 'tue', 'wed', 'thu', 'fri'] }],
    actions: [
      { action: 'light.turn_on', target: { area_id: 'schlafzimmer' }, data: { brightness_pct: 40, color_temp_kelvin: 3000, transition: 30 } },
      { action: 'climate.set_preset_mode', target: { area_id: 'bad' }, data: { preset_mode: 'comfort' } }
    ]
  }
};

// Bewegungslicht (fiktiv): Bewegung → Licht an, 60 s ohne Bewegung → aus
const BEWEGUNGSLICHT = {
  automation: 'automation.flurlicht_bei_bewegung', sensor: 'binary_sensor.flur_bewegung',
  lampen: ['light.flur_decke', 'light.flur_spots'], ausNachSekunden: 60
};

// Einkaufsliste zu Beginn (todo.*)
const TODO = {
  'todo.einkaufsliste': [
    ['Hafermilch', 'needs_action'], ['Brot', 'needs_action'], ['Kaffeebohnen', 'needs_action'],
    ['Äpfel', 'needs_action'], ['Spülmittel', 'completed'], ['Nudeln', 'needs_action'],
    ['Eier', 'completed'], ['Butter', 'completed'], ['Toilettenpapier', 'completed']
  ]
};

// Geräte, die bei --extras zum echten Haushalt dazukommen (samt ihrer Entitäten)
const EXTRAS_GERAETE = [
  'wz_heizung', 'sz_heizung', 'bad_heizung', 'bu_heizung',
  'wz_fenster', 'sz_dachfenster', 'ku_fenster', 'bad_fenster', 'bu_fenster', 'wohnungstuer',
  'waschmaschine', 'saugi', 'kaffeemaschine', 'schreibtisch', 'fernseher_steckdose', 'kuehlschrank', 'stromzaehler',
  'sonos', 'apple_tv'
];
// … und diese geräte-losen Entitäten (Helfer/Skripte)
const EXTRAS_ARTEN = ['skript', 'helfer'];

// ───────────────────────────── Szenarien (POST /sim/szenario/<name>) ─────────────────────────────
// Allgemein formuliert (über sim.finde), damit sie im fiktiven wie im echten Haushalt funktionieren.
// sim bietet: finde({domain, deviceClass, raumName, ausser}), setze(id, state, attrs), dienst(domain, service, daten),
// waschmaschine(art), bewegung(id, s), person(id, zustand), nichtErreichbar(id), saugerFehler(), reset()
// Rückgabe: Text (was passiert ist); Fehler werfen, wenn es im Haushalt nichts Passendes gibt.
function eins(liste, was) {
  if (!liste.length) throw new Error('Im Haushalt gibt es ' + was + ' nicht (evtl. mit --extras starten)');
  return liste[0];
}

const SZENARIEN = {
  'waschmaschine-fertig': sim => sim.waschmaschine('fertig'),
  'waschmaschine-start': sim => sim.waschmaschine('start'),
  'bewegung-flur': sim => {
    const id = eins(sim.finde({ domain: 'binary_sensor', deviceClass: ['motion', 'occupancy'], raumName: /flur/i }).concat(
      sim.finde({ domain: 'binary_sensor', deviceClass: ['motion', 'occupancy'] })), 'keinen Bewegungsmelder');
    sim.bewegung(id, 30);
    return id + ' 30 s an';
  },
  'alle-weg': sim => { sim.finde({ domain: 'person' }).forEach(id => sim.person(id, 'not_home')); return 'alle Personen not_home'; },
  'alle-da': sim => { sim.finde({ domain: 'person' }).forEach(id => sim.person(id, 'home')); return 'alle Personen home'; },
  'fenster-auf-heizung-an': sim => {
    const paar = eins(sim.fensterMitHeizung(/bad/i), 'kein Fenster in einem Raum mit Heizung');
    sim.setze(paar.fenster, 'on');
    return sim.dienst('climate', 'set_temperature', { entity_id: paar.heizung, temperature: 23, hvac_mode: 'heat' })
      .then(() => paar.fenster + ' offen, ' + paar.heizung + ' heizt');
  },
  'feuchte-schlafzimmer': sim => {
    const id = eins(sim.finde({ domain: 'sensor', deviceClass: ['humidity'], raumName: /schlaf|bed/i }).concat(sim.finde({ domain: 'sensor', deviceClass: ['humidity'] })), 'keinen Feuchtesensor');
    sim.setze(id, '72.0');
    return id + ' = 72 %';
  },
  'batterie-leer': sim => {
    const liste = sim.finde({ domain: 'sensor', deviceClass: ['battery'], ausser: /iphone|saugi/i });
    eins(liste, 'keinen Batteriesensor');
    const bewegung = liste.filter(id => /bewegung|motion|bett/i.test(id));
    const ziele = (bewegung.length ? [bewegung[0]] : []).concat(liste.filter(id => bewegung.indexOf(id) === -1)).slice(0, 2);
    ziele.forEach((id, i) => sim.setze(id, i === 0 ? '2' : '4'));
    return ziele.join(', ') + ' fast leer';
  },
  'geraet-weg': sim => {
    const id = eins(sim.finde({ domain: 'light', nurLampen: true, raumName: /k(ü|ue|u)che/i }).concat(sim.finde({ domain: 'light', nurLampen: true })), 'keine Lampe');
    sim.nichtErreichbar(id);
    return id + ' nicht erreichbar';
  },
  'medien-stop': sim => sim.dienst('media_player', 'media_stop', { entity_id: 'all' }).then(() => 'alle Medien gestoppt'),
  'medien-play': sim => sim.dienst('media_player', 'media_play', { entity_id: sim.finde({ domain: 'media_player' }).slice(0, 2) }).then(() => 'Wiedergabe gestartet'),
  'tuer-offen': sim => { const id = eins(sim.finde({ domain: 'binary_sensor', deviceClass: ['door'], ausser: /wasch/i }), 'keinen Türkontakt'); sim.setze(id, 'on'); return id + ' offen'; },
  'tuer-zu': sim => { const id = eins(sim.finde({ domain: 'binary_sensor', deviceClass: ['door'], ausser: /wasch/i }), 'keinen Türkontakt'); sim.setze(id, 'off'); return id + ' zu'; },
  'saugi-start': sim => sim.dienst('vacuum', 'start', { entity_id: eins(sim.finde({ domain: 'vacuum' }), 'keinen Saugroboter') }).then(() => 'Sauger startet'),
  'saugi-fehler': sim => { eins(sim.finde({ domain: 'vacuum' }), 'keinen Saugroboter'); sim.saugerFehler(); return 'Sauger meldet Fehler'; },
  'tag-scannen': (sim, p) => {
    const id = p.entity_id || eins(sim.finde({ domain: 'tag' }), 'keinen NFC-Tag');
    sim.tagScannen(id);
    return id + ' gescannt';
  },
  'reset': sim => { sim.reset(); return 'Ausgangszustand'; }
};

module.exports = {
  NAME: 'fiktiv',
  BEREICHE, TYPEN, GERAETE, SENSORARTEN, ENTITAETEN, SZENEN_ZULETZT, PLAYLIST, SENDER, MP,
  KLIMA, PRESETS, ZEITPLAN, SKRIPTE, AUTOMATIONEN, BEWEGUNGSLICHT, TODO, SZENARIEN,
  EXTRAS_GERAETE, EXTRAS_ARTEN, slug, szenenVorgabe, BAUSTEINE: { sensor, binaer, statisch, lampe }
};
