# IDEEN – SmartTafel, Panel für Panel (Bestandsaufnahme 10.10.2026)

> **Stand 10.10.2026, 03:00:** ✅ = umgesetzt (Commit in Klammern), Vorher/Nachher in MORGEN.html. Geschmacksfragen sind als Varianten gebaut und in FRAGEN.md zur Wahl gestellt. Alle Ideen sind umgesetzt.
> **Nachtrag 07:00 (Sitzung 3):** zweiter kritischer Durchgang mit echten Samstags- und simulierten Montagsdaten → Abschnitt „17. Zweiter Durchgang“ am Ende, ebenfalls alles umgesetzt.

Grundlage sind die Screenshots in `belege/vorher/` (Playwright-WebKit, 1024×768, Touch, iPad-Safari-12-Kennung, `?jetzt=2026-10-10T14:00`, Live-Daten, Termine mit Attrappen-Daten). Alle Maße sind CSS-px, gemessen im DOM. Farbnamen `--c-…`, `--f-…`, `--s-…`, `--r-…` stammen aus `design.css`.

**Maßstab „3–4 m“:** Auf dem iPad Air ist 1 CSS-px ≈ 0,19 mm. Eine Fern-Info braucht auf 3,5 m etwa 7–8 mm Versalhöhe (≈ 2× Sehschärfegrenze). Daraus folgt:
- **Fern-Info ≥ 56–60 px** (`--f-xxl`). Pro Panel genau eine: Minuten, Temperatur, Uhrzeit, Hinweis.
- **Nah-Info ≥ 20 px** (`--f-m`), sie ist für 1–2 m gedacht.
- **Nichts unter 16 px** (`--f-s`).
- Text braucht mindestens 7:1 Kontrast. Das heutige Grau `#767267` auf `#f4f2ee` erreicht nur **4,3:1**.

`→ Varianten zeigen` = braucht eine Geschmacksentscheidung von Julian, also 2–3 Varianten nebeneinander bauen und in FRAGEN.md zur Wahl stellen.

---

## 0. Rahmen (gilt für alle Panels)

✅ **R1 – Farbwelt dunkel statt beige** · L · Prio 1 · → Varianten zeigen · umgesetzt (7494901)
- *Stört:* Grund `#f4f2ee` mit weißen Karten `rgba(255,255,255,.86)`. Abends ist die Tafel die hellste Fläche im Raum. Nebentexte `#767267` haben nur 4,3–4,7:1 (z. B. „Los bis 14:00“ in `01-abfahrten.png`, „mit Auto zu …“ in `02-arbeitsweg.png`). Wetter, Fußball und Nachrichten sind schon dunkel, der Rest hell, deshalb wechselt die Helligkeit im Karussell ständig (`03-wetter.png` ↔ `05-musik.png`).
- *Ändert sich:*
  - Grund `--c-bg #0d1219`, Karten `--c-surface #18212d` ohne Schatten, mit 1 px `--c-line`.
  - Haupttext `--c-text #efe9df` (15,6:1), Nebentext `--c-text-2 #b8b0a3` (7,5:1).
  - Akzent `--c-accent #e2a65a` ersetzt Messing `#a9793f`.
  - Alle Zahlen in IBM Plex Mono mit `font-variant-numeric: tabular-nums`.
- *Warum:* Ein Look für alle Panels, doppelter Kontrast, kein Helligkeitsflackern beim Panelwechsel.
- *Varianten:* (a) immer dunkel, (b) tagsüber `--c-surface-3`-Grau, ab Sonnenuntergang dunkel.

✅ **R2 – Kopfzeile/Uhr** · S · Prio 1 · umgesetzt (b846c96)
- *Stört:* Uhr 30 px (`.clock-time`, Versalhöhe ≈ 4 mm), Datum 14 px `#767267`. Beides sitzt in einer weißen Pille 385×58 px, die über den Panel-Inhalten schwebt und in News/Fußball das Foto überdeckt (`04-nachrichten.png`, `06-fussball.png`). Die Knöpfe ▦/📻 sind 44×44 px (unter Touch-Maß `--touch` 56 px); 📻 ist ein buntes Emoji.
- *Ändert sich:*
  - Pille entfällt.
  - Uhr 56 px Mono `--c-text` oben rechts (x 800–1000, y 16–72), Datum 20 px `--c-text-2` links daneben.
  - Knöpfe 56×56 px mit einfarbigen SVG-Icons (Raster, Radio) in `--c-text-2`.
- *Warum:* Die Uhr ist der häufigste Blick und wird von 4 auf 7,5 mm Versalhöhe lesbar.

✅ **R3 – Einheitliche Kopfzeile je Panel** · M · Prio 2 · umgesetzt (b846c96)
- *Stört:* Panel-Titel (`.view-label` 14 px, Großbuchstaben, `#767267`) stehen je Panel woanders: y 88 (Musik), y 32 auf dem Himmel (Wetter), y 26 in einem beigen Streifen über dem Foto (Nachrichten, Fußball). Bei Abfahrten fehlt der Titel ganz. Bei Rätsel und Auf-den-Tag steht er doppelt (Titel + Kicker in der Karte, `10-raetsel.png`).
- *Ändert sich:*
  - Eine Kopfzeile y 16–72: links Titel 20 px 600 `--c-text-2` mit 8-px-Punkt in Panel-Akzentfarbe, rechts die Uhr (R2).
  - Inhalt immer ab y 88, endet bei y 712 (darunter die Hinweiszeile R5).
  - Doppelte Kicker entfallen.
