// Tests voor het samenvoegen van wijzigingen van verschillende computers.
// Draaien met:  node tests/sync.test.mjs
import { mergeGame, equal } from '../js/sync.js';
const card = (id, title = '', photoId = null) => ({ id, title, photoId, focus: { x: .5, y: .5 }, zoom: 1 });
const q = (id, theme, titles = ['', '', '', '']) => ({ id, theme, color: '#eb5d47', cards: titles.map((t, i) => card(id + i, t)) });
const todo = (id, tekst, klaar = false) => ({ id, tekst, klaar, door: 'Anna', wanneer: '2026-09-19T12:00:00Z', kwartetId: null });
const game = (qs, todos = []) => ({ title: 'Spel', back: { color: '#2f4858', title: '', pattern: 'stippen', photoId: null, focus: { x: .5, y: .5 }, zoom: 1 }, todos, quartets: qs });
const C = (x) => JSON.parse(JSON.stringify(x));
let ok = 0, fout = 0;
const check = (naam, cond) => { cond ? ok++ : fout++; console.log((cond ? 'ok   ' : 'FOUT ') + naam); };
const base = game([q('A', 'Actief'), q('B', 'Muziek'), q('C', '')], [todo('t1', 'Foto oma'), todo('t2', 'Titel kwartet 3')]);

// bestaande scenario's (kwartetten)
{ const l = C(base); l.quartets[0].theme = 'Actief buiten'; const r = C(base); r.quartets[1].cards[2].title = 'Drums';
  const m = mergeGame(base, l, r); check('kwartetten: andere kwartetten', m.quartets[0].theme === 'Actief buiten' && m.quartets[1].cards[2].title === 'Drums'); }
{ const l = C(base); l.quartets.push(q('L', 'Hier')); const r = C(base); r.quartets.push(q('R', 'Daar'));
  check('kwartetten: nieuw aan beide kanten', mergeGame(base, l, r).quartets.map((x) => x.id).join('') === 'ABCRL'); }
{ const r = C(base); r.back.color = '#112233'; r.quartets[2].theme = 'Dieren'; r.todos[0].klaar = true;
  check('zonder eigen wijzigingen = serverversie', equal(mergeGame(base, C(base), r), r)); }
// wisselen: twee kaartjes hier gewisseld, daar een titel in een ander kwartet
{ const l = C(base); l.quartets[0].cards[0].title = 'X'; l.quartets[0].cards[1].title = 'Y';
  [l.quartets[0].cards[0].title, l.quartets[0].cards[1].title] = [l.quartets[0].cards[1].title, l.quartets[0].cards[0].title];
  const r = C(base); r.quartets[1].cards[0].title = 'Gitaar';
  const m = mergeGame(base, l, r);
  check('wissel hier + titel daar', m.quartets[0].cards[0].title === 'Y' && m.quartets[0].cards[1].title === 'X' && m.quartets[1].cards[0].title === 'Gitaar'); }

// takenlijst
{ const l = C(base); l.todos.push(todo('h', 'Hier bedacht')); const r = C(base); r.todos.push(todo('d', 'Daar bedacht'));
  check('taken: nieuw aan beide kanten', mergeGame(base, l, r).todos.map((t) => t.id).join(',') === 't1,t2,d,h'); }
{ const l = C(base); l.todos[0].klaar = true; const r = C(base); r.todos[0].tekst = 'Foto van oma (bij het raam)';
  const t = mergeGame(base, l, r).todos[0];
  check('taken: hier afgevinkt, daar tekst aangepast', t.klaar === true && t.tekst === 'Foto van oma (bij het raam)'); }
{ const r = C(base); r.todos.splice(1, 1);
  check('taken: daar weggehaald', mergeGame(base, C(base), r).todos.length === 1); }
{ const l = C(base); l.todos[1].klaar = true; const r = C(base); r.todos.splice(1, 1);
  check('taken: daar weggehaald maar hier afgevinkt: blijft', mergeGame(base, l, r).todos.some((t) => t.id === 't2')); }
{ const b0 = C(base); delete b0.todos; const l = C(b0); l.todos = [todo('n', 'Nieuw')]; const r = C(b0);
  check('taken: oud spel zonder takenlijst', mergeGame(b0, l, r).todos.length === 1); }

// foto-modus
{ const b2 = C(base); b2.quartets.forEach((x) => x.cards.forEach((c) => { c.fit = 'vullen'; })); b2.back.fit = 'vullen';
  const l = C(b2); l.quartets[0].cards[2].fit = 'passend'; const r = C(b2); r.quartets[0].cards[2].zoom = 1.3;
  const c = mergeGame(b2, l, r).quartets[0].cards[2];
  check('hele foto hier, zoom daar', c.fit === 'passend' && c.zoom === 1.3); }
// oudere versie van de app die een nieuw veld niet kent
{ const b3 = C(base); b3.quartets[0].cards[0].fit = 'passend'; b3.nieuwVeld = { x: 1 };
  const oud = C(b3); delete oud.quartets[0].cards[0].fit; delete oud.nieuwVeld;  // wat een oude versie 'kent'
  // maar de oude versie heeft het veld wel van de server gekregen: normalizeGame laat het nu staan,
  // dus 'local' bevat het nog. Simuleer daarom: local = server + eigen titelwijziging.
  const l = C(b3); l.quartets[1].theme = 'Muziek!';
  const m = mergeGame(b3, l, C(b3));
  check('onbekende velden blijven bewaard', m.quartets[0].cards[0].fit === 'passend' && m.nieuwVeld && m.nieuwVeld.x === 1 && m.quartets[1].theme === 'Muziek!'); }
{ const l = C(base); l.quartets[0].extra = 'hier'; const r = C(base); r.quartets[0].anders = 'daar';
  const m = mergeGame(base, l, r).quartets[0];
  check('nieuwe velden van beide kanten komen samen', m.extra === 'hier' && m.anders === 'daar'); }
// fotovoorraad
{ const foto = (id) => ({ id, photoId: id, toegevoegd: '2026-09-21T10:00:00Z' });
  const b4 = C(base); b4.voorraad = [foto('f1'), foto('f2')];
  const l = C(b4); l.voorraad.push(foto('hier'));
  const r = C(b4); r.voorraad.push(foto('daar')); r.voorraad = r.voorraad.filter((f) => f.id !== 'f2');
  const ids = mergeGame(b4, l, r).voorraad.map((f) => f.id).join(',');
  check('voorraad: nieuw aan beide kanten, daar weggegooid', ids === 'f1,daar,hier'); }
{ const b5 = C(base); b5.voorraad = [{ id: 'f1', photoId: 'f1' }];
  const l = C(b5); l.voorraad[0].fotoHash = 'abc:100';
  check('voorraad: vingerafdruk erbij blijft', mergeGame(b5, l, C(b5)).voorraad[0].fotoHash === 'abc:100'); }
console.log(`\n${ok} goed, ${fout} fout`);
process.exit(fout ? 1 : 0);
