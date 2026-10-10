# KONZEPTE – neue Erweiterungen für die SmartTafel

Stand 10.10.2026, Sitzung 7. Auftrag aus FEEDBACK (10:05): nicht bestehende Panels verbessern (das steht in IDEEN.md), sondern **neue Dinge, die die Tafel zusätzlich kann**. Jedes Konzept ist an deiner echten Wohnung festgemacht: Hue- und IKEA-Lampen in Wohnzimmer, Schlafzimmer und Büro, HomePod mini im Büro, Bewegungsmelder im Schlafzimmer, Klimasensor im Bad, NFC-Tags an der Tür („Rausgehen“) und am Schreibtisch („Arbeitsmodus“), iPhone mit HA-App, Einkaufsliste.

**Legende**
- **Aufwand:** S = eine Sitzung, M = 2–3 Sitzungen, L = mehr oder abhängig von fremden Systemen.
- **Datenquellen:** am 10.10. mit `curl -H "Origin: …"` geprüft. HA-Fakten stammen aus der HA- bzw. Companion-Doku und dem HA-Quellcode, Nachweise am Ende.
- Kein Konzept schaltet etwas **ohne deinen Tipp**, außer du richtest es ausdrücklich ein (Wecklicht, Tor-Licht). Alles ist in `config.js` abschaltbar.

---

## Rangliste

Nutzen 1–5 (wie oft und wie spürbar im Alltag) gegen Aufwand. Hardware nur, wo nötig.

| Rang | Konzept | Nutzen | Aufwand | Hardware | Status |
|---|---|---|---|---|---|
| 1 | **K2 Tür-Check: „Tschüss“-Karte beim Scan des Tür-Tags** | 5 | S | – (Tag hängt schon) | **Prototyp gebaut** (`konzepte.tuerCheck`) |
| 2 | **K1 Wecklicht passend zur ersten Bahn** | 5 | M | – | **Prototyp gebaut** (`konzepte.wecklicht`) |
| 3 | **K3 Werder-Spieltag: Tor-Licht im Wohnzimmer** | 4 | M | – | **Prototyp folgt (Sitzung 7)** |
| 4 | K5 Wege zu Terminen („Los um 8:32 zum Zahnarzt“) | 4 | M | – | Konzept |
| 5 | K6 „Wo ist mein iPhone?“ – klingeln lassen | 4 | S | – | Konzept |
| 6 | K9 Gute-Nacht-Check vor „Bett Fertig“ | 4 | S | – | Konzept |
| 7 | K4 Morgengruß als Ansage über den HomePod | 3 | M | optional 2. HomePod mini (~99 €) | Konzept |
| 8 | K7 Rad oder Bahn? Hin- *und* Rückweg | 3 | S | – | Konzept (hängt an FRAGEN 25) |
| 9 | K10 Schlaf-Fokus des iPhones schaltet die Tafel | 3 | S | – | Konzept |
| 10 | K11 Einkaufsliste per Siri + aufs iPhone beim Gehen | 3 | S | – | Konzept |
| 11 | K18 Licht folgt dem Tag (Natürliches Licht überall) | 3 | M | – | Konzept, baut auf den neuen Szenen auf |
| 12 | K15 Haushalts-Erinnerungen als Ein-Tipp-Chips | 3 | S–M | optional Pflanzensensor | Konzept |
| 13 | K12 Geburtstage aus dem Kalender | 3 | S | – | Konzept (Kalender nötig) |
| 14 | K20 Hardware: Fenster-/Türkontakt Schlafzimmer & Wohnungstür | 3 | S | 2× IKEA MYGGBETT à 7,99 € | Konzept |
| 15 | K13 Gäste-Modus mit WLAN-QR-Code | 2 | S | FRITZ!Box (falls vorhanden) | Konzept |
| 16 | K14 Internet-Störung & Anwesenheit über FRITZ!Box | 2 | M | FRITZ!Box | Konzept |
| 17 | K8 Grünstrom-Ampel | 2 | S | – | Konzept |
| 18 | K16 Wochenrückblick am Sonntagabend | 2 | M | – | Konzept |
| 19 | K17 Fotorahmen am Abend | 2 | M | – | Konzept |
| 20 | K19 Paket-Ankündigung | 2 | L | – | nur Konzept (Schlüssel/Mailzugang) |

