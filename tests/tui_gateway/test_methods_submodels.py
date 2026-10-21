"""Tests for the submodels.* JSON-RPC method family (step 21).

Contracts pinned:
- submodels.list: full roster with provider.api_key MASKED, per-entry
  validation verdict for hand-edited broken profiles;
- submodels.save: server-side §3.1 validation — invalid entries are
  REJECTED and the config is left untouched; valid entries upsert by id;
  unknown keys are dropped;
- submodels.delete: removes by id, unknown id → removed=false;
- submodels.templates: built-in template list (static);
- submodels.wizard_turn: stateless one-shot (call_llm mocked) — full
  messages passthrough with the wizard system prompt first, draft parsed
  from the ```json fence, parse failure returns reply-only (no error),
  and the main session history is never touched (no session id involved).
"""

import json

import pytest

import tui_gateway.server as srv
from fulilian_constants import get_fulilian_home


@pytest.fixture
def home(tmp_path, monkeypatch):
    """Conftest already redirects FULILIAN_HOME; pin the server module's
    captured _fulilian_home to the same sandbox so _load_cfg_raw/_save_cfg
    round-trip inside it."""
    h = get_fulilian_home()
    monkeypatch.setattr(srv, "_fulilian_home", h)
    return h


def _result(envelope):
    assert "error" not in envelope, envelope
    return envelope["result"]


def _err_code(envelope):
    assert "error" in envelope, envelope
    return envelope["error"]


def _config():
    p = get_fulilian_home() / "config.yaml"
    if not p.exists():
        return {}
    import yaml

    return yaml.safe_load(p.read_text(encoding="utf-8")) or {}


VALID = {
    "id": "reviewer",
    "name": "代码审查员",
    "description": "审查代码变更，输出问题清单。",
    "toolsets": ["file"],
    "model": "openrouter:google/gemini-2-flash",
    "provider": {"base_url": "", "api_key": "sk-abcdef1234567890", "api_mode": ""},
    "max_iterations": 12,
    "system_prompt_extra": "严格。",
    "params": {"temperature": 0.3},
    "enabled": True,
}


class TestSubmodelsSave:
    def test_save_persists_valid_entry(self, home):
        out = _result(srv._methods["submodels.save"](1, {"entry": dict(VALID)}))
        assert out == {"id": "reviewer", "replaced": False, "dropped": []}
        saved = _config()["submodels"]
        assert len(saved) == 1
        # Plaintext key persists in config (masked only on the read path).
        assert saved[0]["provider"]["api_key"] == "sk-abcdef1234567890"

    def test_save_upsert_replaces_by_id(self, home):
        _result(srv._methods["submodels.save"](1, {"entry": dict(VALID)}))
        _result(
            srv._methods["submodels.save"](
                2, {"entry": dict(VALID, name="审查员2")}
            )
        )
        saved = _config()["submodels"]
        assert len(saved) == 1
        assert saved[0]["name"] == "审查员2"

    def test_save_rejects_invalid_and_leaves_config_untouched(self, home):
        _result(srv._methods["submodels.save"](1, {"entry": dict(VALID)}))
        before = _config()
        bad = dict(VALID, id="bad", toolsets=["not-a-toolset"])
        env = _err_code(srv._methods["submodels.save"](2, {"entry": bad}))
        assert "not-a-toolset" in env["message"]
        assert _config() == before

    def test_save_same_id_is_upsert_not_duplicate_rejection(self, home):
        """server-side uniqueness excludes the id being saved — re-saving a
        profile by its own id is the documented upsert path (validator-level
        duplicate detection is covered in tests/agent/test_submodel_profiles.py)."""
        _result(srv._methods["submodels.save"](1, {"entry": dict(VALID)}))
        out = _result(
            srv._methods["submodels.save"](
                2, {"entry": dict(VALID, name="another")}
            )
        )
        assert out["replaced"] is True
        assert len(_config()["submodels"]) == 1

    def test_save_drops_unknown_keys(self, home):
        out = _result(
            srv._methods["submodels.save"](
                1, {"entry": dict(VALID, evil_field="x")}
            )
        )
        assert out["dropped"] == ["evil_field"]
        assert "evil_field" not in _config()["submodels"][0]

    def test_save_requires_entry_object(self, home):
        env = _err_code(srv._methods["submodels.save"](1, {}))
        assert "entry" in env["message"]


