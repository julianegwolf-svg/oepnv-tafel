# Home Assistant an der Tafel – Einrichtung

Die Tafel wird zur Smart-Home-Zentrale: Räume auf einen Blick, Licht und Hue-Szenen mit einem Tipp, deine eigenen Automationen (Rausgehen, Schlafengehen, Arbeiten) als Schnellaktionen, Einkaufsliste zum Abhaken, Raumklima mit Lüftungsrat, Musik/Radio auf dem HomePod, ruhige Hinweise (Batterie, nicht erreichbar …) und eine Tafel, die aufwacht, wenn jemand da ist.

Alles läuft **nur im Heimnetz**, ohne Cloud, ohne neue Konten. Ohne Anmeldung verhält sich die Tafel genau wie bisher.

---

## In 10 Minuten live – was du tun musst

### 1. Warum nicht einfach GitHub Pages?
Die Tafel läuft bisher über `https://julianegwolf-svg.github.io/…`. Von einer **HTTPS**-Seite aus blockiert Safari Verbindungen zu **http://**-Adressen im Heimnetz („Mixed Content“) – dein Home Assistant ist aber nur per `http://homeassistant.local:8123` erreichbar. Deshalb liefert Home Assistant die Tafel künftig **selbst** aus: gleiche Adresse, kein Mixed Content, kein CORS.

### 2. Dateien nach Home Assistant kopieren
1. In Home Assistant das Add-on **Samba share** installieren und starten (Einstellungen → Add-ons → Add-on Store → „Samba share“, Benutzer/Passwort setzen).
2. Am Mac im Finder: **Gehe zu → Mit Server verbinden → `smb://homeassistant.local`** → Freigabe **config** verbinden.
3. Im Terminal im Repo (Branch `ausbau` bzw. nach dem Übernehmen `main`):
   ```bash
   ./tool/nach-ha-kopieren.sh /Volumes/config/www/tafel
   ```
   Das kopiert nur die Tafel-Dateien (HTML/CSS/JS) nach `/config/www/tafel/`.
4. **Nur beim allerersten Mal**, falls es den Ordner `www` vorher nicht gab: Home Assistant einmal neu starten (Einstellungen → System → Neu starten). `/local/` liefert nur Ordner aus, die beim Start schon existierten.
5. Test am Mac: `http://homeassistant.local:8123/local/tafel/index.html` öffnen – die Tafel erscheint mit Login-Bildschirm.

Später nach jeder Änderung an der Tafel einfach Schritt 3 wiederholen.

### 3. Eigenen Benutzer „tafel“ anlegen (empfohlen)
Einstellungen → Personen → Reiter **Benutzer** → **Benutzer hinzufügen**:
- Anzeigename: `Tafel`, Benutzername: `tafel`, ein eigenes Passwort
- **Administrator: aus** (die Tafel braucht keine Admin-Rechte – sie liest Zustände, schaltet Licht/Szenen, löst deine Automationen aus und hakt die Einkaufsliste ab)
- „Kann sich nur aus dem lokalen Netzwerk anmelden“: **an**

So siehst du in HA jederzeit, was die Tafel tut, und kannst ihr den Zugang mit einem Klick entziehen, ohne dein eigenes Konto anzufassen.

### 4. iPad umstellen
Wichtig: Eine Home-Bildschirm-App hat auf iOS **eigenen Speicher** – die Anmeldung muss deshalb **in** der Home-Bildschirm-App passieren, nicht vorher in Safari.

1. Guided Access am iPad beenden (Seitentaste/Home-Taste dreimal → Code → **Beenden**).
2. Safari öffnen: `http://homeassistant.local:8123/local/tafel/index.html`
   - Tipp: Falls `homeassistant.local` am iPad zickt, die IP-Adresse nehmen (z. B. `http://192.168.178.40:8123/local/tafel/index.html`) und im Router für HA eine feste IP vergeben.
3. Teilen → **Zum Home-Bildschirm** → Name z. B. „Tafel“. Das alte GitHub-Pages-Icon kannst du löschen.
4. Die neue „Tafel“ vom Home-Bildschirm öffnen → Login-Bildschirm → als **tafel** anmelden.
5. Guided Access wieder starten (dreimal drücken → **Starten**).

Fertig. Oben rechts in der Uhr-Pille erscheint ein **Haus-Knopf** mit kleinem Statuspunkt (grün = verbunden).

