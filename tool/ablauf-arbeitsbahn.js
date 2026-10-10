// Ablaufskript für tool/screenshot.js: Arbeitsweg-Panel und Tagesblick
// zweimal zeigen (zweiter Durchgang nach den gezielten Abfragen) und die
// genannten Bahnen ausgeben – nennen beide dieselbe, pünktliche Bahn?
module.exports = async (page, hilfe) => {
  const lies = () => page.evaluate(() => {
    const bus = document.querySelector(".commute-race-extra.is-bus");
    const tb = document.querySelector("#panel-tagesblick .tb-bahn");
    return {
      arbeitsweg: bus ? bus.textContent : "(keine Bus-Zeile)",
      tagesblick: tb ? tb.innerText.replace(/\s+/g, " ").slice(0, 160) : "(keine Bahnkarte)",
    };
  });
  for (let r = 1; r <= 2; r++) {
    await hilfe.panel("commute", 4000);
    if (r === 2) await hilfe.foto("arbeitsweg");
    await hilfe.panel("tagesblick", 4000);
    if (r === 2) await hilfe.foto("tagesblick");
    console.log("Durchgang " + r + ": " + JSON.stringify(await lies()));
  }
};
