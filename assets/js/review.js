// Review queue: block submissions, description pull requests and duplicate flags,
// read from the repository's issues through GitHub's public API.
// Duplicate flags are also checked right here in the browser against the whole archive.
(async function () {
  'use strict';
  const S = window.Site, L = window.KnotLib, $ = S.$, esc = S.esc;
  S.chrome('review');

  // Tabs
  const tabs = ['subs', 'edits', 'dups'];
  function show(t) {
    for (const x of tabs) { $('tab-' + x).setAttribute('aria-selected', String(x === t)); $('pane-' + x).hidden = x !== t; }
    history.replaceState(null, '', '#' + t);
  }
  tabs.forEach(t => { $('tab-' + t).onclick = () => show(t); });
  if (tabs.includes(location.hash.slice(1))) show(location.hash.slice(1));

  let archive, blocks;
  try { [archive, blocks] = await Promise.all([S.loadArchive(), S.loadBlocks()]); }
  catch (e) { $('notice').hidden = false; $('notice').textContent = 'The archive couldn’t be loaded. If you opened this file directly, serve the folder instead (see the README).'; return; }
  const byId = new Map(archive.knots.map(k => [k.id, k]));

  if (!S.repo) {
    $('notice').hidden = false;
    $('notice').textContent = 'This copy of the site doesn’t know its GitHub repository yet, so the queue can’t be loaded. On GitHub Pages it is detected automatically; elsewhere set it in assets/js/config.js.';
    showDupsFromArchiveOnly();
    return;
  }

  const api = path => fetch('https://api.github.com/repos/' + S.repo + path, { headers: { Accept: 'application/vnd.github+json' } })
    .then(r => { if (r.status === 403) throw new Error('rate'); if (!r.ok) throw new Error(String(r.status)); return r.json(); });
  const ago = iso => { const s = (Date.now() - new Date(iso)) / 1000; return s < 3600 ? Math.max(1, Math.round(s / 60)) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
  const rateNote = e => { if (String(e.message) === 'rate') { $('notice').hidden = false; $('notice').innerHTML = 'GitHub limits how often this page can ask for updates (60 requests an hour without signing in). Try again later, or <a href="' + S.gh + '/issues">open the issues on GitHub</a>.'; } };

  // ---------- Block submissions ----------
  api('/issues?labels=block-submission&state=all&per_page=30').then(list => {
    $('n-subs').textContent = list.filter(i => i.state === 'open').length;
    if (!list.length) { $('pane-subs').innerHTML = '<p class="empty">No submissions yet. <a href="contribute.html">Run a block</a> to make the first one.</p>'; return; }
    $('pane-subs').innerHTML = list.map(i => {
      const labels = i.labels.map(l => l.name);
      const st = labels.includes('verified') ? ['Verified', 'ok'] : labels.includes('rejected') ? ['Rejected', 'warn'] : labels.includes('already-verified') ? ['Already verified', ''] : i.state === 'open' ? ['Checking', 'info'] : ['Closed', ''];
      const recs = blocks.blocks.filter(x => x.issue === i.number && x.status === 'verified');
      const newIds = recs.flatMap(r => r.newKnots || []);
      const detail = recs.length ? recs.length + (recs.length === 1 ? ' block' : ' blocks') + ' accepted (global count ' + recs.map(r => r.seq).join(', ') + ') · ' +
          (newIds.length ? newIds.length + ' new knot' + (newIds.length === 1 ? '' : 's') + ': ' + newIds.slice(0, 8).map(id => '<a href="knot.html?id=' + id + '">#' + id + '</a>').join(', ') + (newIds.length > 8 ? '…' : '') : 'no new knots')
        : st[0] === 'Checking' ? 'the automated re-run is in progress' : '';
      return '<div class="panel row-card"><div><div class="title"><b>' + esc(i.title) + '</b><span class="chip ' + st[1] + '">' + st[0] + '</span></div>' +
        '<div class="muted" style="font-size:15px">' + S.profileLink(i.user && i.user.login) + ' · ' + ago(i.created_at) + (detail ? ' · ' + detail : '') + '</div></div>' +
        '<a href="' + i.html_url + '">View on GitHub</a></div>';
    }).join('');
  }).catch(e => { $('pane-subs').innerHTML = '<p class="empty">Couldn’t load submissions right now.</p>'; rateNote(e); });

  // ---------- Description edits (open pull requests) ----------
  api('/pulls?state=open&per_page=30').then(list => {
    $('n-edits').textContent = list.length;
    if (!list.length) { $('pane-edits').innerHTML = '<p class="empty">No edits waiting. Every knot page has a link to suggest one.</p>'; return; }
    $('pane-edits').innerHTML = list.map(p => {
      const m = (p.title + ' ' + (p.head && p.head.ref || '')).match(/(\d+)\.md|#(\d+)/), id = m ? Number(m[1] || m[2]) : null, k = id && byId.get(id);
      return '<div class="panel row-card">' + (k ? '<a href="knot.html?id=' + k.id + '" style="flex:none">' + S.artPlaceholder(k.id, 'Diagram of ' + L.displayName(k).main, 'mini-art') + '</a>' : '') +
        '<div><div class="title"><b>' + esc(p.title) + '</b>' + (p.draft ? '<span class="chip">Draft</span>' : '') + '</div>' +
        '<div class="muted" style="font-size:15px">' + S.profileLink(p.user && p.user.login) + ' · opened ' + ago(p.created_at) + (k ? ' · about <a href="knot.html?id=' + k.id + '">' + esc(L.label(k)) + '</a>' : '') + '</div></div>' +
        '<a class="btn" href="' + p.html_url + '/files">Review on GitHub</a></div>';
    }).join('');
    S.hydrateArt($('pane-edits'));
  }).catch(e => { $('pane-edits').innerHTML = '<p class="empty">Couldn’t load edits right now.</p>'; rateNote(e); });

  // ---------- Duplicate flags ----------
  api('/issues?labels=duplicate-flag&state=open&per_page=30').then(list => {
    $('n-dups').textContent = list.length;
    if (!list.length) { $('pane-dups').innerHTML = '<p class="empty">No open duplicate flags.</p>'; return; }
    $('pane-dups').innerHTML = list.map(i => {
      // the form puts each answer under its own "### " heading
      const body = i.body || '';
      const section = name => { const m = body.match(new RegExp('###\\s*' + name + '[^\\n]*\\n+([\\s\\S]*?)(?=\\n###|$)', 'i')); return m ? m[1] : ''; };
      const nums = s => (s.match(/\d+/g) || []).map(Number);
      let ids = nums(section('Knot')).slice(0, 1).concat(nums(section('Possible duplicate of')).slice(0, 1));
      if (!ids.length) ids = nums(i.title).slice(0, 1);
      ids = ids.filter(id => byId.has(id));
      const k = byId.get(ids[0]);
      if (!k) return '<div class="panel row-card"><div><div class="title"><b>' + esc(i.title) + '</b></div><div class="muted">Couldn’t tell which knot this is about.</div></div><a href="' + i.html_url + '">View on GitHub</a></div>';
      const c = ids[1] ? L.compareKnots(k, byId.get(ids[1])) : L.duplicateReport(archive, k).closest;
      return flagCard(c, i);
    }).join('');
    S.hydrateArt($('pane-dups'));
  }).catch(e => { $('pane-dups').innerHTML = '<p class="empty">Couldn’t load flags right now.</p>'; rateNote(e); });

  function flagCard(c, issue) {
    const a = c.a, b = c.b, da = L.displayName(a), db = L.displayName(b);
    const chip = c.verdict === 'same' ? '<span class="chip warn">Same knot</span>' : c.verdict === 'possible' ? '<span class="chip warn">Possible duplicate</span>' : '<span class="chip ok">Not a duplicate</span>';
    const ev = (c.verdict === 'different' ? c.ev.filter(e => !e.same).concat(c.ev.filter(e => e.same)) : c.ev)
      .map(e => '<li><span class="mk ' + (e.same ? '' : 'diff') + '">' + (e.same ? '=' : '≠') + '</span><span>' + esc(e.text) + (e.detail ? '<span class="mono">' + esc(e.detail) + '</span>' : '') + '</span></li>').join('');
    return '<div class="panel row-card" style="align-items:flex-start">' +
      '<div class="pair"><a href="knot.html?id=' + a.id + '">' + S.artPlaceholder(a.id, 'Diagram of ' + da.main) + '<b>' + esc(da.main) + '</b>#' + a.id + '</a><span class="sym">' + (c.verdict === 'different' ? '≠' : '=') + '</span>' +
      '<a href="knot.html?id=' + b.id + '">' + S.artPlaceholder(b.id, 'Diagram of ' + db.main) + '<b>' + esc(db.main) + '</b>#' + b.id + '</a></div>' +
      '<div><div class="title">' + chip + '<b>' + (issue ? esc(issue.title) : esc(L.label(a))) + '</b></div>' +
      (issue ? '<div class="muted" style="font-size:15px">Flagged by ' + S.profileLink(issue.user && issue.user.login) + ' · ' + ago(issue.created_at) + '</div>' : '') +
      '<ul class="evidence">' + ev + '</ul>' +
      (issue ? '<div style="margin-top:12px"><a class="btn" href="' + issue.html_url + '">' + (c.verdict === 'different' ? 'Close the flag on GitHub' : 'Discuss on GitHub') + '</a></div>' : '') +
      '</div></div>';
  }

  function showDupsFromArchiveOnly() {
    $('pane-subs').innerHTML = '<p class="empty">Submissions appear here once the site is on GitHub.</p>';
    $('pane-edits').innerHTML = '<p class="empty">Edits appear here once the site is on GitHub.</p>';
    $('pane-dups').innerHTML = '<p class="empty">Flags appear here once the site is on GitHub.</p>';
    ['subs', 'edits', 'dups'].forEach(t => { $('n-' + t).textContent = '0'; });
  }
})();
