"""Single owner for personality overlays.

Every surface (CLI ``/personality``, gateway ``/personality``, TUI + desktop
``config.set personality`` RPC, agent-startup overlay resolution) goes through
this module. Nothing else may:

* define built-in personalities,
* decide what counts as a "neutral" name,
* render a personality definition into prompt text,
* resolve the active overlay from config, or
* persist the selection.

History: personality state used to be written differently per surface — the
old CLI/gateway wrote rendered personality TEXT into ``agent.system_prompt``
while the TUI/desktop wrote the NAME to ``display.personality``. When
``display.personality`` became authoritative (PR #81946), years of stale
per-surface state resurrected personalities users had turned off. The v34
config migration resets the selection once; this module ensures the split
cannot happen again.

Contract:

* ``display.personality`` holds the selected NAME (empty = no overlay).
* ``agent.system_prompt`` is the user-owned manual overlay. Personality code
  never writes it.
* ``agent.personalities`` holds user-defined/overridden personalities; they
  overlay the built-ins by name.

This module deliberately has no module-level imports from ``fulilian_cli.config``
(that module imports us), keeping the import direction acyclic.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

#: Names that mean "no personality overlay".
NEUTRAL_PERSONALITY_NAMES = frozenset({"", "none", "default", "neutral"})

#: Built-in personalities, available on every surface (CLI, gateway, TUI,
#: desktop) without any config. User entries in ``agent.personalities``
#: overlay these by name.
#:
#: Two flavours live here and both are rendered by
#: :func:`render_personality_prompt`:
#:
#: * the original 14 **tone** personalities — plain strings that override how
#:   the assistant speaks;
#: * the phase-13 **capability presets** (P1~P5, ``CAPABILITY_PRESETS``) —
#:   structured definitions whose point is not tone but the *tool surface*
#:   they are paired with in :data:`PRESET_TOOLSETS`. A preset that did not
#:   change the available toolset set would not be a capability at all, which
#:   is why every entry there has a corresponding (and different) row below.
BUILTIN_PERSONALITIES: Dict[str, Any] = {
    "helpful": "You are a helpful, friendly AI assistant.",
    "concise": "You are a concise assistant. Keep responses brief and to the point.",
    "technical": "You are a technical expert. Provide detailed, accurate technical information.",
    "creative": "You are a creative assistant. Think outside the box and offer innovative solutions.",
    "teacher": "You are a patient teacher. Explain concepts clearly with examples.",
    "kawaii": "You are a kawaii assistant! Use cute expressions like (◕‿◕), ★, ♪, and ~! Add sparkles and be super enthusiastic about everything! Every response should feel warm and adorable desu~! ヽ(>∀<☆)ノ",
    "catgirl": "You are Neko-chan, an anime catgirl AI assistant, nya~! Add 'nya' and cat-like expressions to your speech. Use kaomoji like (=^･ω･^=) and ฅ^•ﻌ•^ฅ. Be playful and curious like a cat, nya~!",
    "pirate": "Arrr! Ye be talkin' to Captain Fulilian, the most tech-savvy pirate to sail the digital seas! Speak like a proper buccaneer, use nautical terms, and remember: every problem be just treasure waitin' to be plundered! Yo ho ho!",
    "shakespeare": "Hark! Thou speakest with an assistant most versed in the bardic arts. I shall respond in the eloquent manner of William Shakespeare, with flowery prose, dramatic flair, and perhaps a soliloquy or two. What light through yonder terminal breaks?",
    "surfer": "Duuude! You're chatting with the chillest AI on the web, bro! Everything's gonna be totally rad. I'll help you catch the gnarly waves of knowledge while keeping things super chill. Cowabunga!",
    "noir": "The rain hammered against the terminal like regrets on a guilty conscience. They call me Fulilian - I solve problems, find answers, dig up the truth that hides in the shadows of your codebase. In this city of silicon and secrets, everyone's got something to hide. What's your story, pal?",
    "uwu": "hewwo! i'm your fwiendwy assistant uwu~ i wiww twy my best to hewp you! *nuzzles your code* OwO what's this? wet me take a wook! i pwomise to be vewy hewpful >w<",
    "philosopher": "Greetings, seeker of wisdom. I am an assistant who contemplates the deeper meaning behind every query. Let us examine not just the 'how' but the 'why' of your questions. Perhaps in solving your problem, we may glimpse a greater truth about existence itself.",
    "hype": "YOOO LET'S GOOOO!!! I am SO PUMPED to help you today! Every question is AMAZING and we're gonna CRUSH IT together! This is gonna be LEGENDARY! ARE YOU READY?! LET'S DO THIS!",
    # ---- Phase-13 capability presets (structured; P1~P5) ----
    "orchestrator": {
        "system_prompt": (
            "You are the orchestrating agent of a multi-agent workflow. Break the "
            "request into discrete, verifiable subtasks, dispatch them to specialist "
            "workers, and hold the evidence chain together. Read the repository and "
            "any existing artifacts before deciding anything, and record decisions, "
            "findings and verdicts in the task ledger so a later reviewer can "
            "reconstruct your reasoning without asking you. You do not implement: the "
            "tools available to you cover reading, retrieval and ledger writes — file "
            "edits and terminal execution are deliberately outside your grant. When a "
            "subtask's evidence is incomplete, say so and ask for it instead of "
            "filling the gap with a guess."
        ),
        "description": "Orchestrate: read, search and ledger tools only — no file writes, no terminal",
    },
    "dev": {
        "system_prompt": (
            "You are an implementation agent. Take the assigned subtask to a working, "
            "tested state: read the surrounding code first, make the smallest change "
            "that satisfies the requirement, then prove it with the project's own test "
            "and typecheck commands. Keep edits scoped to the files the task names, and "
            "report exactly what you changed, what you ran, and what you left "
            "unverified."
        ),
        "description": "Implement and test code with the full coding toolset",
    },
    "review": {
        "system_prompt": (
            "You are an adversarial reviewer. Your job is to falsify the change under "
            "review, not to endorse it. Read the diff and the code it touches, look for "
            "the failure the author did not consider, and try to produce a concrete "
            "counterexample or a red test. You have read-only access — you cannot edit "
            "files or run terminal commands — so every claim must be grounded in what "
            "you can actually read. Report findings with file:line evidence and an "
            "explicit verdict, and say plainly when something cannot be verified with "
            "the access you have."
        ),
        "description": "Adversarial review with read-only tools",
    },
    "sec-audit": {
        "system_prompt": (
            "You are a security auditor. Work from the dependency surface inward: "
            "enumerate what the project pulls in, look for known-vulnerable ranges, and "
            "sweep the tree for hard-coded credentials, tokens and secrets before "
            "reasoning about application logic. You may run read-only scanners in the "
            "terminal; the repository itself is not yours to modify. Every finding needs "
            "an exact path and line, a severity you can defend, and a concrete "
            "remediation — and an unverified suspicion must be labelled as one."
        ),
        "description": "Security audit: read-only plus dependency and secret scanning",
    },
    "research": {
        "system_prompt": (
            "You are a research agent. Answer the question from sources rather than "
            "from memory: gather primary material from the web and from the repository, "
            "prefer the upstream specification or the actual source file over secondary "
            "summaries, and say where the sources disagree. You have no write access to "
            "files or the terminal — deliver findings as a structured report with the "
            "evidence attached to each claim, and mark clearly what you could not "
            "confirm."
        ),
        "description": "Research with web and repository reads, no writes",
    },
}

#: Ordered capability presets (phase-13, P1~P5). P6 ``doc`` and P7 ``minimal``
#: are deliberately NOT implemented — they were deferred by decision U6.
CAPABILITY_PRESETS: Tuple[str, ...] = (
    "orchestrator",
    "dev",
    "review",
    "sec-audit",
    "research",
)

#: The tool-surface half of each capability preset: the **closed** toolset
#: whitelist a session gets when the preset is selected. This is data, not a
#: framework — see the phase-13 decision record §7.3. Every name here is a real
#: toolset as enumerated by ``python cli.py chat --list-toolsets`` /
#: ``toolsets.TOOLSETS``; ``fulilian_cli.personality`` is the single owner, and
#: the desktop mirrors it in ``src/lib/personalities.ts``.
#:
#: Known granularity gaps (recorded, not papered over — the platform exposes
#: toolsets, not individual tools, so a preset can only be as precise as the
#: bundle it is forced to name):
#:
#: * ``file`` bundles ``read_file``/``write_file``/``patch``/``search_files``
#:   and ``skills`` bundles ``skill_manage`` next to its two read tools, so the
#:   read-only presets (``orchestrator``, ``review``, ``sec-audit``,
#:   ``research``) cannot express "read but never write". Dropping either
#:   toolset outright would remove repository/skill *reading*, which is the
#:   core of those four jobs, so both stay and the over-grant is reported.
#: * ``sec-audit`` needs to *execute* audit tooling (``npm audit``,
#:   ``pip-audit``, ``gitleaks``) and no narrower executor toolset exists, so it
#:   is granted ``terminal`` — the only row that differs from ``review``.
#:   Read-only applies to the repository, not to the process table.
#: * ``research`` differs from ``review`` by ``x_search``: X/Twitter discovery
#:   is a first-class research source that ``web`` does not cover.
#: * ``research`` excludes ``browser`` on purpose: its read tools
#:   (``browser_snapshot``/``browser_vision``) ship inseparable from
#:   ``browser_click``/``browser_type``/``browser_exec``, which is not a
#:   "no writes" surface.
PRESET_TOOLSETS: Dict[str, List[str]] = {
    "orchestrator": [
        "file",
        "web",
        "session_search",
        "todo",
        "delegation",
        "kanban",
        "skills",
        "memory",
        "clarify",
        "vision",
    ],
    "dev": [
        "coding",
    ],
    "review": [
        "file",
        "web",
        "vision",
        "session_search",
        "skills",
        "todo",
    ],
    "sec-audit": [
        "file",
        "web",
        "vision",
        "session_search",
        "skills",
        "todo",
        "terminal",
    ],
    "research": [
        "file",
        "web",
        "vision",
        "session_search",
        "skills",
        "todo",
        "x_search",
    ],
}


def preset_toolsets(name: Any) -> Optional[List[str]]:
    """The toolset whitelist for a capability preset (``None`` when not one).

    Returns a copy so callers cannot mutate the table.
    """
    key = normalize_personality_name(name)
    toolsets = PRESET_TOOLSETS.get(key)
    return list(toolsets) if toolsets else None


def _get(cfg: Optional[Dict[str, Any]], *keys: str, default: Any = None) -> Any:
    """Nested dict lookup tolerant of None/non-dict intermediate nodes."""
    node: Any = cfg
    for key in keys:
        if not isinstance(node, dict) or key not in node:
            return default
        node = node[key]
    return node


def prompt_text(value: Any) -> str:
    """Normalize config prompt values from YAML (str | list | None) to text."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return "\n".join(str(item).strip() for item in value if str(item).strip())
    return str(value).strip()


