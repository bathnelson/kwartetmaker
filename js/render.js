// Tekent een kaartje op een canvas. Zelfde code voor de preview en de export,
// zodat wat je ziet ook is wat je exporteert.
export const CARD_RATIO = 88 / 63;          // standaard speelkaart 63 x 88 mm
export const EXPORT_WIDTH = 744;            // 63 mm @ 300 dpi
export const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const F = {
  pad: 0.062,
  radius: 0.055,
  themeFont: 0.074,
  numberFont: 0.105,
  photoTop: 0.125,
  photoHeight: 0.66,
  gap: 0.05,
  listRadius: 0.035,
  listPad: 0.055,
  titleFont: 0.062,
  bullet: 0.012,
};

export function photoRect(W) {
  const pad = F.pad * W;
  return { x: pad, y: pad + F.photoTop * W, w: W - 2 * pad, h: F.photoHeight * W };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function drawCover(ctx, img, x, y, w, h, focus, zoom) {
  const iw = img.width, ih = img.height;
  const scale = Math.max(w / iw, h / ih) * (zoom || 1);
  const dw = iw * scale, dh = ih * scale;
  const fx = focus ? focus.x : 0.5;
  const fy = focus ? focus.y : 0.5;
  ctx.drawImage(img, x + (w - dw) * fx, y + (h - dh) * fy, dw, dh);
}

// Een foto een aantal kwartslagen gedraaid. Het bestand zelf verandert niet;
// de gedraaide versie wordt per foto en per hoek één keer gemaakt en onthouden.
const draaiCache = new WeakMap();
export function gedraaid(img, graden) {
  const g = (((graden || 0) % 360) + 360) % 360;
  if (!img || !g) return img;
  let perHoek = draaiCache.get(img);
  if (!perHoek) { perHoek = {}; draaiCache.set(img, perHoek); }
  if (perHoek[g]) return perHoek[g];
  const kwart = g === 90 || g === 270;
  const c = document.createElement('canvas');
  c.width = kwart ? img.height : img.width;
  c.height = kwart ? img.width : img.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((g * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  perHoek[g] = c;
  return c;
}

// Vervaagde opvulling: de foto sterk verkleinen en weer uitvergroten. Werkt in
// elke browser (ook zonder ctx.filter) en ziet er in preview en print hetzelfde uit.
function drawBlurFill(ctx, img, x, y, w, h) {
  const stap = document.createElement('canvas');
  stap.width = Math.max(8, Math.round(w / 5));
  stap.height = Math.max(8, Math.round(h / 5));
  const s1 = stap.getContext('2d');
  s1.imageSmoothingQuality = 'high';
  drawCover(s1, img, 0, 0, stap.width, stap.height);
  const klein = document.createElement('canvas');
  klein.width = Math.max(6, Math.round(w / 24));
  klein.height = Math.max(6, Math.round(h / 24));
  const s2 = klein.getContext('2d');
  s2.imageSmoothingQuality = 'high';
  s2.drawImage(stap, 0, 0, klein.width, klein.height);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(klein, x - w * 0.05, y - h * 0.05, w * 1.1, h * 1.1);
  ctx.fillStyle = 'rgba(0,0,0,0.10)';          // iets donkerder, zodat de foto zelf eruit springt
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/**
 * Foto in een vak: 'vullen' (standaard, vak helemaal vol, randen vallen weg) of
 * 'passend' (hele foto zichtbaar, lege ruimte opgevuld met een vervaagde versie).
 */
export function drawPhoto(ctx, img, x, y, w, h, focus, zoom, fit) {
  if (fit !== 'passend') {
    drawCover(ctx, img, x, y, w, h, focus, zoom);
    return;
  }
  drawBlurFill(ctx, img, x, y, w, h);
  const s = Math.min(w / img.width, h / img.height) * (zoom || 1);
  const dw = img.width * s;
  const dh = img.height * s;
  // focus 0..1: is de foto smaller dan het vak, dan van linker- tot rechterrand
  // (of boven- tot onderrand); is hij groter, dan welk deel er in beeld is.
  const fx = focus ? focus.x : 0.5;
  const fy = focus ? focus.y : 0.5;
  ctx.drawImage(img, x + (w - dw) * fx, y + (h - dh) * fy, dw, dh);
}

function fitText(ctx, text, maxWidth, baseSize, weight) {
  let size = baseSize;
  ctx.font = `${weight} ${size}px ${FONT}`;
  while (ctx.measureText(text).width > maxWidth && size > baseSize * 0.55) {
    size -= baseSize * 0.04;
    ctx.font = `${weight} ${size}px ${FONT}`;
  }
  return size;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W breedte in px (hoogte volgt uit CARD_RATIO)
 * @param {object} card {theme, number, titles[4], activeIndex, image, focus, zoom}
 * @param {object} style {accent, text, muted, bg}
 */
export function drawCard(ctx, W, card, style) {
  const H = W * CARD_RATIO;
  const pad = F.pad * W;
  const accent = style.accent;
  const text = style.text;
  const muted = style.muted;

  // Op een eigen canvas (preview, PNG) eerst leegmaken: de hoeken buiten de
  // ronding blijven dan doorzichtig. Op een printpagina niet (style.wissen ===
  // false): een PDF-pagina is een JPEG, en doorzichtig wordt daar zwart.
  if (style.wissen !== false) ctx.clearRect(0, 0, W, H);
  ctx.save();

  // kaartvlak
  roundRect(ctx, 0.5, 0.5, W - 1, H - 1, F.radius * W);
  ctx.fillStyle = style.bg;
  ctx.fill();
  ctx.lineWidth = Math.max(1, 0.003 * W);
  ctx.strokeStyle = style.border;
  ctx.stroke();

  // kopregel: thema links, nummer rechts
  const headerY = pad + F.themeFont * W * 0.85;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = muted;
  ctx.textAlign = 'right';
  const numSize = F.numberFont * W;
  ctx.font = `600 ${numSize}px ${FONT}`;
  ctx.fillText(String(card.number || ''), W - pad, headerY + numSize * 0.06);

  const numWidth = ctx.measureText(String(card.number || '')).width;
  ctx.textAlign = 'left';
  ctx.fillStyle = accent;
  fitText(ctx, card.theme || '', W - 2 * pad - numWidth - 0.04 * W, F.themeFont * W, '600');
  ctx.fillText(card.theme || '', pad, headerY);

  // foto
  const p = photoRect(W);
  const bw = 0.01 * W;
  ctx.save();
  roundRect(ctx, p.x, p.y, p.w, p.h, 0.012 * W);
  ctx.clip();
  if (card.image) {
    drawPhoto(ctx, card.image, p.x, p.y, p.w, p.h, card.focus, card.zoom, card.fit);
  } else {
    ctx.fillStyle = '#f2f4f6';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#9aa3ab';
    ctx.textAlign = 'center';
    ctx.font = `400 ${0.05 * W}px ${FONT}`;
    // Aanwijzingen alleen in de editor; niet op printvellen of de bekijkpagina.
    if (card.hints !== false) ctx.fillText('sleep hier een foto', p.x + p.w / 2, p.y + p.h / 2 + 0.018 * W);
  }
  ctx.restore();
  roundRect(ctx, p.x + bw / 2, p.y + bw / 2, p.w - bw, p.h - bw, 0.012 * W);
  ctx.lineWidth = bw;
  ctx.strokeStyle = card.image ? accent : '#d8dde2';
  ctx.stroke();

  // titellijst
  const listY = p.y + p.h + F.gap * W;
  const listH = H - pad - listY;
  roundRect(ctx, p.x + bw / 2, listY + bw / 2, p.w - bw, listH - bw, F.listRadius * W);
  ctx.lineWidth = bw;
  ctx.strokeStyle = accent;
  ctx.stroke();

  const inner = F.listPad * W;
  const lineH = (listH - 2 * inner) / 4;
  const titles = card.titles || [];
  ctx.textAlign = 'left';
  for (let i = 0; i < 4; i++) {
    const cy = listY + inner + lineH * (i + 0.5);
    const label = titles[i] || (card.hints !== false ? `titel ${i + 1}` : '');
    const isActive = i === card.activeIndex;
    ctx.beginPath();
    ctx.arc(p.x + inner + F.bullet * W, cy, F.bullet * W, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.fillStyle = titles[i] ? (isActive ? accent : text) : '#c8ced4';
    const tx = p.x + inner + F.bullet * W * 3.2;
    const size = fitText(ctx, label, p.w - (tx - p.x) - inner, F.titleFont * W, isActive ? '600' : '400');
    ctx.fillText(label, tx, cy + size * 0.35);
  }

  ctx.restore();
}

/* ---------------- achterkant ---------------- */
// Voor elk kaartje hetzelfde, anders kun je van achteren zien welk kwartet het is.

export function drawBack(ctx, W, back, style) {
  const H = W * CARD_RATIO;
  const pad = F.pad * W;
  const color = back.color || '#2f4858';
  const ink = back.ink || '#ffffff';
  const soft = back.soft || 'rgba(255,255,255,.16)';
  // Op een printvel loopt de kleur door tot de snijlijn (radius 0); in de
  // preview met afgeronde hoeken, zoals het kaartje er straks uitziet.
  const radius = style.radius === undefined ? F.radius * W : style.radius;

  // Op een eigen canvas (preview, PNG) eerst leegmaken: de hoeken buiten de
  // ronding blijven dan doorzichtig. Op een printpagina niet (style.wissen ===
  // false): een PDF-pagina is een JPEG, en doorzichtig wordt daar zwart.
  if (style.wissen !== false) ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (radius > 0) {
    roundRect(ctx, 0, 0, W, H, radius);
    ctx.clip();
  } else {
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
  }

  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);

  // eigen afbeelding: vult het hele kaartje
  if (back.image) {
    drawPhoto(ctx, back.image, 0, 0, W, H, back.focus, back.zoom, back.fit);
  }

  // motief: alleen als er geen eigen afbeelding is
  if (!back.image) {
    const step = 0.16 * W;
    ctx.fillStyle = soft;
    ctx.strokeStyle = soft;
    if (back.pattern === 'strepen') {
      ctx.lineWidth = 0.022 * W;
      for (let x = -H; x < W + H; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + H, H);
        ctx.stroke();
      }
    } else if (back.pattern !== 'effen') {
      const r = 0.018 * W;         // vier stippen: het kwartet zelf als motief
      const d = 0.045 * W;
      for (let y = step * 0.6; y < H; y += step) {
        for (let x = step * 0.6; x < W; x += step) {
          for (const [dx, dy] of [[-d, -d], [d, -d], [-d, d], [d, d]]) {
            ctx.beginPath();
            ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  }

  // titelband
  const title = (back.title || '').trim();
  if (title) {
    const bandH = 0.19 * W;
    const bandY = H / 2 - bandH / 2;
    ctx.fillStyle = color;
    ctx.globalAlpha = back.image ? 0.88 : 0.94;
    ctx.fillRect(0, bandY, W, bandH);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = soft;
    ctx.lineWidth = 0.008 * W;
    ctx.beginPath();
    ctx.moveTo(0, bandY); ctx.lineTo(W, bandY);
    ctx.moveTo(0, bandY + bandH); ctx.lineTo(W, bandY + bandH);
    ctx.stroke();

    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = fitText(ctx, title, W - 4 * pad, 0.082 * W, '700');
    ctx.fillText(title, W / 2, H / 2 + size * 0.03);
  }
  ctx.restore();
}
