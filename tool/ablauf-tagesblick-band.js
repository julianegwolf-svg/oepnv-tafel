// Wird von screenshot.js --skript aufgerufen: Tagesblick, dann Abfahrten – Band-Inhalt je Panel.
module.exports = async (page, hilfe) => {
  const band = () => page.evaluate(() => {
    const shell = document.querySelector(".panel");
    const chips = Array.prototype.filter.call(document.querySelectorAll(".statusbar .ha-hint, .statusbar .waste-line"), (c) => c.offsetWidth > 0).map((c) => c.textContent.trim());
    const hours = Array.prototype.map.call(document.querySelectorAll("#panel-tagesblick .tb-hour-t"), (e) => e.textContent).join(", ");
    return { hintbar: shell.classList.contains("has-hintbar"), warnImPanel: shell.classList.contains("warn-im-panel"), chips: chips, stunden: hours,
      regen: (document.querySelector("#panel-tagesblick .tb-line.is-nass") || {}).textContent || "-" };
  });
  await hilfe.panel("tagesblick", 3000);
  console.log("tagesblick:", JSON.stringify(await band()));
  await hilfe.foto("tagesblick");
  await hilfe.panel("departures", 2500);
  console.log("departures:", JSON.stringify(await band()));
  await hilfe.foto("departures");
  await hilfe.panel("tagesblick", 3000);
  console.log("tagesblick erneut:", JSON.stringify(await band()));
};
