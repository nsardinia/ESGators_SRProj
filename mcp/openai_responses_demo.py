from __future__ import annotations

import json
import os
from urllib import request


OPENAI_API_URL = "https://api.openai.com/v1/responses"


def main() -> None:
    api_key = str(os.environ.get("OPENAI_API_KEY") or "").strip()
    server_url = str(os.environ.get("OPENAI_MCP_SERVER_URL") or "").strip()
    model = str(os.environ.get("OPENAI_MODEL") or "gpt-5").strip()
    prompt = str(
        os.environ.get("OPENAI_MCP_PROMPT")
        or "Use the ESGators MCP tools to inspect my available IoT device data, summarize the latest readings, compare them against recent historical trends, and highlight any anomalies conservatively."
    ).strip()

    if not api_key:
        raise SystemExit("OPENAI_API_KEY is required")

    if not server_url:
        raise SystemExit("OPENAI_MCP_SERVER_URL is required, for example https://your-domain.example/mcp")

    payload = {
        "model": model,
        "tools": [
            {
                "type": "mcp",
                "server_label": "esgators",
                "server_description": "Firebase and Supabase backed IoT sensor context for ESGators.",
                "server_url": server_url,
                "require_approval": "never",
            }
        ],
        "input": prompt,
    }

    req = request.Request(
        OPENAI_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    with request.urlopen(req, timeout=60) as response:
        body = json.loads(response.read().decode("utf-8"))

    print(json.dumps(body, indent=2))


if __name__ == "__main__":
    main()
