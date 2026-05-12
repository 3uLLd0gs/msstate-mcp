/** Reciprocal Rank Fusion: score(d) = Σ_L 1 / (k + rank_L(d)), summed
 *  over each list L that contains d. k=60 is the Cormack et al. canonical
 *  value. Returns IDs sorted by score desc, deduplicated, capped at limit. */
export function reciprocalRankFusion(
  rankedLists: readonly (readonly string[])[],
  k = 60,
  limit = 10,
): string[] {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i++) {
      const rank = i + 1;
      const id = list[i];
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}
