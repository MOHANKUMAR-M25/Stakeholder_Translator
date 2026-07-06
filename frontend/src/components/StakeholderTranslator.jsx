import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { SAMPLE_JUNIT, parseReport } from "../report.js";
import {
  AUDIENCES,
  MODELS,
  DEFAULT_MODEL,
  generateNarrative,
} from "../narrative.js";
import "./StakeholderTranslator.css";

const STAGES = ["Ingest", "Normalize", "Frame", "Generate", "Present"];
const STORAGE_KEY = "stakeholder-translator.settings";

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { apiKey: "", model: DEFAULT_MODEL };
    const parsed = JSON.parse(raw);
    return { apiKey: parsed.apiKey || "", model: parsed.model || DEFAULT_MODEL };
  } catch {
    return { apiKey: "", model: DEFAULT_MODEL };
  }
}

/* ---------- Small presentational pieces ---------- */

function PipelineRail({ stageIndex }) {
  return (
    <nav className="pipeline" aria-label="Pipeline progress">
      {STAGES.map((label, i) => {
        const state = i < stageIndex ? "done" : i === stageIndex ? "active" : "todo";
        return (
          <div key={label} className={`pipeline__step pipeline__step--${state}`}>
            <span className="pipeline__marker" aria-hidden="true">
              {state === "done" ? "✓" : i + 1}
            </span>
            <span className="pipeline__label">{label}</span>
          </div>
        );
      })}
    </nav>
  );
}

