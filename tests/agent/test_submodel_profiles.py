"""Tests for the named submodel profile layer (step 21 自定义子模型派发).

Covers:
- validate_submodel: §3.1 field rules (id/name/toolsets/model/provider/
  params/enabled), MCP-shaped toolsets warn-only;
- list_submodels: invalid entries skipped with a warning, duplicate ids
  keep the first occurrence;
- hot reload: a config.yaml rewrite is visible on the next read (mtime
  cache invalidation) — acceptance criterion 4;
- roster section budgeting (empty roster → "", truncation + listing cap);
- wizard draft extraction (fenced JSON, bare JSON, garbage).
"""

import json
import logging

import pytest

from agent import submodel_profiles as sp


VALID_ENTRY = {
    "id": "code-reviewer",
    "name": "代码审查员",
    "description": "审查代码变更，输出问题清单与修复建议。",
    "toolsets": ["file", "terminal"],
    "model": "openrouter:google/gemini-2-flash",
    "provider": {"base_url": "", "api_key": "sk-abcdef1234567890", "api_mode": ""},
    "max_iterations": 12,
    "system_prompt_extra": "你是严格的代码审查员。",
    "params": {"temperature": 0.3},
    "enabled": True,
}


def _write_config(home, cfg: dict):
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.yaml").write_text(
        json.dumps(cfg), encoding="utf-8"
    )


class TestValidateSubmodel:
    def test_valid_entry_passes(self):
        ok, errors = sp.validate_submodel(VALID_ENTRY)
        assert ok, errors

    def test_missing_id_and_name(self):
        ok, errors = sp.validate_submodel({"toolsets": ["file"]})
        assert not ok
        assert any("id" in e for e in errors)
        assert any("name" in e for e in errors)

    def test_non_mapping(self):
        ok, errors = sp.validate_submodel("nope")
        assert not ok
        assert errors == ["profile must be a mapping/object"]

    def test_unknown_toolset_rejected(self):
        entry = dict(VALID_ENTRY, toolsets=["file", "not-a-real-toolset"])
        ok, errors = sp.validate_submodel(entry)
        assert not ok
        assert any("not-a-real-toolset" in e for e in errors)

    def test_mcp_shaped_toolset_warns_only(self, caplog):
        entry = dict(VALID_ENTRY, toolsets=["file", "mcp_github"])
        with caplog.at_level(logging.WARNING):
            ok, errors = sp.validate_submodel(entry)
        assert ok, errors
        assert any("mcp_github" in r.message for r in caplog.records)

    def test_model_requires_provider_prefix(self):
        entry = dict(VALID_ENTRY, model="just-a-model")
        ok, errors = sp.validate_submodel(entry)
        assert not ok
        assert any("provider:model" in e for e in errors)

    def test_temperature_must_be_numeric(self):
        entry = dict(VALID_ENTRY, params={"temperature": "hot"})
        ok, errors = sp.validate_submodel(entry)
        assert not ok
        assert any("temperature" in e for e in errors)

    def test_max_iterations_must_be_positive_int(self):
        for bad in (0, -3, "twelve", True):
            entry = dict(VALID_ENTRY, max_iterations=bad)
            ok, errors = sp.validate_submodel(entry)
            assert not ok, bad
            assert any("max_iterations" in e for e in errors)

    def test_duplicate_id_detected_against_existing_ids(self):
        ok, errors = sp.validate_submodel(
            dict(VALID_ENTRY), existing_ids=["code-reviewer"]
        )
        assert not ok
        assert any("already exists" in e for e in errors)

    def test_provider_must_be_object(self):
        entry = dict(VALID_ENTRY, provider="openrouter")
        ok, errors = sp.validate_submodel(entry)
        assert not ok
        assert any("provider" in e for e in errors)


class TestListSubmodels:
    def test_invalid_entries_skipped_with_warning(self, caplog):
        raws = [
            dict(VALID_ENTRY),
            {"id": "broken", "name": ""},  # missing name
            {"id": "also-broken", "toolsets": ["nope"]},
        ]
        with caplog.at_level(logging.WARNING):
            entries = []
            for entry in raws:
                eff = sp._effective_entry(entry)
                if eff is not None:
                    entries.append(eff)
        assert [e["id"] for e in entries] == ["code-reviewer"]
        assert any("Skipping invalid submodel profile" in r.message for r in caplog.records)

    def test_duplicate_id_keeps_first(self):
        raws = [dict(VALID_ENTRY), dict(VALID_ENTRY, name="second")]
        seen, out = set(), []
        for entry in raws:
            eff = sp._effective_entry(entry)
            if eff is None:
                continue
            if eff["id"] in seen:
                continue
            seen.add(eff["id"])
            out.append(eff)
        assert len(out) == 1
        assert out[0]["name"] == "代码审查员"


