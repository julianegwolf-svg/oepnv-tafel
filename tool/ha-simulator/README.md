# Home-Assistant-Simulator für die SmartTafel

Ein lokaler Node-Prozess, der Home Assistant (WebSocket-API, Anmeldung, `/local/`-Dateien, Cover-Proxy) so genau nachbildet, dass der Tafel-Client später 1:1 gegen ein echtes HA läuft. **Getestet wird ausschließlich gegen diesen Simulator – nie gegen ein echtes Home Assistant.**

## Start

```sh
node tool/ha-simulator/server.js              # Haushalt aus haushalt.json (falls vorhanden), sonst fiktiv
node tool/ha-simulator/server.js --extras     # … plus fiktive Thermostate, Fenster/Tür, Waschmaschine, Sauger, Steckdosen, Sonos/TV, Skripte
HA_SIM_HAUSHALT=fiktiv node tool/ha-simulator/server.js   # nur der fiktive Haushalt (haushalt.js)
```

Die Tafel läuft dann unter derselben Adresse wie später in HA:
**http://localhost:8124/local/tafel/index.html** (`/` leitet dorthin um). Token und URL liest die Tafel aus `localStorage` bzw. einmalig aus `?ha_token=…`.

Benötigt nur `ws` aus `tool/node_modules` (Node ≥ 18). Beenden mit Strg+C.

### Haushalte

| Modus | Quelle | Inhalt |
|---|---|---|
| echt | `haushalt.json` + `automations.echt.yaml` (privat, gitignored, nur zur Laufzeit gelesen) | genau die exportierten Räume/Entitäten (gleiche entity_ids, area_ids, Gerätenamen, Plattformen, device_class/unit). Die Zustände sind erfunden. Die Automationen aus der YAML laufen echt ab. |
| echt + `--extras` | wie oben + Teile aus `haushalt.js` | zusätzlich Thermostate, Fenster/Tür, Waschmaschine, Saugroboter, Steckdosen mit Leistung, Sonos/TV, Skripte, Helfer. Räume werden über den Namen zugeordnet, fehlende (z. B. Flur) ergänzt. |
| fiktiv | `haushalt.js` | fiktive Wohnung in Bremen, ~150 Entitäten (Liste unten) |

**Datenschutz:** In eingecheckten Dateien stehen keine echten Namen oder IDs. `haushalt.json` und `automations.echt.yaml` sind gitignored und werden nie über HTTP ausgeliefert (`tool/` ist gesperrt).

## Optionen (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | 8124 | HTTP + WebSocket auf einem Port |
| `HA_SIM_HOST` | – | ohne Angabe nur `127.0.0.1` und `::1`; fürs iPad im WLAN `0.0.0.0` |
| `HA_SIM_TOKEN` | `tafel-sim-token` | fester Langzeit-Token (wird nie geloggt) |
| `HA_SIM_TOKEN_TTL_S` | 1800 | Laufzeit der Access-Tokens aus dem Login (zum Testen z. B. 8) |
| `HA_SIM_KONTEN` | `tafel:tafel-passwort,mfa-test:mfa-passwort:123456` | Login-Konten `name:passwort[:mfa-code]` |
| `HA_SIM_TICK_MS` | 5000 | Takt der Sensor-Schwankungen |
| `HA_SIM_CHAOS_S` | – | trennt in zufälligen Abständen (Mittel N s) alle Verbindungen |
| `HA_SIM_LATENZ_MS` | 0 | verzögert die Verarbeitung jeder Client-Nachricht |
| `HA_SIM_WOCHEN` | 4 | Wochen erzeugter Verlauf/Logbuch (0 = aus, max. 12) |
| `HA_SIM_EXTRAS` | – | `1` = wie `--extras` |
| `HA_SIM_HAUSHALT` | – | Pfad zu einer haushalt.json oder `fiktiv` |
| `HA_SIM_LEISE` | – | `1` = kaum Log |
| `HA_SIM_STRENG` | – | `1` = Automationen brechen bei ungültigen Aktionen ab wie in echtem HA (z. B. `rgb_color` + `color_temp_kelvin` zusammen). Ohne: der Simulator nimmt beim echten Haushalt jeweils die erste Angabe, damit die Wirkung sichtbar bleibt. |

## WebSocket `/api/websocket`

Ablauf wie in HA: `auth_required` → `{"type":"auth","access_token":"…"}` → `auth_ok` bzw. `auth_invalid` (danach wird die Verbindung geschlossen; ohne Anmeldung nach 10 s ebenfalls). ids müssen steigen (`id_reuse`), Fehler kommen als `{"success":false,"error":{"code","message"}}` mit Codes wie in HA (`not_found`, `invalid_format`, `unknown_command`, `service_validation_error`, `home_assistant_error`, `id_reuse`, `invalid_start_time`).