function RagBadge({ rag, label }) {
  return (
    <span className={`rag rag--${rag}`}>
      <span className="rag__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function StatTile({ label, value, tone }) {
  return (
    <div className={`tile ${tone ? `tile--${tone}` : ""}`}>
      <div className="tile__value">{value}</div>
      <div className="tile__label">{label}</div>
    </div>
  );
}

function SuiteMeter({ suite }) {
  const total = Math.max(suite.total, 1);
  const seg = (n) => `${(n / total) * 100}%`;
  return (
    <div className="suite">
      <div className="suite__head">
        <span className="suite__name">{suite.name}</span>
        <span className="suite__count">
          {suite.passed}/{suite.total} passed
          {suite.failed > 0 ? `, ${suite.failed} failed` : ""}
          {suite.skipped > 0 ? `, ${suite.skipped} skipped` : ""}
        </span>
      </div>
      <div
        className="meter"
        role="img"
        aria-label={`${suite.passed} passed, ${suite.failed} failed, ${suite.skipped} skipped of ${suite.total}`}
      >
        {suite.passed > 0 && (
          <span className="meter__seg meter__seg--pass" style={{ width: seg(suite.passed) }} />
        )}
        {suite.failed > 0 && (
          <span className="meter__seg meter__seg--fail" style={{ width: seg(suite.failed) }} />
        )}
        {suite.skipped > 0 && (
          <span className="meter__seg meter__seg--skip" style={{ width: seg(suite.skipped) }} />
        )}
      </div>
    </div>
  );
}

/* ---------- Main component ---------- */

export default function StakeholderTranslator({ user, onSignOut }) {
  const [rawInput, setRawInput] = useState("");
  const [normalized, setNormalized] = useState(null);
  const [parseError, setParseError] = useState("");
  const [fileError, setFileError] = useState("");
  const [activeAudience, setActiveAudience] = useState("dm");
  const [narratives, setNarratives] = useState({});
  const [loadingAudience, setLoadingAudience] = useState(null);
  const [copiedKey, setCopiedKey] = useState("");
  const [dragActive, setDragActive] = useState(false);

  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(false);

  const fileInputRef = useRef(null);

  const stageIndex = useMemo(() => {
    if (Object.keys(narratives).length > 0) return 4;
    if (loadingAudience) return 3;
    if (normalized) return 2;
    if (rawInput.trim()) return 1;
    return 0;
  }, [rawInput, normalized, narratives, loadingAudience]);

  const resetDownstream = useCallback(() => {
    setNormalized(null);
    setNarratives({});
    setParseError("");
  }, []);

  const handleLoadSample = useCallback(() => {
    setRawInput(SAMPLE_JUNIT);
    setFileError("");
    resetDownstream();
  }, [resetDownstream]);

  const handleClear = useCallback(() => {
    setRawInput("");
    setFileError("");
    resetDownstream();
  }, [resetDownstream]);

  const readFile = useCallback(
    async (file) => {
      setFileError("");
      const okType = /\.(xml|json|txt)$/i.test(file.name);
      if (!okType) {
        setFileError("Unsupported file type — expected .xml, .json, or .txt.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setFileError("File is larger than 5 MB.");
        return;
      }
      try {
        const text = await file.text();
        setRawInput(text);
        resetDownstream();
      } catch {
        setFileError("Could not read that file.");
      }
    },
    [resetDownstream]
  );

  const handleFilePick = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (file) readFile(file);
      e.target.value = "";
    },
    [readFile]
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) readFile(file);
    },
    [readFile]
  );

  const handleParse = useCallback(() => {
    try {
      const result = parseReport(rawInput);
      setNormalized(result);
      setNarratives({});
      setParseError("");
    } catch (e) {
      setParseError(e.message || "Could not parse this report.");
      setNormalized(null);
    }
  }, [rawInput]);

  const handleGenerate = useCallback(
    async (audienceKey) => {
      if (!normalized) return;
      setLoadingAudience(audienceKey);
      try {
        const result = await generateNarrative(audienceKey, normalized, settings);
        setNarratives((prev) => ({ ...prev, [audienceKey]: result }));
      } catch {
        setNarratives((prev) => ({
          ...prev,
          [audienceKey]: {
            text: "Something went wrong generating this narrative. Try again.",
            source: "local",
          },
        }));
      } finally {
        setLoadingAudience(null);
      }
    },
    [normalized, settings]
  );

  const handleCopy = useCallback((key, text) => {
    navigator.clipboard?.writeText(text || "");
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(""), 1500);
  }, []);

  const handleDownload = useCallback(
    (audience, text) => {
      const status = normalized ? normalized.ragLabel.replace(/\s+/g, "-") : "report";
      const name = `${audience.label.replace(/\s+/g, "-")}_${status}.md`.toLowerCase();
      const blob = new Blob([text], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    },
    [normalized]
  );

  const active = AUDIENCES.find((a) => a.key === activeAudience) || AUDIENCES[0];
  const activeNarrative = narratives[activeAudience];
  const isLoading = loadingAudience === activeAudience;
  const usingClaude = Boolean(settings.apiKey?.trim());
  const initial = (user?.name || user?.email || "?").charAt(0).toUpperCase();

  return (
    <div className="app">
      <header className="app__header">
        <div className="brand">
      <img className="brand__logo" src={import.meta.env.BASE_URL + "logo.svg"} alt="" width="44" height="44" />
          <div>
            <h1 className="brand__title">Stakeholder Translator (QEA)</h1>
            <p className="brand__sub">
              Test-run reports, told the way each audience needs to hear them.
            </p>
          </div>
        </div>
        <div className="app__header-actions">
          <span className={`mode-chip mode-chip--${usingClaude ? "ai" : "local"}`}>
            {usingClaude ? "Claude API" : "Built-in generator"}
          </span>
          {user && (
            <span className="user" title={user.email}>
              {user.picture ? (
                <img
                  className="user__avatar"
                  src={user.picture}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="user__avatar user__avatar--initial" aria-hidden="true">
                  {initial}
                </span>
              )}
              <span className="user__email">{user.email}</span>
            </span>
          )}
          <button className="btn btn--ghost btn--sm" onClick={() => setShowSettings(true)}>
            Settings
          </button>
          {onSignOut && (
            <button className="btn btn--soft btn--sm" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      </header>

      <div className="app__body">
        <PipelineRail stageIndex={stageIndex} />

        <main className="content">
          {/* Ingest & Normalize */}
          <section className="card">
            <div className="card__head">
              <h2 className="card__eyebrow">1 · 2 — Ingest &amp; Normalize</h2>
              <div className="card__head-actions">
                <button className="btn btn--soft btn--sm" onClick={handleLoadSample}>
                  Load sample
                </button>
                <button
                  className="btn btn--soft btn--sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload file
                </button>
                {rawInput && (
                  <button className="btn btn--ghost btn--sm" onClick={handleClear}>
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div
              className={`dropzone ${dragActive ? "dropzone--active" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <textarea
                className="dropzone__input"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder="Paste JUnit / TestNG XML or a suites-shaped JSON report here — or drop a .xml / .json file."
                spellCheck={false}
              />
              {!rawInput && (
                <div className="dropzone__hint" aria-hidden="true">
                  Drag &amp; drop a report file, or paste above
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,.json,.txt,application/xml,application/json,text/plain"
              onChange={handleFilePick}
              hidden
            />

            <div className="card__foot">
              <button className="btn btn--primary" onClick={handleParse} disabled={!rawInput.trim()}>
                Parse report
              </button>
              {fileError && <span className="status status--bad">{fileError}</span>}
              {parseError && <span className="status status--bad">{parseError}</span>}
              {normalized && !parseError && (
                <span className="status status--good">
                  Parsed {normalized.totalTests} tests across {normalized.suites.length} suites.
                </span>
              )}
            </div>
          </section>

          {/* Frame */}
          {normalized && (
            <section className="card">
              <div className="card__head">
                <h2 className="card__eyebrow">3 — Frame · grounded, nothing invented</h2>
                <RagBadge rag={normalized.rag} label={normalized.ragLabel} />
              </div>

              <div className="tiles">
                <StatTile label="Total" value={normalized.totalTests} />
                <StatTile label="Passed" value={normalized.passed} tone="good" />
                <StatTile label="Failed" value={normalized.failed} tone="bad" />
                <StatTile label="Skipped" value={normalized.skipped} tone="muted" />
                <StatTile label="Pass rate" value={`${normalized.passRatePct}%`} />
                <StatTile label="Duration" value={`${normalized.durationSec}s`} />
              </div>

              <div className="suites">
                {normalized.suites.map((s) => (
                  <SuiteMeter key={s.name} suite={s} />
                ))}
              </div>

              {normalized.failures.length > 0 && (
                <div className="failures">
                  <h3 className="failures__title">Failures ({normalized.failures.length})</h3>
                  <ul className="failures__list">
                    {normalized.failures.map((f, i) => (
                      <li key={i} className="failure">
                        <span
                          className={`impact ${
                            f.highImpact ? "impact--high" : "impact--low"
                          }`}
                        >
                          {f.highImpact ? "High impact" : "Low impact"}
                        </span>
                        <span className="failure__body">
                          <strong>{f.suite}</strong> — {f.test}: {f.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* Generate & Present */}
          {normalized && (
            <section className="card">
              <div className="card__head">
                <h2 className="card__eyebrow">4 · 5 — Generate &amp; Present</h2>
              </div>

              <div className="tabs" role="tablist" aria-label="Audience">
                {AUDIENCES.map((a) => (
                  <button
                    key={a.key}
                    role="tab"
                    aria-selected={activeAudience === a.key}
                    className={`tab ${activeAudience === a.key ? "tab--active" : ""}`}
                    onClick={() => setActiveAudience(a.key)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              <p className="tab__blurb">{active.blurb}</p>

              <div className="narrative">
                {!activeNarrative && !isLoading && (
                  <div className="narrative__empty">
                    <p className="status status--muted">
                      No narrative generated yet for this audience.
                    </p>
                    <button
                      className="btn btn--primary"
                      onClick={() => handleGenerate(activeAudience)}
                    >
                      Generate narrative
                    </button>
                  </div>
                )}

                {isLoading && (
                  <p className="narrative__loading">
                    Writing the {active.label.toLowerCase()} narrative…
                  </p>
                )}

                {activeNarrative && !isLoading && (
                  <div>
                    <pre className="narrative__text">{activeNarrative.text}</pre>

                    {activeNarrative.note && (
                      <p className="status status--warn narrative__note">{activeNarrative.note}</p>
                    )}

                    <div className="narrative__actions">
                      <span
                        className={`source source--${activeNarrative.source}`}
                        title={
                          activeNarrative.source === "claude"
                            ? "Authored by the Claude API"
                            : "Produced by the built-in generator"
                        }
                      >
                        {activeNarrative.source === "claude"
                          ? "Claude-authored"
                          : "Built-in generator"}
                      </span>
                      <button
                        className="btn btn--soft btn--sm"
                        onClick={() => handleGenerate(activeAudience)}
                      >
                        Regenerate
                      </button>
                      <button
                        className="btn btn--soft btn--sm"
                        onClick={() => handleCopy(activeAudience, activeNarrative.text)}
                      >
                        {copiedKey === activeAudience ? "Copied ✓" : "Copy"}
                      </button>
                      <button
                        className="btn btn--soft btn--sm"
                        onClick={() => handleDownload(active, activeNarrative.text)}
                      >
                        Download
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          <p className="footnote">
            Prototype: parsing runs entirely in this page. Narratives come from a built-in,
            grounded generator by default; add your own Anthropic API key in Settings to have
            Claude author them instead. In production this would route through a governed backend
            so test data and keys never leave your approved boundary, triggered automatically by
            the pipeline instead of pasted in by hand.
          </p>
        </main>
      </div>

      {showSettings && (
        <SettingsDialog
          settings={settings}
          onSave={(next) => {
            setSettings(next);
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch {
              /* storage may be unavailable; keep in-memory */
            }
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

/* ---------- Settings dialog ---------- */

function SettingsDialog({ settings, onSave, onClose }) {
  const [apiKey, setApiKey] = useState(settings.apiKey || "");
  const [model, setModel] = useState(settings.model || DEFAULT_MODEL);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog__head">
          <h2 className="dialog__title">Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <label className="field">
          <span className="field__label">Anthropic API key</span>
          <input
            className="field__input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-…  (optional)"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field__hint">
            Stored only in this browser. Leave blank to use the built-in generator.
          </span>
        </label>

        <label className="field">
          <span className="field__label">Model</span>
          <select
            className="field__input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <div className="dialog__foot">
          <button
            className="btn btn--soft btn--sm"
            onClick={() => onSave({ apiKey: "", model: DEFAULT_MODEL })}
          >
            Clear key
          </button>
          <div className="dialog__foot-right">
            <button className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={() => onSave({ apiKey, model })}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
