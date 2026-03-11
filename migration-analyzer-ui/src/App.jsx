import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_ENDPOINT = "/api/analyze"; // adjust if your backend uses a different path

const thStyle = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid var(--border)",
  fontWeight: 600,
  fontSize: 12,
  color: "var(--muted)",
};

const tdStyle = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "top",
  color: "var(--text)",
  fontSize: 13,
};

function App() {
  const [theme, setTheme] = useState("light"); // light | dark
  const [urlsInput, setUrlsInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [reportText, setReportText] = useState("");
  const [copyStatus, setCopyStatus] = useState("idle"); // idle | copying | copied

  useEffect(() => {
    const saved = window.localStorage.getItem("ma_theme");
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    } else {
      setTheme("light");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("ma_theme", theme);
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
  }, [theme]);

  const handleAnalyze = async () => {
    setError(null);
    setResults([]);
    setReportText("");

    const urls = urlsInput
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (!urls.length) {
      setError("Please enter at least one URL.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ urls }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 404) {
          throw new Error("Analyzer service not found (404). Please ensure it is running.");
        }
        throw new Error(text || `Request failed with status ${res.status}`);
      }

      const data = await res.json();
      setResults(data.results || []);
      setReportText(data.report || "");
    } catch (e) {
      setError(e.message || "Failed to analyze URLs.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyOutput = async () => {
    if (!reportText) return;
    try {
      setCopyStatus("copying");
      await navigator.clipboard.writeText(reportText);
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 1500);
    } catch {
      setError("Failed to copy to clipboard.");
      setCopyStatus("idle");
    }
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);

    if (!file.name.toLowerCase().endsWith(".txt")) {
      setError("Only .txt files are supported. Please upload a text file with one URL per line.");
      event.target.value = "";
      return;
    }

    try {
      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (!lines.length) {
        setError("The uploaded file is empty. Please provide at least one URL.");
        event.target.value = "";
        return;
      }

      const invalid = [];
      const validUrls = [];

      for (const line of lines) {
        try {
          const u = new URL(line);
          const protocolOk = u.protocol === "http:" || u.protocol === "https:";
          const htmlOk = u.pathname.toLowerCase().endsWith(".html");
          if (!protocolOk || !htmlOk) throw new Error("Not a valid HTML URL");
          validUrls.push(line);
        } catch {
          invalid.push(line);
        }
      }

      if (invalid.length) {
        setError(
          "The uploaded file must contain one valid HTML page URL (.html) per line. " +
            "These lines are invalid:\n" +
            invalid.slice(0, 5).join("\n") +
            (invalid.length > 5 ? `\n…and ${invalid.length - 5} more.` : ""),
        );
        event.target.value = "";
        return;
      }

      setUrlsInput(validUrls.join("\n"));
      event.target.value = "";
    } catch {
      setError("Failed to read the uploaded file. Please try again.");
      event.target.value = "";
    }
  };

  const counts = useMemo(() => {
    const c403 = results.filter((r) => r?.error && String(r.error).includes("HTTP 403")).length;
    const c404 = results.filter((r) => r?.error && String(r.error).includes("HTTP 404")).length;
    return { c403, c404 };
  }, [results]);

  const isDark = theme === "dark";

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  return (
    <div
      style={{
        maxWidth: 1200,
        width: "100%",
        margin: "0 auto",
        padding: "24px 0 40px",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        color: "var(--text)",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4, marginTop: 0 }}>
            Migration Analyzer
          </h1>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              padding: 6,
              borderRadius: 9999,
              border: "1px solid var(--border-2)",
              background: "var(--bg)",
              color: "var(--text)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          Paste URLs, run the analyzer, and view the migration report.
        </p>
      </header>

      {/* URL input + actions */}
      <section
        style={{
          backgroundColor: "var(--panel)",
          borderRadius: 12,
          padding: 16,
          border: "1px solid var(--border)",
          marginBottom: 24,
        }}
      >
        <label style={{ display: "block", fontWeight: 500, fontSize: 14 }}>
          URLs
          <textarea
            value={urlsInput}
            onChange={(e) => setUrlsInput(e.target.value)}
            placeholder={"https://example.com/page1.html\nhttps://example.com/page2.html"}
            style={{
              marginTop: 6,
              width: "100%",
              minHeight: 120,
              padding: 10,
              borderRadius: 8,
              border: "1px solid var(--border-2)",
              fontFamily: "monospace",
              fontSize: 13,
              resize: "vertical",
              boxSizing: "border-box",
              background: "var(--bg)",
              color: "var(--text)",
            }}
          />
        </label>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
            marginTop: 12,
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <button
              onClick={handleAnalyze}
              disabled={loading}
              style={{
                padding: "8px 16px",
                borderRadius: 9999,
                border: "none",
                backgroundColor: loading ? "var(--primaryDisabled)" : "var(--primary)",
                color: "white",
                fontWeight: 500,
                fontSize: 14,
                cursor: loading ? "default" : "pointer",
              }}
            >
              {loading ? "Analyzing..." : "Analyze"}
            </button>

            <button
              onClick={handleCopyOutput}
              disabled={!reportText}
              style={{
                padding: "8px 16px",
                borderRadius: 9999,
                border: "1px solid var(--border-2)",
                backgroundColor: "var(--bg)",
                color: reportText ? "var(--text)" : "var(--muted)",
                fontWeight: 500,
                fontSize: 14,
                cursor: reportText ? "pointer" : "default",
              }}
            >
              Copy Output
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                color: "var(--muted)",
              }}
            >
              <span>Upload .txt file</span>
              <input
                type="file"
                accept=".txt,text/plain"
                onChange={handleFileChange}
                style={{ fontSize: 11 }}
              />
            </label>
            <span style={{ color: "var(--muted)" }}>One HTML page URL (.html) per line.</span>
          </div>

          {loading && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              This may take a moment for many URLs…
            </span>
          )}
        </div>

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 12px",
              borderRadius: 8,
              backgroundColor: "var(--dangerBg)",
              color: "var(--dangerText)",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
      </section>

      {/* Structured results table */}
      {counts.c403 > 0 && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 12px",
            borderRadius: 8,
            backgroundColor: "var(--warningBg)",
            border: "1px solid var(--warningBorder)",
            color: "var(--warningText)",
            fontSize: 13,
          }}
        >
          {counts.c403} page{counts.c403 === 1 ? "" : "s"} could not be analyzed because access was
          blocked (HTTP 403).
        </div>
      )}

      {counts.c404 > 0 && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 12px",
            borderRadius: 8,
            backgroundColor: "var(--warningBg)",
            border: "1px solid var(--warningBorder)",
            color: "var(--warningText)",
            fontSize: 13,
          }}
        >
          {counts.c404} page{counts.c404 === 1 ? "" : "s"} returned not found (HTTP 404).
        </div>
      )}

      {results.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            Structured Results
          </h2>
          <div
            style={{
              overflowX: "auto",
              borderRadius: 8,
              border: "1px solid var(--border)",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
              }}
            >
              <thead style={{ backgroundColor: "var(--tableHead)" }}>
                <tr>
                  <th style={thStyle}>URL</th>
                  <th style={thStyle}>Template Type</th>
                  <th style={thStyle}>Scroll Position</th>
                  <th style={thStyle}>Total Sections</th>
                  <th style={thStyle}>Common Sections</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.url}>
                    <td style={tdStyle}>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--link)", textDecoration: "none" }}
                      >
                        {r.url}
                      </a>
                    </td>
                    <td style={tdStyle}>{r.template_type}</td>
                    <td style={tdStyle}>
                      {r.scroll_position != null ? r.scroll_position : "—"}
                    </td>
                    <td style={tdStyle}>
                      {r.total_sections != null ? r.total_sections : "—"}
                    </td>
                    <td style={tdStyle}>
                      {r.common_sections != null ? r.common_sections : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Raw report content */}
      <section>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 8,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
            Full Report
          </h2>
          <button
            onClick={handleCopyOutput}
            disabled={!reportText}
            style={{
              padding: "8px 12px",
              borderRadius: 9999,
              border: "1px solid var(--border-2)",
              backgroundColor: "var(--bg)",
              color: reportText ? "var(--text)" : "var(--muted)",
              fontWeight: 500,
              fontSize: 13,
              cursor: reportText ? "pointer" : "default",
            }}
            title={reportText ? "Copy report to clipboard" : "No report to copy"}
          >
            {copyStatus === "copied" ? "Copied" : copyStatus === "copying" ? "Copying…" : "Copy report"}
          </button>
        </div>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            backgroundColor: "var(--codeBg)",
            color: "var(--codeText)",
            padding: 12,
            borderRadius: 8,
            fontFamily: "monospace",
            fontSize: 12,
            minHeight: 80,
            maxHeight: 400,
            overflow: "auto",
            border: "1px solid var(--border)",
          }}
        >
{reportText || "No report yet. Run an analysis to see output."}
        </pre>
        <div
          aria-live="polite"
          style={{
            marginTop: 8,
            minHeight: 18,
            fontSize: 12,
            color: copyStatus === "copied" ? "var(--success)" : "var(--muted)",
          }}
        >
          {copyStatus === "copied" ? "Report copied to clipboard." : ""}
        </div>
      </section>
    </div>
  );
}

