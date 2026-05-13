import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { list_msu_emergency_types } from "../../src/tools/list_msu_emergency_types.js";
import { setEmergencyCorpus } from "../../src/emergency/corpus.js";
import { EXPECTED_GUIDELINE_SLUGS, MANDATORY_DISCLAIMER, type EmergencyCorpus } from "../../src/emergency/types.js";

const CORPUS: EmergencyCorpus = {
  builtAt: "2026-05-13T00:00:00Z",
  source: "https://www.emergency.msstate.edu/",
  guidelines: EXPECTED_GUIDELINE_SLUGS.map((slug) => ({
    slug,
    title: slug,
    url: `https://www.emergency.msstate.edu/guidelines/${slug}`,
    body_markdown: "stub",
    aliases: [],
    retrieved_at: "2026-05-13T00:00:00Z",
  })),
  refuge_areas: [],
  contacts: [],
};

before(() => setEmergencyCorpus(CORPUS));

describe("list_msu_emergency_types", () => {
  test("returns all 12 guidelines with disclaimer", async () => {
    const res = await list_msu_emergency_types.handler({});
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.disclaimer, MANDATORY_DISCLAIMER);
    assert.equal(parsed.types.length, 12);
    assert.equal(parsed.types[0].slug, EXPECTED_GUIDELINE_SLUGS[0]);
  });
});
