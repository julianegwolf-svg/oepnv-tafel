#!/bin/bash
# Kopiert die Tafel in einen Ordner, den Home Assistant unter /local/
# ausliefert — danach läuft die Tafel unter
#   http://homeassistant.local:8123/local/tafel/index.html
# (gleiche Herkunft wie Home Assistant: kein Mixed Content, kein CORS).
#
# Aufruf (Beispiel mit der Samba-Freigabe "config" von Home Assistant,
# im Finder verbunden über  smb://homeassistant.local):
#   ./tool/nach-ha-kopieren.sh /Volumes/config/www/tafel
#
# Kopiert nur die ausgelieferten Dateien (HTML/CSS/JS im Repo-Wurzelordner),
# nichts aus tool/, belege/ oder .git. Vorhandene Tafel-Dateien im Ziel
# werden überschrieben, andere Dateien dort bleiben unangetastet.
set -euo pipefail

ZIEL="${1:-}"
if [ -z "$ZIEL" ]; then
  echo "Aufruf: $0 <Zielordner>   z. B. $0 /Volumes/config/www/tafel" >&2
  exit 1
fi

QUELLE="$(cd "$(dirname "$0")/.." && pwd)"
ELTERN="$(dirname "$ZIEL")"
if [ ! -d "$ELTERN" ]; then
  echo "✗ $ELTERN gibt es nicht — ist die Home-Assistant-Freigabe verbunden?" >&2
  echo "  (Finder → Gehe zu → Mit Server verbinden → smb://homeassistant.local)" >&2
  exit 1
fi

mkdir -p "$ZIEL"
ANZAHL=0
for f in "$QUELLE"/*.html "$QUELLE"/*.css "$QUELLE"/*.js; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  # Übersichtsseite der nächtlichen Arbeit gehört nicht auf die Tafel.
  [ "$name" = "MORGEN.html" ] && continue
  cp "$f" "$ZIEL/$name"
  ANZAHL=$((ANZAHL + 1))
done

echo "✓ $ANZAHL Dateien nach $ZIEL kopiert."
echo "  Tafel-Adresse: http://homeassistant.local:8123/local/$(basename "$ZIEL")/index.html"
echo "  Falls der Ordner www/ eben erst neu angelegt wurde: Home Assistant einmal"
echo "  neu starten — /local/ liefert nur Ordner aus, die beim Start schon da waren."