### Top 5 – warum genau diese
1. **K2 Tür-Check:** Du scannst den Tür-Tag schon heute jedes Mal beim Gehen, und „Rausgehen“ läuft. Die Tafel sieht diesen Scan und zeigt im selben Moment, was zählt: Wann fährt die Bahn, brauche ich einen Schirm, ist noch etwas an, steht etwas auf der Einkaufsliste? Das kostet keine neue Hardware und keine neue Gewohnheit, und es passiert jeden Tag.
2. **K1 Wecklicht:** Das ist der „unfassbar smarte“ Moment. Die Tafel weiß als einzige, wann deine Bahn fährt, ob ein Termin früher ist und ob Feiertag ist. Daraus berechnet sie, wann das Schlafzimmerlicht langsam aufgehen soll. Die Lampen hast du schon, die Szene „Schlafzimmer · Aufwachen“ auch.
3. **K3 Tor-Licht:** Das ist Begeisterung pur und kommt alle ein bis zwei Wochen vor. Der Live-Stand läuft schon (Sitzung 6), es fehlt nur der Schritt zum Licht. Weil das Licht bei falscher Bedienung nerven kann, ist es standardmäßig aus.
4. **K5 Wege zu Terminen:** Termine stehen schon auf der Tafel, aber ohne die Frage „wann muss ich los?“. Transitous kann das (schlüsselfrei, schon im Einsatz). Für Termine mit Ort spart das jedes Mal das Nachschauen in der App.
5. **K6 iPhone klingeln lassen:** Das passiert selten, ist dann aber sofort Gold wert. Ein Knopf genügt, das iPhone klingelt auch im Lautlos-Modus. Es ist fast kein Aufwand, die HA-App kann das schon.

---

## K1 · Wecklicht passend zur ersten Bahn ★ Prototyp

**Szene:** So, 21:40. Auf der Tafel steht im Abendblick: *„Morgen (Mo) Bahn 23 um 7:35 → Wecklicht 6:50 · 20 Min Sonnenaufgang im Schlafzimmer“* und daneben **[Wecklicht an]**. Ein Tipp, dann *„Wecklicht steht: Mo 6:30–6:50“*. Montag um 6:30 glimmen die beiden Schlafzimmerlampen bernsteinfarben auf 1 % und werden in 20 Minuten zu warmweißem 90 %-Licht („Schlafzimmer · Aufwachen“). Hast du am Montag um 8:00 einen Termin in der Neustadt, schlägt die Tafel stattdessen 6:20 vor. Ist Feiertag, schlägt sie gar nichts vor.
**Nutzen:** Du wachst sanfter auf und denkst nicht ans Stellen. Die Zeit stimmt mit Bahn und Terminen überein, statt für jeden Tag gleich zu sein.
**Daten/HA:** Die Bahnzeit kommt aus der Tafel (`arbeitsBahnAm`, wie Tagesblick und Morgengruß). Dazu ein Helfer `input_datetime` (Datum + Uhrzeit), den die Tafel per `input_datetime.set_datetime` setzt. Eine HA-Automation „Wecklicht“ startet 20 Minuten vorher `scene.turn_on` „Schlafzimmer · Nachtlicht“ und dann `light.turn_on` mit `transition: 1200` zum Ziel. HA erlaubt Übergänge bis 6553 s, Hue und Matter reichen sie durch. Die YAML kommt in HOME_ASSISTANT.md. Die Tafel muss nachts nicht laufen, denn HA weckt.
**Hardware:** keine.
**Aufwand:** M.
**Risiken:** Ob die IKEA-Lampe 20 Minuten gleichmäßig dimmt, ist nicht dokumentiert und muss einmal echt getestet werden. Ein Wecklicht ersetzt keinen Wecker. Es schaltet nie von selbst ein, nur nach deinem Tipp, und gilt nur für den einen Morgen.

## K2 · Tür-Check: „Tschüss“-Karte beim Scan des Tür-Tags ★ Prototyp

