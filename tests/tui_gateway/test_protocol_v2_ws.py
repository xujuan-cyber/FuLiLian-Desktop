"""P1-3 end-to-end (dispatch layer): client.hello negotiation drives v2 frames.

Integration across the real boundaries that matter for the protocol split:

1. ``handle_request("client.hello")`` — the real RPC entry, method registry
   and transport binding included — raises the bound transport to v2.
2. ``server._emit`` — the real emitter — then writes frames under the
   ACP-shaped vocabulary to that transport, while desktop-private names pass
   through unchanged and a v1 transport keeps legacy names.

(The ``handle_ws`` socket layer is deliberately not exercised here: importing
``tui_gateway.server`` inside a ``patch.dict("sys.modules")`` block creates a
second module instance that no attribute patch can reach — a pre-existing
test-infra quirk, orthogonal to the protocol logic under test.)
"""

from __future__ import annotations

import importlib
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture()
def server():
    with patch.dict("sys.modules", {
        "fulilian_constants": MagicMock(get_fulilian_home=MagicMock(return_value="/tmp/fulilian_test_v2ws")),
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


class _RecordingTransport:
    """Stand-in transport: captures frames, negotiates a protocol level."""

    def __init__(self, protocol: int) -> None:
        self.protocol = protocol
        self.frames: list[dict] = []

    def write(self, obj: dict) -> bool:
        self.frames.append(obj)
        return True

    def close(self) -> None:
        pass


def _event_types(transport: _RecordingTransport) -> list[str]:
    return [f["params"]["type"] for f in transport.frames if f.get("method") == "event"]


def test_client_hello_negotiates_and_emitter_follows(server):
    transport = _RecordingTransport(protocol=1)
    token = server.bind_transport(transport)
    try:
        # Negotiate over the real RPC surface.
        resp = server.handle_request({"id": "1", "method": "client.hello", "params": {"protocol": 2}})
        assert resp == {"jsonrpc": "2.0", "id": "1", "result": {"protocol": 2}}
        assert transport.protocol == 2

        # Agent-process events now reach this transport under ACP names.
        server._emit("tool.start", "", {"name": "patch"})
        server._emit("message.delta", "", {"text": "hi"})
        server._emit("message.interim", "", {"text": "preview"})
        assert _event_types(transport) == ["tool_call", "agent_message_chunk", "agent_message_chunk"]

        interim = next(
            f for f in transport.frames
            if f["params"]["type"] == "agent_message_chunk" and f["params"]["payload"].get("interim") is True
        )
        assert interim["params"]["payload"]["text"] == "preview"
    finally:
        server.reset_transport(token)


def test_unnegotiated_transport_keeps_legacy_names(server):
    transport = _RecordingTransport(protocol=1)
    token = server.bind_transport(transport)
    try:
        # No negotiation: the legacy vocabulary is untouched, including the
        # interim variant's dedicated event name.
        server._emit("tool.start", "", {"name": "patch"})
        server._emit("message.interim", "", {"text": "preview"})
        server._emit("status.update", "", {"kind": "compacting"})
        assert _event_types(transport) == ["tool.start", "message.interim", "status.update"]
    finally:
        server.reset_transport(token)


def test_desktop_names_never_map_even_when_negotiated(server):
    transport = _RecordingTransport(protocol=2)
    token = server.bind_transport(transport)
    try:
        server._emit("status.update", "", {"kind": "compacting"})
        server._emit("skin.changed", "", {})
        assert _event_types(transport) == ["status.update", "skin.changed"]
    finally:
        server.reset_transport(token)


def test_v2_tool_payload_aliases_pass_through_verbatim(server):
    # The wire may still carry the legacy aliases; the desktop parse layer
    # normalizes them (gateway-event-schema.normalizeToolPayload). The gateway
    # itself passes payloads through verbatim — asserted here to pin the
    # contract that the gateway does NOT rewrite payloads.
    transport = _RecordingTransport(protocol=2)
    token = server.bind_transport(transport)
    try:
        server._emit("tool.complete", "", {"tool_id": "t-1", "result": "ok"})
        frame = transport.frames[0]
        assert frame["params"]["type"] == "tool_call_update"
        assert frame["params"]["payload"] == {"tool_id": "t-1", "result": "ok"}
    finally:
        server.reset_transport(token)
