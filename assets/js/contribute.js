// Contribute page: pick an open block, search it with web workers, show progress and ETA,
// then hand the results to GitHub as a pre-filled issue.
(async function () {
  'use strict';
  const S = window.Site, L = window.KnotLib, E = window.KnotEngine, $ = S.$;
  S.chrome('contribute');
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

  let archive, blocks;
  try { [archive, blocks] = await Promise.all([S.loadArchive(), S.loadBlocks()]); }
  catch (e) { $('blockTitle').textContent = 'The archive couldn’t be loaded'; $('progLabel').textContent = 'If you opened this file directly, serve the folder instead (see the README).'; return; }

  const verified = new Set(blocks.blocks.filter(b => b.status === 'verified').map(b => b.block));
  const known = archive.knots.map(k => [k.key, [k.id, k.braid.length]]);
  const knownKeys = new Set(archive.knots.map(k => k.key));
  const nChunks = L.BLOCK_SIZE / L.CHUNK_SIZE;

  // Blocks other volunteers have already submitted but that aren't verified yet.
  const claimed = new Set();
  if (S.repo) {
    try {
      const ctl = new AbortController(); setTimeout(() => ctl.abort(), 4000);
      const r = await fetch('https://api.github.com/repos/' + S.repo + '/issues?labels=block-submission&state=open&per_page=100', { signal: ctl.signal });
      if (r.ok) for (const is of await r.json()) { const m = (is.title || '').match(/#(\d+)/); if (m) claimed.add(Number(m[1])); }
    } catch (e) { /* offline or rate-limited: just skip the check */ }
  }

  // ---------- Block choice ----------
  let block = null;
  function pickBlock() {
    const free = []; for (let b = 0; free.length < 3; b++) if (!verified.has(b) && !claimed.has(b)) free.push(b);
    return free[Math.floor(Math.random() * free.length)]; // spread volunteers over the next few open blocks
  }
  function setBlock(b) {
    block = b;
    const start = b * L.BLOCK_SIZE;
    $('blockEyebrow').textContent = 'Your block · #' + b;
    $('blockTitle').textContent = 'Indexes ' + S.fmt(start) + ' – ' + S.fmt(start + L.BLOCK_SIZE - 1);
    $('blockPick').value = b;
    const note = verified.has(b) ? ' This block is already verified, so a submission will only be acknowledged.' : claimed.has(b) ? ' Someone has already submitted this block; it is waiting for the check.' : '';
    resetRun();
    $('progLabel').textContent = 'Press Start to search this block.' + note;
  }

  // ---------- Cores ----------
  const maxCores = Math.max(1, Math.min(16, navigator.hardwareConcurrency || 2));
  const coreOpts = [1, 2, 4, 8, 16].filter(n => n <= maxCores);
  let cores = store.get('knot-cores') || Math.min(4, Math.max(1, Math.floor(maxCores / 2)));
  if (!coreOpts.includes(cores)) cores = coreOpts[coreOpts.length - 1];
  function renderCores() {
    $('cores').innerHTML = coreOpts.map(n => '<button type="button" data-n="' + n + '" aria-pressed="' + (n === cores) + '">' + n + '</button>').join('');
  }
  $('cores').addEventListener('click', e => {
    const b = e.target.closest('[data-n]'); if (!b || run.state === 'running') return;
    cores = Number(b.dataset.n); store.set('knot-cores', cores); renderCores();
  });
  renderCores();

  // ---------- Run ----------
  let run = {};
  function resetRun() {
    if (run.workers) run.workers.forEach(w => w.terminate());
    run = { state: 'idle', done: 0, chunks: new Array(nChunks).fill(null), workers: [], rate: 0, lastT: 0, lastDone: 0, activeMs: 0, resumedAt: 0 };
    $('runBtn').disabled = false; $('runBtn').textContent = 'Start';
    $('submitBtn').hidden = true; $('fallback').hidden = true;
    $('foundList').innerHTML = ''; $('noneFound').hidden = false;
    paint();
  }

  function start() {
    resetRun();
    run.state = 'running'; run.resumedAt = performance.now(); run.lastT = run.resumedAt;
    const n = Math.min(cores, nChunks);
    for (let w = 0; w < n; w++) {
      const worker = new Worker('assets/js/worker.js');
      const chunks = []; for (let c = w; c < nChunks; c += n) chunks.push(c);
      worker.onmessage = e => onWorker(e.data);
      worker.onerror = e => fail('A search worker stopped: ' + (e.message || 'unknown error'));
      worker.postMessage({ type: 'start', blockStart: block * L.BLOCK_SIZE, chunkSize: L.CHUNK_SIZE, chunks, known });
      run.workers.push(worker);
    }
    $('runBtn').textContent = 'Pause';
    tick();
  }
  function pause() {
    run.state = 'paused'; run.activeMs += performance.now() - run.resumedAt;
    run.workers.forEach(w => w.postMessage({ type: 'pause' }));
    $('runBtn').textContent = 'Resume'; paint();
  }
  function resume() {
    run.state = 'running'; run.resumedAt = performance.now(); run.lastT = run.resumedAt; run.lastDone = run.done;
    run.workers.forEach(w => w.postMessage({ type: 'resume' }));
    $('runBtn').textContent = 'Pause'; tick();
  }
  function fail(msg) { resetRun(); $('progLabel').textContent = msg + ' Try again, or use fewer cores.'; }

  function onWorker(m) {
    if (m.type === 'progress') run.done += m.n;
    else if (m.type === 'chunk') {
      run.chunks[m.chunk] = m;
      for (const f of m.newOnes) addFound(f);
      if (run.chunks.every(Boolean)) finish();
    } else if (m.type === 'error') fail(m.message);
  }

  const found = new Map(); // key -> first index in the block
  function addFound(f) {
    const have = found.get(f.key);
    if (have && have.index <= f.index) return;
    found.set(f.key, f);
    const items = [...found.values()].sort((a, b) => a.index - b.index);
    $('noneFound').hidden = items.length > 0;
    $('foundList').innerHTML = items.map(x => '<li><span><span class="mono muted">index ' + S.fmt(x.index) + '</span> · ' +
      (x.unknot ? 'looks like the unknot' : 'new fingerprint · at least ' + x.span + ' crossings (braid of ' + x.length + ')') +
      '</span><span class="chip warn">Waiting for verification</span></li>').join('');
  }

  function tick() {
    if (run.state !== 'running') return;
    paint();
    setTimeout(tick, 250);
  }

  function fmtTime(sec) {
    if (!isFinite(sec)) return '–';
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }

  function paint() {
    const now = performance.now();
    if (run.state === 'running' && now - run.lastT > 800) {
      const inst = (run.done - run.lastDone) / ((now - run.lastT) / 1000);
      run.rate = run.rate ? run.rate * 0.6 + inst * 0.4 : inst;
      run.lastT = now; run.lastDone = run.done;
    }
    const total = L.BLOCK_SIZE, done = Math.min(run.done, total);
    const pct = done / total * 100;
    $('barFill').style.width = pct.toFixed(1) + '%';
    $('bar').setAttribute('aria-valuenow', Math.round(pct));
    $('pct').textContent = pct.toFixed(pct < 10 ? 1 : 0) + '%';
    $('dChecked').textContent = S.fmt(done) + ' / ' + S.fmt(total);
    $('dNew').textContent = found.size;
    const elapsed = (run.activeMs + (run.state === 'running' ? now - run.resumedAt : 0)) / 1000;
    const rate = run.rate || (elapsed > 0.5 ? done / elapsed : 0);
    $('dSpeed').textContent = run.state === 'running' && rate ? S.fmt(Math.round(rate)) + '/s' : '–';
    const states = { idle: ['Ready', ''], running: ['Searching', 'ok'], paused: ['Paused', 'warn'], finished: ['Finished', 'ok'] };
    const [txt, cls] = states[run.state];
    $('status').textContent = txt; $('status').className = 'chip ' + cls;
    if (run.state === 'finished') { $('dEta').textContent = 'Done'; return; }
    if (run.state === 'running' && rate > 0 && done > 0) {
      const sec = (total - done) / rate;
      $('dEta').textContent = fmtTime(sec);
      $('progLabel').textContent = 'Searching on ' + run.workers.length + (run.workers.length === 1 ? ' core' : ' cores') + ' · finishes around ' + new Date(Date.now() + sec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    } else if (run.state === 'running') { $('dEta').textContent = '–'; $('progLabel').textContent = 'Starting up…'; }
    else if (run.state === 'paused') { $('dEta').textContent = '–'; $('progLabel').textContent = 'Paused. Your progress is kept while this tab stays open.'; }
  }

  // ---------- Finish and submit ----------
  async function sha16(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  }
  async function finish() {
    run.activeMs += performance.now() - run.resumedAt;
    run.state = 'finished';
    run.workers.forEach(w => w.terminate()); run.workers = [];
    run.done = L.BLOCK_SIZE;
    const chunkHashes = [];
    for (const c of run.chunks) chunkHashes.push(await sha16(c.keys.join('\n')));
    const seen = {}, shorter = {};
    for (const c of run.chunks) {
      for (const [id, n] of Object.entries(c.seen)) seen[id] = (seen[id] || 0) + n;
      for (const [id, i] of Object.entries(c.shorter)) if (!(id in shorter) || i < shorter[id]) shorter[id] = i;
    }
    const sub = {
      version: 1, engine: E.ENGINE_VERSION, block, chunkHashes,
      new: [...found.values()].filter(f => !knownKeys.has(f.key)).sort((a, b) => a.index - b.index).map(f => ({ index: f.index, key: f.key })),
      seen, shorter: Object.entries(shorter).map(([id, index]) => ({ id: Number(id), index })),
      seconds: Math.round(run.activeMs / 1000), cores,
    };
    store.set('knot-last-result', sub);
    paint();
    $('progLabel').textContent = 'Block finished in ' + fmtTime(sub.seconds) + '. Submit the results so they can be checked and added.';
    $('runBtn').textContent = 'Search another block';
    offerSubmit(sub);
  }

  function offerSubmit(sub) {
    const json = JSON.stringify(sub);
    const title = 'Block submission: #' + sub.block;
    const url = S.issueUrl('block-submission.yml', title, { block: String(sub.block), results: json });
    if (!url) {
      $('fallback').hidden = false; $('jsonOut').value = json; $('openForm').hidden = true;
      $('fallback').querySelector('p').textContent = 'This copy of the site doesn’t know its GitHub repository yet (see the README), so here are the raw results.';
      return;
    }
    if (url.length < 7500) { $('submitBtn').href = url; $('submitBtn').hidden = false; $('submitBtn').classList.add('primary'); }
    else {
      $('fallback').hidden = false; $('jsonOut').value = json;
      $('openForm').href = S.issueUrl('block-submission.yml', title, { block: String(sub.block) });
    }
  }
  $('copyJson').onclick = () => navigator.clipboard.writeText($('jsonOut').value).then(() => { $('copyJson').textContent = 'Copied'; }, () => { $('jsonOut').select(); });

  $('runBtn').onclick = () => {
    if (run.state === 'running') pause();
    else if (run.state === 'paused') resume();
    else if (run.state === 'finished') { verified.add(block); claimed.add(block); found.clear(); setBlock(pickBlock()); }
    else { found.clear(); start(); }
  };
  $('blockGo').onclick = () => { const b = parseInt($('blockPick').value, 10); if (Number.isInteger(b) && b >= 0 && run.state !== 'running') { found.clear(); setBlock(b); } };
  document.addEventListener('visibilitychange', () => {
    if (!$('visibleOnly').checked) return;
    if (document.hidden && run.state === 'running') { pause(); run.autoPaused = true; }
    else if (!document.hidden && run.state === 'paused' && run.autoPaused) { run.autoPaused = false; resume(); }
  });

  // ---------- Your contributions ----------
  function mine() {
    const name = $('me').value.trim().replace(/^@/, '').toLowerCase();
    store.set('knot-me', name);
    if (!name) { $('myBlocks').textContent = '–'; $('myKnots').textContent = '–'; return; }
    $('myBlocks').textContent = blocks.blocks.filter(b => (b.by || '').toLowerCase() === name).length;
    $('myKnots').textContent = archive.knots.filter(k => (k.discoveredBy || '').toLowerCase() === name).length;
  }
  $('me').value = store.get('knot-me') || '';
  $('me').addEventListener('input', mine);
  mine();

  // A finished block from an earlier visit that may not have been submitted yet
  const last = store.get('knot-last-result');
  if (last && last.engine === E.ENGINE_VERSION && !verified.has(last.block) && !claimed.has(last.block)) {
    setBlock(last.block);
    run.state = 'finished'; run.done = L.BLOCK_SIZE; paint();
    $('progLabel').textContent = 'You finished block #' + last.block + ' earlier. Submit it, or search another block.';
    $('runBtn').textContent = 'Search another block';
    offerSubmit(last);
  } else setBlock(pickBlock());
})();
