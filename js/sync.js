// Wijzigingen van twee computers samenvoegen (three-way merge).
//
//   base   = de versie die deze browser het laatst van de server kreeg
//   local  = wat er nu in deze browser staat
//   remote = wat er nu op de server staat (van een andere computer)
//
// Per veld: heb je het hier veranderd, dan wint jouw versie; anders die van de
// ander. Zo overschrijft niemand elkaars werk, zolang je niet precies hetzelfde
// veld tegelijk aanpast (dan wint wie het laatst opslaat).

// Alle velden worden samengevoegd, ook velden die deze versie van de app nog
// niet kent. Zo kan een oudere versie die nog ergens openstaat geen gegevens van
// een nieuwere versie weggooien.

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

function mergeFields(b = {}, l = {}, r = {}, behalve = []) {
  const out = {};
  const keys = new Set([...Object.keys(b || {}), ...Object.keys(l || {}), ...Object.keys(r || {})]);
  for (const k of keys) {
    if (behalve.includes(k)) continue;
    const v = pick((b || {})[k], (l || {})[k], (r || {})[k]);
    if (v !== undefined) out[k] = v;       // hier weggehaald, of nergens: weglaten
  }
  return out;
}

function mergeQuartet(b, l, r) {
  if (!b) return clone(l);
  return {
    ...mergeFields(b, l, r, ['cards']),
    cards: l.cards.map((lc, i) => mergeFields(b.cards && b.cards[i], lc, r.cards && r.cards[i])),
  };
}

// Lijst met items (elk met een id) samenvoegen. Nieuw aan één kant: erbij.
// Aan één kant verwijderd: weg, tenzij de andere kant hem intussen aanpaste.
function mergeList(bl = [], ll = [], rl = [], mergeItem) {
  const byId = (list) => new Map(list.map((x) => [x.id, x]));
  const B = byId(bl);
  const L = byId(ll);
  const R = byId(rl);
  const out = [];

  // Volgorde van de server aanhouden...
  for (const r of rl) {
    const l = L.get(r.id);
    const b = B.get(r.id);
    if (l) out.push(mergeItem(b, l, r));
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

function mergeTodo(b, l, r) {
  return b ? mergeFields(b, l, r) : clone(l);
}

export function mergeGame(base, local, remote) {
  if (!remote) return clone(local);
  if (!base) return clone(remote);
  return {
    ...mergeFields(base, local, remote, ['back', 'todos', 'quartets']),
    back: mergeFields(base.back, local.back, remote.back),
    todos: mergeList(base.todos, local.todos, remote.todos, mergeTodo),
    quartets: mergeList(base.quartets, local.quartets, remote.quartets, mergeQuartet),
  };
}