- *Warum:* Gleiches Raster überall. Man weiß sofort, wo man hinsehen muss.

✅ **R4 – Fortschrittsbalken** · S · Prio 3 · umgesetzt (50952df)
- *Stört:* 4 px Messing auf einer beigen Spur ganz oben (`progress-bar`). Auf dunklen Panels sieht man eine helle Linie über die volle Breite (`03-wetter.png` oben).
- *Ändert sich:* 3 px `--c-accent` mit 50 % Deckkraft, keine Spur, am unteren Rand (y 765). In den letzten 3 s steht rechts unten „Als Nächstes: Wetter“ (14 px `--c-text-3`).
- *Warum:* Ruhiger. Der Wechsel kommt nicht überraschend.

✅ **R5 – Hinweiszeile statt Müll-Chip** · M · Prio 1 · umgesetzt (3a55786)
- *Stört:* Der Müll-Chip (13 px, 254×34 px, unten links) überdeckt Inhalte:
  - Wetter-Chips „Gefühlt“ und „Wind“ (`03-wetter.png`, y 698–746),
  - Artikeltext und Punkte-Navigation (`04-nachrichten.png`),
  - die Kartenecke bei Spruch, Trivia, Quiz und Rätsel.
  Außerdem erscheint er schon am Samstag für Mittwoch („Mi. 14.10.: Restmüll & Bioabfall“).
- *Ändert sich:*
  - Feste Zeile y 720–768 (48 px) über die volle Breite. Alle Panels reservieren unten 56 px (`.panel-view` padding-bottom 20 → 64 px).
  - Inhalt nach Priorität: DWD-Warnung > HA-Hinweise (Fenster offen, Waschmaschine fertig) > Müll > nichts.
  - Text 20 px auf `--c-surface-2`, Warnfarben `--c-warn`/`--c-alert` als 6 px Streifen links.
  - Müll nur am Vortag ab 16 Uhr („Morgen: Restmüll & Bio – heute Abend rausstellen“) und am Abholtag bis 9 Uhr.
- *Warum:* Nichts wird mehr verdeckt. Ein Ort für alle Hinweise (deckt AUSBAU B9, D16, D17).

✅ **R6 – Panel-Wechsel** · S · Prio 3 · umgesetzt (3ba5674)
- *Stört:* 0,7 s Crossfade ohne Bewegung. In den Wetter-, News- und Fußball-Panels blendet ein Vollbild-Hintergrund über einen beigen.
- *Ändert sich:* Neues Panel `opacity 0→1` + `translateY(8px→0)` in 450 ms `--ease`, altes nur `opacity`. Bei R1 entfällt der Hell/Dunkel-Sprung.
- *Warum:* AUSBAU 4 „Panel-Wechsel“, überall gleich.

---

## 1. Abfahrten (`01-abfahrten.png`, `16-morgen-abfahrten.png`, `15-nacht-abfahrten.png`)

✅ **A1 – Minuten als Fern-Info, echte Linienfarben** · M · Prio 1 · umgesetzt (fced19c)
- *Stört:*
  - Minuten „8 min“ sind 30 px (`.time-min`), kleiner gewichtet als das Ziel (26 px 600).
  - Linien-Badges 74×46 px in fast gleichen Pastelltönen (Bus `#eaf2f5→#d2e0e6`, Tram `#f4e9d8→#e6d3ab`). 41, 2, 740 und 10 unterscheiden sich nur durch die Zahl.
  - Spaltenkopf „ABFAHRT“ (x 848) steht nicht über den rechtsbündigen Minuten (x 886–976).
  - Pünktliche Uhrzeit 14 px grün `#3f7d52` (4,8:1). Grün für „pünktlich“ ist Rauschen.
  - Unten bleiben 80 px leer (y 640–720), es gibt nur 4 Zeilen.
- *Ändert sich:*
  - Zeile 104 px, **5 Zeilen** (`maxRows` 4 → 5), Spaltenkopf entfällt.
  - Badge 88×56 px, Hintergrund = `routeColor`/`routeTextColor` aus Transitous (liefert für Trams echte BSAG-Farben, z. B. 2E `#005ca9`, N10 `#009fe3`). Busse ohne Farbe bekommen `--c-surface-3` + `--c-text`.
  - Minuten 60 px Mono tabular `--c-text`, „min“ 24 px `--c-text-2`.
  - Darunter Uhrzeit 18 px `--c-text-2`. Verspätung nur, wenn ≠ 0: geplante Zeit durchgestrichen + „+3“ in `--c-warn`.
  - Ziel 32 px.
- *Warum:* Die eine Zahl, die man aus 3 m wissen will, wird doppelt so groß. Linien erkennt man an der Farbe, ohne zu lesen.

✅ **A2 – Dringlichkeit in der Zeile statt Banner + 4-px-Rand** · M · Prio 1 · → Varianten zeigen · umgesetzt (fced19c)
- *Stört:* Das Banner „Geh jetzt los!“ (26 px braun auf `rgba(169,121,63,.14)`, 92 px hoch) wiederholt die erste Zeile. Die Dringlichkeit je Zeile ist nur ein 4 px breiter Rand links (rot/orange/grün) und „Los bis 14:00“ 13 px.
- *Ändert sich:* Banner entfällt (+92 px Platz). Die erreichbare nächste Abfahrt bekommt `--c-surface-2` + 2 px Rand `--c-accent` und eine Pille vor den Minuten (20 px 700):
  - „LOS!“ (`--c-alert`)
  - „in 3 min los“ (`--c-warn`)
  - keine Pille bei genug Zeit
  Nicht mehr erreichbare Abfahrten bekommen 50 % Deckkraft. Regen-Hinweis „☔ Schirm“ als Pille daneben.
