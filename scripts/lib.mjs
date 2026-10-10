// Helpers shared by the verification scripts.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const E = require(join(ROOT, 'assets/js/engine.js'));
export const KD = require(join(ROOT, 'assets/js/diagram.js'));
export const L = require(join(ROOT, 'assets/js/knotlib.js'));

const KNOTS = join(ROOT, 'data/knots.json');
const BLOCKS = join(ROOT, 'data/blocks.json');
const DRAWINGS = join(ROOT, 'data/drawings');

export function loadArchive() {
  if (!existsSync(KNOTS)) {
    return { format: 'knot-archive/2', engine: E.ENGINE_VERSION, blockSize: L.BLOCK_SIZE, chunkSize: L.CHUNK_SIZE, updated: null, knots: [] };
  }
  return JSON.parse(readFileSync(KNOTS, 'utf8'));
}
// data/blocks.json:
//   count  the global block count: how many blocks have been verified. It goes up by one for every block accepted.
//   next   the block the Contribute page hands out next: the lowest block number not yet verified.
//   blocks one entry per verified block; "seq" is the global count at the moment it was accepted.
export function loadBlocks() {
  if (!existsSync(BLOCKS)) return { count: 0, next: 0, blocks: [] };
  const b = JSON.parse(readFileSync(BLOCKS, 'utf8'));
  b.blocks = b.blocks || [];
  return b;
}
// Add a verified block and give it the next global sequence number.
export function addVerifiedBlock(blocks, entry) {
  const seq = blocks.blocks.filter(b => b.status === 'verified').length + 1;
  blocks.blocks.push({ seq, ...entry, status: 'verified' });
  return seq;
}
export const isVerified = (blocks, n) => blocks.blocks.some(b => b.block === n && b.status === 'verified');

// One knot per line keeps diffs readable in pull requests and commits.
export function saveArchive(archive) {
  archive.updated = new Date().toISOString();
  const { knots, ...head } = archive;
  const lines = knots.map(k => '  ' + JSON.stringify(k));
  const text = JSON.stringify(head, null, 2).replace(/\n}$/, ',\n  "knots": [\n' + lines.join(',\n') + '\n  ]\n}\n');
  writeFileSync(KNOTS, text);
}
export function saveBlocks(blocks) {
  blocks.blocks.sort((a, b) => a.block - b.block);
  const done = new Set(blocks.blocks.filter(b => b.status === 'verified').map(b => b.block));
  let next = 0; while (done.has(next)) next++;
  blocks.count = done.size;
  blocks.next = next;
  const lines = blocks.blocks.map(b => '  ' + JSON.stringify(b));
  writeFileSync(BLOCKS, '{\n "count": ' + blocks.count + ',\n "next": ' + blocks.next + ',\n "blocks": [\n' + lines.join(',\n') + (lines.length ? '\n' : '') + ' ]\n}\n');
}
export function writeDrawing(k) {
  mkdirSync(DRAWINGS, { recursive: true });
  writeFileSync(join(DRAWINGS, k.id + '.json'), JSON.stringify(L.drawing(k)) + '\n');
}

// Fingerprint of one chunk of indexes: the same in the browser (SubtleCrypto) and here.
export function chunkHash(keys) {
  return createHash('sha256').update(keys.join('\n')).digest('hex').slice(0, 16);
}

// Run every index of a block. Returns { keys: [...1000], words: Map(index -> {word, n}) }.
export function runBlock(block, it) {
  const start = block * L.BLOCK_SIZE, end = start + L.BLOCK_SIZE - 1;
  const keys = [], words = new Map();
  it = L.walk(start, end, (i, word, n) => {
    keys.push(E.analyze(word, n).key);
    words.set(i, { word, n });
  }, it);
  return { keys, words, it };
}
export function hashesOf(keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += L.CHUNK_SIZE) out.push(chunkHash(keys.slice(i, i + L.CHUNK_SIZE)));
  return out;
}

// Pull a JSON object out of an issue body (```json fenced block, or the outermost braces).
export function extractJson(body) {
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fence ? fence[1] : body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1);
  return JSON.parse(text);
}

export function siteUrl() {
  const repo = process.env.GITHUB_REPOSITORY || 'OWNER/REPO';
  const [owner, name] = repo.split('/');
  return name.toLowerCase() === owner.toLowerCase() + '.github.io' ? `https://${name}` : `https://${owner}.github.io/${name}`;
}
