# OpenAI API support — design

**Date:** 2026-05-08
**Status:** Design (awaiting user review → implementation plan)
**Scope:** Verify the existing MCP server works against OpenAI's Responses API and document the path for users without paid ChatGPT plans.

## Goal

Make `msstate-mcp` officially usable from OpenAI's stack, not just Anthropic's, **without** building a second server, second corpus, or second protocol surface. The same Cloudflare Worker URL that serves claude.ai today must also serve OpenAI Responses API calls today; this project produces the **evidence and docs** to make that claim defensible.

## Non-goals

This project is *prove + document*, not *build*. The following are out of scope and tracked under "Deferred":

- A second server, second bundle, second corpus
- Any change to the 5 tool surface (no new tools, no removed tools, no schema rewrites)
- Any change to the Worker auth surface (stays anonymous public HTTP)
- Any change to transport (stays plain JSON POST → JSON response; no SSE, no Streamable HTTP, no sessions)
- Threat-model / SECURITY.md / autoresearch_security.md updates (no new abuse classes)
- ChatGPT Pro/Business Connectors verification (the maintainer is on free ChatGPT — cannot test)
- Custom GPTs via OpenAPI Actions
- Gemini, local LLMs, agent frameworks
- MCP registry submissions (Smithery, modelcontextprotocol.io registry, etc.)

## Why this is small

The framing was originally "make this MCP available for other LLMs." That sounded like building. Once we read the code, the truth was:

- The Worker uses only the **`tools` capability** (5 tools) — the most portable subset of MCP
- Tool descriptions are already LLM-neutral (no "Claude" anywhere in the descriptions)
- JSON Schemas are vanilla `type: object` with `properties` / `required` — no exotic constructs
- Transport is plain HTTP POST → JSON response — the simplest MCP-over-HTTP variant
- CORS is `*`, no auth — no client-specific friction

So the existing server is already a generic MCP server. What was missing was the *evidence* that OpenAI clients actually consume it correctly, and *docs* aimed at OpenAI users.

## Audience

People on **free ChatGPT** (or any ChatGPT plan) who want to ask MSU policy questions through OpenAI's models. ChatGPT Connectors are gated to Pro/Business/Enterprise, so the only path that works for free-tier ChatGPT users is the **OpenAI API directly** with their own API key. API access is independent of ChatGPT subscription tier — anyone can sign up at platform.openai.com.

This audience is also a strict superset of "developers using OpenAI Agents SDK / Responses API" — same protocol path, same sample code.

## Verification methodology

A tiered bar that produces a committable artifact at each level.

### Tier 1 — Protocol layer (must pass)

Run a single `responses.create()` call with the MCP tool wired to the Worker URL. The call uses the canned question *"What is MSU's hazing policy?"* — chosen because it has a clean ground-truth answer in OP 91.208 and is the same question the existing README uses for its example response.

Pass criteria:

- The Responses API call returns without protocol-level error (200, no rejection of the MCP server URL). This implicitly confirms the OpenAI side ran `initialize` and `tools/list` against our Worker successfully.
- The model's final answer includes a verbatim policy quote, the OP number `91.208`, and the canonical URL on `policies.msstate.edu`.

If Tier 1 fails, the project halts and we document the finding. Most likely failure modes:

- OpenAI rejects the server because of a transport variant mismatch (extremely unlikely given protocol version `2025-06-18` is current).
- OpenAI requires OAuth/DCR for connector-style MCP servers (this triggers the deferred OAuth spec).
- A schema strictness issue in one of the 5 tools. **If the fix is local** (a tweak to a description or a schema field), absorb it into this spec's commit. **If the fix is structural** (rewriting tool surfaces, adding `additionalProperties: false` everywhere, schema migrations), halt and re-brainstorm — that's a different project than "verify + document."

### Tier 2 — Quality layer (should pass)

Run a 10-question subset of the existing 50-question eval set against GPT-4o:

- 8 retrieval-correct cases (`expected_op_numbers` populated), selected to cover diverse policy domains — academic, student conduct, employment, safety/health, financial — so a single bad domain doesn't dominate the result. Exact question selection is determined in the implementation plan.
- 2 refusal cases (out-of-scope questions that must be refused, not fabricated)

Judge: Claude Sonnet 4.6 using the existing judge prompt (so results are directly comparable to the existing Sonnet baseline of 86/88 → ~95%).

