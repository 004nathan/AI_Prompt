// server.mjs
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { analyzeUrls } from "./analyzer-core.mjs";
import { extractAssetsBatch, extractAssetsFromHtmlImports } from "./asset-extractor.mjs";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "migration-analyzer-ui", "dist");

app.use(express.json({ limit: "8mb" }));
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/analyze", async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls : null;
  if (!urls || !urls.length) {
    res.status(400).json({ error: "Expected JSON body: { urls: string[] }" });
    return;
  }

  const cleaned = urls
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter(Boolean)
    .slice(0, 1000);

  try {
    const analysis = await analyzeUrls(cleaned, {
      concurrency: Number(req.body?.concurrency) || 10,
      timeoutMs: Number(req.body?.timeoutMs) || 30000,
      commonMinPages: Number(req.body?.commonMinPages) || 2,
      retries: Number(req.body?.retries) || 2,
    });

    await writeFile("report.txt", analysis.report, "utf8");

    res.json({
      results: analysis.results,
      report: analysis.report,
    });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post("/api/extract-assets", async (req, res) => {
  const htmlImports = req.body?.htmlImports;
  if (Array.isArray(htmlImports) && htmlImports.length) {
    try {
      const results = extractAssetsFromHtmlImports(htmlImports.slice(0, 50));
      res.json({ results });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return;
  }

  const urls = Array.isArray(req.body?.urls) ? req.body.urls : null;
  if (!urls || !urls.length) {
    res.status(400).json({
      error: "Expected { urls: string[] } or { htmlImports: [{ html, baseUrl, name? }] }",
    });
    return;
  }

  try {
    const results = await extractAssetsBatch(urls, {
      timeoutMs: Number(req.body?.timeoutMs) || 30000,
    });
    res.json({ results });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

// Serve built React app
app.use(express.static(distDir));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(path.join(distDir, "index.html"));
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});