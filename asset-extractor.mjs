/**
 * File / asset path extraction — product name, patterns, filtered CSS/JS/images from HTML.
 */
import axios from "axios";
import * as cheerio from "cheerio";
import { httpAgent, pickHttpsAgentForUrl } from "./http-agents.mjs";

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)(\?|$)/i;

/**
 * @param {string} pathOrUrl
 * @returns {string} path without query string
 */
export function stripQueryAndNormalizePath(pathOrUrl) {
  if (!pathOrUrl) return "";
  const s = String(pathOrUrl).trim();
  if (s.startsWith("http://") || s.startsWith("https://")) {
    try {
      return new URL(s).pathname;
    } catch {
      return s.split("?")[0];
    }
  }
  return s.split("?")[0];
}

/**
 * Extract product slug from .../products/desktop-central/...
 * @param {string} urlString
 * @returns {string | null}
 */
export function extractProductName(urlString) {
  try {
    const u = new URL(urlString);
    const m = u.pathname.match(/\/products\/([^/]+)\//);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Pattern templates (% = bundle or file placeholder).
 * Images use /sites/meweb/images/{product}/ only.
 * @param {string} productName
 */
export function buildPatternPaths(productName) {
  if (!productName) return null;
  return {
    css: `/sites/meweb/css/node/${productName}/%-en.css`,
    js: `/sites/meweb/js/node/${productName}/%-en.js`,
    images: `/sites/meweb/images/${productName}/%`,
  };
}

function classifyPath(pathname) {
  const q = pathname.split("?")[0].toLowerCase();
  if (q.endsWith(".css")) return "css";
  if (q.endsWith(".js")) return "js";
  if (IMG_EXT.test(q)) return "images";
  return null;
}

/**
 * Keep only CSS/JS paths that include /node/; images under /sites/meweb/images only.
 * All paths normalized (no query string).
 * @param {{ css: string[], js: string[], images: string[] }} discovered
 */
export function filterDiscoveredForOutput(discovered) {
  const uniqSort = (arr) => [...new Set(arr)].sort();

  const css = uniqSort(
    (discovered.css || [])
      .map(stripQueryAndNormalizePath)
      .filter((p) => p && p.toLowerCase().includes("/node/")),
  );
  const js = uniqSort(
    (discovered.js || [])
      .map(stripQueryAndNormalizePath)
      .filter((p) => p && p.toLowerCase().includes("/node/")),
  );
  const images = uniqSort(
    (discovered.images || [])
      .map(stripQueryAndNormalizePath)
      .filter((p) => p && p.startsWith("/sites/meweb/images")),
  );

  return { css, js, images };
}

/**
 * @param {import("cheerio").CheerioAPI} $
 * @param {string} baseUrl
 */
export function extractAssetsFromHtml($, baseUrl) {
  const css = new Set();
  const js = new Set();
  const images = new Set();

  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return { css: [], js: [], images: [] };
  }

  const add = (raw) => {
    if (!raw || raw.startsWith("data:") || raw.startsWith("javascript:")) return;
    try {
      const u = new URL(raw, base);
      const pathOnly = u.pathname;
      const kind = classifyPath(pathOnly);
      if (kind === "css") css.add(pathOnly);
      else if (kind === "js") js.add(pathOnly);
      else if (kind === "images") images.add(pathOnly);
    } catch {
      /* ignore */
    }
  };

  $('link[rel="stylesheet"], link[rel="preload"][as="style"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) add(href);
  });

  $("script[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src) add(src);
  });

  $("img[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src) add(src);
  });

  $('source[srcset]').each((_, el) => {
    const srcset = $(el).attr("srcset");
    if (!srcset) return;
    for (const part of srcset.split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (url) add(url);
    }
  });

  const raw = {
    css: [...css].sort(),
    js: [...js].sort(),
    images: [...images].sort(),
  };
  return filterDiscoveredForOutput(raw);
}

async function fetchHtml(url, timeoutMs = 30000) {
  const res = await axios.get(url, {
    httpAgent,
    httpsAgent: pickHttpsAgentForUrl(url),
    timeout: timeoutMs,
    maxRedirects: 10,
    headers: {
      "user-agent": "MigrationAnalyzer-FileExtractor/1.0 (+axios)",
      accept: "text/html,application/xhtml+xml",
    },
    validateStatus: () => true,
    responseType: "text",
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}`);
  }
  return String(res.data);
}

/**
 * @param {string} html
 * @param {string} baseUrl used for resolving relative URLs and product name
 * @param {{ label?: string }} [meta]
 */
export function extractAssetsFromHtmlString(html, baseUrl, meta = {}) {
  const productName = extractProductName(baseUrl);
  const patterns = buildPatternPaths(productName);
  const $ = cheerio.load(html);
  const discovered = extractAssetsFromHtml($, baseUrl);
  return {
    url: meta.label || baseUrl,
    productName,
    patterns,
    discovered,
    error: null,
  };
}

/**
 * @param {string} pageUrl
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function extractAssetsForUrl(pageUrl, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const productName = extractProductName(pageUrl);
  const patterns = buildPatternPaths(productName);

  try {
    const html = await fetchHtml(pageUrl, timeoutMs);
    const $ = cheerio.load(html);
    const discovered = extractAssetsFromHtml($, pageUrl);

    return {
      url: pageUrl,
      productName,
      patterns,
      discovered,
      error: null,
    };
  } catch (e) {
    return {
      url: pageUrl,
      productName,
      patterns,
      discovered: { css: [], js: [], images: [] },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * @param {string[]} urls
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function extractAssetsBatch(urls, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const cleaned = urls
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter(Boolean)
    .slice(0, 200);

  return Promise.all(cleaned.map((u) => extractAssetsForUrl(u, { timeoutMs })));
}

/**
 * @param {Array<{ html: string, baseUrl: string, name?: string }>} imports
 */
export function extractAssetsFromHtmlImports(imports) {
  return imports.map((item) => {
    const html = typeof item.html === "string" ? item.html : "";
    const baseUrl = typeof item.baseUrl === "string" ? item.baseUrl.trim() : "";
    if (!html || !baseUrl) {
      return {
        url: item.name || "(invalid)",
        productName: null,
        patterns: null,
        discovered: { css: [], js: [], images: [] },
        error: "Each import requires html and baseUrl",
      };
    }
    try {
      // validate base URL
      new URL(baseUrl);
    } catch {
      return {
        url: item.name || baseUrl,
        productName: null,
        patterns: null,
        discovered: { css: [], js: [], images: [] },
        error: "Invalid base URL",
      };
    }
    try {
      return extractAssetsFromHtmlString(html, baseUrl, { label: item.name || baseUrl });
    } catch (e) {
      return {
        url: item.name || baseUrl,
        productName: extractProductName(baseUrl),
        patterns: buildPatternPaths(extractProductName(baseUrl)),
        discovered: { css: [], js: [], images: [] },
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
}
