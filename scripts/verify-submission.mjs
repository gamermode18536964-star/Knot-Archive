// Verify a volunteer's submission (one or more blocks) and merge it into the archive.
// Run by .github/workflows/verify-submission.yml. Also works locally:
//   node scripts/verify-submission.mjs --file issue.md --author alice --issue 12
//
// Writes result.json: { status: "verified" | "rejected" | "skipped", comment: "<markdown>" }.
// Each block is judged on its own: matching blocks are accepted, blocks someone else verified
// first are skipped, and a block whose results don't match is rejected without affecting the rest.
//
// Modes (env KNOT_VERIFY_MODE):
//   full  (default) re-run each whole block and require every chunk fingerprint to match.
//   audit re-run only a few chunks per block, picked at random, plus every index the volunteer
//         claims. Cheaper when blocks get expensive; skipped work is caught with high probability.
import { readFileSync, writeFileSync } from 'node:fs';
import { E, L, loadArchive, loadBlocks, saveArchive, saveBlocks, addVerifiedBlock, isVerified, writeDrawing, runBlock, hashesOf, chunkHash, extractJson, siteUrl } from './lib.mjs';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const body = opt('--file') ? readFileSync(opt('--file'), 'utf8') : (process.env.ISSUE_BODY || '');
const author = opt('--author') || process.env.ISSUE_AUTHOR || null;
const issue = Number(opt('--issue') || process.env.ISSUE_NUMBER || 0) || null;
const mode = (process.env.KNOT_VERIFY_MODE || 'full').toLowerCase();
const AUDIT_CHUNKS = 2;
const MAX_BLOCKS = 20;
const nChunks = L.BLOCK_SIZE / L.CHUNK_SIZE;
const fmt = n => n.toLocaleString('en-US');
const range = b => `${fmt(b * L.BLOCK_SIZE)}–${fmt(b * L.BLOCK_SIZE + L.BLOCK_SIZE - 1)}`;

function finish(status, lines) {
  writeFileSync('result.json', JSON.stringify({ status, comment: lines.join('\n') }, null, 2));
  console.log(status.toUpperCase() + '\n' + lines.join('\n'));
  process.exit(0);
}
const rejectAll = why => finish('rejected', ['### ❌ Submission not accepted', '', why, '', 'Nothing was added to the archive. Head back to the Contribute page to run new blocks.']);

// ---------- Parse ----------
let sub;
try { sub = extractJson(body); } catch (e) { rejectAll('I couldn’t find valid JSON results in this issue. Submit from the Contribute page, which fills this in for you.'); }
if (sub.engine !== E.ENGINE_VERSION) rejectAll(`These results were made with engine \`${sub.engine}\`, but the archive uses \`${E.ENGINE_VERSION}\`. Reload the Contribute page to get the current version.`);
// Formats: v3 (compact, what the Contribute page sends), v2 (list of blocks), v1 (one block at the top level).
//   v3 block: { b: block, h: "<10 chunk fingerprints, 16 hex characters each, joined>", n: [new-knot indexes], s: [[knot id, index of a shorter braid]] }
function normalize(it) {
  if (it.b === undefined) return it;
  return {
    block: it.b,
    chunkHashes: typeof it.h === 'string' ? it.h.match(/.{1,16}/g) || [] : [],
    new: Array.isArray(it.n) ? it.n.map(index => ({ index })) : [],
    shorter: Array.isArray(it.s) ? it.s.filter(x => Array.isArray(x)).map(([id, index]) => ({ id, index })) : [],
  };
}
const items = (Array.isArray(sub.blocks) ? sub.blocks : [sub]).map(normalize);
if (!items.length) rejectAll('The submission doesn’t contain any blocks.');
if (items.length > MAX_BLOCKS) rejectAll(`A submission can hold at most ${MAX_BLOCKS} blocks; this one has ${items.length}.`);
const nums = items.map(it => it.block);
if (!nums.every(n => Number.isInteger(n) && n >= 0 && n <= 1e7)) rejectAll('A block number is missing or invalid.');
if (new Set(nums).size !== nums.length) rejectAll('The same block appears twice in this submission.');
items.sort((a, b) => a.block - b.block);

const archive = loadArchive();
const blocks = loadBlocks();
const idx = L.indexArchive(archive);
let iter = null; // the enumeration continues from block to block instead of restarting
const isHex = s => typeof s === 'string' && /^[0-9a-f]{16}$/.test(s);

