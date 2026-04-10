import axios from "axios";
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { httpAgent, httpsAgentStrict, pickHttpsAgentForUrl } from "./http-agents.mjs";

const httpClient = axios.create({
  httpAgent,
  httpsAgent: httpsAgentStrict,
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

/**
 * Final URL after redirects. Prefer `request.res.responseUrl` (Node/follow-redirects);
 * `config.url` is often still the *original* request URL, not the post-redirect URL.
 */
function getFinalUrlFromResponse(res, requestedUrl) {
  const raw =
    res?.request?.res?.responseUrl ||
    res?.request?.res?.responseURL ||
    res?.request?.responseURL ||
    res?.responseURL ||
    res?.responseUrl ||
    res?.config?.url ||
    requestedUrl;
  try {
    return String(raw);
  } catch {
    return requestedUrl;
  }
}

/**
 * Canonical equality for "cosmetic" redirects (do not list under Redirected pages):
 * apex vs www, http vs https, trailing slash, /index.html, and ignore hash + query
 * (e.g. UTMs on the final URL must not count as a real redirect).
 */
function normalizeForRedirectEquivalence(href) {
  try {
    const u = new URL(href);
    u.hash = "";
    u.search = "";

    let host = u.hostname.toLowerCase();
    if (host.startsWith("www.")) {
      host = host.slice(4);
    }

    let protocol = u.protocol.toLowerCase();
    if (protocol === "http:" || protocol === "https:") {
      protocol = "https:";
    }

    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    const pl = path.toLowerCase();
    if (pl === "/index.html" || pl.endsWith("/index.html")) {
      path = path.slice(0, -"/index.html".length) || "/";
    }
    path = path || "/";

    const port = u.port;
    const hostPart = port ? `${host}:${port}` : host;
    return `${protocol}//${hostPart}${path}`;
  } catch {
    return href;
  }
}

function sameLiveDocumentUrl(a, b) {
  return normalizeForRedirectEquivalence(a) === normalizeForRedirectEquivalence(b);
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
    httpAgent,
    httpsAgent: pickHttpsAgentForUrl(url),
    timeout: timeoutMs,
    headers: reqHeaders,
    responseType: "text",
    validateStatus: () => true,
  });

  const finalUrl = getFinalUrlFromResponse(res, url);
  const redirected = !sameLiveDocumentUrl(url, finalUrl);
  const body = String(res.data ?? "");

  if (res.status >= 200 && res.status < 300) {
    return {
      html: body,
      final_url: finalUrl,
      redirected,
      http_status: res.status,
    };
  }

  const err = new Error(`HTTP ${res.status}`);
  err.final_url = finalUrl;
  err.redirected = redirected;
  err.http_status = res.status;
  throw err;
}

