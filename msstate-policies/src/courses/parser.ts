/**
 * Catalog HTML → Course parser, plus the prereq-prose decomposer.
 *
 * Two-pass prereq strategy (spec § 4.1):
 *
 *   Pass 1 (lossless): extract every course-code-shaped token from inside
 *   the parenthesized prereq clause. This is what graph-walking depends on.
 *
 *   Pass 2 (best-effort): infer logic / min_grade / non_course phrases.
 *   When uncertain, set logic="mixed" and rely on raw_prose verbatim.
 */
import type { Prereq } from "./types.js";

const COURSE_TOKEN_RE = /\b[A-Z]{2,4}\s\d{4}\b/g;
const NON_COURSE_PATTERNS: Array<{ rx: RegExp; label: (m: RegExpExecArray) => string }> = [
  { rx: /\bconsent of (?:the )?instructor\b/gi, label: () => "consent of instructor" },
  { rx: /\bpermission of (?:the )?(?:instructor|department head)\b/gi, label: (m) => m[0].toLowerCase() },
  { rx: /\b(junior|senior|graduate|sophomore|freshman) standing\b/gi, label: (m) => `${m[1].toLowerCase()} standing` },
  { rx: /\bACT\s+\d+\b/gi, label: (m) => m[0] },
  { rx: /\bSAT\s+\d+\b/gi, label: (m) => m[0] },
];

function extractParenthesized(label: "Prerequisites" | "Corequisites", input: string): string | null {
  // Allow ONE level of nested parens so clauses like
  //   "(Prerequisites: CSE 1284 and (MA 1713 or MA 1723))"
  // match as a single unit. Real catalog prose rarely nests deeper than one.
  const rx = new RegExp(`\\(\\s*${label}(?:[^()]|\\([^()]*\\))*\\)`, "i");
  const m = input.match(rx);
  return m ? m[0] : null;
}

function inferLogic(clause: string): "or" | "and" | "mixed" | null {
  const hasOr = /\bor\b/i.test(clause);
  const hasAnd = /\band\b/i.test(clause);
  if (hasOr && hasAnd) return "mixed";
  if (hasOr) return "or";
  if (hasAnd) return "and";
  return null;
}

function inferMinGrade(clause: string): Prereq["min_grade"] {
  const m = /Grade of ([ABCD])(?:\s+or\s+better)?/i.exec(clause);
  return m ? (m[1].toUpperCase() as Prereq["min_grade"]) : null;
}

function extractNonCourse(clause: string): string[] {
  const out = new Set<string>();
  for (const { rx, label } of NON_COURSE_PATTERNS) {
    let m: RegExpExecArray | null;
    rx.lastIndex = 0;
    while ((m = rx.exec(clause)) !== null) {
      out.add(label(m));
      if (m.index === rx.lastIndex) rx.lastIndex++; // zero-width safety
    }
  }
  return Array.from(out);
}

function uniqueCourseCodes(clause: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  COURSE_TOKEN_RE.lastIndex = 0;
  while ((m = COURSE_TOKEN_RE.exec(clause)) !== null) {
    const code = m[0];
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

function parseClause(label: "Prerequisites" | "Corequisites", input: string): Prereq | null {
  if (!input) return null;
  const clause = extractParenthesized(label, input);
  if (!clause) return null;
  const required_courses = uniqueCourseCodes(clause);
  const non_course = extractNonCourse(clause);
  if (required_courses.length === 0 && non_course.length === 0) {
    // Empty (no recognizable content); still report raw_prose so caller knows
    // there WAS a prereq clause we couldn't decompose.
    return {
      required_courses: [],
      logic: null,
      min_grade: null,
      non_course: [],
      raw_prose: clause,
    };
  }
  return {
    required_courses,
    logic: inferLogic(clause),
    min_grade: inferMinGrade(clause),
    non_course,
    raw_prose: clause,
  };
}

export function parsePrereqProse(input: string | null | undefined): Prereq | null {
  return parseClause("Prerequisites", input ?? "");
}

export function parseCoreqProse(input: string | null | undefined): Prereq | null {
  return parseClause("Corequisites", input ?? "");
}
