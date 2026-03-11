# URL template analyzer

Analyzes a list of webpages and reports:
- whether the page uses an LHS template (presence of `.lhs-tree`)
- **LHS template grouping** (`LHS1`, `LHS2`, …) based on a **structure-only** signature of the `.lhs-tree` subtree (ignores text + IDs + classes so “active/current” highlighting doesn’t split groups)
- the **1-based** position of the `<section>` that contains `#scroll`
- total `<section>` count (includes empty sections)
- **common sections** count (sections whose “fingerprint” appears in multiple pages)

## Setup

```bash
npm install
```

## Run

### Option A: from a file

```bash
node analyze-urls.mjs --file urls.txt
```

### Option B: pass URLs directly

```bash
node analyze-urls.mjs https://example.com/page1 https://example.com/page2
```

## Options

- `--file, -f <path>`: URL list file (one URL per line; `#` comments allowed)
- `--concurrency, -c <n>`: parallel fetches (default `6`). For ~1000 URLs, start with `10`–`25` and adjust based on rate limits.
- `--timeout, -t <ms>`: per-request timeout in ms (default `30000`)
- `--common-min-pages <n>`: how many pages a section must appear in to be considered “common” (default `2`)
- `--out, -o <path>`: write a grouped text report (default `report.txt`)