// ---------- Verify one block. Returns {ok, newIds, redraw} or {ok:false, reason}. ----------
// Nothing is written to the archive until every check for the block has passed.
function verifyBlock(it) {
  const start = it.block * L.BLOCK_SIZE, end = start + L.BLOCK_SIZE - 1;
  if (!Array.isArray(it.chunkHashes) || it.chunkHashes.length !== nChunks || !it.chunkHashes.every(isHex)) return { ok: false, reason: `expected ${nChunks} chunk fingerprints` };
  const claims = Array.isArray(it.new) ? it.new : [];
  if (claims.length > L.BLOCK_SIZE || !claims.every(c => Number.isInteger(c.index) && c.index >= start && c.index <= end && (c.key === undefined || (typeof c.key === 'string' && c.key.length < 400)))) return { ok: false, reason: 'the list of new fingerprints is malformed' };
  const shorter = Array.isArray(it.shorter) ? it.shorter.filter(s => Number.isInteger(s.index) && s.index >= start && s.index <= end).slice(0, 200) : [];
  const seen = it.seen && typeof it.seen === 'object' ? it.seen : {};
  const meta = { by: author, source: issue ? 'issue #' + issue : 'local' };
  const newIds = [], redraw = new Set();

  if (mode === 'full') {
    const res = runBlock(it.block, iter); iter = res.it;
    const hashes = hashesOf(res.keys);
    const bad = hashes.map((h, i) => (h === it.chunkHashes[i] ? null : i)).filter(i => i !== null);
    if (bad.length) return { ok: false, reason: `re-running it gave different results in ${bad.length} of ${nChunks} chunks (indexes ${bad.map(i => fmt(start + i * L.CHUNK_SIZE) + '–' + fmt(start + i * L.CHUNK_SIZE + L.CHUNK_SIZE - 1)).join(', ')})` };
    for (const [i, { word, n }] of res.words) {
      const r = L.recordIndex(archive, idx, word, n, i, meta);
      if (r.isNew) newIds.push(r.knot.id);
      if (r.drawingChanged) redraw.add(r.knot);
    }
    return { ok: true, newIds, redraw };
  }

  // audit: a few random chunks, chosen from the issue number so a rerun picks the same ones
  let seed = (issue || 1) * 7919 + it.block;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const picks = new Set(); while (picks.size < Math.min(AUDIT_CHUNKS, nChunks)) picks.add(Math.floor(rnd() * nChunks));
  const wanted = new Set(claims.map(c => c.index).concat(shorter.map(s => s.index)));
  for (const c of picks) for (let i = 0; i < L.CHUNK_SIZE; i++) wanted.add(start + c * L.CHUNK_SIZE + i);
  const got = new Map();
  iter = L.walk(start, end, (i, word, n) => { if (wanted.has(i)) got.set(i, { word, n, key: E.analyze(word, n).key }); }, iter);
  for (const c of picks) {
    const from = start + c * L.CHUNK_SIZE, keys = [];
    for (let i = 0; i < L.CHUNK_SIZE; i++) keys.push(got.get(from + i).key);
    if (chunkHash(keys) !== it.chunkHashes[c]) return { ok: false, reason: `a spot check of indexes ${fmt(from)}–${fmt(from + L.CHUNK_SIZE - 1)} didn’t match` };
    // every unknown fingerprint in an audited chunk must have been reported somewhere in the block
    const claimedKeys = new Set(claims.map(cl => got.get(cl.index).key));
    for (const key of keys) if (!idx.byKey.has(key) && !claimedKeys.has(key)) return { ok: false, reason: `a spot check of indexes ${fmt(from)}–${fmt(from + L.CHUNK_SIZE - 1)} found a new knot the submission didn’t report` };
  }
  for (const cl of claims) if (cl.key !== undefined && got.get(cl.index).key !== cl.key) return { ok: false, reason: `index ${fmt(cl.index)} doesn’t give the fingerprint reported for it` };
  for (const i of [...new Set([...claims.map(c => c.index), ...shorter.map(s => s.index)])].sort((a, b) => a - b)) {
    const g = got.get(i);
    const r = L.recordIndex(archive, idx, g.word, g.n, i, { ...meta, countHit: false });
    if (r.isNew) newIds.push(r.knot.id);
    if (r.drawingChanged) redraw.add(r.knot);
  }
  for (const [id, count] of Object.entries(seen)) {
    const k = idx.byId.get(Number(id));
    if (k && Number.isInteger(count) && count > 0 && count <= L.BLOCK_SIZE) k.hits = (k.hits || 0) + count;
  }
  return { ok: true, newIds, redraw };
}

