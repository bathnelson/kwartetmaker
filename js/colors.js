// Kleuren voor de thema's. Zestien tinten, gelijkmatig over de kleurcirkel en
// afwisselend licht/donker, zodat ze op een rij goed uit elkaar te houden zijn
// (kleinste onderlinge verschil dE76 ≈ 21) en op wit leesbaar blijven
// (contrast 3,3 - 6,6 : 1). De volgorde springt met stappen van 7 door de
// cirkel, dus kwartet 1, 2 en 3 verschillen meteen sterk.
export const PALETTE = [
  '#eb5d47', '#0c6a53', '#eb4cae', '#0c6e0d',
  '#bb63ee', '#4d6605', '#7584f0', '#8e5010',
  '#139aae', '#bc153d', '#12a149', '#a512a4',
  '#40a008', '#6335e9', '#9b8a08', '#1360ae',
];

export function isHex(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

/** Eerstvolgende kleur die nog niet (of het minst) gebruikt wordt. */
export function pickColor(used) {
  const lower = (used || []).filter(isHex).map((c) => c.toLowerCase());
  const counts = PALETTE.map((c) => lower.filter((u) => u === c).length);
  const min = Math.min(...counts);
  return PALETTE[counts.indexOf(min)];
}

export function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Zwarte of witte tekst, afhankelijk van wat beter leest op deze kleur. */
export function inkOn(hex) {
  const l = luminance(hex);
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? '#1f2428' : '#ffffff';
}

export function mix(hex, other, amount) {
  const a = rgb(hex), b = rgb(other);
  const c = a.map((v, i) => Math.round(255 * (v + (b[i] - v) * amount)));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
