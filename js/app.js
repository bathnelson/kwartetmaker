import * as store from './store.js';
import { makeZip, readZip, downloadBlob } from './zip.js';
import { drawCard, drawBack, photoRect, CARD_RATIO, EXPORT_WIDTH, FONT, gedraaid } from './render.js';
import { makePdf } from './pdf.js';
import { PALETTE, pickColor, isHex, inkOn, mix } from './colors.js';
import { mergeGame, equal } from './sync.js';
import { vingerafdruk, zoekDubbel, beschrijfPlek } from './dubbel.js';

const DEFAULT_QUARTETS = 15;
const MAX_PHOTO_SIDE = 1800;

const el = (sel) => document.querySelector(sel);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

let game = null;
let current = 0;
let lastFocusedCard = 0;
const images = new Map();   // photoId -> ImageBitmap | HTMLImageElement

/* ---------------- model ---------------- */

function newCard() {
  return { id: uid(), title: '', photoId: null, focus: { x: .5, y: .5 }, zoom: 1, fit: 'vullen' };
}
function newQuartet(color) {
  return { id: uid(), theme: '', color: color || PALETTE[0], cards: [newCard(), newCard(), newCard(), newCard()] };
}
function newGame(n = DEFAULT_QUARTETS) {
  return {
    title: 'Mijn kwartet',
    back: { color: '#2f4858', title: '', pattern: 'stippen', photoId: null, focus: { x: .5, y: .5 }, zoom: 1, fit: 'vullen' },
    todos: [],
    voorraad: [],
    quartets: Array.from({ length: n }, (_, i) => newQuartet(PALETTE[i % PALETTE.length])),
  };
}
// Elk kwartet heeft zijn eigen kleur; die bepaalt hoe het kaartje eruitziet.
function style(q) {
  return {
    accent: (q && q.color) || PALETTE[0],
    text: '#3b4147', muted: '#c6ccd2', bg: '#ffffff', border: '#e7ebee',
  };
}
function backStyle() {
  const b = game.back;
  return {
    color: b.color, title: b.tekstUit ? '' : (b.title || game.title), pattern: b.pattern,
    image: b.photoId ? gedraaid(images.get(b.photoId), draaiVan(b.photoId)) : null,
    focus: b.focus, zoom: b.zoom, fit: b.fit,
    ink: inkOn(b.color), soft: mix(b.color, inkOn(b.color), 0.16),
  };
}
function cardsDone(q) {
  return q.cards.filter((c) => c.photoId && c.title.trim()).length;
}

/* ---------------- opslag ---------------- */
// Bij opslag op de server kunnen meer computers tegelijk aan hetzelfde spel
// werken. De server houdt een versienummer (rev) bij; was iemand anders je voor,
// dan voegen we beide wijzigingen per veld samen (sync.js) en slaan opnieuw op.

let saveTimer = null;
let base = null;          // laatst bekende versie op de server
let rev = 0;
let saving = false;
let saveAgain = false;

const snapshot = () => JSON.parse(JSON.stringify(game));

function save() {
  clearTimeout(saveTimer);
  setStatus('Bewaren…');
  saveTimer = setTimeout(persist, 350);
}

async function persist() {
  if (saving) { saveAgain = true; return; }
  saving = true;
  try {
    let versie = snapshot();
    let res = await store.saveGame(versie, rev);
    while (res.conflict) {
      const remote = normalizeGame(res.game);
      applyGame(mergeGame(base, game, remote));
      base = remote;
      rev = res.rev;
      versie = snapshot();
      res = await store.saveGame(versie, rev);
    }
    rev = res.rev;
    base = versie;
    setStatus('Bewaard ✓');
  } catch (err) {
    setStatus('Niet bewaard');
    toast(`Opslaan mislukt (${err.message}). Ik probeer het zo opnieuw.`, 5000);
    setTimeout(save, 5000);
  } finally {
    saving = false;
    if (saveAgain) { saveAgain = false; persist(); }
  }
}

/** Alles vervangen, bijv. bij terugzetten of nieuw spel: wint van anderen. */
async function persistForced() {
  clearTimeout(saveTimer);
  const versie = snapshot();
  const res = await store.saveGame(versie, rev, true);
  rev = res.rev;
  base = versie;
  setStatus('Bewaard ✓');
}

/* ---------- wijzigingen van andere computers binnenhalen ---------- */

let syncing = false;

async function checkForUpdates() {
  if (!store.opServer || saving || syncing || document.hidden) return;
  // Niet tijdens slepen: dan zou het kaartje onder je muis vervangen worden.
  if (document.querySelector('.preview.over, .preview.dragging')) return;
  syncing = true;
  try {
    if ((await store.getRev()) === rev) return;
    const { game: raw, rev: nieuw } = await store.loadGame();
    if (saving) return;                      // net zelf aan het opslaan: volgende ronde
    const remote = normalizeGame(raw);
    const merged = mergeGame(base, game, remote);
    const eigenWijzigingen = !equal(merged, remote);
    base = remote;
    rev = nieuw;
    if (!equal(merged, game)) applyGame(merged);
    if (eigenWijzigingen) save();
    else setStatus('Bijgewerkt ✓');
  } catch (err) {
    /* geen verbinding: volgende ronde weer */
  } finally {
    syncing = false;
  }
}

function startSync() {
  setInterval(checkForUpdates, 4000);
  document.addEventListener('visibilitychange', checkForUpdates);
  window.addEventListener('focus', checkForUpdates);
}

/** Nieuwe versie van het spel tonen zonder je invoer te verstoren. */
function applyGame(next) {
  const huidigId = game.quartets[current] && game.quartets[current].id;
  const focus = captureFocus();
  game = next;
  const idx = game.quartets.findIndex((q) => q.id === huidigId);
  current = idx >= 0 ? idx : Math.max(0, Math.min(current, game.quartets.length - 1));
  if (document.activeElement !== el('#gameTitle')) el('#gameTitle').value = game.title;
  const q = game.quartets[current];
  if (q) document.documentElement.style.setProperty('--accent', q.color);
  renderSidebar();
  renderEditor();
  renderTaken();
  restoreFocus(focus);
  vulVingerafdrukken();
  ensureQuartetImages(q).then(() => { if (game.quartets[current] === q) repaintQuartet(); });
  if (el('#printDialog').open) {
    if (document.activeElement !== el('#backTitle')) el('#backTitle').value = game.back.title;
    el('#backTekstAan').checked = !game.back.tekstUit;
    el('#backTitle').disabled = !!game.back.tekstUit;
    el('#backColor').value = game.back.color;
    el('#backPattern').value = game.back.pattern;
    el('#backZoom').value = game.back.zoom;
    updateBackControls();
    ensureImage(game.back.photoId).then(paintBackPreview);
  }
}

function captureFocus() {
  const a = document.activeElement;
  if (!a || a.tagName !== 'INPUT' || !el('#editor').contains(a)) return null;
  const col = a.closest('.cardcol');
  return {
    id: a.id || null,
    card: col ? col.dataset.i : null,
    title: a.classList.contains('title'),
    start: a.selectionStart,
    end: a.selectionEnd,
  };
}

function restoreFocus(f) {
  if (!f) return;
  const target = f.card !== null && f.title
    ? document.querySelector(`.cardcol[data-i="${f.card}"] input.title`)
    : f.id ? document.getElementById(f.id) : null;
  if (!target) return;
  target.focus({ preventScroll: true });
  try { if (f.start !== null) target.setSelectionRange(f.start, f.end); } catch (e) { /* kleurkiezer e.d. */ }
}

function setStatus(text) {
  el('#status').textContent = text;
}


/* ---------------- afbeeldingen ---------------- */

async function decode(file) {
  try {
    return await createImageBitmap(file);
  } catch (e) {
    // Safari kan HEIC via <img>, Chrome niet.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }
}

// Verkleint en hercodeert naar JPEG, zodat HEIC-bestanden ook werken en de
// database niet volloopt met originelen van 5 MB.
async function importFile(file) {
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
    throw new Error(`"${file.name}" is geen afbeelding`);
  }
  const src = await decode(file);
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(src.width, src.height));
  const w = Math.round(src.width * scale), h = Math.round(src.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(src, 0, 0, w, h);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
  const id = uid();
  await store.putPhoto(id, blob);
  const bitmap = await createImageBitmap(blob);
  images.set(id, bitmap);
  voegToeAanVoorraad(id, vingerafdruk(bitmap));
  return id;
}

async function ensureQuartetImages(q) {
  if (q) await Promise.all(q.cards.map((c) => ensureImage(c.photoId)));
}

async function ensureImage(photoId) {
  if (!photoId || images.has(photoId)) return;
  const blob = await store.getPhoto(photoId);
  if (!blob) return;
  try {
    images.set(photoId, await createImageBitmap(blob));
  } catch (e) { /* stuk bestand: laat leeg */ }
}

/* ---------------- tekenen ---------------- */

function cardModel(q, qi, ci) {
  const c = q.cards[ci];
  return {
    theme: q.theme,
    number: qi + 1,
    titles: q.cards.map((x) => x.title.trim()),
    activeIndex: ci,
    image: c.photoId ? gedraaid(images.get(c.photoId), draaiVan(c.photoId)) : null,
    focus: c.focus,
    zoom: c.zoom,
    fit: c.fit,
  };
}

function paint(canvas, q, qi, ci) {
  const cssW = canvas.clientWidth || 220;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(cssW * dpr);
  const H = Math.round(W * CARD_RATIO);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  drawCard(canvas.getContext('2d'), W, cardModel(q, qi, ci), style(q));
}

function repaintQuartet() {
  const q = game.quartets[current];
  if (!q) return;
  const dubbel = zoekDubbel(game);
  document.querySelectorAll('.cardcol').forEach((col) => {
    const ook = dubbel.get(`${current}:${col.dataset.i}`);
    const label = col.querySelector('.dubbel-label');
    label.hidden = !ook;
    if (ook) {
      label.title = 'Deze foto staat ook op ' + ook.map((p) => beschrijfPlek(game, p)).join(', ')
        + '. Klik om ernaartoe te gaan.';
      label.onclick = () => gaNaarPlek(ook[0]);
    }
    const ci = Number(col.dataset.i);
    paint(col.querySelector('canvas'), q, current, ci);
    const c = q.cards[ci];
    col.querySelector('.preview').classList.toggle('has-photo', !!c.photoId);
    col.querySelector('.preview').classList.toggle('has-content', !!(c.photoId || c.title.trim()));
  });
}

/* ---------------- ja / misschien / nee ---------------- */
// Er kunnen er uiteindelijk maar 15 besteld worden: per kwartet een keuze.

const MAX_BESTELLEN = 15;
const KEUZES = {
  ja: { teken: '✓', tekst: 'ja' },
  misschien: { teken: '?', tekst: 'misschien' },
  nee: { teken: '✗', tekst: 'nee' },
};
const KEUZE_VOLGORDE = [undefined, 'ja', 'misschien', 'nee'];

function zetKeuze(q, keuze) {
  if (keuze) q.keuze = keuze; else delete q.keuze;
  renderSidebar();
  if (game.quartets[current] === q) toonKeuzeInEditor(q);
  save();
}

function toonKeuzeInEditor(q) {
  document.querySelectorAll('.keuze-knoppen button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.keuze === q.keuze));
  });
  const kaarten = el('.cards');
  if (kaarten) kaarten.classList.toggle('nee', q.keuze === 'nee');
}