**Szene:** Mo 7:29. Du hältst das iPhone an den Tür-Tag, „Rausgehen“ schaltet die Lichter aus. Im selben Moment zeigt die Tafel groß:
*„Tschüss, Julian! · **23 → Universität in 6 Min** (Föhrenstraße, 7:35) – du schaffst sie, wenn du jetzt gehst · ☂ ab 16 Uhr Regen – Schirm mit · Einkaufsliste: Milch, Brot, Kaffee [aufs iPhone] · Licht: alles aus ✓“.*
Die Karte bleibt 90 s und verschwindet dann von selbst oder mit einem Tipp.
**Nutzen:** Alles, was beim Gehen zählt, steht auf einen Blick an der Wand, die du sowieso passierst. Du musst nicht aufs Handy schauen und bekommst keine Überraschung an der Haltestelle.
**Daten/HA:** Wichtig: Ein Nicht-Admin-Benutzer wie „tafel“ darf das Ereignis `tag_scanned` nicht abonnieren. Die Tag-Entität (`tag.*`, seit HA 2024.6) ändert aber beim Scan ihren Zustand auf die Scanzeit, und `state_changed` darf „tafel“ sehen. Die Abfahrten und das Wetter hat die Tafel schon. Die Einkaufsliste kommt aus `todo.*`, „aufs iPhone“ geht über `notify.send_message` an die HA-App. Welcher Tag „die Tür“ ist, erkennt die Tafel am Namen, wie bei den Schnellaktionen, oder über `config.js`.
**Hardware:** keine, der Tag klebt schon.
**Aufwand:** S.
**Risiken:** Die Karte darf nicht stören, wenn jemand anderes scannt (Tag „Tür“ und niemand geht). Deshalb verschwindet sie von selbst und schaltet nichts. Ohne HA gibt es kein Signal, dann kommt die Karte nicht.

## K3 · Werder-Spieltag: Tor-Licht im Wohnzimmer ★ Prototyp

**Szene:** Sa 15:47, Werder – Paderborn. Du bist zu Hause und im Wohnzimmer brennt Licht. Werder trifft. Die Farblampen im Wohnzimmer blinken dreimal in Werder-Grün und Weiß (etwa 4 s), dann ist alles wieder genau wie vorher. Gleichzeitig springt die Tafel aufs Spiel und zeigt „Tor! 1:0 – Ducksch 47.“ (das gibt es seit Sitzung 6). Vor dem Anpfiff erscheint ab 14:30 der Chip *„Anpfiff 15:30 · Weserstadion“*.
**Nutzen:** Ein Tor fühlt sich auch ohne Fernseher im Raum wie ein Ereignis an, und Gäste staunen.
**Daten/HA:** Der Live-Stand kommt von OpenLigaDB (läuft schon, alle 45 s nur während Spielen). Vor dem Blinken sichert die Tafel die Lampen mit `scene.create` + `snapshot_entities`. Dann folgt `light.turn_on` mit `xy_color` Grün und Weiß im Wechsel, danach stellt `scene.turn_on` der Sicherung alles wieder her. Das ist dieselbe Technik wie bei „Rückgängig“. Es läuft nur, wenn du zu Hause bist (`person.*` = home) und im Wohnzimmer mindestens eine Lampe an ist.
**Hardware:** keine.
**Aufwand:** M.
**Risiken:** OpenLigaDB ist 30–90 s langsamer als der Fernseher. Das Licht kommt also nach dem Jubel, und bei einem Stream könnte es spoilern. Ein vom VAR aberkanntes Tor blinkt trotzdem. Deshalb ist es **standardmäßig aus** (`homeAssistant.torLicht`).

## K4 · Morgengruß als Ansage über den HomePod

**Szene:** Mo 6:58, erste Bewegung im Schlafzimmer. Der HomePod im Büro sagt in normaler Lautstärke: *„Guten Morgen, Julian. Neun Grad, ab acht Uhr Regen. Die 23 um sieben Uhr fünfunddreißig schaffst du, wenn du um sieben Uhr siebenundzwanzig losgehst.“* Die Tafel zeigt dabei denselben Satz.
**Nutzen:** Du bekommst die wichtigste Information, ohne hinzusehen, etwa beim Anziehen.
**Daten/HA:** `tts.speak` → `media_player`. Die apple_tv-Integration streamt MP3 per AirPlay/RAOP auf den HomePod. Die TTS-Engine ist schlüsselfrei (Google Translate TTS) oder läuft lokal (Piper). Den Satz baut der Morgengruß schon heute.
**Hardware:** Der HomePod steht im Büro, nicht im Schlafzimmer. Für „beim Aufstehen hören“ wäre ein zweiter HomePod mini im Schlafzimmer nötig (~99 €).
**Aufwand:** M.
**Risiken:** Die Ansage unterbricht laufende Musik, ohne sie danach fortzusetzen (pyatv-Grenze). Der Lautsprecherzugriff in der Home-App muss ggf. auf „Alle“ stehen. Es gibt nur eine Ansage pro Morgen und nur werktags, abschaltbar.

