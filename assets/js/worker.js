// Volunteer search worker. Runs a set of 100-index chunks from one block and reports
// each chunk's fingerprints. The page starts one worker per CPU core the volunteer picks.
importScripts('engine.js');

let job = null, paused = false;

onmessage = e => {
  const m = e.data;
  if (m.type === 'start') {
    job = {
      blockStart: m.blockStart, chunkSize: m.chunkSize, chunks: m.chunks.slice().sort((a, b) => a - b),
      known: new Map(m.known), // key -> [id, braid length]
      gen: KnotEngine.candidates(KnotEngine.MAX_STRANDS), pos: 0, ci: 0, cur: null, pending: 0, lastPost: 0,
    };
    paused = false;
    setTimeout(step, 0);
  } else if (m.type === 'pause') paused = true;
  else if (m.type === 'resume') { if (paused) { paused = false; setTimeout(step, 0); } }
};

// Work in ~40 ms slices so pause messages get through.
function step() {
  if (!job || paused) return;
  const until = Date.now() + 40;
  while (Date.now() < until) {
    if (!job.cur) {
      if (job.ci >= job.chunks.length) { flush(true); postMessage({ type: 'done' }); job = null; return; }
      const c = job.chunks[job.ci];
      job.cur = { chunk: c, start: job.blockStart + c * job.chunkSize, keys: [], newOnes: [], newKeys: new Set(), seen: {}, shorter: {} };
    }
    const cur = job.cur;
    const nx = job.gen.next();
    if (nx.done) { postMessage({ type: 'error', message: 'Ran out of candidates' }); job = null; return; }
    const index = job.pos++;
    if (index < cur.start) continue; // fast-forward through earlier indexes (cheap filters only)
    const { word, strands } = nx.value;
    const r = KnotEngine.analyze(word, strands);
    cur.keys.push(r.key);
    const k = job.known.get(r.key);
    if (k) {
      cur.seen[k[0]] = (cur.seen[k[0]] || 0) + 1;
      if (word.length < k[1] && !(k[0] in cur.shorter)) cur.shorter[k[0]] = index;
    } else if (!cur.newKeys.has(r.key)) {
      cur.newKeys.add(r.key);
      cur.newOnes.push({ index, key: r.key, span: r.jonesSpan, unknot: r.isUnknot, length: word.length });
    }
    job.pending++;
    if (cur.keys.length === job.chunkSize) {
      flush(false);
      postMessage({ type: 'chunk', chunk: cur.chunk, keys: cur.keys, newOnes: cur.newOnes, seen: cur.seen, shorter: cur.shorter });
      job.cur = null; job.ci++;
    }
  }
  flush(false);
  setTimeout(step, 0);
}

function flush(force) {
  if (!job) return;
  const now = Date.now();
  if (job.pending && (force || now - job.lastPost > 150)) { postMessage({ type: 'progress', n: job.pending }); job.pending = 0; job.lastPost = now; }
}