Unterstützte Befehle:
- Verbindung: `supported_features` (mit `coalesce_messages` bündelt der Server gleichzeitige Nachrichten als JSON-Array in einem Frame), `ping`, `auth/current_user`
- Daten: `get_states`, `get_config`, `get_services`, `subscribe_events` (mit/ohne `event_type`), `unsubscribe_events`, `subscribe_entities` (kompaktes Format a/c/r), `fire_event`
- Registries: `config/area_registry/list` (inkl. `temperature_entity_id`/`humidity_entity_id`), `config/device_registry/list`, `config/entity_registry/list`, `config/entity_registry/list_for_display`, `config/entity_registry/get`, `config/floor_registry/list`, `config/label_registry/list`
- Aktionen: `call_service` mit `target` (`entity_id` als String/Liste/`all`, `device_id`, `area_id`, `floor_id`, `label_id`) und `return_response`. Über Gerät/Area werden – wie in HA – versteckte Entitäten und config/diagnostic-Entitäten nicht erfasst. Die Entitäts-Area hat Vorrang vor der Geräte-Area.
- Verlauf: `history/history_during_period` (kompaktes Format `{"s","a","lu","lc"}`, `minimal_response`, `no_attributes`, `significant_changes_only`), `logbook/get_events` (`start_time`, `end_time`, `entity_ids`)
- Einkaufsliste: `todo/item/list`, `todo/item/subscribe` (Event `{"items":[…]}` bei jeder Änderung), `todo/item/move`

Wichtige Services: `light.turn_on/turn_off/toggle` (brightness, brightness_pct, brightness_step(_pct), color_temp_kelvin, hs/rgb/xy_color, color_name, effect; Farb- und Helligkeitsangaben schließen sich aus wie in HA), `scene.turn_on/apply/create/delete` (`create` mit `scene_id` + `snapshot_entities` bzw. `entities`; Licht, Klima, Schalter, Medien werden exakt wiederhergestellt), `hue.activate_scene`, `select.select_option` (Hue-Szenenauswahl), `climate.set_temperature/set_hvac_mode/set_preset_mode/turn_on/turn_off`, alle üblichen `media_player.*` inkl. `play_media` (bekannte Sender-URLs ergeben 80s80s, WDR 4, Sunshine Live, Radio Italia; andere URLs „Radio-Stream“), `vacuum.*`, `switch.*`, `input_boolean.*`, `script.turn_on` und `script.<name>`, `automation.trigger/turn_on/turn_off`, `todo.add_item/update_item/remove_item/remove_completed_items/get_items`, `weather.get_forecasts`, `homeassistant.turn_on/turn_off/toggle`, `notify.send_message`.

Media-Player-Features werden wie in HA geprüft: Wird ein nicht unterstützter Dienst an eine ausdrücklich genannte Entität geschickt, kommt `service_validation_error` (z. B. `volume_mute` an einen HomePod). Über Area/`all` adressierte Entitäten ohne das Feature werden still übersprungen. Nicht erreichbare Entitäten werden ebenfalls still übersprungen.

## HTTP

- `/local/tafel/<pfad>` → Dateien aus dem Repo-Wurzelordner, `Cache-Control: no-store`, Query (`?v=84`) wird ignoriert. Gesperrt (404): `..`, versteckte Dateien/Ordner (`.git` …), `tool/`, `belege/`, `node_modules`.
- `/api/media_player_proxy/<entity_id>?token=…&cache=…` → SVG-Cover 300×300 (Farbverlauf je Titel, Initialen, Titel/Interpret). Ohne passenden Token 401.
- `GET /api/` mit `Authorization: Bearer <token>` → `{"message":"API running."}`, sonst 401.
- Anmeldung wie HA:
  ```sh
  # 1. Flow starten
  curl -s -X POST localhost:8124/auth/login_flow -H 'Content-Type: application/json' \
    -d '{"client_id":"http://localhost:8124/","handler":["homeassistant",null],"redirect_uri":"http://localhost:8124/local/tafel/index.html"}'
  # 2. Zugangsdaten (falsch → errors.base "invalid_auth"; Konto mfa-test → step_id "mfa", dann {"client_id","code":"123456"})
  curl -s -X POST localhost:8124/auth/login_flow/<flow_id> -H 'Content-Type: application/json' \
    -d '{"client_id":"http://localhost:8124/","username":"tafel","password":"tafel-passwort"}'
  # 3. Code (einmal gültig) gegen Tokens tauschen
  curl -s -X POST localhost:8124/auth/token -d grant_type=authorization_code -d code=<result> -d client_id=http://localhost:8124/
  # Erneuern / Widerrufen
  curl -s -X POST localhost:8124/auth/token -d grant_type=refresh_token -d refresh_token=<rt> -d client_id=http://localhost:8124/
  curl -s -X POST localhost:8124/auth/token -d action=revoke -d token=<rt>
  ```
  Access-Tokens sind signierte JWTs mit Ablauf (`HA_SIM_TOKEN_TTL_S`). WebSocket-`auth` mit abgelaufenem oder widerrufenem Token führt zu `auth_invalid`. Beim Widerruf werden offene Verbindungen dieses Tokens getrennt. Ungültiger Refresh-Token → 400 `{"error":"invalid_grant"}`. `/auth/token` erlaubt CORS wie in HA.