function httpStatusFromMessage(msg) {
  const m = /HTTP (\d{3})/.exec(String(msg ?? ""));
  return m ? Number(m[1]) : null;
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

/**
 * Only <section> elements that contain (or are) btmBar / customers markers are
 * considered for cross-page "common section" matching.
 */
function sectionHasCommonMarkers($, secNode) {
  const $sec = $(secNode);
  if ($sec.is(".btmBar, #btmBar, .customers, #customers")) return true;
  return $sec.find(".btmBar, #btmBar, .customers, #customers").length > 0;
}

/**
 * A “form page” has a native <form> and/or an iframe that typically embeds a form
 * (Zoho Creator, Google Forms, Typeform, etc.). Raw HTML checks catch edge cases where
 * the parser misses markup (fragment quirks, minification).
 */
function detectFormPageSignals($, htmlRaw = "") {
  const raw = htmlRaw || "";
  let has_native_form = $("form").length > 0;
  if (!has_native_form) {
    has_native_form = $("[data-attr='form-container'] form, [data-attr=\"form-container\"] form").length > 0;
  }
  if (!has_native_form) {
    has_native_form = $('form[action*="zoho"], form[action*="creator"], form[action*="form/"]').length > 0;
  }
  if (!has_native_form && /<\s*form\b/i.test(raw)) {
    has_native_form = true;
  }
  if (!has_native_form && /<\s*form\b[^>]{0,2000}\baction\s*=\s*["'][^"']*zoho/i.test(raw)) {
    has_native_form = true;
  }
  if (!has_native_form && /<\s*form\b[^>]{0,2000}\baction\s*=\s*["'][^"']*creatorapp\.zoho/i.test(raw)) {
    has_native_form = true;
  }

  let has_iframe_form_embed = false;
  for (const el of $("iframe[src]").toArray()) {
    const src = ($(el).attr("src") || "").toLowerCase();
    if (
      /zoho|creator|\.zoho\./i.test(src) ||
      /typeform|jotform|wufoo|formstack|123formbuilder|google\.com\/forms|\/forms\/|\/form\?|\/forms\?/i.test(
        src,
      ) ||
      /embed[^/]*form|form[^/]*embed/i.test(src)
    ) {
      has_iframe_form_embed = true;
      break;
    }
  }
  return {
    has_native_form,
    has_iframe_form_embed,
    is_form_page: has_native_form || has_iframe_form_embed,
  };
}

function analyzeHtml(html) {
  const $ = cheerio.load(html);

  const { has_native_form, has_iframe_form_embed, is_form_page } = detectFormPageSignals($, html);

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
  // Fingerprint only sections that qualify for "common" detection; others are null (excluded).
  const sectionFingerprints = sections.map((sec) =>
    sectionHasCommonMarkers($, sec) ? elementFingerprint($, sec) : null,
  );
  const totalSections = sections.length;

  let scrollPosition = null;
  const scrollEl = $("#scroll").first();
  if (scrollEl.length > 0) {
    const scrollNode = scrollEl.get(0);
    const idx = sections.findIndex((sec) => sec === scrollNode || $(sec).find(scrollEl).length > 0);
    scrollPosition = idx >= 0 ? idx + 1 : null;
  }

  return {
    hasLhsTree,
    lhsSignature,
    scrollPosition,
    totalSections,
    sectionFingerprints,
    has_native_form,
    has_iframe_form_embed,
    is_form_page,
  };
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

  const formUrls = okResults
    .filter((r) => r.is_form_page)
    .map((r) => r.url)
    .slice()
    .sort((a, b) => a.localeCompare(b));
  if (formUrls.length) {
    lines.push("Form pages");
    lines.push("");
    for (const u of formUrls) lines.push(u);
    lines.push("");
    lines.push("");
  }

  const redirectedRows = okResults
    .filter((r) => r.redirected)
    .slice()
    .sort((a, b) => a.url.localeCompare(b.url));
  if (redirectedRows.length) {
    lines.push("Redirected pages");
    lines.push("");
    for (const r of redirectedRows) {
      lines.push(`${r.url} -> ${r.final_url}`);
    }
    lines.push("");
    lines.push("");
  }

  const notFound = (failedResults ?? []).filter(
    (r) => r.http_status === 404 || /HTTP 404/.test(String(r.error || "")),
  );
  const otherFailed = (failedResults ?? []).filter(
    (r) => !(r.http_status === 404 || /HTTP 404/.test(String(r.error || ""))),
  );

  if (notFound.length) {
    lines.push("404 pages");
    lines.push("");
    for (const r of notFound.slice().sort((a, b) => a.url.localeCompare(b.url))) {
      const hop =
        r.final_url && !sameLiveDocumentUrl(r.url, r.final_url) ? ` -> ${r.final_url}` : "";
      lines.push(`${r.url}${hop}  (${r.error})`);
    }
    lines.push("");
    lines.push("");
  }

  if (otherFailed.length) {
    lines.push("Failed fetch/parse");
    lines.push("");
    for (const r of otherFailed.slice().sort((a, b) => a.url.localeCompare(b.url))) {
      const hop =
        r.final_url && !sameLiveDocumentUrl(r.url, r.final_url) ? ` -> ${r.final_url}` : "";
      lines.push(`${r.url}${hop}  (${r.error})`);
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
      let fetchResult;
      let lastErr;
      const maxAttempts = Math.max(1, Number(retries) || 0) + 1;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          fetchResult = await fetchHtml(url, timeoutMs, { headers, cookie, attempt });
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          const msg = e instanceof Error ? e.message : String(e);
          // Retry on common temporary/blocked responses.
          if (!/HTTP (403|429|500|502|503|504)/.test(msg)) break;
        }
      }
      if (!fetchResult) throw lastErr ?? new Error("Fetch failed");
      const { html, final_url, redirected, http_status } = fetchResult;
      const {
        hasLhsTree,
        lhsSignature,
        scrollPosition,
        totalSections,
        sectionFingerprints,
        has_native_form,
        has_iframe_form_embed,
        is_form_page,
      } = analyzeHtml(html);
      return {
        url,
        final_url,
        redirected,
        http_status,
        hasLhsTree,
        lhsSignature,
        scrollPosition,
        totalSections,
        sectionFingerprints,
        has_native_form,
        has_iframe_form_embed,
        is_form_page,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const st = e?.http_status ?? httpStatusFromMessage(msg);
      return {
        url,
        final_url: e?.final_url ?? null,
        redirected: e?.redirected ?? null,
        http_status: st,
        hasLhsTree: null,
        lhsSignature: null,
        scrollPosition: null,
        totalSections: null,
        sectionFingerprints: null,
        has_native_form: null,
        has_iframe_form_embed: null,
        is_form_page: null,
        error: msg,
      };
    }
  });

  const ok = loaded.filter((r) => !r?.error && r?.sectionFingerprints);
  const failed = loaded.filter((r) => r?.error);

  const fingerprintToPageCount = new Map();
  for (const r of ok) {
    const uniqueInPage = new Set(r.sectionFingerprints.filter((fp) => fp != null));
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
        final_url: r.final_url ?? null,
        redirected: r.redirected ?? null,
        http_status: r.http_status ?? null,
        template_type: null,
        scroll_position: null,
        total_sections: null,
        common_sections: null,
        is_form_page: null,
        has_native_form: null,
        has_iframe_form_embed: null,
        error: r.error,
      };
    }

    const template_type = r.hasLhsTree ? lhsGroupName(r.lhsSignature) : "NO_LHS";
    const common_sections = r.sectionFingerprints.reduce(
      (acc, fp) => acc + (fp != null && commonSet.has(fp) ? 1 : 0),
      0,
    );

    return {
      url: r.url,
      final_url: r.final_url ?? r.url,
      redirected: Boolean(r.redirected),
      http_status: r.http_status ?? 200,
      template_type,
      scroll_position: r.scrollPosition,
      total_sections: r.totalSections,
      common_sections,
      is_form_page: r.is_form_page,
      has_native_form: r.has_native_form,
      has_iframe_form_embed: r.has_iframe_form_embed,
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

