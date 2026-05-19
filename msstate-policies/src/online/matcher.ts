/**
 * Pure scoring + cost-estimation helpers over the OnlineCorpus.
 * No I/O, no MCP types. Imported by both the stdio tool wrappers and the
 * Worker mirror.
 *
 * Corpus rule (CLAUDE.md): never substitute training data for a missing
 * field. When a required input is null, emit a note and return null totals.
 */
import type {
  OnlineProgram,
  CostEstimate,
  DegreeLevel,
} from "./types.js";

function defaultCreditsFor(level: DegreeLevel): { credits: number; source: CostEstimate["credits_source"] } {
  switch (level) {
    case "bachelor":     return { credits: 120, source: "default_bachelor_120" };
    case "doctoral":     return { credits: 60,  source: "default_doctoral_60" };
    case "certificate":  return { credits: 30,  source: "default_certificate_30" };
    // master + specialist + endorsement fall through to the master default
    // (see comment on CostEstimate.credits_source in types.ts for why).
    default:             return { credits: 30,  source: "default_master_30" };
  }
}

export function estimateCost(
  program: OnlineProgram,
  credits: number | null,
  includeApplicationFee: boolean,
): CostEstimate {
  if (credits !== null && credits < 0) {
    throw new Error("credits must be >= 0");
  }
  const notes: string[] = [];
  const used = credits === null
    ? defaultCreditsFor(program.degree_level)
    : { credits, source: "user_supplied" as const };

  const perCredit = program.tuition.per_credit_usd;
  const instructional = program.tuition.instructional_fee_per_credit_usd;
  const applicationFee = program.tuition.application_fee_domestic_usd;

  const tuitionTotal = perCredit !== null ? perCredit * used.credits : null;
  const instructionalTotal = instructional !== null ? instructional * used.credits : null;

  if (perCredit === null) notes.push("per_credit_usd missing on this program's page — total cannot be computed");
  if (instructional === null) notes.push("instructional_fee_per_credit_usd missing — component omitted from total");
  if (credits === null) notes.push(`credits not supplied; defaulted to ${used.credits} for ${program.degree_level} programs`);

  let total: number | null = null;
  if (tuitionTotal !== null) {
    total = tuitionTotal + (instructionalTotal ?? 0);
    if (includeApplicationFee && applicationFee !== null) total += applicationFee;
  }

  return {
    slug: program.slug,
    name: program.name,
    credits_used: used.credits,
    credits_source: used.source,
    per_credit_usd: perCredit,
    instructional_fee_per_credit_usd: instructional,
    application_fee_usd: applicationFee,
    application_fee_included: includeApplicationFee && applicationFee !== null,
    tuition_total_usd: tuitionTotal,
    instructional_fee_total_usd: instructionalTotal,
    total_usd: total,
    notes,
    source_url: program.url,
    raw_prose: program.tuition.raw_prose,
  };
}
