// Shared page code: repository settings, header and footer, data loading, knot drawings,
// safe Markdown for community descriptions, and links into GitHub.
(function () {
  'use strict';
  const L = window.KnotLib;

  // ---------- Repository ----------
  // On GitHub Pages the repository is read from the address (owner.github.io/repo).
  // Anywhere else (a custom domain, or testing locally) set it in assets/js/config.js.
  function detectRepo() {
    const cfg = window.KNOT_CONFIG || {};
    if (cfg.repo && !/OWNER\/REPO/.test(cfg.repo)) return cfg.repo;
    const host = location.hostname;
    if (host.endsWith('.github.io')) {
      const owner = host.split('.')[0];
      const first = location.pathname.split('/').filter(Boolean)[0];
      return owner + '/' + (first && !first.endsWith('.html') ? first : host);
    }
    return null;
  }
  const repo = detectRepo();
  const branch = (window.KNOT_CONFIG && window.KNOT_CONFIG.branch) || 'main';
  const gh = repo ? 'https://github.com/' + repo : null;

  // ---------- Helpers ----------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n).toLocaleString('en-US');
  const $ = id => document.getElementById(id);

  async function getJson(path) {
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) throw new Error(path + ': ' + r.status);
    return r.json();
  }
  let archivePromise = null, blocksPromise = null;
  const loadArchive = () => (archivePromise = archivePromise || getJson('data/knots.json'));
  const loadBlocks = () => (blocksPromise = blocksPromise || getJson('data/blocks.json').catch(() => ({ blocks: [] })));

  // Searched range: the verified blocks from 0 upward with no gap.
  function searchedUpTo(blocks) {
    const done = new Set(blocks.blocks.filter(b => b.status === 'verified').map(b => b.block));
    let b = 0; while (done.has(b)) b++;
    return { contiguous: b * L.BLOCK_SIZE, verified: done };
  }

  // ---------- Drawings ----------
  const drawingCache = new Map();
  function loadDrawing(id) {
    if (!drawingCache.has(id)) drawingCache.set(id, getJson('data/drawings/' + id + '.json').catch(() => null));
    return drawingCache.get(id);
  }
  function svgFrom(d, labelText, cls) {
    const a = 'class="' + (cls || 'art') + '" viewBox="0 0 120 120" role="img" aria-label="' + esc(labelText) + '"';
    if (!d) return '<svg ' + a + '><rect class="art-loading" x="20" y="20" width="80" height="80" rx="40"/></svg>';
    if (d.circle) return '<svg ' + a + '><circle class="strand" cx="60" cy="60" r="44"/></svg>';
    let out = '<path class="strand" d="' + d.path + '"/>';
    for (const [halo, strand] of d.over) out += '<path class="halo" d="' + halo + '"/><path class="strand" d="' + strand + '"/>';
    return '<svg ' + a + '>' + out + '</svg>';
  }
  // Fill every element with data-knot-art="<id>" once its drawing arrives.
  function hydrateArt(root) {
    (root || document).querySelectorAll('[data-knot-art]').forEach(el => {
      const id = Number(el.dataset.knotArt);
      loadDrawing(id).then(d => { el.outerHTML = svgFrom(d, el.getAttribute('aria-label') || 'Knot diagram', el.getAttribute('class')); });
    });
  }
  const artPlaceholder = (id, labelText, cls) => '<svg data-knot-art="' + id + '" class="' + (cls || 'art') + '" viewBox="0 0 120 120" role="img" aria-label="' + esc(labelText) + '"><rect class="art-loading" x="20" y="20" width="80" height="80" rx="40"/></svg>';

  // ---------- Markdown (a small, safe subset: paragraphs, lists, bold, italics, code, links) ----------
  function md(text) {
    const inline = s => esc(s)
      .replace(/`([^`]+)`/g, '<code class="mono">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|knot\.html\?id=\d+)\)/g, '<a href="$2">$1</a>')
      .replace(/(^|[\s(])#(\d+)\b/g, '$1<a href="knot.html?id=$2">#$2</a>');
    return text.replace(/\r/g, '').trim().split(/\n{2,}/).map(block => {
      const lines = block.split('\n');
      if (lines.every(l => /^\s*[-*]\s+/.test(l))) return '<ul>' + lines.map(l => '<li>' + inline(l.replace(/^\s*[-*]\s+/, '')) + '</li>').join('') + '</ul>';
      return '<p>' + inline(lines.join(' ')) + '</p>';
    }).join('');
  }

  // ---------- GitHub links ----------
  function issueUrl(template, title, fields) {
    if (!gh) return null;
    const p = new URLSearchParams({ template, title });
    for (const [k, v] of Object.entries(fields || {})) p.set(k, v);
    return gh + '/issues/new?' + p.toString();
  }
  const descriptionUrl = (id, exists) => !gh ? null : exists
    ? gh + '/edit/' + branch + '/data/descriptions/' + id + '.md'
    : gh + '/new/' + branch + '/data/descriptions?' + new URLSearchParams({ filename: id + '.md', value: 'Write what is known about this knot here.\n' }).toString();
  const profileLink = name => name ? '<a href="https://github.com/' + esc(name) + '">@' + esc(name) + '</a>' : 'the starting archive';

  // ---------- Header and footer ----------
  function chrome(page) {
    const nav = [['index.html', 'Archive', 'archive'], ['contribute.html', 'Contribute', 'contribute'], ['review.html', 'Review queue', 'review'], ['index.html#how', 'How it works', 'how']];
    const header = document.getElementById('site-header');
    if (header) {
      header.className = 'site-header';
      header.innerHTML = '<div class="wrap">' +
        '<a class="brand" href="index.html">' + artPlaceholder(1, '', 'logo') + '<span>Knot Archive</span></a>' +
        '<nav class="site-nav" aria-label="Main">' + nav.map(([href, text, key]) => '<a href="' + href + '"' + (key === page ? ' aria-current="page"' : '') + '>' + text + '</a>').join('') + '</nav>' +
        '<span class="spacer"></span>' +
        (gh ? '<a class="btn" href="' + gh + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/></svg><span>GitHub</span></a>' : '') +
        (page !== 'contribute' ? '<a class="btn primary" href="contribute.html">Lend your CPU</a>' : '') +
        '</div>';
      header.querySelector('.logo').setAttribute('aria-hidden', 'true');
    }
    const footer = document.getElementById('site-footer');
    if (footer) {
      footer.className = 'site-footer';
      footer.innerHTML = '<div class="wrap">' +
        '<span>Open data: ' + (gh ? '<a href="' + gh + '/blob/' + branch + '/data/knots.json">knots.json</a>' : '<a href="data/knots.json">knots.json</a>') + '</span>' +
        '<span>Names follow the Rolfsen table where a knot is identified</span><span class="spacer"></span>' +
        (gh ? '<a href="' + gh + '">Source on GitHub</a>' : '<span>Repository not set: see README</span>') + '</div>';
    }
    hydrateArt(header || document);
  }

  window.Site = { repo, branch, gh, esc, fmt, $, getJson, loadArchive, loadBlocks, searchedUpTo, loadDrawing, svgFrom, hydrateArt, artPlaceholder, md, issueUrl, descriptionUrl, profileLink, chrome };
})();
