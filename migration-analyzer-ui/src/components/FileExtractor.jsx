import { useEffect, useMemo, useState } from "react";

const TECH_ROUNDS = [
  {
    q: "Which HTTP status means “Not Found”?",
    options: ["200", "301", "404", "500"],
    correct: 2,
  },
  {
    q: "What does TLS mainly provide on HTTPS?",
    options: ["Compression", "Encryption in transit", "Caching", "DNS lookup"],
    correct: 1,
  },
  {
    q: "Big-O of hash map key lookup (average)?",
    options: ["O(n)", "O(log n)", "O(1)", "O(n²)"],
    correct: 2,
  },
  {
    q: "IPv4 address size in bits?",
    options: ["16", "32", "64", "128"],
    correct: 1,
  },
  {
    q: "Which base does a CSS #RRGGBB color use?",
    options: ["Base 8", "Base 10", "Base 16", "Base 64"],
    correct: 2,
  },
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomMathRound() {
  const a = 3 + Math.floor(Math.random() * 17);
  const b = 3 + Math.floor(Math.random() * 17);
  const ans = a + b;
  const opts = new Set([ans]);
  let guard = 0;
  while (opts.size < 4 && guard++ < 50) {
    const d = ans + Math.floor(Math.random() * 21) - 10;
    if (d > 0 && d !== ans) opts.add(d);
  }
  while (opts.size < 4) opts.add(ans + opts.size + 1);
  const options = shuffle([...opts]);
  return { kind: "math", prompt: `${a} + ${b}`, answer: ans, options };
}

function randomTechRound() {
  const t = TECH_ROUNDS[Math.floor(Math.random() * TECH_ROUNDS.length)];
  const idxs = shuffle([0, 1, 2, 3]);
  const options = idxs.map((i) => t.options[i]);
  const answer = options.indexOf(t.options[t.correct]);
  return { kind: "tech", prompt: t.q, answer, options };
}

function nextRound() {
  return Math.random() < 0.55 ? randomMathRound() : randomTechRound();
}

function ExtractionWaitGame({ active }) {
  const [round, setRound] = useState(null);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (!active) {
      setRound(null);
      setFeedback(null);
      return;
    }
    setRound(nextRound());
    setFeedback(null);
  }, [active]);

  if (!active || !round) return null;

  const pick = (i) => {
    const ok = round.kind === "math" ? round.options[i] === round.answer : i === round.answer;
    setFeedback(ok ? "Nice." : `Nope — ${round.kind === "math" ? round.answer : round.options[round.answer]}.`);
    window.setTimeout(() => {
      setRound(nextRound());
      setFeedback(null);
    }, ok ? 450 : 900);
  };

  return (
    <div
      style={{
        marginBottom: 20,
        padding: 16,
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--panel)",
        maxWidth: 420,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 8 }}>
        WHILE YOU WAIT — {round.kind === "math" ? "MATH" : "TECH"}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>{round.prompt}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {round.options.map((label, i) => (
          <button
            key={`${round.prompt}-${i}`}
            type="button"
            onClick={() => pick(i)}
            disabled={!!feedback}
            style={{
              padding: "10px 8px",
              borderRadius: 8,
              border: "1px solid var(--border-2)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 13,
              cursor: feedback ? "default" : "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {feedback && (
        <div style={{ marginTop: 10, fontSize: 13, color: "var(--muted)" }}>{feedback}</div>
      )}
    </div>
  );
}

const API = "/api/extract-assets";

const preStyle = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  fontFamily: "monospace",
  fontSize: 12,
  color: "var(--codeText)",
  background: "var(--codeBg)",
  padding: 10,
  borderRadius: 6,
  margin: 0,
  maxHeight: 200,
  overflow: "auto",
  border: "1px solid var(--border)",
};

