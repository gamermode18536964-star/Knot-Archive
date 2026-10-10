// Archive logic shared by the website and the verification scripts:
// building knot records, crossing-number bounds, names, simplest diagrams,
// drawings, and the duplicate check. Browser: global KnotLib. Node: require().
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const E = isNode ? require('./engine.js') : root.KnotEngine;
  const KD = isNode ? require('./diagram.js') : root.KnotDiagram;

  const BLOCK_SIZE = 1000;
  const CHUNK_SIZE = 100; // a block is audited in chunks of this many indexes

  // ---------- Names ----------
  const NICKNAMES = {
    '0₁': 'Unknot', '3₁': 'Trefoil', '4₁': 'Figure-eight knot', '5₁': 'Cinquefoil',
    '5₂': 'Three-twist knot', '6₁': 'Stevedore knot', '7₁': 'Septafoil',
  };
  function nickname(k) {
    if (!k.name || !k.name.confirmed) return '';
    if (k.name.name === '3₁ # 3₁') return k.chiral ? 'Granny knot' : 'Square knot';
    return NICKNAMES[k.name.name] || '';
  }
  // {main, sub}: the table name when identified, otherwise "Knot #id"
  function displayName(k) {
    if (k.name && k.name.confirmed) return { main: k.name.name, sub: nickname(k) };
    if (k.name) return { main: 'Knot #' + k.id, sub: 'possibly ' + k.name.name };
    return { main: 'Knot #' + k.id, sub: '' };
  }
  function label(k) {
    const d = displayName(k);
    if (d.main.startsWith('Knot #')) return d.main;
    return d.main + (d.sub ? ' (' + d.sub.toLowerCase() + ', #' + k.id + ')' : ' (#' + k.id + ')');
  }
  function crossingText(k) {
    const { lower, upper } = k.crossings;
    if (lower === upper) return lower + (lower === 1 ? ' crossing' : ' crossings');
    return lower + '–' + upper + ' crossings';
  }

  // ---------- Polynomials ----------
  const canonStr = d => {
    const s1 = d.min + ':' + d.coeffs.join(',');
    const m = { min: -(d.min + d.coeffs.length - 1), coeffs: d.coeffs.slice().reverse() };
    const s2 = m.min + ':' + m.coeffs.join(',');
    return s1 <= s2 ? s1 : s2;
  };
  const mirrorPoly = d => ({ min: -(d.min + d.coeffs.length - 1), coeffs: d.coeffs.slice().reverse() });
  const jonesText = (k, mirror) => k.unknot ? '1' : E.polyToString(mirror ? mirrorPoly(k.jones) : k.jones);
  const alexText = k => E.polyToString({ min: -(k.alexander.length - 1) / 2, coeffs: k.alexander });
  const determinant = k => Math.abs(k.alexander.reduce((s, c, i) => s + c * (i % 2 ? -1 : 1), 0)); // |Δ(-1)|

  // ---------- PD codes ----------
  function fromPD(pd) {
    const D = pd.map(() => [null, null, null, null]);
    const seen = new Map();
    pd.forEach((x, c) => x.forEach((lab, s) => {
      if (seen.has(lab)) { const [c2, s2] = seen.get(lab); D[c][s] = [c2, s2]; D[c2][s2] = [c, s]; }
      else seen.set(lab, [c, s]);
    }));
    return D;
  }

  // ---------- Bounds and names ----------
  // Jones span is a proven lower bound on crossing number; the simplest diagram or braid an upper bound.
  // A confirmed table name fixes it exactly (3₁ # 4₁ -> 3 + 4).
  function updateBounds(k) {
    const lower = k.unknot ? 0 : k.jones.coeffs.length - 1;
    const upper = k.unknot ? 0 : Math.min(k.braid.length, Array.isArray(k.pd) ? k.diagramCrossings : Infinity);
    k.crossings = { lower, upper };
    k.name = E.knownName(k.alexander, upper, k.unknot);
    if (k.name && k.name.confirmed) {
      const c = k.name.name.split('#').reduce((s, x) => s + parseInt(x, 10), 0);
      k.crossings = { lower: c, upper: c };
    }
    k.nickname = nickname(k) || undefined;
  }

  // ---------- Simplest diagram ----------
  // Turn a braid into a planar diagram and simplify it with Reidemeister moves.
  // Accepted only if its Jones polynomial still matches. Deterministic for a given seed.
  const MAX_TRIES = 6;
  function improveDiagram(k, word, n, seed) {
    if (k.unknot) { k.pd = []; k.diagramCrossings = 0; updateBounds(k); return false; }
    const lower = k.jones.coeffs.length - 1;
    if (Array.isArray(k.pd) && k.diagramCrossings <= lower) return false;
    if ((k.simplifyTries || 0) >= MAX_TRIES) return false;
    k.simplifyTries = (k.simplifyTries || 0) + 1;
    const D = KD.simplify(KD.fromBraid(word, n), seed + 1, 300, lower);
    if (!KD.isValid(D) || canonStr(KD.jonesFromDiagram(D)) !== canonStr(k.jones)) return false;
    let changed = false;
    if (!Array.isArray(k.pd) || D.length < k.diagramCrossings) { k.pd = KD.toPD(D); k.diagramCrossings = D.length; changed = true; }
    updateBounds(k);
    return changed;
  }

  // ---------- Archive records ----------
  function indexArchive(archive) {
    const byKey = new Map(), byId = new Map();
    for (const k of archive.knots) { byKey.set(k.key, k); byId.set(k.id, k); }
    return { byKey, byId };
  }
  // Record one index result. Returns {knot, isNew, drawingChanged}.
  function recordIndex(archive, idx, word, n, index, meta) {
    const r = E.analyze(word, n);
    let k = idx.byKey.get(r.key);
    if (!k) {
      k = {
        id: archive.knots.length + 1, key: r.key, braid: word.slice(), strands: n,
        crossings: { lower: 0, upper: 0 }, alexander: r.alexander, jones: r.jones, chiral: r.chiral,
        unknot: r.isUnknot, discoveredAtIndex: index, discoveredBy: meta.by || null,
        block: Math.floor(index / BLOCK_SIZE), source: meta.source || null, hits: 1,
      };
      archive.knots.push(k); idx.byKey.set(k.key, k); idx.byId.set(k.id, k);
      improveDiagram(k, word, n, index);
      updateBounds(k);
      return { knot: k, isNew: true, drawingChanged: true };
    }
    k.hits = (k.hits || 0) + (meta.countHit === false ? 0 : 1);
    let drawingChanged = false;
    if (!k.unknot && word.length < k.braid.length) { k.braid = word.slice(); k.strands = n; }
    if (!k.unknot && k.diagramCrossings > k.crossings.lower) drawingChanged = improveDiagram(k, word, n, index);
    updateBounds(k);
    return { knot: k, isNew: false, drawingChanged };
  }

  // Walk candidate indexes [start, end] in order, calling fn(index, word, strands).
  // Pass a running iterator {gen, pos} to continue where a previous call stopped.
  function walk(start, end, fn, it) {
    it = it || { gen: E.candidates(E.MAX_STRANDS), pos: 0 };
    if (it.pos > start) { it.gen = E.candidates(E.MAX_STRANDS); it.pos = 0; }
    while (it.pos <= end) {
      const nx = it.gen.next();
      if (nx.done) break;
      const i = it.pos++;
      if (i >= start) fn(i, nx.value.word, nx.value.strands);
    }
    return it;
  }

  // ---------- Drawings (path data in a 120×120 box; colours come from the page) ----------
  function drawing(k) {
    if (!k.pd || !k.pd.length) return { circle: true };
    const S = 120, M = 10, SUB = 10;
    const { pts, marks } = KD.layout(fromPD(k.pd));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const sc = (S - 2 * M) / Math.max(x1 - x0, y1 - y0, 1e-6), ox = (S - (x1 - x0) * sc) / 2, oy = (S - (y1 - y0) * sc) / 2;
    const P = pts.map(([x, y]) => [ox + (x - x0) * sc, oy + (y - y0) * sc]);
    const n = P.length, smp = [];
    const dd = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]) + 1e-6, 0.5);
    for (let i = 0; i < n; i++) {
      // centripetal Catmull-Rom through the layout points: smooth strands without cusps
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      const d1 = dd(p0, p1), d2 = dd(p1, p2), d3 = dd(p2, p3);
      const c1 = [0, 1].map(j => (d1 * d1 * p2[j] - d2 * d2 * p0[j] + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[j]) / (3 * d1 * (d1 + d2)));
      const c2 = [0, 1].map(j => (d3 * d3 * p1[j] - d2 * d2 * p3[j] + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[j]) / (3 * d3 * (d3 + d2)));
      for (let s = 0; s < SUB; s++) {
        const t = s / SUB, u = 1 - t;
        smp.push([0, 1].map(j => u * u * u * p1[j] + 3 * u * u * t * c1[j] + 3 * u * t * t * c2[j] + t * t * t * p2[j]));
      }
    }
    const N = smp.length;
    const poly = (a, b) => { let d = ''; for (let j = a; j <= b; j++) { const q = smp[((j % N) + N) % N]; d += (j === a ? 'M' : 'L') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); } return d; };
    const over = [];
    for (const m of marks) if (m.over) { const c = m.index * SUB; over.push([poly(c - 6, c + 6), poly(c - SUB, c + SUB)]); }
    return { path: poly(0, N) + 'Z', over };
  }

  // ---------- Duplicate check ----------
  // One differing invariant proves two knots are different. If every invariant agrees, we test
  // whether the simplest diagrams are the same drawing (up to relabeling, reflection and mirror).
  function sameDiagram(pdA, pdB) {
    if (pdA.length !== pdB.length) return false;
    if (!pdA.length) return true;
    const A = fromPD(pdA), B = fromPD(pdB);
    const seqA = KD.traverse(A), n = seqA.length;
    for (const reflect of [false, true]) for (const swap of [false, true]) for (let c0 = 0; c0 < B.length; c0++) for (let s0 = 0; s0 < 4; s0++) {
      const f = s => (reflect ? (4 - s) & 3 : s);
      const mapC = new Map(), used = new Set(), off = new Map();
      let cb = c0, sb = s0, ok = true;
      for (let i = 0; i < n && ok; i++) {
        const [ca, sa] = seqA[i];
        if (!mapC.has(ca)) {
          const o = (sb - f(sa) + 8) & 3;
          if (((o & 1) === 1) !== swap || used.has(cb)) { ok = false; break; }
          mapC.set(ca, cb); used.add(cb); off.set(ca, o);
        } else if (mapC.get(ca) !== cb || ((f(sa) + off.get(ca)) & 3) !== sb) { ok = false; break; }
        const nx = B[cb][(sb + 2) & 3]; cb = nx[0]; sb = nx[1];
      }
      if (ok) return true;
    }
    return false;
  }

  function compareKnots(a, b) {
    const ev = []; // {same, proves, text, detail}
    const ca = a.crossings, cb = b.crossings;
    const overlap = ca.lower <= cb.upper && cb.lower <= ca.upper;
    ev.push(overlap
      ? { same: true, text: 'Crossing numbers can match (' + crossingText(a) + ' vs ' + crossingText(b) + ').' }
      : { same: false, proves: true, text: 'Crossing numbers differ: ' + crossingText(a) + ' vs ' + crossingText(b) + '. A knot has only one crossing number.' });
    const sameAlex = a.alexander.join() === b.alexander.join();
    ev.push(sameAlex
      ? { same: true, text: 'Same Alexander polynomial.', detail: alexText(a) }
      : { same: false, proves: true, text: 'Alexander polynomials differ.', detail: label(a) + ': ' + alexText(a) + '  ·  ' + label(b) + ': ' + alexText(b) });
    if (!sameAlex && determinant(a) !== determinant(b)) ev.push({ same: false, proves: true, text: 'Determinants differ (' + determinant(a) + ' vs ' + determinant(b) + ').' });
    const sameJones = canonStr(a.jones) === canonStr(b.jones);
    ev.push(sameJones
      ? { same: true, text: 'Same Jones polynomial (mirror images counted as the same knot).', detail: jonesText(a) }
      : { same: false, proves: true, text: 'Jones polynomials differ, even after allowing for mirror images.', detail: label(a) + ': ' + jonesText(a) + '  ·  ' + label(b) + ': ' + jonesText(b) });
    if (a.chiral !== b.chiral) {
      const ch = a.chiral ? a : b, am = a.chiral ? b : a;
      ev.push({ same: false, proves: true, text: label(ch) + ' is chiral (different from its mirror image) but ' + label(am) + ' is not, so one can’t be deformed into the other.' });
    }
    let iso = null;
    if (ev.every(e => e.same)) {
      iso = Array.isArray(a.pd) && Array.isArray(b.pd) && sameDiagram(a.pd, b.pd);
      ev.push(iso
        ? { same: true, text: 'Their simplest diagrams are the same drawing, so these are the same knot.' }
        : { same: true, text: 'Their simplest diagrams are different drawings. That doesn’t prove they’re different knots, but nothing here proves they’re the same either.' });
    }
    const proven = ev.some(e => e.proves);
    return { a, b, ev, verdict: proven ? 'different' : iso ? 'same' : 'possible', score: ev.filter(e => e.same).length };
  }

  // Check one knot against the whole archive: returns {knot, closest, matches}
  function duplicateReport(archive, k) {
    const comps = archive.knots.filter(o => o.id !== k.id).map(o => compareKnots(k, o));
    const matches = comps.filter(c => c.verdict !== 'different');
    comps.sort((x, y) => y.score - x.score || x.b.id - y.b.id);
    return { knot: k, closest: matches.length ? matches[0] : comps[0], matches };
  }

  const api = {
    BLOCK_SIZE, CHUNK_SIZE, nickname, displayName, label, crossingText, canonStr, mirrorPoly, jonesText, alexText,
    determinant, fromPD, updateBounds, improveDiagram, indexArchive, recordIndex, walk, drawing, sameDiagram,
    compareKnots, duplicateReport,
  };
  if (isNode) module.exports = api; else root.KnotLib = api;
})(typeof self !== 'undefined' ? self : this);