// De tellers zijn tegelijk het filter: klik op ✓, ?, ✗ of ○ om alleen die
// kwartetten te zien, en nog eens om weer alles te tonen.
let filter = null;
try {
  const bewaard = localStorage.getItem('kwartet-filter');
  if (['ja', 'misschien', 'nee', 'geen'].includes(bewaard)) filter = bewaard;
} catch (e) { /* */ }

function zetFilter(keuze) {
  filter = filter === keuze ? null : keuze;
  try {
    if (filter) localStorage.setItem('kwartet-filter', filter);
    else localStorage.removeItem('kwartet-filter');
  } catch (e) { /* */ }
  renderSidebar();
}

// Volgorde bij hernummeren: eerst ja, dan misschien, dan zonder keuze, dan nee.
const KEUZE_RANG = { ja: 0, misschien: 1, nee: 3 };
const rangVan = (q) => (q.keuze in KEUZE_RANG ? KEUZE_RANG[q.keuze] : 2);

function hernummer() {
  if (!game.quartets.some((q) => KEUZES[q.keuze])) {
    toast('Kies eerst bij een paar kwartetten ja, misschien of nee.', 5000);
    return;
  }
  const tel = { ja: 0, misschien: 0, nee: 0, geen: 0 };
  for (const q of game.quartets) tel[q.keuze || 'geen']++;
  if (!confirm('De kwartetten krijgen een nieuwe volgorde: eerst ja, dan misschien, '
    + 'dan zonder keuze, en nee als laatste.\n\nDe nummers staan op de kaartjes, dus die '
    + 'veranderen mee. Al geprinte kaartjes kloppen daarna niet meer. Doorgaan?')) return;

  const oudeVolgorde = new Map(game.quartets.map((q, i) => [q.id, i]));
  const huidigId = game.quartets[current] && game.quartets[current].id;
  const opVolgorde = (lijst, sleutel) => [...lijst].sort((a, b) => sleutel(a) - sleutel(b));

  game.quartets = opVolgorde(game.quartets.map((q, i) => ({ q, i })),
    (x) => rangVan(x.q) * 10000 + x.i).map((x) => x.q);     // gelijke keuze: eigen volgorde houden

  if (sorteerAZ) {                                          // anders zie je het resultaat niet
    sorteerAZ = false;
    try { localStorage.setItem('kwartet-sortering', 'nr'); } catch (e) { /* */ }
  }
  save();
  select(Math.max(0, game.quartets.findIndex((q) => q.id === huidigId)));
  toast(`Hernummerd: ${tel.ja} × ja, ${tel.misschien} × misschien, ${tel.geen} zonder keuze, ${tel.nee} × nee.`,
    9000, {
      tekst: 'Ongedaan maken',
      doe: () => {
        game.quartets = opVolgorde(game.quartets, (q) => (oudeVolgorde.has(q.id) ? oudeVolgorde.get(q.id) : 1e6));
        save();
        select(Math.max(0, game.quartets.findIndex((q) => q.id === huidigId)));
      },
    });
}

function renderKeuzeTeller() {
  const tel = { ja: 0, misschien: 0, nee: 0, geen: 0 };
  for (const q of game.quartets) tel[q.keuze || 'geen']++;
  const teller = el('#keuzeTeller');
  teller.innerHTML = '';
  if (!tel.ja && !tel.misschien && !tel.nee) {
    teller.innerHTML = '<span class="muted">Klik op ○ om ja, misschien of nee te kiezen</span>';
    return;
  }

  const teVeel = tel.ja - MAX_BESTELLEN;
  const chips = [
    ['ja', `✓ ${tel.ja}/${MAX_BESTELLEN}`, teVeel > 0
      ? `${teVeel} te veel op ja: er kunnen er ${MAX_BESTELLEN} besteld worden`
      : `${tel.ja} op ja van de ${MAX_BESTELLEN} die besteld kunnen worden`],
    ['misschien', `? ${tel.misschien}`, `${tel.misschien} op misschien`],
    ['nee', `✗ ${tel.nee}`, `${tel.nee} op nee`],
    ['geen', `○ ${tel.geen}`, `${tel.geen} nog niet gekozen`],
  ];
  for (const [keuze, tekst, uitleg] of chips) {
    if (keuze === 'geen' && !tel.geen) continue;
    const knop = document.createElement('button');
    knop.type = 'button';
    knop.className = `chip k-${keuze}-tekst${keuze === 'ja' && teVeel > 0 ? ' te-veel' : ''}`;
    knop.textContent = tekst;
    knop.setAttribute('aria-pressed', String(filter === keuze));
    knop.title = `${uitleg}. Klik om ${filter === keuze ? 'weer alles te tonen' : 'alleen deze te tonen'}.`;
    knop.addEventListener('click', () => zetFilter(keuze));
    teller.appendChild(knop);
  }
  if (filter) {
    const alles = document.createElement('button');
    alles.type = 'button';
    alles.className = 'chip alles';
    alles.textContent = 'toon alles';
    alles.addEventListener('click', () => zetFilter(null));
    teller.appendChild(alles);
  }
}

/* ---------------- sidebar ---------------- */

// Bij aanwijzen klapt de zijbalk uit tot de namen helemaal passen. Pas na even
// stilhouden: in split screen met Photos schiet je muis er vaak overheen.
function wireSidebarHover() {
  const bar = el('.sidebar');
  let timer = null;
  const open = () => { timer = setTimeout(() => bar.classList.add('expanded'), 280); };
  const close = () => { clearTimeout(timer); bar.classList.remove('expanded'); };
  bar.addEventListener('mouseenter', open);
  bar.addEventListener('mouseleave', close);
  window.addEventListener('dragenter', close);      // nooit uitgeklapt tijdens slepen
}

// A-Z sorteert alleen de lijst, niet het spel: het nummer staat óp de kaartjes,
// en geprinte kaartjes moeten blijven kloppen.
let sorteerAZ = false;
try { sorteerAZ = localStorage.getItem('kwartet-sortering') === 'az'; } catch (e) { /* */ }

function lijstVolgorde() {
  let idx = game.quartets.map((_, i) => i);
  if (filter) idx = idx.filter((i) => (game.quartets[i].keuze || 'geen') === filter);
  if (!sorteerAZ) return idx;
  const naam = (i) => game.quartets[i].theme.trim();
  return idx.sort((a, b) => {
    if (!naam(a) !== !naam(b)) return naam(a) ? -1 : 1;          // zonder thema achteraan
    return naam(a).localeCompare(naam(b), 'nl', { sensitivity: 'base', numeric: true }) || a - b;
  });
}

