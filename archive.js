// Archive page: stats, search, crossing filter, sorting and 50-per-page pagination.
// State lives in the address (?q=…&c=…&sort=…&page=…) so any view can be linked.
(async function () {
  'use strict';
  const S = window.Site, L = window.KnotLib, E = window.KnotEngine, $ = S.$;
  S.chrome('archive');
  const PAGE = 50;

  const FILTERS = [['all', 'All', () => true], ['le5', '≤ 5', k => k.crossings.lower <= 5], ['6', '6', k => k.crossings.lower === 6],
    ['7', '7', k => k.crossings.lower === 7], ['8', '8', k => k.crossings.lower === 8], ['9', '9+', k => k.crossings.lower >= 9]];
  const params = new URLSearchParams(location.search);
  const state = { q: params.get('q') || '', c: params.get('c') || 'all', sort: params.get('sort') || 'crossings', page: Math.max(1, parseInt(params.get('page') || '1', 10)) };
  if (!FILTERS.some(f => f[0] === state.c)) state.c = 'all';

  let archive, blocks;
  try { [archive, blocks] = await Promise.all([S.loadArchive(), S.loadBlocks()]); }
  catch (e) {
    $('countLine').textContent = 'The archive couldn’t be loaded. If you opened this file directly, serve the folder instead (see the README).';
    return;
  }
  const knots = archive.knots;

  // ---------- Stats ----------
  const { contiguous, verified } = S.searchedUpTo(blocks);
  const PRIMES_TO_7 = 14; // 3₁, 4₁, 5₁–5₂, 6₁–6₃, 7₁–7₇
  const primes = knots.filter(k => k.name && k.name.confirmed && !k.name.name.includes('#') && k.crossings.lower >= 3 && k.crossings.lower <= 7).length;
  let next = 0; while (verified.has(next)) next++;
  $('stKnots').textContent = S.fmt(knots.length);
  $('stSearched').textContent = S.fmt(verified.size * L.BLOCK_SIZE);
  $('stPrimes').textContent = primes + ' of ' + PRIMES_TO_7;
  $('stNext').textContent = '#' + next;
  $('stSearched').title = 'Indexes 0–' + S.fmt(contiguous - 1) + ' have no gaps';

  // ---------- Search text for each knot ----------
  const hay = new Map(knots.map(k => {
    const d = L.displayName(k);
    const parts = ['#' + k.id, String(k.id), d.main, d.sub, k.nickname || '', k.name ? k.name.name : '', L.jonesText(k), L.jonesText(k, true), L.alexText(k),
      (k.pd || []).map(x => 'X[' + x.join(',') + ']').join(' '), E.braidString(k.braid)];
    return [k.id, parts.join(' ').toLowerCase().replace(/\s+/g, ' ')];
  }));
  const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();

  // ---------- Render ----------
  function filtered() {
    const f = FILTERS.find(x => x[0] === state.c)[2];
    const q = norm(state.q).replace(/^#/, '#');
    let list = knots.filter(f);
    if (q) list = list.filter(k => q.split(' ').every(w => hay.get(k.id).includes(w)));
    const by = {
      crossings: (a, b) => a.crossings.lower - b.crossings.lower || a.crossings.upper - b.crossings.upper || a.id - b.id,
      newest: (a, b) => b.id - a.id,
      hits: (a, b) => (b.hits || 0) - (a.hits || 0) || a.id - b.id,
    }[state.sort] || ((a, b) => a.id - b.id);
    return list.sort(by);
  }

  function card(k) {
    const d = L.displayName(k);
    const chips = [];
    if (d.sub) chips.push('<span class="chip' + (d.sub.startsWith('possibly') ? '' : ' ok') + '">' + S.esc(d.sub) + '</span>');
    if (k.crossings.lower !== k.crossings.upper) chips.push('<span class="chip">not yet exact</span>');
    return '<a class="card" href="knot.html?id=' + k.id + '">' +
      S.artPlaceholder(k.id, 'Diagram of ' + d.main, 'art') +
      '<span class="name"><b>' + S.esc(d.main) + '</b><span class="id">#' + k.id + '</span></span>' +
      '<span class="meta">' + L.crossingText(k) + '</span>' +
      (chips.length ? '<span class="chips">' + chips.join('') + '</span>' : '') + '</a>';
  }

  function render(push) {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    state.page = Math.min(state.page, pages);
    const from = (state.page - 1) * PAGE;
    const shown = list.slice(from, from + PAGE);

    $('filters').innerHTML = FILTERS.map(([key, text]) => '<button type="button" class="pill" data-c="' + key + '" aria-pressed="' + (key === state.c) + '">' + text + '</button>').join('');
    $('countLine').textContent = list.length
      ? 'Showing knots ' + S.fmt(from + 1) + '–' + S.fmt(from + shown.length) + ' of ' + S.fmt(list.length) + (list.length !== knots.length ? ' matching' : '')
      : 'No knots match. Try a different search or filter.';
    $('pageLine').textContent = 'Page ' + state.page + ' of ' + pages + ' · 50 per page';
    $('grid').innerHTML = shown.length ? shown.map(card).join('') : '<div class="empty" style="grid-column:1/-1">Nothing here yet.</div>';
    S.hydrateArt($('grid'));

    const link = p => { const u = new URLSearchParams(); if (state.q) u.set('q', state.q); if (state.c !== 'all') u.set('c', state.c); if (state.sort !== 'crossings') u.set('sort', state.sort); if (p > 1) u.set('page', p); const s = u.toString(); return 'index.html' + (s ? '?' + s : ''); };
    let pager = '';
    if (pages > 1) {
      if (state.page > 1) pager += '<a href="' + link(state.page - 1) + '" data-page="' + (state.page - 1) + '">Previous</a>';
      for (let p = 1; p <= pages; p++) {
        if (pages > 9 && p !== 1 && p !== pages && Math.abs(p - state.page) > 2) { if (!pager.endsWith('…</span>')) pager += '<span aria-hidden="true">…</span>'; continue; }
        pager += p === state.page ? '<span aria-current="page">' + p + '</span>' : '<a href="' + link(p) + '" data-page="' + p + '">' + p + '</a>';
      }
      if (state.page < pages) pager += '<a href="' + link(state.page + 1) + '" data-page="' + (state.page + 1) + '">Next</a>';
    }
    $('pager').innerHTML = pager;
    history[push ? 'pushState' : 'replaceState'](null, '', link(state.page));
  }

  $('q').value = state.q;
  $('sort').value = state.sort;
  let t = null;
  $('q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = $('q').value; state.page = 1; render(false); }, 150); });
  $('sort').addEventListener('change', () => { state.sort = $('sort').value; state.page = 1; render(false); });
  $('filters').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) { state.c = b.dataset.c; state.page = 1; render(false); } });
  $('pager').addEventListener('click', e => {
    const a = e.target.closest('[data-page]'); if (!a) return;
    e.preventDefault(); state.page = Number(a.dataset.page); render(true);
    $('grid').scrollIntoView({ block: 'start' });
  });
  window.addEventListener('popstate', () => { const p = new URLSearchParams(location.search); state.page = Math.max(1, parseInt(p.get('page') || '1', 10)); render(false); });
  render(false);
})();
