// Planar knot diagrams: braid -> diagram, Reidemeister simplification, layout.
// A diagram is an array of crossings. Each crossing has 4 slots in counterclockwise order;
// the under-strand uses slots 0 and 2, the over-strand slots 1 and 3.
// nbr[c][s] = [c2, s2]: the edge leaving slot s of crossing c arrives at slot s2 of crossing c2.
(function (root) {
  'use strict';

  const opp = s => (s + 2) & 3;

  function clone(D) { return D.map(x => x.map(y => y.slice())); }

  // ---------- Braid closure -> diagram ----------
  function fromBraid(word, n) {
    const L = word.length;
    const D = [];
    const events = Array.from({ length: n }, () => []); // per position: [crossing, bottomSlot, topSlot]
    for (let k = 0; k < L; k++) {
      const g = word[k], i = Math.abs(g) - 1;
      // corners: BL, BR, TR, TL (counterclockwise). Positive: strand BL->TR is over, so BR->TL is under.
      const slotOf = g > 0 ? { BR: 0, TR: 1, TL: 2, BL: 3 } : { BL: 0, BR: 1, TR: 2, TL: 3 };
      D.push([null, null, null, null]);
      events[i].push([k, slotOf.BL, slotOf.TL]);
      events[i + 1].push([k, slotOf.BR, slotOf.TR]);
    }
    for (let p = 0; p < n; p++) {
      const ev = events[p], m = ev.length;
      for (let j = 0; j < m; j++) {
        const a = ev[j], b = ev[(j + 1) % m];
        D[a[0]][a[2]] = [b[0], b[1]];
        D[b[0]][b[1]] = [a[0], a[2]];
      }
    }
    return D;
  }

  // ---------- Removing crossings (strands pass straight through) ----------
  function removeCrossings(D, del) {
    const dead = new Set(del);
    const keep = [], map = new Map();
    for (let c = 0; c < D.length; c++) if (!dead.has(c)) { map.set(c, keep.length); keep.push(c); }
    const N = keep.map(() => [null, null, null, null]);
    for (const c of keep) for (let s = 0; s < 4; s++) {
      let cur = D[c][s], guard = 0;
      while (dead.has(cur[0])) { cur = D[cur[0]][opp(cur[1])]; if (++guard > 4 * D.length) break; }
      N[map.get(c)][s] = [map.get(cur[0]), cur[1]];
    }
    return N;
  }

  // ---------- Faces ----------
  function faces(D) {
    const seen = D.map(() => [false, false, false, false]);
    const F = [];
    for (let c = 0; c < D.length; c++) for (let s = 0; s < 4; s++) {
      if (seen[c][s]) continue;
      const face = [];
      let cc = c, ss = s, guard = 0;
      while (!seen[cc][ss]) {
        seen[cc][ss] = true; face.push([cc, ss]);
        const [c2, s2] = D[cc][ss];
        cc = c2; ss = (s2 + 3) & 3;
        if (++guard > 8 * D.length + 8) break;
      }
      F.push(face);
    }
    return F;
  }
  const isOver = s => (s & 1) === 1;

  // Try one Reidemeister I or II simplification. Returns new diagram or null.
  function reduceOnce(D) {
    for (const f of faces(D)) {
      if (f.length === 1) return removeCrossings(D, [f[0][0]]);
      if (f.length === 2) {
        const [A, sA] = f[0];
        const [B, tB] = D[A][sA];
        if (A !== B && isOver(sA) === isOver(tB)) return removeCrossings(D, [A, B]);
      }
    }
    return null;
  }

  // Reidemeister III on a triangular face, if allowed. Returns new diagram or null.
  function r3(D, f) {
    if (f.length !== 3) return null;
    const cs = f.map(d => d[0]);
    if (new Set(cs).size !== 3) return null;
    // the three triangle edges: from dart (X,s) to its neighbour
    const edges = f.map(([c, s]) => [[c, s], D[c][s]]);
    let ok = false;
    for (const [[c1, s1], [c2, s2]] of edges) if (isOver(s1) === isOver(s2)) ok = true;
    if (!ok) return null;
    const tri = new Set(cs);
    const N = clone(D);
    const pairs = [];
    for (const [[x, a], [y, b]] of edges) {
      const xo = [x, opp(a)], yo = [y, opp(b)];
      const n1 = D[x][opp(a)], n2 = D[y][opp(b)];
      if (tri.has(n1[0]) || tri.has(n2[0])) return null; // keep the move local
      // old: n1 - X.opp(a), X.a - Y.b, Y.opp(b) - n2
      // new: n1 - Y.b, Y.opp(b) - X.opp(a), X.a - n2
      pairs.push([n1, [y, b]], [yo, xo], [[x, a], n2]);
    }
    for (const [p, q] of pairs) { N[p[0]][p[1]] = q.slice(); N[q[0]][q[1]] = p.slice(); }
    return N;
  }

  // Reidemeister II in reverse: push face edge a across face edge b, adding two crossings.
  function r2up(D, f, ia, ib, aOver) {
    if (ia === ib) return null;
    const P = f[ia], Q = D[P[0]][P[1]], R = f[ib], S = D[R[0]][R[1]];
    const N = clone(D);
    const X = N.length, Y = X + 1;
    N.push([null, null, null, null], [null, null, null, null]);
    // slot roles at X and Y (counterclockwise), see derivation: X: a_in, b_in, a_out, b_out ; Y: a_in, b_out, a_out, b_in
    const xs = aOver ? { ain: 3, bin: 0, aout: 1, bout: 2 } : { ain: 0, bin: 1, aout: 2, bout: 3 };
    const ys = aOver ? { ain: 1, bout: 2, aout: 3, bin: 0 } : { ain: 0, bout: 1, aout: 2, bin: 3 };
    const con = (p, q) => { N[p[0]][p[1]] = q.slice(); N[q[0]][q[1]] = p.slice(); };
    con(P, [X, xs.ain]); con([X, xs.aout], [Y, ys.ain]); con([Y, ys.aout], Q);
    con(R, [Y, ys.bin]); con([Y, ys.bout], [X, xs.bin]); con([X, xs.bout], S);
    return N;
  }

  function isValid(D) {
    if (!D.length) return true;
    for (let c = 0; c < D.length; c++) for (let s = 0; s < 4; s++) {
      const t = D[c][s]; if (!t) return false;
      const b = D[t[0]][t[1]]; if (!b || b[0] !== c || b[1] !== s) return false;
    }
    return faces(D).length === D.length + 2; // Euler: V - E + F = 2 with E = 2V
  }

  function mulberry(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function reduceAll(D) { let r; while (D.length && (r = reduceOnce(D))) D = r; return D; }

  // Greedy R1/R2 plus a random walk of R3 moves looking for further reductions.
  function localSimplify(D, rnd, effort) {
    D = reduceAll(D);
    let best = D, cur = D, stale = 0;
    while (best.length && stale < effort) {
      const tris = faces(cur).filter(f => f.length === 3);
      stale++;
      if (!tris.length) break;
      const moved = r3(cur, tris[Math.floor(rnd() * tris.length)]);
      if (!moved) continue;
      cur = reduceAll(moved);
      if (cur.length < best.length) { best = cur; stale = 0; }
    }
    return best;
  }

  // Full simplification: local moves, then repeated "backtracking" (a few random
  // moves that may add crossings) followed by local simplification. Keeps the best.
  function simplify(D, seed = 1, rounds = 40, lowerBound = 0) {
    const rnd = mulberry(seed);
    let best = localSimplify(D, rnd, 40);
    for (let r = 0; r < rounds && best.length > lowerBound; r++) {
      let cur = best;
      const ups = 1 + Math.floor(rnd() * 2);
      for (let u = 0; u < ups; u++) {
        // add two crossings somewhere...
        for (let tries = 0; tries < 10; tries++) {
          const F = faces(cur), f = F[Math.floor(rnd() * F.length)];
          if (f.length < 2) continue;
          const nx = r2up(cur, f, Math.floor(rnd() * f.length), Math.floor(rnd() * f.length), rnd() < 0.5);
          if (nx) { cur = nx; break; }
        }
        // ...then slide strands around with R3 moves before any cleanup
        const slides = 2 + Math.floor(rnd() * 8);
        for (let k = 0; k < slides; k++) {
          const tris = faces(cur).filter(f => f.length === 3);
          if (!tris.length) break;
          const nx = r3(cur, tris[Math.floor(rnd() * tris.length)]);
          if (nx) cur = nx;
        }
      }
      cur = localSimplify(cur, rnd, 40);
      if (cur.length < best.length) best = cur;
    }
    return best;
  }

  // ---------- Traversal / orientation ----------
  // Walk the knot once. Returns list of [crossing, inSlot] in order.
  function traverse(D) {
    if (!D.length) return [];
    const seq = [];
    let c = 0, s = 0;
    for (let i = 0; i < 2 * D.length; i++) {
      seq.push([c, s]);
      const out = opp(s); const [c2, s2] = D[c][out]; c = c2; s = s2;
    }
    return seq;
  }

  // ---------- Jones polynomial from the diagram (for verification) ----------
  function jonesFromDiagram(D) {
    const C = D.length;
    if (!C) return { min: 0, coeffs: [1] };
    const seq = traverse(D);
    // writhe: under in-slot u, over in-slot o
    const uin = new Array(C), oin = new Array(C);
    for (const [c, s] of seq) { if (s & 1) oin[c] = s; else uin[c] = s; }
    let w = 0; for (let c = 0; c < C; c++) w += (oin[c] === ((uin[c] + 1) & 3)) ? -1 : 1;
    const id = (c, s) => c * 4 + s;
    const parent = new Int32Array(4 * C);
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const counts = new Map();
    for (let st = 0; st < (1 << C); st++) {
      for (let i = 0; i < 4 * C; i++) parent[i] = i;
      let comps = 4 * C, sigma = 0;
      const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) { parent[a] = b; comps--; } };
      for (let c = 0; c < C; c++) for (let s = 0; s < 4; s++) { const [c2, s2] = D[c][s]; if (c * 4 + s < c2 * 4 + s2) uni(id(c, s), id(c2, s2)); }
      for (let c = 0; c < C; c++) {
        const A = ((st >> c) & 1) === 0; sigma += A ? 1 : -1;
        if (A) { uni(id(c, 0), id(c, 1)); uni(id(c, 2), id(c, 3)); }
        else { uni(id(c, 0), id(c, 3)); uni(id(c, 1), id(c, 2)); }
      }
      const key = sigma + ',' + comps;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    // bracket as Map exponent->coeff in A
    const add = (m, e, v) => { const x = (m.get(e) || 0) + v; if (x) m.set(e, x); else m.delete(e); };
    const br = new Map();
    for (const [key, cnt] of counts) {
      const [sigma, comps] = key.split(',').map(Number);
      // d^(comps-1), d = -A^2 - A^-2
      let poly = new Map([[0, 1]]);
      for (let i = 0; i < comps - 1; i++) { const np = new Map(); for (const [e, v] of poly) { add(np, e + 2, -v); add(np, e - 2, -v); } poly = np; }
      for (const [e, v] of poly) add(br, e + sigma, v * cnt);
    }
    const V = new Map();
    for (const [e, v] of br) { const e2 = e - 3 * w; if (e2 % 4) throw new Error('bad exponent'); add(V, -e2 / 4, (w % 2 ? -1 : 1) * v); }
    const es = [...V.keys()]; const min = Math.min(...es), max = Math.max(...es);
    const coeffs = []; for (let e = min; e <= max; e++) coeffs.push(V.get(e) || 0);
    return { min, coeffs };
  }

  // ---------- PD code (KnotTheory convention X[a,b,c,d], a = incoming under edge, counterclockwise) ----------
  function toPD(D) {
    if (!D.length) return [];
    const seq = traverse(D);
    const label = D.map(() => [0, 0, 0, 0]);
    seq.forEach(([c, s], i) => {
      const inLabel = i + 1; // edge arriving at (c, s)
      label[c][s] = inLabel;
      const prev = seq[(i - 1 + seq.length) % seq.length];
      label[prev[0]][opp(prev[1])] = inLabel;
    });
    const uin = new Array(D.length);
    for (const [c, s] of seq) if (!(s & 1)) uin[c] = s;
    return D.map((_, c) => { const u = uin[c]; return [0, 1, 2, 3].map(k => label[c][(u + k) & 3]); });
  }

  // ---------- Layout: Tutte embedding of the diagram triangulated with face centres ----------
  function layout(D, K = 3) {
    const C = D.length;
    if (!C) return null;
    const F = faces(D);
    // edges: each dart (c,s) with its partner; give edge ids
    const edgeId = D.map(() => [-1, -1, -1, -1]);
    const edgeEnds = [];
    for (let c = 0; c < C; c++) for (let s = 0; s < 4; s++) if (edgeId[c][s] < 0) {
      const [c2, s2] = D[c][s];
      const e = edgeEnds.length; edgeEnds.push([[c, s], [c2, s2]]);
      edgeId[c][s] = e; edgeId[c2][s2] = e;
    }
    // vertices: crossings 0..C-1, then K subdivision points per edge, then face centres
    const sub = (e, k) => C + e * K + k; // k-th point from end 0 to end 1
    const firstSub = (c, s) => { const e = edgeId[c][s]; const fw = edgeEnds[e][0][0] === c && edgeEnds[e][0][1] === s; return sub(e, fw ? 0 : K - 1); };
    const nV0 = C + edgeEnds.length * K;
    // pick outer face: the largest
    let outer = 0; F.forEach((f, i) => { if (f.length > F[outer].length) outer = i; });
    const adj = Array.from({ length: nV0 + F.length }, () => new Set());
    const link = (a, b) => { if (a !== b) { adj[a].add(b); adj[b].add(a); } };
    edgeEnds.forEach(([[c], [c2]], e) => {
      let prev = c;
      for (let k = 0; k < K; k++) { link(prev, sub(e, k)); prev = sub(e, k); }
      link(prev, c2);
    });
    // boundary cycle of a face as vertex list
    const faceCycle = f => {
      const cyc = [];
      for (const [c, s] of f) {
        cyc.push(c);
        const e = edgeId[c][s];
        const forward = edgeEnds[e][0][0] === c && edgeEnds[e][0][1] === s;
        for (let k = 0; k < K; k++) cyc.push(sub(e, forward ? k : K - 1 - k));
      }
      return cyc;
    };
    const pos = new Array(nV0 + F.length);
    const fixed = new Array(nV0 + F.length).fill(false);
    F.forEach((f, i) => {
      const cyc = faceCycle(f);
      if (i === outer) {
        cyc.forEach((v, j) => { const a = -Math.PI / 2 + 2 * Math.PI * j / cyc.length; pos[v] = [Math.cos(a), Math.sin(a)]; fixed[v] = true; });
      } else {
        const fc = nV0 + i;
        for (const v of cyc) link(fc, v);
      }
    });
    for (let v = 0; v < pos.length; v++) if (!pos[v]) pos[v] = [0, 0];
    const nbrs = adj.map(s => [...s]);
    const V = pos.length;
    // Weighted Tutte embedding: each free point sits at the weighted average of its neighbours.
    // Any positive weights give an overlap-free drawing of this triangulated graph, so we can
    // re-weight freely to even out spacing (long edges pull harder, short ones relax).
    const wt = nbrs.map(list => list.map(() => 1));
    const solve = iters => {
      for (let it = 0; it < iters; it++) for (let v = 0; v < V; v++) {
        if (fixed[v] || !nbrs[v].length) continue;
        let x = 0, y = 0, W = 0;
        nbrs[v].forEach((u, j) => { const w = wt[v][j]; x += pos[u][0] * w; y += pos[u][1] * w; W += w; });
        pos[v] = [x / W, y / W];
      }
    };
    solve(600);
    for (let round = 0; round < 25; round++) {
      for (let v = 0; v < V; v++) nbrs[v].forEach((u, j) => {
        const d = Math.hypot(pos[u][0] - pos[v][0], pos[u][1] - pos[v][1]) + 1e-6;
        wt[v][j] = Math.min(50, Math.max(0.02, wt[v][j] * Math.pow(d / 0.25, 0.5)));
      });
      solve(80);
    }
    // Gentle force relaxation (frees the outer circle). Kept only if no strands overlap afterwards.
    const knotSegs = [];
    edgeEnds.forEach(([[c], [c2]], e) => { let prev = c; for (let k = 0; k < K; k++) { knotSegs.push([prev, sub(e, k)]); prev = sub(e, k); } knotSegs.push([prev, c2]); });
    const planar = P => {
      const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      for (let i = 0; i < knotSegs.length; i++) for (let j = i + 1; j < knotSegs.length; j++) {
        const [a, b] = knotSegs[i], [c, d] = knotSegs[j];
        if (a === c || a === d || b === c || b === d) continue;
        const d1 = cross(P[a], P[b], P[c]), d2 = cross(P[a], P[b], P[d]), d3 = cross(P[c], P[d], P[a]), d4 = cross(P[c], P[d], P[b]);
        if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return false;
      }
      return true;
    };
    const backup = pos.map(p => p.slice());
    const edges = []; for (let v = 0; v < V; v++) for (const u of nbrs[v]) if (u > v) edges.push([v, u]);
    const kk = Math.sqrt(Math.PI / V);
    let temp = 0.02, good = backup;
    for (let it = 0; it < 400; it++) {
      if (it % 8 === 0) { if (planar(pos)) good = pos.map(p => p.slice()); else break; }
      const disp = pos.map(() => [0, 0]);
      for (let a = 0; a < V; a++) for (let b = a + 1; b < V; b++) {
        const dx = pos[a][0] - pos[b][0], dy = pos[a][1] - pos[b][1];
        const d2 = dx * dx + dy * dy + 1e-6, f = kk * kk / d2;
        disp[a][0] += dx * f; disp[a][1] += dy * f; disp[b][0] -= dx * f; disp[b][1] -= dy * f;
      }
      for (const [a, b] of edges) {
        const dx = pos[a][0] - pos[b][0], dy = pos[a][1] - pos[b][1];
        const f = Math.hypot(dx, dy) / kk;
        disp[a][0] -= dx * f; disp[a][1] -= dy * f; disp[b][0] += dx * f; disp[b][1] += dy * f;
      }
      for (let v = 0; v < V; v++) {
        if (!nbrs[v].length) continue;
        const d = Math.hypot(disp[v][0], disp[v][1]) + 1e-9, m = Math.min(d, temp);
        pos[v] = [pos[v][0] + disp[v][0] / d * m, pos[v][1] + disp[v][1] / d * m];
      }
      temp *= 0.99;
    }
    if (!planar(pos)) for (let v = 0; v < V; v++) pos[v] = good[v];
    // knot path: sequence of points; mark where each crossing is visited and whether over
    const seq = traverse(D);
    const pts = [], marks = [];
    for (const [c, s] of seq) {
      marks.push({ index: pts.length, over: (s & 1) === 1 });
      pts.push(pos[c]);
      const out = opp(s);
      const e = edgeId[c][out];
      const forward = edgeEnds[e][0][0] === c && edgeEnds[e][0][1] === out;
      // draw through the middle layout point only: the others shape the layout but make curves wiggly
      pts.push(pos[sub(e, Math.floor(K / 2))]);
      void forward;
    }
    return { pts, marks };
  }

  const api = { r2up, r3, localSimplify, fromBraid, simplify, reduceAll, isValid, jonesFromDiagram, toPD, layout, faces, traverse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KnotDiagram = api;
})(typeof self !== 'undefined' ? self : this);