## K5 · Wege zu Terminen

**Szene:** Di 7:50. Im Termine-Panel steht unter „9:00 Zahnarzt, Ostertorsteinweg“ jetzt *„Los um 8:32 · Linie 10 ab Föhrenstraße 8:36 · 18 Min“*. Ab 8:20 erscheint der Chip *„Zahnarzt: in 12 Min los“* auf allen Panels.
**Nutzen:** Kein Termin mehr, bei dem man nachrechnen muss.
**Daten:** Den Ort liefert der Kalender (`LOCATION` im ICS). Die Koordinaten kommen von Photon/komoot (schlüsselfrei, CORS `*`, maßvoll mit Zwischenspeicher je Ort), die Verbindung von Transitous (läuft schon für den Arbeitsweg).
**Hardware:** keine.
**Aufwand:** M.
**Risiken:** Ortsangaben wie „bei Mama“ kann niemand auflösen, dann zeigt die Tafel nichts statt etwas Falschem. Der Abruf läuft nur für die nächsten 2 Termine mit Ort und höchstens alle 15 min.

## K6 · „Wo ist mein iPhone?“

**Szene:** Sa 10:15, das iPhone ist weg. Du hältst den Haus-Knopf lange gedrückt oder tippst in der Zuhause-Ansicht auf **[iPhone klingeln lassen]**. Das iPhone klingelt 5 s laut, auch im Lautlos-Modus. Die Tafel zeigt dazu den letzten bekannten Ort („zu Hause, vor 3 Min“).
**Nutzen:** Kleiner Knopf, großer Moment.
**Daten/HA:** Eine kritische Benachrichtigung der HA-App mit `push: sound: {name: default, critical: 1, volume: 1.0}`. Das geht **nur** über den älteren Dienst `notify.mobile_app_<iphone>`, weil `notify.send_message` keine `data` annimmt. In der HA-App muss einmal „kritische Hinweise“ erlaubt werden.
**Hardware:** keine. **Aufwand:** S.
**Risiken:** Der Benutzer „tafel“ muss diesen Dienst aufrufen dürfen, das darf in HA jeder Benutzer. Wird es aus Versehen ausgelöst, klingelt es nur einmal.

## K7 · Rad oder Bahn?

**Szene:** Mo 7:05: *„Rad heute: ja · 11 °C, trocken bis 18 Uhr · hin 12 km/h Gegenwind, zurück Rückenwind“*. Oder Mi: *„Lieber Bahn: ab 16:30 Regen (80 %), Böen 50 km/h auf dem Rückweg“*.
**Nutzen:** Die Entscheidung, die man morgens sonst aus drei Apps zusammensucht. Neu ist der *Rückweg*: Den vergisst jede Wetter-App.
**Daten:** Open-Meteo stündlich (Niederschlag, Wind, Böen, Richtung) zur Hin- und Rückfahrzeit. Die Fahrtrichtung berechnet sich aus Wohnung → Arbeit (config.js).
**Hardware:** keine. **Aufwand:** S.
**Risiken:** Nur sinnvoll, wenn du Rad fährst (FRAGEN 25). Grenzwerte (Regen ≥ 50 %, Böen ≥ 45 km/h) stehen sichtbar dabei und lassen sich in config.js ändern.

## K8 · Grünstrom-Ampel