- *Varianten:* (a) Banner behalten, aber 44 px hoch und 28 px Schrift, (b) Pille in der Zeile wie oben.
- *Warum:* Handlungsaufforderung und Bahn stehen an einer Stelle statt an zweien.

✅ **A3 – „Zur Arbeit“-Markierung morgens** · S · Prio 2 · umgesetzt (50952df)
- *Stört:* Um 07:20 (`16-morgen-abfahrten.png`) sieht man nicht, welche Linie zur Arbeit fährt. Das weiß nur das Arbeitsweg-Panel (`itineraryLineNames`).
- *Ändert sich:* Mo–Fr 6–9 Uhr bekommen Zeilen, deren Linie in der ÖPNV-Route vorkommt, ein Aktentaschen-Icon 24 px + „Arbeit an 07:52“ 18 px `--c-accent-2` unter dem Ziel.
- *Warum:* Morgens ist das die einzige Frage, die man an die Tafel hat.

✅ **A4 – Abfahrten-Animation** · M · Prio 2 – wie AUSBAU 4: abgefahrene Zeile gleitet nach oben raus (FLIP), Minutenziffer rollt nur bei Änderung. · umgesetzt (fced19c)

---

## 2. Arbeitsweg (`02-arbeitsweg.png`)

✅ **AW1 – Lesbare Zeiten, ehrliche Balken** · M · Prio 2 · umgesetzt (7e618d9)
- *Stört:*
  - Beim ÖPNV-Balken steht „56 min“ in `#767267` auf dem gefüllten Balken `#5b6b78`: **Kontrast 1,15:1, unsichtbar**.
  - Der langsamste Weg hat den vollen, dunkelsten Balken und wirkt optisch am stärksten.
  - Zeiten nur 12 px (`.commute-race-time`).
  - Unten 150 px leer (y 610–720), die Karte ist ausgeblendet.
  - „Linie 3/26 · ab 04:55“ zur Prognose „Mo, 07:30“ bei 56 min Fahrt ist unplausibel (Logik in `renderCommuteRace`/`itineraryFirstDeparture` prüfen).
- *Ändert sich:*
  - Zeit-Label außerhalb des Balkens in einer eigenen Spalte rechts (90 px breit, 28 px Mono `--c-text`).
  - Balken 22 → 12 px. Gewinner in Modusfarbe, die anderen `--c-off #3a4657`.
  - Hero: Fern-Info „Los um 07:02“ 60 px statt Dauer, darunter „6 min mit dem Auto · Ankunft 07:30“ 24 px.
- *Warum:* Man liest die Handlung („wann los“), nicht eine Rechengröße.

✅ **AW2 – Am Wochenende/Feiertag aus der Rotation** · S · Prio 2 · umgesetzt (7e618d9)
- *Stört:* Am Samstag 14:00 zeigt das Panel eine Prognose für Montag 07:30 (12 px Hinweis). Aus 3 m wirkt „6 Min“ wie eine aktuelle Info.
- *Ändert sich:* `PANEL_AVAILABILITY.commute` ist Sa/So/Feiertag (D19) false, Fr ab 18 Uhr als „Montag früh“-Vorschau nur im Abend-Überblick (D22).
- *Warum:* Keine irreführende Information.

---

## 3. Wetter (`03-wetter.png`, `17-morgen-wetter.png`)

✅ **W1 – Die leere Mitte mit dem Tagesverlauf füllen** · M–L · Prio 1 · → Varianten zeigen · umgesetzt (6813a8d)
- *Stört:*
  - Zwischen y 180 und 480 (300 px, 40 % der Fläche) sind nur Himmel, Regenstriche und Skyline zu sehen.
  - Die 5 Stundenkarten (186×126 px) haben Uhrzeit 14 px, Temperatur 20 px und ein Icon ≈ 24 px, aus 3 m nicht lesbar. Kein Regen-% je Stunde.
- *Ändert sich:* In y 200–470 eine 12-h-Kurve:
  - Temperatur als SVG-Polyline 3 px `--c-text`,
  - Regenwahrscheinlichkeit als Säulen `--c-cool` mit 60 % Deckkraft (Höhe = %),
  - Beschriftung alle 3 h: Uhrzeit 18 px `--c-text-2`, Temperatur 24 px Mono.
  Die Stundenkarten entfallen.
- *Varianten:* (a) Kurve, (b) 8 Stundenspalten à 120 px mit Temperatur 28 px + Regen-% 20 px.
- *Warum:* Gerade der wichtigste Teil („wird es nachher nass?“) ist heute der kleinste.

✅ **W2 – Kopfbereich größer, Tipp nach oben** · S · Prio 1 · umgesetzt (f0329df)
- *Stört:* Temperatur 88 px ist gut. Aber „Schauer“ hat 28 px, „H: 14° T: 9°“ 16 px. Der Handlungstipp „Gegen 15:00 Uhr wird's nass — Regenschirm einpacken“ (15 px) steht unten im Sheet.
- *Ändert sich:* Temperatur 120 px, Beschreibung 40 px, H/T 24 px. Tipp als Zeile 28 px `--c-warn` direkt unter der Beschreibung (y ≈ 190).
- *Warum:* Der Tipp ist die eigentliche Botschaft.