export default App;

function SunIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="2" x2="12" y2="5" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" strokeWidth="1.5" />
      <line x1="4.22" y1="4.22" x2="6.34" y2="6.34" stroke="currentColor" strokeWidth="1.5" />
      <line x1="17.66" y1="17.66" x2="19.78" y2="19.78" stroke="currentColor" strokeWidth="1.5" />
      <line x1="2" y1="12" x2="5" y2="12" stroke="currentColor" strokeWidth="1.5" />
      <line x1="19" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="1.5" />
      <line x1="4.22" y1="19.78" x2="6.34" y2="17.66" stroke="currentColor" strokeWidth="1.5" />
      <line x1="17.66" y1="6.34" x2="19.78" y2="4.22" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M20 14.5C19.4374 14.6745 18.8477 14.7692 18.25 14.7812C13.694 14.7812 10 11.0872 10 6.53125C10.012 5.93355 10.1067 5.34386 10.2812 4.78125C8.24776 5.41143 6.62405 6.86223 5.7648 8.80136C4.90555 10.7405 4.88843 12.9519 5.71781 14.9037C6.5472 16.8555 8.14575 18.3705 10.1648 19.0973C12.184 19.8242 14.4251 19.6921 16.3438 18.7344C17.7692 18.0222 18.9234 16.8844 19.625 15.4688C19.7727 15.1611 19.8988 14.8441 20.002 14.5191L20 14.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}