**Szene:** Sa 12:10, kleiner Chip: *„Strom gerade grün (78 %) – gut für Waschmaschine/Spülmaschine · heute Abend nur 32 %“*.
**Nutzen:** Strom wird gezielt dann verbraucht, wenn er sauber ist. Mit einem dynamischen Tarif ist er dann auch billiger.
**Daten:** GrünstromIndex (Corrently) für deine PLZ: CORS `*`, funktioniert heute ohne Schlüssel, die Antwort warnt aber „Deprecation of usage without token“. Lizenz CC BY-NC-SA, Daten werden 4 h zwischengespeichert. Dauerhaft deshalb über einen kostenlosen Token **in HA** (REST-Sensor, Token in `secrets.yaml`, nie ins Repo). Alternative: aWATTar-Börsenpreis (schlüsselfrei, CORS ok), aber nur nützlich mit dynamischem Tarif.
**Hardware:** keine. **Aufwand:** S.
**Risiken:** Ohne Waschmaschinen-Sensor ist es nur ein Hinweis. Bei festem Tarif spart es kein Geld.

## K9 · Gute-Nacht-Check vor „Bett Fertig“

**Szene:** So 22:45, du tippst „Gute Nacht“. Bevor die Tafel dunkel wird, zeigt sie 8 s lang eine Liste: *„Büro: 2 Lampen noch an [aus] · Morgen: Papiertonne rausstellen · iPhone 18 % – ans Ladekabel · Morgen erste Bahn 7:35, Wecklicht 6:50 ✓“*. Danach dunkelt sie ab.
**Nutzen:** Die kleinen Sachen, die man morgens bereut, sieht man abends noch einmal.
**Daten/HA:** Lichter kommen aus HA, Müll aus der Tafel, der Akku vom iPhone-Sensor der HA-App (`sensor.<iphone>_battery_level`, muss evtl. in der App aktiviert werden), das Wecklicht aus K1.
**Hardware:** keine. **Aufwand:** S.
**Risiken:** Die Liste darf nicht lang werden. Höchstens 4 Zeilen, nur was zählt, sonst „Alles erledigt ✓“.

## K10 · Schlaf-Fokus schaltet die Tafel

**Szene:** 23:10, du schaltest am iPhone den Fokus „Schlafen“ ein. Die Tafel geht sofort in den Nachtmodus statt erst um 23:30. Morgens mit dem Ende des Fokus wacht sie auf.
**Nutzen:** Die Tafel folgt deinem echten Tagesablauf statt einer festen Uhrzeit.
**Daten/HA:** `binary_sensor.<iphone>_focus` der HA-App (ab iOS-App 2021.10). Sie meldet nur *an/aus*, nicht welcher Fokus. Deshalb gilt der Fokus nur ab 21 Uhr als Schlaf.
**Hardware:** keine. **Aufwand:** S.
**Risiken:** Der Sensor muss in der HA-App eingeschaltet sein. Ein „Arbeiten“-Fokus am Abend würde ebenfalls dimmen, also abschaltbar.

## K11 · Einkaufsliste per Siri und beim Gehen aufs iPhone

**Szene:** Beim Kochen: *„Hey Siri, Einkaufsliste Milch.“* Die Tafel zeigt sofort „Milch“ mit dem kleinen Vermerk „per Siri 18:42“. Beim Scan des Tür-Tags (K2) fragt sie: *„3 Dinge auf der Liste – aufs iPhone?“*
**Nutzen:** Die Liste wird gepflegt, ohne dass man zur Tafel gehen muss, und ist unterwegs dabei.
**Daten/HA:** Ein Kurzbefehl („Zur Einkaufsliste“) ruft über die HA-App `todo.add_item` auf. Die Tafel zeigt `todo.*` schon live. Fürs iPhone `notify.send_message`.
**Hardware:** keine. **Aufwand:** S.
**Risiken:** Siri erkennt Wörter manchmal falsch, dann einfach auf der Tafel abhaken.

## K12 · Geburtstage aus dem Kalender

**Szene:** Do: *„So: Mama wird 60 – Karte schon da?“*. Am Tag selbst steht oben ein ruhiger Gruß-Streifen.
**Nutzen:** Kein vergessener Geburtstag mehr.
**Daten:** Der Geburtstagskalender von iCloud als zweite ICS-Adresse über den Kalender-Worker. Das braucht eine Worker-Änderung, Schnipsel folgt nach deinem OK.
**Hardware:** keine. **Aufwand:** S.
**Risiken:** Private Daten im Worker, nur Name und Datum werden gebraucht. Fehlt das Geburtsjahr, steht „Geburtstag“ statt „wird 60“.

