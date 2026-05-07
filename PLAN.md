# MSU Policies MCP Server — Plan

## Context

The user wants an MCP server analogous to [`chrisryugj/korean-law-mcp`](https://github.com/chrisryugj/korean-law-mcp), but for **Mississippi State University Operating Policies** at <https://www.policies.msstate.edu/current>. The repo `msstate-mcp` is empty (no commits) on branch `claude/msu-policies-mcp-UlB5L`.

**Primary user goal — clarified:** a student/staffer asks their Claude things like *"what are the rules on amnesty?"* or *"what's the policy on withdrawal?"*, and Claude answers **strictly from the official MSU policy text** the MCP returns. The architecture should mirror `korean-law-mcp`: expose **search + fetch primitives** (so the LLM does retrieval-then-read itself), plus one **"chain"** tool that bundles search→fetch into a single call for one-shot questions. Grounding then arises naturally — the LLM has nothing to answer from except policy text the MCP just returned.

End users will run the server locally (Claude Desktop, Cursor, etc.) so it can reach the MSU site. The user uploaded a saved copy of `/current` so we have ground truth on the markup; the scraper is now written against verified selectors rather than guesses.

### Verified site structure (from uploaded HTML)

- Index page is a Drupal view with one table `<table id="datatable">`.
- Each `<tr>` has six cells: `Number` (e.g. `01.01`), `Title` (links to `/policy/{slug}` where slug is the 4-digit concatenation, e.g. `0101`), `Status` (`<span class="badge bg-success">Current</span>`), `Date Authored` (`<time datetime="ISO">`), `Attachment` (yes/no), `Download` (`<a class="btn-download" href="/sites/www.policies.msstate.edu/files/policies/{slug}.pdf">`).
- **Policy text lives in the PDF**, not on the landing page. The landing page only shows metadata + a download button. So `get_policy` must download and parse the PDF.
- Filters: `<select name="volume">` (9 volumes, Drupal IDs 36–44, labels `Volume I … Volume IX`) and `<select name="section">` (35 sections, IDs 1–35, e.g. `Academic OP/Faculty`, `Intercollegiate Athletics`). `list_by_volume` / `list_by_section` issue a fresh request to `/current?volume={id}` or `/current?section={id}` and re-parse the same `#datatable`.
- Volume/section is **not** inferable from the policy number prefix (e.g. `01.02 Sports Wagering` is Athletics, not Presidential Matters). Membership comes from the filtered request.
- Policy numbers are **NN.NN** (regex `^\d{2}\.\d{2}$`), 4 digits total. Slug = number with dot stripped.

Reference repo summary (verified via WebFetch):
- TypeScript + `@modelcontextprotocol/sdk`
- Wraps a remote data source, exposes ~15 tools, uses TTL caching, runs over stdio (and optionally HTTP)
- Configured into Claude Desktop via JSON server declaration

## Distribution — dual mode (plugin + plain MCP)

End users land in two camps:
- **Claude Code users** → install via `/plugin marketplace add mminsub11/msstate-mcp` then `/plugin install msstate-policies@msstate-mcp`. Two commands, no JSON editing.
- **Claude Desktop / Cursor / Windsurf / Zed / claude.ai connector users** → can't use Claude Code plugins, so they need the plain MCP-server path: `npx msstate-policies-mcp` (or `node dist/index.js`) plus a config snippet they paste into their MCP-client config.

Both paths run **the same `dist/index.js`**. The repo therefore plays two roles simultaneously:
- The **repo root** is a Claude Code *marketplace* (`.claude-plugin/marketplace.json`).
- The `msstate-policies/` subdir is *both* the plugin (`.claude-plugin/plugin.json` inside it) *and* a publishable npm package (its own `package.json`).

To make the plugin path work without a separate `npm install` on the user's machine, the build **bundles all dependencies into a single `dist/index.js`** with esbuild, and that `dist/` is **committed to the repo** (otherwise `${CLAUDE_PLUGIN_ROOT}/dist/index.js` wouldn't exist after `claude plugin install` clones the repo). For the npm/npx path the same bundle is what gets published.

