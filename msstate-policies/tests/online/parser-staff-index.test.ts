import { test } from "node:test";
import { strict as assert } from "node:assert";
import { buildStaffToProgramsIndex } from "../../src/online/parser.js";
import type { OnlineProgram, OnlineStaffEntry } from "../../src/online/types.js";

function prog(slug: string, contacts: Array<{ name: string; email: string | null; title: string }>): OnlineProgram {
  return {
    slug,
    name: `Online ${slug.toUpperCase()}`,
    degree_level: "master",
    format: "online",
    short_description: "",
    url: `https://www.online.msstate.edu/program/${slug}`,
    tuition: {
      per_credit_usd: null,
      instructional_fee_per_credit_usd: null,
      application_fee_domestic_usd: null,
      application_fee_international_usd: null,
      raw_prose: "",
    },
    contacts: contacts.map((c) => ({ ...c, phone: null })),
    application_deadlines: [],
    admission_requirements: "",
    entrance_exams: null,
    accreditation: null,
    forms: [],
    raw_sections: {},
    parse_warnings: [],
    retrieved_at: "2026-05-15T00:00:00Z",
  };
}

const STAFF_DIR: OnlineStaffEntry[] = [
  {
    name: "Lily Hudson",
    title: "Enrollment Coordinator",
    email: "lily.hudson@msstate.edu",
    phone: null,
    office: "CDE",
    url: "https://www.online.msstate.edu/staff",
    retrieved_at: "2026-05-15T00:00:00Z",
  },
];

const PROGRAMS: OnlineProgram[] = [
  prog("mba", [
    { name: "Lily Hudson", email: "lily.hudson@msstate.edu", title: "General Program Questions" },
    { name: "Angelia Knight", email: "angelia.knight@msstate.edu", title: "Director, MBA Program" },
  ]),
  prog("msw", [
    { name: "Lily Hudson", email: "lily.hudson@msstate.edu", title: "Enrollment & Onboarding" },
  ]),
];

test("staff appearing on 2 programs gets 2 program refs", () => {
  const idx = buildStaffToProgramsIndex(PROGRAMS, STAFF_DIR);
  const lily = idx.find((s) => s.display_name === "Lily Hudson");
  assert.ok(lily, "Lily Hudson should be in the index");
  assert.equal(lily!.email, "lily.hudson@msstate.edu");
  assert.equal(lily!.programs.length, 2);
  assert.deepEqual(lily!.programs.map((p) => p.slug).sort(), ["mba", "msw"]);
});

test("role_in_program is per-program label", () => {
  const idx = buildStaffToProgramsIndex(PROGRAMS, STAFF_DIR);
  const lily = idx.find((s) => s.display_name === "Lily Hudson")!;
  const mbaRef = lily.programs.find((p) => p.slug === "mba")!;
  const mswRef = lily.programs.find((p) => p.slug === "msw")!;
  assert.equal(mbaRef.role_in_program, "General Program Questions");
  assert.equal(mswRef.role_in_program, "Enrollment & Onboarding");
});

test("role enriched from staff_directory when email matches", () => {
  const idx = buildStaffToProgramsIndex(PROGRAMS, STAFF_DIR);
  const lily = idx.find((s) => s.display_name === "Lily Hudson")!;
  assert.equal(lily.role, "Enrollment Coordinator");
});

test("staff with no email keyed by normalized name", () => {
  const noEmail: OnlineProgram[] = [
    prog("test", [{ name: "Anonymous Person", email: null, title: "TA" }]),
  ];
  const idx = buildStaffToProgramsIndex(noEmail, []);
  assert.equal(idx.length, 1);
  assert.equal(idx[0].display_name, "Anonymous Person");
  assert.equal(idx[0].email, null);
});

test("longest spelling wins on dedup (Sam vs Samantha with same email)", () => {
  const dup: OnlineProgram[] = [
    prog("a", [{ name: "Sam Clardy", email: "sam@msstate.edu", title: "Coach" }]),
    prog("b", [{ name: "Samantha Clardy", email: "sam@msstate.edu", title: "Coach" }]),
  ];
  const idx = buildStaffToProgramsIndex(dup, []);
  assert.equal(idx.length, 1);
  assert.equal(idx[0].display_name, "Samantha Clardy");
  assert.equal(idx[0].programs.length, 2);
});