### 5. ✅ Kalender-Worker: die neue Adresse erlauben (sonst fehlen die Termine)
**Erledigt (Julian, 10.10. 11:31):** Der Worker erlaubt jetzt beide Adressen. Gegenprobe am 10.10. um 11:33 mit `curl -H "Origin: …"`: `https://julianegwolf-svg.github.io` und `http://homeassistant.local:8123` bekommen je ihre eigene Adresse als `Access-Control-Allow-Origin` zurück, dazu `Vary: Origin`, Termine und Charts. Fremde Herkünfte bekommen weiter nur die GitHub-Adresse. Der Rest dieses Abschnitts bleibt zum Nachlesen stehen.

Alle anderen Datenquellen der Tafel (Abfahrten, Wetter, Nachrichten, Radar …) erlauben jede Adresse. **Nur dein Kalender-Worker** (`kalender-worker….workers.dev`) antwortet ausschließlich `https://julianegwolf-svg.github.io` – geprüft am 10.10. mit `curl -H "Origin: http://homeassistant.local:8123"`. Aus Home Assistant geöffnet, verschwinden deshalb still das Termine-Panel, der Termin im Tagesblick und im Morgengruß.

Im Cloudflare-Dashboard → Workers → dein Kalender-Worker → **Code bearbeiten**: dort, wo `Access-Control-Allow-Origin` gesetzt wird, statt der festen Adresse eine kleine Liste verwenden:
```js
const ERLAUBT = [
  "https://julianegwolf-svg.github.io",
  "http://homeassistant.local:8123",
  // "http://192.168.178.40:8123",  // falls du die Tafel über die IP öffnest
];
const origin = request.headers.get("Origin") || "";
const allowOrigin = ERLAUBT.indexOf(origin) !== -1 ? origin : ERLAUBT[0];
// … in den Antwort-Headern:
//   "Access-Control-Allow-Origin": allowOrigin,
//   "Vary": "Origin",
```
**Prüfen am iPad:** lange auf die Uhr drücken → Einstellungen → **Datenquellen**. Jede Quelle zeigt, wann sie zuletzt geladen hat; „Termine – lädt nicht“ samt der Adresse, die der Worker erlauben muss, heißt: dieser Schritt fehlt noch.

### 6. ✅ Musik-Charts: ein Sensor in Home Assistant (sonst bleibt das Panel weg)
**Erledigt (Julian, 10.10. 11:31):** `sensor.musik_charts` steht in deiner configuration.yaml, der Kalender-Worker liefert die Liste zusätzlich unter `?musik=de`. `config.js` hat jetzt `musikProxy` gesetzt. Damit bekommt auch die GitHub-Pages-Fassung die Charts (geprüft: `belege/2026-10-10/s7/musik/pruefung.log`). In HA nimmt die Tafel zuerst den Sensor, fehlt er, den Worker.

Die bisherigen „Charts“ waren Deezers Hörer-Playlist „Top Germany“. Am 10.10. standen davon nur 2 der Top 10 auch in den **Offiziellen Deutschen Charts**, dafür viel US-Country. Apple Music „Meistgespielt – Deutschland“ trifft 9 von 10, auch die Nr. 1 stimmt (Vergleich: `belege/2026-10-10/s6/musik/vergleich-charts.txt`). Apple erlaubt aber keinen Abruf direkt aus dem Browser. Deshalb holt Home Assistant die Liste einmal pro Stunde, und die Tafel liest sie über die bestehende Verbindung mit. **Ohne diesen Sensor zeigt die Tafel kein Musik-Panel.** Lieber keins als falsche Charts.

In `configuration.yaml` ergänzen (Datei-Editor oder Samba), dann **Entwicklerwerkzeuge → YAML → Alle YAML-Konfigurationen neu laden**, bei Bedarf HA neu starten:
```yaml
rest:
  - resource: https://rss.marketingtools.apple.com/api/v2/de/music/most-played/10/songs.json
    scan_interval: 3600
    sensor:
      - name: Musik Charts
        unique_id: tafel_musik_charts
        value_template: "{{ value_json.feed.updated }}"
        json_attributes_path: "$.feed"
        json_attributes:
          - results

# Optional: die Liste nicht stündlich in der Verlaufs-Datenbank speichern
recorder:
  exclude:
    entities:
      - sensor.musik_charts
```
(Gibt es schon einen `recorder:`-Block, nur die `exclude`-Zeilen dort ergänzen.) **Prüfen:** Entwicklerwerkzeuge → Zustände → `sensor.musik_charts` zeigt ein Datum wie „Sat, 10 Oct 2026 08:07:33 +0000“ und ein Attribut `results` mit 10 Titeln. Die Tafel zeigt das Panel dann ohne Neuladen, unten links steht „Apple Music · meistgespielt · Stand …“. Ist der Sensor älter als 4 Tage, blendet die Tafel das Panel wieder aus.

