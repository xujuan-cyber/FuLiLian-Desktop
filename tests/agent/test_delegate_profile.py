"""Delegate_task × submodel profile integration tests (step 21).

Verifies, at the mock boundary (`tools.delegate_tool._build_child_agent`):
- a task carrying `profile` builds its child with the profile's model /
  provider / toolsets / max_iterations / temperature / persona, and the
  `reason` rides the event attribution kwargs;
- an unknown/disabled profile fails the spawn loudly (per-task error);
- the NO-profile path is byte-identical to the pre-profile baseline
  (default kwargs untouched);
- roster injection: the dynamic schema carries profile/reason and the
  description section only appears when enabled profiles exist;
- A4 RED-PROOF GUARD: the profile toolsets ∩ parent-enabled intersection
  in `_build_child_agent` — a profile can never grant the child a toolset
  the parent lacks (see the mutation protocol in the module docstring of
  tests/agent/test_submodel_profiles.py and the receipt).
"""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import tools.delegate_tool as dt
from agent import submodel_profiles as sp


def _write_config(cfg: dict):
    import os
    from fulilian_constants import get_fulilian_home

    home = get_fulilian_home()
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.yaml").write_text(json.dumps(cfg), encoding="utf-8")


PROFILE = {
    "id": "reviewer",
    "name": "代码审查员",
    "description": "审查代码变更，输出问题清单与修复建议。",
    "toolsets": ["file", "terminal"],
    "model": "openrouter:google/gemini-2-flash",
    "provider": {"base_url": "https://api.example.com/v1", "api_key": "sk-xyz"},
    "max_iterations": 12,
    "system_prompt_extra": "你是严格的代码审查员。",
    "params": {"temperature": 0.3},
    "enabled": True,
}


@pytest.fixture
def parent():
    return SimpleNamespace(
        model="parent-model",
        base_url=None,
        provider=None,
        api_key=None,
        enabled_toolsets=["file", "terminal"],
        _delegate_depth=0,
        session_id="parent-session",
        _active_children=[],
        max_tokens=None,
    )


@pytest.fixture
def build_capture(monkeypatch):
    """Capture _build_child_agent kwargs; stub out the child runner."""
    captured = {}

    def fake_build(**kwargs):
        captured.update(kwargs)
        child = SimpleNamespace()
        child._subagent_id = "sa-0-test"
        return child

    monkeypatch.setattr(dt, "_build_child_agent", fake_build)
    monkeypatch.setattr(
        dt,
        "_run_single_child",
        lambda *a, **k: {
            "task_index": 0,
            "status": "completed",
            "summary": "ok",
            "api_calls": 1,
            "duration_seconds": 0.1,
        },
    )
    return captured


def _spawn(goal="Review the diff of module X thoroughly", **task_extra):
    task = {"goal": goal}
    task.update(task_extra)
    return json.loads(
        dt.delegate_task(tasks=[task], parent_agent=_PARENT_REF, background=False)
    )


_PARENT_REF = None


class TestProfileDispatch:
    def test_profile_task_builds_child_with_profile_overrides(
        self, parent, build_capture
    ):
        global _PARENT_REF
        _write_config({"submodels": [dict(PROFILE)]})
        _PARENT_REF = parent
        out = _spawn(profile="reviewer", reason="diff review needs the reviewer persona")
        assert out["results"][0]["status"] == "completed", out

        kw = build_capture
        assert kw["toolsets"] == ["file", "terminal"]
        assert kw["max_iterations"] == 12
        assert kw["override_system_prompt_extra"] == "你是严格的代码审查员。"
        assert kw["event_submodel_id"] == "reviewer"
        assert kw["event_reason"] == "diff review needs the reviewer persona"
        assert kw["override_request_overrides"] == {"temperature": 0.3}
        # model "openrouter:google/gemini-2-flash" split at the first colon;
        # the direct base_url endpoint resolves through the same
        # _resolve_delegation_credentials path as delegation.base_url.
        assert kw["model"] == "google/gemini-2-flash"
        assert kw["override_base_url"] == "https://api.example.com/v1"
        assert kw["override_api_key"] == "sk-xyz"
        assert kw["override_provider"] == "custom"

    def test_profile_provider_without_credentials_fails_loudly(
        self, parent, build_capture
    ):
        """A provider-model profile whose provider cannot resolve (sandbox
        has no credentials) must fail the spawn LOUDLY — an explicit profile
        reference never silently degrades to the default spawn."""
        global _PARENT_REF
        no_endpoint = dict(PROFILE)
        no_endpoint["provider"] = {}
        _write_config({"submodels": [no_endpoint]})
        _PARENT_REF = parent
        out = _spawn(profile="reviewer", reason="r")
        assert "error" in out
        assert "Delegation provider 'openrouter'" in out["error"]
        assert "no API key" in out["error"]
        assert not build_capture

    def test_unknown_profile_fails_loudly(self, parent, build_capture):
        global _PARENT_REF
        _write_config({"submodels": [dict(PROFILE)]})
        _PARENT_REF = parent
        out = _spawn(profile="does-not-exist", reason="r")
        assert "error" in out
        assert "unknown or disabled submodel profile 'does-not-exist'" in out["error"]
        # Nothing was built.
        assert not build_capture

    def test_disabled_profile_not_dispatchable(self, parent, build_capture):
        global _PARENT_REF
        _write_config({"submodels": [dict(PROFILE, enabled=False)]})
        _PARENT_REF = parent
        out = _spawn(profile="reviewer", reason="r")
        assert "error" in out
        assert "unknown or disabled submodel profile 'reviewer'" in out["error"]
        assert not build_capture

    def test_no_profile_path_matches_baseline(self, parent, build_capture):
        global _PARENT_REF
        _write_config({"submodels": [dict(PROFILE)]})
        _PARENT_REF = parent
        out = _spawn()
        assert out["results"][0]["status"] == "completed", out
        kw = build_capture
        # Baseline kwargs: everything profile-shaped is absent.
        assert kw["toolsets"] is None
        assert kw["override_system_prompt_extra"] is None
        assert kw["event_submodel_id"] is None
        assert kw["event_reason"] is None
        assert kw["override_request_overrides"] is None
        assert kw["model"] is None  # inherit parent
        assert kw["max_iterations"] == dt.DEFAULT_MAX_ITERATIONS