## Steuer-API (nur von localhost)

```sh
curl -s localhost:8124/sim/status                     # Verbindungen, Subscriptions, Nachrichten, Speicher, Entitäten …
curl -s localhost:8124/sim/szenarien                  # Liste der Szenarien
curl -s -X POST localhost:8124/sim/trennen            # alle WebSockets hart trennen
curl -s -X POST 'localhost:8124/sim/pause?sekunden=20'  # „HA-Neustart“: trennt alle, 20 s lang 503 für WebSocket/api/auth
curl -s -X POST localhost:8124/sim/tokens-widerrufen  # alle Refresh-Tokens ungültig
curl -s -X POST localhost:8124/sim/state -H 'Content-Type: application/json' \
  -d '{"entity_id":"sensor.bad_luftfeuchtigkeit","state":"88.0","attributes":{}}'   # Zustand setzen (Attribute werden gemischt)
curl -s -X POST localhost:8124/sim/szenario/waschmaschine-fertig
```

Szenarien sind allgemein formuliert und funktionieren in jedem Haushalt. Gibt es nichts Passendes, kommt 409.
`waschmaschine-fertig`, `waschmaschine-start`, `bewegung-flur`, `alle-weg`, `alle-da`, `fenster-auf-heizung-an` (Bad-Fenster offen + Bad-Heizung heizt), `feuchte-schlafzimmer` (72 %), `batterie-leer`, `geraet-weg` (eine Lampe nicht erreichbar), `medien-stop`, `medien-play`, `tuer-offen`, `tuer-zu`, `saugi-start`, `saugi-fehler`, `tag-scannen?entity_id=tag.x` (löst Tag-Automationen aus), `reset` (Ausgangszustand, löscht per `scene.create` erstellte Szenen).

## Verhalten

- Takt (Standard 5 s): Raumtemperaturen ziehen sanft zum Tagesgang bzw. zur Heizung (Soll-Änderung ≈ 1 °C in 2 min), offene Fenster kühlen. Feuchte springt gelegentlich um ±0,5 %. Leistung schwankt, Energie zählt hoch, Gesamtverbrauch = Steckdosen + Lampen + Medien + Waschmaschine + Grundlast. Events gibt es nur bei echten Änderungen.
- Medien: Titel laufen ab und wechseln aus einer Playlist. `media_position` wird wie bei echten Integrationen nur etwa alle 30 s gemeldet (der Client rechnet mit `media_position_updated_at` hoch).
- Hue: Raumgruppen (`is_hue_group`, `hue_type: room`, `lights`, `entity_id`) leiten sich aus den Hue-Lampen des Raums ab (Matter-Lampen gehören nicht dazu). Gruppen und Szenen hängen am Raum-Gerät (Modell „Room“). Szenen setzen die Lampen; dynamische Szenen wechseln langsam die Farben. Im fiktiven Haushalt hat das Flur-Raumgerät absichtlich keine Area – Raum dann nur über `group_name`.
- Automationen: Zustands- und Zeit-Auslöser, Bedingungen `time`, `state`, `numeric_state`, `<domain>.is_on/is_off`, `and/or/not` (`template` gilt als erfüllt). Aktionen: `action`, `delay`, `condition`, `if`, `choose`, `sequence`, `stop`. `automation.trigger` überspringt die Bedingungen wie HA.
- Verlauf: Temperatur/Feuchte haben 24 h erzeugte Kurven (Tagesgang, Duschspitzen im Bad, steigende Nachtfeuchte im Schlafzimmer). Lichter, Personen, Bewegung/Fenster, Tags und Automationen haben `HA_SIM_WOCHEN` Wochen Tagesrhythmus (Werktag/Wochenende: werktags ~7:30 Licht aus und weg, ~8:50 Arbeitslicht, abends ~22:30 Schlafenszeit; Automationen werden nach ihrer Wirkung zugeordnet). Das Logbuch enthält `triggered by …`-Einträge und Kontext-Infos (`context_event_type`, `context_entity_id`, `context_user_id`).
- Speicher: Verlauf je Entität höchstens 5000 Punkte, Aufbewahrung 26 h bzw. Wochen-Verlauf + 2 Tage. Logbuch-, Kontext-, Flow- und Code-Speicher sind begrenzt. Timer werden beim Schließen der Verbindung bzw. bei `reset` abgeräumt.

