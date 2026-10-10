// Verify a volunteer's block submission and merge it into the archive.
// Run by .github/workflows/verify-submission.yml. Also works locally:
//   node scripts/verify-submission.mjs --file submission.json --author alice --issue 12
//
// Writes result.json: { status: "verified" | "rejected" | "skipped", comment: "<markdown>" }.
// Only on "verified" are data files changed.
//
// Modes (env KNOT_VERIFY_MODE):
//   full  (default) re-run the whole block and require every chunk fingerprint to match.
//   audit re-run only a few chunks, picked at random, plus every index the volunteer claims.
//         Cheaper when blocks get expensive; a volunteer who skipped work is caught with
//         high probability over several blocks.
import { readFileSync, writeFileSync } from 'node:fs';
import { E, L, loadArchive, loadBlocks, saveArchive, saveBlocks, writeDrawing, runBlock, hashesOf, chunkHash, extractJson, siteUrl } from './lib.mjs';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const body = opt('--file') ? readFileSync(opt('--file'), 'utf8') : (process.env.ISSUE_BODY || '');
const author = opt('--author') || process.env.ISSUE_AUTHOR || null;
const issue = Number(opt('--issue') || process.env.ISSUE_NUMBER || 0) || null;
const mode = (process.env.KNOT_VERIFY_MODE || 'full').toLowerCase();
const AUDIT_CHUNKS = 2;

function finish(status, lines) {
  writeFileSync('result.json', JSON.stringify({ status, comment: lines.join('\n') }, null, 2));
  console.log(status.toUpperCase() + '\n' + lines.join('\n'));
  process.exit(0);
}
const reject = (why, extra = []) => finish('rejected', ['### ❌ Submission not accepted', '', why, ...extra, '', 'Nothing was added to the archive. The block stays open, so you or someone else can run it again.']);

// ---------- Parse and validate ----------
let sub;
try { sub = extractJson(body); } catch (e) { reject('I couldn’t find valid JSON results in this issue. Submit from the Contribute page, which fills this in for you.'); }

const archive = loadArchive();
const blocks = loadBlocks();
const nChunks = L.BLOCK_SIZE / L.CHUNK_SIZE;
const isHex = s => typeof s === 'string' && /^[0-9a-f]{16}$/.test(s);

if (sub.engine !== E.ENGINE_VERSION) reject(`These results were made with engine \`${sub.engine}\`, but the archive uses \`${E.ENGINE_VERSION}\`. Reload the Contribute page to get the current version.`);
if (!Number.isInteger(sub.block) || sub.block < 0 || sub.block > 1e7) reject('The block number is missing or invalid.');
if (!Array.isArray(sub.chunkHashes) || sub.chunkHashes.length !== nChunks || !sub.chunkHashes.every(isHex)) reject(`Expected ${nChunks} chunk fingerprints.`);
const start = sub.block * L.BLOCK_SIZE, end = start + L.BLOCK_SIZE - 1;
const claims = Array.isArray(sub.new) ? sub.new : [];
if (claims.length > L.BLOCK_SIZE || !claims.every(c => Number.isInteger(c.index) && c.index >= start && c.index <= end && typeof c.key === 'string' && c.key.length < 400)) reject('The list of new fingerprints is malformed.');
const shorter = Array.isArray(sub.shorter) ? sub.shorter.filter(s => Number.isInteger(s.index) && s.index >= start && s.index <= end).slice(0, 200) : [];
const seen = sub.seen && typeof sub.seen === 'object' ? sub.seen : {};

const existing = blocks.blocks.find(b => b.block === sub.block && b.status === 'verified');
if (existing) finish('skipped', [`### Block #${sub.block} is already verified`, '', `It was verified ${existing.issue ? 'in #' + existing.issue : 'as part of the starting archive'}${existing.by ? ' (credited to @' + existing.by + ')' : ''}. Thanks for running it anyway. Head back to the Contribute page for an open block.`]);

// ---------- Re-run ----------
const idx = L.indexArchive(archive);
const t0 = Date.now();
const lines = [];
const newIds = [], redraw = new Set();

