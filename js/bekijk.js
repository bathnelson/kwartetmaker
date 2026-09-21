// Bekijkpagina: toont het hele spel, alleen lezen, live bijgewerkt.
// Tekent met dezelfde code als de editor (render.js), dus het ziet er hetzelfde uit.
import { drawCard, drawBack, CARD_RATIO, gedraaid } from './render.js';
import { inkOn, mix } from './colors.js';

const code = new URLSearchParams(location.search).get('t') || '';
const api = (actie, extra = '') => `api.php?actie=${actie}&t=${encodeURIComponent(code)}${extra}`;
const el = (sel) => document.querySelector(sel);

const images = new Map();          // photoId -> ImageBitmap
let spel = null;
let rev = -1;

/* ---------------- gegevens ---------------- */

async function haalSpel() {
  const res = await fetch(api('spel'), { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.fout || 'Het kwartet kon niet worden geladen.');
  return data;
}

async function laadFoto(id) {
  if (!id || images.has(id)) return;
  images.set(id, null);                                   // niet dubbel ophalen
  try {
    // Bij afremmen door de host (429/503) even wachten en opnieuw.
    let res;
    for (let i = 0; i < 5; i++) {
      res = await fetch(api('foto', `&id=${encodeURIComponent(id)}`));
      if (res.status !== 429 && res.status !== 503) break;
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** i, 10000)));
    }
    if (res.ok) images.set(id, await createImageBitmap(await res.blob()));
  } catch (e) { /* laat leeg */ }
}

const draaiVan = (id) => ((spel.voorraad || []).find((f) => f.photoId === id) || {}).draai || 0;
const beeld = (id) => (id ? gedraaid(images.get(id) || null, draaiVan(id)) : null);

const gebruikt = (q) => q.theme.trim() || q.cards.some((c) => (c.title || '').trim() || c.photoId);

/* ---------------- filter op ja / misschien / nee ---------------- */
// Alleen voor wie kijkt: het staat in deze browser, niet in het spel.

const KEUZE_TEKEN = { ja: '✓', misschien: '?', nee: '✗', geen: '○' };
const KEUZE_NAAM = { ja: 'ja', misschien: 'misschien', nee: 'nee', geen: 'nog niet gekozen' };
let filter = null;
try {
  const bewaard = localStorage.getItem('kwartet-bekijk-filter');
  if (KEUZE_TEKEN[bewaard]) filter = bewaard;
} catch (e) { /* privévenster */ }

function zetFilter(keuze) {
  filter = filter === keuze ? null : keuze;
  try {
    if (filter) localStorage.setItem('kwartet-bekijk-filter', filter);
    else localStorage.removeItem('kwartet-bekijk-filter');
  } catch (e) { /* */ }
  bouw();
  window.scrollTo(0, 0);
}

function bouwFilters(alle) {
  const balk = el('#filters');
  balk.innerHTML = '';
  const tel = { ja: 0, misschien: 0, nee: 0, geen: 0 };
  for (const { q } of alle) tel[KEUZE_TEKEN[q.keuze] ? q.keuze : 'geen']++;
  if (!tel.ja && !tel.misschien && !tel.nee) return;        // niemand heeft iets gekozen

  const maak = (keuze, tekst, uitleg) => {
    const knop = document.createElement('button');
    knop.type = 'button';
    knop.className = `filter${keuze ? ` k-${keuze}` : ' alles'}`;
    knop.textContent = tekst;
    knop.title = uitleg;
    knop.setAttribute('aria-pressed', String(filter === keuze));
    knop.addEventListener('click', () => zetFilter(keuze));
    balk.appendChild(knop);
  };
  maak(null, `Alles ${alle.length}`, 'Alle kwartetten tonen');
  for (const keuze of ['ja', 'misschien', 'nee', 'geen']) {
    if (!tel[keuze]) continue;
    maak(keuze, `${KEUZE_TEKEN[keuze]} ${tel[keuze]}`, `Alleen ${KEUZE_NAAM[keuze]} tonen`);
  }
}

/* ---------------- tekenen ---------------- */

function stijl(q) {
  return { accent: q.color, text: '#3b4147', muted: '#c6ccd2', bg: '#ffffff', border: '#e7ebee' };
}

function kaartModel(q, qi, ci) {
  const c = q.cards[ci];
  return {
    theme: q.theme,
    number: qi + 1,
    titles: q.cards.map((x) => (x.title || '').trim()),
    activeIndex: ci,
    image: beeld(c.photoId),
    focus: c.focus,
    zoom: c.zoom,
    fit: c.fit,
    hints: false,
  };
}

function achterModel() {
  const b = spel.back || {};
  const kleur = b.color || '#2f4858';
  return {
    color: kleur, title: b.tekstUit ? '' : (b.title || spel.title), pattern: b.pattern,
    image: beeld(b.photoId), focus: b.focus, zoom: b.zoom, fit: b.fit,
    ink: inkOn(kleur), soft: mix(kleur, inkOn(kleur), 0.16),
  };
}

function teken(canvas, maak) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round((canvas.clientWidth || 160) * dpr);
  const H = Math.round(W * CARD_RATIO);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  maak(canvas.getContext('2d'), W);
}

// Elke canvas weet hoe hij zichzelf tekent; zo kunnen we alles opnieuw tekenen
// als er foto's binnenkomen of het scherm draait.
const tekenaars = new WeakMap();
function hertekenAlles() {
  document.querySelectorAll('canvas').forEach((c) => {
    const f = tekenaars.get(c);
    if (f && c.clientWidth) teken(c, f);
  });
}

function kaartKnop(maak) {
  const knop = document.createElement('button');
  knop.className = 'kaart';
  knop.type = 'button';
  const canvas = document.createElement('canvas');
  knop.appendChild(canvas);
  tekenaars.set(canvas, maak);
  knop.addEventListener('click', () => toonGroot(maak));
  return knop;
}