✅ **W3 – Detail-Chips** · S · Prio 2 · umgesetzt (f0329df)
- *Stört:* 6 Chips, Wert 15 px, Label 11 px `rgba(255,255,255,.7)`. „Gefühlt“ und „Wind“ werden vom Müll-Chip verdeckt. Aufgang **und** Untergang stehen immer da.
- *Ändert sich:* 4 Chips (Gefühlt, Wind, Regen, dazu je nach Tageszeit *nur* der nächste Sonnen-Wechsel). Wert 24 px, Label 14 px `--c-text-2`. Abstand zur Hinweiszeile 16 px.
- *Warum:* Weniger, aber lesbar.

*Prüf-Hinweis:* Mit `?jetzt=` bleiben „aktuell“ (Temperatur, Tag/Nacht-Szene) echte Werte von Open-Meteo. Darum zeigt das 14:00-Bild eine Nachtszene und das 07:20-Bild 14° neben „08 Uhr 7°“. Das ist ein Artefakt des Prüfwerkzeugs, kein Fehler der Tafel.

---

## 4. Nachrichten (`04-nachrichten.png`)

✅ **N1 – Überschrift + Teaser statt Volltext über dem Foto** · M · Prio 1 · → Varianten zeigen · umgesetzt (83904c2)
- *Stört:*
  - Der ganze Artikeltext (17 px weiß, Textblock 958×1932 px) liegt direkt auf dem Foto, läuft unten über den Bildschirmrand hinaus und wird abgeschnitten.
  - Auf hellen Bildstellen (Mitte) ist er trotz Textschatten kaum lesbar.
  - „BREMEN“ steht doppelt (Badge 12 px + Kicker).
  - Überschrift nur 27 px.
  - Die Uhr-Pille überdeckt das Foto.
- *Ändert sich:*
  - Foto rechts 440×624 px (`object-fit: cover`, `--r-l`).
  - Links auf `--c-bg`: Kicker 16 px `--c-accent`, Überschrift 40 px 700 (max. 4 Zeilen per `-webkit-line-clamp`, das kann Safari 12), Teaser 22 px `--c-text-2` (max. 5 Zeilen).
  - Artikeltext entfällt.
  - Fortschritt „3 / 12“ 16 px + 3-px-Balken statt 12 Punkte à 6 px.
- *Varianten:* (a) Foto rechts, (b) Foto oben 1024×340 mit Verlauf nach `--c-bg`, Text darunter.
- *Warum:* Eine Meldung muss man in 10 s erfassen können. Einen Volltext liest an der Wand niemand.

---

## 5. Musik-Charts (`05-musik.png`)

✅ **M1 – Zwei Spalten, Top 10** · M · Prio 3 · umgesetzt (fb42122)
- *Stört:*
  - In jeder Karte sind rechts 60–65 % leer (Nr. 1: Text endet bei x 334, Karte bei x 1000).
  - Nur 5 Plätze, unten 150 px leer.
  - Rang „2.“ 22 px grau, Künstler 15 px `#767267`.
- *Ändert sich:*
  - Links Nr. 1: Cover 300×300 px, Titel 36 px, Künstler 22 px `--c-text-2`, „Nr. 1“-Pille `--c-accent`.
  - Rechts Plätze 2–10 als Liste: Zeile 60 px, Rang 24 px Mono `--c-text-3`, Cover 44 px, Titel 20 px, Künstler 16 px.
  - Neu/aufgestiegen-Pfeil ▲▼ per Vergleich mit dem Vortag in `localStorage` (Apple-RSS liefert keine Vorwoche).
- *Warum:* Doppelt so viel Inhalt bei gleicher Fläche, keine leeren Karten.

---

## 6. Fußball (`06-fussball.png`)

✅ **F1 – „Nächstes Spiel“ zeigt ein vergangenes Spiel (Fehler)** · S · Prio 1 · umgesetzt (4541cbb)
- *Stört:* Am Sa 10.10. 14:00 steht „NÄCHSTES SPIEL · Dortmund – Bremen · Fr. 09.10., 20:30 Uhr“. Das Spiel ist vorbei, aber OpenLigaDB meldet `matchIsFinished` noch als false. `fetchTeamMatches` nimmt einfach das erste nicht beendete Spiel.
- *Ändert sich:* Liegt der Anstoß mehr als 2 h 15 min zurück und ist das Spiel nicht beendet, steht dort „Ergebnis folgt“ mit dem Stand aus `matchResults`, falls vorhanden. Sonst kommt das Spiel unter „Letztes Ergebnis“.
- *Warum:* Falsche Aussage auf der Tafel.

✅ **F2 – Countdown und Größe** · S · Prio 2 · umgesetzt (3a09409)
- *Stört:* Datum 15 px `rgba(255,255,255,.7)`, Liga 14 px, „VS“ 20 px mit 50 % Deckkraft. Die Wappen stehen in sichtbaren dunklen 96×96-Kacheln (Werder rechts). Die Bildmitte ist leer.
- *Ändert sich:*
  - Relativ-Angabe als Fern-Info: „Morgen 15:30“ / „in 3 Tagen“ 48 px.
  - Wappen 160 px ohne Kachel-Hintergrund.
  - Bei Ergebnis: Score 96 px Mono, Sieg/Niederlage als 6-px-Streifen `--c-ok`/`--c-alert`.
  - Unten Tabellenplatz „Werder: Platz 9 · 7 Pkt.“ 24 px (OpenLigaDB `getbltable`).
- *Warum:* Die Frage „wann spielt Werder?“ ist aus 3 m beantwortet.

---

