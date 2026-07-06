// ---------- Report parsing & normalization ----------
// Turns a pasted/uploaded JUnit-XML or suites-shaped JSON test report into a
// single normalized shape the UI and the narrative generator both consume.
// All parsing runs in the browser; nothing is invented beyond the input.

export const SAMPLE_JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="SmallBusinessPaymentsRegression" tests="18" failures="3" errors="0" skipped="1" time="142.7">
  <testsuite name="ACHBatchPayment" tests="6" failures="2" errors="0" skipped="0" time="58.2">
    <testcase classname="ACHBatchPayment" name="submitBatchWithThirtyRecipients" time="9.1"/>
    <testcase classname="ACHBatchPayment" name="rejectsDuplicateRecipientInBatch" time="4.4"/>
    <testcase classname="ACHBatchPayment" name="batchApprovalRequiresDualControl" time="6.0">
      <failure message="Expected approval status PENDING_SECOND_APPROVER but got APPROVED after single sign-off">at BatchApprovalServiceTest.verifyDualControl(BatchApprovalServiceTest.java:112)</failure>
    </testcase>
    <testcase classname="ACHBatchPayment" name="sameDayAchCutoffEnforced" time="3.3"/>
    <testcase classname="ACHBatchPayment" name="scheduledBatchRunsOnRecurrence" time="12.0"/>
    <testcase classname="ACHBatchPayment" name="batchFailsOverOnRoutingNumberInvalid" time="23.4">
      <failure message="Invalid routing number 000000000 was accepted; expected ValidationException">at RoutingValidatorTest.rejectsInvalidRouting(RoutingValidatorTest.java:47)</failure>
    </testcase>
  </testsuite>
  <testsuite name="WireTransferAuth" tests="5" failures="1" errors="0" skipped="0" time="41.0">
    <testcase classname="WireTransferAuth" name="highValueWireRequiresStepUpAuth" time="8.0">
      <failure message="Wire of $85,000 processed without step-up MFA challenge; threshold is $10,000">at WireAuthServiceTest.stepUpTriggeredAboveThreshold(WireAuthServiceTest.java:88)</failure>
    </testcase>
    <testcase classname="WireTransferAuth" name="wireLimitsRespectDailyCap" time="7.5"/>
    <testcase classname="WireTransferAuth" name="internationalWireFlagsSanctionsList" time="9.0"/>
    <testcase classname="WireTransferAuth" name="wireConfirmationEmailSent" time="6.5"/>
    <testcase classname="WireTransferAuth" name="wireCancelWindowEnforced" time="10.0"/>
  </testsuite>
  <testsuite name="AccountLinkingAndOnboarding" tests="7" failures="0" errors="0" skipped="1" time="43.5">
    <testcase classname="AccountLinking" name="plaidLinkSucceedsForSupportedBank" time="5.0"/>
    <testcase classname="AccountLinking" name="microDepositVerificationFallback" time="9.0"/>
    <testcase classname="AccountLinking" name="kybDocumentUploadAcceptsPdf" time="4.0"/>
    <testcase classname="AccountLinking" name="kybReviewQueueAssignsOwner" time="6.5"/>
    <testcase classname="AccountLinking" name="duplicateEinDetection" time="3.0"/>
    <testcase classname="AccountLinking" name="onboardingResumesAfterDropOff" time="5.0" />
    <testcase classname="AccountLinking" name="thirdPartyCreditCheckIntegration" time="11.0">
      <skipped message="Sandbox credit bureau endpoint unavailable in this run"/>
    </testcase>
  </testsuite>
</testsuites>`;

const RISK_KEYWORDS = [
  "payment", "ach", "wire", "auth", "login", "kyc", "kyb", "transfer",
  "account", "fraud", "sanction", "approval", "credential", "mfa", "routing",
];

function parseJUnitXML(xmlText) {
  const doc = new window.DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Could not parse as XML");
  const suiteNodes = Array.from(doc.querySelectorAll("testsuite"));
  if (suiteNodes.length === 0) throw new Error("No <testsuite> elements found");

  const suites = [];
  const failures = [];
  let totalDuration = 0;

  suiteNodes.forEach((s) => {
    const name = s.getAttribute("name") || "Unnamed suite";
    const cases = Array.from(s.querySelectorAll("testcase"));
    let passed = 0, failed = 0, skipped = 0;
    cases.forEach((c) => {
      const testName = c.getAttribute("name") || "unnamed test";
      const time = parseFloat(c.getAttribute("time") || "0");
      totalDuration += isNaN(time) ? 0 : time;
      const failureNode = c.querySelector("failure, error");
      const skippedNode = c.querySelector("skipped");
      if (failureNode) {
        failed += 1;
        failures.push({
          suite: name,
          test: testName,
          message: failureNode.getAttribute("message") || "No message provided",
        });
      } else if (skippedNode) {
        skipped += 1;
      } else {
        passed += 1;
      }
    });
    suites.push({ name, total: cases.length, passed, failed, skipped });
  });

  return finalize(suites, failures, totalDuration);
}

function parseGenericJSON(text) {
  const data = JSON.parse(text);
  const rawSuites = data.suites || data.testsuites || data.results || [];
  if (!Array.isArray(rawSuites) || rawSuites.length === 0) {
    throw new Error("JSON did not contain a recognizable 'suites' array");
  }
  const suites = [];
  const failures = [];
  let totalDuration = 0;

  rawSuites.forEach((s) => {
    const name = s.name || "Unnamed suite";
    const tests = s.tests || s.testcases || [];
    let passed = 0, failed = 0, skipped = 0;
    tests.forEach((t) => {
      const status = (t.status || t.result || "").toLowerCase();
      const duration = parseFloat(t.duration || t.time || 0);
      totalDuration += isNaN(duration) ? 0 : duration;
      if (status.includes("fail") || status.includes("error")) {
        failed += 1;
        failures.push({
          suite: name,
          test: t.name || "unnamed test",
          message: t.message || t.error || "No message provided",
        });
      } else if (status.includes("skip")) {
        skipped += 1;
      } else {
        passed += 1;
      }
    });
    suites.push({ name, total: tests.length, passed, failed, skipped });
  });

  return finalize(suites, failures, totalDuration);
}

function finalize(suites, failures, totalDuration) {
  const totalTests = suites.reduce((a, s) => a + s.total, 0);
  const passed = suites.reduce((a, s) => a + s.passed, 0);
  const failed = suites.reduce((a, s) => a + s.failed, 0);
  const skipped = suites.reduce((a, s) => a + s.skipped, 0);
  const passRatePct = totalTests ? Math.round((passed / totalTests) * 1000) / 10 : 0;

  const taggedFailures = failures.map((f) => {
    const haystack = `${f.suite} ${f.test} ${f.message}`.toLowerCase();
    const highImpact = RISK_KEYWORDS.some((k) => haystack.includes(k));
    return { ...f, highImpact };
  });

  let rag = "green";
  let ragLabel = "On track";
  if (failed > 0 && taggedFailures.some((f) => f.highImpact)) {
    rag = "red";
    ragLabel = "At risk";
  } else if (failed > 0 || passRatePct < 95) {
    rag = "amber";
    ragLabel = "Watch";
  }

  return {
    totalTests, passed, failed, skipped, passRatePct,
    durationSec: Math.round(totalDuration * 10) / 10,
    suites, failures: taggedFailures, rag, ragLabel,
  };
}

export function parseReport(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) throw new Error("Nothing to parse yet");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseGenericJSON(trimmed);
  }
  return parseJUnitXML(trimmed);
}