## K13 · Gäste-Modus mit WLAN-QR-Code

**Szene:** Besuch kommt. Lange auf den Haus-Knopf drücken → **[Gäste]**. Die Tafel zeigt einen großen QR-Code „Gäste-WLAN“. Das Handy des Besuchs hält drauf und ist drin.
**Nutzen:** Kein Passwort mehr diktieren.
**Daten/HA:** Die FRITZ!Box-Tools-Integration liefert eine Bild-Entität mit dem QR-Code des Gäste-WLANs und einen Schalter, um es einzuschalten. Die Tafel zeigt das Bild über `/api/image_proxy`. Das Passwort kommt so **nie** in die Tafel.
**Hardware:** FRITZ!Box mit Gäste-WLAN (falls vorhanden, sonst ein anderer Router mit HA-Integration). **Aufwand:** S.
**Risiken:** Die Integration muss eingerichtet sein. Die Tafel ist für alle im Raum sichtbar, das ist hier aber gewollt.

## K14 · Internet-Störung & Anwesenheit über die FRITZ!Box

**Szene:** *„Internet weg seit 10:42 – Tafel zeigt den letzten Stand“* statt still veralteter Abfahrten. Abends ist ein fremdes Handy im WLAN → Besuch ist da, die Tafel begrüßt ihn nicht mit deinem Morgengruß.
**Daten/HA:** FRITZ!Box Tools: `binary_sensor` „Connection“, Durchsatz-Sensoren, `device_tracker` für Netzwerkgeräte (Option „network device tracking“).
**Hardware:** FRITZ!Box. **Aufwand:** M.
**Risiken:** Geräteliste und Datenschutz bei Gästen. Nur ausgewählte Geräte verfolgen.

## K15 · Haushalts-Erinnerungen als Ein-Tipp-Chips

**Szene:** *„Monstera gießen – zuletzt vor 8 Tagen [erledigt]“* oder *„Bettwäsche wechseln – 14 Tage“*. Ein Tipp setzt den Zähler zurück.
**Daten/HA:** Je Aufgabe ein HA-Helfer `input_datetime` (zuletzt erledigt) plus Intervall in config.js. Alternative: „Local To-do“ in HA, das Fälligkeitsdaten kann (die Einkaufsliste kann das nicht).
**Hardware:** optional ein Pflanzensensor per Bluetooth (~15 €) + ESP32-Bluetooth-Proxy (~10 €), dann gießt man nach Feuchte statt nach Kalender.
**Aufwand:** S–M.
**Risiken:** Zu viele Chips nerven, höchstens einer gleichzeitig, nur wenn fällig.

## K16 · Wochenrückblick am Sonntagabend

**Szene:** So 19:00, eine Karte: *„Deine Woche: 4× vor 7:40 aus dem Haus · Licht im Büro 26 h · Bad nach dem Duschen im Schnitt in 35 Min trocken (Vorwoche 50) · Werder 2:1 gegen Paderborn“*.
**Daten/HA:** HA-Verlauf (wird für das Lernen schon gelesen), Tür-Tag-Scans, Fußball.
**Hardware:** keine. **Aufwand:** M.
**Risiken:** Schnell belanglos. Es kommen nur Zahlen hinein, die sich gegen die Vorwoche verändert haben, sonst fällt die Karte weg.

## K17 · Fotorahmen am Abend

**Szene:** Ab 20 Uhr, wenn 10 min niemand tippt und du zu Hause bist, zeigt die Tafel statt der Uhr-Ansicht langsam wechselnde Fotos aus einem HA-Medienordner, mit kleiner Uhr und nächster Bahn in der Ecke.
**Daten/HA:** `media_source` (Ordner `/media/tafel`, nur Bilder ≤ 1024 px wegen 1 GB RAM).
**Hardware:** keine. **Aufwand:** M.
**Risiken:** Die Fotos hängen privat an der Wand, deshalb nur ein eigener Ordner. Speicher: immer nur ein Bild geladen.

## K18 · Licht folgt dem Tag

