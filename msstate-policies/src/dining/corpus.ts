/**
 * Dining corpus loader.
 *
 * Stdio (npx plugin): bake the corpus into dist/index.js via esbuild's
 * `define`. Server startup reads __DINING_CORPUS__ and calls setDiningCorpus.
 *
 * Worker: corpus.json is imported by worker/src/index.ts; mirrored logic lives
 * inline there. This module is the stdio side of the same data.
 *
 * IMPORTANT: We do NOT use `import.meta.url` here. esbuild's CJS output shims
 * import.meta to `{}` (caused the v1.0.0/v1.0.1 calendars regression that
 * shipped silently for two releases). Module-scope state via plain variables
 * is bundle-safe.
 */
import type {
  DiningCorpus,
  DiningLocation,
} from "./types.js";

let CORPUS: DiningCorpus | null = null;

export function setDiningCorpus(c: DiningCorpus): void {
  CORPUS = c;
}

export function getDiningCorpus(): DiningCorpus | null {
  return CORPUS;
}

export function listAllDiningLocations(): DiningLocation[] {
  return CORPUS?.locations ?? [];
}

export function getDiningLocationBySlug(slug: string): DiningLocation | null {
  if (!CORPUS) return null;
  return CORPUS.locations.find((l) => l.slug === slug) ?? null;
}

export interface DiningCorpusHealth {
  loaded: boolean;
  location_count: number;
  builtAt: string | null;
}

export function diningCorpusHealth(): DiningCorpusHealth {
  if (!CORPUS) return { loaded: false, location_count: 0, builtAt: null };
  return {
    loaded: true,
    location_count: CORPUS.locations.length,
    builtAt: CORPUS.builtAt,
  };
}
