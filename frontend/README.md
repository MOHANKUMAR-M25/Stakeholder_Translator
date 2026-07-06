# Stakeholder Translator

Turn a raw QA test-run report into the story each audience actually needs to hear —
a three-line status for a delivery manager, a one-page narrative for a product
owner, or a calm, jargon-free board slide for a client. Built with React 19 + Vite.

Everything is grounded in the parsed numbers: the app writes only from the counts
and failure messages in your report and never invents a root cause the run didn't
report.

## End-to-end functionality

```
Ingest → Normalize → Frame → Generate → Present
```

### 1) Ingest
- Paste report text in the editor.
- Drag & drop a report file onto the dropzone.
- Upload a file via the file picker.
- Load a built-in sample report.

### 2) Normalize
- Parses **JUnit/TestNG XML** (supports `<testsuites>`, `<testsuite>`, `<testcase>` with
  `<failure>`, `<error>`, and `<skipped>`).
- Parses **Suites-shaped JSON** where the input is a top-level `suites` (or
  `testsuites` / `results`) array.
- Produces a single normalized model used by both the dashboard and the narrative
  generator:
  - Total/Passed/Failed/Skipped
  - Pass rate and total duration
  - Per-suite aggregates
  - Per-failure details (suite, test, message)

### 3) Frame (risk + dashboard)
- Computes a RAG state and label:
  - **Red (At risk)**: at least one failed *high-impact* flow.
  - **Amber (Watch)**: there are failures, or pass rate is below 95%.
  - **Green (On track)**: otherwise.
- Flags *high-impact* failures when suite/test/message mentions sensitive flows
  such as payments, ACH, wire, auth/MFA, KYC/KYB, account, fraud, sanctions,
  approvals, routing, or credentials.
- Displays:
  - Stat tiles (totals + pass rate + duration)
  - Per-suite pass/fail meter
  - Failure list with **High impact / Low impact** tagging

### 4) Generate narratives (audience-specific)
Narratives are generated for the selected audience tab:
- Delivery Manager (DM): **exactly 3 lines** of operational status.
- Product Owner (PO): **4–6 short paragraphs** with business framing.
- Client Board Slide: **1 title line + 4–5 bullets**, calm and jargon-free.

Narrative generation has two sources, using the same interface:
- **Built-in generator (default)**
  - Deterministic and fully offline (no key, no network).
- **Claude API (optional)**
  - In **Settings**, provide an Anthropic API key and select a model.
  - The key is stored only in your browser (`localStorage`).
  - If the Claude call fails, the app automatically falls back to the built-in
    generator and shows a note.

Each narrative includes a “source chip” indicating whether it was **Claude-authored**
or produced by the **built-in generator**.

### 5) Present (actions)
- Copy narrative text to clipboard.
- Download the narrative as a Markdown (`.md`) file.
- Regenerate (re-run) the narrative for the current audience.

### Settings
- Configure Anthropic API key (optional).
- Select a Claude model.
- “Clear key” to return to built-in generation.

### Authentication (prototype gate)
The app includes a front-end sign-in gate:
- Email/password path (format validation in the browser).
- Optional Google sign-in using Google Identity Services when
  `VITE_GOOGLE_CLIENT_ID` is configured.
- Session is stored in the browser; in production this would be handled by a
  backend.

## Accepted report formats


**JUnit / TestNG XML** — standard `<testsuites>` / `<testsuite>` / `<testcase>`
with `<failure>`, `<error>`, and `<skipped>` children.

**Suites-shaped JSON** — a top-level `suites` (or `testsuites` / `results`) array:

```json
{
  "suites": [
    {
      "name": "WireTransferAuth",
      "tests": [
        { "name": "wireLimitsRespectDailyCap", "status": "passed", "time": 7.5 },
        { "name": "highValueWireRequiresStepUpAuth", "status": "failed",
          "message": "Wire processed without step-up MFA challenge" }
      ]
    }
  ]
}
```

Per test, `status` (or `result`) is matched loosely — anything containing `fail` or
`error` counts as failed, `skip` as skipped, everything else as passed; `time` (or
`duration`) feeds the total run time; `message` (or `error`) is the failure detail.

## How status is decided

- **At risk (red)** — there is a failure on a high-impact flow.
- **Watch (amber)** — there are failures, or the pass rate is below 95%.
- **On track (green)** — otherwise.

"High impact" is flagged when a failure's suite, test name, or message mentions a
sensitive banking flow (payments, ACH, wire, auth/MFA, KYC/KYB, account, fraud,
sanctions, approval, routing, credentials).

## Generating narratives

The **Generate** step has two modes, same interface:

- **Built-in generator (default).** Deterministic, grounded, works with zero
  configuration — no key, no network. This keeps the app fully usable offline.
- **Claude API (optional).** Add your own Anthropic API key in **Settings** and
  Claude authors the narratives instead (defaults to `claude-opus-4-8`; the model is
  selectable). The key is stored **only in your browser** (`localStorage`) and is
  never bundled or committed. If a Claude call fails, the app transparently falls
  back to the built-in generator and tells you.

Each narrative shows a source chip — **Claude-authored** or **Built-in generator** —
so you always know where the text came from.

> **Prototype note:** parsing and (optional) API calls run entirely in the browser.
> In production this would route through a governed backend so test data and keys
> never leave your approved boundary, triggered automatically by the CI/CD pipeline
> instead of pasted in by hand.

## Running locally

```bash
npm install
npm run dev        # start the dev server (Vite + HMR)
npm run build      # production build → dist/
npm run preview    # serve the production build
npm run lint       # ESLint
```

## Project structure (current)

This app is a React + Vite SPA under `frontend/`.

```
src/
  main.jsx                    # React entry + router-less mounting
  components/
    App.jsx                    # auth gate: Login → StakeholderTranslator
    Login.jsx                  # email/password and (optional) Google sign-in UI
    StakeholderTranslator.jsx  # Ingest/Frame/Generate/Present UI + Settings dialog
  auth.js                     # browser-only session helpers + Google Identity loader
  report.js                   # parsing + normalization + RAG risk flagging
  narrative.js                # audience prompts + built-in generator + optional Claude API
  components/*.css            # component and theme styles
  index.css                    # base styles + tokens
```


```
src/
  main.jsx                    # React entry
  App.jsx                     # renders <StakeholderTranslator />
  StakeholderTranslator.jsx   # UI: ingest, dashboard, tabs, settings
  StakeholderTranslator.css   # component styles
  index.css                   # design tokens + base styles (light & dark)
  lib/
    report.js                 # report parsing, normalization, RAG + risk flagging
    narrative.js              # audiences, built-in generator, Claude call + fallback
```

Styling is a self-contained, brand-neutral design system with light and dark themes
— no CSS framework dependency. Status colours use a colour-vision-safe palette, and
every RAG state pairs its colour with a text label.
