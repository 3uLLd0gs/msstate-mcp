import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { get_msu_dining_hours } from "../../src/tools/get_msu_dining_hours.js";
import { setDiningCorpus } from "../../src/dining/corpus.js";
import { DINING_DISCLAIMER } from "../../src/dining/types.js";
import type { DiningCorpus, DiningLocation } from "../../src/dining/types.js";

function loc(slug: string, name: string): DiningLocation {
  return {
    slug, name,
    url: `https://msstatedining.mydininghub.com/en/location/${slug}`,
    hours_by_day: [], hours_today: null, hours_raw_text: "",
    meal_periods_today: [], parse_warnings: [],
    retrieved_at: "x",
  };
}

function corpus(locations: DiningLocation[]): DiningCorpus {
  return {
    builtAt: "2026-05-14T09:00:00.000Z",
    source: "https://msstatedining.mydininghub.com/",
    locations,
  };
}

async function call(args: unknown) {
  const res = await get_msu_dining_hours.handler(args);
  return JSON.parse((res.content[0] as { text: string }).text);
}

describe("get_msu_dining_hours", () => {
  test("slug match returns full record + disclaimer", async () => {
    setDiningCorpus(corpus([loc("perry-food-hall", "Perry Food Hall")]));
    const r = await call({ slug: "perry-food-hall" });
    assert.equal(r.disclaimer, DINING_DISCLAIMER);
    assert.equal(r.matched?.slug, "perry-food-hall");
    assert.deepEqual(r.did_you_mean, []);
  });

  test("unknown slug returns null + not_found_reason", async () => {
    setDiningCorpus(corpus([loc("perry-food-hall", "Perry Food Hall")]));
    const r = await call({ slug: "xyz" });
    assert.equal(r.matched, null);
    assert.ok(r.not_found_reason);
  });

  test("name_query routes via fuzzy resolver", async () => {
    setDiningCorpus(corpus([
      loc("perry-food-hall", "Perry Food Hall"),
      loc("chick-fil-a", "Chick-fil-A"),
    ]));
    const r = await call({ name_query: "chickfila" });
    assert.equal(r.matched?.slug, "chick-fil-a");
  });

  test("rejects both slug and name_query set", async () => {
    setDiningCorpus(corpus([loc("a", "A")]));
    await assert.rejects(() => call({ slug: "a", name_query: "a" }));
  });

  test("rejects neither slug nor name_query set", async () => {
    setDiningCorpus(corpus([loc("a", "A")]));
    await assert.rejects(() => call({}));
  });
});
