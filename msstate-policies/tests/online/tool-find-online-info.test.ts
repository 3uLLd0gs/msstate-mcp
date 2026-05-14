import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { find_online_info } from "../../src/tools/find_online_info.js";
import { setOnlineCorpus } from "../../src/online/corpus.js";
import { ONLINE_DISCLAIMER, MAX_QUERY_CHARS } from "../../src/online/types.js";
import type { OnlineCorpus } from "../../src/online/types.js";

const SAMPLE: OnlineCorpus = {
  builtAt: "x", source: "https://www.online.msstate.edu/",
  programs: [],
  admissions_process: { url: "x", central_contact: { name: "x", title: "x", email: null, phone: null }, shared_prelude: "", sections: { undergraduate: "", graduate: "", transfer: "", readmit: "", international: "" }, application_fee_tiers: [], external_apply_urls: [], retrieved_at: "x" },
  staff: [{ name: "Jane Doe", title: "Director", email: "jdoe@msstate.edu", phone: null, office: "Office of Online Education", url: "https://www.online.msstate.edu/staff", retrieved_at: "x" }],
  info_pages: [
    { slug: "state-authorization", title: "State Authorization", url: "https://www.online.msstate.edu/state-authorization", body_markdown: "MSU Online operates in many states but not California or Massachusetts.", retrieved_at: "x" },
    { slug: "military-assistance", title: "Military Assistance", url: "https://www.online.msstate.edu/military-assistance", body_markdown: "MSU offers tuition assistance for service members and veterans.", retrieved_at: "x" },
    { slug: "orientation", title: "Orientation", url: "https://www.online.msstate.edu/orientation", body_markdown: "Welcome to MSU Online orientation. Honorlock proctoring info is here.", retrieved_at: "x" },
    { slug: "faq", title: "FAQ", url: "https://www.online.msstate.edu/faq", body_markdown: "Frequently asked questions about MSU Online.", retrieved_at: "x" },
    { slug: "financial-matters", title: "Financial Matters", url: "https://www.online.msstate.edu/financial-matters", body_markdown: "Financial aid and billing for MSU Online students.", retrieved_at: "x" },
  ],
};

async function call(args: unknown) {
  const res = await find_online_info.handler(args);
  return JSON.parse((res.content[0] as { text: string }).text);
}

describe("find_online_info", () => {
  test("returns disclaimer + top-k matches", async () => {
    setOnlineCorpus(SAMPLE);
    const r = await call({ q: "state authorization" });
    assert.equal(r.disclaimer, ONLINE_DISCLAIMER);
    assert.ok(r.matches.length >= 1);
    assert.equal(r.matches[0].slug, "state-authorization");
  });
  test("scope filter limits to one slug", async () => {
    setOnlineCorpus(SAMPLE);
    const r = await call({ q: "MSU", scope: "orientation" });
    assert.ok(r.matches.every((m: { slug: string }) => m.slug === "orientation"));
  });
  test("scope=staff searches the staff doc", async () => {
    setOnlineCorpus(SAMPLE);
    const r = await call({ q: "Jane", scope: "staff" });
    assert.ok(r.matches.length >= 1);
    assert.equal(r.matches[0].slug, "staff");
  });
  test("rejects q longer than MAX_QUERY_CHARS", async () => {
    setOnlineCorpus(SAMPLE);
    const long = "x".repeat(MAX_QUERY_CHARS + 1);
    await assert.rejects(() => call({ q: long }));
  });
  test("rejects k > 10 via zod", async () => {
    setOnlineCorpus(SAMPLE);
    await assert.rejects(() => call({ q: "x", k: 20 }));
  });
});
