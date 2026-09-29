"""Step-13 DEV-B — capability presets: definition table + session-level toolset gate.

Covers the phase-13 contract in three parts:

1. the preset definitions (``BUILTIN_PERSONALITIES`` P1~P5 + ``PRESET_TOOLSETS``)
   are internally consistent, use *real* toolset names, and are pairwise
   distinct — a preset that did not change the tool surface would not be a
   capability at all (decision R6);
2. the session-level override (``_get_platform_tools(..., toolsets_override=)``)
   is a **real** gate: a toolset the preset omits is genuinely unresolvable,
   not merely discouraged by prompt text;
3. the override is default-off: every pre-phase-13 caller keeps the platform
   resolution unchanged (``toolsets_override=None``).
"""

from fulilian_cli.personality import (
    BUILTIN_PERSONALITIES,
    CAPABILITY_PRESETS,
    PRESET_TOOLSETS,
    preset_toolsets,
    render_personality_prompt,
)
from fulilian_cli.tools_config import (
    _get_platform_tools,
    _resolve_toolsets_override,
    _toolset_allowed_for_platform,
)
from toolsets import TOOLSETS, resolve_multiple_toolsets, validate_toolset

# The 14 tone personalities that shipped before phase 13. They must keep working
# untouched — the presets are additive, never a replacement.
LEGACY_TONE_PERSONALITIES = (
    "helpful",
    "concise",
    "technical",
    "creative",
    "teacher",
    "kawaii",
    "catgirl",
    "pirate",
    "shakespeare",
    "surfer",
    "noir",
    "uwu",
    "philosopher",
    "hype",
)

PLATFORM_TOOLSETS_FIXTURE = {"platform_toolsets": {"cli": ["fulilian-cli"]}}


def _enabled_toolsets(preset: str) -> set[str]:
    return _get_platform_tools(
        PLATFORM_TOOLSETS_FIXTURE, "cli", toolsets_override=PRESET_TOOLSETS[preset]
    )


def _enabled_tools(preset: str) -> set[str]:
    return set(resolve_multiple_toolsets(sorted(_enabled_toolsets(preset))))


class TestPresetDefinitions:
    def test_exactly_the_five_decided_presets_exist(self):
        assert CAPABILITY_PRESETS == ("orchestrator", "dev", "review", "sec-audit", "research")
        assert set(PRESET_TOOLSETS) == set(CAPABILITY_PRESETS)

    def test_deferred_presets_are_not_implemented(self):
        # U6 deferred P6 `doc` and P7 `minimal`; implementing them is out of scope.
        for deferred in ("doc", "minimal"):
            assert deferred not in BUILTIN_PERSONALITIES
            assert deferred not in PRESET_TOOLSETS

    def test_presets_are_builtin_personalities(self):
        assert set(PRESET_TOOLSETS) <= set(BUILTIN_PERSONALITIES)

    def test_legacy_tone_personalities_survive_verbatim(self):
        assert set(LEGACY_TONE_PERSONALITIES) <= set(BUILTIN_PERSONALITIES)
        # Still plain strings — a structured rewrite would be a behaviour change.
        for name in LEGACY_TONE_PERSONALITIES:
            assert isinstance(BUILTIN_PERSONALITIES[name], str)
        assert BUILTIN_PERSONALITIES["helpful"] == "You are a helpful, friendly AI assistant."

    def test_presets_are_structured_and_render_through_the_single_owner(self):
        for name in CAPABILITY_PRESETS:
            definition = BUILTIN_PERSONALITIES[name]
            assert isinstance(definition, dict), name
            assert definition.get("system_prompt"), name
            assert definition.get("description"), name
            # Rendering must go through render_personality_prompt, and the
            # rendered text must be the instruction — never the raw dict.
            rendered = render_personality_prompt(definition)
            assert definition["system_prompt"] in rendered
            assert "system_prompt" not in rendered

    def test_every_bound_toolset_is_real_and_permitted_on_cli(self):
        for preset, toolsets in PRESET_TOOLSETS.items():
            assert toolsets, preset
            for name in toolsets:
                assert name in TOOLSETS, f"{preset}: unknown toolset {name}"
                assert validate_toolset(name), f"{preset}: unvalidated toolset {name}"
                assert _toolset_allowed_for_platform(name, "cli"), f"{preset}: {name} not cli"
                assert resolve_multiple_toolsets([name]), f"{preset}: {name} resolves to nothing"

    def test_no_preset_grants_the_full_coding_surface_by_accident(self):
        # Only `dev` is allowed to be the full coding posture; the others must
        # be strictly narrower or the gate is cosmetic.
        coding_tools = set(resolve_multiple_toolsets(["coding"]))
        for preset in ("orchestrator", "review", "sec-audit", "research"):
            assert not coding_tools <= _enabled_tools(preset), preset

    def test_preset_tool_sets_are_pairwise_distinct(self):
        seen: dict[frozenset[str], str] = {}
        for preset in CAPABILITY_PRESETS:
            surface = frozenset(_enabled_toolsets(preset))
            assert surface, preset
            assert surface not in seen, f"{preset} duplicates {seen.get(surface)}"
            seen[surface] = preset

    def test_preset_toolsets_returns_a_copy(self):
        first = preset_toolsets("dev")
        assert first == ["coding"]
        first.append("terminal")
        assert preset_toolsets("dev") == ["coding"]
        assert preset_toolsets("helpful") is None
        assert preset_toolsets("none") is None
        assert preset_toolsets("DEV") == ["coding"]


