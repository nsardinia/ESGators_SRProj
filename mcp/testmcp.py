import asyncio
import os
from pathlib import Path

from fastmcp import Client


SERVER_PATH = Path(__file__).resolve().parent / "mcpserver.py"


async def main():
    client = Client(str(SERVER_PATH))

    async with client:
        tools = await client.list_tools()
        print("Available tools:")
        for tool in tools:
            print(f"  - {tool.name}: {tool.description}")

        print("\n" + "=" * 50 + "\n")

        context = await client.call_tool("get_mcp_context", {})
        print("MCP context:")
        print(context)

        search_results = await client.call_tool("search", {"query": "status", "limit": 3})
        print("\nSearch results:")
        print(search_results)

        device_id = str(os.getenv("MCP_TEST_DEVICE_ID") or "").strip()
        if not device_id:
            print("\nSet MCP_TEST_DEVICE_ID to exercise realtime/history device tools.")
            return

        latest = await client.call_tool("get_device_latest", {"device_id": device_id})
        print("\nLatest device payload:")
        print(latest)

        history = await client.call_tool(
            "get_device_history",
            {"device_id": device_id, "hours": 24, "limit": 50},
        )
        print("\nRecent device history:")
        print(history)

        inference_context = await client.call_tool(
            "get_device_inference_context",
            {"device_id": device_id, "hours": 24},
        )
        print("\nInference context:")
        print(inference_context)

        fetched = await client.call_tool(
            "fetch",
            {"id": f"device:{device_id}", "hours": 24},
        )
        print("\nFetched search result:")
        print(fetched)


if __name__ == "__main__":
    asyncio.run(main())