class TestEventAttribution:
    def test_progress_callback_relays_submodel_fields(self, parent):
        parent.tool_progress_callback = MagicMock()
        parent._delegate_spinner = None
        cb = dt._build_child_progress_callback(
            0,
            "goal",
            parent,
            subagent_id="sa-0-x",
            submodel_id="reviewer",
            reason="because",
        )
        assert cb is not None
        cb("subagent.start", preview="goal")
        call = parent.tool_progress_callback.call_args
        assert call.kwargs["submodel_id"] == "reviewer"
        assert call.kwargs["reason"] == "because"

    def test_plain_spawn_has_no_submodel_fields(self, parent):
        parent.tool_progress_callback = MagicMock()
        parent._delegate_spinner = None
        cb = dt._build_child_progress_callback(0, "goal", parent, subagent_id="sa-0-x")
        cb("subagent.start", preview="goal")
        call = parent.tool_progress_callback.call_args
        assert "submodel_id" not in call.kwargs
        assert "reason" not in call.kwargs


class TestRosterInjection:
    def test_schema_has_profile_and_reason_fields(self):
        overrides = dt._build_dynamic_schema_overrides()
        props = overrides["parameters"]["properties"]["tasks"]["items"]["properties"]
        assert "profile" in props
        assert "reason" in props

    def test_roster_in_description_only_with_enabled_profiles(self):
        _write_config({"submodels": [dict(PROFILE)]})
        desc = dt._build_top_level_description()
        assert "AVAILABLE SUBMODEL PROFILES" in desc
        assert "reviewer" in desc

        _write_config({"submodels": [dict(PROFILE, enabled=False)]})
        desc = dt._build_top_level_description()
        assert "AVAILABLE SUBMODEL PROFILES" not in desc

    def test_empty_roster_keeps_description_clean(self):
        _write_config({"submodels": []})
        desc = dt._build_top_level_description()
        assert "AVAILABLE SUBMODEL PROFILES" not in desc
        assert not desc.endswith("\n")


class TestA4IntersectionGuard:
    """A4 red-proof: profile toolsets can NEVER grant the child tools the
    parent lacks. Exercises the REAL `_build_child_agent` intersection
    (delegate_tool.py `child_toolsets = [t for t in toolsets if t in
    expanded_parent]`) with run_agent.AIAgent mocked at the class level.
    """

    @pytest.fixture
    def built_child_kwargs(self, monkeypatch, parent):
        agent_cls = MagicMock()
        monkeypatch.setattr("run_agent.AIAgent", agent_cls)
        _write_config({})  # default delegation block
        child = dt._build_child_agent(
            0,
            "do the focused review",
            None,
            ["file", "terminal", "web", "search"],  # profile asks for web+search too
            None,
            10,
            1,
            parent,
        )
        assert agent_cls.call_args, "AIAgent was never constructed"
        return child, agent_cls.call_args.kwargs

    def test_child_never_gains_toolsets_parent_lacks(self, built_child_kwargs):
        _child, kw = built_child_kwargs
        child_toolsets = kw["enabled_toolsets"]
        assert "web" not in child_toolsets
        assert "search" not in child_toolsets
        assert set(child_toolsets) <= {"file", "terminal"}
        # And the guard is real: the parent actually HAS these two.
        assert "file" in child_toolsets and "terminal" in child_toolsets
