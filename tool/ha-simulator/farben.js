'use strict';
/*
 * Farbumrechnungen wie in homeassistant/util/color.py,
 * damit hs_color / rgb_color / xy_color zueinander passen wie in echtem HA.
 */

function klemme255(x) {
  return x < 0 ? 0 : (x > 255 ? 255 : x);
}

// Farbtemperatur (Kelvin) → RGB (Algorithmus von Tanner Helland, wie HA)
function kelvinZuRgb(kelvin) {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100;
  let r;
  let g;
  let b;
  if (t <= 66) r = 255;
  else r = klemme255(329.698727446 * Math.pow(t - 60, -0.1332047592));
  if (t <= 66) g = klemme255(99.4708025861 * Math.log(t) - 161.1195681661);
  else g = klemme255(288.1221695283 * Math.pow(t - 60, -0.0755148492));
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = klemme255(138.5177312231 * Math.log(t - 10) - 305.0447927307);
  return [Math.round(r), Math.round(g), Math.round(b)];
}

// RGB → [Farbton 0–360, Sättigung 0–100], auf 3 Stellen gerundet
function rgbZuHs(rgb) {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [Math.round(h * 1000) / 1000, Math.round(s * 100 * 1000) / 1000];
}

// HS → RGB (volle Helligkeit)
function hsZuRgb(hs) {
  const h = (hs[0] % 360) / 60;
  const s = hs[1] / 100;
  const v = 1;
  const c = v * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 1) { r = c; g = x; } else if (h < 2) { r = x; g = c; } else if (h < 3) { g = c; b = x; } else if (h < 4) { g = x; b = c; } else if (h < 5) { r = x; b = c; } else { r = c; b = x; }
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// RGB → CIE xy (Wide-Gamut-D65 wie HA color_RGB_to_xy), 3 Stellen
function rgbZuXy(rgb) {
  const lin = rgb.map(function (c) {
    const v = c / 255;
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
  });
  const X = lin[0] * 0.664511 + lin[1] * 0.154324 + lin[2] * 0.162028;
  const Y = lin[0] * 0.283881 + lin[1] * 0.668433 + lin[2] * 0.047685;
  const Z = lin[0] * 0.000088 + lin[1] * 0.072310 + lin[2] * 0.986039;
  const summe = X + Y + Z;
  if (summe === 0) return [0, 0];
  return [Math.round(X / summe * 1000) / 1000, Math.round(Y / summe * 1000) / 1000];
}

// CIE xy → RGB bei voller Helligkeit (wie HA color_xy_brightness_to_RGB)
function xyZuRgb(xy) {
  let x = xy[0];
  let y = xy[1];
  if (y === 0) y = 1e-11;
  const Y = 1;
  const X = (Y / y) * x;
  const Z = (Y / y) * (1 - x - y);
  let rgb = [
    X * 1.656492 - Y * 0.354851 - Z * 0.255038,
    -X * 0.707196 + Y * 1.655397 + Z * 0.036152,
    X * 0.051713 - Y * 0.121364 + Z * 1.011530
  ];
  rgb = rgb.map(function (c) {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.max(0, v);
  });
  const max = Math.max(rgb[0], rgb[1], rgb[2]);
  if (max > 1) rgb = rgb.map(c => c / max);
  return rgb.map(c => Math.floor(c * 255));
}

// Näherung xy → Farbtemperatur (McCamy), für Weiß-Lampen, die Farbe bekommen
function xyZuKelvin(xy) {
  const n = (xy[0] - 0.3320) / (0.1858 - xy[1]);
  return Math.round(437 * n * n * n + 3601 * n * n + 6861 * n + 5517);
}

const FARBNAMEN = {
  red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], white: [255, 255, 255],
  yellow: [255, 255, 0], orange: [255, 165, 0], purple: [128, 0, 128], pink: [255, 192, 203],
  cyan: [0, 255, 255], magenta: [255, 0, 255], warmwhite: [255, 197, 143], gold: [255, 215, 0],
  turquoise: [64, 224, 208], violet: [238, 130, 238], lime: [0, 255, 0], aliceblue: [240, 248, 255]
};

module.exports = { kelvinZuRgb, rgbZuHs, hsZuRgb, rgbZuXy, xyZuRgb, xyZuKelvin, FARBNAMEN };
