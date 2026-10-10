# Knot Archive

A community-built table of knots. Volunteers' browsers search for new knots, GitHub Actions verify every result, and the site on GitHub Pages shows the archive 50 knots per page. Anyone can write about a knot or flag two knots that look the same.

No server, database or hosting bill: everything runs on GitHub.

## How it works

1. **Search.** Every *index* (0, 1, 2, …) stands for one braid, in a fixed order that's identical on every computer. Indexes are grouped into blocks of 1,000. On the Contribute page a volunteer picks how many blocks to run (1, 3, 5 or 10), and the page hands out the next open ones in order. For every index the browser closes the braid into a loop and computes its **fingerprint**: the Jones and Alexander polynomials, with mirror images counted as the same knot. A fingerprint the archive hasn't seen is a new knot.
2. **Submit.** When the run finishes, the page opens one filled-in GitHub issue for all of its blocks. The results are short: per block, the indexes of new fingerprints plus a SHA-256 fingerprint of each 100-index chunk.
3. **Verify.** A GitHub Action re-runs each block with the same code. Each block whose chunks all match is accepted and adds one to the **global block count**. New knots go into `data/knots.json`, credited to the volunteer. Each new knot's braid is turned into a diagram and simplified with Reidemeister moves until it has as few crossings as the search can find. Blocks someone else verified first are skipped, and a block that doesn't match is rejected without affecting the others in the same submission.
4. **Publish.** The site redeploys, and the bot replies on the issue with links to the new knots.

### Which blocks a volunteer gets

`data/blocks.json` keeps the global block count and the next open block. The Contribute page starts there and skips any block that is already verified, waiting in an open submission issue, or was submitted from the same browser in the last three days. There's no way to pick an old block by hand.

Without a server, two volunteers who press Start at the same moment can still get the same blocks: a block only shows up as taken once its results are submitted. The page re-checks open submissions when you press Start, which narrows the window, and the verifier simply skips the second copy.

Two knots with any different invariant are mathematically guaranteed to be different. So the archive can't contain true duplicates; the risk is the reverse, two different knots sharing a fingerprint. That doesn't happen at the sizes searched so far, but will around 11+ crossings. The duplicate-flag check and the review queue exist for that.

## Run it on your computer

The pages load data with `fetch`, so open them through a local web server rather than by double-clicking:

```sh
npm run serve        # or: python3 -m http.server 8080
```

then visit <http://localhost:8080>. To get GitHub links while testing locally, set `repo` in `assets/js/config.js`.

Useful scripts (Node 20 or newer; there is nothing to install):

| Command | What it does |
| --- | --- |
| `npm test` | Checks the engine against known knots and validates every file in `data/`. |
| `node scripts/seed.mjs 15-19 --by your-name` | Runs blocks 15–19 locally and adds them to the archive, without volunteers. |
| `node scripts/verify-submission.mjs --file issue.md --author name` | Verifies a submission the way the Action does. |
| `node scripts/check-duplicate.mjs --text "#22 #6"` | Prints the duplicate verdict for two knots. |

## What's in the repository

```
index.html, knot.html, contribute.html, review.html   the four pages
assets/js/engine.js      braid enumeration, Jones and Alexander polynomials
assets/js/diagram.js     braid → planar diagram, Reidemeister simplification, layout
assets/js/knotlib.js     names, crossing-number bounds, drawings, duplicate check
assets/js/worker.js      the volunteer search, one per CPU core
assets/js/site.js        shared page code; archive.js, knot.js, contribute.js, review.js
data/knots.json          the archive, one knot per line
data/blocks.json         global block count, next open block, and every verified block
data/drawings/<id>.json  each knot's drawing (path data, coloured by the page)
data/descriptions/<id>.md  community-written descriptions
scripts/                 seeding, verification, duplicate check, tests
.github/workflows/       verify submissions, check duplicate flags, test, deploy, setup
```

The engine files are shared by the browser and the Actions, so a knot is computed identically everywhere.

### A knot record

