# Knot Archive

A community-built table of knots. Volunteers' browsers search for new knots, GitHub Actions verify every result, and the site on GitHub Pages shows the archive 50 knots per page. Anyone can write about a knot or flag two knots that look the same.

No server, database or hosting bill: everything runs on GitHub.

## How it works

1. **Search.** Every *index* (0, 1, 2, …) stands for one braid, in a fixed order that's identical on every computer. On the Contribute page a volunteer's browser takes a block of 1,000 indexes, closes each braid into a loop, and computes its **fingerprint**: the Jones and Alexander polynomials, with mirror images counted as the same knot. A fingerprint the archive hasn't seen is a new knot.
2. **Submit.** When the block finishes, the page opens a filled-in GitHub issue. The results are short: the new fingerprints, plus a SHA-256 fingerprint of each 100-index chunk.
3. **Verify.** A GitHub Action re-runs the block with the same code. If every chunk matches, new knots go into `data/knots.json`, credited to the volunteer. Each new knot's braid is turned into a diagram and simplified with Reidemeister moves until it has as few crossings as the search can find.
4. **Publish.** The site redeploys, and the bot replies on the issue with links to the new knots.

Two knots with any different invariant are mathematically guaranteed to be different. So the archive can't contain true duplicates; the risk is the reverse, two different knots sharing a fingerprint. That doesn't happen at the sizes searched so far, but will around 11+ crossings. The duplicate-flag check and the review queue exist for that.

## Put it on GitHub

You need a free GitHub account. About 10 minutes.

1. **Create a repository.** On GitHub, click **New repository**. Name it, for example `knot-archive`, and make it **Public** (free GitHub Pages needs that, and volunteers need to be able to open issues). Don't add a README; this project has one.
2. **Upload the files.** Either:
   - **On the website:** open the new repository, click **uploading an existing file**, and drag in *everything inside* the `knot-archive` folder, including the hidden `.github` folder. (On a Mac, press ⌘⇧. in Finder to show hidden files. On Windows, turn on *Hidden items* in File Explorer's View menu.) Commit.
   - **With git:**
     ```sh
     cd knot-archive
     git init -b main
     git add .
     git commit -m "Knot Archive"
     git remote add origin https://github.com/YOUR-NAME/knot-archive.git
     git push -u origin main
     ```
3. **Turn on Pages.** In the repository go to **Settings → Pages**, and under *Build and deployment* set **Source** to **GitHub Actions**.
4. **Let the bot write.** Go to **Settings → Actions → General**, scroll to *Workflow permissions*, choose **Read and write permissions**, and save. The verifier needs this to commit knots and reply on issues.
5. **Create the labels.** Open the **Actions** tab (click *I understand… enable them* if GitHub asks), pick **Set up repository** on the left, and press **Run workflow**.
6. **Publish.** In the same tab pick **Deploy site** and press **Run workflow**. After a minute the site is live at `https://YOUR-NAME.github.io/knot-archive/`. The page shows the address under Settings → Pages.
7. **Try it.** Open the site, go to **Contribute**, press **Start**, and submit the block when it finishes. Within a few minutes the bot replies on the issue, and the archive and the "Indexes searched" count update.

The site finds its repository from its own address, so there's nothing to configure. If you use a custom domain, set `repo` in `assets/js/config.js`.

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
data/blocks.json         which blocks are verified, by whom, with their chunk fingerprints
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

## Looking after the archive

- **Description edits** arrive as pull requests that only touch `data/descriptions/`. The Test workflow checks them. Read them and merge.
- **Duplicate flags** get an automatic reply. Close a flag when the reply proves the knots different. If it ever says *Same knot*, merge the entries by hand: keep the lower-numbered one in `knots.json`, move the other's description over, and add a note to the issue.
- **Verification cost.** By default each block is re-run in full, which takes a few seconds today. When blocks get slow, set a repository variable `KNOT_VERIFY_MODE` to `audit` (Settings → Secrets and variables → Actions → Variables). The check then re-runs two random chunks plus every index the volunteer claims. Someone who skipped work gets caught with high probability over a few blocks.
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
