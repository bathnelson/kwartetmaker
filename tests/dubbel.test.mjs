// Tests voor het herkennen van dubbele foto's. Draaien met:  node tests/dubbel.test.mjs
import { lijktOp, zoekDubbel, beschrijfPlek } from '../js/dubbel.js';
let ok = 0, fout = 0;
const check = (naam, cond) => { cond ? ok++ : fout++; console.log((cond ? 'ok   ' : 'FOUT ') + naam); };

const A = 'f0e1d2c3b4a59687:133';
check('zelfde vingerafdruk', lijktOp(A, A));
check('4 bits anders (opnieuw opgeslagen): nog steeds gelijk', lijktOp(A, 'f0e1d2c3b4a5968' + '8' + ':133'));   // 7->8 = 4 bits
check('heel andere foto: niet gelijk', !lijktOp(A, '0f1e2d3c4b5a6978:133'));
check('zelfde beeld, andere verhouding: niet gelijk', !lijktOp(A, 'f0e1d2c3b4a59687:75'));
check('verhouding binnen 3%: gelijk', lijktOp(A, 'f0e1d2c3b4a59687:135'));
check('geen vingerafdruk: niet gelijk', !lijktOp(A, undefined) && !lijktOp('rommel', A));

const kaart = (title, photoId, fotoHash) => ({ title, photoId, fotoHash });
const game = {
  quartets: [
    { theme: 'Familie', cards: [kaart('Opa', 'p1', A), kaart('Oma', 'p2', '1111111111111111:75'), kaart('', null), kaart('', null)] },
    { theme: 'Dieren', cards: [kaart('Hond', 'p3', 'aaaaaaaaaaaaaaaa:133'), kaart('Kat', 'p9', 'f0e1d2c3b4a59686:133'), kaart('', null), kaart('', null)] },
  ],
  back: { photoId: 'p2' },                    // zelfde bestand als Oma
};
const d = zoekDubbel(game);
check('Opa (kw1) en Kat (kw2) herkend, andere naam, 1 bit anders', d.get('0:0')?.[0]?.sleutel === '1:1' && d.get('1:1')?.[0]?.sleutel === '0:0');
check('zelfde bestand op kaartje en achterkant herkend', d.get('0:1')?.[0]?.achter === true && d.get('achter')?.[0]?.sleutel === '0:1');
check('Hond niet dubbel', !d.has('1:0'));
check('beschrijving', beschrijfPlek(game, { qi: 1, ci: 1 }) === 'kwartet 2 “Dieren”, kaartje 2 (Kat)');
check('twee effen foto\'s (alleen nullen) niet als dubbel', !lijktOp('0000000000000000:150', '0000000000000001:150'));
check('bijna alleen enen ook niet', !lijktOp('ffffffffffffffff:100', 'fffffffffffffffe:100'));
console.log(`\n${ok} goed, ${fout} fout`);
process.exit(fout ? 1 : 0);