## 7. Spruch des Tages (`07-spruch.png`)

✅ **S1 – Deutsch, groß, vollständig** · S (Layout) / M (Inhalt) · Prio 2 · → Varianten zeigen · umgesetzt (8433ce6)
- *Stört:*
  - Englischer Spruch mit Tippfehler aus der Quelle („Make choices and dont look back.“) auf einer deutschen Tafel.
  - 34 px Text in einer 976×637-px-Karte, etwa 85 % leer.
  - Das schließende Deko-Anführungszeichen unten rechts ist am Kartenrand abgeschnitten (y 708–748).
  - Der Müll-Chip überdeckt die Kartenecke.
- *Ändert sich:*
  - Inhalt: lokale deutsche Liste (365 Sprüche mit Autor, eigene Datei `sprueche.js`) statt Advice Slip.
  - Spruch 52 px, max. 820 px breit, vertikal zentriert, Autor 22 px `--c-text-2`.
  - Anführungszeichen 90 px vollständig in der Karte (bottom 32 px).
- *Varianten:* (a) Inter 52 px 600, (b) Georgia 52 px kursiv.
- *Warum:* Lesbar, auf Deutsch, kein abgeschnittener Schmuck.

---

## 8. Auf den Tag genau (`08-auf-den-tag.png`)

✅ **T1 – Mitraten mit sichtbarer Auflösung** · S · Prio 2 · umgesetzt (1d4d4a0)
- *Stört:*
  - Die Pille „Antwort antippen zum Mitraten“ steht noch da, obwohl 1970 schon grün aufgedeckt ist.
  - Falsche Jahre haben 40 % Deckkraft (Kontrast ≈ 2,1:1).
  - Über der Frage sind 200 px leer.
  - Die Auflösung kommt ohne Vorwarnung nach der halben Panel-Dauer.
- *Ändert sich:*
  - Frage 30 → 36 px.
  - Jahres-Knöpfe 120×72 px, 32 px Mono.
  - Über den Knöpfen ein 3-px-Countdown-Balken (`scaleX`) bis zur Auflösung.
  - Die Pille verschwindet bei der Auflösung.
  - Danach: richtige Zahl auf `--c-ok`, falsche `--c-text-3` auf `--c-surface` (4,5:1), dazu „vor 56 Jahren“ 22 px.
- *Warum:* Man sieht, dass gleich aufgelöst wird. Das Ergebnis bleibt lesbar.

## 9. Allgemeinwissen (`09-allgemeinwissen.png`)

✅ **Q1 – Themen und Sprache** · S · Prio 2 · → Julian fragen · umgesetzt (1d4d4a0)
- *Stört:*
  - Englische Nischenfragen aus der Open Trivia DB („In "JoJo's Bizarre Adventure" …“, Kategorie „Entertainment: Japanese Anime & Manga“).
  - Antwort-Chips 17 px.
  - Bei mehreren Ladevorgängen kurz hintereinander antwortet opentdb.com mit **HTTP 429** (beobachtet).
- *Ändert sich:*
  - Abruf mit `&category=` nur aus Allgemeinwissen (9), Geografie (22), Natur & Wissenschaft (17), Geschichte (23).
  - Chips 22 px, min. 64 px hoch.
  - Frage an Julian in FRAGEN.md: „Englisch ok oder lokale deutsche Fragenliste?“
- *Warum:* Allgemeinwissen statt Anime-Spezialwissen.

## 10. Rätsel des Tages (`10-raetsel.png`)

✅ **RÄ1 – Lösung ankündigen** · S · Prio 3 · umgesetzt (1d4d4a0)
- *Stört:* Eine Zeile (30 px) in einer Riesenkarte. Der Kicker „RÄTSEL DES TAGES“ wiederholt den Titel. Die Lösung kommt nach der halben Panel-Dauer ohne Hinweis (nach 12 s im Bild noch nicht da).
- *Ändert sich:* Frage 48 px zentriert. Darunter „Lösung in 10 s“ 20 px mit 48-px-Countdown-Ring, dann Antwort 40 px `--c-accent` (Einblenden 300 ms). Kicker entfällt.
- *Warum:* Spannung mit Ansage statt leerer Fläche.

---

## 11. Veranstaltungen (`11-veranstaltungen.png`)

✅ **V1 – Nach Tagen gruppieren, Uhrzeit vorn** · S · Prio 2 · umgesetzt (1b8fbde)
- *Stört:*
  - Die rosa Datumskachel 60×60 px „10 OKT“ steht 3× hintereinander, „11 OKT“ ebenfalls 3×.
  - Uhrzeit und Ort 14 px `#767267`, Titel 19 px.
  - Kein Hinweis, was heute ist.
  - Orte bis Worpswede (Music Hall Worpswede, ≈ 25 km).
- *Ändert sich:*
  - Zwischenüberschriften „Heute · Samstag“ / „Morgen · Sonntag“ 20 px `--c-accent`.
  - Je Zeile: Uhrzeit 28 px Mono in einer 96-px-Spalte statt Datumskachel, Titel 24 px, Ort 18 px `--c-text-2`.
  - Schon begonnene Termine (Start < jetzt − 30 min) fallen weg.
- *Warum:* Man erfasst „was ist heute Abend“ ohne Datumsrechnen.

## 12. Termine (`12-termine.png`, nur mit Attrappen-Daten, der Kalender-Worker blockt localhost per CORS)

