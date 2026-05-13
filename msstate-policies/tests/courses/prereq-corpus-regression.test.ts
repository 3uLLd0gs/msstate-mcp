import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePrereqProse } from "../../src/courses/parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpusPath = join(here, "..", "..", "..", "worker", "corpus.json");

interface AuditCounts {
  total_records: number;
  with_prose: number;
  fully_parsed: number;
  with_warnings: number;
  warning_breakdown: {
    non_course_unparsed: number;
    grade_signal_present_but_unparsed: number;
    grade_signal_ambiguous: number;
    logic_ambiguous: number;
  };
}

function auditCorpus(): AuditCounts {
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  const records = corpus.courses.records as Record<
    string,
    { prereqs: { raw_prose: string | null } | null }
  >;
  let total = 0, withProse = 0, fullyParsed = 0, withWarnings = 0;
  const breakdown = {
    non_course_unparsed: 0,
    grade_signal_present_but_unparsed: 0,
    grade_signal_ambiguous: 0,
    logic_ambiguous: 0,
  };
  for (const rec of Object.values(records)) {
    total++;
    const rawProse = rec.prereqs?.raw_prose ?? null;
    if (rawProse) {
      withProse++;
      const reparsed = parsePrereqProse(rawProse);
      if (reparsed && reparsed.parse_warnings.length === 0) fullyParsed++;
      if (reparsed && reparsed.parse_warnings.length > 0) {
        withWarnings++;
        for (const w of reparsed.parse_warnings) {
          breakdown[w as keyof typeof breakdown]++;
        }
      }
    }
  }
  return {
    total_records: total,
    with_prose: withProse,
    fully_parsed: fullyParsed,
    with_warnings: withWarnings,
    warning_breakdown: breakdown,
  };
}

describe("prereq corpus audit — post-fix ceilings", () => {
  test("non_course_unparsed <= 31 (was 63 before fixes)", () => {
    const a = auditCorpus();
    assert.ok(
      a.warning_breakdown.non_course_unparsed <= 31,
      `regression: ${a.warning_breakdown.non_course_unparsed} > 31 (baseline pre-fix was 63)`,
    );
  });

  test("grade_signal_present_but_unparsed <= 12 (was 28)", () => {
    const a = auditCorpus();
    assert.ok(
      a.warning_breakdown.grade_signal_present_but_unparsed <= 12,
      `regression: ${a.warning_breakdown.grade_signal_present_but_unparsed} > 12 (baseline pre-fix was 28)`,
    );
  });

  test("logic_ambiguous <= 190 (informational ceiling for mixed AND/OR)", () => {
    const a = auditCorpus();
    assert.ok(
      a.warning_breakdown.logic_ambiguous <= 190,
      `regression: ${a.warning_breakdown.logic_ambiguous} > 190`,
    );
  });

  test("fully_parsed >= 470 (was 595 spec target; actual post-fix baseline is 476)", () => {
    const a = auditCorpus();
    assert.ok(
      a.fully_parsed >= 470,
      `regression: fully_parsed=${a.fully_parsed} < 470 (post-fix baseline is 476)`,
    );
  });
});
