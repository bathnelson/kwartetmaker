// Laadt de Kwartetmaker van GitHub (via het jsDelivr-CDN).
//
// Altijd de laatste versie, en altijd alle bestanden van precies dezelfde
// versie: we vragen GitHub welke commit de nieuwste is en halen alles op met
// dat commitnummer in het adres. Een nieuwe versie uitrollen = git push.
// Dit bestand, index.html en bekijk.html hoeven daarvoor niet te veranderen.
(function () {
  var REPO = 'bathnelson/kwartetmaker';
  var TAK = 'main';

  var bekijk = document.documentElement.getAttribute('data-pagina') === 'bekijk';
  var html = bekijk ? 'bekijk.html' : 'index.html';
  var css = bekijk ? 'css/bekijk.css' : 'css/style.css';
  var js = bekijk ? 'js/bekijk.js' : 'js/app.js';

  // Alleen voor testen op je eigen Mac: ?bron=http://localhost:.../ laadt de app
  // van een ander adres. Op de echte site genegeerd - anders kon iemand een link
  // maken die vreemde code in jouw ingelogde app laadt.
  var lokaal = /^(localhost|127\.0\.0\.1)$/;
  var bron = null;
  if (lokaal.test(location.hostname)) {
    try {
      var gevraagd = new URL(new URLSearchParams(location.search).get('bron') || '');
      if (lokaal.test(gevraagd.hostname)) bron = gevraagd.href;
    } catch (e) { /* geen of ongeldige bron */ }
  }

  function laatsteVersie() {
    // no-cache: de browser mag een eerder antwoord alleen gebruiken als GitHub
    // bevestigt dat het nog klopt ("304 niet gewijzigd"). Dat is snel en telt
    // bij GitHub niet mee voor de limiet van 60 verzoeken per uur.
    return fetch('https://api.github.com/repos/' + REPO + '/commits/' + TAK, {
      headers: { Accept: 'application/vnd.github.sha' },
      cache: 'no-cache',
    }).then(function (res) {
      if (!res.ok) throw new Error('GitHub ' + res.status);
      return res.text();
    }).then(function (sha) {
      sha = sha.trim();
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('onverwacht antwoord van GitHub');
      return sha;
    });
  }

  function basis() {
    if (bron) return Promise.resolve(bron.replace(/\/?$/, '/'));
    return laatsteVersie()
      // GitHub even niet bereikbaar: dan de tak zelf (kan tot een paar uur achterlopen).
      .catch(function () { return TAK; })
      .then(function (ref) { return 'https://cdn.jsdelivr.net/gh/' + REPO + '@' + ref + '/'; });
  }

  function fout(err) {
    document.body.innerHTML =
      '<p style="font:15px/1.5 -apple-system,Helvetica,sans-serif;padding:40px;max-width:560px;color:#3b4147">' +
      'De Kwartetmaker kon niet worden geladen (' + String(err && err.message || err) + ').<br>' +
      'Probeer het over een minuut opnieuw.</p>';
  }

  basis().then(function (b) {
    window.KWARTET_BRON = b;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = b + css;
    var cssKlaar = new Promise(function (klaar) { link.onload = klaar; link.onerror = klaar; });
    document.head.appendChild(link);

    return fetch(b + html).then(function (res) {
      if (!res.ok) throw new Error(html + ': ' + res.status);
      return res.text();
    }).then(function (tekst) {
      var doc = new DOMParser().parseFromString(tekst, 'text/html');
      doc.querySelectorAll('script, link').forEach(function (n) { n.remove(); });
      return cssKlaar.then(function () {
        document.body.innerHTML = doc.body.innerHTML;
        return import(b + js);
      });
    });
  }).catch(fout);
})();