## Fiktiver Haushalt (haushalt.js)

Räume: `wohnzimmer` Wohnzimmer, `schlafzimmer` Schlafzimmer, `kueche` Küche, `bad` Bad, `flur` Flur, `buero` Büro.

- **wohnzimmer**: light: wohnzimmer_decke, wohnzimmer_stehlampe, wohnzimmer_lightstrip_tv, wohnzimmer_globusleuchte (Matter), wohnzimmer (Hue-Gruppe) · sensor: wohnzimmer_temperatur, wohnzimmer_luftfeuchtigkeit, wohnzimmer_bewegungsmelder_temperatur, fernseher_steckdose_leistung/_energie, Batterien/WLAN [diagnostic] · binary_sensor: wohnzimmer_fenster, wohnzimmer_bewegung, hue_bridge_entertainment_tv · switch: fernseher_steckdose, wohnzimmer_sonos_loudness [config], hue_bridge_automation_aufwachen [config] · climate: wohnzimmer_heizung · media_player: wohnzimmer_sonos, wohnzimmer_fernseher · remote: wohnzimmer_fernseher · scene: wohnzimmer_entspannen, _konzentrieren, _lesen, _gedimmt, _nachtlicht, _sonnenuntergang_savanne · select: wohnzimmer_szene · number: wohnzimmer_sonos_bass [config] · update: hue_bridge_firmware [config]
- **schlafzimmer**: light: schlafzimmer_decke, _nachttisch_links, _nachttisch_rechts, schlafzimmer (Gruppe) · sensor: schlafzimmer_temperatur, _luftfeuchtigkeit, _bett_beleuchtungsstaerke, Batterien · binary_sensor: schlafzimmer_dachfenster, schlafzimmer_bett_belegung · climate: schlafzimmer_heizung (auto) · media_player: schlafzimmer_homepod · scene: schlafzimmer_entspannen, _nachtlicht, _hell, _aufwachen · select: schlafzimmer_szene
- **kueche**: light: kueche_decke, kueche_arbeitsplatte, kueche (Gruppe) · sensor: kueche_temperatur, _luftfeuchtigkeit, kaffeemaschine_leistung/_energie/_temperatur, kuehlschrank_leistung/_energie · binary_sensor: kueche_fenster · switch: kaffeemaschine, kuehlschrank (versteckt) · media_player: kueche_homepod · scene: kueche_hell, _kochen, _gemuetlich · select: kueche_szene · (deaktiviert: sensor.kaffeemaschine_spannung)
- **bad**: light: bad_spiegel, bad_decke, bad (Gruppe) · sensor: bad_temperatur, bad_luftfeuchtigkeit, waschmaschine_betriebszustand/_programmfortschritt/_programmende · binary_sensor: bad_fenster (anfangs offen, Heizung heizt), waschmaschine_tuer · climate: bad_heizung · scene: bad_hell, bad_entspannen · select: bad_szene
- **flur**: light: flur_decke, flur_spots · sensor: flur_temperatur, flur_helligkeit, flur_bewegungsmelder_batterie (8 %) · binary_sensor: flur_bewegung, wohnungstuer · vacuum: saugi (+ sensor.saugi_batterie)
- **buero**: light: buero_schreibtisch, buero_decke, buero_leselampe (nicht erreichbar; Gerät steht noch im Wohnzimmer), buero (Gruppe) · sensor: buero_temperatur, _luftfeuchtigkeit, schreibtisch_leistung/_energie · binary_sensor: buero_fenster · switch: schreibtisch (Gerät im Wohnzimmer, Entitäten im Büro) · climate: buero_heizung (aus) · scene: buero_konzentrieren, _lesen, _entspannen · select: buero_szene
- **ohne Raum**: light.flur (Gruppe), scene.flur_hell/_nachtlicht, select.flur_szene, scene.filmabend, sensor.stromverbrauch_wohnung, sensor.stromzaehler_zaehlerstand, person.julian (home), person.alex (not_home), device_tracker.iphone_julian/_alex, input_boolean.gaestemodus/urlaubsmodus, script.ich_geh_raus/gute_nacht/ich_bin_da, automation.flurlicht_bei_bewegung/morgenroutine, todo.einkaufsliste, sun.sun, zone.home, weather.forecast_zuhause, update.home_assistant_core_update, conversation.home_assistant, tts.google_translate_de_de, tag.schreibtisch, notify.iphone_julian