// ---------- Run every block ----------
const t0 = Date.now();
const accepted = [], skipped = [], failed = [];
for (const it of items) {
  if (isVerified(blocks, it.block)) {
    const e = blocks.blocks.find(b => b.block === it.block && b.status === 'verified');
    skipped.push({ block: it.block, why: e.issue ? `already verified in #${e.issue}` : 'part of the starting archive' });
    continue;
  }
  const r = verifyBlock(it);
  if (!r.ok) { failed.push({ block: it.block, why: r.reason }); continue; }
  for (const k of r.redraw) writeDrawing(k);
  const seq = addVerifiedBlock(blocks, { block: it.block, start: it.block * L.BLOCK_SIZE, end: it.block * L.BLOCK_SIZE + L.BLOCK_SIZE - 1, by: author, issue, mode, newKnots: r.newIds, chunkHashes: it.chunkHashes, verifiedAt: new Date().toISOString() });
  accepted.push({ block: it.block, seq, newIds: r.newIds });
}

// ---------- Report ----------
const site = siteUrl();
const lines = [];
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const knotLinks = ids => ids.length === 0 ? 'none' : ids.length <= 4 ? ids.map(id => `[#${id}](${site}/knot.html?id=${id})`).join(', ') : `${ids.length} (#${ids[0]}–#${ids[ids.length - 1]})`;
const skippedList = () => skipped.map(s => `- Block #${s.block}: ${s.why}`);
const failedList = () => failed.map(f => `- Block #${f.block}: ${f.why}.`);
if (accepted.length) {
  saveArchive(archive);
  saveBlocks(blocks);
  const allNew = accepted.flatMap(a => a.newIds);
  lines.push(`### ✅ ${accepted.length === 1 ? 'Block #' + accepted[0].block + ' verified' : accepted.length + ' blocks verified'}`, '');
  lines.push(`Re-checked with a ${mode === 'full' ? 'full re-run' : 'spot check'} in ${secs} s. The global block count is now **${blocks.count}**.`, '');
  lines.push('| Block | Indexes | Global count | New knots |', '| --- | --- | --- | --- |');
  for (const a of accepted) lines.push(`| #${a.block} | ${range(a.block)} | ${a.seq} | ${knotLinks(a.newIds)} |`);
  lines.push('');
  if (allNew.length) {
    lines.push(`**${allNew.length} new knot${allNew.length === 1 ? '' : 's'}** added${author ? ', credited to @' + author : ''}:`, '');
    for (const id of allNew.slice(0, 30)) { const k = idx.byId.get(id); lines.push(`- [${L.label(k)}](${site}/knot.html?id=${id}): ${L.crossingText(k)}, first found at index ${fmt(k.discoveredAtIndex)}`); }
    if (allNew.length > 30) lines.push(`- …and ${allNew.length - 30} more`);
  } else lines.push('No new knots this time. Every index was a knot the archive already has, which still counts: these blocks are now marked as searched.');
  if (skipped.length) lines.push('', '**Skipped**, because someone verified these first:', '', ...skippedList());
  if (failed.length) lines.push('', '**Not accepted:**', '', ...failedList(), '', 'Rejected blocks stay open and will be handed out again. This usually means the page was out of date or the run was interrupted.');
  lines.push('', `The archive now has ${archive.knots.length} knots. The site updates within a few minutes.`);
} else if (failed.length) {
  lines.push('### ❌ Submission not accepted', '', ...failedList(), '', 'This usually means the page was out of date or the run was interrupted. Rejected blocks stay open and will be handed out again.');
  if (skipped.length) lines.push('', 'These were verified by someone else first:', '', ...skippedList());
  lines.push('', 'Nothing was added to the archive.');
} else {
  lines.push('### These blocks were already verified', '', ...skippedList(), '', 'Thanks for running them anyway. Head back to the Contribute page for new blocks.');
}
finish(accepted.length ? 'verified' : failed.length ? 'rejected' : 'skipped', lines);