function CopyButton({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      disabled={!text}
      style={{
        padding: "6px 12px",
        borderRadius: 9999,
        border: "1px solid var(--border-2)",
        background: "var(--panel)",
        color: text ? "var(--text)" : "var(--muted)",
        fontSize: 12,
        fontWeight: 500,
        cursor: text ? "pointer" : "default",
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

function GroupCard({ title, lines, accent }) {
  const text = lines.length ? lines.join("\n") : "(none)";
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--panel)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 10,
          paddingBottom: 8,
          borderBottom: `2px solid ${accent || "var(--primary)"}`,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{title}</h3>
        <CopyButton text={lines.length ? lines.join("\n") : ""} label="Copy" />
      </div>
      <pre style={{ ...preStyle, flex: 1 }}>{text}</pre>
    </div>
  );
}

export default function FileExtractor() {
  const [sourceMode, setSourceMode] = useState("urls"); // urls | html
  const [urlsInput, setUrlsInput] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);

  const merged = useMemo(() => {
    const css = new Set();
    const js = new Set();
    const images = new Set();
    for (const r of results) {
      if (!r?.discovered) continue;
      r.discovered.css?.forEach((x) => css.add(x));
      r.discovered.js?.forEach((x) => js.add(x));
      r.discovered.images?.forEach((x) => images.add(x));
    }
    return {
      css: [...css].sort(),
      js: [...js].sort(),
      images: [...images].sort(),
    };
  }, [results]);

  const readHtmlFiles = (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.name.toLowerCase().endsWith(".html"));
    return Promise.all(
      files.map(
        (file) =>
          new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve({ name: file.name, html: String(r.result || "") });
            r.onerror = () => reject(new Error("Read failed"));
            r.readAsText(file);
          }),
      ),
    );
  };

  const run = async () => {
    setError(null);
    setResults([]);

    if (sourceMode === "urls") {
      const urls = urlsInput
        .split(/\r?\n/)
        .map((u) => u.trim())
        .filter(Boolean);
      if (!urls.length) {
        setError("Enter at least one URL.");
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls }),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(t || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setResults(data.results || []);
      } catch (e) {
        setError(e.message || "Extraction failed.");
      } finally {
        setLoading(false);
      }
      return;
    }

    const input = document.getElementById("fe-html-files");
    const files = input?.files;
    if (!files?.length) {
      setError("Choose one or more .html files.");
      return;
    }
    const bu = baseUrl.trim();
    if (!bu) {
      setError("Enter a base URL (e.g. the live page URL) so relative assets resolve and product name can be detected.");
      return;
    }
    try {
      new URL(bu);
    } catch {
      setError("Base URL must be a valid URL (https://…).");
      return;
    }

    setLoading(true);
    try {
      const loaded = await readHtmlFiles(files);
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          htmlImports: loaded.map((f) => ({
            html: f.html,
            baseUrl: bu,
            name: f.name,
          })),
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResults(data.results || []);
      input.value = "";
    } catch (e) {
      setError(e.message || "Extraction failed.");
    } finally {
      setLoading(false);
    }
  };

  const pill = (active) => ({
    padding: "8px 14px",
    borderRadius: 8,
    border: "none",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    background: active ? "var(--primary)" : "transparent",
    color: active ? "#fff" : "var(--text)",
  });

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 20,
          padding: 6,
          borderRadius: 12,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          width: "fit-content",
        }}
      >
        <button type="button" style={pill(sourceMode === "urls")} onClick={() => setSourceMode("urls")}>
          From URLs
        </button>
        <button type="button" style={pill(sourceMode === "html")} onClick={() => setSourceMode("html")}>
          From HTML files
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 16,
            background: "var(--panel)",
          }}
        >
          {sourceMode === "urls" ? (
            <>
              <label style={{ display: "block", fontWeight: 600, fontSize: 14, marginBottom: 8, color: "var(--text)" }}>
                Page URLs (one per line)
              </label>
              <textarea
                value={urlsInput}
                onChange={(e) => setUrlsInput(e.target.value)}
                placeholder="https://example.com/products/desktop-central/help/page.html"
                rows={8}
                style={{
                  width: "100%",
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid var(--border-2)",
                  fontFamily: "monospace",
                  fontSize: 13,
                  boxSizing: "border-box",
                  background: "var(--bg)",
                  color: "var(--text)",
                  resize: "vertical",
                }}
              />
            </>
          ) : (
            <>
              <label style={{ display: "block", fontWeight: 600, fontSize: 14, marginBottom: 8, color: "var(--text)" }}>
                HTML files only
              </label>
              <input
                id="fe-html-files"
                type="file"
                accept=".html,text/html"
                multiple
                style={{ marginBottom: 12, fontSize: 13, width: "100%" }}
              />
              <label style={{ display: "block", fontWeight: 600, fontSize: 13, marginBottom: 6, color: "var(--muted)" }}>
                Base URL (for resolving links and <code style={{ fontSize: 11 }}>/products/&lt;name&gt;/</code>)
              </label>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://example.com/products/desktop-central/help/account-deletion.html"
                style={{
                  width: "100%",
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid var(--border-2)",
                  fontSize: 13,
                  boxSizing: "border-box",
                  background: "var(--bg)",
                  color: "var(--text)",
                }}
              />
            </>
          )}
        </div>

        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 16,
            background: "linear-gradient(160deg, rgba(59,130,246,0.06), rgba(99,102,241,0.04))",
            fontSize: 13,
            color: "var(--muted)",
            lineHeight: 1.55,
          }}
        >
          <strong style={{ color: "var(--text)", display: "block", marginBottom: 8 }}>What you get</strong>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>CSS &amp; JS paths that include <code style={{ fontSize: 11 }}>/node/</code></li>
            <li>Image paths under <code style={{ fontSize: 11 }}>/sites/meweb/images</code> only</li>
          </ul>
        </div>
      </div>

      <button
        type="button"
        onClick={run}
        disabled={loading}
        style={{
          padding: "10px 22px",
          borderRadius: 9999,
          border: "none",
          background: loading ? "var(--primaryDisabled)" : "var(--primary)",
          color: "#fff",
          fontWeight: 700,
          fontSize: 14,
          cursor: loading ? "default" : "pointer",
          marginBottom: 20,
        }}
      >
        {loading ? "Extracting…" : "Extract"}
      </button>

      <ExtractionWaitGame active={loading} />

      {error && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--dangerBg)",
            color: "var(--dangerText)",
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {results.length > 0 && (
        <>
          {results.some((r) => r.error) && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                background: "var(--dangerBg)",
                color: "var(--dangerText)",
                fontSize: 13,
                marginBottom: 14,
              }}
            >
              {results
                .filter((r) => r.error)
                .map((r) => (
                  <div key={r.url} style={{ marginBottom: 4 }}>
                    <span style={{ wordBreak: "break-all" }}>{r.url}</span>: {r.error}
                  </div>
                ))}
            </div>
          )}
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              margin: "8px 0 14px",
              color: "var(--text)",
              letterSpacing: "-0.02em",
            }}
          >
            Summary
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 14,
              marginBottom: 28,
            }}
          >
            <GroupCard title="CSS" lines={merged.css} accent="#2563eb" />
            <GroupCard title="JS" lines={merged.js} accent="#7c3aed" />
            <GroupCard title="Images" lines={merged.images} accent="#059669" />
          </div>
        </>
      )}
    </div>
  );
}