```json
{"id":5, "key":"2,-3,2|-6:-1,1,-1,2,-1,1", "name":{"name":"5₂","confirmed":true}, "nickname":"Three-twist knot",
 "crossings":{"lower":5,"upper":5}, "braid":[1,1,1,2,-1,2], "strands":3, "pd":[[1,9,2,8], …], "diagramCrossings":5,
 "alexander":[2,-3,2], "jones":{"min":-6,"coeffs":[-1,1,-1,2,-1,1]}, "chiral":true,
 "discoveredAtIndex":8, "discoveredBy":null, "block":0, "hits":638}
```

- `key` is the fingerprint: Alexander coefficients, then the Jones polynomial (lowest power and coefficients), choosing the mirror image's version when it sorts first.
- `crossings.lower` is the span of the Jones polynomial, a proven lower bound. `upper` is the fewest crossings of any diagram or braid found. When they meet, the crossing number is exact.
- `name` is a Rolfsen-table name, `confirmed` when the Alexander polynomial matches and the knot provably has 7 or fewer crossings.
- `pd` is the simplest diagram as a PD code (KnotTheory convention).

### data/blocks.json

```json
{ "count": 25, "next": 25, "blocks": [
  {"seq":16, "block":15, "start":15000, "end":15999, "status":"verified", "by":"alice", "issue":30, "mode":"full", "newKnots":[], "chunkHashes":["…"], "verifiedAt":"…"} ] }
```

- `count` is the global block count: how many blocks have been verified. It goes up by one for every accepted block.
- `next` is the lowest block number not yet verified, where the Contribute page starts handing out blocks.
- `seq` is the global count at the moment that block was accepted, so every upload gets its own number.

### A submission

The Contribute page puts this in the issue (compact, so 10 blocks still fit in one link):

```json
{"v":3, "engine":"braid-closure-v1", "blocks":[{"b":15, "h":"<10 chunk fingerprints of 16 hex characters, joined>", "n":[15212], "s":[[36,15333]]}], "secs":17, "cores":4}
```

`b` is the block, `h` the chunk fingerprints, `n` the indexes of new fingerprints, `s` pairs of [knot id, index of a shorter braid for that knot]. The verifier also accepts the older single-block format.

## Looking after the archive

- **Description edits** arrive as pull requests that only touch `data/descriptions/`. The Test workflow checks them. Read them and merge.
- **Duplicate flags** get an automatic reply. Close a flag when the reply proves the knots different. If it ever says *Same knot*, merge the entries by hand: keep the lower-numbered one in `knots.json`, move the other's description over, and add a note to the issue.
- **Verification cost.** By default each block is re-run in full, which takes a few seconds per block today (a 10-block submission about half a minute). When blocks get slow, set a repository variable `KNOT_VERIFY_MODE` to `audit` (Settings → Secrets and variables → Actions → Variables). The check then re-runs two random chunks plus every index the volunteer claims. Someone who skipped work gets caught with high probability over a few blocks.
- **Resetting the archive.** To go back to the starting 65 knots: delete `data/knots.json`, `data/blocks.json` and `data/drawings/`, run `node scripts/seed.mjs 0-14`, then commit and push. Knot numbers come out the same, so the descriptions still match. For a completely empty archive, set `data/knots.json` to `{"format":"knot-archive/2","engine":"braid-closure-v1","blockSize":1000,"chunkSize":100,"updated":null,"knots":[]}` and `data/blocks.json` to `{"count":0,"next":0,"blocks":[]}`, and delete `data/drawings/` and the files in `data/descriptions/`.
- **Changing the engine.** Index numbers depend on the enumeration in `engine.js`. If you change it, bump `ENGINE_VERSION` and start a new archive: old results describe different braids.

## Known limits

- **Skipping ahead is linear.** To reach index *n*, a worker walks past every earlier candidate using the cheap filters. That's fine for the first few hundred thousand indexes; beyond that, workers should start from saved positions in the enumeration.
- **The Jones polynomial is computed by brute force,** 2 to the power of the braid length. Braids up to about 20 crossings are practical.
- **One archive file.** `knots.json` loads in full on every page. At tens of thousands of knots, split it into pages.
- **Submitting needs a GitHub account.** That's what gives credit and stops spam.

## License

Copyright 2026 Dannyboi91010

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
