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

---

## Was die Tafel jetzt kann

| Wo | Was |
|---|---|
| **Panel „Zuhause“** | Räume als Kacheln: welche Lampen brennen (echte Lichtfarbe als Schein + Punkte), Temperatur/Feuchte, Belegung/Helligkeit vom Bewegungsmelder. **Ein Tipp auf „Einschalten/Ausschalten“** schaltet den ganzen Raum (über die Hue-Raumgruppe plus Lampen, die nicht in der Gruppe sind, z. B. Matter/IKEA). Rechts die **Einkaufsliste** zum Abhaken (bei bis zu 4 Räumen). Unten deine Schnellaktionen. |
| **Raumansicht** (Kachel antippen) | Jede Lampe einzeln: an/aus, Helligkeit (Schieberegler), Farbtemperatur, Farben. **Hue-Szenen als Knöpfe** (Dubletten zusammengefasst, Hue-Standardnamen eingedeutscht), aktive Szene markiert. Lautsprecher im Raum mit Play/Pause/Lautstärke. |
| **Schnellaktionen** (Haus-Knopf oben rechts + Zuhause-Panel) | „Ich geh raus“, „Gute Nacht“, „Arbeiten“ lösen **deine eigenen Automationen/Skripte** aus – die Tafel findet sie am Namen (raus/verlassen, Bett/Nacht, Arbeit), eigene Zuordnung in `config.js` möglich. Dazu „Alle Lichter aus“. Erst 4 s Countdown (nochmal tippen = abbrechen), danach **Rückgängig** (stellt die Lichter von vorher wieder her). |
| **Panel „Raumklima“** | Je Raum mit Sensor: Temperatur + Feuchte der letzten 24 h als Kurve, Feuchte-Grenze, und ein **echter Lüftungsrat**: die Tafel vergleicht die absolute Feuchte drinnen mit draußen (aus deiner Wetter-Entität) – „Jetzt lüften“ nur, wenn es wirklich trocknet. Thermostate (falls vorhanden) mit −/+. |
| **Panel „Medien“** | Erscheint nur, wenn etwas läuft: Cover, Titel, Fortschritt, Play/Pause/Weiter, Lautstärke, **Radio direkt auf dem HomePod**. |
| **Radio-Knopf** (oben) | Neu: „Abspielen auf: iPad / HomePod“ – mit HomePod spielt Home Assistant den Sender dort ab. |
| **Hinweise unten links** | Ruhige Chips, Wichtiges zuerst: Batterie fast leer, Gerät nicht erreichbar (erst nach 2 min), hohe Luftfeuchte, offene Fenster/Türen, Waschmaschine fertig und Ähnliches, sobald es solche Sensoren gibt. Antippen springt zur passenden Ansicht. |
| **Reaktionen** | Jeder Bewegungs-/Belegungsmelder weckt die Tafel aus Tiefschlaf/Ambient. **Ambient-Modus nur noch, wenn niemand zu Hause ist** (person.*), nicht mehr nach einer Stunde ohne Berührung. |

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
