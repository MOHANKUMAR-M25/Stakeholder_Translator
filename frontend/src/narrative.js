// ---------- Stakeholder narratives ----------
// Two paths, same interface:
//   • Built-in generator — deterministic, grounded, works with zero config.
//   • Claude API        — richer prose when the user supplies their own key.
// Both write only from the parsed numbers; neither invents root causes.

export const AUDIENCES = [
  {
    key: "dm",
    label: "Delivery Manager",
    blurb: "Three lines: is anything blocking, and do you need to act?",
    instruction:
      "Write a 3-line status update for a delivery manager who needs to know, in seconds, whether anything is blocking and whether they need to act. Plain, operational language. No preamble, no sign-off, exactly 3 lines.",
  },
  {
    key: "po",
    label: "Product Owner",
    blurb: "A one-page narrative framed around the customer-facing feature.",
    instruction:
      "Write a one-page narrative (4-6 short paragraphs) for a product owner. Explain what was tested, what happened, and frame any failures in terms of the customer-facing feature and business impact. End with one clear recommendation: ship, hold, or fix-first-then-ship. Do not invent causes beyond what the failure messages state.",
  },
  {
    key: "client",
    label: "Client Board Slide",
    blurb: "A calm, risk-flagged board slide — no jargon, no stack traces.",
    instruction:
      "Write a short, risk-flagged board-slide narrative: one title line and 4-5 bullet points. Professional, calm, and honest tone for a client-facing audience. State the risk level plainly. No internal class names, stack traces, or engineering jargon.",
  },
];

export const MODELS = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 (most capable)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 (balanced)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest)" },
];

export const DEFAULT_MODEL = "claude-opus-4-8";

// ---------- Built-in deterministic generator ----------

function pct(n) {
  return `${n}%`;
}

function humaniseTest(name) {
  // "highValueWireRequiresStepUpAuth" -> "high value wire requires step up auth"
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
}

function highImpactFailures(n) {
  return n.failures.filter((f) => f.highImpact);
}

function localDeliveryManager(n) {
  const status =
    n.rag === "red"
      ? "BLOCKED — action needed"
      : n.rag === "amber"
      ? "WATCH — no action yet"
      : "ON TRACK — no action needed";
  const line1 = `${status}. ${n.passed}/${n.totalTests} tests passing (${pct(
    n.passRatePct
  )}) across ${n.suites.length} suites in ${n.durationSec}s.`;

  let line2;
  if (n.failed === 0) {
    line2 =
      n.skipped > 0
        ? `No failures. ${n.skipped} test(s) skipped — worth confirming they were skipped intentionally.`
        : "No failures and nothing skipped.";
  } else {
    const hi = highImpactFailures(n);
    line2 =
      hi.length > 0
        ? `${n.failed} failure(s), ${hi.length} on high-impact flows (${[
            ...new Set(hi.map((f) => f.suite)),
          ].join(", ")}).`
        : `${n.failed} failure(s), none on flagged high-impact flows.`;
  }

  const line3 =
    n.rag === "red"
      ? "Recommend holding this build until the high-impact failures are triaged."
      : n.rag === "amber"
      ? "Safe to keep moving; keep an eye on the open failures before release."
      : "Clear to proceed pending human review.";

  return [line1, line2, line3].join("\n");
}

function localProductOwner(n) {
  const paras = [];

  paras.push(
    `This run exercised ${n.totalTests} tests across ${n.suites.length} feature areas (${n.suites
      .map((s) => s.name)
      .join(", ")}), completing in ${n.durationSec} seconds. ${n.passed} passed, ${n.failed} failed${
      n.skipped ? `, and ${n.skipped} were skipped` : ""
    } — an overall pass rate of ${pct(n.passRatePct)}.`
  );

  if (n.failed === 0) {
    paras.push(
      `No failures were recorded. Every checked flow behaved as expected, so there is no functional regression visible in this run.`
    );
  } else {
    const hi = highImpactFailures(n);
    if (hi.length > 0) {
      const items = hi
        .map(
          (f) =>
            `• ${f.suite} — "${humaniseTest(f.test)}": ${f.message}`
        )
        .join("\n");
      paras.push(
        `The failures that matter most touch customer-facing, money-movement or access-control flows:\n${items}`
      );
      paras.push(
        `In business terms, these are the checks that protect a customer's money and account access. Until they pass, we cannot be confident those safeguards behave correctly for every customer.`
      );
    } else {
      const items = n.failures
        .map((f) => `• ${f.suite} — "${humaniseTest(f.test)}": ${f.message}`)
        .join("\n");
      paras.push(
        `The failures are outside the flagged high-impact flows:\n${items}`
      );
    }
    paras.push(
      `The cause of each failure beyond the message above is under investigation — this summary does not assume a root cause the run did not report.`
    );
  }

  if (n.skipped > 0) {
    const skippedNote =
      "Some tests were skipped in this run, so their behaviour is unverified here rather than confirmed working.";
    paras.push(skippedNote);
  }

  const rec =
    n.rag === "red"
      ? "Recommendation: fix-first-then-ship. Hold the release until the high-impact failures are resolved and re-run."
      : n.rag === "amber"
      ? "Recommendation: ship with a fast follow. The open items are worth closing, but none block the customer-facing feature outright — decide with the risk owner."
      : "Recommendation: ship, pending normal human review.";
  paras.push(rec);

  return paras.join("\n\n");
}

