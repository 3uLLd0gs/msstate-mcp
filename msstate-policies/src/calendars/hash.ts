import { createHash } from "node:crypto";

/** SHA-256 hex of a canonical pipe-joined event identity. Stable across
 *  builds; missing fields normalize to empty strings so an undefined `term`
 *  and an empty-string `term` produce the same hash. Used as the vector
 *  lookup key in the embedding sidecar. */
export function contentHash(row: {
  event: string;
  term?: string;
  description?: string;
}): string {
  const canon = `${row.event}|${row.term ?? ""}|${row.description ?? ""}`;
  return createHash("sha256").update(canon, "utf8").digest("hex");
}
