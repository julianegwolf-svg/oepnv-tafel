# Föhrenstraße Abfahrtstafel

Statische Webseite, die Live-Abfahrten der Haltestelle Föhrenstraße (Bremen) plus Wetter anzeigt. Läuft komplett im Browser, kein Backend nötig.

- ÖPNV-Daten: [`v6.db.transport.rest`](https://v6.db.transport.rest/) — kostenlos, kein API-Key, CORS-frei
- Wetter: [Open-Meteo](https://open-meteo.com/) — kostenlos, kein API-Key

## Dateien

- `index.html` — Struktur
- `style.css` — Executive-Chic-Look
- `config.js` — **hier stellst du alles ein** (Haltestelle, Filter, Intervalle)
- `app.js` — Logik, muss normalerweise nicht angefasst werden

## 1. Auf GitHub Pages veröffentlichen

```bash
cd oepnv-tafel
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<dein-username>/oepnv-tafel.git
git push -u origin main
```

Dann auf GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: main / (root)** → Save.

Nach 1-2 Minuten ist die Seite live unter:
`https://<dein-username>.github.io/oepnv-tafel/`

Jede weitere Änderung (z.B. an `config.js`) einfach committen und pushen — die Seite aktualisiert sich automatisch neu.

## 2. Fahrtrichtung prüfen und filtern

Beim ersten Laden zeigt die Seite **alle** Abfahrten beider Föhrenstraße-Haltestellen. Schau dir die "Ziel"-Spalte an:

- Fährt eine Zeile *aus* der Stadt raus (z.B. Richtung Sebaldsbrück, Mahndorf, Arsten …), trag das Ziel in `config.js` unter `excludeDestinations` ein.
- Alternativ: trag unter `onlyDestinations` nur die Ziele ein, die *in* die Stadt fahren (z.B. `["Hauptbahnhof", "Domsheide", "Am Brill"]`).

Danach committen + pushen, fertig.

**Hinweis:** Die Föhrenstraße ist aktuell teilweise von Bauarbeiten (Zeppelintunnel) betroffen, es kann sein, dass zeitweise ein Ersatzverkehr (Linie 10E) andere Zielnamen zeigt. Die Seite reagiert automatisch, sobald sich die Live-Daten wieder ändern — nur die Filterliste in `config.js` ggf. nachziehen.

## 3. iPad als Kiosk einrichten

1. **Automatische Sperre deaktivieren:** Einstellungen → Anzeige & Helligkeit → Automatische Sperre → **Nie**
2. Safari öffnen, die GitHub-Pages-URL aufrufen
3. Teilen-Symbol → **Zum Home-Bildschirm** (dadurch startet die Seite später ohne Safari-Adressleiste, quasi als eigene App)
4. Von dort das Icon öffnen
5. **Guided Access aktivieren:** Einstellungen → Bedienungshilfen → Guided Access → An, Code festlegen
6. In der App dreimal die Seitentaste (bzw. Home-Taste) drücken → Guided Access starten
7. Fertig — das iPad bleibt jetzt dauerhaft auf der Abfahrtstafel, ohne dass man versehentlich rausswipen kann

## Technische Hinweise

- Abfahrten aktualisieren sich alle 30 Sekunden, Wetter alle 15 Minuten.
- Die Seite lädt sich alle 3 Stunden komplett neu (Sicherheitsnetz für Dauerbetrieb).
- Bei Fehlern (z.B. API kurzzeitig nicht erreichbar) steht unten links "Fehler: …" — die zuletzt geladenen Abfahrten bleiben trotzdem sichtbar, bis der nächste Versuch klappt.