function localClientSlide(n) {
  const title =
    n.rag === "red"
      ? "Quality status: At risk — action underway"
      : n.rag === "amber"
      ? "Quality status: On watch"
      : "Quality status: On track";

  const bullets = [];
  bullets.push(
    `Risk level: ${n.ragLabel}. ${pct(n.passRatePct)} of ${n.totalTests} checks passed in the latest run.`
  );
  bullets.push(
    `${n.suites.length} feature areas were tested end to end.`
  );

  if (n.failed === 0) {
    bullets.push("No issues were found in this run.");
  } else {
    const hi = highImpactFailures(n);
    if (hi.length > 0) {
      bullets.push(
        `${hi.length} issue(s) affect sensitive flows such as payments and account access, and are being triaged.`
      );
    } else {
      bullets.push(
        `${n.failed} issue(s) were found on lower-risk areas and are being addressed.`
      );
    }
  }

  if (n.skipped > 0) {
    bullets.push(
      `${n.skipped} check(s) could not run in this environment and will be re-verified.`
    );
  }

  bullets.push(
    n.rag === "red"
      ? "Next step: resolve the flagged items before release."
      : n.rag === "amber"
      ? "Next step: close the open items and confirm before release."
      : "Next step: proceed to release review."
  );

  return `${title}\n\n${bullets.map((b) => `• ${b}`).join("\n")}`;
}

export function generateLocalNarrative(audienceKey, normalized) {
  switch (audienceKey) {
    case "dm":
      return localDeliveryManager(normalized);
    case "po":
      return localProductOwner(normalized);
    case "client":
      return localClientSlide(normalized);
    default:
      return localDeliveryManager(normalized);
  }
}

// ---------- Claude API path ----------

function dataForModel(normalized) {
  return {
    totals: {
      totalTests: normalized.totalTests,
      passed: normalized.passed,
      failed: normalized.failed,
      skipped: normalized.skipped,
      passRatePct: normalized.passRatePct,
      durationSec: normalized.durationSec,
    },
    status: normalized.ragLabel,
    suites: normalized.suites,
    failures: normalized.failures.map((f) => ({
      suite: f.suite,
      test: f.test,
      message: f.message,
      flaggedHighImpact: f.highImpact,
    })),
  };
}

async function callClaude(audience, normalized, { apiKey, model }) {
  const system =
    "You are a QA-to-stakeholder translator for a bank's small business payments engineering team. " +
    "You are given exact parsed test-run data as JSON. Write only from these numbers and messages. " +
    "Never invent counts, test names, or root causes that are not present in the data. " +
    "If a cause is not stated in a failure message, say the cause is under investigation rather than guessing. " +
    "Respond with only the finished narrative — no preamble, no meta-commentary about your process.";

  const userPrompt = `${audience.instruction}\n\nParsed test data:\n${JSON.stringify(
    dataForModel(normalized),
    null,
    2
  )}`;

  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        // Required to call the API directly from a browser. In production this
        // would route through a backend so the key never reaches the client.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
  } catch {
    throw new Error(
      "Could not reach the Claude API from the browser (network or CORS). The built-in generator was used instead."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = data?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Claude API error: ${detail}`);
  }

  if (data.stop_reason === "refusal") {
    throw new Error("Claude declined to generate this narrative.");
  }

  const text = (data.content || [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) throw new Error("Claude returned an empty response.");
  return text;
}

// Orchestrator: use Claude when a key is configured, otherwise the built-in
// generator. Always returns a usable narrative; never leaves the UI broken.
// Returns { text, source: "claude" | "local", note? }.
export async function generateNarrative(audienceKey, normalized, settings = {}) {
  const audience = AUDIENCES.find((a) => a.key === audienceKey) || AUDIENCES[0];
  const apiKey = settings.apiKey?.trim();

  if (!apiKey) {
    return { text: generateLocalNarrative(audienceKey, normalized), source: "local" };
  }

  try {
    const text = await callClaude(audience, normalized, {
      apiKey,
      model: settings.model,
    });
    return { text, source: "claude" };
  } catch (e) {
    // Fall back so the feature still delivers something useful and honest.
    return {
      text: generateLocalNarrative(audienceKey, normalized),
      source: "local",
      note: e.message || "Claude call failed; used the built-in generator.",
    };
  }
}
