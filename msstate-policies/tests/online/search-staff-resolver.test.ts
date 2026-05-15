import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolveStaff, suggestStaff, trigramScore } from "../../src/online/search.js";
import type { StaffEntry } from "../../src/online/types.js";

function s(name: string, email: string | null, role = "", programs: string[] = []): StaffEntry {
  return {
    display_name: name,
    email,
    role,
    programs: programs.map((slug) => ({ slug, name: slug.toUpperCase(), role_in_program: "Advisor" })),
  };
}

const INDEX: StaffEntry[] = [
  s("Lily Hudson", "lily.hudson@msstate.edu", "Coordinator", ["mba", "msw"]),
  s("Angelia Knight", "angelia.knight@msstate.edu", "Director, MBA Program", ["mba"]),
  s("Bob Knight", "bob.knight@msstate.edu", "Coach, MSW Program", ["msw"]),
  s("Élise Lamontagne", "elise.lamontagne@msstate.edu", "Advisor", ["psychology"]),
];

test("email exact match", () => {
  const r = resolveStaff(INDEX, "lily.hudson@msstate.edu");
  assert.equal(r.length, 1);
  assert.equal(r[0].display_name, "Lily Hudson");
  assert.equal(r[0].match_kind, "email");
});

test("email case-insensitive", () => {
  const r = resolveStaff(INDEX, "LILY.HUDSON@msstate.edu");
  assert.equal(r.length, 1);
});

test("first name substring", () => {
  const r = resolveStaff(INDEX, "Lily");
  assert.equal(r.length, 1);
  assert.equal(r[0].display_name, "Lily Hudson");
  assert.equal(r[0].match_kind, "substring");
});

test("last name substring matches both Knights (ambiguous)", () => {
  const r = resolveStaff(INDEX, "Knight");
  assert.equal(r.length, 2);
  const names = r.map((x) => x.display_name).sort();
  assert.deepEqual(names, ["Angelia Knight", "Bob Knight"]);
});

test("no match returns empty array, caller responsible for did_you_mean", () => {
  const r = resolveStaff(INDEX, "NoSuchPerson");
  assert.deepEqual(r, []);
});

test("diacritic-normalized name match", () => {
  const r = resolveStaff(INDEX, "Elise");
  assert.equal(r.length, 1);
  assert.equal(r[0].display_name, "Élise Lamontagne");
});

test("suggestStaff returns up to 3 closest names for unknown query", () => {
  const sug = suggestStaff(INDEX, "Lilly Hudsen");  // typo
  assert.ok(sug.length >= 1, "should suggest at least 1 name");
  assert.ok(sug.includes("Lily Hudson"), `expected 'Lily Hudson' in suggestions, got: ${JSON.stringify(sug)}`);
  assert.ok(sug.length <= 3, "should cap at 3");
});

test("suggestStaff returns empty array for very short queries", () => {
  const sug = suggestStaff(INDEX, "x");
  assert.deepEqual(sug, []);
});

test("trigramScore between similar names is high", () => {
  // "lily hudson" vs "lily huson" (typo) should score > 0.4
  assert.ok(trigramScore("lily hudson", "lily huson") > 0.4);
});

test("trigramScore between unrelated names is low", () => {
  assert.ok(trigramScore("lily hudson", "bob knight") < 0.2);
});

test("trigramScore identical strings", () => {
  assert.equal(trigramScore("lily hudson", "lily hudson"), 1);
});