*Ohne HA (GitHub Pages):* Dein Kalender-Worker kann die Liste mit CORS durchreichen. Im Worker vor dem Kalender-Teil:
```js
if (new URL(request.url).searchParams.get("musik") === "de") {
  const r = await fetch("https://rss.marketingtools.apple.com/api/v2/de/music/most-played/10/songs.json", { cf: { cacheTtl: 3600 } });
  return new Response(await r.text(), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": allowOrigin, "Vary": "Origin", "Cache-Control": "public, max-age=3600" } });
}
```
und in `config.js`: `musikProxy: "https://kalender-worker.julian-e-g-wolf.workers.dev/?musik=de"`.

### 7. Szenen wie in der Hue-App (35 Stück, optional)
In HA gab es bisher nur die Hue-Szenen im Schlafzimmer und „Concentrate“ im Büro. Das Wohnzimmer hatte keine, und die IKEA-Lampen waren in keiner Szene. Die Datei **`ha-vorschlag/scenes.yaml`** liegt nur auf deinem Mac. Der Ordner ist gitignored, weil sie deine echten entity_ids enthält. Sie baut die Hue-Klassiker für Wohnzimmer, Schlafzimmer und Büro nach:
- **Hell, Konzentrieren, Lesen, Entspannen, Gedimmt, Nachtlicht, Energie tanken** mit den Werten der Hue-Bridge, z. B. Entspannen 2237 K bei 56 % oder Konzentrieren 4292 K bei 100 %. Quellen stehen in `ha-vorschlag/baue-szenen.py`.
- dazu die Farbszenen **Sonnenuntergang, Tropische Dämmerung, Polarlicht und Frühling** mit den gemessenen Hue-Farben je Lampe
- und **Wohnzimmer · Filmabend** sowie **Schlafzimmer · Aufwachen**

Jede Lampe bekommt nur, was sie kann. Die reine Weißlampe im Büro bekommt nur Helligkeit. Die IKEA-Lampe ohne Farbe bekommt nur Farbtemperatur zwischen 2202 und 4000 K. Die Farblampen von Hue und IKEA bekommen Farbe. Je Lampe gibt es genau **eine** Farbangabe, also nicht der Fehler aus den alten Automationen. Die Hue-Raumgruppen werden nicht zusätzlich gesetzt.

**Einbau:**
1. Datei-Editor (oder Samba) → `/config/scenes.yaml` öffnen. Steht dort nur `[]`, diese Zeile durch den Inhalt von `ha-vorschlag/scenes.yaml` ersetzen. Gibt es schon eigene Szenen, den Inhalt darunter anhängen.
2. Prüfen, dass in `configuration.yaml` die Zeile `scene: !include scenes.yaml` steht. Das ist bei neuen Installationen Standard.
3. **Entwicklerwerkzeuge → YAML → „Szenen neu laden“.**
4. *Optional:* Einstellungen → Automationen & Szenen → Szenen → Szene öffnen → ⚙ → **Bereich** zuordnen. Die Tafel braucht das nicht, sie ordnet die Szenen über den Namensanfang („Wohnzimmer · …“) dem richtigen Raum zu. Sprachassistenten und die HA-Bereichsansicht profitieren aber davon.

Auf der Tafel erscheinen die Szenen in der Raumansicht mit kurzem Namen und Farbstreifen. Beim Antippen läuft ein Farbschleier in den Szenenfarben über den Knopf. Gibt es eine Hue-Szene mit gleichem Namen (z. B. „Read“ im Schlafzimmer), zeigt die Tafel nur die eigene, denn die schaltet auch die IKEA-Lampe mit. Geprüft mit `tool/pruefe-szenen.js` gegen den Simulator: Jede der 35 Szenen setzt alle 116 Lampenwerte genau wie vorgesehen (`belege/2026-10-10/s7/szenen/`).

Gut zu wissen: Die Home-Bildschirm-App unter der neuen Adresse hat eigenen Speicher. Was die Tafel bisher über deine Bedienung gelernt hat (Vorschläge), fängt dort neu an. Der HA-Verlauf liefert die Grundlage aber sofort wieder.

---

## Was die Tafel jetzt kann