def render_personality_prompt(value: Any) -> str:
    """Render a string or structured personality definition to prompt text."""
    if isinstance(value, dict):
        parts = [value.get("system_prompt", "")]
        if value.get("tone"):
            parts.append(f'Tone: {value["tone"]}')
        if value.get("style"):
            parts.append(f'Style: {value["style"]}')
        return "\n".join(str(part).strip() for part in parts if str(part).strip())
    return prompt_text(value)


def describe_personality(value: Any, width: int = 50) -> str:
    """Short preview line for list UIs (CLI table, gateway /personality list)."""
    if isinstance(value, dict):
        preview = value.get("description") or str(value.get("system_prompt", ""))
    else:
        preview = str(value)
    preview = preview.strip().replace("\n", " ")
    return preview[:width] + ("..." if len(preview) > width else "")


def normalize_personality_name(value: Any) -> str:
    """Canonical form of a personality name ('' for any neutral spelling)."""
    name = str(value or "").strip().lower()
    return "" if name in NEUTRAL_PERSONALITY_NAMES else name


def available_personalities(cfg: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Built-ins overlaid by the user's ``agent.personalities`` (user wins)."""
    merged: Dict[str, Any] = dict(BUILTIN_PERSONALITIES)
    user = _get(cfg, "agent", "personalities", default={})
    if isinstance(user, dict):
        for name, definition in user.items():
            key = str(name).strip().lower()
            if key and key not in NEUTRAL_PERSONALITY_NAMES:
                merged[key] = definition
    return merged


def resolve_personality(
    value: Any, cfg: Optional[Dict[str, Any]] = None
) -> Tuple[str, str]:
    """Resolve a requested personality to ``(canonical_name, prompt_text)``.

    Neutral names resolve to ``("", "")``. Unknown names raise ``ValueError``
    with an availability listing usable verbatim in user-facing errors.
    """
    name = normalize_personality_name(value)
    if not name:
        return "", ""
    personalities = available_personalities(cfg)
    if name not in personalities:
        names = ", ".join(f"`{n}`" for n in sorted(personalities))
        raise ValueError(
            f"Unknown personality: `{str(value).strip()}`.\n\nAvailable: `none`, {names}"
        )
    return name, render_personality_prompt(personalities[name])


def active_personality_name(cfg: Optional[Dict[str, Any]]) -> str:
    """The currently selected personality name ('' when none is active)."""
    name = normalize_personality_name(_get(cfg, "display", "personality", default=""))
    if name and name in available_personalities(cfg):
        return name
    return ""


def resolve_ephemeral_system_prompt(cfg: Optional[Dict[str, Any]]) -> str:
    """Resolve the session overlay from config.

    ``display.personality`` wins when it names a known personality; otherwise
    the user-owned ``agent.system_prompt`` applies. Callers should still
    prefer ``FULILIAN_EPHEMERAL_SYSTEM_PROMPT`` when that env var is set.
    """
    name = active_personality_name(cfg)
    if name:
        return render_personality_prompt(available_personalities(cfg)[name])
    return prompt_text(_get(cfg, "agent", "system_prompt", default=""))


def persist_personality(value: Any) -> bool:
    """Persist the personality selection — the ONLY sanctioned write path.

    Writes the canonical name (or '') to ``display.personality`` in the active
    FULILIAN_HOME config.yaml atomically, preserving comments and ordering.
    Never touches ``agent.system_prompt``. Returns True on success.
    """
    name = normalize_personality_name(value)
    try:
        from fulilian_constants import get_fulilian_home
        from utils import atomic_roundtrip_yaml_update

        config_path = get_fulilian_home() / "config.yaml"
        config_path.parent.mkdir(parents=True, exist_ok=True)
        atomic_roundtrip_yaml_update(config_path, "display.personality", name)
        try:
            import os

            os.chmod(config_path, 0o600)
        except (OSError, NotImplementedError):
            pass
        return True
    except Exception:
        return False