**Szene:** Das Licht im Wohnzimmer wird abends von selbst wärmer: 20 Uhr „Entspannen“, 22 Uhr „Gedimmt“, aber nur Lampen, die ohnehin an sind. Auf der Tafel steht im Raum „Natürliches Licht · jetzt Entspannen“.
**Daten/HA:** Die neuen Szenen (Sitzung 7) + eine HA-Automation nach dem Hue-Plan (7 Energie tanken · 10 Konzentrieren · Sonnenuntergang Lesen · 20 Entspannen · 22 Ausruhen · 0 Nachtlicht).
**Hardware:** keine. **Aufwand:** M.
**Risiken:** Automatisches Umschalten kann stören, etwa beim Lesen um 22 Uhr. Deshalb: Hast du in den letzten 30 min selbst geschaltet, bleibt es.

## K19 · Paket-Ankündigung (nur Konzept)

**Szene:** *„DHL kommt heute 10–13 Uhr (2 Pakete)“*.
**Daten:** Die DHL-API braucht einen Schlüssel (250 Abrufe/Tag). Im Browser wäre er öffentlich, deshalb ginge es nur über HA. Alternative: HACS „Mail and Packages“ liest die Ankündigungsmails per IMAP.
**Aufwand:** L. **Risiken:** Mail-Zugang in HA, fremde Integration ohne Gewähr. Erst nach deinem OK.

## K20 · Hardware, die sich lohnen würde

| Gerät | Preis | Was die Tafel dann kann |
|---|---|---|
| **IKEA MYGGBETT** Tür-/Fensterkontakt, Matter über Thread (HomePod mini = Thread-Border-Router) – Schlafzimmerfenster | 7,99 € + AAA-Akku | „Fenster seit 25 min offen, Bad trocken – zu machen“, Lüftungs-Erinnerung mit echtem Fensterzustand statt Schätzung |
| **IKEA MYGGBETT** an der Wohnungstür | 7,99 € | „Ich geh raus“ ohne Scannen: Tür auf + Bewegung im Schlafzimmer ist vorbei → Tür-Check (K2) erscheint von selbst |
| **Zweiter HomePod mini** im Schlafzimmer | ~99 € | K4 Ansage dort, wo du aufwachst. Zusätzlich Thread-Redundanz |
| **Heizkörperthermostat** mit Matter (z. B. Eve Thermo) | ~70 € je Raum | Heizung aus, wenn das Fenster offen ist, Heizplan nach Bahn/Urlaub. Das Klima-Panel kann Thermostate schon (im Simulator mit `--extras` gezeigt) |

---

## Prototypen: wo du sie siehst
Die drei Prototypen stehen in `config.js` (standardmäßig **aus**), sind gegen den Simulator geprüft und in **MORGEN.html, Abschnitt „Konzepte für Erweiterungen“** mit Bildern bzw. Video zu sehen. Dort steht auch, was du in HA anlegen müsstest, falls du einen davon willst.

## Nachweise
- HA-Tags als Entitäten (Zustand = letzter Scan) seit 2024.6: https://www.home-assistant.io/blog/2024/06/05/release-20246/. `tag_scanned` ist für Nicht-Admins gesperrt: https://github.com/home-assistant/core/blob/dev/homeassistant/auth/permissions/events.py
- Übergänge bis 6553 s: https://github.com/home-assistant/core/blob/dev/homeassistant/components/light/const.py
- Kritische Hinweise (nur `notify.mobile_app_*`): https://companion.home-assistant.io/docs/notifications/critical-notifications
- Fokus-Sensor: https://companion.home-assistant.io/docs/core/sensors
- HomePod über apple_tv (RAOP-Streaming, Grenzen): https://www.home-assistant.io/integrations/apple_tv/ · https://pyatv.dev/documentation/supported_features/
- FRITZ!Box Tools (Gäste-WLAN-QR als Bild, Verbindungssensor): https://www.home-assistant.io/integrations/fritz/
- Local To-do mit Fälligkeitsdatum: https://www.home-assistant.io/integrations/local_todo/
- IKEA MYGGBETT 7,99 €: https://www.ikea.com/de/de/p/myggbett-tuer-fenstersensor-smart-00603864/
- GrünstromIndex (Fair Use, Token empfohlen): https://corrently.io/books/stromdao-gmbh/page/fair-use-policy
- DHL-API braucht Schlüssel: https://developer.dhl.com/api-reference/shipment-tracking
