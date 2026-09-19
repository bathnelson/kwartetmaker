// Dubbele foto's herkennen aan wat erop staat, niet aan de bestandsnaam.
//
// Dezelfde foto kan vanaf verschillende computers, als HEIC of JPEG, of in een
// ander formaat binnenkomen, en krijgt dan steeds een andere naam. Daarom een
// vingerafdruk van het beeld zelf (een "dHash"): de foto verkleind tot 9 x 8
// grijze vlakjes, en per rij of elk vlakje lichter is dan zijn rechterbuur.
// Dat geeft 64 bits die gelijk blijven bij verkleinen of opnieuw opslaan. Plus
// de verhouding breedte/hoogte, om toevallige gelijkenissen uit te sluiten.
//
// De vingerafdruk wordt als tekst bij het kaartje bewaard ("a1b2...:133"), dus
// hij gaat mee met samenwerken en back-ups.

/** @returns {string} "<16 hex>:<breedte/hoogte x 100>" */
export function vingerafdruk(img) {
  const W = 90, H = 80;                        // 10 x 10 pixels per vlakje
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const vlak = new Float64Array(9 * 8);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      vlak[Math.floor(y / 10) * 9 + Math.floor(x / 10)] += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
  }
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (vlak[y * 9 + x] > vlak[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return `${bits.toString(16).padStart(16, '0')}:${Math.round((img.width / img.height) * 100)}`;
}

/** Zelfde foto (of vrijwel dezelfde)? Hoogstens 6 van de 64 bits verschillend. */
export function lijktOp(a, b) {
  if (!a || !b) return false;
  const [ha, ra] = a.split(':');
  const [hb, rb] = b.split(':');
  if (!/^[0-9a-f]{16}$/.test(ha) || !/^[0-9a-f]{16}$/.test(hb)) return false;
  if (Math.abs(Number(ra) - Number(rb)) > 3) return false;
  let x = BigInt('0x' + ha) ^ BigInt('0x' + hb);
  let verschil = 0;
  while (x) { verschil += Number(x & 1n); x >>= 1n; }
  return verschil <= 6;
}

/** Alle plekken met een foto: kaartjes en de achterkant. */
function plekken(game) {
  const uit = [];
  game.quartets.forEach((q, qi) => q.cards.forEach((c, ci) => {
    if (c.photoId) uit.push({ qi, ci, id: c.photoId, hash: c.fotoHash, sleutel: `${qi}:${ci}` });
  }));
  const b = game.back || {};
  if (b.photoId) uit.push({ achter: true, id: b.photoId, hash: b.fotoHash, sleutel: 'achter' });
  return uit;
}

const zelfde = (a, b) => a.id === b.id || lijktOp(a.hash, b.hash);

/**
 * @returns {Map<string, object[]>} per plek ("qi:ci" of "achter") de andere
 *          plekken waar dezelfde foto staat
 */
export function zoekDubbel(game) {
  const alle = plekken(game);
  const dubbel = new Map();
  for (let i = 0; i < alle.length; i++) {
    for (let j = i + 1; j < alle.length; j++) {
      if (!zelfde(alle[i], alle[j])) continue;
      for (const [p, ander] of [[alle[i], alle[j]], [alle[j], alle[i]]]) {
        if (!dubbel.has(p.sleutel)) dubbel.set(p.sleutel, []);
        dubbel.get(p.sleutel).push(ander);
      }
    }
  }
  return dubbel;
}

/** Waar staat hij ook? Bijv. 'kwartet 3 “Dieren”, kaartje 2 (Kat)'. */
export function beschrijfPlek(game, plek) {
  if (plek.achter) return 'de achterkant';
  const q = game.quartets[plek.qi];
  const thema = q.theme.trim() ? ` “${q.theme.trim()}”` : '';
  const titel = q.cards[plek.ci].title.trim();
  return `kwartet ${plek.qi + 1}${thema}, kaartje ${plek.ci + 1}${titel ? ` (${titel})` : ''}`;
}
