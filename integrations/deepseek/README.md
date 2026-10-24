# Local DeepSeek MCP harness

Dependency-free Python 3.11+ stdio MCP server. Requires a locally running Ollama with `deepseek-r1:1.5b` installed. Run `python scripts/deepseek_mcp.py` from this directory, or let Command Deck start it. `COMMAND_DECK_MCP_DIR` selects the host checkout, and `COMMAND_DECK_URL` selects its loopback API. Command Deck sets these automatically. No hosted API key is used. The bridge discovers fixed tools and denies source apply and arbitrary shell tools. This folder contains both the model server and its Command Deck bridge, with no user configuration or state.
