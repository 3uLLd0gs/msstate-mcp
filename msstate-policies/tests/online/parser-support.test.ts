import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSupportPageHtml } from "../../src/online/parser.js";

const here = dirname(fileURLToPath(import.meta.url));
function fixture(name: string): string {
  return readFileSync(join(here, "..", "fixtures", "online", name), "utf8");
}

const SUPPORT_FIXTURES: Array<{ slug: string; file: string }> = [
  { slug: "state-authorization", file: "state-authorization.html" },
  { slug: "military-assistance", file: "military-assistance.html" },
  { slug: "orientation", file: "orientation.html" },
  { slug: "faq", file: "faq.html" },
  { slug: "financial-matters", file: "financial-matters.html" },
];

describe("parseSupportPageHtml", () => {
  for (const { slug, file } of SUPPORT_FIXTURES) {
    test(`${slug}: title + non-empty body ≥ 200 chars`, () => {
      const page = parseSupportPageHtml(
        fixture(file),
        slug,
        `https://www.online.msstate.edu/${slug}`,
      );
      assert.equal(page.slug, slug);
      assert.ok(page.title.length > 0, `empty title for ${slug}`);
      assert.ok(page.body_markdown.length >= 200, `body too short for ${slug}: ${page.body_markdown.length}`);
      assert.equal(page.url, `https://www.online.msstate.edu/${slug}`);
    });
  }
  test("returns slug/url even on empty input", () => {
    const page = parseSupportPageHtml(
      "<html><body><h1>Hi</h1></body></html>",
      "test",
      "https://www.online.msstate.edu/test",
    );
    assert.equal(page.slug, "test");
    assert.equal(page.url, "https://www.online.msstate.edu/test");
  });
});
