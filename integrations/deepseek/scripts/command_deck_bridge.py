"""Restricted stdio MCP client for the local Command Deck server."""

from __future__ import annotations

from collections import deque
import json
import os
from pathlib import Path
from queue import Empty, Queue
import shutil
import subprocess
from threading import Thread
import time
from typing import Any


PROTOCOL_VERSION = "2025-06-18"
DEFAULT_COMMAND_DECK_DIR = Path(__file__).resolve().parents[3]
DENIED_TOOL_NAMES = {
    "apply_change",
    "apply_changeset",
    "execute_command",
    "run_command",
    "shell",
}


class CommandDeckBridgeError(RuntimeError):
    """An operator-safe Command Deck bridge failure."""


def _command_deck_dir() -> Path:
    raw = os.environ.get("COMMAND_DECK_MCP_DIR", str(DEFAULT_COMMAND_DECK_DIR)).strip()
    root = Path(raw).expanduser().resolve()
    if not root.is_dir():
        raise CommandDeckBridgeError(
            "Command Deck was not found. Set COMMAND_DECK_MCP_DIR to its local checkout."
        )
    if not (root / "mcp" / "index.ts").is_file() or not (root / "package.json").is_file():
        raise CommandDeckBridgeError(
            "COMMAND_DECK_MCP_DIR is not a Command Deck checkout."
        )
    return root


def _timeout_seconds() -> float:
    raw = os.environ.get("COMMAND_DECK_MCP_TIMEOUT_SECONDS", "850")
    try:
        timeout = float(raw)
    except ValueError as exc:
        raise CommandDeckBridgeError(
            "COMMAND_DECK_MCP_TIMEOUT_SECONDS must be numeric."
        ) from exc
    if not 1 <= timeout <= 900:
        raise CommandDeckBridgeError(
            "COMMAND_DECK_MCP_TIMEOUT_SECONDS must be between 1 and 900."
        )
    return timeout


def _child_environment() -> dict[str, str]:
    """Pass only runtime essentials and documented Command Deck settings."""
    allowed = {
        "PATH",
        "Path",
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "HOME",
        "COMMAND_DECK_URL",
        "COMMAND_DECK_TOKEN",
        "COMMAND_DECK_DATA_DIR",
        "COMMAND_DECK_POLL_MS",
    }
    return {key: value for key, value in os.environ.items() if key in allowed}


class CommandDeckMcpClient:
    """Small sequential JSON-RPC client for one Command Deck operation."""

    def __init__(self) -> None:
        self.root = _command_deck_dir()
        node = shutil.which("node")
        if not node:
            raise CommandDeckBridgeError("Node.js is required to start Command Deck MCP.")

        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            self.process = subprocess.Popen(
                [node, "--import", "tsx", "mcp/index.ts"],
                cwd=self.root,
                env=_child_environment(),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                creationflags=creationflags,
            )
        except OSError as exc:
            raise CommandDeckBridgeError("Could not start Command Deck MCP.") from exc

        self.responses: Queue[dict[str, Any] | None] = Queue()
        self.stderr_lines: deque[str] = deque(maxlen=20)
        self.next_id = 1
        Thread(target=self._read_stdout, daemon=True).start()
        Thread(target=self._read_stderr, daemon=True).start()

        self._request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "deepseek-harness", "version": "0.3.0"},
            },
            timeout=min(_timeout_seconds(), 20),
        )
        self._notify("notifications/initialized", {})

    def _read_stdout(self) -> None:
        assert self.process.stdout is not None
        try:
            for raw_line in self.process.stdout:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(message, dict):
                    self.responses.put(message)
        finally:
            self.responses.put(None)

    def _read_stderr(self) -> None:
        assert self.process.stderr is not None
        for raw_line in self.process.stderr:
            line = raw_line.strip()
            if line:
                self.stderr_lines.append(line[:500])

    def _send(self, message: dict[str, Any]) -> None:
        if self.process.poll() is not None or self.process.stdin is None:
            raise CommandDeckBridgeError("Command Deck MCP exited unexpectedly.")
        try:
            self.process.stdin.write(
                json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n"
            )
            self.process.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise CommandDeckBridgeError("Command Deck MCP connection closed.") from exc

    def _notify(self, method: str, params: dict[str, Any]) -> None:
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def _request(
        self, method: str, params: dict[str, Any], timeout: float | None = None
    ) -> dict[str, Any]:
        request_id = self.next_id
        self.next_id += 1
        self._send(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                "params": params,
            }
        )

        deadline = time.monotonic() + (timeout if timeout is not None else _timeout_seconds())
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise CommandDeckBridgeError(
                    f"Command Deck MCP timed out while handling {method}."
                )
            try:
                message = self.responses.get(timeout=remaining)
            except Empty as exc:
                raise CommandDeckBridgeError(
                    f"Command Deck MCP timed out while handling {method}."
                ) from exc
            if message is None:
                raise CommandDeckBridgeError("Command Deck MCP exited unexpectedly.")
            if message.get("id") != request_id:
                continue
            if "error" in message:
                error = message.get("error")
                safe_message = (
                    error.get("message")
                    if isinstance(error, dict) and isinstance(error.get("message"), str)
                    else "Command Deck MCP returned a protocol error."
                )
                raise CommandDeckBridgeError(safe_message)
            result = message.get("result")
            if not isinstance(result, dict):
                raise CommandDeckBridgeError(
                    "Command Deck MCP returned an unexpected response."
                )
            return result

    def list_tools(self) -> list[dict[str, Any]]:
        result = self._request("tools/list", {}, timeout=min(_timeout_seconds(), 30))
        tools = result.get("tools")
        if not isinstance(tools, list) or not all(isinstance(tool, dict) for tool in tools):
            raise CommandDeckBridgeError(
                "Command Deck MCP returned an invalid tool catalog."
            )
        return tools

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return self._request(
            "tools/call", {"name": name, "arguments": arguments}
        )

    def close(self) -> None:
        if self.process.stdin is not None:
            try:
                self.process.stdin.close()
            except OSError:
                pass
        try:
            self.process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=2)

    def __enter__(self) -> "CommandDeckMcpClient":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def list_command_deck_tools() -> list[dict[str, Any]]:
    with CommandDeckMcpClient() as client:
        return client.list_tools()


def call_command_deck_tool(
    name: str, arguments: dict[str, Any], allow_state_changes: bool
) -> tuple[dict[str, Any], dict[str, Any]]:
    if name in DENIED_TOOL_NAMES or name.startswith("apply_"):
        raise CommandDeckBridgeError(
            "That Command Deck operation is blocked by the DeepSeek bridge."
        )

    with CommandDeckMcpClient() as client:
        tools = client.list_tools()
        selected = next((tool for tool in tools if tool.get("name") == name), None)
        if selected is None:
            raise CommandDeckBridgeError(
                "Unknown Command Deck tool. Call command_deck_tools first."
            )

        annotations = selected.get("annotations")
        read_only = bool(
            isinstance(annotations, dict) and annotations.get("readOnlyHint") is True
        )
        if not read_only and not allow_state_changes:
            raise CommandDeckBridgeError(
                "This Command Deck tool can change local state. Retry only after the user "
                "explicitly requests the operation, with allow_state_changes set to true."
            )

        result = client.call_tool(name, arguments)
        return result, {
            "server": "command-deck",
            "tool": name,
            "read_only": read_only,
            "state_changes_allowed": allow_state_changes,
        }
