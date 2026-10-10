// Build or extend the archive by running whole blocks locally, with no volunteers involved.
// Used to create the starting archive. Usage:
//   node scripts/seed.mjs 0-14            run blocks 0 to 14
//   node scripts/seed.mjs 15 --by alice   run block 15 and credit @alice
import { E, L, loadArchive, loadBlocks, saveArchive, saveBlocks, addVerifiedBlock, writeDrawing, runBlock, hashesOf } from './lib.mjs';

const args = process.argv.slice(2);
const range = args.find(a => /^\d+(-\d+)?$/.test(a));
if (!range) { console.error('Usage: node scripts/seed.mjs <block>[-<block>] [--by <github-name>]'); process.exit(1); }
const [from, to] = range.includes('-') ? range.split('-').map(Number) : [Number(range), Number(range)];
const byIdx = args.indexOf('--by');
const by = byIdx >= 0 ? args[byIdx + 1] : null;

const archive = loadArchive();
const blocks = loadBlocks();
if (archive.engine !== E.ENGINE_VERSION) { console.error(`Archive was built with ${archive.engine}, this engine is ${E.ENGINE_VERSION}.`); process.exit(1); }
const idx = L.indexArchive(archive);
const done = new Set(blocks.blocks.filter(b => b.status === 'verified').map(b => b.block));
let it = null;

for (let b = from; b <= to; b++) {
  if (done.has(b)) { console.log(`block ${b}: already verified, skipping`); continue; }
  const t0 = Date.now();
  const res = runBlock(b, it); it = res.it;
  const newIds = [], redraw = new Set();
  for (const [i, { word, n }] of res.words) {
    const r = L.recordIndex(archive, idx, word, n, i, { by, source: 'seed' });
    if (r.isNew) newIds.push(r.knot.id);
    if (r.drawingChanged) redraw.add(r.knot);
  }
  for (const k of redraw) writeDrawing(k);
  const seq = addVerifiedBlock(blocks, { block: b, start: b * L.BLOCK_SIZE, end: b * L.BLOCK_SIZE + L.BLOCK_SIZE - 1, by, issue: null, mode: 'seed', newKnots: newIds, chunkHashes: hashesOf(res.keys), verifiedAt: new Date().toISOString() });
  console.log(`block ${b} (global block count ${seq}): ${newIds.length} new knots (${archive.knots.length} total) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
saveArchive(archive);
saveBlocks(blocks);