## Stack & Layout

- **Language:** TypeScript, Node ≥ 18 (uses global `fetch`)
- **MCP SDK:** `@modelcontextprotocol/sdk` (stdio transport)
- **Parsing:** `cheerio` for HTML, `pdf-parse` for the actual policy PDFs. (Bundling pdf-parse safely: import its inner module `pdf-parse/lib/pdf-parse.js` to skip the index file's test-PDF loader, or mark it `external` in esbuild and ship the small node_modules subtree alongside the bundle.) Turndown is no longer needed since policy bodies are PDFs, not HTML.
- **Validation:** `zod` for runtime input validation; JSON schemas for `tools/list` are hand-written.
- **Bundling:** `esbuild` → single `dist/index.js`, committed to repo.
- **TTLs (mirroring korean-law-mcp):** search/index results cached **1 h**, individual policy bodies cached **24 h**. In-memory by default; opt-in disk cache under `~/.cache/msstate-policies-mcp/` keyed by URL hash so cold-start questions are also fast.

```
msstate-mcp/                              # repo root = Claude Code marketplace
├── .claude-plugin/
│   └── marketplace.json                  # marketplace manifest
├── README.md                             # both install paths
├── LICENSE
├── .gitignore                            # ignores node_modules/, NOT dist/
├── examples/
│   └── claude_desktop_config.json
└── msstate-policies/                     # the plugin == the npm package
    ├── .claude-plugin/
    │   └── plugin.json                   # plugin manifest (mcpServers entry)
    ├── package.json                      # publishable to npm; bin: dist/index.js
    ├── tsconfig.json                     # typecheck only (noEmit)
    ├── build.mjs                         # esbuild bundler
    ├── README.md                         # plugin-local readme
    ├── dist/
    │   └── index.js                      # COMMITTED bundle (so plugin install works)
    └── src/
        ├── index.ts          # MCP server entry (stdio)
        ├── types.ts          # PolicyEntry, PolicyDocument, PolicyIndex
        ├── cache.ts          # TTLCache<T>
        ├── scraper.ts        # fetchIndex(), fetchPolicy(), html→markdown
        ├── search.ts         # tokenize + score (title×3, number×2, body×1)
        ├── corpus.ts         # lazy body fetches with concurrency-4 + disk cache
        └── tools/
            ├── search_policies.ts
            ├── get_policy.ts
            ├── chain_find_relevant.ts   # search + auto-get top-k full bodies
            ├── list_by_volume.ts
            ├── list_by_section.ts
            ├── find_by_topic.ts
            ├── get_recent_changes.ts
            ├── get_policy_history.ts
            └── cite_policy.ts
```

## Tools (8 — 7 originals + 1 chain, mirroring korean-law-mcp's primitives + chain pattern)

All tools call into `scraper` + `search`; index is fetched on first use, then cached.

The pattern is intentional: the LLM uses **`search_policies` → `get_policy`** when it wants to think iteratively, and uses **`chain_find_relevant_policies`** for one-shot natural-language questions where it just needs the relevant policy text dumped in front of it. Either way, the LLM only sees official MSU text, so its answer is grounded.

| Tool | Input | Behavior |
|---|---|---|
| `search_policies` | `{ query: string, limit?: number = 10, include_body?: boolean = false }` | Token-match `query` against title + number (and body if `include_body`). Returns ranked list with number, title, url, snippet. (Korean-law-mcp analog: `search_law`.) |
| `get_policy` | `{ number?: string, url?: string }` | Resolve number (e.g. `"91.100"`) via index → URL, fetch, extract text (HTML or PDF), parse metadata (effective/revised/responsible-office). Returns full `PolicyDocument`. (Analog: `get_law_text`.) |
| **`chain_find_relevant_policies`** *(chain)* | `{ question: string, k?: number = 3 }` | One-call workflow for natural-language questions. Runs `search_policies` against title+number+body, picks top-`k`, fetches each full body, returns an array of `PolicyDocument` objects. The LLM then answers using only this returned text. (Analog: `chain_full_research`.) |
| `list_by_volume` | `{ volume?: string }` | No volume → return the 9 volumes (`Volume I … Volume IX`) with their labels and ID counts. With volume (label or roman numeral) → re-fetch `/current?volume={id}` and return that subset. |
| `list_by_section` | `{ section?: string }` | Same shape, against the 35 sections (e.g. `"Intercollegiate Athletics"`). Re-fetches `/current?section={id}` for the chosen section. |
| `find_by_topic` | `{ topic: string, limit?: number = 10 }` | Same scoring as `search_policies` but always full-text (forces body fetch via `corpus.ts`). Useful when the LLM's keywords are conceptual ("firearms", "pets") and unlikely to appear in a title. |
| `get_recent_changes` | `{ since: string (ISO date), limit?: number }` | Filter policies whose `lastUpdated`/`lastRevisedDate` ≥ `since`. Falls back to per-policy fetch when index lacks dates. |
| `get_policy_history` | `{ number: string }` | Parse and return the history block (revision dates, supersedes notes) from a policy page. Empty array if not present. |
| `cite_policy` | `{ number: string, style?: "short" \| "full" }` | Formatted citation, e.g. `Mississippi State University Operating Policy 91.100, "Title", effective YYYY-MM-DD. Retrieved from {url} on {today}.` |

## Scraper Design

### Index fetch (`scraper.fetchIndex({ volumeId?, sectionId? })`)
1. GET `https://www.policies.msstate.edu/current` (with optional `?volume={id}` or `?section={id}`) using a desktop User-Agent.
2. cheerio: select `#datatable tbody tr`. For each row:
   - `td:nth-child(1)` text → `number` (e.g. `"01.01"`). Skip rows that don't match `/^\d{2}\.\d{2}$/`.
   - `td:nth-child(2) a` → `title` (link text) and `landingUrl` (resolve `href="/policy/0101"` → absolute).
   - `td:nth-child(3) .badge` text → `status` (`"Current"`, etc.).
   - `td:nth-child(4) time[datetime]` → `lastUpdated` (already ISO).
   - `td:last-child a.btn-download` href → `pdfUrl` (resolved absolute). If absent, skip.
   - `slug` = number with dot removed (`"0101"`).
3. Also parse the volume + section dropdowns once (`select[name="volume"] option`, `select[name="section"] option`) to populate `volumes` and `sections` lookup tables (id ↔ label).
4. Cache 1 h per `{volumeId, sectionId}` key.

### Policy fetch (`scraper.fetchPolicy(numberOrSlug)`)
1. Look up the entry in the index → `pdfUrl`.
2. GET the PDF as a binary blob.
3. Run `pdf-parse` (inner-module import) → text. Strip excessive whitespace, normalize line breaks.
4. Pull metadata from the first ~50 lines via labelled patterns: `Policy Number:`, `Effective Date:`, `Reviewed:`, `Last Revised:`, `Responsible Office:`, `Approved By:`. PDF formatting varies, so each label match is best-effort and tolerates leading whitespace / colons.
5. Inherit `title`, `lastUpdated`, `landingUrl` from the index entry.
6. Cache 24 h per slug. If the PDF returns 404 (rare — superseded), fall back to the landing page (`/policy/{slug}`) and extract any visible body text.

## MCP Wiring (`src/index.ts`)
- Create `Server` from `@modelcontextprotocol/sdk/server/index.js`.
- Register `ListToolsRequestSchema` returning all 8 tools with hand-written JSON schemas (zod is used internally for runtime validation).
- Register `CallToolRequestSchema` dispatching to the tool modules.
- Connect `StdioServerTransport`.
- **Tool descriptions matter** — write each one in a way that nudges the LLM to prefer `chain_find_relevant_policies` for "what's the rule on X?" questions and to cite policy number + URL in its final answer. (This is the only "grounding" nudge; the actual constraint is that the tools only ever return MSU text.)

## Config Examples (in README + `examples/`)

**Path A — Claude Code (plugin):**
```bash
/plugin marketplace add mminsub11/msstate-mcp
/plugin install msstate-policies@msstate-mcp
```

**Path B — Claude Desktop / Cursor / Windsurf / Zed (plain MCP):**
```jsonc
{
  "mcpServers": {
    "msstate-policies": {
      "command": "npx",
      "args": ["-y", "msstate-policies-mcp"]
    }
  }
}
```

Also documented: pointing at a local checkout (`node /path/to/msstate-policies/dist/index.js`).

## Manifests

`.claude-plugin/marketplace.json` (repo root):
```json
{
  "name": "msstate-mcp",
  "owner": { "name": "mminsub11" },
  "plugins": [
    {
      "name": "msstate-policies",
      "source": "./msstate-policies",
      "description": "Mississippi State University Operating Policies via MCP."
    }
  ]
}
```

`msstate-policies/.claude-plugin/plugin.json`:
```json
{
  "name": "msstate-policies",
  "version": "0.1.0",
  "description": "Mississippi State University Operating Policies via MCP.",
  "mcpServers": {
    "msstate-policies": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/index.js"]
    }
  }
}
```

## Critical Files to Create

- `package.json`, `tsconfig.json`, `.gitignore` — already scaffolded during pre-plan exploration; will overwrite if needed.
- `src/types.ts`, `src/cache.ts` — already scaffolded; both safe.
- `src/scraper.ts` — the only piece that depends on actual HTML structure; **isolate all selectors/regexes at the top** so it's a one-file fix if MSU changes layout.
- `src/search.ts` — simple lowercase token scoring (Σ token hits in title × 3 + number × 2 + body × 1).
- `src/tools/*.ts` — one per tool, each exports `{ name, description, inputSchema, handler }`.
- `src/index.ts` — MCP wiring.
- `README.md` — install, config, tool reference, "verifying selectors" troubleshooting section.

## Verification (manual; user will run, since sandbox can't reach MSU)

In `msstate-policies/`:
1. `npm install && npm run build` — produces `dist/index.js`.
2. `npm run typecheck` — clean.
3. Smoke test the bundled server:
   `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js` — expect 9 tools listed.
4. Sanity-check the index parser end-to-end (one-off):
   `node -e "import('./dist/index.js'); /* server starts */"` then in another shell, drive it with the MCP inspector or a manual `tools/call` JSON-RPC. Or call the scraper directly via a tiny REPL script.
5. Plugin path: `/plugin marketplace add ./` (from a Claude Code session in this repo) → `/plugin install msstate-policies` → ask "what's the policy on amnesty?" — Claude should call `chain_find_relevant_policies`, get full policy text(s), and answer citing OP number + URL.
6. MCP path: drop the JSON snippet from `examples/claude_desktop_config.json` into Claude Desktop, restart, repeat the same question.
7. Commit (including `dist/index.js`) and push to `claude/msu-policies-mcp-UlB5L`.

## Open Risks

- **PDFs are mandatory.** Policy text only exists in PDFs, so `pdf-parse` (or pdfjs-dist) is required. Bundling pdf-parse needs the inner-module import (`pdf-parse/lib/pdf-parse.js`) to avoid the test-PDF loader at module init.
- **Rate limiting / WAF.** Use a normal browser UA, small concurrency (4), respect `Retry-After` on 429. PDFs are ~50 KB each so 218 of them ≈ 10 MB if we ever fully warm the corpus — fine.
- **History/superseded versions** are not in the `/current` table (it filters to Current only). Tool returns an empty history array for v1; can revisit by fetching `/policies` or per-policy revision pages later.
- **Committed `dist/`.** Bundle is committed so the plugin path works without `npm install`. Every dep upgrade → rebuild + commit. Documented in README.
- **Bundle size.** cheerio + zod + MCP SDK + pdf-parse ≈ 2–3 MB minified. Acceptable.
- **`get_policy_history` and `find_by_topic`** both require body fetches; first call warms the cache lazily with concurrency 4.