class TestSessionToolsetGate:
    """A9 — the gate must be real, not a prompt-level suggestion."""

    def test_override_is_honoured_verbatim(self):
        for preset in CAPABILITY_PRESETS:
            expected = set(PRESET_TOOLSETS[preset])
            assert _enabled_toolsets(preset) == expected, preset

    def test_review_preset_loses_terminal_and_execution(self):
        enabled = _enabled_toolsets("review")
        assert "terminal" not in enabled
        assert "code_execution" not in enabled
        assert "coding" not in enabled
        assert "computer_use" not in enabled
        assert "browser" not in enabled

        tools = _enabled_tools("review")
        # Counter-proof: the excluded capability is absent from the resolved
        # tool surface the agent would actually be handed.
        assert "terminal" not in tools
        assert "process" not in tools
        assert "execute_code" not in tools
        assert "browser_exec" not in tools
        assert "computer_use" not in tools
        # …while the read surface the preset exists for IS present.
        assert {"read_file", "search_files", "web_search", "web_extract"} <= tools

    def test_known_granularity_gap_is_pinned(self):
        """`file`/`skills` bundle their write tools, so read-only presets
        over-grant by construction. This test pins the gap so that the day a
        finer-grained toolset lands, this assertion fails loudly and the table
        can be tightened instead of the gap silently persisting."""
        review_tools = _enabled_tools("review")
        assert "write_file" in review_tools, "gap closed: drop `file` from read-only presets"
        assert "patch" in review_tools, "gap closed: drop `file` from read-only presets"
        assert "skill_manage" in review_tools, "gap closed: drop `skills` from read-only presets"

    def test_dev_preset_keeps_the_coding_surface(self):
        tools = _enabled_tools("dev")
        assert {"read_file", "write_file", "patch", "terminal", "search_files"} <= tools

    def test_sec_audit_differs_from_review_by_terminal_only(self):
        review = _enabled_toolsets("review")
        sec = _enabled_toolsets("sec-audit")
        assert sec - review == {"terminal"}
        assert not review - sec

    def test_research_differs_from_review_by_x_search_only(self):
        review = _enabled_toolsets("review")
        research = _enabled_toolsets("research")
        assert research - review == {"x_search"}
        assert not review - research

    def test_orchestrator_has_ledger_but_no_writer_toolset(self):
        enabled = _enabled_toolsets("orchestrator")
        assert {"kanban", "delegation"} <= enabled
        tools = _enabled_tools("orchestrator")
        assert "kanban_complete" in tools
        for writer in ("terminal", "process", "execute_code", "browser_exec", "computer_use"):
            assert writer not in tools

    def test_unknown_names_are_dropped_not_widened(self):
        resolved = _resolve_toolsets_override(
            PLATFORM_TOOLSETS_FIXTURE, "cli", ["terminal", "definitely-not-a-toolset"]
        )
        assert resolved == {"terminal"}

    def test_empty_override_resolves_to_no_toolsets(self):
        # Fail closed: an empty whitelist must never degrade into "all tools".
        assert _get_platform_tools(
            PLATFORM_TOOLSETS_FIXTURE, "cli", toolsets_override=[]
        ) == set()

    def test_agent_disabled_toolsets_still_subtracts(self):
        config = {
            "platform_toolsets": {"cli": ["fulilian-cli"]},
            "agent": {"disabled_toolsets": ["terminal"]},
        }
        resolved = _get_platform_tools(
            config, "cli", toolsets_override=PRESET_TOOLSETS["sec-audit"]
        )
        assert "terminal" not in resolved


class TestDefaultResolutionUnchanged:
    """A10 — omitting the new parameter must be byte-identical to before."""

    def test_none_override_equals_the_parameterless_call(self):
        assert _get_platform_tools(
            PLATFORM_TOOLSETS_FIXTURE, "cli"
        ) == _get_platform_tools(
            PLATFORM_TOOLSETS_FIXTURE, "cli", toolsets_override=None
        )

    def test_none_override_keeps_platform_expansion(self):
        # The platform path still sees the composite `fulilian-cli` expanded
        # into its configurable members — i.e. the override branch did not
        # accidentally become the only live path.
        resolved = _get_platform_tools(PLATFORM_TOOLSETS_FIXTURE, "cli")
        assert len(resolved) > 1
        assert "file" in resolved
        assert "fulilian-cli" not in resolved

    def test_default_falls_back_to_platform_default_toolset(self):
        resolved = _get_platform_tools({}, "cli")
        assert resolved, "an unconfigured platform must still get its default toolsets"

    def test_other_callers_are_unaffected_by_the_new_keyword(self):
        # `commands.py` / `doctor.py` / `kanban_db.py` call positionally with
        # the keyword-only `include_default_mcp_servers` flag; that call shape
        # must keep working unchanged.
        with_mcp = _get_platform_tools(
            PLATFORM_TOOLSETS_FIXTURE, "cli", include_default_mcp_servers=True
        )
        without_mcp = _get_platform_tools(
            PLATFORM_TOOLSETS_FIXTURE, "cli", include_default_mcp_servers=False
        )
        assert without_mcp <= with_mcp
