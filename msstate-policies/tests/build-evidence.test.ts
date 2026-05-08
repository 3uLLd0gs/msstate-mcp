import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceResult } from "../src/tools/chain_find_relevant.js";
import { PolicyDocument } from "../src/types.js";

const synthDoc = (number: string, title: string, text: string): PolicyDocument => ({
  number,
  slug: number.replace(/\./g, ""),
  title,
  landingUrl: "https://example.invalid/landing",
  pdfUrl: "https://example.invalid/pdf",
  text,
  retrievedAt: "2026-05-08T00:00:00.000Z",
  effectiveDate: null,
  reviewedDate: null,
  lastRevisedDate: null,
  responsibleOffice: null,
  approvedBy: null,
  fallbackToLanding: false,
});

test("buildEvidenceResult attaches primaryEvidence per result and preserves shape", () => {
  const docs = [
    synthDoc(
      "01.04",
      "Emergency Preparedness",
      "Tornado warning protocols govern campus evacuation. The university tornado response plan applies to all students, faculty, and staff.",
    ),
    synthDoc(
      "12.09",
      "General Compliance",
      "Compliance with university policies including reporting and audit obligations.",
    ),
  ];

  const result = buildEvidenceResult("tornado warning", 2, docs);

  // Top-level shape preserved.
  assert.equal(result.question, "tornado warning");
  assert.equal(result.k, 2);
  assert.equal(result.results.length, 2);

  // First doc has tornado in body -> primaryEvidence non-empty.
  const first = result.results[0];
  assert.equal(first.number, "01.04");
  assert.ok(first.primaryEvidence.length >= 1, "tornado-matching doc must have evidence");
  assert.ok(
    first.primaryEvidence.some((p) => p.text.toLowerCase().includes("tornado")),
    "evidence text must contain the matched query token",
  );

  // Second doc has no tornado/warning tokens -> primaryEvidence empty.
  const second = result.results[1];
  assert.equal(second.number, "12.09");
  assert.deepEqual(second.primaryEvidence, [], "non-matching doc must have empty evidence");

  // Existing per-result fields survive the rebuild.
  assert.equal(first.text, docs[0].text);
  assert.equal(first.url, docs[0].landingUrl);
  assert.equal(first.pdfUrl, docs[0].pdfUrl);
  assert.equal(first.retrievedAt, docs[0].retrievedAt);
  assert.equal(first.fallbackToLanding, false);
});
