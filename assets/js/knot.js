// Knot page (knot.html?id=N): drawing with mirror toggle, invariants, discovery record,
// community description with edit link, and neighbours.
(async function () {
  'use strict';
  const S = window.Site, L = window.KnotLib, E = window.KnotEngine, $ = S.$, esc = S.esc;
  S.chrome('archive');
  const main = $('main');

  let archive, blocks;
  try { [archive, blocks] = await Promise.all([S.loadArchive(), S.loadBlocks()]); }
  catch (e) { main.innerHTML = '<p class="empty">The archive couldn’t be loaded. If you opened this file directly, serve the folder instead (see the README).</p>'; return; }

  const id = Number(new URLSearchParams(location.search).get('id'));
  const k = archive.knots.find(x => x.id === id);
  if (!k) {
    main.innerHTML = '<div class="empty"><h1 style="font-size:28px">No knot #' + esc(id || '') + ' yet</h1><p>The archive has ' + S.fmt(archive.knots.length) + ' knots so far. <a href="index.html">Browse them</a>, or <a href="contribute.html">help find more</a>.</p></div>';
    return;
  }

  const d = L.displayName(k);
  document.title = d.main + (d.sub && !d.sub.startsWith('possibly') ? ' (' + d.sub + ')' : '') + ' · Knot Archive';
  const sorted = archive.knots.slice().sort((a, b) => a.crossings.lower - b.crossings.lower || a.crossings.upper - b.crossings.upper || a.id - b.id);
  const pos = sorted.indexOf(k), prev = sorted[pos - 1], next = sorted[pos + 1];
  const block = blocks.blocks.find(b => b.block === k.block);
  const exact = k.crossings.lower === k.crossings.upper;
  const pdText = k.pd && k.pd.length ? k.pd.map(x => 'X[' + x.join(',') + ']').join(' ') : 'none (no crossings)';
  const sameC = sorted.filter(o => o !== k && o.crossings.lower === k.crossings.lower).slice(0, 6);

  const chips = [];
  if (exact) chips.push('<span class="chip ok">Crossing number exact</span>');
  else chips.push('<span class="chip">Crossing number not yet exact</span>');
  if (!k.unknot) chips.push('<span class="chip">' + (k.chiral ? 'Chiral' : 'Possibly amphichiral') + '</span>');
  if (k.name && !k.name.confirmed) chips.push('<span class="chip">Alexander polynomial matches ' + esc(k.name.name) + '</span>');

  const crossingWhy = k.unknot ? 'it can be drawn with no crossings'
    : k.name && k.name.confirmed && exact && k.diagramCrossings > k.crossings.lower ? 'identified as ' + k.name.name
    : exact ? 'Jones span ' + (k.jones.coeffs.length - 1) + ' = simplest diagram ' + k.diagramCrossings
    : 'Jones span gives at least ' + k.crossings.lower + '; the simplest diagram found has ' + k.crossings.upper;

  main.innerHTML =
    '<div class="crumbs"><nav aria-label="Breadcrumb"><a href="index.html">Archive</a><span aria-hidden="true">›</span><a href="index.html?c=' + (k.crossings.lower <= 5 ? 'le5' : k.crossings.lower >= 9 ? '9' : k.crossings.lower) + '">' + L.crossingText({ crossings: { lower: k.crossings.lower, upper: k.crossings.lower } }) + '</a><span aria-hidden="true">›</span><span style="color:var(--ink);font-weight:600">' + esc(d.main) + '</span></nav>' +
    '<div style="display:flex;gap:16px">' + (prev ? '<a href="knot.html?id=' + prev.id + '">‹ ' + esc(L.displayName(prev).main) + '</a>' : '') + (next ? '<a href="knot.html?id=' + next.id + '">' + esc(L.displayName(next).main) + ' ›</a>' : '') + '</div></div>' +

    '<section class="knot-top">' +
      '<div class="panel knot-art">' +
        S.artPlaceholder(k.id, 'Simplest diagram of ' + d.main + ', ' + L.crossingText({ crossings: { lower: k.diagramCrossings, upper: k.diagramCrossings } }), 'art') +
        (k.unknot ? '' : '<div class="segmented" role="group" aria-label="Which version to show"><button type="button" id="vOrig" aria-pressed="true">This diagram</button><button type="button" id="vMirror" aria-pressed="false">Mirror image</button></div>') +
        '<p class="muted" style="margin:0;font-size:14px" id="artNote"></p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn" id="copyPd">Copy PD code</button><a class="btn" href="data/drawings/' + k.id + '.json">Drawing data</a></div>' +
      '</div>' +
      '<div class="knot-facts">' +
        '<div><div class="eyebrow">Knot #' + k.id + (k.name && k.name.confirmed ? ' · Rolfsen ' + esc(k.name.name) : '') + '</div>' +
        '<h1 class="knot-title">' + esc(d.main) + '</h1>' +
        (d.sub && !d.sub.startsWith('possibly') ? '<p class="knot-sub">' + esc(d.sub) + '</p>' : '') +
        '<div class="pills" style="margin-top:12px">' + chips.join('') + '</div></div>' +

        '<div class="panel"><div class="panel-head"><h2>Invariants</h2></div><dl class="facts">' +
          '<dt>Crossing number</dt><dd>' + (exact ? k.crossings.lower : k.crossings.lower + '–' + k.crossings.upper) + ' <span class="muted">(' + esc(crossingWhy) + ')</span></dd>' +
          '<dt>Jones polynomial</dt><dd class="mono" id="jones">' + esc(L.jonesText(k)) + '</dd>' +
          '<dt>Alexander polynomial</dt><dd class="mono">' + esc(L.alexText(k)) + '</dd>' +
          '<dt>Determinant</dt><dd>' + L.determinant(k) + '</dd>' +
          '<dt>Simplest braid</dt><dd><span class="mono">' + esc(E.braidString(k.braid)) + '</span> <span class="muted">(' + k.strands + ' strands)</span></dd>' +
          '<dt>PD code</dt><dd class="mono" id="pd">' + esc(pdText) + '</dd>' +
        '</dl></div>' +

        '<div class="record">' +
          '<div><span class="eyebrow">First found at</span><b>index ' + S.fmt(k.discoveredAtIndex) + '</b></div>' +
          '<div><span class="eyebrow">Times found</span><b>' + S.fmt(k.hits || 1) + '</b></div>' +
          '<div><span class="eyebrow">Discovered by</span><b>' + S.profileLink(k.discoveredBy) + '</b></div>' +
          '<div><span class="eyebrow">Verified in</span><b>' + (block && block.issue && S.gh ? '<a href="' + S.gh + '/issues/' + block.issue + '">block #' + k.block + '</a>' : 'block #' + k.block) + '</b></div>' +
        '</div>' +
      '</div>' +
    '</section>' +

    '<section class="two-col">' +
      '<article class="main panel panel-pad">' +
        '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:10px"><h2 style="font-size:22px">About this knot</h2><span class="muted" style="font-size:14px">Written by the community</span></div>' +
        '<div class="prose" id="desc" style="margin-top:10px"><p class="muted">Loading…</p></div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px" id="descActions"></div>' +
        '<p class="muted" style="margin:12px 0 0;font-size:14px">Edits are sent as pull requests on GitHub and go live once a maintainer merges them.</p>' +
      '</article>' +
      '<aside>' +
        (sameC.length ? '<div class="panel panel-pad"><h2 style="margin-bottom:6px;font-size:18px">Same crossing number</h2>' + sameC.map(o => '<a class="mini" href="knot.html?id=' + o.id + '">' + S.artPlaceholder(o.id, '', 'mini-art') + '<span><b>' + esc(L.displayName(o).main) + '</b><span class="muted" style="font-size:14px">' + esc(L.displayName(o).sub || ('#' + o.id)) + '</span></span></a>').join('') + '</div>' : '') +
      '</aside>' +
    '</section>';

  S.hydrateArt(main);

  // Mirror toggle: reflecting the drawing gives the mirror knot; its Jones polynomial is V(1/t).
  const setNote = m => { $('artNote').textContent = k.unknot ? 'The unknot: a loop with no crossings at all.'
    : m ? (k.chiral ? 'Reflecting the drawing gives the mirror knot. This knot is chiral, so the mirror image is a different knot; the archive lists both under one entry.' : 'Reflecting the drawing gives the mirror knot. The Jones polynomial reads the same both ways, so this knot may be its own mirror image.')
    : 'The simplest diagram found: ' + L.crossingText({ crossings: { lower: k.diagramCrossings, upper: k.diagramCrossings } }) + (k.diagramCrossings < k.braid.length ? ', untangled from a ' + k.braid.length + '-crossing braid.' : '.'); };
  setNote(false);
  if (!k.unknot) {
    const flip = m => {
      main.querySelector('.knot-art svg.art').classList.toggle('mirrored', m);
      $('vOrig').setAttribute('aria-pressed', String(!m)); $('vMirror').setAttribute('aria-pressed', String(m));
      $('jones').textContent = L.jonesText(k, m); setNote(m);
    };
    $('vOrig').onclick = () => flip(false); $('vMirror').onclick = () => flip(true);
  }
  $('copyPd').onclick = () => navigator.clipboard.writeText(pdText).then(() => { $('copyPd').textContent = 'Copied'; setTimeout(() => { $('copyPd').textContent = 'Copy PD code'; }, 1500); }, () => {
    const r = document.createRange(); r.selectNodeContents($('pd')); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });

  // Description
  let exists = false;
  try {
    const r = await fetch('data/descriptions/' + k.id + '.md', { cache: 'no-cache' });
    if (r.ok) { $('desc').innerHTML = S.md(await r.text()); exists = true; }
  } catch (e) {}
  if (!exists) $('desc').innerHTML = '<p class="muted">Nobody has written about this knot yet. If you know something about it, you can write the first description.</p>';
  const edit = S.descriptionUrl(k.id, exists);
  const flag = S.issueUrl('duplicate-flag.yml', 'Possible duplicate: #' + k.id, { knot: '#' + k.id });
  $('descActions').innerHTML =
    (edit ? '<a class="btn primary" href="' + edit + '">' + (exists ? 'Suggest an edit' : 'Write the first description') + '</a>' : '') +
    (flag ? '<a class="btn" href="' + flag + '">Flag as a possible duplicate</a>' : '') +
    (!edit ? '<span class="muted">Editing links appear once the site knows its GitHub repository (see the README).</span>' : '');
})();