function bouw() {
  el('#titel').textContent = spel.title || 'Kwartet';
  document.title = spel.title || 'Kwartet';
  const main = el('#kwartetten');
  main.innerHTML = '';

  const alle = spel.quartets.map((q, qi) => ({ q, qi })).filter(({ q }) => gebruikt(q));
  // Niemand iets gekozen: dan zijn er geen filterknoppen, dus ook geen filter.
  if (filter && !alle.some(({ q }) => ['ja', 'misschien', 'nee'].includes(q.keuze))) {
    filter = null;
    try { localStorage.removeItem('kwartet-bekijk-filter'); } catch (e) { /* */ }
  }
  bouwFilters(alle);
  const zichtbaar = alle.filter(({ q }) => !filter || (KEUZE_TEKEN[q.keuze] ? q.keuze : 'geen') === filter);
  if (!alle.length) {
    main.innerHTML = '<p class="leeg">Er staat nog niets in dit kwartet.</p>';
  } else if (!zichtbaar.length) {
    main.innerHTML = `<p class="leeg">Geen kwartetten met ${KEUZE_NAAM[filter]}.</p>`;
  }

  for (const { q, qi } of zichtbaar) {
    const sectie = document.createElement('section');
    sectie.className = 'kwartet' + (q.keuze === 'nee' ? ' nee' : '');
    sectie.dataset.i = qi;
    const kop = document.createElement('h2');
    kop.innerHTML = '<span class="stip"></span><span class="nr"></span><span class="naam"></span>';
    kop.querySelector('.stip').style.background = q.color;
    kop.querySelector('.nr').textContent = qi + 1;
    kop.querySelector('.naam').textContent = q.theme.trim() || 'zonder thema';
    if (KEUZE_TEKEN[q.keuze]) {
      const keuze = document.createElement('span');
      keuze.className = `keuze k-${q.keuze}`;
      keuze.textContent = KEUZE_TEKEN[q.keuze];
      keuze.title = KEUZE_NAAM[q.keuze];
      kop.appendChild(keuze);
    }
    const rij = document.createElement('div');
    rij.className = 'kaarten';
    for (let ci = 0; ci < 4; ci++) {
      rij.appendChild(kaartKnop((ctx, W) => drawCard(ctx, W, kaartModel(q, qi, ci), stijl(q))));
    }
    sectie.append(kop, rij);
    main.appendChild(sectie);
    kijker.observe(sectie);
  }

  if (zichtbaar.length) {
    const sectie = document.createElement('section');
    sectie.className = 'kwartet achterkant';
    sectie.innerHTML = '<h2><span class="naam">Achterkant</span></h2><div class="kaarten"></div>';
    sectie.querySelector('.kaarten').appendChild(
      kaartKnop((ctx, W) => drawBack(ctx, W, achterModel(), { bg: '#ffffff', border: '#e7ebee' })));
    main.appendChild(sectie);
    kijker.observe(sectie);
  }

  el('#info').textContent = `${alle.length} kwartet${alle.length === 1 ? '' : 'ten'} · ${alle.length * 4} kaartjes`
    + (filter ? ` · getoond: ${zichtbaar.length}` : '');
  hertekenAlles();
}

// Foto's pas ophalen als een kwartet in beeld komt: scheelt veel data op een telefoon.
const kijker = new IntersectionObserver((items) => {
  for (const item of items) {
    if (!item.isIntersecting) continue;
    kijker.unobserve(item.target);
    const ids = item.target.classList.contains('achterkant')
      ? [spel.back && spel.back.photoId]
      : spel.quartets[Number(item.target.dataset.i)].cards.map((c) => c.photoId);
    Promise.all(ids.map(laadFoto)).then(() => {
      item.target.querySelectorAll('canvas').forEach((c) => teken(c, tekenaars.get(c)));
    });
  }
}, { rootMargin: '400px 0px' });

/* ---------------- groot bekijken ---------------- */

let grootMaak = null;
function toonGroot(maak) {
  grootMaak = maak;
  el('#groot').hidden = false;
  teken(el('#groot canvas'), maak);
}
el('#groot').addEventListener('click', () => { el('#groot').hidden = true; grootMaak = null; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') el('#groot').hidden = true; });

/* ---------------- live bijwerken ---------------- */

async function kijkOfErIetsNieuwsIs() {
  if (document.hidden) return;
  try {
    const res = await fetch(api('rev'), { cache: 'no-store' });
    if (!res.ok) return;
    const { rev: nieuw } = await res.json();
    if (nieuw === rev) return;
    const data = await haalSpel();
    const scroll = window.scrollY;
    spel = data.spel; rev = data.rev;
    bouw();
    window.scrollTo(0, scroll);
    if (grootMaak) teken(el('#groot canvas'), grootMaak);
    const t = new Date();
    el('#info').textContent += ` · bijgewerkt ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
  } catch (e) { /* volgende keer weer */ }
}

/* ---------------- start ---------------- */

async function start() {
  if (!code) throw new Error('Deze link is niet compleet.');
  const data = await haalSpel();
  if (!data.spel) throw new Error('Er staat nog geen kwartet klaar.');
  spel = data.spel; rev = data.rev;
  bouw();
  setInterval(kijkOfErIetsNieuwsIs, 6000);
  document.addEventListener('visibilitychange', kijkOfErIetsNieuwsIs);
  let wacht = null;
  window.addEventListener('resize', () => { clearTimeout(wacht); wacht = setTimeout(hertekenAlles, 120); });
}

start().catch((err) => {
  el('#info').textContent = err.message;
  el('#kwartetten').innerHTML = '';
});