✅ **K1 – Nächster Termin als Hero** · M · Prio 2 · umgesetzt (1b8fbde)
- *Stört:* Termine sehen genau wie Veranstaltungen aus (gleiche rosa Kachel, gleiche Liste). Privat und öffentlich sind nicht unterscheidbar. „Zahnarzt heute 18:30“ ist nicht hervorgehoben. „Ganztägig“ ist nur Text.
- *Ändert sich:*
  - Oben eine Hero-Karte für den nächsten Termin: Titel 36 px, „heute 18:30 · in 4 h 30 min“ 24 px `--c-accent-2`, Ort 18 px.
  - Darunter eine kompakte Liste wie V1.
  - Akzent `--c-accent-2` statt Rosa, „ganztägig“ als Pille.
  - Termine von heute/morgen fließen in den „Heute“-Überblick (D15).
- *Warum:* Der nächste Termin ist die Information. Die Liste ist Beiwerk.

---

## 13. Panel-Übersicht (`13-panel-uebersicht.png`; iPad: `21-ipad-sim-panel-uebersicht.png`)

✅ **Ü1 – Deckend, schließbar, HA zuerst** · S–M · Prio 2 · umgesetzt (cbca80b)
- *Stört:*
  - **iPad:** Das Overlay war nur 756×476 px oben links, ohne Vollbild-Abdunklung (`inset`, inzwischen behoben).
  - Die aktuelle Kachel „Abfahrten“ ist halbtransparent (`rgba(169,121,63,.14)`): „Weserwehr“ und „41“ scheinen durch den Kacheltext.
  - Der Hintergrund `rgba(20,18,14,.55)` lässt die Abfahrten durchscheinen.
  - Emoji-Icons 32 px, kein Schließen-Knopf, letzte Reihe 3 von 4.
- *Ändert sich:*
  - Hintergrund `--c-bg` mit 94 % Deckkraft, Kacheln deckend `--c-surface`.
  - Aktuelle Kachel `--c-surface-2` + 2 px `--c-accent`.
  - Kacheln 220×136 px, einfarbige SVG-Icons 40 px `--c-text-2`.
  - Schließen-Knopf 56×56 oben rechts.
  - Zeile „Karussell pausiert · läuft 10 s nach dem Schließen weiter“ 16 px.
  - HA-Panels (Zuhause, Klima, Medien) als erste Reihe.
- *Warum:* Saubere Lesbarkeit, Bedienung mit dem Finger, klarer Ausgang.

## 14. Radio-Menü (`14-radio-menue.png`)

✅ **RA1 – Zustand sichtbar, mit HA-Medien zusammen** · M · Prio 2 · umgesetzt (f6faab5)
- *Stört:* Ein 240 px breites Menü, das über dem Abfahrts-Banner hängt. Einträge: Name 17 px + grauer 10-px-Punkt. Man sieht nicht, ob und was läuft, und es gibt keine Lautstärke.
- *Ändert sich:*
  - Einträge 64 px hoch.
  - Der laufende Sender bekommt `--c-accent` 14 % als Grund + einen Equalizer aus 3 Balken (`scaleY`, nur während der Wiedergabe).
  - Unten ein Lautstärke-Schieber 280×56 px (eigener Touch-Slider).
  - Mit HA (B8): Zielgerät wählen („Tafel“ / „HomePod Wohnzimmer“).
- *Warum:* Rückmeldung, ob Ton kommt. Weg zu den HA-Medien.

## 15. Nachtdimmung (`15-nacht-abfahrten.png`; iPad: `22-ipad-sim-nacht.png`)

✅ **NA1 – Nachtthema statt grauer Schleier** · M · Prio 2 · → Varianten zeigen · umgesetzt (e6f1b24)
- *Stört:*
  - **iPad:** Das Overlay hatte 0×0 px, nachts blieb die Tafel also voll hell (`inset`, inzwischen behoben).
  - Im Desktop-Bild liegt ein schwarzer Schleier mit 65 % über dem beigen UI. Das ergibt ein schlammiges Grau, die Brauntöne im Banner sind kaum lesbar, und Fotos/Animationen laufen unter dem Schleier weiter.
- *Ändert sich:*
  - Klasse `is-night` am `body` setzt die Tokens auf Grund `#000` und Text `#8a6d4a` (gedimmtes Bernstein).
  - Sichtbar bleiben nur Uhr 120 px + die nächsten 2 Abfahrten 40 px.
  - Keine Fotos, keine Animationen.
  - Das Overlay bleibt nur für den Tiefschlaf (0,94).
- *Varianten:* Bernstein `#8a6d4a` vs. kühles Grau `#5d6673`.
- *Warum:* Weniger Licht im Raum, trotzdem lesbar, weniger Rechenlast nachts.

## 16. Ambient-Modus (`18-ambient.png`; iPad: `23-ipad-sim-ambient.png`)

✅ **AM1 – Ruhebild mit Nutzen, nur bei echter Abwesenheit** · S · Prio 2 · umgesetzt (558b624)
- *Stört:*
  - **iPad:** Der Uhr-Kasten war nur 520×208 px oben links über der Tafel (`inset`, inzwischen behoben).
  - Er springt nach 60 min ohne Berührung an und stoppt das Karussell (FEEDBACK.md, macht der Hauptagent).
  - Endlose 70-s-Drift-Animation, obwohl AUSBAU 4 im Ambient-Modus keine Animationen will.
- *Ändert sich:*
  - Uhr 160 px bleibt.
  - Darunter eine Zeile 28 px `--c-text-2`: „Sa, 10. Oktober · 14° · Linie 2 in 8 min“.
  - Drift-Animation entfällt, Grund `--c-bg`.
  - Auslöser nur über HA (niemand zu Hause / keine Bewegung).
