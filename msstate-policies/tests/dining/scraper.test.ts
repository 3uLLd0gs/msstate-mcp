import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scrapeAllDining,
  isAllowedDiningUrl,
  type PlaywrightLike,
} from "../../src/dining/scraper.js";

const here = dirname(fileURLToPath(import.meta.url));
function fixture(name: string): string {
  return readFileSync(join(here, "..", "fixtures", "dining", name), "utf8");
}

const SITEMAP = fixture("en-sitemap.html");
const PERRY = fixture("rendered-perry.html");

async function stubFetch(url: string): Promise<string> {
  if (url === "https://msstatedining.mydininghub.com/en/sitemap") return SITEMAP;
  return "<html></html>";
}

function makeStubPlaywright(perryHtml: string): PlaywrightLike {
  return {
    chromium: {
      launch: async () => ({
        newContext: async () => ({
          newPage: async () => ({
            goto: async (_url: string) => {},
            waitForLoadState: async () => {},
            waitForSelector: async () => {},
            waitForTimeout: async () => {},
            evaluate: async () => {},
            content: async () => perryHtml,
            getByRole: () => ({
              count: async () => 1,
              first: () => ({
                click: async () => {},
              }),
            }),
            close: async () => {},
          }),
          close: async () => {},
        }),
        close: async () => {},
      }),
    },
  };
}

describe("isAllowedDiningUrl", () => {
  test("accepts DINING_ROOTS exactly", () => {
    assert.ok(isAllowedDiningUrl("https://dining.msstate.edu/"));
    assert.ok(isAllowedDiningUrl("https://msstatedining.mydininghub.com/"));
  });

  test("accepts /en/sitemap on Touchpoint", () => {
    assert.ok(isAllowedDiningUrl("https://msstatedining.mydininghub.com/en/sitemap"));
  });

  test("accepts a slug from a provided allowlist", () => {
    assert.ok(
      isAllowedDiningUrl(
        "https://msstatedining.mydininghub.com/en/location/perry-food-hall",
        new Set(["perry-food-hall", "chick-fil-a"]),
      ),
    );
  });

  test("rejects unknown slug without allowlist", () => {
    assert.equal(
      isAllowedDiningUrl("https://msstatedining.mydininghub.com/en/location/foo-bar"),
      false,
    );
  });

  test("rejects non-allowed host", () => {
    assert.equal(isAllowedDiningUrl("https://evil.example.com/en/location/foo"), false);
  });

  test("rejects http (non-TLS)", () => {
    assert.equal(isAllowedDiningUrl("http://msstatedining.mydininghub.com/en/sitemap"), false);
  });
});

describe("scrapeAllDining", () => {
  test("produces locations with retrieved_at populated", async () => {
    const playwright = makeStubPlaywright(PERRY);
    const r = await scrapeAllDining({ playwright, fetchHtml: stubFetch });
    assert.ok(r.locations.length >= 1);
    for (const l of r.locations) {
      assert.match(l.retrieved_at, /^\d{4}-\d{2}-\d{2}T/);
    }
  });

  test("anyError=false on happy path", async () => {
    const playwright = makeStubPlaywright(PERRY);
    const r = await scrapeAllDining({ playwright, fetchHtml: stubFetch });
    assert.equal(r.anyError, false);
  });

  test("anyError=true when sitemap fetch fails", async () => {
    const playwright = makeStubPlaywright(PERRY);
    const failingFetch = async (url: string): Promise<string> => {
      if (url.endsWith("/en/sitemap")) throw new Error("HTTP 500");
      return stubFetch(url);
    };
    const r = await scrapeAllDining({ playwright, fetchHtml: failingFetch });
    assert.equal(r.anyError, true);
  });
});
