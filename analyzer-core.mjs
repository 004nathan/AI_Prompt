import axios from "axios";
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

const httpClient = axios.create({
  httpAgent,
  httpsAgent,
  maxRedirects: 10,
  validateStatus: () => true,
});

function stableHash(input) {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function normalizeClassList(classAttr) {
  if (!classAttr) return "";
  return String(classAttr)
    .split(/\s+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .sort()
    .join(".");
}

function nodeSignature(
  $,
  el,
  { maxDepth = 4, maxChildren = 20, includeId = true, includeClass = true } = {},
  depth = 0,
) {
  if (!el || depth > maxDepth) return "";
  if (el.type === "text") {
    const t = (el.data ?? "").replace(/\s+/g, " ").trim();
    return t ? "t" : "";
  }
  if (el.type !== "tag") return "";

  const tag = el.tagName?.toLowerCase?.() ?? el.name?.toLowerCase?.() ?? "tag";
  const classSig = includeClass ? normalizeClassList($(el).attr("class")) : "";
  const id = includeId ? $(el).attr("id") : null;
  const self = `${tag}${id ? `#${id}` : ""}${classSig ? `.${classSig}` : ""}`;

  const kids = $(el).contents().toArray().slice(0, maxChildren);
  const childSigs = [];
  for (const k of kids) {
    const s = nodeSignature($, k, { maxDepth, maxChildren, includeId, includeClass }, depth + 1);
    if (s) childSigs.push(s);
  }

  return childSigs.length ? `${self}(${childSigs.join(",")})` : self;
}

function elementFingerprint($, el, { includeText = true, includeId = true, includeClass = true } = {}) {
  const structure = nodeSignature($, el, { includeId, includeClass });
  if (!includeText) return stableHash(structure);

  const text = $(el).text().replace(/\s+/g, " ").trim().toLowerCase();
  const textSnippet = text.slice(0, 200);
  return stableHash(`${structure}||${textSnippet}`);
}

const DEFAULT_UAS = [
  // A few realistic desktop UAs; rotate to reduce simplistic bot blocks.
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

function pickUserAgent(i = 0) {
  return DEFAULT_UAS[i % DEFAULT_UAS.length];
}

function originFromUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

async function fetchHtml(url, timeoutMs, { headers = {}, cookie = "", attempt = 0 } = {}) {
  const origin = originFromUrl(url);
  const reqHeaders = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "upgrade-insecure-requests": "1",
    "user-agent": pickUserAgent(attempt),
    ...(origin ? { referer: `${origin}/` } : {}),
    ...(cookie ? { cookie } : {}),
    ...headers,
  };

  const res = await httpClient.get(url, {
    timeout: timeoutMs,
    headers: reqHeaders,
    responseType: "text",
  });

  if (res.status >= 200 && res.status < 300) return String(res.data);
  throw new Error(`HTTP ${res.status}`);
}

function findLhsTreeElement($) {
  // Accept: lhs-tree, lhs-Tree, lhs_tree (case-insensitive).
  // Intentionally does NOT match "lhsTree" (no separator) unless you extend the regex.
  return $("[class]")
    .filter((_, el) => {
      const cls = ($(el).attr("class") ?? "").toString();
      return /(^|\s)lhs[-_]?tree(\s|$)/i.test(cls);
    })
    .first();
}

function analyzeHtml(html) {
  const $ = cheerio.load(html);

  const lhsTreeEl = findLhsTreeElement($);
  const hasLhsTree = lhsTreeEl.length > 0;
  const lhsSignature = hasLhsTree
    ? elementFingerprint($, lhsTreeEl.get(0), {
        includeText: false,
        includeId: false,
        includeClass: false,
      })
    : null;

  const sections = $("section").toArray();
  const sectionFingerprints = sections.map((sec) => elementFingerprint($, sec));
  const totalSections = sections.length;

  let scrollPosition = null;
  const scrollEl = $("#scroll").first();
  if (scrollEl.length > 0) {
    const scrollNode = scrollEl.get(0);
    const idx = sections.findIndex((sec) => sec === scrollNode || $(sec).find(scrollEl).length > 0);
    scrollPosition = idx >= 0 ? idx + 1 : null;
  }

  return { hasLhsTree, lhsSignature, scrollPosition, totalSections, sectionFingerprints };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  const executing = new Set();

  async function runOne(item, idx) {
    results[idx] = await mapper(item, idx);
  }

  for (let i = 0; i < items.length; i += 1) {
    const p = Promise.resolve()
      .then(() => runOne(items[i], i))
      .finally(() => executing.delete(p));
    executing.add(p);
    if (executing.size >= limit) await Promise.race(executing);
  }

  await Promise.all(executing);
  return results;
}

function sortTemplateType(a, b) {
  if (a === "NO_LHS" && b !== "NO_LHS") return 1;
  if (b === "NO_LHS" && a !== "NO_LHS") return -1;
  const an = /^LHS(\d+)$/.exec(a)?.[1];
  const bn = /^LHS(\d+)$/.exec(b)?.[1];
  if (an && bn) return Number(an) - Number(bn);
  return String(a).localeCompare(String(b));
}

function templateDisplayName(templateType) {
  if (templateType === "NO_LHS") return "No LHS";
  const n = /^LHS(\d+)$/.exec(templateType)?.[1];
  if (n) return `LHS ${n}`;
  return templateType;
}

function buildGroupedReport(okResults, failedResults) {
  const byTemplate = new Map();
  for (const r of okResults) {
    const tpl = r.template_type;
    const key = `scroll_posiition ${r.scroll_position ?? "null"}, common_sections ${r.common_sections ?? "null"}`;
    if (!byTemplate.has(tpl)) byTemplate.set(tpl, new Map());
    const buckets = byTemplate.get(tpl);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r.url);
  }

  const lines = [];
  const templates = [...byTemplate.keys()].sort(sortTemplateType);
  if (!templates.length) {
    lines.push("No successful pages to group.");
    lines.push("");
  } else {
    for (const tpl of templates) {
      lines.push(templateDisplayName(tpl));
      lines.push("");

      const buckets = byTemplate.get(tpl);
      const bucketKeys = [...buckets.keys()].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      );

      for (const k of bucketKeys) {
        lines.push(k);
        lines.push("");
        const urls = buckets.get(k).slice().sort();
        for (const u of urls) lines.push(u);
        lines.push("");
        lines.push("");
      }

      lines.push("");
    }
  }

  if (failedResults?.length) {
    lines.push("Failed fetch/parse");
    lines.push("");
    for (const r of failedResults.slice().sort((a, b) => a.url.localeCompare(b.url))) {
      lines.push(`${r.url}  (${r.error})`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export async function analyzeUrls(urls, options = {}) {
  const {
    concurrency = 10,
    timeoutMs = 30000,
    commonMinPages = 2,
    headers = {},
    cookie = "",
    retries = 2,
  } = options;

  const loaded = await mapLimit(urls, concurrency, async (url) => {
    try {
      let html;
      let lastErr;
      const maxAttempts = Math.max(1, Number(retries) || 0) + 1;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          html = await fetchHtml(url, timeoutMs, { headers, cookie, attempt });
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          const msg = e instanceof Error ? e.message : String(e);
          // Retry on common temporary/blocked responses.
          if (!/HTTP (403|429|500|502|503|504)/.test(msg)) break;
        }
      }
      if (!html) throw lastErr ?? new Error("Fetch failed");
      const { hasLhsTree, lhsSignature, scrollPosition, totalSections, sectionFingerprints } =
        analyzeHtml(html);
      return { url, hasLhsTree, lhsSignature, scrollPosition, totalSections, sectionFingerprints };
    } catch (e) {
      return {
        url,
        hasLhsTree: null,
        lhsSignature: null,
        scrollPosition: null,
        totalSections: null,
        sectionFingerprints: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

  const ok = loaded.filter((r) => !r?.error && r?.sectionFingerprints);
  const failed = loaded.filter((r) => r?.error);

  const fingerprintToPageCount = new Map();
  for (const r of ok) {
    const uniqueInPage = new Set(r.sectionFingerprints);
    for (const fp of uniqueInPage) {
      fingerprintToPageCount.set(fp, (fingerprintToPageCount.get(fp) ?? 0) + 1);
    }
  }

  const minPages = Math.max(2, Number(commonMinPages) || 2);
  const commonSet = new Set(
    [...fingerprintToPageCount.entries()]
      .filter(([, pageCount]) => pageCount >= minPages)
      .map(([fp]) => fp),
  );

  const lhsSigToGroup = new Map();
  let lhsGroupCounter = 0;
  function lhsGroupName(lhsSig) {
    if (!lhsSig) return null;
    if (!lhsSigToGroup.has(lhsSig)) {
      lhsGroupCounter += 1;
      lhsSigToGroup.set(lhsSig, `LHS${lhsGroupCounter}`);
    }
    return lhsSigToGroup.get(lhsSig);
  }

  const results = loaded.map((r) => {
    if (r?.error) {
      return {
        url: r.url,
        template_type: null,
        scroll_position: null,
        total_sections: null,
        common_sections: null,
        error: r.error,
      };
    }

    const template_type = r.hasLhsTree ? lhsGroupName(r.lhsSignature) : "NO_LHS";
    const common_sections = r.sectionFingerprints.reduce(
      (acc, fp) => acc + (commonSet.has(fp) ? 1 : 0),
      0,
    );

    return {
      url: r.url,
      template_type,
      scroll_position: r.scrollPosition,
      total_sections: r.totalSections,
      common_sections,
    };
  });

  const okResults = results.filter((r) => !r?.error && r?.template_type);
  const report = buildGroupedReport(okResults, results.filter((r) => r?.error));

  return {
    results,
    okResults,
    failedResults: failed,
    report,
  };
}

