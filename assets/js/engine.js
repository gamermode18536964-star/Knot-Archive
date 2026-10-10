// Knot discovery engine: braid enumeration + knot invariants (Jones, Alexander).
// Shared by the website, the volunteer workers and the GitHub verification scripts.
// Works in the browser (global KnotEngine) and in Node (module.exports).
(function (root) {
  'use strict';

  // ---------- Laurent polynomials: Map<exponent, coefficient> ----------
  function P(obj) { const m = new Map(); for (const k in obj) if (obj[k]) m.set(+k, obj[k]); return m; }
  function padd(a, b, s = 1) {
    const r = new Map(a);
    for (const [e, c] of b) { const v = (r.get(e) || 0) + s * c; if (v) r.set(e, v); else r.delete(e); }
    return r;
  }
  function pmul(a, b) {
    const r = new Map();
    for (const [e1, c1] of a) for (const [e2, c2] of b) {
      const e = e1 + e2, v = (r.get(e) || 0) + c1 * c2;
      if (v) r.set(e, v); else r.delete(e);
    }
    return r;
  }
  function pscale(a, s, shift = 0) { const r = new Map(); for (const [e, c] of a) if (c * s) r.set(e + shift, c * s); return r; }
  const ZERO = new Map(), ONE = P({ 0: 1 });
  function toDense(a) { // -> {min, coeffs[]}
    if (a.size === 0) return { min: 0, coeffs: [] };
    const es = [...a.keys()], min = Math.min(...es), max = Math.max(...es);
    const coeffs = []; for (let e = min; e <= max; e++) coeffs.push(a.get(e) || 0);
    return { min, coeffs };
  }

  // ---------- Braid helpers ----------
  // word: array of nonzero ints; +i = sigma_i, -i = sigma_i^{-1}; strands n
  function closurePermIsKnot(word, n) {
    const perm = []; for (let i = 0; i < n; i++) perm.push(i);
    for (const g of word) { const i = Math.abs(g) - 1; const t = perm[i]; perm[i] = perm[i + 1]; perm[i + 1] = t; }
    // perm[p] = which starting strand ends at position p; cycle length from 0
    const inv = new Array(n); for (let p = 0; p < n; p++) inv[perm[p]] = p;
    let x = 0, len = 0; do { x = inv[x]; len++; } while (x !== 0 && len <= n);
    return len === n;
  }

  // Letter order for canonical comparison: 1,-1,2,-2,...
  function rank(g) { return Math.abs(g) * 2 + (g < 0 ? 1 : 0); }
  function cmpWords(a, b) {
    for (let i = 0; i < a.length; i++) { const d = rank(a[i]) - rank(b[i]); if (d) return d; }
    return 0;
  }
  // Is word the minimum among rotations x flip x mirror x reverse? (all give the same unoriented knot type up to mirror)
  function isCanonical(word, n) {
    const L = word.length;
    const bases = [];
    const flip = w => w.map(g => Math.sign(g) * (n - Math.abs(g)));
    const mir = w => w.map(g => -g);
    const rev = w => w.slice().reverse();
    let ws = [word]; ws = ws.concat(ws.map(flip)); ws = ws.concat(ws.map(mir)); ws = ws.concat(ws.map(rev));
    for (const w of ws) for (let s = 0; s < L; s++) {
      let d = 0;
      for (let i = 0; i < L; i++) { d = rank(w[(i + s) % L]) - rank(word[i]); if (d) break; }
      if (d < 0) return false;
    }
    return true;
  }

  // Cheap filters that decide whether a word is a "candidate index".
  function isCandidate(word, n) {
    const L = word.length;
    if (L === 0) return false;
    if (word[0] === -word[L - 1] && L > 1) return false;          // cyclically reducible
    const counts = new Array(n).fill(0);
    for (const g of word) counts[Math.abs(g)]++;
    for (let i = 1; i < n; i++) if (counts[i] === 0) return false; // split link
    if (counts[n - 1] === 1 || counts[1] === 1) return false;      // Markov destabilizable -> fewer strands
    if (!closurePermIsKnot(word, n)) return false;                  // must close to ONE loop
    return isCanonical(word, n);
  }

  // Candidate stream, ordered by (crossings L, strands n, lexicographic).
  function* candidates(maxStrands = 5, maxLength = 40) {
    for (let L = 1; L <= maxLength; L++) {
      for (let n = 2; n <= Math.min(maxStrands, L + 1); n++) {
        const letters = [];
        for (let i = 1; i < n; i++) { letters.push(i); letters.push(-i); }
        const w = new Array(L);
        // iterative DFS with adjacent-cancellation pruning
        const idx = new Array(L).fill(-1);
        let d = 0;
        while (d >= 0) {
          idx[d]++;
          if (idx[d] >= letters.length) { idx[d] = -1; d--; continue; }
          const g = letters[idx[d]];
          if (d > 0 && g === -w[d - 1]) continue;
          w[d] = g;
          if (d === L - 1) { if (isCandidate(w, n)) yield { word: w.slice(), strands: n }; }
          else d++;
        }
      }
    }
  }

  // ---------- Jones polynomial via Kauffman bracket state sum ----------
  function jones(word, n) {
    const L = word.length, N = L * n;
    const parent = new Int32Array(N);
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const id = (k, p) => (k % L) * n + p;
    // table[sigma + L][loops] counts
    const table = new Map();
    const total = 1 << L;
    for (let s = 0; s < total; s++) {
      for (let i = 0; i < N; i++) parent[i] = i;
      let comps = N, aMinusB = 0;
      const uni = (x, y) => { x = find(x); y = find(y); if (x !== y) { parent[x] = y; comps--; } };
      for (let k = 0; k < L; k++) {
        const g = word[k], i = Math.abs(g) - 1;
        const isA = ((s >> k) & 1) === 0;
        aMinusB += isA ? 1 : -1;
        const vertical = (g > 0) === isA; // positive crossing: A-smoothing is vertical
        for (let p = 0; p < n; p++) if (p !== i && p !== i + 1) uni(id(k, p), id(k + 1, p));
        if (vertical) { uni(id(k, i), id(k + 1, i)); uni(id(k, i + 1), id(k + 1, i + 1)); }
        else { uni(id(k, i), id(k, i + 1)); uni(id(k + 1, i), id(k + 1, i + 1)); }
      }
      const key = aMinusB * 1000 + comps;
      table.set(key, (table.get(key) || 0) + 1);
    }
    const dpoly = P({ 2: -1, '-2': -1 });
    const dpow = [ONE];
    let bracket = ZERO;
    for (const [key, cnt] of table) {
      const comps = ((key % 1000) + 1000) % 1000;
      const sigma = Math.round((key - comps) / 1000);
      while (dpow.length < comps) dpow.push(pmul(dpow[dpow.length - 1], dpoly));
      bracket = padd(bracket, pscale(dpow[comps - 1], cnt, sigma));
    }
    const w = word.reduce((a, g) => a + Math.sign(g), 0);
    // V = (-A^3)^{-w} <K>
    const f = pscale(bracket, (w % 2 === 0) ? 1 : -1, -3 * w);
    // t = A^{-4}
    const V = new Map();
    for (const [e, c] of f) { if (e % 4 !== 0) throw new Error('Jones: exponent not divisible by 4'); V.set(-e / 4, c); }
    return V;
  }

  // ---------- Alexander polynomial via reduced Burau ----------
  function burauMatrix(g, m) { // m = n-1 dimension; returns array of Maps
    const M = [];
    for (let r = 0; r < m; r++) { M.push([]); for (let c = 0; c < m; c++) M[r].push(r === c ? ONE : ZERO); }
    const i = Math.abs(g) - 1; // row index
    if (g > 0) {
      M[i][i] = P({ 1: -1 });
      if (i - 1 >= 0) M[i][i - 1] = P({ 1: 1 });
      if (i + 1 < m) M[i][i + 1] = ONE;
    } else {
      M[i][i] = P({ '-1': -1 });
      if (i - 1 >= 0) M[i][i - 1] = ONE;
      if (i + 1 < m) M[i][i + 1] = P({ '-1': 1 });
    }
    return M;
  }
  function matmul(A, B) {
    const m = A.length, R = [];
    for (let r = 0; r < m; r++) { R.push([]); for (let c = 0; c < m; c++) {
      let s = ZERO; for (let k = 0; k < m; k++) if (A[r][k].size && B[k][c].size) s = padd(s, pmul(A[r][k], B[k][c]));
      R[r].push(s);
    } }
    return R;
  }
  function det(M) {
    const m = M.length;
    if (m === 1) return M[0][0];
    let s = ZERO;
    for (let c = 0; c < m; c++) {
      if (!M[0][c].size) continue;
      const minor = M.slice(1).map(row => row.filter((_, j) => j !== c));
      s = padd(s, pmul(M[0][c], det(minor)), c % 2 ? -1 : 1);
    }
    return s;
  }
  function alexander(word, n) {
    if (n === 1) return [1];
    const m = n - 1;
    let B = null;
    for (const g of word) { const G = burauMatrix(g, m); B = B ? matmul(B, G) : G; }
    const IminusB = B.map((row, r) => row.map((x, c) => padd(r === c ? ONE : ZERO, x, -1)));
    const D = toDense(det(IminusB));
    // divide by 1 + t + ... + t^{n-1}
    const num = D.coeffs.slice(); const q = [];
    for (let i = 0; i + n - 1 < num.length; i++) {
      const c = num[i]; q.push(c);
      for (let j = 0; j < n; j++) num[i + j] -= c;
    }
    for (const r of num) if (r !== 0) throw new Error('Alexander: non-exact division');
    return normalizeAlex(q);
  }
  function normalizeAlex(q) {
    let a = q.slice();
    while (a.length && a[0] === 0) a.shift();
    while (a.length && a[a.length - 1] === 0) a.pop();
    const v1 = a.reduce((x, y) => x + y, 0);
    if (v1 < 0) a = a.map(x => -x);
    return a.length ? a : [0];
  }

  // ---------- Fingerprint ----------
  function jonesDense(V) { const d = toDense(V); return d; }
  function denseStr(d) { return d.min + ':' + d.coeffs.join(','); }
  function mirrorDense(d) { return { min: -(d.min + d.coeffs.length - 1), coeffs: d.coeffs.slice().reverse() }; }

  function analyze(word, n) {
    const V = jonesDense(jones(word, n));
    const Vm = mirrorDense(V);
    const s1 = denseStr(V), s2 = denseStr(Vm);
    const canon = s1 <= s2 ? V : Vm;
    const chiral = s1 !== s2;
    const alex = alexander(word, n);
    const span = V.coeffs.length - 1;
    const isUnknot = V.coeffs.length === 1 && V.min === 0 && V.coeffs[0] === 1;
    return {
      key: alex.join(',') + '|' + denseStr(canon),
      jones: canon, alexander: alex, chiral, jonesSpan: span, isUnknot,
    };
  }

  // Known prime knots up to 7 crossings, identified by Alexander polynomial (Rolfsen table).
  const KNOWN = {
    '1': '0₁', '1,-1,1': '3₁', '-1,3,-1': '4₁', '1,-1,1,-1,1': '5₁', '2,-3,2': '5₂',
    '-2,5,-2': '6₁', '-1,3,-3,3,-1': '6₂', '1,-3,5,-3,1': '6₃',
    '1,-1,1,-1,1,-1,1': '7₁', '3,-5,3': '7₂', '2,-3,3,-3,2': '7₃', '4,-7,4': '7₄',
    '2,-4,5,-4,2': '7₅', '-1,5,-7,5,-1': '7₆', '1,-5,9,-5,1': '7₇',
    '1,-2,3,-2,1': '3₁ # 3₁', '-1,4,-5,4,-1': '3₁ # 4₁',
  };
  // Returns {name, confirmed}. Confirmed when the knot provably has <= 7 crossings
  // (every knot up to 7 crossings has a distinct Alexander polynomial in this table).
  function knownName(alex, crossingUpper, isUnknot) {
    if (isUnknot) return { name: '0₁', confirmed: true };
    const k = KNOWN[alex.join(',')];
    if (!k) return null;
    if (k === '0₁') return { name: '0₁ (Alexander only)', confirmed: false };
    return { name: k, confirmed: crossingUpper <= 7 };
  }

  function polyToString(d, v = 't') {
    const parts = [];
    d.coeffs.forEach((c, i) => {
      if (!c) return;
      const e = d.min + i;
      const sign = c < 0 ? '−' : '+';
      const a = Math.abs(c);
      let term;
      if (e === 0) term = String(a);
      else { const coef = a === 1 ? '' : String(a); term = coef + v + (e === 1 ? '' : '^' + e); }
      parts.push({ sign, term });
    });
    if (!parts.length) return '0';
    return parts.map((p, i) => (i === 0 ? (p.sign === '−' ? '−' : '') : ' ' + p.sign + ' ') + p.term).join('');
  }

  function braidString(word) {
    const sub = '₀₁₂₃₄₅₆₇₈₉';
    return word.map(g => 'σ' + String(Math.abs(g)).split('').map(d => sub[+d]).join('') + (g < 0 ? '⁻¹' : '')).join(' ');
  }

  // Changing the enumeration order or the candidate filters changes what every index means.
  // Bump this whenever that happens: the verifier rejects submissions from another version.
  const ENGINE_VERSION = 'braid-closure-v1';
  const MAX_STRANDS = 5;

  const api = { ENGINE_VERSION, MAX_STRANDS, braidString, candidates, analyze, jones, alexander, knownName, polyToString, isCandidate, closurePermIsKnot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KnotEngine = api;
})(typeof self !== 'undefined' ? self : this);
