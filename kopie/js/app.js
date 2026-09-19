import * as store from './store.js';
import { makeZip, readZip, downloadBlob } from './zip.js';
import { drawCard, drawBack, photoRect, CARD_RATIO, EXPORT_WIDTH } from './render.js';
import { makePdf } from './pdf.js';
import { PALETTE, pickColor, isHex, inkOn, mix } from './colors.js';
import { mergeGame, equal } from './sync.js';

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
  return { id: uid(), title: '', photoId: null, focus: { x: .5, y: .5 }, zoom: 1 };
}
function newQuartet(color) {
  return { id: uid(), theme: '', color: color || PALETTE[0], cards: [newCard(), newCard(), newCard(), newCard()] };
}
function newGame(n = DEFAULT_QUARTETS) {
  return {
    title: 'Mijn kwartet',
    back: { color: '#2f4858', title: '', pattern: 'stippen', photoId: null, focus: { x: .5, y: .5 }, zoom: 1 },
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
    color: b.color, title: b.title || game.title, pattern: b.pattern,
    image: b.photoId ? images.get(b.photoId) : null,
    focus: b.focus, zoom: b.zoom,
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
  restoreFocus(focus);
  ensureQuartetImages(q).then(() => { if (game.quartets[current] === q) repaintQuartet(); });
  if (el('#printDialog').open) {
    if (document.activeElement !== el('#backTitle')) el('#backTitle').value = game.back.title;
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

async function pruneOrphans() {
  // Op de server ruimt api.php zelf op (met een dag vertraging); hier niet,
  // want een andere computer kan een foto net hebben toegevoegd.
  if (store.opServer) return;
  const used = new Set();
  for (const q of game.quartets) for (const c of q.cards) if (c.photoId) used.add(c.photoId);
  if (game.back.photoId) used.add(game.back.photoId);
  for (const id of await store.photoIds()) if (!used.has(id)) await store.deletePhoto(id);
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
  images.set(id, await createImageBitmap(blob));
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
    image: c.photoId ? images.get(c.photoId) : null,
    focus: c.focus,
    zoom: c.zoom,
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
  document.querySelectorAll('.cardcol').forEach((col) => {
    const ci = Number(col.dataset.i);
    paint(col.querySelector('canvas'), q, current, ci);
    col.querySelector('.preview').classList.toggle('has-photo', !!q.cards[ci].photoId);
  });
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

function renderSidebar() {
  const list = el('#quartetList');
  list.innerHTML = '';
  game.quartets.forEach((q, i) => {
    const li = document.createElement('li');
    li.className = i === current ? 'active' : '';
    li.innerHTML = `<span class="num">${i + 1}</span>
      <span class="swatch" style="background:${q.color}"></span>
      <span class="name ${q.theme.trim() ? '' : 'empty'}">${escapeHtml(q.theme.trim() || 'zonder thema')}</span>
      <span class="dots">${q.cards.map((c) => `<i class="${c.photoId ? 'on' : ''}" style="${c.photoId ? `background:${q.color}` : ''}"></i>`).join('')}</span>`;
    if (i === current) li.style.background = mix(q.color, '#ffffff', 0.88);
    const titels = q.cards.map((c) => c.title.trim()).filter(Boolean);
    li.title = [q.theme.trim() || 'zonder thema', ...titels].join('\n');
    li.addEventListener('click', () => select(i));
    list.appendChild(li);
  });
  const done = game.quartets.filter((q) => cardsDone(q) === 4).length;
  el('#progress').textContent = `${done}/${game.quartets.length} klaar`;
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
      <div class="editor-actions">
        <button id="exportQuartet" class="btn" title="Exporteer de vier kaartjes als mapje (zip)">Exporteer</button>
        <button id="deleteQuartet" class="btn">Verwijderen</button>
      </div>
    </div>
    <div class="cards">
      ${q.cards.map((c, i) => `
        <div class="cardcol" data-i="${i}">
          <div class="preview">
            <canvas title="Sleep een foto hierheen of klik om er een te kiezen. Met foto: slepen verschuift, scrollen zoomt."></canvas>
            <div class="photo-tools">
              <button class="icon" data-act="pick" title="Foto kiezen">🖼</button>
              <input class="zoom" type="range" min="1" max="3" step="0.01" title="Inzoomen">
              <button class="icon" data-act="clear" title="Foto verwijderen">✕</button>
            </div>
          </div>
          <input class="title" type="text" placeholder="Titel ${i + 1}" autocomplete="off">
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
      await store.deletePhoto(card.photoId);
      images.delete(card.photoId);
      card.photoId = null;
      card.focus = { x: .5, y: .5 };
      card.zoom = 1;
      zoom.value = 1;
      repaintQuartet();
      renderSidebar();
      save();
    });

    wireDrop(preview, (files) => { lastFocusedCard = ci; return placeFiles(ci, files); });
    wirePan(canvas, preview, {
      model: () => game.quartets[current].cards[ci],
      rect: () => photoRect(1),
      repaint: () => paint(canvas, game.quartets[current], current, ci),
      zoomInput: () => zoom,
    });
  });

  repaintQuartet();
}

/* ---------------- foto's plaatsen ---------------- */

let pickTarget = 0;
function pickFiles(ci) {
  pickTarget = ci;
  el('#filePicker').value = '';
  el('#filePicker').click();
}

async function placeFiles(startIndex, files) {
  const q = game.quartets[current];
  const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  if (!list.length) { toast('Geen afbeelding gevonden in wat je sleepte.'); return; }
  let i = startIndex;
  for (const file of list) {
    if (i > 3) break;
    const card = q.cards[i];
    try {
      const id = await importFile(file);
      if (card.photoId) { await store.deletePhoto(card.photoId); images.delete(card.photoId); }
      card.photoId = id;
      card.focus = { x: .5, y: .5 };
      card.zoom = 1;
    } catch (err) {
      toast(`Kon "${file.name}" niet lezen. HEIC werkt in Safari; zet het anders om naar JPEG.`);
    }
    i++;
  }
  renderEditor();
  renderSidebar();
  save();
}

function wireDrop(preview, onFiles) {
  let depth = 0;
  preview.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; preview.classList.add('over'); });
  preview.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  preview.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; preview.classList.remove('over'); } });
  preview.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    preview.classList.remove('over');
    const dt = e.dataTransfer;
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
    const s = Math.max(p.w / img.width, p.h / img.height) * card().zoom;
    const dw = img.width * s, dh = img.height * s;
    const unit = canvas.clientWidth || 1;
    const c = card();
    if (dw > p.w) c.focus.x = clamp(c.focus.x + (e.clientX - lastX) / unit / (p.w - dw), 0, 1);
    if (dh > p.h) c.focus.y = clamp(c.focus.y + (e.clientY - lastY) / unit / (p.h - dh), 0, 1);
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

function printableCards(includeEmpty) {
  const out = [];
  game.quartets.forEach((q, qi) => {
    const used = q.theme.trim() || q.cards.some((c) => c.title.trim() || c.photoId);
    if (!used && !includeEmpty) return;
    q.cards.forEach((_, ci) => out.push({ q, qi, ci }));
  });
  return out;
}

async function makePrintSheets(options) {
  const cards = printableCards(options.empty);
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
      drawCard(front.ctx, cardWpx, { ...cardModel(item.q, item.qi, item.ci), hints: false }, style(item.q));
      front.ctx.restore();
    });
    pages.push(await pageJpeg(front.canvas));

    // achterkant: kolommen gespiegeld
    if (options.backs) {
      const back = newPageCanvas();
      if (options.marks) drawCutMarks(back.ctx);
      const style0 = { bg: '#ffffff', border: '#e7ebee', radius: 0 };   // kleur tot de snijlijn
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
    if (game.back.photoId) { await store.deletePhoto(game.back.photoId); images.delete(game.back.photoId); }
    game.back.photoId = id;
    game.back.focus = { x: .5, y: .5 };
    game.back.zoom = 1;
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
  el('#backTitle').placeholder = game.title || 'Naam van het spel';
  el('#backColor').value = game.back.color;
  el('#backPattern').value = game.back.pattern;
  el('#backZoom').value = game.back.zoom;
  updateBackControls();
  el('#printDialog').showModal();
  paintBackPreview();
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
function toast(msg, ms = 3200) {
  const t = el('#toast');
  t.textContent = msg;
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
  for (const c of q.cards) if (c.photoId) { await store.deletePhoto(c.photoId); images.delete(c.photoId); }
  game.quartets.splice(qi, 1);
  if (!game.quartets.length) game.quartets.push(newQuartet());
  save();
  select(Math.min(qi, game.quartets.length - 1));
}

function normalizeGame(raw) {
  const g = raw && typeof raw === 'object' ? raw : {};
  const b = (g.back && typeof g.back === 'object') ? g.back : {};
  const out = {
    title: typeof g.title === 'string' ? g.title : 'Mijn kwartet',
    back: {
      color: isHex(b.color) ? b.color : '#2f4858',
      title: typeof b.title === 'string' ? b.title : '',
      pattern: ['stippen', 'strepen', 'effen'].includes(b.pattern) ? b.pattern : 'stippen',
      photoId: typeof b.photoId === 'string' ? b.photoId : null,
      focus: (b.focus && typeof b.focus.x === 'number') ? b.focus : { x: .5, y: .5 },
      zoom: typeof b.zoom === 'number' ? b.zoom : 1,
    },
    quartets: (Array.isArray(g.quartets) ? g.quartets : []).map((q) => ({
      id: (q && q.id) || uid(),
      theme: (q && typeof q.theme === 'string') ? q.theme : '',
      color: (q && isHex(q.color)) ? q.color : null,
      cards: Array.from({ length: 4 }, (_, i) => ({ ...newCard(), ...(q && q.cards && q.cards[i]) })),
    })),
  };
  if (!out.quartets.length) out.quartets = newGame().quartets;
  // kwartetten zonder kleur (oud bestand, of nieuw spel) krijgen er automatisch een
  out.quartets.forEach((q, i) => {
    if (!q.color) q.color = pickColor(out.quartets.map((x) => x.color).filter(Boolean));
  });
  return out;
}

/* ---------------- back-up ---------------- */

async function makeBackup() {
  const files = [{
    name: 'spel.json',
    data: new TextEncoder().encode(JSON.stringify({ app: 'kwartetmaker', versie: 1, spel: game }, null, 2)),
  }];
  const ids = new Set();
  for (const q of game.quartets) for (const c of q.cards) if (c.photoId) ids.add(c.photoId);
  if (game.back.photoId) ids.add(game.back.photoId);
  for (const id of ids) {
    const blob = await store.getPhoto(id);
    if (blob) files.push({ name: `fotos/${id}.jpg`, data: new Uint8Array(await blob.arrayBuffer()) });
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
  await pruneOrphans();

  el('#gameTitle').value = game.title;
  select(0);
  setStatus('Bewaard ✓');
  toast('Back-up teruggezet.');
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
  if (opgeslagen) await pruneOrphans();

  select(0);
  setStatus('Bewaard ✓');
  if (store.opServer) { startSync(); wireShareDialog(); }

  el('#gameTitle').addEventListener('input', (e) => { game.title = e.target.value; save(); });
  el('#addQuartet').addEventListener('click', addQuartet);
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
  el('#backColor').addEventListener('input', (e) => { game.back.color = e.target.value; paintBackPreview(); save(); });
  el('#backPattern').addEventListener('change', (e) => { game.back.pattern = e.target.value; paintBackPreview(); save(); });
  el('#backZoom').addEventListener('input', (e) => { game.back.zoom = Number(e.target.value); paintBackPreview(); save(); });
  el('#backPick').addEventListener('click', () => { pickTarget = 'back'; el('#filePicker').value = ''; el('#filePicker').click(); });
  el('#backClear').addEventListener('click', async () => {
    if (!game.back.photoId) return;
    await store.deletePhoto(game.back.photoId);
    images.delete(game.back.photoId);
    game.back.photoId = null;
    game.back.focus = { x: .5, y: .5 };
    game.back.zoom = 1;
    el('#backZoom').value = 1;
    updateBackControls();
    paintBackPreview();
    save();
  });
  wireDrop(el('#backPreview').parentElement, setBackPhoto);
  el('#backPreview').addEventListener('click', () => { if (!game.back.photoId) el('#backPick').click(); });
  wirePan(el('#backPreview'), el('#backPreview').parentElement, {
    model: () => game.back,
    rect: () => ({ x: 0, y: 0, w: 1, h: CARD_RATIO }),
    repaint: paintBackPreview,
    zoomInput: () => el('#backZoom'),
  });
  el('#makePdf').addEventListener('click', (e) => {
    e.preventDefault();
    makePrintSheets({
      backs: el('#optBacks').checked,
      marks: el('#optMarks').checked,
      empty: el('#optEmpty').checked,
    }).catch((err) => toast(err.message, 8000));
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
}

init().catch((err) => {
  console.error(err);
  toast('Er ging iets mis bij het laden: ' + err.message, 8000);
});