- *Warum:* Auch im Ruhebild sieht man die zwei wichtigsten Zahlen.

---

## Technische Funde (Safari 12 / echtes iPad)

Geprüft mit `tool/pruefe-safari12.sh` und `tool/screenshot.js --safari12-sim` (entfernt genau die CSS-Angaben, die Safari 12 nicht kann). Das **ersetzt keinen Test auf dem echten Gerät**.

1. **`inset: 0` (3×, style.css) – behoben.** Nachtdimmung, Panel-Übersicht und Ambient-Modus hatten auf dem iPad keine Größe:
   - Nacht wirkungslos,
   - Übersicht ein Kasten oben links,
   - Ambient-Uhr ein Kasten über der Tafel.
   Belege: `belege/vorher/21-…`, `22-…`, `23-ipad-sim-*.png`; nachher `belege/2026-10-10/safari12-css/c-ipad-sim-nachher-13/15/16-*.png`.
2. **`gap` in Flex-Containern (15 Regeln) – behoben** (Abstände jetzt per `margin`; Geometrie-Vergleich alt ↔ neu in derselben Seite: alle Kind-Elemente auf den Zehntel-Pixel gleich, nur die zwei unsichtbaren Wrap-Container sind um den Abstand breiter). Auf dem iPad klebten bisher aneinander:
   - die Knöpfe ▦/📻 und die Uhr, Uhr und Datum („14:00Samstag“),
   - Radio-Menü-Einträge, Übersichts-Kacheln (Icon/Text),
   - Zeilen im Abfahrts-Banner, Wetter-Chips und deren Icons, News-Punkte,
   - Musik-Hero, Arbeitsweg-Hero und -Zeilen, Trivia-/Quiz-Knöpfe.
3. **Datums-Parsen ohne Zeitzone (app.js, nicht geändert, auf dem iPad prüfen):**
   - `new Date(value… + "T00:00:00")` (app.js:1952, 3454, 3477),
   - ICS-Zeiten ohne `Z` (app.js:1960),
   - OpenLigaDB-`matchDateTime` wie `"2026-10-09T20:30:00"` (app.js ~3599, 3613 f.).

   Falls Safari 12 solche Strings als UTC statt Ortszeit liest (ältere WebKit-Versionen taten das; für 12.1 nicht verifiziert), sind Termin- und Anstoßzeiten 2 h verschoben. Test am iPad in der Web-Inspector-Konsole: `new Date("2026-10-12T08:00:00").getHours()` muss `8` ergeben. Robuste Lösung: ein Helfer `parseLocalIso()` mit `new Date(y, m-1, d, h, mi, s)` (Muster: `parseJetzt` in debug-zeit.js).
4. **JS-Syntax/APIs:** app.js, config.js, debug-zeit.js (und die aktuellen ha*.js) bestehen `es-check es2017 --checkFeatures` und die Musterprüfung, es gibt keine Funde.
5. **Selbst-Neuladen verwirft URL-Parameter:** `hardReload()` und `fullReloadMs` (app.js:32, 4507) laden `pathname + "?_=…"`. Für den Debug-Modus fängt debug-zeit.js das per sessionStorage ab. Ein künftiger Einmal-Parameter für den HA-Token (AUSBAU B) wird aber ebenfalls verworfen. Das ist gewollt, sollte man aber wissen.
6. **Nur im Desktop-WebKit geprüft** (nicht auf dem echten iPad):
   - Touch-Wischen (`tool/ablauf-wischen.js`: Meldung 0 → 1 → 0 ok),
   - Tippen auf ▦/📻,
   - alle Layouts.

   Nicht prüfbar waren Webfont-Ladeverhalten offline, Speicherverbrauch auf 1 GB RAM und die Darstellung der iOS-12-Emoji.
7. **Lokal nicht erreichbare Quellen (keine Code-Fehler):**
   - Kalender-Worker (CORS nur für die github.io-Herkunft),
   - TomTom (HTTP 400 von localhost, vermutlich Schlüssel an die Herkunft gebunden, die App fällt sauber auf eine Schätzung zurück),
   - Open Trivia DB (HTTP 429 bei mehreren Läufen kurz hintereinander).

---

## Top 10 – zuerst bauen (nach der HA-Integration)

1. **R1 Dunkle Farbwelt** auf allen Panels mit den Tokens aus design.css. Grundlage für alles andere (→ Varianten zeigen).
2. **A1 + A2 Abfahrten:** Minuten 60 px, echte Linienfarben aus `routeColor`, Dringlichkeits-Pille statt Banner, 5 Zeilen.
3. **R5 Hinweiszeile unten** statt Müll-Chip (verdeckt nichts mehr, Platz für HA-Hinweise und DWD, Müll erst am Vorabend).
4. **R2 + R3 Kopfzeile:** Uhr 56 px, Titel links in derselben Zeile, Knöpfe 56 px, keine schwebende Pille.
5. **W1 + W2 Wetter:** 12-h-Verlauf in der leeren Mitte, Regen-Tipp groß nach oben (→ Varianten zeigen).
6. **F1 Fußball-Fehler** „Nächstes Spiel“ für vergangene Spiele (klein, falsche Aussage).
7. **N1 Nachrichten:** Überschrift 40 px + Teaser + Foto statt abgeschnittenem Volltext (→ Varianten zeigen).
8. **NA1 Nachtthema** statt grauem Schleier (jetzt, wo die Nacht auf dem iPad überhaupt greift).
9. **Ü1 Panel-Übersicht** deckend, Schließen-Knopf, HA-Panels in der ersten Reihe.
10. **AW1 + AW2 Arbeitsweg:** lesbare Zeiten (heute 1,15:1), „Los um …“ als Fern-Info, am Wochenende aus.

