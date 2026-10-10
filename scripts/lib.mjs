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
export function loadBlocks() {
  if (!existsSync(BLOCKS)) return { blocks: [] };
  return JSON.parse(readFileSync(BLOCKS, 'utf8'));
}

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
  const lines = blocks.blocks.map(b => '  ' + JSON.stringify(b));
  writeFileSync(BLOCKS, '{\n "blocks": [\n' + lines.join(',\n') + '\n ]\n}\n');
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