## Selbsttest

```sh
node tool/ha-simulator/server.js &          # oder mit --extras / HA_SIM_HAUSHALT=fiktiv
node tool/ha-simulator/selbsttest.js        # ✓/✗ je Prüfung, Exit-Code ≠ 0 bei Fehlern
```

Den Server startet der Test nicht selbst. Er prüft Protokoll, Registries, Licht per Area, `brightness_step_pct`/`all`, Szenen und `scene.create`, Klima, Medien, Cover, Verlauf, Logbuch, Todo, Automationen, Skripte, Steuer-API, Path-Traversal und den Login (falsch/MFA/Refresh/Widerruf). Den Token-Ablauf prüft er nur, wenn der Server mit `HA_SIM_TOKEN_TTL_S=8` läuft. Was im aktuellen Haushalt fehlt (z. B. Heizung ohne `--extras`), wird als ○ übersprungen. Die Ausgabe nennt keine Entitäts-IDs.

## Bekannte Abweichungen vom echten HA

- Keine Templates: `template`-Bedingungen gelten als erfüllt. Nicht unterstützt sind `render_template`, `subscribe_trigger`, `execute_script`, `history/stream`, `logbook/event_stream`, REST-`/api/states` und Kamera-/Bild-Proxies.
- Cover sind SVG statt JPEG/PNG.
- Login: keine IndieAuth-Prüfung der client_id über das Netz, kein `remember_me`, Codes 10 min gültig.
- Automationen (nur echter Haushalt): Setzt eine Aktion sich ausschließende Farbangaben (z. B. `rgb_color` + `color_temp_kelvin`), würde echtes HA die Automation abbrechen. Der Simulator behält die erste Angabe und warnt im Log. Bei direkten `call_service`-Aufrufen lehnt er solche Angaben wie HA ab.
- Gerätebezogene Auslöser (z. B. `occupancy.detected` mit `device_id`) werden nicht live ausgewertet, nur Zustands- und Zeit-Auslöser. Im Wochen-Verlauf erscheinen sie trotzdem.
- `brightness_step` bis ≤ 0 schaltet aus. Eine Hue-Gruppe zusammen mit allen Mitgliedern im selben Aufruf wird übersprungen, damit Schritte nicht doppelt wirken.
- Leistungssensoren ändern sich jeden Takt. Ihr Verlauf ist deshalb auf die letzten ~5000 Punkte begrenzt (bei 5-s-Takt etwa 7 h).
- `vacuum.battery_level`/`status` sind noch als Attribut vorhanden (in HA 2026 durch eigene Sensoren ersetzt; `sensor.saugi_batterie` gibt es zusätzlich).
- Echter Haushalt: Hue-Raum ohne Szenen-Entitäten → das `select.*_szene` hat eine Standard-Optionsliste. Area-Felder `temperature_entity_id`/`humidity_entity_id` sind dort null (unbekannt).

## Dateien

`server.js` (HTTP, WebSocket, Steuer-API) · `welt.js` (Registries, Zustände, Events, Verlauf, Ziel-Auflösung) · `modelle.js` (Verhalten, Automationen, Logbuch) · `dienste.js` (Services, Schema-Prüfung, Fehlercodes) · `auth.js` (Login/Tokens) · `historie.js` (24-h-Kurven, History-Abfrage) · `wochen.js` (Wochen-Verlauf) · `haushalt.js` (fiktiver Haushalt, Szenarien) · `haushalt-echt.js` (Laden der privaten haushalt.json, Extras) · `yaml.js` (kleiner YAML-Leser) · `farben.js`, `cover.js`, `werkzeuge.js` · `selbsttest.js`.

### Registry ändern (`POST /sim/registry`)

Wie in der HA-Oberfläche: `{"entity_id": "light.…", "area_id": "buro"}` (Raum wechseln), `"name": "Leselampe"` (umbenennen), `"hidden": true` (ausblenden). Feuert `entity_registry_updated` (`action: "update"`, `changes` = alte Werte) wie HA und schreibt den Zustand neu (neuer `friendly_name`). Die Tafel lädt daraufhin die Registries nach – ohne Neuverbinden.
