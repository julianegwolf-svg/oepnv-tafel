#!/bin/bash
# Safari-12-Prüfung der SmartTafel – vor jedem Commit ausführen:
#   ./tool/pruefe-safari12.sh            (ausführlich)
#   ./tool/pruefe-safari12.sh --still    (nur Funde + Ergebnis)
#
# Prüft alle *.js / *.css / *.html im Repo-Wurzelordner:
#  - es-check es2017 --checkFeatures über jede JS-Datei
#  - verbotene JS-Muster (?. ?? replaceAll allSettled structuredClone
#    Lookbehind #privat Klassenfelder import/export globalThis
#    Object.fromEntries matchAll .at( Intl.RelativeTimeFormat
#    ResizeObserver; Warnung: AbortController, IntersectionObserver)
#  - verbotenes CSS (inset aspect-ratio color-mix :is/:where/:has
#    Nesting, ungeprefixtes backdrop-filter, gap in Flex-Containern …)
# Ausgabe je Fund "datei:zeile Grund", am Ende "OK" oder "FEHLER (n)".
# Exit-Code 1 bei Fehlern.
set -u
cd "$(dirname "$0")/.." || exit 2
if [ ! -d tool/node_modules/es-check ]; then
  echo "es-check fehlt: (cd tool && npm install)" >&2
fi
exec node tool/pruefe-safari12.js "$@"