---

## 17. Zweiter Durchgang (Sitzung 3, 10.10. ab 06:05)

Grundlage: `belege/2026-10-10/s3/` (alle Panels, Mo 07:20 simuliert; Sa 06:40 echt; mit/ohne HA-Simulator).

✅ **TB2 – Tagesblick: Fahrplan statt Leerfläche** · M · Prio 1 · umgesetzt (51922b1)
- Stört: Bahnkarte zu 60 % leer (eine Zeile Info über 450 px Nichts), „Zuhause“ nur „7 Lichter an“, Wetter mit einer Spalte leerer 0-%-Balken; mit Hinweiszeile unten wurde die zweite Fahrplan-/achte Wetterzeile abgeschnitten; ohne Wetterdaten blieb unten rechts eine leere Zelle.
- Änderung: unter der empfohlenen Bahn die Bahn davor + zwei danach, je Zeile Abfahrt (26–30 px), „los HH:MM“, „an HH:MM“, Ampel „pünktlich / knapp / N min zu spät“ gegen `workArrivalTarget`; Zuhause listet Räume mit Lampenzahl; 8 Wetterstunden, an trockenen Tagen Kurzwort („Bedeckt“, „Wolkig“) statt Balken; nach dem Zeichnen wird jede Karte eingepasst (erst die Bahn davor, dann von hinten); ohne Wetter rückt die erste Karte auf dessen Platz.
- Warum: beantwortet die zweite Frage des Morgens („und wenn ich die nicht schaffe?“) und nutzt die Fläche, ohne dass etwas abgeschnitten wird.

✅ **TB3 – Freier Tag ohne „jetzt los“** · S · Prio 2 · umgesetzt (2312b52)
- Stört: Samstag 06:40 „Nächste Bahn 41 – jetzt los“ in Rot; Linienschilder im Tagesblick ohne Farbe.
- Änderung: am freien Tag vier Abfahrten mit Linienfarbe und Minuten, ohne Dringlichkeit; Höchst-/Tiefstwert in schmalen Karten untereinander.

✅ **W4 – Fünf Tage statt fünf Stunden** · S · Prio 2 · umgesetzt (54869fc)
- Stört: Die Stundenkacheln (07–11 Uhr) wiederholten die 12-h-Kurve darüber; kein Blick über heute hinaus.
- Änderung: Heute/Morgen/Mo–Mi, waagerecht (Symbol 44 px links; Tag 15 px, Höchstwert 24 px, Tiefstwert 18 px gedimmt, Regen ab 30 % blau, sonst „trocken“), flacher als vorher. `wetterUnten: "stunden"` = alt.

✅ **W5 – Wetter-Effekte ruhig** · S · Prio 2 · → Varianten zeigen · umgesetzt (54869fc)
- Stört: Deko-Wolken trieben endlos über Wettersymbol und Kurven-Legende; Symbole schwebten endlos (AUSBAU 4: nichts Endloses).
- Änderung: `wetterEffekte: "ruhig"` blendet die Effekt-Ebenen aus und stoppt das Schweben; „animiert“ = wie bisher (FRAGEN 22).

✅ **Q2 – Rätsel/Quiz: Knöpfe, die wie Knöpfe aussehen** · S · Prio 2 · umgesetzt (6934bfe)
- Stört: „Antwort antippen zum Mitraten“ als 13-px-Pille Grau auf Grau oben rechts (wirkte deaktiviert, stand schon da, während die Frage getippt wurde); dünne Antwort-Umrisse; angeschnittenes „ unten rechts.
- Änderung: Antworten gefüllt, 28 px (Text-Antworten 21 px), min. 68 px hoch; Hinweis als 17-px-Zeile unter den Antworten, erst wenn sie erscheinen; Frage 36 px; „?“ als Wasserzeichen, ganz sichtbar.

✅ **A5 – LOS-Balken mit Spur, Linienschilder mit Rand** · S · Prio 3 · umgesetzt (7e80997)
- Stört: Kurz vor Ablauf war vom LOS-Balken nur ein weißer Fleck übrig; Linie 23 (keine Farbe bei Transitous) verschwand fast auf der dunklen Karte.
- Änderung: Spur (28 % Deckkraft) hinter dem Balken; Schilder ohne bzw. mit sehr dunkler Farbe bekommen einen 2-px-Rand.

✅ **HA6 – Schnellaktion prüft ihre Wirkung** · M · Prio 1 · umgesetzt (ec1684a)
- Stört: HA meldet Fehler in Automationen nicht zurück – „Gute Nacht“ zeigte „erledigt“ und dunkelte ab, obwohl die Automation abbrach.
- Änderung: bis 5 s auf eine Zustandsänderung mit dem Kontext der Automation warten; sonst „hat nichts geschaltet“, Hinweis im Band, kein Abdunkeln.

✅ **E25 – Datenquellen in den Einstellungen** · S · Prio 1 · umgesetzt (809e1a4)
- Stört: Aus HA geöffnet, lehnt der Kalender-Worker ab – Termine verschwänden still.
- Änderung: je Quelle „zuletzt geladen“, bei fehlendem Kalender die Adresse, die der Worker erlauben muss; HOME_ASSISTANT.md Schritt 5.