| Wo | Was |
|---|---|
| **Panel „Zuhause“** | Räume als Kacheln: welche Lampen brennen (echte Lichtfarbe als Schein + Punkte), Temperatur/Feuchte, Belegung/Helligkeit vom Bewegungsmelder. **Ein Tipp auf „Einschalten/Ausschalten“** schaltet den ganzen Raum (über die Hue-Raumgruppe plus Lampen, die nicht in der Gruppe sind, z. B. Matter/IKEA). Rechts die **Einkaufsliste** zum Abhaken (bei bis zu 4 Räumen) – darunter „Wieder auf die Liste“: zuletzt Abgehaktes mit einem Tipp zurück. Unten deine Schnellaktionen. |
| **Raumansicht** (Kachel antippen) | Jede Lampe einzeln: an/aus, Helligkeit (Schieberegler), Farbtemperatur, Farben. **Hue-Szenen als Knöpfe** (Dubletten zusammengefasst, Hue-Standardnamen eingedeutscht), aktive Szene markiert. Lautsprecher im Raum mit Play/Pause/Lautstärke. |
| **Schnellaktionen** (Haus-Knopf oben rechts + Zuhause-Panel) | „Ich geh raus“, „Gute Nacht“, „Arbeiten“ lösen **deine eigenen Automationen/Skripte** aus – die Tafel findet sie am Namen (raus/verlassen, Bett/Nacht, Arbeit), eigene Zuordnung in `config.js` möglich. Dazu „Alle Lichter aus“. Erst 4 s Countdown (nochmal tippen = abbrechen), danach **Rückgängig** (stellt die Lichter von vorher wieder her). Die Tafel prüft, ob die Automation wirklich etwas geschaltet hat – sonst „hat nichts geschaltet“ statt „erledigt“ (und „Gute Nacht“ dunkelt dann nicht ab). |
| **Panel „Raumklima“** | Je Raum mit Sensor: Temperatur + Feuchte der letzten 24 h als Kurve, Feuchte-Grenze, und ein **echter Lüftungsrat**: die Tafel vergleicht die absolute Feuchte drinnen mit draußen (aus deiner Wetter-Entität) – „Jetzt lüften“ nur, wenn es wirklich trocknet. Thermostate (falls vorhanden) mit −/+. |
| **Panel „Medien“** | Erscheint nur, wenn etwas läuft: Cover, Titel, Fortschritt, Play/Pause/Weiter, Lautstärke, **Radio direkt auf dem HomePod**. |
| **Radio-Knopf** (oben) | Neu: „Abspielen auf: iPad / HomePod“ – mit HomePod spielt Home Assistant den Sender dort ab. |
| **Hinweise unten links** | Ruhige Chips, Wichtiges zuerst: Batterie fast leer (unter 20 % nur auf dem Zuhause-Panel, ab 10 % überall – `batterieGrenze`/`batterieDringend`), Gerät nicht erreichbar (erst nach 2 min), hohe Luftfeuchte, offene Fenster/Türen, Waschmaschine fertig und Ähnliches, sobald es solche Sensoren gibt. Antippen springt zur passenden Ansicht. |
| **Reaktionen** | Jeder Bewegungs-/Belegungsmelder weckt die Tafel aus Tiefschlaf/Ambient (Inhalte erscheinen gestaffelt). **Ambient-Modus nur noch, wenn niemand zu Hause ist** (person.*), nicht mehr nach einer Stunde ohne Berührung. |
| **Morgengruß** | Erste Bewegung des Tages ab 5 Uhr (bis 11 Uhr, einmal pro Tag): „Guten Morgen, Julian – 12 °C, es regnet – nimm die 23 um 07:35.“ Die Bahn ist die späteste deiner Arbeitslinie in deiner Richtung, die mit 5 Min Puffer pünktlich ankommt; am Wochenende stattdessen der erste Termin. Danach der Tagesblick mit derselben Bahn. Startzeit: `homeAssistant.reaktionen.morgengrussAb`, aus: `morgengruss: false`. |

Gibt es Geräte nicht (Heizung, Fensterkontakte, Waschmaschine, Saugroboter, Steckdosen …), zeigt die Tafel dafür **nichts** an. Kommen sie später in HA dazu, erscheinen sie automatisch.

Die Tafel erkennt alles selbst aus deinen HA-Bereichen. Feinsteuerung (optional) in `config.js` unter `homeAssistant`: Entitäten ausblenden, Raum-Reihenfolge, eigene Schnellaktionen, Grenzwerte, Reaktionen ein/aus.

---

## Anmeldung, Sicherheit – ehrlich

