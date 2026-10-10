// Attrappe für Bright Sky /alerts (DWD-Warnungen, nur für Screenshots):
// eine Warnung im echten Bright-Sky-Format, heute 12–19 Uhr. Texte wie
// die echte Windböen-Warnung für Bremen vom 10.10.2026.
//
//   ATTRAPPE_JETZT=2026-10-12T07:20 ATTRAPPE_STUFE=minor|severe [ATTRAPPE_ZWEI=1] \
//   node tool/screenshot.js --attrappe api.brightsky.dev/alerts=tool/attrappen/dwd.js …
//
// Bright Sky wird ohne Cache-Buster abgefragt, deshalb kommt "heute" aus
// ATTRAPPE_JETZT (passend zu --jetzt) statt aus der URL.
"use strict";

module.exports = function () {
  const jetzt = process.env.ATTRAPPE_JETZT ? new Date(process.env.ATTRAPPE_JETZT) : new Date();
  const um = (h) => new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate(), h, 0).toISOString();
  const schwer = process.env.ATTRAPPE_STUFE === "severe";
  const alert = schwer ? {
    id: 1, alert_id: "attrappe-orkan", status: "actual", effective: um(6), onset: um(12), expires: um(19),
    category: "met", response_type: "prepare", urgency: "immediate", severity: "severe", certainty: "likely",
    event_code: 52, event_en: "storm", event_de: "ORKANARTIGE BÖEN",
    headline_en: "Official WARNING of STORM", headline_de: "Amtliche UNWETTERWARNUNG vor ORKANARTIGEN BÖEN",
    description_en: "", description_de: "Es treten orkanartige Böen mit Geschwindigkeiten zwischen 100 km/h (28 m/s, 55 kn, Bft 10) und 115 km/h (32 m/s, 62 kn, Bft 11) aus westlicher Richtung auf.",
    instruction_en: "", instruction_de: "ACHTUNG! Hinweis auf mögliche Gefahren: Es können zum Beispiel Bäume entwurzelt werden. \nHandlungsempfehlungen: \nAufenthalt im Freien vermeiden; Fenster und Türen schließen",
  } : {
    id: 1, alert_id: "attrappe-wind", status: "actual", effective: um(6), onset: um(12), expires: um(19),
    category: "met", response_type: "prepare", urgency: "immediate", severity: "minor", certainty: "likely",
    event_code: 51, event_en: "wind gusts", event_de: "WINDBÖEN",
    headline_en: "Official WARNING of WIND GUSTS", headline_de: "Amtliche WARNUNG vor WINDBÖEN",
    description_en: "", description_de: "Es treten Windböen mit Geschwindigkeiten um 55 km/h (15 m/s, 30 kn, Bft 7) aus südwestlicher Richtung auf.",
    instruction_en: "", instruction_de: "Hinweis auf: umherfliegende leichte Gegenstände. \nHandlungsempfehlungen: \nlose Gegenstände sichern; z.B. Zelte und Abdeckungen befestigen",
  };
  const alerts = [alert];
  // ATTRAPPE_ZWEI=1: zusätzlich leichter Frost in der Nacht (Stufe 1).
  if (process.env.ATTRAPPE_ZWEI) {
    alerts.push({
      id: 2, alert_id: "attrappe-frost", status: "actual", effective: um(6), onset: um(20), expires: um(23),
      category: "met", response_type: "prepare", urgency: "future", severity: "minor", certainty: "likely",
      event_code: 22, event_en: "frost", event_de: "FROST",
      headline_en: "Official WARNING of FROST", headline_de: "Amtliche WARNUNG vor FROST",
      description_en: "", description_de: "Es tritt leichter Frost um -2 °C auf.",
      instruction_en: "", instruction_de: "",
    });
  }
  return JSON.stringify({ alerts: alerts, location: { warn_cell_id: 804011000, name: "Stadt Bremen", name_short: "Bremen", district: "Bremen", state: "Bremen", state_short: "HB" } });
};