function renderSidebar() {
  // Heeft niemand iets gekozen (bijv. na Nieuw spel), dan zijn er ook geen
  // filterknoppen om het filter uit te zetten: dan het filter zelf uitzetten.
  if (filter && !game.quartets.some((q) => KEUZES[q.keuze])) {
    filter = null;
    try { localStorage.removeItem('kwartet-filter'); } catch (e) { /* */ }
  }
  const list = el('#quartetList');
  list.innerHTML = '';
  const dubbel = zoekDubbel(game);
  const knop = el('#sorteer');
  knop.setAttribute('aria-pressed', String(sorteerAZ));
  knop.title = sorteerAZ ? 'Gesorteerd op naam. Klik voor de volgorde van de nummers.' : 'Sorteer de lijst op naam (de nummers op de kaartjes blijven gelijk)';
  lijstVolgorde().forEach((i) => {
    const q = game.quartets[i];
    const li = document.createElement('li');
    li.className = [i === current ? 'active' : '', q.keuze === 'nee' ? 'nee' : ''].join(' ').trim();
    const k = KEUZES[q.keuze];
    li.innerHTML = `<button class="keuze k-${q.keuze || 'leeg'}" type="button"
        title="${k ? `Gekozen: ${k.tekst}. ` : ''}Klik om te wisselen: ja, misschien, nee">${k ? k.teken : '○'}</button>
      <span class="num">${i + 1}</span>
      <span class="swatch" style="background:${q.color}"></span>
      <span class="name ${q.theme.trim() ? '' : 'empty'}">${escapeHtml(q.theme.trim() || 'zonder thema')}</span>
      ${q.cards.some((_, ci) => dubbel.has(`${i}:${ci}`)) ? '<span class="dubbel-stip" title="Hier staat een foto die ook elders gebruikt wordt">⚠</span>' : ''}
      <span class="dots">${q.cards.map((c) => `<i class="${c.photoId ? 'on' : ''}" style="${c.photoId ? `background:${q.color}` : ''}"></i>`).join('')}</span>`;
    if (i === current) li.style.background = mix(q.color, '#ffffff', 0.88);
    const titels = q.cards.map((c) => c.title.trim()).filter(Boolean);
    li.title = [q.theme.trim() || 'zonder thema', ...titels].join('\n');
    li.addEventListener('click', () => select(i));
    li.querySelector('.keuze').addEventListener('click', (e) => {
      e.stopPropagation();                         // niet ook het kwartet openen
      const nu = KEUZE_VOLGORDE.indexOf(q.keuze);
      zetKeuze(q, KEUZE_VOLGORDE[(nu + 1) % KEUZE_VOLGORDE.length]);
    });
    list.appendChild(li);
  });
  renderVoorraad();
  if (filter && !list.children.length) {
    const leeg = document.createElement('li');
    leeg.className = 'lijst-leeg';
    leeg.textContent = 'Geen kwartetten met dit filter.';
    list.appendChild(leeg);
  }
  renderKeuzeTeller();
  const done = game.quartets.filter((q) => cardsDone(q) === 4).length;
  el('#progress').textContent = `${done}/${game.quartets.length}`;
  el('#progress').title = `${done} van de ${game.quartets.length} kwartetten compleet (vier foto's en titels)`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function select(i) {
  current = Math.max(0, Math.min(i, game.quartets.length - 1));
  lastFocusedCard = 0;
  const q = game.quartets[current];
  if (q) document.documentElement.style.setProperty('--accent', q.color);
  renderSidebar();
  renderEditor();
  renderTaken();
  // Bij opslag op de server komen de foto's per kwartet binnen; even bijtekenen.
  ensureQuartetImages(q).then(() => { if (game.quartets[current] === q) repaintQuartet(); });
}

/* ---------------- editor ---------------- */

function renderEditor() {
  const editor = el('#editor');
  const q = game.quartets[current];
  if (!q) {
    editor.innerHTML = '<div class="empty-state">Nog geen kwartetten. Voeg er een toe in de zijbalk.</div>';
    return;
  }

  editor.innerHTML = `
    <div class="editor-head">
      <span class="qnum">${current + 1}</span>
      <input id="theme" class="theme-input" type="text" placeholder="Thema, bijv. Actief" autocomplete="off"
             aria-label="Thema van kwartet ${current + 1}"
             title="De vier titels verschijnen automatisch op alle kaartjes van dit kwartet">
      <div class="theme-color">
        <input id="themeColor" type="color" title="Kleur van dit kwartet">
        <button id="autoColor" class="btn link" title="Kies automatisch een kleur die nog niet in gebruik is">automatisch</button>
      </div>
      <div class="keuze-knoppen" role="group" aria-label="Bestellen?">
        <button type="button" class="k-ja" data-keuze="ja" title="Ja, dit kwartet bestellen">✓</button>
        <button type="button" class="k-misschien" data-keuze="misschien" title="Misschien">?</button>
        <button type="button" class="k-nee" data-keuze="nee" title="Nee, niet bestellen">✗</button>
      </div>
      <div class="editor-actions">
        <button id="exportQuartet" class="btn" title="Exporteer de vier kaartjes als mapje (zip)">Exporteer</button>
        <button id="deleteQuartet" class="btn">Verwijderen</button>
      </div>
    </div>
    <div class="cards">
      ${q.cards.map((c, i) => `
        <div class="cardcol" data-i="${i}">
          <div class="preview">
            <button class="dubbel-label" type="button" hidden>⚠ dubbel</button>
            <canvas title="Sleep een foto hierheen of klik om er een te kiezen. Met foto: slepen verschuift, scrollen zoomt."></canvas>
            <div class="photo-tools">
              <span class="icon grip" draggable="true" data-act="grip"
                    title="Sleep naar een ander kaartje om ze te wisselen (houd ⌥ ingedrukt voor alleen de foto)">⠿</span>
              <span class="spring"></span>
              <button class="icon" data-act="pick" title="Foto kiezen">🖼</button>
              <button class="icon fit" data-act="fit"></button>
              <button class="icon" data-act="draai" title="Foto een kwartslag draaien">⟳</button>
              <button class="icon" data-act="clear" title="Foto verwijderen">✕</button>
              <button class="icon" data-act="empty" title="Kaartje leegmaken (foto en titel)">🗑</button>
              <input class="zoom" type="range" min="1" max="3" step="0.01" title="Inzoomen (of scroll op de foto)">
            </div>
          </div>
          <div class="titelrij">
            <span class="grip-titel" draggable="true" title="Sleep naar een andere titel om ze te wisselen">⠿</span>
            <input class="title" type="text" placeholder="Titel ${i + 1}" autocomplete="off">
          </div>
        </div>`).join('')}
    </div>`;

  const themeInput = el('#theme');
  themeInput.value = q.theme;
  themeInput.addEventListener('input', () => {
    q.theme = themeInput.value;
    repaintQuartet();
    renderSidebar();
    save();
  });

  const colorInput = el('#themeColor');
  colorInput.value = q.color;
  const applyColor = (hex) => {
    q.color = hex;
    colorInput.value = hex;
    document.documentElement.style.setProperty('--accent', hex);
    repaintQuartet();
    renderSidebar();
    save();
  };
  colorInput.addEventListener('input', () => applyColor(colorInput.value));
  el('#autoColor').addEventListener('click', () => {
    applyColor(pickColor(game.quartets.filter((x) => x !== q).map((x) => x.color)));
  });

  document.querySelectorAll('.keuze-knoppen button').forEach((b) => b.addEventListener('click', () => {
    zetKeuze(q, q.keuze === b.dataset.keuze ? undefined : b.dataset.keuze);   // nog eens klikken = wissen
  }));
  toonKeuzeInEditor(q);

  el('#exportQuartet').addEventListener('click', () => exportQuartet(current));
  el('#deleteQuartet').addEventListener('click', () => deleteQuartet(current));

  editor.querySelectorAll('.cardcol').forEach((col) => {
    const ci = Number(col.dataset.i);
    const card = q.cards[ci];
    const titleInput = col.querySelector('.title');
    const zoom = col.querySelector('.zoom');
    const preview = col.querySelector('.preview');
    const canvas = col.querySelector('canvas');

    titleInput.value = card.title;
    zoom.value = card.zoom;
    titleInput.addEventListener('focus', () => { lastFocusedCard = ci; });
    titleInput.addEventListener('input', () => {
      card.title = titleInput.value;
      repaintQuartet();          // titel wordt op alle vier de kaartjes getoond
      renderSidebar();
      save();
    });

    zoom.addEventListener('input', () => {
      card.zoom = Number(zoom.value);
      paint(canvas, q, current, ci);
      save();
    });

    col.querySelector('[data-act=pick]').addEventListener('click', () => pickFiles(ci));
    canvas.addEventListener('click', () => { if (!card.photoId) pickFiles(ci); });
    col.querySelector('[data-act=clear]').addEventListener('click', async () => {
      if (!card.photoId) return;
      // De foto blijft in de voorraad; alleen van dit kaartje af.
      card.photoId = null;
      card.focus = { x: .5, y: .5 };
      card.zoom = 1;
      card.fit = 'vullen';
      delete card.fotoHash;
      zoom.value = 1;
      repaintQuartet();
      renderSidebar();
      save();
    });

    wireDrop(preview,
      (files) => { lastFocusedCard = ci; return placeFiles(ci, files); },
      (van, alleenFoto) => wisselKaartjes(van, ci, alleenFoto),
      (id) => gebruikFoto(ci, id));

    // kaartje oppakken aan de greep
    const grip = col.querySelector('[data-act=grip]');
    grip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(KAART_TYPE, String(ci));
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setDragImage(canvas, canvas.clientWidth / 2, 30);
      col.classList.add('bron');
    });
    grip.addEventListener('dragend', () => col.classList.remove('bron'));

    // titels los wisselen
    const titelrij = col.querySelector('.titelrij');
    const titelGrip = col.querySelector('.grip-titel');
    titelGrip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(TITEL_TYPE, String(ci));
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setDragImage(titelrij, 20, 16);
      titelrij.classList.add('bron');
    });
    titelGrip.addEventListener('dragend', () => titelrij.classList.remove('bron'));
    let titelDiepte = 0;
    const isTitel = (e) => e.dataTransfer.types.includes(TITEL_TYPE);
    titelrij.addEventListener('dragenter', (e) => { if (!isTitel(e)) return; e.preventDefault(); titelDiepte++; titelrij.classList.add('over'); });
    titelrij.addEventListener('dragover', (e) => { if (!isTitel(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    titelrij.addEventListener('dragleave', () => { if (--titelDiepte <= 0) { titelDiepte = 0; titelrij.classList.remove('over'); } });
    titelrij.addEventListener('drop', (e) => {
      if (!isTitel(e)) return;
      e.preventDefault();
      titelDiepte = 0;
      titelrij.classList.remove('over');
      wisselTitels(Number(e.dataTransfer.getData(TITEL_TYPE)), ci);
    });

    col.querySelector('[data-act=empty]').addEventListener('click', () => maakLeeg(ci));

    col.querySelector('[data-act=draai]').addEventListener('click', () => draaiFoto(card.photoId));

    const fitKnop = col.querySelector('[data-act=fit]');
    const toonFit = () => {
      const passend = card.fit === 'passend';
      fitKnop.textContent = passend ? '▣' : '⬚';
      fitKnop.title = passend ? 'Nu: hele foto met vervaagde randen. Klik om het kader te vullen.'
                              : 'Nu: kader gevuld. Klik om de hele foto te tonen (met vervaagde randen).';
      fitKnop.setAttribute('aria-pressed', String(passend));
    };
    toonFit();
    fitKnop.addEventListener('click', () => {
      card.fit = card.fit === 'passend' ? 'vullen' : 'passend';
      card.zoom = 1;
      card.focus = { x: .5, y: .5 };
      zoom.value = 1;
      toonFit();
      paint(canvas, q, current, ci);
      save();
    });
    wirePan(canvas, preview, {
      model: () => game.quartets[current].cards[ci],
      rect: () => photoRect(1),
      repaint: () => paint(canvas, game.quartets[current], current, ci),
      zoomInput: () => zoom,
    });
  });

  repaintQuartet();
}

/* ---------------- kaartjes wisselen en leegmaken ---------------- */

const FOTO_VELDEN = ['photoId', 'focus', 'zoom', 'fit', 'fotoHash'];

function wisselKaartjes(a, b, alleenFoto) {
  if (a === b || Number.isNaN(a)) return;
  const q = game.quartets[current];
  const velden = alleenFoto ? FOTO_VELDEN : [...FOTO_VELDEN, 'title'];
  for (const k of velden) [q.cards[a][k], q.cards[b][k]] = [q.cards[b][k], q.cards[a][k]];
  renderEditor();
  renderSidebar();
  save();
  toast(alleenFoto ? `Foto's van kaartje ${a + 1} en ${b + 1} gewisseld.` : `Kaartje ${a + 1} en ${b + 1} gewisseld.`);
}

function wisselTitels(a, b) {
  if (a === b || Number.isNaN(a)) return;
  const q = game.quartets[current];
  [q.cards[a].title, q.cards[b].title] = [q.cards[b].title, q.cards[a].title];
  renderEditor();
  renderSidebar();
  save();
  toast(`Titels ${a + 1} en ${b + 1} gewisseld.`);
}

function maakLeeg(ci) {
  const q = game.quartets[current];
  const card = q.cards[ci];
  if (!card.photoId && !card.title.trim()) return;
  const vorige = { title: card.title, photoId: card.photoId, focus: { ...card.focus }, zoom: card.zoom, fit: card.fit, fotoHash: card.fotoHash };
  // De foto zelf blijft in de voorraad, dus "ongedaan maken" kan altijd.
  Object.assign(card, { title: '', photoId: null, focus: { x: .5, y: .5 }, zoom: 1, fit: 'vullen' });
  delete card.fotoHash;
  renderEditor();
  renderSidebar();
  save();
  toast(`Kaartje ${ci + 1} leeggemaakt.`, 7000, {
    tekst: 'Ongedaan maken',
    doe: () => {
      // Opzoeken via id: het spel kan intussen door een andere computer zijn bijgewerkt.
      const qq = game.quartets.find((x) => x.id === q.id);
      if (!qq) return;
      Object.assign(qq.cards[ci], vorige);
      if (game.quartets[current] === qq) renderEditor();
      ensureQuartetImages(qq).then(repaintQuartet);
      renderSidebar();
      save();
    },
  });
}

/* ---------------- dubbele foto's ---------------- */
// Herkend aan wat er op de foto staat (dubbel.js), dus ook als dezelfde foto
// vanaf een andere computer of als ander bestand is geplaatst.

function gaNaarPlek(plek) {
  if (plek.achter) { openPrintDialog(); return; }
  select(plek.qi);
  const col = document.querySelector(`.cardcol[data-i="${plek.ci}"]`);
  if (col) {
    col.classList.remove('knipper');
    void col.offsetWidth;                          // animatie opnieuw starten
    col.classList.add('knipper');
  }
}

function meldDubbel(kaartjes) {
  const dubbel = zoekDubbel(game);
  const ci = kaartjes.find((i) => dubbel.has(`${current}:${i}`));
  if (ci === undefined) return;
  const ander = dubbel.get(`${current}:${ci}`)[0];
  toast(`Let op: de foto op kaartje ${ci + 1} staat ook op ${beschrijfPlek(game, ander)}.`, 9000,
        { tekst: 'Toon', doe: () => gaNaarPlek(ander) });
}

// Foto's zonder vingerafdruk (van vóór deze functie, of van een oudere versie)
// krijgen er alsnog een. Rustig één voor één, zodat de host niet gaat afremmen,
// en zonder alle foto's in het geheugen te houden.
let vingerafdrukkenBezig = false;
async function vulVingerafdrukken() {
  if (vingerafdrukkenBezig) return;
  vingerafdrukkenBezig = true;
  try {
    const ids = new Set();
    for (const q of game.quartets) for (const c of q.cards) if (c.photoId && !c.fotoHash) ids.add(c.photoId);
    if (game.back.photoId && !game.back.fotoHash) ids.add(game.back.photoId);
    for (const f of game.voorraad) if (!f.fotoHash) ids.add(f.id);
    let gedaan = 0;
    for (const id of ids) {
      let img = images.get(id);
      let tijdelijk = null;
      if (!img) {
        try {
          const blob = await store.getPhoto(id);
          if (blob) img = tijdelijk = await createImageBitmap(blob);
        } catch (e) { /* overslaan */ }
      }
      if (!img) continue;
      const vd = vingerafdruk(img);
      if (tijdelijk && tijdelijk.close) tijdelijk.close();
      // Opzoeken in het actuele spel: dat kan intussen door een ander zijn bijgewerkt.
      for (const q of game.quartets) for (const c of q.cards) if (c.photoId === id && !c.fotoHash) c.fotoHash = vd;
      if (game.back.photoId === id && !game.back.fotoHash) game.back.fotoHash = vd;
      for (const f of game.voorraad) if (f.id === id && !f.fotoHash) f.fotoHash = vd;
      gedaan++;
      if (tijdelijk && store.opServer) await new Promise((r) => setTimeout(r, 250));
    }
    if (gedaan) { save(); renderSidebar(); repaintQuartet(); }
  } finally {
    vingerafdrukkenBezig = false;
  }
}

/* ---------------- foto's plaatsen ---------------- */

let pickTarget = 0;
function pickFiles(ci) {
  pickTarget = ci;
  el('#filePicker').value = '';
  el('#filePicker').click();
}

async function placeFiles(startIndex, files) {
  const geplaatst = [];
  const q = game.quartets[current];
  const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  if (!list.length) { toast('Geen afbeelding gevonden in wat je sleepte.'); return; }
  let i = startIndex;
  for (const file of list) {
    if (i > 3) break;
    const card = q.cards[i];
    try {
      const id = await importFile(file);
      card.photoId = id;
      card.focus = { x: .5, y: .5 };
      card.zoom = 1;
      // Het fotovak is liggend; van een staande foto zou bij 'vullen' het
      // grootste deel wegvallen. Dan standaard de hele foto met vervaagde randen.
      const img = images.get(id);
      card.fit = img && img.height > img.width * 1.05 ? 'passend' : 'vullen';
      if (img) card.fotoHash = vingerafdruk(img); else delete card.fotoHash;
      geplaatst.push(i);
    } catch (err) {
      toast(`Kon "${file.name}" niet lezen. HEIC werkt in Safari; zet het anders om naar JPEG.`);
    }
    i++;
  }
  renderEditor();
  renderSidebar();
  save();
  meldDubbel(geplaatst);
}

const KAART_TYPE = 'application/x-kwartet-kaart';
const FOTO_TYPE = 'application/x-kwartet-foto';      // een foto uit de voorraad
const TITEL_TYPE = 'application/x-kwartet-titel';

// onKaart (optioneel): er wordt een ander kaartje uit de app op gesleept.
function wireDrop(preview, onFiles, onKaart, onFoto) {
  let depth = 0;
  const intern = (e) => onKaart && e.dataTransfer.types.includes(KAART_TYPE);
  const uitVoorraad = (e) => onFoto && e.dataTransfer.types.includes(FOTO_TYPE);
  const alleenTitel = (e) => e.dataTransfer.types.includes(TITEL_TYPE);
  preview.addEventListener('dragenter', (e) => {
    if (alleenTitel(e)) return;
    e.preventDefault();
    depth++;
    preview.classList.add(intern(e) ? 'over-wissel' : 'over');
  });
  preview.addEventListener('dragover', (e) => {
    if (alleenTitel(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = intern(e) ? 'move' : 'copy';
  });
  preview.addEventListener('dragleave', () => {
    if (--depth <= 0) { depth = 0; preview.classList.remove('over', 'over-wissel'); }
  });
  preview.addEventListener('drop', async (e) => {
    if (alleenTitel(e)) return;
    e.preventDefault();
    depth = 0;
    preview.classList.remove('over', 'over-wissel');
    const dt = e.dataTransfer;
    if (uitVoorraad(e)) { onFoto(dt.getData(FOTO_TYPE)); return; }
    if (intern(e)) { onKaart(Number(dt.getData(KAART_TYPE)), e.altKey); return; }
    if (dt.files && dt.files.length) { await onFiles(dt.files); return; }
    const uri = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split('\n')[0].trim();
    if (/^https?:/.test(uri)) {
      try {
        const res = await fetch(uri);
        const blob = await res.blob();
        await onFiles([new File([blob], 'foto', { type: blob.type })]);
      } catch (err) {
        toast('Die afbeelding staat op een site die downloaden blokkeert. Bewaar hem eerst lokaal.');
      }
    }
  });
}

// slepen in het kaartje = uitsnede verschuiven
// target: { model() -> {photoId, focus, zoom}, rect() -> vak in kaartbreedtes, repaint(), zoomInput }
function wirePan(canvas, preview, target) {
  let active = false, lastX = 0, lastY = 0;
  const card = target.model;

  canvas.addEventListener('pointerdown', (e) => {
    if (!card().photoId) return;
    active = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    preview.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active) return;
    const img = images.get(card().photoId);
    if (!img) return;
    const p = target.rect();
    const passend = card().fit === 'passend';
    const s = (passend ? Math.min : Math.max)(p.w / img.width, p.h / img.height) * card().zoom;
    const dw = img.width * s, dh = img.height * s;
    const unit = canvas.clientWidth || 1;
    const c = card();
    // Werkt in beide richtingen: bij 'vullen' is de foto groter dan het vak, bij
    // 'hele foto' vaak smaller - dan schuif je hem binnen het vak heen en weer.
    if (Math.abs(dw - p.w) > 1e-6) c.focus.x = clamp(c.focus.x + (e.clientX - lastX) / unit / (p.w - dw), 0, 1);
    if (Math.abs(dh - p.h) > 1e-6) c.focus.y = clamp(c.focus.y + (e.clientY - lastY) / unit / (p.h - dh), 0, 1);
    lastX = e.clientX; lastY = e.clientY;
    target.repaint();
  });
  const stop = (e) => {
    if (!active) return;
    active = false;
    preview.classList.remove('dragging');
    save();
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  canvas.addEventListener('wheel', (e) => {
    const c = card();
    if (!c.photoId) return;
    e.preventDefault();
    c.zoom = clamp(c.zoom * (1 - e.deltaY * 0.0015), 1, 3);
    if (target.zoomInput) target.zoomInput().value = c.zoom;
    target.repaint();
    save();
  }, { passive: false });
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ---------------- export ---------------- */

function safeName(s, fallback) {
  const t = (s || '').trim().replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ');
  return t || fallback;
}

async function cardPng(q, qi, ci) {
  const W = EXPORT_WIDTH;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = Math.round(W * CARD_RATIO);
  drawCard(canvas.getContext('2d'), W, { ...cardModel(q, qi, ci), hints: false }, style(q));
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

async function quartetFiles(qi, prefixWithFolder = true) {
  const q = game.quartets[qi];
  for (const c of q.cards) await ensureImage(c.photoId);
  const folder = `${String(qi + 1).padStart(2, '0')} ${safeName(q.theme, 'zonder thema')}`;
  const files = [];
  for (let ci = 0; ci < 4; ci++) {
    const name = `${ci + 1} ${safeName(q.cards[ci].title, 'zonder titel')}.png`;
    files.push({
      name: prefixWithFolder ? `${folder}/${name}` : name,
      data: await cardPng(q, qi, ci),
    });
  }
  return { folder, files };
}

async function exportQuartet(qi) {
  toast('Bezig met exporteren…', 60000);
  const { folder, files } = await quartetFiles(qi, true);
  downloadBlob(makeZip(files), `${folder}.zip`);
  toast(`"${folder}" geëxporteerd (4 kaartjes in een mapje).`);
}

async function exportAll() {
  const btn = el('#exportAll');
  btn.disabled = true;
  try {
    const all = [];
    for (let qi = 0; qi < game.quartets.length; qi++) {
      toast(`Exporteren… kwartet ${qi + 1} van ${game.quartets.length}`, 60000);
      const { files } = await quartetFiles(qi, true);
      all.push(...files);
      await new Promise((r) => setTimeout(r, 0));   // even lucht voor de UI
    }
    downloadBlob(makeZip(all), `${safeName(game.title, 'Kwartet')}.zip`);
    toast(`Klaar: ${game.quartets.length} mapjes met ${all.length} kaartjes.`);
  } finally {
    btn.disabled = false;
  }
}


/* ---------------- printvellen ---------------- */
// A4 met 3 x 3 kaartjes van 63 x 88 mm. De achterkanten staan per rij in
// omgekeerde volgorde, zodat ze kloppen als de printer het vel omslaat over de
// lange kant (de linkerkolom komt dan rechts te liggen).

const PRINT = {
  dpi: 300,
  pageW: 210, pageH: 297,          // mm
  cardW: 63, cardH: 88,
  cols: 3, rows: 3,
  mark: 4,                          // lengte snijlijn in mm
};

const mm = (v) => Math.round((v / 25.4) * PRINT.dpi);

function newPageCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = mm(PRINT.pageW);
  canvas.height = mm(PRINT.pageH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

function cellOrigin(col, row) {
  const left = (PRINT.pageW - PRINT.cols * PRINT.cardW) / 2;
  const top = (PRINT.pageH - PRINT.rows * PRINT.cardH) / 2;
  return { x: mm(left + col * PRINT.cardW), y: mm(top + row * PRINT.cardH) };
}

function drawCutMarks(ctx) {
  const left = (PRINT.pageW - PRINT.cols * PRINT.cardW) / 2;
  const top = (PRINT.pageH - PRINT.rows * PRINT.cardH) / 2;
  ctx.save();
  ctx.strokeStyle = '#9aa3ab';
  ctx.lineWidth = Math.max(1, mm(0.12));
  ctx.beginPath();
  for (let c = 0; c <= PRINT.cols; c++) {
    const x = mm(left + c * PRINT.cardW) + 0.5;
    ctx.moveTo(x, mm(top - PRINT.mark)); ctx.lineTo(x, mm(top));
    ctx.moveTo(x, mm(top + PRINT.rows * PRINT.cardH));
    ctx.lineTo(x, mm(top + PRINT.rows * PRINT.cardH + PRINT.mark));
  }
  for (let r = 0; r <= PRINT.rows; r++) {
    const y = mm(top + r * PRINT.cardH) + 0.5;
    ctx.moveTo(mm(left - PRINT.mark), y); ctx.lineTo(mm(left), y);
    ctx.moveTo(mm(left + PRINT.cols * PRINT.cardW), y);
    ctx.lineTo(mm(left + PRINT.cols * PRINT.cardW + PRINT.mark), y);
  }
  ctx.stroke();
  ctx.restore();
}

async function pageJpeg(canvas) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
  return { data: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}

const kwartetGebruikt = (q) => q.theme.trim() || q.cards.some((c) => c.title.trim() || c.photoId);

function printableCards(includeEmpty, neeOverslaan) {
  const out = [];
  game.quartets.forEach((q, qi) => {
    if (!kwartetGebruikt(q) && !includeEmpty) return;
    if (neeOverslaan && q.keuze === 'nee') return;
    q.cards.forEach((_, ci) => out.push({ q, qi, ci }));
  });
  return out;
}

async function makePrintSheets(options) {
  const cards = printableCards(options.empty, options.neeOverslaan);
  if (!cards.length) throw new Error('Nog niets om te printen: vul eerst een kwartet.');

  for (const q of new Set(cards.map((c) => c.q))) await ensureQuartetImages(q);
  if (options.backs) await ensureImage(game.back.photoId);

  const perSheet = PRINT.cols * PRINT.rows;
  const cardWpx = mm(PRINT.cardW);
  const pages = [];

  for (let start = 0; start < cards.length; start += perSheet) {
    const group = cards.slice(start, start + perSheet);
    toast(`Printvellen maken… vel ${pages.length / (options.backs ? 2 : 1) + 1}`, 60000);

    // voorkant
    const front = newPageCanvas();
    if (options.marks) drawCutMarks(front.ctx);
    group.forEach((item, i) => {
      const { x, y } = cellOrigin(i % PRINT.cols, Math.floor(i / PRINT.cols));
      front.ctx.save();
      front.ctx.translate(x, y);
      drawCard(front.ctx, cardWpx, { ...cardModel(item.q, item.qi, item.ci), hints: false }, { ...style(item.q), wissen: false });
      front.ctx.restore();
    });
    pages.push(await pageJpeg(front.canvas));

    // achterkant: kolommen gespiegeld
    if (options.backs) {
      const back = newPageCanvas();
      if (options.marks) drawCutMarks(back.ctx);
      const style0 = { bg: '#ffffff', border: '#e7ebee', radius: 0, wissen: false };   // kleur tot de snijlijn
      group.forEach((item, i) => {
        const col = PRINT.cols - 1 - (i % PRINT.cols);
        const { x, y } = cellOrigin(col, Math.floor(i / PRINT.cols));
        back.ctx.save();
        back.ctx.translate(x, y);
        drawBack(back.ctx, cardWpx, backStyle(), style0);
        back.ctx.restore();
      });
      pages.push(await pageJpeg(back.canvas));
    }
    await new Promise((r) => setTimeout(r, 0));
  }

  downloadBlob(makePdf(pages), `${safeName(game.title, 'Kwartet')} - printvellen.pdf`);
  const sheets = options.backs ? pages.length / 2 : pages.length;
  toast(`${cards.length} kaartjes op ${sheets} vel${sheets === 1 ? '' : 'len'}` +
        (options.backs ? ' (met achterkanten, dubbelzijdig omslaan over de lange kant).' : '.'), 6000);
}

/* ---------------- overzicht: één kwartet per pagina ---------------- */
// Om na te kijken, niet om te knippen: de vier kaartjes 2 x 2 zoals in de
// editor, groter dan echt, met het kwartet erboven. Geen achterkanten.

const OVERZICHT = {
  marge: 15,                                 // mm, boven, links en rechts
  onder: 15,                                 // mm, met daarin de paginavoet
  kop: 20,                                   // ruimte voor nummer en thema
  tussen: 8,                                 // tussen de kaartjes
};

async function maakOverzicht(options) {
  const lijst = game.quartets.map((q, qi) => ({ q, qi }))
    .filter(({ q }) => (options.empty || kwartetGebruikt(q)) && !(options.neeOverslaan && q.keuze === 'nee'));
  if (!lijst.length) throw new Error('Nog niets om te printen: vul eerst een kwartet.');

  // Zo groot als past, in de breedte én de hoogte (komt uit op ca. 85 mm breed).
  const kaartB = Math.min(
    (PRINT.pageW - 2 * OVERZICHT.marge - OVERZICHT.tussen) / 2,
    (PRINT.pageH - OVERZICHT.marge - OVERZICHT.kop - OVERZICHT.onder - OVERZICHT.tussen) / (2 * CARD_RATIO),
  );
  const kaartH = kaartB * CARD_RATIO;
  const links = (PRINT.pageW - 2 * kaartB - OVERZICHT.tussen) / 2;
  const pages = [];

  for (const [n, { q, qi }] of lijst.entries()) {
    toast(`Overzicht maken… kwartet ${n + 1} van ${lijst.length}`, 60000);
    await ensureQuartetImages(q);
    const { canvas, ctx } = newPageCanvas();

    // kop: gekleurd blokje, nummer en thema
    const x0 = mm(links);
    const basis = mm(OVERZICHT.marge + 10);
    ctx.fillStyle = q.color;
    ctx.fillRect(x0, basis - mm(6), mm(6), mm(6));
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8b949c';
    ctx.font = `600 ${mm(5)}px ${FONT}`;
    const nummer = `Kwartet ${qi + 1}`;
    ctx.fillText(nummer, x0 + mm(9), basis);
    const na = x0 + mm(9) + ctx.measureText(nummer).width + mm(4);
    ctx.fillStyle = q.color;
    ctx.font = `700 ${mm(7)}px ${FONT}`;
    ctx.fillText(q.theme.trim() || 'zonder thema', na, basis);

    // de vier kaartjes
    const top = OVERZICHT.marge + OVERZICHT.kop;
    q.cards.forEach((_, ci) => {
      const x = links + (ci % 2) * (kaartB + OVERZICHT.tussen);
      const y = top + Math.floor(ci / 2) * (kaartH + OVERZICHT.tussen);
      ctx.save();
      ctx.translate(mm(x), mm(y));
      drawCard(ctx, mm(kaartB), { ...cardModel(q, qi, ci), hints: false }, { ...style(q), wissen: false });
      ctx.restore();
    });

    // voet
    ctx.fillStyle = '#9aa3ab';
    ctx.font = `400 ${mm(3.2)}px ${FONT}`;
    ctx.fillText(game.title || 'Kwartet', x0, mm(PRINT.pageH - 8));
    ctx.textAlign = 'right';
    ctx.fillText(`${n + 1} / ${lijst.length}`, mm(PRINT.pageW - links), mm(PRINT.pageH - 8));

    pages.push(await pageJpeg(canvas));
    await new Promise((r) => setTimeout(r, 0));
  }

  downloadBlob(makePdf(pages), `${safeName(game.title, 'Kwartet')} - overzicht.pdf`);
  toast(`Overzicht klaar: ${lijst.length} ${lijst.length === 1 ? 'pagina' : "pagina's"}.`, 5000);
}

function printSoort() {
  const gekozen = document.querySelector('input[name=printSoort]:checked');
  return gekozen ? gekozen.value : 'vellen';
}

function toonPrintSoort() {
  const overzicht = printSoort() === 'overzicht';
  el('#vellenOpties').classList.toggle('uit', overzicht);
  el('#hintVellen').hidden = overzicht;
  el('#hintOverzicht').hidden = !overzicht;
}

/* ---------------- achterkant-dialoog ---------------- */

function paintBackPreview() {
  const canvas = el('#backPreview');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round((canvas.clientWidth || 200) * dpr);
  const H = Math.round(W * CARD_RATIO);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  drawBack(canvas.getContext('2d'), W, backStyle(), { bg: '#ffffff', border: '#e7ebee' });
}

function updateBackControls() {
  const heeftFoto = !!game.back.photoId;
  const passend = game.back.fit === 'passend';
  el('#backFit').disabled = !heeftFoto;
  el('#backDraai').disabled = !heeftFoto;
  el('#backFit').textContent = passend ? '▣' : '⬚';
  el('#backFit').title = passend ? 'Nu: hele afbeelding met vervaagde randen. Klik om te vullen.'
                                 : 'Nu: gevuld. Klik om de hele afbeelding te tonen (met vervaagde randen).';
  el('#backFit').setAttribute('aria-pressed', String(passend));
  el('#backPattern').disabled = heeftFoto;
  el('#backZoom').disabled = !heeftFoto;
  el('#backClear').disabled = !heeftFoto;
  el('#backPreview').parentElement.classList.toggle('has-photo', heeftFoto);
}

async function setBackPhoto(files) {
  const file = [...files].find((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  if (!file) { toast('Geen afbeelding gevonden in wat je sleepte.'); return; }
  try {
    const id = await importFile(file);
    game.back.photoId = id;
    game.back.focus = { x: .5, y: .5 };
    game.back.zoom = 1;
    game.back.fit = 'vullen';
    if (images.get(id)) game.back.fotoHash = vingerafdruk(images.get(id));
    el('#backZoom').value = 1;
    updateBackControls();
    paintBackPreview();
    save();
  } catch (err) {
    toast(`Kon "${file.name}" niet lezen. HEIC werkt in Safari; zet het anders om naar JPEG.`, 6000);
  }
}

function openPrintDialog() {
  el('#backTitle').value = game.back.title;
  el('#backTekstAan').checked = !game.back.tekstUit;
  el('#backTitle').disabled = !!game.back.tekstUit;
  el('#backTitle').placeholder = game.title || 'Naam van het spel';
  el('#backColor').value = game.back.color;
  el('#backPattern').value = game.back.pattern;
  el('#backZoom').value = game.back.zoom;
  updateBackControls();
  el('#printDialog').showModal();
  paintBackPreview();
}

/* ---------------- nieuwe versie ---------------- */
// Staat er op GitHub een nieuwere versie dan deze, dan een melding. Zo blijven er
// geen oude versies lang openstaan naast nieuwe.

function wireVersieCheck() {
  const m = /\/gh\/([^@]+)@([0-9a-f]{40})\//.exec(window.KWARTET_BRON || '');
  if (!m) return;                      // lokaal, of geladen via de terugval: niets te vergelijken
  const [, repo, sha] = m;
  let laatst = 0;
  const kijk = async () => {
    if (document.hidden || Date.now() - laatst < 60000 || el('#nieuweVersie')) return;
    laatst = Date.now();
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/commits/main`, {
        headers: { Accept: 'application/vnd.github.sha' }, cache: 'no-cache',
      });
      if (!res.ok) return;
      const nieuwste = (await res.text()).trim();
      if (/^[0-9a-f]{40}$/.test(nieuwste) && nieuwste !== sha) toonNieuweVersie();
    } catch (e) { /* later weer */ }
  };
  setInterval(kijk, 5 * 60 * 1000);
  window.addEventListener('focus', kijk);
}

async function bewaarNu() {
  clearTimeout(saveTimer);
  while (saving) await new Promise((r) => setTimeout(r, 100));
  await persist();
}

function toonNieuweVersie() {
  const balk = document.createElement('div');
  balk.id = 'nieuweVersie';
  balk.className = 'nieuwe-versie';
  balk.innerHTML = '<span>Er is een nieuwe versie van de Kwartetmaker.</span> <button class="btn primary">Herladen</button>';
  balk.querySelector('button').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Bewaren…';
    try { await bewaarNu(); } finally { location.reload(); }
  });
  document.body.appendChild(balk);
}

/* ---------------- fotovoorraad ---------------- */
// Alle foto's die ooit zijn geüpload. Sleep ze naar een kaartje, of van een
// kaartje (aan ⠿) terug de voorraad in. Weggooien gebeurt alleen hier, bewust.

function voegToeAanVoorraad(id, fotoHash) {
  if (!id || game.voorraad.some((f) => f.id === id)) return false;
  game.voorraad.push({ id, photoId: id, ...(fotoHash ? { fotoHash } : {}), toegevoegd: new Date().toISOString() });
  return true;
}

// Waar staat deze foto? Kaartjes en achterkant.
function plekkenVanFoto(id) {
  const uit = [];
  game.quartets.forEach((q, qi) => q.cards.forEach((c, ci) => { if (c.photoId === id) uit.push({ qi, ci }); }));
  if (game.back.photoId === id) uit.push({ achter: true });
  return uit;
}

// Bij het openen: alles wat al op kaartjes staat of in de opslag zit, erbij.
async function vulVoorraad() {
  let erbij = 0;
  for (const q of game.quartets) for (const c of q.cards) if (voegToeAanVoorraad(c.photoId, c.fotoHash)) erbij++;
  if (voegToeAanVoorraad(game.back.photoId, game.back.fotoHash)) erbij++;
  try {
    for (const id of await store.photoIds()) if (voegToeAanVoorraad(id)) erbij++;
  } catch (e) { /* lijst niet op te halen: de rest staat er al */ }
  if (erbij) { save(); renderVoorraad(); }
}

const verhouding = (hash) => (hash ? Number(hash.split(':')[1]) / 100 : 0);

// Draaiing hoort bij de foto (in de voorraad), niet bij het kaartje: staat hij
// scheef, dan wil je hem overal recht - op elk kaartje, de achterkant, in de bak.
function draaiVan(id) {
  const f = game && game.voorraad.find((x) => x.id === id);
  return (f && f.draai) || 0;
}

function draaiFoto(id) {
  if (!id) return;
  const card0 = game.quartets.flatMap((q) => q.cards).find((c) => c.photoId === id);
  voegToeAanVoorraad(id, card0 && card0.fotoHash);
  const f = game.voorraad.find((x) => x.id === id);
  f.draai = ((f.draai || 0) + 90) % 360;
  if (!f.draai) delete f.draai;
  // Staand is liggend geworden of andersom: vullen/hele foto opnieuw kiezen,
  // en de uitsnede terug naar het midden.
  const img = gedraaid(images.get(id), f.draai || 0);
  for (const q of game.quartets) {
    for (const c of q.cards) {
      if (c.photoId !== id) continue;
      c.focus = { x: .5, y: .5 };
      c.zoom = 1;
      if (img) c.fit = img.height > img.width * 1.05 ? 'passend' : 'vullen';
    }
  }
  if (game.back.photoId === id) {
    game.back.focus = { x: .5, y: .5 };
    game.back.zoom = 1;
    if (el('#printDialog').open) { el('#backZoom').value = 1; paintBackPreview(); }
  }
  renderEditor();
  renderSidebar();
  save();
}

function gebruikFoto(ci, id) {
  slepenUitVoorraad = false;                          // de sleepactie is hiermee klaar
  const q = game.quartets[current];
  const card = q.cards[ci];
  const f = game.voorraad.find((x) => x.id === id);
  if (!f || card.photoId === id) return;
  card.photoId = id;
  card.focus = { x: .5, y: .5 };
  card.zoom = 1;
  let r = verhouding(f.fotoHash);
  if (r && (f.draai === 90 || f.draai === 270)) r = 1 / r;
  card.fit = r && r < 0.95 ? 'passend' : 'vullen';     // staand -> hele foto
  if (f.fotoHash) card.fotoHash = f.fotoHash; else delete card.fotoHash;
  renderEditor();
  renderSidebar();
  save();
  ensureImage(id).then(() => { if (game.quartets[current] === q) repaintQuartet(); });
  meldDubbel([ci]);
}

function gebruikFotoAchterkant(id) {
  slepenUitVoorraad = false;
  const f = game.voorraad.find((x) => x.id === id);
  if (!f) return;
  Object.assign(game.back, { photoId: id, focus: { x: .5, y: .5 }, zoom: 1, fit: 'vullen' });
  if (f.fotoHash) game.back.fotoHash = f.fotoHash; else delete game.back.fotoHash;
  el('#backZoom').value = 1;
  updateBackControls();
  ensureImage(id).then(paintBackPreview);
  renderVoorraad();
  save();
}

function haalVanKaartje(ci) {
  const q = game.quartets[current];
  const card = q.cards[ci];
  if (!card.photoId) return;
  const vorige = { photoId: card.photoId, focus: { ...card.focus }, zoom: card.zoom, fit: card.fit, fotoHash: card.fotoHash };
  voegToeAanVoorraad(card.photoId, card.fotoHash);
  Object.assign(card, { photoId: null, focus: { x: .5, y: .5 }, zoom: 1, fit: 'vullen' });
  delete card.fotoHash;
  renderEditor();
  renderSidebar();
  save();
  toast(`Foto van kaartje ${ci + 1} terug in de voorraad.`, 6000, {
    tekst: 'Ongedaan maken',
    doe: () => {
      const qq = game.quartets.find((x) => x.id === q.id);
      if (!qq) return;
      Object.assign(qq.cards[ci], vorige);
      if (!vorige.fotoHash) delete qq.cards[ci].fotoHash;
      if (game.quartets[current] === qq) renderEditor();
      renderSidebar();
      save();
    },
  });
}

async function voegBestandenToe(files) {
  const lijst = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  if (!lijst.length) { toast('Geen afbeelding gevonden in wat je sleepte.'); return; }
  let gelukt = 0;
  for (const [n, file] of lijst.entries()) {
    toast(`Foto's toevoegen… ${n + 1} van ${lijst.length}`, 60000);
    try { await importFile(file); gelukt++; } catch (err) { /* melding hieronder */ }
    renderVoorraad();
  }
  save();
  toast(gelukt === lijst.length
    ? `${gelukt} foto${gelukt === 1 ? '' : "'s"} in de voorraad gezet.`
    : `${gelukt} van de ${lijst.length} foto's in de voorraad gezet; de rest kon niet gelezen worden (HEIC werkt in Safari).`, 6000);
}

async function gooiWeg(id) {
  if (plekkenVanFoto(id).length) return;               // staat nog op een kaartje
  if (!confirm('Deze foto definitief weggooien? Hij verdwijnt dan ook uit de voorraad.')) return;
  game.voorraad = game.voorraad.filter((f) => f.id !== id);
  images.delete(id);
  for (const k of [...duimnagels.keys()]) if (k.startsWith(id + '@')) duimnagels.delete(k);
  await store.deletePhoto(id);                          // op de server ruimt api.php hem later op
  renderVoorraad();
  save();
}

/* ----- kleine plaatjes voor de voorraad ----- */

const duimnagels = new Map();            // "photoId@draai" -> data-URL van ca. 160 px
const duimSleutel = (id) => `${id}@${draaiVan(id)}`;
let duimRij = Promise.resolve();

async function maakDuimnagel(id) {
  let img = images.get(id);
  let tijdelijk = null;
  if (!img) {
    const blob = await store.getPhoto(id);
    if (!blob) return null;
    img = tijdelijk = await createImageBitmap(blob);
  }
  const beeld = gedraaid(img, draaiVan(id));
  const s = Math.min(1, 160 / Math.max(beeld.width, beeld.height));
  const c = document.createElement('canvas');
  c.width = Math.round(beeld.width * s);
  c.height = Math.round(beeld.height * s);
  c.getContext('2d').drawImage(beeld, 0, 0, c.width, c.height);
  if (tijdelijk && tijdelijk.close) tijdelijk.close();
  return c.toDataURL('image/jpeg', 0.8);
}

// Eén voor één ophalen, zodat de host niet gaat afremmen.
function laadDuimnagel(id) {
  if (duimnagels.has(duimSleutel(id))) return;
  duimRij = duimRij.then(async () => {
    const sleutel = duimSleutel(id);
    if (duimnagels.has(sleutel)) return;
    const onbekend = !images.has(id);
    const url = await maakDuimnagel(id);
    if (!url) return;
    duimnagels.set(sleutel, url);
    document.querySelectorAll(`.voorraad-foto[data-id="${id}"] img`).forEach((i) => { i.src = url; });
    if (onbekend && store.opServer) await new Promise((r) => setTimeout(r, 120));
  }).catch(() => {});
}

const duimKijker = 'IntersectionObserver' in window ? new IntersectionObserver((items) => {
  for (const item of items) {
    if (!item.isIntersecting) continue;
    duimKijker.unobserve(item.target);
    laadDuimnagel(item.target.dataset.id);
  }
}, { rootMargin: '200px' }) : null;

/* ----- tekenen ----- */

let slepenUitVoorraad = false;

function renderVoorraad() {
  if (!game) return;
  const vrij = game.voorraad.filter((f) => !plekkenVanFoto(f.id).length).length;
  el('#voorraadAantal').textContent = vrij;
  el('#voorraadAantal').hidden = !vrij;
  el('#openVoorraad').title = `${game.voorraad.length} foto's, waarvan ${vrij} nog niet op een kaartje`;
  if (el('#voorraad').hidden || slepenUitVoorraad) return;   // niet ombouwen onder een sleepactie

  const alleenVrij = el('#voorraadOngebruikt').checked;
  const raster = el('#voorraadRaster');
  raster.innerHTML = '';
  const lijst = [...game.voorraad]
    .sort((a, b) => String(b.toegevoegd || '').localeCompare(String(a.toegevoegd || '')))
    .filter((f) => !alleenVrij || !plekkenVanFoto(f.id).length);
  if (!lijst.length) {
    raster.innerHTML = `<p class="voorraad-leeg">${game.voorraad.length
      ? 'Alle foto\'s staan op een kaartje.'
      : 'Nog geen foto\'s. Sleep ze hierheen vanuit Photos, of op een kaartje.'}</p>`;
    return;
  }
  for (const f of lijst) {
    const plekken = plekkenVanFoto(f.id);
    const vak = document.createElement('div');
    vak.className = 'voorraad-foto' + (plekken.length ? ' gebruikt' : '');
    vak.dataset.id = f.id;
    vak.draggable = true;
    vak.innerHTML = '<img alt="" draggable="false">';
    const img = vak.querySelector('img');
    if (duimnagels.has(duimSleutel(f.id))) img.src = duimnagels.get(duimSleutel(f.id));
    else if (duimKijker) duimKijker.observe(vak); else laadDuimnagel(f.id);

    if (plekken.length) {
      const label = document.createElement('span');
      label.className = 'waar';
      label.textContent = plekken.map((p) => (p.achter ? 'achter' : p.qi + 1)).join(', ');
      const q = !plekken[0].achter && game.quartets[plekken[0].qi];
      if (q) label.style.background = q.color;
      vak.title = 'Staat op ' + plekken.map((p) => beschrijfPlek(game, p)).join(', ');
      vak.appendChild(label);
    } else {
      vak.title = 'Nog niet gebruikt. Sleep naar een kaartje.';
      const weg = document.createElement('button');
      weg.type = 'button';
      weg.className = 'weg';
      weg.title = 'Foto definitief weggooien';
      weg.textContent = '✕';
      weg.addEventListener('click', (e) => { e.stopPropagation(); gooiWeg(f.id); });
      vak.appendChild(weg);
    }

    const draai = document.createElement('button');
    draai.type = 'button';
    draai.className = 'draai';
    draai.title = 'Een kwartslag draaien (overal waar deze foto staat)';
    draai.textContent = '⟳';
    draai.addEventListener('click', (e) => { e.stopPropagation(); draaiFoto(f.id); });
    vak.appendChild(draai);

    vak.addEventListener('dragstart', (e) => {
      slepenUitVoorraad = true;
      e.dataTransfer.setData(FOTO_TYPE, f.id);
      e.dataTransfer.effectAllowed = 'copy';
      if (img.src) e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2);
      ensureImage(f.id);                               // alvast ophalen voor het kaartje
    });
    vak.addEventListener('dragend', () => { slepenUitVoorraad = false; renderVoorraad(); });
    raster.appendChild(vak);
  }
}

function zetVoorraadOpen(open) {
  if (open && !el('#taken').hidden) zetTakenOpen(false);   // één paneel tegelijk
  el('#voorraad').hidden = !open;
  el('#openVoorraad').setAttribute('aria-pressed', String(open));
  try { localStorage.setItem('kwartet-voorraad', open ? '1' : '0'); } catch (e) { /* */ }
  renderVoorraad();
  requestAnimationFrame(repaintQuartet);
}

function wireVoorraad() {
  el('#openVoorraad').addEventListener('click', () => zetVoorraadOpen(el('#voorraad').hidden));
  el('#sluitVoorraad').addEventListener('click', () => zetVoorraadOpen(false));
  el('#voorraadOngebruikt').addEventListener('change', renderVoorraad);

  // Het hele paneel is een landingsplek: bestanden uit Photos, of een kaartje (⠿).
  const paneel = el('#voorraad');
  let diepte = 0;
  const past = (e) => e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(KAART_TYPE);
  paneel.addEventListener('dragenter', (e) => { if (!past(e)) return; e.preventDefault(); diepte++; paneel.classList.add('over'); });
  paneel.addEventListener('dragover', (e) => { if (!past(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  paneel.addEventListener('dragleave', () => { if (--diepte <= 0) { diepte = 0; paneel.classList.remove('over'); } });
  paneel.addEventListener('drop', (e) => {
    if (!past(e)) return;
    e.preventDefault();
    diepte = 0;
    paneel.classList.remove('over');
    if (e.dataTransfer.types.includes(KAART_TYPE)) haalVanKaartje(Number(e.dataTransfer.getData(KAART_TYPE)));
    else if (e.dataTransfer.files.length) voegBestandenToe(e.dataTransfer.files);
  });

  let open = false;
  try { open = localStorage.getItem('kwartet-voorraad') === '1'; } catch (e) { /* */ }
  if (open) zetVoorraadOpen(true); else renderVoorraad();
}

/* ---------------- takenlijst ---------------- */
// Staat in het spel zelf, dus gaat mee met samenwerken (live gedeeld) en back-ups.

function mijnNaam() {
  try { return localStorage.getItem('kwartet-naam') || ''; } catch (e) { return ''; }
}

function korteDatum(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function renderTaken() {
  const open = game.todos.filter((t) => !t.klaar);
  const klaar = game.todos.filter((t) => t.klaar);
  el('#takenAantal').textContent = open.length;
  el('#takenAantal').hidden = !open.length;
  if (el('#taken').hidden) return;

  const q = game.quartets[current];
  el('#takenKoppelTekst').textContent = q
    ? `hoort bij kwartet ${current + 1}${q.theme.trim() ? ` “${q.theme.trim()}”` : ''}` : '';
  // Niet opnieuw opbouwen terwijl iemand een taak aan het aanpassen is.
  if (el('#taken').querySelector('input.bewerk')) return;

  vulTaken(el('#takenLijst'), open);
  if (!open.length) el('#takenLijst').innerHTML = '<li class="taken-leeg">Niets meer te doen.</li>';
  vulTaken(el('#takenKlaarLijst'), klaar);
  el('#takenKlaarBlok').hidden = !klaar.length;
  el('#takenKlaarKop').textContent = `Afgevinkt (${klaar.length})`;
}

function vulTaken(ul, items) {
  ul.innerHTML = '';
  for (const t of items) {
    const zoek = () => game.todos.find((x) => x.id === t.id);   // actueel, ook na een update
    const li = document.createElement('li');
    li.className = 'taak' + (t.klaar ? ' klaar' : '');
    li.innerHTML = `<input type="checkbox" aria-label="Klaar">
      <div class="taak-inhoud"><span class="tekst" title="Dubbelklik om aan te passen"></span><span class="meta"></span></div>
      <button class="weg" title="Weghalen">✕</button>`;
    const vink = li.querySelector('input');
    vink.checked = t.klaar;
    li.querySelector('.tekst').textContent = t.tekst;

    const meta = li.querySelector('.meta');
    const delen = [t.door, t.wanneer && korteDatum(t.wanneer)].filter(Boolean);
    meta.textContent = delen.join(' · ');
    const qi = game.quartets.findIndex((x) => x.id === t.kwartetId);
    if (qi >= 0) {
      const kw = document.createElement('button');
      kw.className = 'kw';
      kw.textContent = `kwartet ${qi + 1}`;
      kw.style.color = game.quartets[qi].color;
      kw.title = game.quartets[qi].theme.trim() || 'zonder thema';
      kw.addEventListener('click', () => select(qi));
      meta.append(delen.length ? ' · ' : '', kw);
    }

    vink.addEventListener('change', () => {
      const x = zoek();
      if (x) { x.klaar = vink.checked; save(); }
      renderTaken();
    });
    li.querySelector('.weg').addEventListener('click', () => {
      game.todos = game.todos.filter((x) => x.id !== t.id);
      save();
      renderTaken();
    });
    li.querySelector('.tekst').addEventListener('dblclick', () => bewerkTaak(li, zoek));
    ul.appendChild(li);
  }
}

function bewerkTaak(li, zoek) {
  const t = zoek();
  if (!t) return;
  const span = li.querySelector('.tekst');
  const invoer = document.createElement('input');
  invoer.className = 'bewerk';
  invoer.value = t.tekst;
  span.replaceWith(invoer);
  invoer.focus();
  invoer.select();
  let klaar = false;
  const stop = (bewaren) => {
    if (klaar) return;
    klaar = true;
    const x = zoek();
    const tekst = invoer.value.trim();
    if (bewaren && x && tekst && tekst !== x.tekst) { x.tekst = tekst; save(); }
    invoer.remove();
    renderTaken();
  };
  invoer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') stop(true);
    if (e.key === 'Escape') stop(false);
  });
  invoer.addEventListener('blur', () => stop(true));
}

function zetTakenOpen(open) {
  if (open && !el('#voorraad').hidden) zetVoorraadOpen(false);   // één paneel tegelijk
  el('#taken').hidden = !open;
  el('#openTaken').setAttribute('aria-pressed', String(open));
  try { localStorage.setItem('kwartet-taken', open ? '1' : '0'); } catch (e) { /* */ }
  if (open) { renderTaken(); el('#takenTekst').focus(); }
  requestAnimationFrame(repaintQuartet);          // kaartjes zijn smaller of breder geworden
}

function wireTaken() {
  el('#takenUitleg').textContent = store.opServer
    ? 'Gedeeld: iedereen die aan dit spel werkt, ziet dezelfde lijst.'
    : 'Staat in deze browser, en gaat mee in de back-up.';
  el('#takenNaam').value = mijnNaam();
  el('#takenNaam').addEventListener('input', (e) => {
    try { localStorage.setItem('kwartet-naam', e.target.value.trim()); } catch (err) { /* */ }
  });
  el('#openTaken').addEventListener('click', () => zetTakenOpen(el('#taken').hidden));
  el('#sluitTaken').addEventListener('click', () => zetTakenOpen(false));
  el('#takenForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const tekst = el('#takenTekst').value.trim();
    if (!tekst) return;
    const q = game.quartets[current];
    game.todos.push({
      id: uid(), tekst, klaar: false, door: mijnNaam(), wanneer: new Date().toISOString(),
      kwartetId: el('#takenKoppel').checked && q ? q.id : null,
    });
    el('#takenTekst').value = '';
    save();
    renderTaken();
  });
  el('#takenOpruimen').addEventListener('click', () => {
    const n = game.todos.filter((t) => t.klaar).length;
    if (!n || !confirm(`${n} afgevinkte ${n === 1 ? 'taak' : 'taken'} weghalen?`)) return;
    game.todos = game.todos.filter((t) => !t.klaar);
    save();
    renderTaken();
  });
  let open = false;
  try { open = localStorage.getItem('kwartet-taken') === '1'; } catch (e) { /* */ }
  zetTakenOpen(open);
}

/* ---------------- bekijk-link ---------------- */

function toonDeelLink(token) {
  const heeft = !!token;
  const url = heeft ? new URL(`bekijk.html?t=${token}`, location.href).href : '';
  el('#shareUrl').value = url;
  el('#shareOpen').href = url || '#';
  el('#shareLink').hidden = !heeft;
  el('#shareGeen').hidden = heeft;
  el('#shareOff').hidden = !heeft;
  el('#shareNew').textContent = heeft ? 'Nieuwe link' : 'Link maken';
  el('#shareNew').title = heeft ? 'Maakt een nieuwe link; de oude werkt dan niet meer' : '';
}

async function openShareDialog() {
  try {
    toonDeelLink(await store.shareToken());
    el('#shareDialog').showModal();
  } catch (err) {
    toast(err.message, 6000);
  }
}

function wireShareDialog() {
  el('#openShare').addEventListener('click', openShareDialog);
  el('#shareNew').addEventListener('click', async () => {
    if (el('#shareUrl').value && !confirm('Een nieuwe link maken? De oude link werkt dan niet meer.')) return;
    try { toonDeelLink(await store.newShareToken()); } catch (err) { toast(err.message, 6000); }
  });
  el('#shareOff').addEventListener('click', async () => {
    if (!confirm('Link uitzetten? Wie hem heeft, kan het kwartet dan niet meer bekijken.')) return;
    try { await store.stopSharing(); toonDeelLink(null); } catch (err) { toast(err.message, 6000); }
  });
  el('#shareCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(el('#shareUrl').value);
      toast('Link gekopieerd.');
    } catch (err) {
      el('#shareUrl').select();
      toast('Kopiëren lukte niet automatisch; de link is geselecteerd, druk op ⌘C.');
    }
  });
}

/* ---------------- toast ---------------- */

let toastTimer = null;
function toast(msg, ms = 3200, knop = null) {
  const t = el('#toast');
  t.textContent = msg;
  if (knop) {
    const b = document.createElement('button');
    b.className = 'toast-knop';
    b.textContent = knop.tekst;
    b.addEventListener('click', () => { t.hidden = true; knop.doe(); });
    t.append(' ', b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------------- kwartetten beheren ---------------- */

function addQuartet() {
  game.quartets.push(newQuartet(pickColor(game.quartets.map((q) => q.color))));
  save();
  select(game.quartets.length - 1);
}

async function deleteQuartet(qi) {
  const q = game.quartets[qi];
  if (!confirm(`Kwartet ${qi + 1}${q.theme ? ` "${q.theme}"` : ''} verwijderen?`)) return;
  // Foto's blijven in de voorraad.
  game.quartets.splice(qi, 1);
  if (!game.quartets.length) game.quartets.push(newQuartet());
  save();
  select(Math.min(qi, game.quartets.length - 1));
}

// Vult ontbrekende of ongeldige velden aan. Velden die deze versie niet kent
// blijven staan (...g, ...b, ...t, ...q): die kunnen van een nieuwere versie
// van de app komen, en mogen dan niet verdwijnen.
function normalizeGame(raw) {
  const g = raw && typeof raw === 'object' ? raw : {};
  const b = (g.back && typeof g.back === 'object') ? g.back : {};
  const out = {
    ...g,
    title: typeof g.title === 'string' ? g.title : 'Mijn kwartet',
    back: {
      ...b,
      color: isHex(b.color) ? b.color : '#2f4858',
      title: typeof b.title === 'string' ? b.title : '',
      pattern: ['stippen', 'strepen', 'effen'].includes(b.pattern) ? b.pattern : 'stippen',
      photoId: typeof b.photoId === 'string' ? b.photoId : null,
      focus: (b.focus && typeof b.focus.x === 'number') ? b.focus : { x: .5, y: .5 },
      zoom: typeof b.zoom === 'number' ? b.zoom : 1,
      fit: b.fit === 'passend' ? 'passend' : 'vullen',
    },
    todos: (Array.isArray(g.todos) ? g.todos : [])
      .filter((t) => t && typeof t.id === 'string' && typeof t.tekst === 'string')
      .map((t) => ({
        ...t,
        id: t.id,
        tekst: t.tekst,
        klaar: !!t.klaar,
        door: typeof t.door === 'string' ? t.door : '',
        wanneer: typeof t.wanneer === 'string' ? t.wanneer : '',
        kwartetId: typeof t.kwartetId === 'string' ? t.kwartetId : null,
      })),
    // Fotovoorraad: elke foto die ooit is geüpload. Met "photoId" erin, zodat
    // api.php (dat ongebruikte foto's opruimt) ze als in gebruik ziet.
    voorraad: [...new Map((Array.isArray(g.voorraad) ? g.voorraad : [])
      .filter((f) => f && typeof f.photoId === 'string')
      .map((f) => [f.photoId, { ...f, id: f.photoId }])).values()],
    quartets: (Array.isArray(g.quartets) ? g.quartets : []).map((q) => ({
      ...q,
      id: (q && q.id) || uid(),
      theme: (q && typeof q.theme === 'string') ? q.theme : '',
      color: (q && isHex(q.color)) ? q.color : null,
      cards: Array.from({ length: 4 }, (_, i) => ({ ...newCard(), ...(q && q.cards && q.cards[i]) })),
    })),
  };
  for (const q of out.quartets) if (q.keuze !== undefined && !KEUZES[q.keuze]) delete q.keuze;
  if (!out.quartets.length) out.quartets = newGame().quartets;
  // kwartetten zonder kleur (oud bestand, of nieuw spel) krijgen er automatisch een
  out.quartets.forEach((q, i) => {
    if (!q.color) q.color = pickColor(out.quartets.map((x) => x.color).filter(Boolean));
  });
  return out;
}

/* ---------------- back-up ---------------- */

async function makeBackup() {
  // Gehost met een nieuwe api.php: de server maakt de zip zelf, in één verzoek.
  // Scheelt tientallen losse verzoeken waar de host op kan afremmen.
  if (store.opServer && store.apiVersie >= 3) {
    toast('Back-up maken…', 60000);
    await bewaarNu();                              // eerst de laatste wijzigingen naar de server
    const a = document.createElement('a');
    a.href = 'api.php?actie=backup';
    a.download = `${safeName(game.title, 'Kwartet')} - back-up.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Back-up wordt gedownload.');
    return;
  }

  const files = [{
    name: 'spel.json',
    data: new TextEncoder().encode(JSON.stringify({ app: 'kwartetmaker', versie: 1, spel: game }, null, 2)),
  }];
  const ids = new Set();
  for (const q of game.quartets) for (const c of q.cards) if (c.photoId) ids.add(c.photoId);
  if (game.back.photoId) ids.add(game.back.photoId);
  for (const f of game.voorraad) ids.add(f.id);
  let n = 0;
  for (const id of ids) {
    n++;
    toast(`Back-up maken… foto ${n} van ${ids.size}`, 60000);
    const blob = await store.getPhoto(id);
    if (blob) files.push({ name: `fotos/${id}.jpg`, data: new Uint8Array(await blob.arrayBuffer()) });
    if (store.opServer) await new Promise((r) => setTimeout(r, 60));   // de host niet overvragen
  }
  downloadBlob(makeZip(files), `${safeName(game.title, 'Kwartet')} - back-up.zip`);
  toast(`Back-up gemaakt: ${ids.size} foto's en alle titels.`);
}

async function restoreBackup(file) {
  const entries = await readZip(file);
  const meta = entries.find((e) => e.name.replace(/^.*\//, '') === 'spel.json');
  if (!meta) throw new Error('Dit lijkt geen back-up van de Kwartetmaker: spel.json ontbreekt.');
  const parsed = JSON.parse(new TextDecoder().decode(meta.data));
  const restored = normalizeGame(parsed.spel || parsed);
  const photos = entries.filter((e) => /(^|\/)fotos\/[^/]+$/.test(e.name));

  if (!confirm(`Terugzetten vervangt het spel dat nu in deze browser staat.\n\n"${restored.title}" met ${restored.quartets.length} kwartetten en ${photos.length} foto's. Doorgaan?`)) return;

  for (const id of await store.photoIds()) await store.deletePhoto(id);
  images.clear();
  for (const e of photos) {
    const id = e.name.split('/').pop().replace(/\.jpg$/i, '');
    await store.putPhoto(id, new Blob([e.data], { type: 'image/jpeg' }));
  }
  game = restored;
  await persistForced();
  await Promise.all(game.quartets.flatMap((q) => q.cards.map((c) => ensureImage(c.photoId))));
  await ensureImage(game.back.photoId);
  await vulVoorraad();

  el('#gameTitle').value = game.title;
  select(0);
  setStatus('Bewaard ✓');
  toast('Back-up teruggezet.');
  vulVingerafdrukken();
}

/* ---------------- inloggen (alleen bij opslag op de server) ---------------- */

function vraagWachtwoord(melding) {
  return new Promise((resolve) => {
    const dialog = el('#loginDialog');
    const form = el('#loginForm');
    const fout = el('#loginFout');
    el('#loginMelding').textContent = melding
      || 'Dit spel staat op de server. Vul het wachtwoord in om verder te gaan.';
    if (melding) {
      el('#loginVeld').hidden = true;
      form.querySelector('button').hidden = true;
    }
    dialog.showModal();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      fout.hidden = true;
      try {
        await store.login(el('#loginWachtwoord').value);
        dialog.close();
        resolve();
      } catch (err) {
        fout.textContent = err.message;
        fout.hidden = false;
        el('#loginWachtwoord').select();
      }
    });
  });
}

/* ---------------- start ---------------- */

async function init() {
  // Welke versie draait er? (Gehost: de commit op GitHub, zie vimexx/laden.js.)
  const versie = /@([0-9a-f]{7})/.exec(window.KWARTET_BRON || '');
  el('.brand').title = versie ? `Versie ${versie[1]}` : 'Lokale versie';

  const verbinding = await store.connect();
  if (verbinding.server) {
    document.querySelectorAll('.serveronly').forEach((n) => { n.hidden = false; });
    if (verbinding.inloggenNodig) await vraagWachtwoord(verbinding.melding);
  }

  const geladen = await store.loadGame();
  const opgeslagen = geladen.game;
  rev = geladen.rev;
  game = normalizeGame(opgeslagen);
  base = snapshot();
  el('#gameTitle').value = game.title;

  await ensureQuartetImages(game.quartets[0]);
  await ensureImage(game.back.photoId);
  // Alleen opruimen als er echt een spel geladen is: anders zouden we bij een
  // hapering alle foto's van de server weggooien.
  await vulVoorraad();

  select(0);
  setStatus('Bewaard ✓');
  if (store.opServer) { startSync(); wireShareDialog(); }
  setTimeout(vulVingerafdrukken, 1500);
  wireTaken();
  wireVoorraad();
  wireVersieCheck();
  el('#sorteer').addEventListener('click', () => {
    sorteerAZ = !sorteerAZ;
    try { localStorage.setItem('kwartet-sortering', sorteerAZ ? 'az' : 'nr'); } catch (e) { /* */ }
    renderSidebar();
  });

  el('#gameTitle').addEventListener('input', (e) => { game.title = e.target.value; save(); });
  el('#addQuartet').addEventListener('click', addQuartet);
  el('#hernummer').addEventListener('click', hernummer);
  wireSidebarHover();
  el('#logout').addEventListener('click', async () => {
    await store.logout();
    location.reload();
  });
  el('#backup').addEventListener('click', () => makeBackup().catch((e) => toast(e.message, 6000)));
  el('#restore').addEventListener('click', () => { el('#backupPicker').value = ''; el('#backupPicker').click(); });
  el('#backupPicker').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) restoreBackup(file).catch((err) => toast(err.message, 8000));
  });
  el('#exportAll').addEventListener('click', exportAll);
  el('#openPrint').addEventListener('click', openPrintDialog);
  el('#backTitle').addEventListener('input', (e) => { game.back.title = e.target.value; paintBackPreview(); save(); });
  el('#backTekstAan').addEventListener('change', (e) => {
    if (e.target.checked) delete game.back.tekstUit; else game.back.tekstUit = true;
    el('#backTitle').disabled = !e.target.checked;
    paintBackPreview();
    save();
  });
  el('#backColor').addEventListener('input', (e) => { game.back.color = e.target.value; paintBackPreview(); save(); });
  el('#backPattern').addEventListener('change', (e) => { game.back.pattern = e.target.value; paintBackPreview(); save(); });
  el('#backZoom').addEventListener('input', (e) => { game.back.zoom = Number(e.target.value); paintBackPreview(); save(); });
  el('#backDraai').addEventListener('click', () => draaiFoto(game.back.photoId));
  el('#backFit').addEventListener('click', () => {
    game.back.fit = game.back.fit === 'passend' ? 'vullen' : 'passend';
    game.back.zoom = 1;
    game.back.focus = { x: .5, y: .5 };
    el('#backZoom').value = 1;
    updateBackControls();
    paintBackPreview();
    save();
  });
  el('#backPick').addEventListener('click', () => { pickTarget = 'back'; el('#filePicker').value = ''; el('#filePicker').click(); });
  el('#backClear').addEventListener('click', async () => {
    if (!game.back.photoId) return;
    game.back.photoId = null;
    game.back.focus = { x: .5, y: .5 };
    game.back.zoom = 1;
    game.back.fit = 'vullen';
    delete game.back.fotoHash;
    el('#backZoom').value = 1;
    updateBackControls();
    paintBackPreview();
    save();
  });
  wireDrop(el('#backPreview').parentElement, setBackPhoto, null, gebruikFotoAchterkant);
  el('#backPreview').addEventListener('click', () => { if (!game.back.photoId) el('#backPick').click(); });
  wirePan(el('#backPreview'), el('#backPreview').parentElement, {
    model: () => game.back,
    rect: () => ({ x: 0, y: 0, w: 1, h: CARD_RATIO }),
    repaint: paintBackPreview,
    zoomInput: () => el('#backZoom'),
  });
  // keuze onthouden (per browser)
  try {
    const bewaard = localStorage.getItem('kwartet-printsoort');
    const knop = bewaard && document.querySelector(`input[name=printSoort][value="${bewaard}"]`);
    if (knop) knop.checked = true;
  } catch (e) { /* */ }
  toonPrintSoort();
  document.querySelectorAll('input[name=printSoort]').forEach((r) => r.addEventListener('change', () => {
    toonPrintSoort();
    try { localStorage.setItem('kwartet-printsoort', printSoort()); } catch (e) { /* */ }
  }));
  el('#makePdf').addEventListener('click', (e) => {
    e.preventDefault();
    const neeOverslaan = el('#optNee').checked;
    const klus = printSoort() === 'overzicht'
      ? maakOverzicht({ empty: el('#optEmpty').checked, neeOverslaan })
      : makePrintSheets({
        backs: el('#optBacks').checked,
        marks: el('#optMarks').checked,
        empty: el('#optEmpty').checked,
        neeOverslaan,
      });
    klus.catch((err) => toast(err.message, 8000));
  });
  el('#newGame').addEventListener('click', async () => {
    if (!confirm('Alles wissen en met een leeg spel beginnen? Dit kan niet ongedaan gemaakt worden.')) return;
    for (const id of await store.photoIds()) await store.deletePhoto(id);
    images.clear();
    game = newGame();
    await persistForced();
    el('#gameTitle').value = game.title;
    select(0);
  });

  el('#filePicker').addEventListener('change', (e) => {
    if (!e.target.files.length) return;
    if (pickTarget === 'back') setBackPhoto(e.target.files);
    else placeFiles(pickTarget, e.target.files);
  });

  // plakken vanaf het klembord in het laatst gebruikte kaartje
  window.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); placeFiles(lastFocusedCard, files); }
  });

  // buiten de kaartjes niets laten openen in de browser
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  window.addEventListener('resize', () => repaintQuartet());
  // Ook als alleen de editor smaller of breder wordt (zijbalk, takenlijst).
  let hertekenen = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(hertekenen);
    hertekenen = requestAnimationFrame(repaintQuartet);
  }).observe(el('#editor'));
}

init().catch((err) => {
  console.error(err);
  toast('Er ging iets mis bij het laden: ' + err.message, 8000);
});
