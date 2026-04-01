# How to work on this codebase (developer handoff)

## Disclosure

This project is **fully AI-generated / AI-assisted**. Nothing here should be assumed correct for security, compliance, or production behavior without **human review**, **tests**, and **operational validation** on real hosts and data.

Use this document as a **response template** when another developer (or future you) asks how the repo works and what to watch for.

---

## What you are looking at

| Piece | Role |
|--------|------|
| `analyzer-core.mjs` | Shared analysis: fetch HTML (axios), Cheerio parsing, LHS grouping, common sections, form heuristics, redirect/final URL, report text builder. |
| `analyze-urls.mjs` | CLI entry: same ideas as the core, writes `report.txt` (or `-o`). Keep behavior aligned with `analyzer-core.mjs` when you change rules. |
| `server.mjs` | Express: `/api/analyze`, `/api/extract-assets`, static `migration-analyzer-ui/dist`, writes `report.txt` on analyze. |
| `asset-extractor.mjs` | Path filtering and HTML import handling for File Extractor. |
| `migration-analyzer-ui/` | React UI: Migration (URLs + full report only), File Extractor, theme, wait mini-game. |

---

## How to run locally

1. **Root:** `npm install`
2. **UI:** `cd migration-analyzer-ui && npm install`
3. **API:** `npm run server` → listens on `http://localhost:3001` (or `PORT`)
4. **Dev UI:** `cd migration-analyzer-ui && npm run dev` → Vite proxies `/api` to `localhost:3001` (see `vite.config.js`)

If port **3001** is busy, set `PORT=3002 npm run server` and point the Vite proxy at that port.

---

## User-visible outputs

- **Full Report** (Migration tab / `report` in JSON / `report.txt`): grouped by template and scroll/common bucket; then sections such as **Form pages**, **Redirected pages**, **404 pages**, and other failures—**not** a separate structured table in the UI (that was removed on purpose).
- **File Extractor:** filtered CSS/JS/images per rules in `asset-extractor.mjs`.

---

## Changing behavior safely

1. **Analyzer rules** (LHS, sections, forms, redirects): edit `analyzer-core.mjs`; mirror critical logic in `analyze-urls.mjs` if the CLI must stay consistent.
2. **API contract:** `server.mjs` returns `results` + `report`; the UI still stores `results` for HTTP 403/404 banners—changing shapes may require `App.jsx` updates.
3. **Asset rules:** `asset-extractor.mjs` + `FileExtractor.jsx` copy should stay in sync conceptually.

---

## Limitations (do not “fix” only in the UI)

- **Fetched HTML only:** no browser; no JavaScript execution. Client-rendered-only forms may be invisible.
- **Form detection** is heuristic (`<form>`, iframe URLs, raw HTML patterns). False negatives/positives are possible.
- **Remote failures:** HTTP **403**, timeouts, and bot blocking are environment-dependent; retries and headers help but do not guarantee access.
- **Redirects / 404:** Final URL comes from the HTTP client’s response URL; edge cases (meta refresh, JS redirects) are not modeled.

---

## Suggested workflow for changes

1. Reproduce with **CLI** (`analyze-urls.mjs`) on a **small URL set**.
2. Compare `report.txt` before/after.
3. Run the **UI** against the same API and confirm Migration + File Extractor.
4. If you change dependencies or scripts, update **README.md** and this file.

---

## When replying to another developer

You can paste or adapt the following:

> This repo is largely **AI-generated**. The migration flow is: Express (`server.mjs`) calls `analyzeUrls` from `analyzer-core.mjs`, which fetches pages and builds a text `report` plus per-URL `results`. The React app calls `/api/analyze` and shows **Full Report** only (no structured results table). There is a separate **File Extractor** backed by `asset-extractor.mjs`. Please read `README.md` for run commands and `HOW_TO_WORK.md` for architecture and caveats. **Review and test** before relying on output for production migration decisions.
