#!/usr/bin/env python3
"""Standalone sample: ask MSU policy questions via OpenAI's Responses API.

This calls the deployed msstate-policies-mcp Worker as an MCP tool from
GPT-4o. Works on any OpenAI plan (independent of ChatGPT subscription tier).

Setup:
    pip install openai
    export OPENAI_API_KEY=sk-...

Run:
    python examples/openai_api_sample.py "What is MSU's hazing policy?"

See README.md `## OpenAI API` for the full how-to.
"""
import os
import sys

try:
    from openai import OpenAI
except ImportError:
    sys.exit("Missing dependency. Install with: pip install openai")

WORKER_URL = "https://msstate-policies-mcp.mminsub90.workers.dev/mcp"
DEFAULT_QUESTION = "What is MSU's hazing policy?"

# Mirror of OPENAI_INSTRUCTIONS in scripts/run-eval.mjs — keeps real-user
# behavior aligned with the eval set so README quality claims hold.
INSTRUCTIONS = """You answer questions about Mississippi State University Operating Policies using the msstate-policies MCP server.

Rules:
1. When calling chain_find_relevant_policies, always pass k=5 (the maximum) so the model sees a wider candidate set.
2. If the question is not about MSU policies (e.g., weather, sports scores, news, current events, individuals' personal info), refuse plainly: state that this server only covers Mississippi State University Operating Policies and suggest contacting an appropriate alternative source. Do not invent a policy or speculate.
3. Quote verbatim from policy text and cite the OP number + canonical URL for any normative claim."""


def main() -> int:
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("OPENAI_API_KEY not set. Get a key at platform.openai.com.")

    question = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_QUESTION

    client = OpenAI()
    resp = client.responses.create(
        model="gpt-4o",
        instructions=INSTRUCTIONS,
        tools=[{
            "type": "mcp",
            "server_label": "msstate-policies",
            "server_url": WORKER_URL,
            "require_approval": "never",
        }],
        input=question,
    )

    print(f"Q: {question}\n")
    for item in resp.output:
        if getattr(item, "type", None) == "message":
            for c in getattr(item, "content", []) or []:
                if getattr(c, "type", None) == "output_text":
                    print(c.text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
