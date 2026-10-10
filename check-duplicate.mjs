// Check a duplicate flag and reply with the evidence.
// Run by .github/workflows/check-duplicate.yml. Locally:
//   node scripts/check-duplicate.mjs --text "Knot: 6  Duplicate of: 8"
// Writes comment.md.
import { writeFileSync } from 'node:fs';
import { L, loadArchive, siteUrl } from './lib.mjs';

const args = process.argv.slice(2);
const i = args.indexOf('--text');
const body = i >= 0 ? args[i + 1] : (process.env.ISSUE_BODY || '');

const archive = loadArchive();
const { byId } = L.indexArchive(archive);
const site = siteUrl();
const link = k => `[${L.label(k)}](${site}/knot.html?id=${k.id})`;

// The issue form puts each answer under its own "### " heading.
const section = name => { const m = body.match(new RegExp('###\\s*' + name + '[^\\n]*\\n+([\\s\\S]*?)(?=\\n###|$)', 'i')); return m ? m[1] : ''; };
const nums = s => (s.match(/\d+/g) || []).map(Number);
let first = nums(section('Knot')).concat(), second = nums(section('Possible duplicate of'));
if (!first.length) { const all = nums(body); first = all.slice(0, 1); second = all.slice(1, 2); }

const out = [];
const k = byId.get(first[0]);
if (!k) {
  out.push('### I couldn’t find that knot', '', 'Please give the knot’s number (the **#** number on its card), for example `#22`.');
} else {
  const pairs = second.filter(id => id !== k.id).map(id => byId.get(id)).filter(Boolean);
  const results = pairs.length ? pairs.map(o => L.compareKnots(k, o)) : [L.duplicateReport(archive, k).closest];
  for (const c of results) {
    const head = c.verdict === 'different' ? `### ✅ Not a duplicate: ${link(c.a)} ≠ ${link(c.b)}`
      : c.verdict === 'same' ? `### ⚠️ Same knot: ${link(c.a)} = ${link(c.b)}`
      : `### ❓ Possible duplicate: ${link(c.a)} and ${link(c.b)} agree on every invariant`;
    out.push(head, '');
    if (!pairs.length && c.verdict === 'different') out.push(`${link(c.a)} differs from every other knot in the archive. Its closest look-alike is ${link(c.b)}:`, '');
    const ordered = c.verdict === 'different' ? c.ev.filter(e => !e.same).concat(c.ev.filter(e => e.same)) : c.ev;
    for (const e of ordered) out.push(`- ${e.same ? '=' : '≠'} ${e.text}${e.detail ? '\n  `' + e.detail + '`' : ''}`);
    out.push('');
    if (c.verdict === 'same') out.push('A maintainer should merge these two entries.', '');
    if (c.verdict === 'possible') out.push('Nothing computed here settles it. A maintainer will take a look.', '');
  }
  if (results.every(c => c.verdict === 'different')) out.push('One invariant that differs is proof of two different knots, so this flag can be closed.');
}
out.push('', '<sub>Checked automatically with the archive’s own invariants.</sub>');
writeFileSync('comment.md', out.join('\n'));
console.log(out.join('\n'));