- Angemeldet wird über den **offiziellen Home-Assistant-Login** (`/auth/login_flow` → `/auth/token`). Die Tafel speichert **nur das Refresh-Token** im Speicher der Home-Bildschirm-App – **nie das Passwort**. Das kurzlebige Zugangs-Token (30 min) erneuert sie selbst.
- Zwei-Faktor (falls aktiviert): Die Tafel fragt den Code ab.
- **Abmelden:** lange (knapp 1 s) auf die Uhr drücken → Einstellungen → **Abmelden** (widerruft die Anmeldung in HA). Oder in HA: Profil des Benutzers → Sicherheit → Aktualisierungs-Token löschen.
- **Was nicht geschützt ist:** Die Tafel-Dateien selbst. Auf GitHub Pages ist der Code ohnehin öffentlich, und HA liefert `/local/`-Dateien ohne Anmeldung aus. Das ist unkritisch, weil darin **keine Zugangsdaten** stehen – geschützt ist alles, was aus Home Assistant kommt, durch den HA-Login.
- Mehrere falsche Passwörter hintereinander können je nach HA-Einstellung (`ip_ban_enabled`) die IP des iPads sperren – dann in HA unter `ip_bans.yaml` wieder freigeben.
- Notfall-Variante: In den Einstellungen gibt es zusätzlich „Langzeit-Token …“ (Profil → Sicherheit → Langlebige Zugangstoken). Funktioniert, ist aber weniger elegant (läuft 10 Jahre, muss man selbst widerrufen).

## Alternativen (falls du es anders willst)

| Weg | Vorteil | Nachteil |
|---|---|---|
| **Tafel aus HA ausliefern** (oben, empfohlen) | Kein Mixed Content, kein CORS, alles bleibt im Heimnetz | Nach Änderungen Dateien neu kopieren |
| **HTTPS für HA** (Nabu Casa oder eigenes Zertifikat) + Tafel weiter auf GitHub Pages | Updates automatisch über GitHub | HA im Internet erreichbar; zusätzlich `http: cors_allowed_origins: [https://julianegwolf-svg.github.io]` nötig; Nabu Casa kostet |
| **`cors_allowed_origins` allein** | – | Hilft nicht: Safari blockiert http-Verbindungen von HTTPS-Seiten trotzdem |

---

## Fehlersuche

| Anzeige | Bedeutung / Lösung |
|---|---|
| Kein Haus-Knopf oben | Tafel läuft noch über GitHub Pages (HTTPS) oder es ist keine HA-Adresse bekannt → Schritt 4 |
| Roter Punkt, „Blockiert (HTTPS → http)“ | Tafel wurde über HTTPS geöffnet → die `/local/tafel/`-Adresse verwenden |
| Roter Punkt, „Anmeldung nötig“ | Anmeldung wurde widerrufen/ist abgelaufen → aufs Haus tippen, neu anmelden |
| Gelber, atmender Punkt | Verbindung kurz weg (WLAN, HA-Neustart) – die Tafel verbindet sich selbst neu; Bedienung ist so lange gesperrt |
| Raum fehlt | Raum hat in HA keine Geräte, die die Tafel anzeigen kann (z. B. Küche ohne Licht/Sensor) – absichtlich |
| Schnellaktion meldet „hat nichts geschaltet“ (Chip „… wirkt nicht – in HA prüfen“) | HA hat die Automation zwar gestartet, aber kein Gerät hat reagiert – meist bricht sie an einer ungültigen Aktion ab (HA meldet das nicht zurück). In HA: Einstellungen → Automationen → die Automation → **Ablaufverfolgung** zeigt die Stelle. Bei *Bett Fertig*/*Arbeitsmodus*: je Lampe nur `color_temp_kelvin` **oder** `rgb_color` (FRAGEN 19) |
| Keine Termine mehr (seit dem Umzug nach HA) | Kalender-Worker erlaubt die neue Adresse nicht → Schritt 5; Einstellungen → Datenquellen zeigt „Termine – lädt nicht“ |
| Kein Musik-Panel | Absichtlich, solange weder `sensor.musik_charts` (höchstens 4 Tage alt) noch der Kalender-Worker (`?musik=de`) eine Liste liefert → Schritt 6 |

---

## Für Entwicklung/Tests: der Simulator
Getestet wurde alles **nur gegen einen lokalen HA-Simulator**, nie gegen dein echtes Home Assistant:
```bash
node tool/ha-simulator/server.js          # http://localhost:8124
# Tafel wie später in HA:  http://localhost:8124/local/tafel/index.html
# Login: tafel / tafel-passwort   (mit 2FA: mfa-test / mfa-passwort, Code 123456)
node tool/ha-simulator/selbsttest.js      # Protokoll-Selbsttest
```
Der Simulator bildet deinen Haushalt aus der privaten, nicht eingecheckten `tool/ha-simulator/haushalt.json` nach; Details in `tool/ha-simulator/README.md`.
