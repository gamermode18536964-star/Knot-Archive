// Contribute page: take the next open blocks from the global block count, search them with
// web workers, show progress and ETA, then hand the results to GitHub as one pre-filled issue.
//
// Blocks are handed out in order starting at blocks.json "next", skipping blocks that are
// verified, waiting in an open submission issue, or already submitted from this browser.
(async function () {
  'use strict';
  const S = window.Site, L = window.KnotLib, E = window.KnotEngine, $ = S.$;
  S.chrome('contribute');
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

  let archive, blocks;
  try { [archive, blocks] = await Promise.all([S.loadArchive(), S.loadBlocks()]); }
  catch (e) { $('blockTitle').textContent = 'The archive couldn’t be loaded'; $('progLabel').textContent = 'If you opened this file directly, serve the folder instead (see the README).'; return; }

  const BS = L.BLOCK_SIZE, CS = L.CHUNK_SIZE, nChunks = BS / CS;
  const verified = new Set(blocks.blocks.filter(b => b.status === 'verified').map(b => b.block));
  const globalCount = Number.isInteger(blocks.count) ? blocks.count : verified.size;
  let firstOpen = Number.isInteger(blocks.next) ? blocks.next : 0;
  while (verified.has(firstOpen)) firstOpen++;
  const known = archive.knots.map(k => [k.key, [k.id, k.braid.length]]);
  const knownKeys = new Set(archive.knots.map(k => k.key));

  // ---------- Which blocks are taken ----------
  // Blocks numbers in an issue title like "Block submission: #15–#17, #20"
  function blocksInTitle(title) {
    const out = new Set(), part = (title.split(':')[1] || '');
    for (const m of part.matchAll(/#?(\d+)\s*[–-]\s*#?(\d+)/g)) for (let b = +m[1]; b <= +m[2] && b - m[1] < 100; b++) out.add(b);
    for (const m of part.replace(/#?\d+\s*[–-]\s*#?\d+/g, '').matchAll(/#?(\d+)/g)) out.add(+m[1]);
    return out;
  }
  let pending = new Set();
  async function refreshPending() {
    if (!S.repo) return;
    try {
      const ctl = new AbortController(); setTimeout(() => ctl.abort(), 4000);
      const r = await fetch('https://api.github.com/repos/' + S.repo + '/issues?labels=block-submission&state=open&per_page=100', { signal: ctl.signal });
      if (r.ok) { const next = new Set(); for (const is of await r.json()) for (const b of blocksInTitle(is.title || '')) next.add(b); pending = next; }
    } catch (e) { /* offline or rate-limited: rely on what we know */ }
  }
  // Blocks this browser submitted recently, in case the site hasn't caught up yet (kept for 3 days).
  const mineKey = 'knot-submitted-blocks';
  const recentMine = () => { const now = Date.now(); return (store.get(mineKey) || []).filter(x => now - x.at < 3 * 864e5); };
  const rememberSubmitted = list => store.set(mineKey, recentMine().concat(list.map(block => ({ block, at: Date.now() }))));
  const taken = b => verified.has(b) || pending.has(b) || recentMine().some(x => x.block === b);

  function assign(n) {
    const out = [];
    for (let b = firstOpen; out.length < n && b < firstOpen + 100000; b++) if (!taken(b)) out.push(b);
    return out;
  }
  const blockLabel = list => {
    if (!list.length) return '';
    const contiguous = list.every((b, i) => i === 0 || b === list[i - 1] + 1);
    return list.length === 1 ? '#' + list[0] : contiguous ? '#' + list[0] + '–#' + list[list.length - 1] : list.map(b => '#' + b).join(', ');
  };

  // ---------- Choices: how many blocks, how many cores ----------
  const countOpts = [1, 3, 5, 10];
  let howMany = store.get('knot-block-count') || 1;
  if (!countOpts.includes(howMany)) howMany = 1;
  const maxCores = Math.max(1, Math.min(16, navigator.hardwareConcurrency || 2));
  const coreOpts = [1, 2, 4, 8, 16].filter(n => n <= maxCores);
  let cores = store.get('knot-cores') || Math.min(4, Math.max(1, Math.floor(maxCores / 2)));
  if (!coreOpts.includes(cores)) cores = coreOpts[coreOpts.length - 1];
  const seg = (el, opts, cur) => { el.innerHTML = opts.map(n => '<button type="button" data-n="' + n + '" aria-pressed="' + (n === cur) + '">' + n + '</button>').join(''); };
  function renderChoices() { seg($('blockCount'), countOpts, howMany); seg($('cores'), coreOpts, cores); }
  $('blockCount').addEventListener('click', e => {
    const b = e.target.closest('[data-n]'); if (!b || run.state === 'running' || run.state === 'paused') return;
    howMany = Number(b.dataset.n); store.set('knot-block-count', howMany); renderChoices(); setBlocks(assign(howMany));
  });
  $('cores').addEventListener('click', e => {
    const b = e.target.closest('[data-n]'); if (!b || run.state === 'running' || run.state === 'paused') return;
    cores = Number(b.dataset.n); store.set('knot-cores', cores); renderChoices();
  });

  // ---------- Assigned blocks ----------
  let list = [];
  function setBlocks(l) {
    list = l;
    const start = list[0] * BS, end = list[list.length - 1] * BS + BS - 1;
    $('blockEyebrow').textContent = (list.length === 1 ? 'Your block · ' : 'Your blocks · ') + blockLabel(list);
    $('blockTitle').textContent = list.length === 1 ? 'Indexes ' + S.fmt(start) + ' – ' + S.fmt(end) : list.length + ' blocks · ' + S.fmt(list.length * BS) + ' indexes';
    $('globalLine').textContent = 'Global block count: ' + S.fmt(globalCount) + ' verified · next open block #' + firstOpen +
      (pending.size ? ' · ' + pending.size + ' waiting for a check' : '');
    resetRun();
    $('progLabel').textContent = 'Press Start to search ' + (list.length === 1 ? 'this block.' : 'these ' + list.length + ' blocks.');
  }

  // ---------- Run ----------
  let run = {};
  const found = new Map(); // "block:key" -> first index of that fingerprint within its block
  function resetRun() {
    if (run.workers) run.workers.forEach(w => w.terminate());
    run = { state: 'idle', done: 0, total: list.length * BS, chunks: new Map(), workers: [], rate: 0, lastT: 0, lastDone: 0, activeMs: 0, resumedAt: 0 };
    found.clear();
    $('runBtn').disabled = !list.length; $('runBtn').textContent = 'Start';
    $('submitBtn').hidden = true; $('fallback').hidden = true;
    $('foundList').innerHTML = ''; $('noneFound').hidden = false;
    paint();
  }

  async function start() {
    $('runBtn').disabled = true; $('progLabel').textContent = 'Checking which blocks are still open…';
    await refreshPending(); // someone may have submitted these blocks since the page loaded
    if (list.some(taken)) setBlocks(assign(howMany));
    resetRun();
    run.state = 'running'; run.resumedAt = performance.now(); run.lastT = run.resumedAt;
    const starts = [];
    for (const b of list) for (let c = 0; c < nChunks; c++) starts.push(b * BS + c * CS);
    const n = Math.min(cores, starts.length);
    for (let w = 0; w < n; w++) {
      const worker = new Worker('assets/js/worker.js');
      worker.onmessage = e => onWorker(e.data);
      worker.onerror = e => fail('A search worker stopped: ' + (e.message || 'unknown error') + '.');
      worker.postMessage({ type: 'start', starts: starts.filter((_, i) => i % n === w), chunkSize: CS, known });
      run.workers.push(worker);
    }
    $('runBtn').disabled = false; $('runBtn').textContent = 'Pause';
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
      run.chunks.set(m.start, m);
      const block = Math.floor(m.start / BS);
      for (const f of m.newOnes) addFound(block, f);
      if (run.chunks.size === list.length * nChunks) finish();
      else paintPills();
    } else if (m.type === 'error') fail(m.message);
  }

  function addFound(block, f) {
    const id = block + ':' + f.key, have = found.get(id);
    if (have && have.index <= f.index) return;
    found.set(id, { ...f, block });
    const items = [...found.values()].sort((a, b) => a.index - b.index);
    const unique = new Set(items.map(x => x.key)).size;
    $('noneFound').hidden = items.length > 0;
    $('dNew').textContent = unique;
    $('foundList').innerHTML = items.map(x => '<li><span><span class="mono muted">#' + x.block + ' · index ' + S.fmt(x.index) + '</span> · ' +
      (x.unknot ? 'looks like the unknot' : 'new fingerprint · at least ' + x.span + ' crossings (braid of ' + x.length + ')') +
      '</span><span class="chip warn">Waiting for verification</span></li>').join('');
  }

  function paintPills() {
    $('blockPills').innerHTML = list.length < 2 ? '' : list.map(b => {
      let done = 0; for (let c = 0; c < nChunks; c++) if (run.chunks && run.chunks.has(b * BS + c * CS)) done++;
      if (run.state === 'finished') done = nChunks;
      const cls = done === nChunks ? 'ok' : done ? 'info' : '';
      return '<span class="chip ' + cls + '" title="' + done * 10 + '% done">#' + b + (done === nChunks ? ' ✓' : done ? ' · ' + done * 10 + '%' : '') + '</span>';
    }).join('');
  }

  function tick() { if (run.state !== 'running') return; paint(); setTimeout(tick, 250); }
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
      // ignore the first moments, when workers are still skipping ahead to their chunks
      if (run.done > 0) run.rate = run.rate ? run.rate * 0.6 + inst * 0.4 : inst;
      run.lastT = now; run.lastDone = run.done;
    }
    const total = run.total || BS, done = Math.min(run.done, total);
    const pct = done / total * 100;
    $('barFill').style.width = pct.toFixed(1) + '%';
    $('bar').setAttribute('aria-valuenow', Math.round(pct));
    $('pct').textContent = pct.toFixed(pct < 10 ? 1 : 0) + '%';
    $('dChecked').textContent = S.fmt(done) + ' / ' + S.fmt(total);
    if (!found.size) $('dNew').textContent = '0';
    const elapsed = (run.activeMs + (run.state === 'running' ? now - run.resumedAt : 0)) / 1000;
    const rate = run.rate || (elapsed > 0.5 ? done / elapsed : 0);
    $('dSpeed').textContent = run.state === 'running' && rate ? S.fmt(Math.round(rate)) + '/s' : '–';
    const states = { idle: ['Ready', ''], running: ['Searching', 'ok'], paused: ['Paused', 'warn'], finished: ['Finished', 'ok'] };
    const [txt, cls] = states[run.state];
    $('status').textContent = txt; $('status').className = 'chip ' + cls;
    paintPills();
    if (run.state === 'finished') { $('dEta').textContent = 'Done'; return; }
    if (run.state === 'running' && rate > 0 && done > 0) {
      const sec = (total - done) / rate;
      $('dEta').textContent = fmtTime(sec);
      $('progLabel').textContent = 'Searching on ' + run.workers.length + (run.workers.length === 1 ? ' core' : ' cores') + ' · finishes around ' + new Date(Date.now() + sec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    } else if (run.state === 'running') { $('dEta').textContent = '–'; $('progLabel').textContent = 'Starting up…'; }
    else if (run.state === 'paused') { $('dEta').textContent = '–'; $('progLabel').textContent = 'Paused. Your progress is kept while this tab stays open.'; }
    else $('dEta').textContent = '–';
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
    run.done = run.total;
    // Compact format (v3), so even 10 blocks fit in one GitHub link:
    //   b block · h the 10 chunk fingerprints joined · n indexes of new fingerprints · s [knot id, index of a shorter braid]
    const out = [];
    for (const b of list) {
      let h = ''; const shorter = {};
      for (let c = 0; c < nChunks; c++) {
        const ch = run.chunks.get(b * BS + c * CS);
        h += await sha16(ch.keys.join('\n'));
        for (const [id, i] of Object.entries(ch.shorter)) if (!(id in shorter) || i < shorter[id]) shorter[id] = i;
      }
      const n = [...found.values()].filter(f => f.block === b && !knownKeys.has(f.key)).map(f => f.index).sort((x, y) => x - y);
      out.push({ b, h, n, s: Object.entries(shorter).map(([id, index]) => [Number(id), index]) });
    }
    const sub = { v: 3, engine: E.ENGINE_VERSION, blocks: out, secs: Math.round(run.activeMs / 1000), cores };
    store.set('knot-last-result', sub);
    paint();
    $('progLabel').textContent = (list.length === 1 ? 'Block finished' : list.length + ' blocks finished') + ' in ' + fmtTime(sub.secs) + '. Submit the results so they can be checked and added.';
    $('runBtn').textContent = 'Run more blocks';
    offerSubmit(sub);
  }

  function offerSubmit(sub) {
    const nums = sub.blocks.map(b => b.b);
    const json = JSON.stringify(sub);
    const title = 'Block submission: ' + blockLabel(nums);
    const url = S.issueUrl('block-submission.yml', title, { block: nums.join(', '), results: json });
    const onSubmit = () => { rememberSubmitted(nums); store.set('knot-last-result', null); };
    $('submitBtn').onclick = onSubmit; $('openForm').onclick = onSubmit;
    if (!url) {
      $('fallback').hidden = false; $('jsonOut').value = json; $('openForm').hidden = true;
      $('fallback').querySelector('p').textContent = 'This copy of the site doesn’t know its GitHub repository yet (see the README), so here are the raw results.';
      return;
    }
    if (url.length < 7500) { $('submitBtn').href = url; $('submitBtn').hidden = false; $('submitBtn').classList.add('primary'); }
    else {
      $('fallback').hidden = false; $('jsonOut').value = json;
      $('openForm').href = S.issueUrl('block-submission.yml', title, { block: nums.join(', ') });
    }
  }
  $('copyJson').onclick = () => navigator.clipboard.writeText($('jsonOut').value).then(() => { $('copyJson').textContent = 'Copied'; }, () => { $('jsonOut').select(); });

  $('runBtn').onclick = () => {
    if (run.state === 'running') pause();
    else if (run.state === 'paused') resume();
    else if (run.state === 'finished') { for (const b of list) pending.add(b); setBlocks(assign(howMany)); }
    else start();
  };
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

  // ---------- Start-up ----------
  renderChoices();
  await refreshPending();
  const last = store.get('knot-last-result');
  const lastBlocks = last && last.v === 3 && last.engine === E.ENGINE_VERSION && Array.isArray(last.blocks) ? last.blocks.map(b => b.b) : [];
  if (lastBlocks.length && lastBlocks.every(b => !verified.has(b) && !pending.has(b))) {
    // a finished run from an earlier visit that hasn't been submitted yet
    setBlocks(lastBlocks);
    run.state = 'finished'; run.done = run.total; paint();
    $('progLabel').textContent = 'You finished ' + blockLabel(lastBlocks) + ' earlier. Submit the results, or run more blocks.';
    $('runBtn').textContent = 'Run more blocks';
    offerSubmit(last);
  } else setBlocks(assign(howMany));
})();