if (mode === 'full') {
  const res = runBlock(sub.block);
  const hashes = hashesOf(res.keys);
  const bad = hashes.map((h, i) => (h === sub.chunkHashes[i] ? null : i)).filter(i => i !== null);
  if (bad.length) reject(`Re-running the block gave different results in ${bad.length} of ${nChunks} chunks (indexes ${bad.map(i => (start + i * L.CHUNK_SIZE) + '–' + (start + i * L.CHUNK_SIZE + L.CHUNK_SIZE - 1)).join(', ')}).`, ['', 'This usually means the page was out of date or the run was interrupted.']);
  for (const [i, { word, n }] of res.words) {
    const r = L.recordIndex(archive, idx, word, n, i, { by: author, source: issue ? 'issue #' + issue : 'local' });
    if (r.isNew) newIds.push(r.knot.id);
    if (r.drawingChanged) redraw.add(r.knot);
  }
} else {
  // audit: a few random chunks, chosen from the issue number so a rerun picks the same ones
  let seed = (issue || 1) * 7919 + sub.block;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const picks = new Set(); while (picks.size < Math.min(AUDIT_CHUNKS, nChunks)) picks.add(Math.floor(rnd() * nChunks));
  const wanted = new Set(claims.map(c => c.index).concat(shorter.map(s => s.index)));
  for (const c of picks) for (let i = 0; i < L.CHUNK_SIZE; i++) wanted.add(start + c * L.CHUNK_SIZE + i);
  const got = new Map();
  L.walk(start, end, (i, word, n) => { if (wanted.has(i)) got.set(i, { word, n, key: E.analyze(word, n).key }); });
  for (const c of picks) {
    const keys = []; for (let i = 0; i < L.CHUNK_SIZE; i++) keys.push(got.get(start + c * L.CHUNK_SIZE + i).key);
    if (chunkHash(keys) !== sub.chunkHashes[c]) reject(`A spot check of indexes ${start + c * L.CHUNK_SIZE}–${start + c * L.CHUNK_SIZE + L.CHUNK_SIZE - 1} didn’t match your results.`);
    // every unknown fingerprint in an audited chunk must have been reported
    const firstSeen = new Map();
    for (let i = 0; i < L.CHUNK_SIZE; i++) { const g = got.get(start + c * L.CHUNK_SIZE + i); if (!idx.byKey.has(g.key) && !firstSeen.has(g.key)) firstSeen.set(g.key, start + c * L.CHUNK_SIZE + i); }
    for (const [key] of firstSeen) if (!claims.some(cl => cl.key === key)) reject(`The spot check found a new knot in indexes ${start + c * L.CHUNK_SIZE}–${start + c * L.CHUNK_SIZE + L.CHUNK_SIZE - 1} that the submission didn’t report.`);
  }
  for (const cl of claims) {
    const g = got.get(cl.index);
    if (g.key !== cl.key) reject(`Index ${cl.index} doesn’t give the fingerprint the submission reports for it.`);
  }
  for (const i of [...claims.map(c => c.index), ...shorter.map(s => s.index)].sort((a, b) => a - b)) {
    const g = got.get(i);
    const r = L.recordIndex(archive, idx, g.word, g.n, i, { by: author, source: issue ? 'issue #' + issue : 'local', countHit: false });
    if (r.isNew) newIds.push(r.knot.id);
    if (r.drawingChanged) redraw.add(r.knot);
  }
  for (const [id, count] of Object.entries(seen)) {
    const k = idx.byId.get(Number(id));
    if (k && Number.isInteger(count) && count > 0 && count <= L.BLOCK_SIZE) k.hits = (k.hits || 0) + count;
  }
}

for (const k of redraw) writeDrawing(k);
blocks.blocks.push({ block: sub.block, start, end, status: 'verified', by: author, issue, mode, newKnots: newIds, chunkHashes: sub.chunkHashes, verifiedAt: new Date().toISOString() });
saveArchive(archive);
saveBlocks(blocks);

const site = siteUrl();
lines.push(`### ✅ Block #${sub.block} verified`, '');
lines.push(`Indexes ${start.toLocaleString('en-US')}–${end.toLocaleString('en-US')} were re-checked (${mode === 'full' ? 'full re-run' : 'spot check'}, ${((Date.now() - t0) / 1000).toFixed(1)} s).`, '');
if (newIds.length) {
  lines.push(`**${newIds.length} new knot${newIds.length === 1 ? '' : 's'}** added to the archive${author ? ', credited to @' + author : ''}:`, '');
  for (const id of newIds) {
    const k = idx.byId.get(id);
    lines.push(`- [${L.label(k)}](${site}/knot.html?id=${id}): ${L.crossingText(k)}, first found at index ${k.discoveredAtIndex}`);
  }
} else {
  lines.push('No new knots in this block. Every index was a knot the archive already has, which still counts: the block is now marked as searched.');
}
lines.push('', `The archive now has ${archive.knots.length} knots. The site updates within a few minutes.`);
finish('verified', lines);
