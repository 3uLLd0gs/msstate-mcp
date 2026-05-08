# msstate-mcp — Mississippi State Operating Policies via MCP

> **Unofficial.** Not affiliated with, endorsed by, or sponsored by Mississippi State University. This server retrieves policy text from the public website at <https://www.policies.msstate.edu/current> for use by an LLM. **Always verify against the official source before acting on the result.**

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets you ask Claude (or Cursor / Windsurf / Zed / claude.ai) natural-language questions about MSU's ~218 current Operating Policies and get answers grounded in the actual policy text.

## What it does

When you ask a question like *"what is MSU's hazing policy?"*, the MCP server:

1. Searches MSU's live policy index for relevant policies.
2. Downloads the official policy PDFs straight from `policies.msstate.edu`.
3. Hands the full text to Claude.
4. Claude answers using **only** that text — quoting verbatim for normative claims and citing the OP number, the canonical landing URL, and the retrieval timestamp.

If no MSU policy applies, Claude is told to refuse plainly rather than fabricate. Every tool response includes the canonical landing URL and an ISO timestamp so you can verify against the official source.

## Install

Pick the path that matches your client.

### Path A — Claude Code

```bash
/plugin marketplace add mminsub11/msstate-mcp
/plugin install msstate-policies@msstate-mcp
```

Two commands, no JSON editing.

### Path B — Claude Desktop, Cursor, Windsurf, Zed

Paste this into your client's MCP-server config:

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

A copy lives at [`examples/claude_desktop_config.json`](examples/claude_desktop_config.json).

### Path C — claude.ai (paid)

Paid claude.ai users can install via the MCP-connector UI using the same `npx -y msstate-policies-mcp` command.

### Path D — Free claude.ai users (no install)

A curated bundle of high-traffic policy PDFs plus a system-prompt template ships as a release asset (`msstate-policies-starter.zip`). Drag-and-drop it into a Claude Project — no install required. Smaller corpus than the live MCP; the live MCP path is recommended where possible.

## Example

You ask:

> *"What is MSU's policy on academic amnesty for undergraduates?"*

Claude calls the MCP, gets OP 12.17, and answers something like:

> MSU's policy on academic amnesty for undergraduates is governed by **AOP 12.17: Undergraduate Academic Fresh-Start or Academic Amnesty**. The policy offers two distinct options:
>
> **Academic Fresh Start:** *"To be eligible for Academic Fresh Start, an individual must be pursuing their first baccalaureate degree and may not have attended Mississippi State University for a period of at least twenty-four consecutive months."* (OP 12.17)
>
> If approved, *"all college credits earned prior to being granted academic fresh start will be eliminated from the computation of the student's grade point average..."*
>
> **Source:** OP 12.17 at <https://www.policies.msstate.edu/policy/1217> (retrieved 2026-05-08).

For questions outside MSU's policy scope (weather, sports scores, recipes), Claude refuses cleanly and points you back to MSU resources.

## Tools

The MCP exposes 5 tools:

| Tool | Purpose |
|---|---|
| `search_policies` | Keyword search over the index. Returns policy numbers + titles + URLs. |
| `get_policy` | Fetch the full text of one policy by number (e.g. `91.100`) or URL. |
| `chain_find_relevant_policies` | One call: search + fetch top-`k` full bodies. **The right tool for natural-language questions.** |
| `cite_policy` | Format a citation string. |
| `health_check` | Inspect scraper state — useful when answers seem suspiciously empty. |

The chain tool's description tells Claude to **quote verbatim** for any normative claim and **refuse** rather than paraphrase load-bearing language.

## Configuration

| Environment variable | Effect |
|---|---|
| `MSSTATE_POLICIES_RETRIEVAL` | `bm25` (default) / `embed` / `hybrid`. Controls retrieval mode. Default works without an API key. |
| `OPENAI_API_KEY` | Required at runtime if you set `MSSTATE_POLICIES_RETRIEVAL=embed` or `=hybrid` (so query embedding can run). Otherwise unused. |
| `MSSTATE_POLICIES_CACHE` | Set to `disk` to enable cross-platform on-disk policy-body cache (24h TTL). Default is in-memory only. |

The default `bm25` mode is what most users want. It runs entirely from data shipped with the package — no external API calls beyond MSU's own site, no API key needed at runtime.

## Verifying answers

Every `chain_find_relevant_policies` and `get_policy` response includes:

- The **canonical landing URL** (e.g. `https://www.policies.msstate.edu/policy/1217`) — click through to verify against the official PDF.
- An ISO **`retrievedAt`** timestamp — when this server fetched the policy.
- The policy **OP number** — for easy reference.

If the scraper breaks, `health_check` reports `index_row_count: 0` and a populated `last_index_error`. Claude is told to apologize coherently in that case rather than confidently say "MSU has no such policy."

## Troubleshooting

- **All policies suddenly have empty text** — `health_check` likely shows `last_index_error`. The scraper's selectors may be stale (MSU touched their Drupal layout). The fix lives in `msstate-policies/src/scraper.ts`.
- **`tools/list` returns 0 tools** — `dist/index.js` is stale or mis-bundled. Re-run `npm run build` in `msstate-policies/`.
- **Embeddings or hybrid retrieval seems off** — confirm `MSSTATE_POLICIES_RETRIEVAL` is set to `embed` or `hybrid` (default is `bm25`) and that `OPENAI_API_KEY` is set in your client's MCP env.

## Privacy

In default `bm25` mode, queries never leave your local machine — the only outbound traffic is to `policies.msstate.edu` to fetch policies. If you opt in to `embed` or `hybrid` mode, the natural-language query is sent to OpenAI for embedding (per their privacy policy at the time of use). Sensitive-topic queries (Title IX, harassment, substance use, FERPA) may want to stay in BM25-only mode.

## License

MIT. See [LICENSE](LICENSE).
