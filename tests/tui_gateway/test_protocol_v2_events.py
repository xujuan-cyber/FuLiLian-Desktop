"""P1-3: per-transport v2 (ACP-shaped) event-name negotiation.

``server._emit`` routes the agent-process event family through
``_V2_EVENT_NAMES`` when the target transport negotiated protocol 2 via
``client.hello``; everything else — the stdio TUI, tests, desktop-private
event names — keeps the legacy v1 vocabulary (design doc §2.4 / §5).
"""

from __future__ import annotations

import importlib
import io
import json
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

_original_stdout = sys.stdout


@pytest.fixture(autouse=True)
def _restore_stdout():
    yield
    sys.stdout = _original_stdout


@pytest.fixture()
def server():
    with patch.dict("sys.modules", {
        "fulilian_constants": MagicMock(get_fulilian_home=MagicMock(return_value="/tmp/fulilian_test_v2")),
        "fulilian_cli.env_loader": MagicMock(),
        "fulilian_cli.banner": MagicMock(),
        "fulilian_state": MagicMock(),
    }):
        mod = importlib.import_module("tui_gateway.server")

    methods = dict(mod._methods)
    real_stdout = mod._real_stdout
    yield mod
    mod._methods.clear()
    mod._methods.update(methods)
    mod._real_stdout = real_stdout
    for sid in list(mod._sessions):
        mod._close_session_by_id(sid, end_reason="test_cleanup")
    mod._pending.clear()
    mod._answers.clear()
    mod._live_transports.clear()


@pytest.fixture()
def capture(server):
    """Redirect server's real stdout to a StringIO; return (server, read_frames)."""
    buf = io.StringIO()
    server._real_stdout = buf

    def read_frames() -> list[dict]:
        return [json.loads(line) for line in buf.getvalue().splitlines() if line.strip()]

    return server, read_frames


def _frame_types(frames: list[dict]) -> list[str]:
    return [f["params"]["type"] for f in frames if f.get("method") == "event"]


def test_v1_default_keeps_legacy_names(server, capture):
    server, read_frames = capture
    server._emit("tool.start", "", {"name": "patch"})

    assert _frame_types(read_frames()) == ["tool.start"]


def test_v2_negotiated_transport_receives_acp_names(server, capture):
    server, read_frames = capture
    server._stdio_transport.protocol = 2
    try:
        server._emit("tool.start", "", {"name": "patch"})
        server._emit("message.delta", "", {"text": "hi"})
        server._emit("approval.request", "", {"command": "ls"})
    finally:
        server._stdio_transport.protocol = 1

    assert _frame_types(read_frames()) == ["tool_call", "agent_message_chunk", "permission_request"]


def test_v2_interim_folds_into_agent_message_chunk(server, capture):
    server, read_frames = capture
    server._stdio_transport.protocol = 2
    try:
        server._emit("message.interim", "", {"text": "preview"})
    finally:
        server._stdio_transport.protocol = 1

    frames = read_frames()
    assert _frame_types(frames) == ["agent_message_chunk"]
    assert frames[0]["params"]["payload"]["interim"] is True


def test_desktop_names_never_map_v2(server, capture):
    server, read_frames = capture
    server._stdio_transport.protocol = 2
    try:
        server._emit("status.update", "", {"kind": "compacting"})
        server._emit("skin.changed", "", {})
    finally:
        server._stdio_transport.protocol = 1

    assert _frame_types(read_frames()) == ["status.update", "skin.changed"]


def test_client_hello_negotiates_and_rejects_without_transport(server):
    # No transport bound → negotiation is impossible, the handler says so.
    resp = server.handle_request({"id": "1", "method": "client.hello", "params": {"protocol": 2}})
    assert resp["error"]["code"] == -32602

    # A v1 transport binds, negotiates, and reads back the effective level.
    transport = SimpleNamespace(protocol=1)
    token = server.bind_transport(transport)
    try:
        resp = server.handle_request({"id": "2", "method": "client.hello", "params": {"protocol": 2}})
        assert resp["result"] == {"protocol": 2}
        assert transport.protocol == 2

        # Re-negotiating without a request keeps the current level.
        resp = server.handle_request({"id": "3", "method": "client.hello", "params": {}})
        assert resp["result"] == {"protocol": 2}
    finally:
        server.reset_transport(token)
