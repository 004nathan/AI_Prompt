import axios from "axios";
import * as cheerio from "cheerio";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

const httpClient = axios.create({
  httpAgent,
  httpsAgent,
  maxRedirects: 10,
  headers: {
    "user-agent": "url-template-analyzer/1.0 (+node.js; axios; cheerio)",
    accept: "text/html,application/xhtml+xml",
  },
  validateStatus: () => true,
});

function parseArgs(argv) {
  const args = {
    file: null,
    concurrency: 6,
    timeoutMs: 30000,
    commonMinPages: 2,
    outPath: "report.txt",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--file" || a === "-f") args.file = argv[i + 1];
    if (a === "--concurrency" || a === "-c") args.concurrency = Number(argv[i + 1]);
    if (a === "--timeout" || a === "-t") args.timeoutMs = Number(argv[i + 1]);
    if (a === "--common-min-pages") args.commonMinPages = Number(argv[i + 1]);
    if (a === "--out" || a === "-o") args.outPath = argv[i + 1];
  }

  if (!Number.isFinite(args.concurrency) || args.concurrency <= 0) args.concurrency = 6;
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) args.timeoutMs = 30000;
  if (!Number.isFinite(args.commonMinPages) || args.commonMinPages < 2) args.commonMinPages = 2;
  return args;
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
  // template_type -> bucket(scroll/common) -> urls[]
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

async function readUrlsFromFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
}

async function fetchHtml(url, timeoutMs) {
  const res = await httpClient.get(url, { timeout: timeoutMs });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}`);
  }
  return String(res.data);
}

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
  // “Similar structure or content”: combine DOM structure with a small amount of normalized text.
  const structure = nodeSignature($, el, { includeId, includeClass });
  if (!includeText) return stableHash(structure);

  const text = $(el).text().replace(/\s+/g, " ").trim().toLowerCase();
  const textSnippet = text.slice(0, 200);
  return stableHash(`${structure}||${textSnippet}`);
}

function sectionHasCommonMarkers($, secNode) {
  const $sec = $(secNode);
  if ($sec.is(".btmBar, #btmBar, .customers, #customers")) return true;
  return $sec.find(".btmBar, #btmBar, .customers, #customers").length > 0;
}

function analyzeHtml(html) {
  const $ = cheerio.load(html);

  const lhsTreeEl = $("[class]")
    .filter((_, el) => {
      const cls = ($(el).attr("class") ?? "").toString();
      return /(^|\s)lhs[-_]?tree(\s|$)/i.test(cls);
    })
    .first();
  const hasLhsTree = lhsTreeEl.length > 0;
  // LHS templates should group by nav *structure*, not by changing link text/counts.
  const lhsSignature = hasLhsTree
    ? elementFingerprint($, lhsTreeEl.get(0), {
        includeText: false,
        includeId: false,
        includeClass: false,
      })
    : null;

  const sections = $("section").toArray();
  const sectionFingerprints = sections.map((sec) =>
    sectionHasCommonMarkers($, sec) ? elementFingerprint($, sec) : null,
  );
  const totalSections = sections.length;

  let scrollPosition = null;
  const scrollEl = $("#scroll").first();
  if (scrollEl.length > 0) {
    const scrollNode = scrollEl.get(0);
    const idx = sections.findIndex((sec) => sec === scrollNode || $(sec).find(scrollEl).length > 0);
    scrollPosition = idx >= 0 ? idx + 1 : null; // 1-based
  }

  return { hasLhsTree, lhsSignature, scrollPosition, totalSections, sectionFingerprints };
}

async function mapLimit(items, limit, mapper) {
  // Concurrency-limited Promise.all pattern (efficient for 1000+ URLs).
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

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

function printGroup(title, rows) {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  for (const r of rows) {
    console.log(
      JSON.stringify(
        {
          url: r.url,
          template_type: r.template_type,
          scroll_position: r.scroll_position,
          total_sections: r.total_sections,
          common_sections: r.common_sections,
          ...(r.error ? { error: r.error } : {}),
        },
        null,
        2,
      ),
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const cliUrls = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("-") && !a.match(/^\d+$/))
    .filter((a) => a !== args.file);

  const urls =
    args.file ? await readUrlsFromFile(args.file) : cliUrls;

  if (!urls.length) {
    console.error(
      [
        "No URLs provided.",
        "",
        "Examples:",
        "  node analyze-urls.mjs --file urls.txt",
        "  node analyze-urls.mjs https://example.com/page1 https://example.com/page2",
        "",
        "Options:",
        "  --concurrency, -c <n>",
        "  --timeout, -t <ms>",
        "  --common-min-pages <n>   (default 2)",
      ].join("\n"),
    );
    process.exitCode = 2;
    return;
  }

  // Step 1: load all pages + collect section fingerprints + lhs signature
  const loaded = await mapLimit(urls, args.concurrency, async (url) => {
    try {
      const html = await fetchHtml(url, args.timeoutMs);
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

  // Step 2: identify "common sections" across pages
  // We count in how many distinct pages each fingerprint appears.
  const fingerprintToPageCount = new Map();
  for (const r of ok) {
    const uniqueInPage = new Set(r.sectionFingerprints.filter((fp) => fp != null));
    for (const fp of uniqueInPage) {
      fingerprintToPageCount.set(fp, (fingerprintToPageCount.get(fp) ?? 0) + 1);
    }
  }
  const commonSet = new Set(
    [...fingerprintToPageCount.entries()]
      .filter(([, pageCount]) => pageCount >= args.commonMinPages)
      .map(([fp]) => fp),
  );

  // Step 3: assign template groups (LHS1/LHS2/...) based on lhs signature
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
      (acc, fp) => acc + (fp != null && commonSet.has(fp) ? 1 : 0),
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
  const lhs = okResults.filter((r) => r.template_type !== "NO_LHS");
  const noLhs = okResults.filter((r) => r.template_type === "NO_LHS");
  const failedResults = results.filter((r) => r?.error);

  printGroup("LHS pages", lhs);
  printGroup("NO_LHS pages", noLhs);
  if (failedResults.length) printGroup("Failed fetch/parse", failedResults);

  const report = buildGroupedReport(okResults, failedResults);
  await writeFile(args.outPath, report, "utf8");
  console.log(`\nWrote grouped report to: ${args.outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

