// Wijzigingen van twee computers samenvoegen (three-way merge).
//
//   base   = de versie die deze browser het laatst van de server kreeg
//   local  = wat er nu in deze browser staat
//   remote = wat er nu op de server staat (van een andere computer)
//
// Per veld: heb je het hier veranderd, dan wint jouw versie; anders die van de
// ander. Zo overschrijft niemand elkaars werk, zolang je niet precies hetzelfde
// veld tegelijk aanpast (dan wint wie het laatst opslaat).

const CARD_KEYS = ['title', 'photoId', 'focus', 'zoom'];
const BACK_KEYS = ['color', 'title', 'pattern', 'photoId', 'focus', 'zoom'];

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/** Diepe vergelijking, ongevoelig voor de volgorde van sleutels. */
export function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => equal(a[k], b[k]));
}

const pick = (b, l, r) => clone(equal(l, b) ? r : l);

function mergeFields(b = {}, l = {}, r = {}, keys) {
  const out = {};
  for (const k of keys) out[k] = pick(b[k], l[k], r[k]);
  return out;
}

function mergeQuartet(b, l, r) {
  if (!b) return clone(l);
  return {
    id: l.id,
    theme: pick(b.theme, l.theme, r.theme),
    color: pick(b.color, l.color, r.color),
    cards: l.cards.map((lc, i) => ({
      id: lc.id,
      ...mergeFields(b.cards[i], lc, r.cards[i], CARD_KEYS),
    })),
  };
}

function mergeQuartets(bl = [], ll = [], rl = []) {
  const byId = (list) => new Map(list.map((q) => [q.id, q]));
  const B = byId(bl);
  const L = byId(ll);
  const R = byId(rl);
  const out = [];

  // Volgorde van de server aanhouden...
  for (const r of rl) {
    const l = L.get(r.id);
    const b = B.get(r.id);
    if (l) out.push(mergeQuartet(b, l, r));
    else if (!b) out.push(clone(r));                // nieuw op de andere computer
    else if (!equal(r, b)) out.push(clone(r));      // hier verwijderd, daar aangepast: bewaren
    // anders hier verwijderd
  }
  // ...en wat hier nieuw is achteraan.
  for (const l of ll) {
    if (R.has(l.id)) continue;
    const b = B.get(l.id);
    if (!b) out.push(clone(l));                     // nieuw op deze computer
    else if (!equal(l, b)) out.push(clone(l));      // daar verwijderd, hier aangepast: bewaren
  }
  return out;
}

export function mergeGame(base, local, remote) {
  if (!remote) return clone(local);
  if (!base) return clone(remote);
  return {
    title: pick(base.title, local.title, remote.title),
    back: mergeFields(base.back, local.back, remote.back, BACK_KEYS),
    quartets: mergeQuartets(base.quartets, local.quartets, remote.quartets),
  };
}
