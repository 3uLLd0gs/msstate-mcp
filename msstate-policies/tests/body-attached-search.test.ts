import { test } from "node:test";
import assert from "node:assert/strict";
import { indexEntries, attachBody, bm25Search } from "../src/search.js";
import { PolicyEntry } from "../src/types.js";

const synthEntry = (number: string, title: string): PolicyEntry => ({
  number,
  slug: number.replace(/\./g, ""),
  title,
  landingUrl: "https://example.invalid/landing",
  pdfUrl: "https://example.invalid/pdf",
  status: "Current",
  firstAuthoredOrSorted: null,
});

test("BM25 finds policies by body content once bodies are attached (F1 acceptance)", () => {
  // Re-index from scratch with two synthetic policies whose titles do NOT
  // contain the word we'll search for.
  indexEntries([
    synthEntry("01.04", "Emergency Preparedness and Response"),
    synthEntry("12.09", "General Compliance"),
  ]);

  // Title-only retrieval cannot find "tornado" — neither title contains it.
  const titleOnly = bm25Search("tornado");
  assert.equal(titleOnly.length, 0, "title-only BM25 must not match a body-only term");

  // Now attach bodies. OP 01.04 mentions tornado; OP 12.09 does not.
  attachBody(
    "0104",
    "Tornado warning protocols and shelter procedures govern campus evacuation when severe weather is detected. The university tornado response plan applies to all faculty, staff, and students.",
  );
  attachBody(
    "1209",
    "General compliance with university policies including reporting, audit, and governance obligations.",
  );

  // BM25 over titles + bodies must now retrieve OP 01.04 for the body-only term.
  const withBody = bm25Search("tornado");
  assert.ok(withBody.length >= 1, "BM25 must return at least one hit after bodies attached");
  assert.equal(withBody[0].slug, "0104", "OP 01.04 must rank top for tornado body keyword");
});
