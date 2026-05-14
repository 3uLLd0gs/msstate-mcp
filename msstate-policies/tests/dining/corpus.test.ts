import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  setDiningCorpus,
  getDiningCorpus,
  listAllDiningLocations,
  getDiningLocationBySlug,
  diningCorpusHealth,
} from "../../src/dining/corpus.js";
import type { DiningCorpus } from "../../src/dining/types.js";

const SAMPLE: DiningCorpus = {
  builtAt: "2026-05-14T09:00:00.000Z",
  source: "https://msstatedining.mydininghub.com/",
  locations: [
    {
      slug: "perry-food-hall",
      name: "Perry Food Hall",
      url: "https://msstatedining.mydininghub.com/en/location/perry-food-hall",
      hours_by_day: [],
      hours_today: null,
      hours_raw_text: "",
      meal_periods_today: [],
      parse_warnings: [],
      retrieved_at: "2026-05-14T09:00:00.000Z",
    },
  ],
};

describe("dining/corpus", () => {
  test("setDiningCorpus + getters round-trip", () => {
    setDiningCorpus(SAMPLE);
    assert.equal(getDiningCorpus()?.builtAt, SAMPLE.builtAt);
    assert.equal(listAllDiningLocations().length, 1);
  });

  test("getDiningLocationBySlug returns the matching record", () => {
    setDiningCorpus(SAMPLE);
    const l = getDiningLocationBySlug("perry-food-hall");
    assert.ok(l);
    assert.equal(l.name, "Perry Food Hall");
  });

  test("getDiningLocationBySlug returns null for unknown", () => {
    setDiningCorpus(SAMPLE);
    assert.equal(getDiningLocationBySlug("does-not-exist"), null);
  });

  test("diningCorpusHealth reports loaded + count", () => {
    setDiningCorpus(SAMPLE);
    const h = diningCorpusHealth();
    assert.equal(h.loaded, true);
    assert.equal(h.location_count, 1);
    assert.equal(h.builtAt, SAMPLE.builtAt);
  });

  test("diningCorpusHealth reports loaded=true after set, with non-negative count", () => {
    setDiningCorpus(SAMPLE);
    const h = diningCorpusHealth();
    assert.equal(h.loaded, true);
    assert.ok(h.location_count >= 0);
  });
});
