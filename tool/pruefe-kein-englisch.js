// Probe: Fehlen sprueche.js/quiz.js (z. B. nicht nach HA mitkopiert), darf
// die Tafel nicht still auf die englischen Quellen zurückfallen.
//   python3 -m http.server 8765 &  ·  node tool/pruefe-kein-englisch.js
const { webkit } = require('playwright');
(async () => {
  const b = await webkit.launch(); const p = await b.newPage();
  const anfragen = [];
  p.on('request', r => anfragen.push(r.url()));
  await p.route(/sprueche\.js|quiz\.js/, r => r.fulfill({ status: 404, body: '' }));
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(7000);
  const v = await p.evaluate(() => ({ quote: panelVerfuegbar('quote'), quiz: panelVerfuegbar('quiz'), riddle: panelVerfuegbar('riddle') }));
  const englisch = anfragen.filter(u => /adviceslip|opentdb/.test(u));
  console.log((englisch.length ? '✗' : '✓') + ' ohne sprueche.js/quiz.js: Anfragen an englische Quellen: ' + englisch.length);
  console.log((!v.quote && !v.quiz ? '✓' : '✗') + ' Spruch/Quiz fallen weg statt Englisch (quote=' + v.quote + ', quiz=' + v.quiz + ', Rätsel=' + v.riddle + ')');
  await b.close();
})();
