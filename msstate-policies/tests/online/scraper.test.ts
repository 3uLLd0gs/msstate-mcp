import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scrapeAllOnline,
  isAllowedOnlineUrl,
  detectOnlineWaf,
} from "../../src/online/scraper.js";

const here = dirname(fileURLToPath(import.meta.url));
function fixture(name: string): string {
  return readFileSync(join(here, "..", "fixtures", "online", name), "utf8");
}

const STUB: Record<string, string> = {
  "https://www.online.msstate.edu/academic-programs": fixture("academic-programs.html"),
  "https://www.online.msstate.edu/admissions-process": fixture("admissions-process.html"),
  "https://www.online.msstate.edu/staff": fixture("staff.html"),
  "https://www.online.msstate.edu/state-authorization": fixture("state-authorization.html"),
  "https://www.online.msstate.edu/military-assistance": fixture("military-assistance.html"),
  "https://www.online.msstate.edu/orientation": fixture("orientation.html"),
  "https://www.online.msstate.edu/faq": fixture("faq.html"),
  "https://www.online.msstate.edu/financial-matters": fixture("financial-matters.html"),
  "https://www.online.msstate.edu/mba": fixture("program-mba.html"),
  "https://www.online.msstate.edu/bsee": fixture("program-bsee.html"),
  "https://www.online.msstate.edu/psychology": fixture("program-psychology.html"),
  "https://www.online.msstate.edu/adcn": fixture("program-cert-adcn.html"),
};

async function stubFetch(url: string): Promise<string> {
  if (!(url in STUB)) {
    return "<html><body><main><h1>placeholder</h1></main></body></html>";
  }
  return STUB[url];
}

describe("scraper.isAllowedOnlineUrl", () => {
  test("accepts ONLINE_ROOTS exactly", () => {
    assert.ok(isAllowedOnlineUrl("https://www.online.msstate.edu/academic-programs"));
    assert.ok(isAllowedOnlineUrl("https://www.online.msstate.edu/admissions-process"));
    assert.ok(isAllowedOnlineUrl("https://www.online.msstate.edu/staff"));
  });
  test("accepts SUPPORT_PAGE_SLUGS under base", () => {
    for (const slug of ["state-authorization", "military-assistance", "orientation", "faq", "financial-matters"]) {
      assert.ok(isAllowedOnlineUrl(`https://www.online.msstate.edu/${slug}`), slug);
    }
  });
  test("accepts a slug from a provided allowlist", () => {
    assert.ok(isAllowedOnlineUrl("https://www.online.msstate.edu/mba", new Set(["mba", "bsee"])));
  });
  test("rejects unknown slug without an allowlist", () => {
    assert.equal(isAllowedOnlineUrl("https://www.online.msstate.edu/unknown-slug"), false);
  });
  test("rejects non-online subdomain", () => {
    assert.equal(isAllowedOnlineUrl("https://www.policies.msstate.edu/foo"), false);
  });
  test("rejects http (non-TLS)", () => {
    assert.equal(isAllowedOnlineUrl("http://www.online.msstate.edu/staff"), false);
  });
});

describe("scraper.detectOnlineWaf", () => {
  test("flags Cloudflare challenge body", () => {
    assert.equal(detectOnlineWaf("<html>Just a moment...</html>"), true);
  });
  test("clean HTML returns false", () => {
    assert.equal(detectOnlineWaf("<html><body><h1>Online</h1></body></html>"), false);
  });
});

describe("scraper.scrapeAllOnline", () => {
  test("produces programs, admissions_process, staff, info_pages", async () => {
    const r = await scrapeAllOnline({ fetchUrl: stubFetch });
    assert.ok(r.programs.length >= 4, `programs: ${r.programs.length}`);
    assert.equal(r.info_pages.length, 5);
    assert.ok(r.staff.length >= 1);
    assert.equal(r.admissions_process.url, "https://www.online.msstate.edu/admissions-process");
    assert.equal(r.anyError, false);
  });
  test("each program has retrieved_at set", async () => {
    const r = await scrapeAllOnline({ fetchUrl: stubFetch });
    for (const p of r.programs) {
      assert.match(p.retrieved_at, /^\d{4}-\d{2}-\d{2}T/);
    }
  });
  test("flags anyError=true when index fetch fails", async () => {
    const broken: typeof stubFetch = async (url) => {
      if (url.endsWith("/academic-programs")) throw new Error("HTTP 500 for /academic-programs");
      return stubFetch(url);
    };
    const r = await scrapeAllOnline({ fetchUrl: broken });
    assert.equal(r.anyError, true);
  });
});
