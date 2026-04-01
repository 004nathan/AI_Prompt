# Migration Analyzer

Tooling to **analyze HTML help / product pages** for migration work: template grouping (LHS, scroll position, common sections), **form-page hints**, **redirects**, and **404** listing—plus a **File Extractor** tab for filtered asset paths from URLs or uploaded HTML.

> **Note:** This repository was produced with heavy use of AI-assisted coding. Treat behavior and security as **review-before-production**. See [`HOW_TO_WORK.md`](HOW_TO_WORK.md) for maintainers.

## What it includes

- **CLI** (`analyze-urls.mjs`): fetch URLs, analyze with Cheerio, write a grouped text report (default `report.txt`).
- **API** (`server.mjs`): `POST /api/analyze`, `POST /api/extract-assets`, serves the built UI from `migration-analyzer-ui/dist` when present.
- **Web UI** (`migration-analyzer-ui/`): Vite + React—Migration tab (URLs, full report) and File Extractor tab.

## Setup

```bash
npm install
cd migration-analyzer-ui && npm install && cd ..
```

## Run

### CLI (report file)

```bash
node analyze-urls.mjs --file urls.txt
# or
node analyze-urls.mjs https://example.com/a.html https://example.com/b.html
```

Options: `--file`, `-c` concurrency, `-t` timeout, `--common-min-pages`, `-o` report path (see `node analyze-urls.mjs` without args for help).

### Web app (development)

Terminal 1—API (default port **3001**):

```bash
npm run server
```

Terminal 2—Vite dev server (proxies `/api` to the API):

```bash
cd migration-analyzer-ui && npm run dev
```

Open the URL Vite prints (commonly `http://127.0.0.1:5173`). Use the **Migration** tab to paste URLs and read the **Full Report**; use **File Extractor** for asset paths.

### Production-style UI

```bash
npm run build:ui
npm run server
```

Then open `http://localhost:3001` (or your `PORT`).

## API (summary)

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/analyze` | `{ "urls": ["https://..."] }` |
| `POST` | `/api/extract-assets` | `{ "urls": [...] }` or `{ "htmlImports": [...] }` |

Responses include `report` (string) and `results` (per-URL rows, optional for tools/CLI); the web UI uses only the **report** text.

## Environment

- **`PORT`**: HTTP port for `server.mjs` (default `3001`).

## Maintainer docs

- [`HOW_TO_WORK.md`](HOW_TO_WORK.md) — architecture, limitations, and how to work on this codebase safely.