class TestSubmodelsList:
    def test_list_masks_api_key_and_reports_validation(self, home):
        _result(srv._methods["submodels.save"](1, {"entry": dict(VALID)}))
        out = _result(srv._methods["submodels.list"](2, {}))
        entries = out["submodels"]
        assert len(entries) == 1
        view = entries[0]
        assert view["provider"]["api_key"] == "sk-a…7890"
        assert "sk-abcdef1234567890" not in json.dumps(out)
        assert view["valid"] is True
        assert view["errors"] == []

    def test_list_flags_hand_edited_broken_profile(self, home):
        (get_fulilian_home() / "config.yaml").write_text(
            json.dumps({"submodels": [{"id": "broken", "name": ""}]}),
            encoding="utf-8",
        )
        out = _result(srv._methods["submodels.list"](1, {}))
        entry = out["submodels"][0]
        assert entry["valid"] is False
        assert any("name" in e for e in entry["errors"])


class TestSubmodelsDelete:
    def test_delete_removes_by_id(self, home):
        _result(srv._methods["submodels.save"](1, {"entry": dict(VALID)}))
        out = _result(srv._methods["submodels.delete"](2, {"id": "reviewer"}))
        assert out == {"id": "reviewer", "removed": True}
        assert _config()["submodels"] == []

    def test_delete_unknown_id_is_noop(self, home):
        out = _result(srv._methods["submodels.delete"](1, {"id": "ghost"}))
        assert out["removed"] is False


class TestTemplates:
    def test_templates_are_well_formed(self):
        out = _result(srv._methods["submodels.templates"](1, {}))
        templates = out["templates"]
        assert len(templates) >= 3
        ids = {t["id"] for t in templates}
        assert len(ids) == len(templates)
        for t in templates:
            assert t["name"] and t["description"]


class TestWizardTurn:
    @pytest.fixture
    def llm_mock(self, monkeypatch):
        from types import SimpleNamespace

        calls = {}

        def fake_call_llm(*, task, messages, max_tokens, temperature, timeout, main_runtime=None):
            calls["messages"] = messages
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=calls["reply"]))]
            )

        monkeypatch.setattr("agent.oneshot.call_llm", fake_call_llm)
        return calls

    def test_wizard_converged_reply_returns_draft(self, home, llm_mock):
        llm_mock["reply"] = (
            "听起来是个代码审查场景，草稿如下：\n"
            "```json\n"
            '{"name": "审查员", "description": "审查代码", '
            '"toolsets": ["file"], "enabled": true}\n'
            "```"
        )
        out = _result(
            srv._methods["submodels.wizard_turn"](
                1,
                {"messages": [{"role": "user", "content": "帮我建一个代码审查子模型"}]},
            )
        )
        assert "审查员" in out["reply"]
        assert out["draft"]["name"] == "审查员"
        # System prompt first, then the caller-owned history verbatim.
        messages = llm_mock["messages"]
        assert messages[0]["role"] == "system"
        assert "FOUR" in messages[0]["content"]
        assert messages[1] == {"role": "user", "content": "帮我建一个代码审查子模型"}

    def test_wizard_early_turn_reply_only(self, home, llm_mock):
        llm_mock["reply"] = "它主要处理什么问题？能举个例子吗？"
        out = _result(
            srv._methods["submodels.wizard_turn"](
                1,
                {
                    "messages": [
                        {"role": "user", "content": "建个子模型"},
                    ]
                },
            )
        )
        assert "draft" not in out
        assert "什么问题" in out["reply"]

    def test_wizard_rejects_bad_history(self, home):
        env = _err_code(srv._methods["submodels.wizard_turn"](1, {"messages": []}))
        assert "messages" in env["message"]
        env = _err_code(
            srv._methods["submodels.wizard_turn"](
                2, {"messages": [{"role": "assistant", "content": "hi"}]}
            )
        )
        assert "last message" in env["message"]


class TestEventPassthrough:
    """server.py `subagent.*` payload must carry submodel_id/reason when the
    delegate side provides them, and omit both keys otherwise (never
    synthesized empty). D6 contract: the field is `submodel_id`, never
    `profile` (envelope `profile` = work-configuration profile)."""

    @pytest.fixture
    def emitted(self, monkeypatch):
        out = []
        monkeypatch.setattr(srv, "_tool_progress_enabled", lambda sid: True)
        monkeypatch.setattr(srv, "_emit", lambda ev, sid, payload=None: out.append((ev, payload)))
        return out

    def _progress(self, **kwargs):
        srv._on_tool_progress("sess-1", "subagent.start", None, "goal", None, **kwargs)

    def test_submodel_fields_relayed_when_present(self, emitted):
        self._progress(
            goal="g", task_count=1, task_index=0,
            subagent_id="sa-0-x", submodel_id="reviewer", reason="diff review",
        )
        event, payload = emitted[-1]
        assert event == "subagent.start"
        assert payload["submodel_id"] == "reviewer"
        assert payload["reason"] == "diff review"
        assert "profile" not in payload

    def test_submodel_fields_absent_on_plain_spawn(self, emitted):
        self._progress(goal="g", task_count=1, task_index=0, subagent_id="sa-0-x")
        _event, payload = emitted[-1]
        assert "submodel_id" not in payload
        assert "reason" not in payload
