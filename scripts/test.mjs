// Sanity checks run on every push and pull request (.github/workflows/test.yml).
//   1. The engine still computes the right invariants for well-known knots.
//   2. data/knots.json is consistent: unique ids and fingerprints, valid diagrams, drawings present.
//   3. Every description file belongs to a knot.
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, E, KD, L, loadArchive, loadBlocks } from './lib.mjs';

let failures = 0;
const fail = msg => { failures++; console.error('✗ ' + msg); };
const ok = msg => console.log('✓ ' + msg);

// 1. Known knots (braid words from KnotInfo; Alexander polynomials from the Rolfsen table)
const known = [
  ['3₁', [1, 1, 1], 2, '1,-1,1'], ['4₁', [1, -2, 1, -2], 3, '-1,3,-1'], ['5₁', [1, 1, 1, 1, 1], 2, '1,-1,1,-1,1'],
  ['5₂', [1, 1, 1, 2, -1, 2], 3, '2,-3,2'], ['6₂', [1, 1, 1, -2, 1, -2], 3, '-1,3,-3,3,-1'], ['6₃', [1, 1, -2, 1, -2, -2], 3, '1,-3,5,-3,1'],
];
for (const [name, w, n, alex] of known) {
  const r = E.analyze(w, n);
  if (r.alexander.join() !== alex) fail(`${name}: Alexander polynomial ${r.alexander} should be ${alex}`);
  const D = KD.simplify(KD.fromBraid(w, n), 1, 300, r.jonesSpan);
  if (L.canonStr(KD.jonesFromDiagram(D)) !== L.canonStr(r.jones)) fail(`${name}: simplified diagram changed the Jones polynomial`);
}
const square = E.analyze([1, 1, 1, -2, -2, -2], 3), granny = E.analyze([1, 1, 1, 2, 2, 2], 3);
if (square.key === granny.key || square.chiral || !granny.chiral) fail('granny and square knots must be told apart');
ok('engine invariants for known knots');

// 2. Archive
const archive = loadArchive();
if (archive.engine !== E.ENGINE_VERSION) fail(`archive engine ${archive.engine} ≠ ${E.ENGINE_VERSION}`);
const ids = new Set(), keys = new Set();
archive.knots.forEach((k, i) => {
  if (k.id !== i + 1) fail(`knot at position ${i} has id ${k.id}, expected ${i + 1}`);
  if (ids.has(k.id)) fail(`duplicate id ${k.id}`); ids.add(k.id);
  if (keys.has(k.key)) fail(`duplicate fingerprint on #${k.id}`); keys.add(k.key);
  const r = E.analyze(k.braid, k.strands);
  if (r.key !== k.key) fail(`#${k.id}: braid does not reproduce its fingerprint`);
  if (!Array.isArray(k.pd)) fail(`#${k.id}: missing diagram`);
  else if (k.pd.length) {
    const D = L.fromPD(k.pd);
    if (!KD.isValid(D)) fail(`#${k.id}: diagram is not a valid planar knot diagram`);
    else if (L.canonStr(KD.jonesFromDiagram(D)) !== L.canonStr(k.jones)) fail(`#${k.id}: diagram does not match its Jones polynomial`);
  }
  if (!existsSync(join(ROOT, 'data/drawings', k.id + '.json'))) fail(`#${k.id}: missing drawing data/drawings/${k.id}.json`);
});
ok(`${archive.knots.length} knots checked`);

const blocks = loadBlocks();
const seenBlocks = new Set();
for (const b of blocks.blocks) {
  if (seenBlocks.has(b.block)) fail(`block ${b.block} listed twice`); seenBlocks.add(b.block);
  for (const id of b.newKnots || []) if (!ids.has(id)) fail(`block ${b.block} credits unknown knot #${id}`);
}
const verifiedList = blocks.blocks.filter(b => b.status === 'verified');
if (blocks.count !== verifiedList.length) fail(`blocks.json count is ${blocks.count} but ${verifiedList.length} blocks are verified`);
let nextFree = 0; while (verifiedList.some(b => b.block === nextFree)) nextFree++;
if (blocks.next !== nextFree) fail(`blocks.json next is ${blocks.next}, expected ${nextFree}`);
const seqs = verifiedList.map(b => b.seq).sort((a, b) => a - b);
if (seqs.some((s, i) => s !== i + 1)) fail('block sequence numbers should run 1, 2, 3… with no gaps');
ok(`${blocks.blocks.length} blocks checked (global block count ${blocks.count}, next block #${blocks.next})`);

// 3. Descriptions
const dir = join(ROOT, 'data/descriptions');
for (const f of existsSync(dir) ? readdirSync(dir) : []) {
  const m = f.match(/^(\d+)\.md$/);
  if (!m) { fail(`data/descriptions/${f}: name it after the knot number, like 5.md`); continue; }
  if (!ids.has(Number(m[1]))) fail(`data/descriptions/${f}: there is no knot #${m[1]}`);
  const text = readFileSync(join(dir, f), 'utf8');
  if (text.length > 20000) fail(`data/descriptions/${f}: keep descriptions under 20,000 characters`);
  if (/<\s*script|javascript:/i.test(text)) fail(`data/descriptions/${f}: scripts are not allowed in descriptions`);
}
ok('descriptions checked');

if (failures) { console.error(`\n${failures} problem${failures === 1 ? '' : 's'} found`); process.exit(1); }
console.log('\nAll checks passed');