class TestHotReload:
    def test_config_write_visible_immediately(self, tmp_path, monkeypatch):
        # conftest already redirects FULILIAN_HOME per test; re-point it at
        # our own tmp home so the config write is fully deterministic.
        home = tmp_path / "fulilian"
        monkeypatch.setenv("FULILIAN_HOME", str(home))
        _write_config(home, {"submodels": [dict(VALID_ENTRY)]})
        assert [e["id"] for e in sp.list_submodels()] == ["code-reviewer"]

        # Rewrite with a DIFFERENT profile — the mtime/size cache signature
        # must invalidate; the new roster is visible on the next read with
        # zero restarts (acceptance criterion 4).
        _write_config(
            home,
            {"submodels": [dict(VALID_ENTRY, id="researcher", name="资料检索员")]},
        )
        entries = sp.list_submodels()
        assert [e["id"] for e in entries] == ["researcher"]

        # Disabled profiles drop out of the enabled-only roster but stay
        # resolvable for introspection.
        _write_config(
            home,
            {"submodels": [dict(VALID_ENTRY, id="r2", enabled=False)]},
        )
        assert sp.list_submodels(enabled_only=True) == []
        assert sp.resolve_submodel("r2", enabled_only=False) is not None
        assert sp.resolve_submodel("r2", enabled_only=True) is None


class TestRosterSection:
    def test_empty_roster_yields_empty_string(self):
        assert sp.build_roster_section([]) == ""
        assert sp.build_roster_section(None) == ""  # sandboxed home: no config

    def test_budget_truncation_and_cap(self):
        entries = [
            {
                "id": f"p{i}",
                "name": f"P{i}",
                "description": "x" * 1000,
                "toolsets": ["file"],
            }
            for i in range(15)
        ]
        section = sp.build_roster_section(entries)
        assert "p0" in section
        assert "p11" in section
        assert "p12" not in section
        assert "(+3 more profiles not listed)" in section
        # Per-profile description truncation: no raw 1000-char run survives.
        assert "x" * 500 not in section

    def test_three_step_judgment_present(self):
        section = sp.build_roster_section([dict(VALID_ENTRY)])
        assert "do NOT dispatch" in section
        assert "reason" in section


class TestMaskAndDraft:
    def test_mask_api_key(self):
        assert sp.mask_api_key("") == ""
        assert sp.mask_api_key("short") == "*****"
        masked = sp.mask_api_key("sk-abcdef1234567890")
        assert masked.startswith("sk-a")
        assert masked.endswith("7890")
        assert "bcdef12345" not in masked

    def test_sanitize_for_client_masks_provider_key(self):
        view = sp.sanitize_for_client(dict(VALID_ENTRY))
        assert view["provider"]["api_key"] == sp.mask_api_key("sk-abcdef1234567890")
        # Original untouched.
        assert VALID_ENTRY["provider"]["api_key"] == "sk-abcdef1234567890"

    def test_profile_to_delegation_cfg_splits_provider_model(self):
        cfg = sp.profile_to_delegation_cfg(VALID_ENTRY)
        assert cfg["model"] == "google/gemini-2-flash"
        assert cfg["provider"] == "openrouter"
        assert cfg["api_key"] == "sk-abcdef1234567890"

    def test_extract_wizard_draft_fenced(self):
        reply = '好的，这是草稿。\n```json\n{"name": "审查员", "toolsets": ["file"]}\n```'
        draft = sp.extract_wizard_draft(reply)
        assert draft == {"name": "审查员", "toolsets": ["file"]}

    def test_extract_wizard_draft_bare_json(self):
        assert sp.extract_wizard_draft('{"name": "x"}') == {"name": "x"}

    def test_extract_wizard_draft_none_on_chatter(self):
        assert sp.extract_wizard_draft("请问它主要处理什么问题？") is None
        assert sp.extract_wizard_draft("```json\nnot json\n```") is None

    def test_extract_wizard_draft_last_fence_wins(self):
        reply = (
            '```json\n{"name": "old"}\n```\n'
            "更新一下：\n```json\n{\"name\": \"new\"}\n```"
        )
        assert sp.extract_wizard_draft(reply)["name"] == "new"


class TestWizardPrompt:
    def test_prompt_covers_edit_scenario(self):
        """Edit mode instruction: an existing profile JSON in the
        conversation means incremental clarification on top of the current
        state, and the draft is the COMPLETE modified profile (not a
        diff) — otherwise an edit round-trip would drop untouched fields
        (provider.api_key included) on save."""
        prompt = sp.WIZARD_SYSTEM_PROMPT.lower()
        assert "edit mode" in prompt
        assert "existing" in prompt and "profile" in prompt
        assert "incremental" in prompt
        assert "complete modified profile" in prompt
        assert "never a diff" in prompt


class TestTemplates:
    def test_builtin_templates_shape(self):
        assert len(sp.SUBMODEL_TEMPLATES) >= 3
        for tpl in sp.SUBMODEL_TEMPLATES:
            ok, errors = sp.validate_submodel(tpl)
            assert ok, (tpl.get("id"), errors)