**Pass threshold:** ≥9/10 correct. One miss is allowed for model-quality variance; ≥2 misses indicates a real cross-model quality gap that needs investigation before shipping docs.

**Why 10, not 50:** cost. Each Responses API call with the MCP tool runs ~2–3 model rounds (think → tool → answer). 50 × 3 ≈ 150 model calls plus tool-call latency. The 10-question subset gives evidence at a fraction of the spend.

**Why GPT-4o specifically:** flagship OpenAI model, the one most API users actually run, strong tool-use reliability.

### Tier 3 — Output artifact

Commit `msstate-policies/eval/eval-2026-05-08-k5-gpt-4o.json` alongside the existing Sonnet eval. Future maintainers can compare cross-model and re-run.

## Documentation deliverables (Section B)

### B1. README "Pick your client" table — add one row

| If you use… | Easiest install | Time |
|---|---|---|
| **OpenAI API** (any ChatGPT plan, including free) | [Python sample](#openai-api) | 1 min |

No row added for ChatGPT Pro/Business Connectors — that path stays undocumented until someone with Pro can verify it. Avoiding speculative docs.

### B2. New README section: `## OpenAI API` (verified)

Contents:

- **One-paragraph framing:** ChatGPT Connectors are gated to Pro/Business. If you're on free ChatGPT (or just prefer code), you can use this MCP server directly via OpenAI's Responses API and an API key. Costs are pay-per-use — typically a few cents per query.
- **Prerequisites:** Python 3.9+, `pip install openai`, an OpenAI API key (link to platform.openai.com).
- **Inline ~20-line Python snippet** using `openai.responses.create()` with the MCP tool wired to the Worker URL. Demo-grade: hardcoded question, no error handling, focused on showing the API shape. The standalone runnable script (B4) is the production-grade version of the same flow.
- **What to expect:** same citation discipline as Claude — verbatim quote, OP number, URL, retrieval timestamp.
- **Link** to the eval JSON proving cross-model correctness.

### B3. README "Privacy" section update

Today the section splits the world into "local install" vs "claude.ai connector". Add a third bullet:

> **OpenAI API**: your queries go to OpenAI's models and to the hosted Cloudflare Worker. No traffic to Anthropic in this mode. The Worker still only fetches from MSU and stores no logs of your queries beyond Cloudflare's standard request metadata.

### B4. New runnable artifact: `examples/openai_api_sample.py`

Standalone Python script (parallels the existing `examples/claude_desktop_config.json`). ~30 lines:

- Imports
- Read `OPENAI_API_KEY` from env (fail with a clear message if unset)
- One `openai.responses.create()` call with the MCP tool wired to the Worker URL
- Print the model's answer + extracted citations
- Header comment links back to the README's `## OpenAI API` section

## Code/asset changes (Section C)

### C1. Tool description / schema audit

Quick visual review of the 5 tools' descriptions and JSON Schemas with OpenAI Responses API + MCP tool's strictness in mind. Specifically:

- Confirm zero Anthropic-specific phrasing — already clean per a read of `worker/src/index.ts`
- Confirm schemas are valid JSON Schema for OpenAI's tool-call serializer (no exotic `oneOf`/`anyOf`, defaults are advisory only, enums are simple)

Expected outcome: zero diff. If a small fix is needed, absorb it. If the audit surfaces a structural issue (e.g., tools fundamentally need new schemas to satisfy OpenAI), halt and re-brainstorm — same escalation rule as Tier 1.

### C2. Eval harness extension (`scripts/run-eval.mjs`)

Add an OpenAI answering-model branch:

- New `--openai-model gpt-4o` flag (with extension points for `gpt-4.1-mini`, etc., later)
- When set: skip the local stdio MCP client; instead call `openai.responses.create({ tools: [{type: "mcp", server_url: WORKER_URL, ...}], ... })` against the **deployed Worker URL** (not localhost). The model orchestrates tool calls itself.
- Reuse the existing Claude Sonnet judge stage for answer-correctness scoring, so results are directly comparable to the Sonnet baseline.
- Reuse the $4 hard-budget guard (gpt-4o pricing is similar to Sonnet).
- Output filename: `eval-YYYY-MM-DD-k{N}-gpt-4o.json`, matching the existing `eval-*-sonnet-4-6.json` naming.

### C3. Run eval, commit JSON

- Run the 10-question subset.
- If subset passes ≥9/10 cleanly, commit the JSON. The README links to it.
- If subset fails: investigate (likely tool description / schema mismatch), fix, re-run.

### C4. Version bump 0.2.0 → 0.3.0

Semver-minor for "OpenAI verified support":

- `msstate-policies/package.json`
- Worker `serverInfo.version` + `health_check` runtime info (currently both `0.2.0` in `worker/src/index.ts`)
- Bundled `dist/index.js` regenerates from build (caught by CI's "dist must be in sync" gate)

Use the existing `scripts/sync-version.mjs` to handle the cross-file bump.

### C5. Security checklist sanity check

`bash tools/security-checklist.sh | tail -1` should still print **192**. None of the changes above touch the security-shaped patterns the round-2 audit froze. If the score regresses, fix the regression — no security work is in scope here.

## Deferred / out of scope (Section D)

| Item | Why deferred | Where it goes |
|---|---|---|
| OAuth 2.1 + DCR for the Worker | Today: anonymous public access works for both Anthropic and OpenAI Responses API clients. If ChatGPT Pro Connectors turn out to require OAuth, that's a separate brainstorm covering auth model, key issuance, abuse posture, multi-tenant decisions. | New spec when verified-Pro testing becomes possible OR when we have evidence ChatGPT Pro requires it. |
| ChatGPT Pro/Business Connectors verification | Maintainer is on free ChatGPT — can't test. Speculative docs ruled out earlier. | Follow-up small PR after someone with Pro verifies — re-run the eval methodology against the Connectors UI. |
| Custom GPTs via OpenAPI Actions | Custom GPTs don't speak MCP — they'd need a REST shim + OpenAPI spec. Different audience, different auth, different abuse posture. | Separate spec if ever wanted. |
| Other LLM ecosystems (Gemini, Ollama, LM Studio, agent frameworks) | Out of scope for the chosen "OpenAI / ChatGPT users" audience. The work here creates a template replicable for other LLMs later. | Per-ecosystem specs. |
| MCP registry submissions | Discoverability work, not compatibility work. A natural follow-up *after* this spec ships — "verified across Claude + OpenAI" is a stronger claim than "Claude-only." | Follow-up small PR after this spec ships. |
| CI smoke test against OpenAI | Would require minting + rotating an OpenAI key in CI. The existing `tools/list returns 5` smoke test already proves protocol correctness. | Not planned. |
| Threat-model / SECURITY.md / autoresearch_security.md updates | Threat surface doesn't change — Worker is still anonymous public HTTP; one more documented client doesn't add a new abuse class. | Touched only if the OAuth follow-up ever lands. |

## Risks

**R1. Tier 1 fails because OpenAI rejects the existing server.**
Likelihood: low. The protocol version is current and the Worker speaks bog-standard MCP. If it does fail, the failure mode is informative and we document the finding rather than ship blind.

**R2. Tier 2 passes <9/10.**
Likelihood: low-medium. GPT-4o is a strong tool-using model and the `chain_find_relevant_policies` tool description prescribes citation discipline explicitly. If it underperforms, the most likely cause is the tool description being phrased in a way that biases Claude more than GPT — fixable by tightening the description, not by changing the protocol.

**R3. Cost overrun on the eval.**
Likelihood: low. The existing $4 hard-budget guard catches this. 10 questions × ~3 model rounds × gpt-4o pricing ≈ $1–2.

**R4. Quietly breaking Claude clients with the version bump.**
Likelihood: very low. Semver-minor, no API surface changes, no tool removals, no schema breaks. CI's `tools/list returns 5` and `dist must be in sync` gates would catch a bundle regression.

## Acceptance criteria

This spec is "done" when:

1. Tier 1 protocol verification passes (one canned `chain_find_relevant_policies` call against the Worker via Responses API succeeds with a grounded, cited answer)
2. Tier 2 eval passes ≥9/10 on the 10-question subset
3. `eval-2026-05-08-k5-gpt-4o.json` is committed
4. README has a `## OpenAI API` section + updated client table + updated privacy section
5. `examples/openai_api_sample.py` exists and runs cleanly with `OPENAI_API_KEY` set
6. Version bumped to 0.3.0 across npm / Worker / dist
7. `bash tools/security-checklist.sh | tail -1` prints **192**
8. CI green on the resulting PR

## Implementation plan

The implementation plan is created in a follow-up step using the `superpowers:writing-plans` skill, after this spec is approved by the user.
