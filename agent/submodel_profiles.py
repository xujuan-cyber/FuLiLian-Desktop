"""Named submodel profiles (step 21: 自定义子模型派发).

A "submodel" is a named, user-authored profile that routes a delegated
child agent onto a specific model / provider / toolset / persona.  The
roster lives in the user's ``config.yaml`` under the top-level
``submodels:`` block (a list); reads go through
:func:`fulilian_cli.config.load_config_readonly`, whose mtime+size cache
signature gives hot-reload for free (a save is visible on the next read
with zero restarts).

Layer contract (see 协同编程/自定义子模型派发-分工与执行方案.md §3.1):

* ``validate_submodel`` returns ``(ok, errors)`` — it never raises.
* ``list_submodels`` skips invalid entries with a ``logger.warning`` —
  a broken profile must never block the parent agent.
* Toolset membership is checked against the STATIC registry
  (``toolsets.TOOLSETS``).  MCP toolsets are dynamic (registered at
  runtime), so an unknown name that looks MCP-shaped only warns.

Everything here is read-only against the config: callers must not
mutate the returned dicts.
"""

from __future__ import annotations

import copy
import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Writable fields of a profile — the schema the wizard drafts against and
# the whitelist ``submodels.save`` accepts. Anything else in an incoming
# entry is dropped before persistence so unknown keys can't ride along.
SUBMODEL_WRITABLE_FIELDS = (
    "id",
    "name",
    "description",
    "toolsets",
    "model",
    "provider",
    "max_iterations",
    "system_prompt_extra",
    "params",
    "enabled",
)

# Roster injection budget: the delegate_task description carries the
# enabled roster, so it must stay bounded (main system prompt cost).
ROSTER_MAX_PROFILES = 12
ROSTER_MAX_DESC_CHARS = 300

# Built-in templates for the "create from template" path.  Pure static
# data (方案 §3.2) — the frontend seeds a draft from one of these.
SUBMODEL_TEMPLATES: List[Dict[str, Any]] = [
    {
        "id": "tpl-code-reviewer",
        "name": "代码审查员",
        "description": (
            "审查代码变更，输出问题清单与修复建议（正确性/边界/安全/风格），"
            "不做大范围重构，不改文件。"
        ),
        "toolsets": ["file", "terminal"],
        "model": "",
        "max_iterations": 12,
        "system_prompt_extra": (
            "你是严格的代码审查员：按严重级别（阻塞/建议/可选）输出问题清单，"
            "每条给出文件位置与修复建议；不要修改任何文件。"
        ),
        "params": {"temperature": 0.2},
        "enabled": True,
    },
    {
        "id": "tpl-researcher",
        "name": "资料检索员",
        "description": (
            "面向开放问题的网络资料检索与汇总：多轮搜索、交叉验证来源，"
            "输出带引用链接的结构化结论。"
        ),
        "toolsets": ["web", "search"],
        "model": "",
        "max_iterations": 15,
        "system_prompt_extra": (
            "你是资料检索员：优先权威来源，交叉验证后再下结论，"
            "每条结论附来源链接；检索不到就明说，不要编造。"
        ),
        "params": {"temperature": 0.3},
        "enabled": True,
    },
    {
        "id": "tpl-doc-writer",
        "name": "文档撰写员",
        "description": (
            "根据要点/代码差异撰写或润色技术文档（README、变更说明、接口文档），"
            "保持既有文档风格。"
        ),
        "toolsets": ["file"],
        "model": "",
        "max_iterations": 10,
        "system_prompt_extra": (
            "你是技术文档撰写员：结构先行（标题/小节/示例），"
            "语言简洁准确，不堆砌形容词；遵循仓库现有文档的语言与格式。"
        ),
        "params": {"temperature": 0.4},
        "enabled": True,
    },
    {
        "id": "tpl-test-runner",
        "name": "测试运行员",
        "description": (
            "运行指定的测试命令、归档失败用例与关键日志，"
            "输出通过/失败统计与最小复现信息，不做修复。"
        ),
        "toolsets": ["terminal", "file"],
        "model": "",
        "max_iterations": 15,
        "system_prompt_extra": (
            "你是测试运行员：只运行指定范围的测试并汇总结果，"
            "失败用例给出命令、错误摘要与相关日志片段；不要尝试修复代码。"
        ),
        "params": {"temperature": 0.1},
        "enabled": True,
    },
]


def load_submodels_raw() -> List[Any]:
    """Return the raw ``submodels:`` list exactly as configured.

    Mirrors ``tools.delegate_tool._load_config``'s loader preference:
    the shared persistent loader (hot-reload via mtime cache) unless
    ``FULILIAN_IGNORE_USER_CONFIG=1`` is set. Never raises.
    """
    prefer_legacy = False
    try:
        import os

        prefer_legacy = os.environ.get("FULILIAN_IGNORE_USER_CONFIG") == "1"
    except Exception:
        prefer_legacy = False
    if not prefer_legacy:
        try:
            from fulilian_cli.config import load_config_readonly

            full = load_config_readonly()
            raw = full.get("submodels")
            if isinstance(raw, list):
                return raw
            return []
        except Exception:
            pass
    try:
        from cli import CLI_CONFIG

        raw = CLI_CONFIG.get("submodels")
        return raw if isinstance(raw, list) else []
    except Exception:
        return []


def _looks_like_mcp_toolset(name: str) -> bool:
    lowered = (name or "").strip().lower()
    return lowered.startswith(("mcp_", "mcp:"))


def validate_submodel(
    entry: Any, existing_ids: Optional[List[str]] = None
) -> Tuple[bool, List[str]]:
    """Validate one profile entry against the §3.1 schema.

    Returns ``(ok, errors)``; never raises. ``existing_ids`` (ids of the
    OTHER saved profiles) makes id-uniqueness checkable on upsert.
    """
    errors: List[str] = []
    if not isinstance(entry, dict):
        return False, ["profile must be a mapping/object"]

    pid = str(entry.get("id") or "").strip()
    if not pid:
        errors.append("id is required and must be non-empty")
    if existing_ids is not None and pid and pid in existing_ids:
        errors.append(f"id '{pid}' already exists")

    if not str(entry.get("name") or "").strip():
        errors.append("name is required and must be non-empty")

    toolsets = entry.get("toolsets")
    if toolsets is not None:
        if not isinstance(toolsets, list) or not all(
            isinstance(t, str) for t in toolsets
        ):
            errors.append("toolsets must be a list of strings")
        else:
            try:
                from toolsets import TOOLSETS

                registered = set(TOOLSETS.keys())
            except Exception:
                registered = None
            if registered is not None:
                for t in toolsets:
                    if t in registered:
                        continue
                    if _looks_like_mcp_toolset(t):
                        # Dynamic MCP toolsets are registered at runtime —
                        # unverifiable statically, warn only.
                        logger.warning(
                            "submodel toolset '%s' is MCP-dynamic; it will be "
                            "intersected with the parent's toolsets at dispatch",
                            t,
                        )
                    else:
                        errors.append(
                            f"unknown toolset '{t}' (not in the registered "
                            "toolset list)"
                        )

    model = entry.get("model")
    if model is not None and str(model).strip():
        text = str(model).strip()
        if ":" not in text:
            errors.append(
                "model must be 'provider:model' (e.g. 'openrouter:google/gemini-2-flash')"
            )

    provider = entry.get("provider")
    if provider is not None and not isinstance(provider, dict):
        errors.append("provider must be an object {base_url, api_key, api_mode}")
    elif isinstance(provider, dict):
        for key in ("base_url", "api_key", "api_mode"):
            val = provider.get(key)
            if val is not None and not isinstance(val, str):
                errors.append(f"provider.{key} must be a string")

    max_iterations = entry.get("max_iterations")
    if max_iterations is not None:
        if not isinstance(max_iterations, int) or isinstance(max_iterations, bool):
            errors.append("max_iterations must be an integer")
        elif max_iterations < 1:
            errors.append("max_iterations must be >= 1")

    params = entry.get("params")
    if params is not None:
        if not isinstance(params, dict):
            errors.append("params must be an object")
        else:
            temperature = params.get("temperature")
            if temperature is not None and not isinstance(temperature, (int, float)):
                errors.append("params.temperature must be a number")

    if entry.get("system_prompt_extra") is not None and not isinstance(
        entry.get("system_prompt_extra"), str
    ):
        errors.append("system_prompt_extra must be a string")

    if entry.get("enabled") is not None and not isinstance(entry.get("enabled"), bool):
        errors.append("enabled must be a boolean")

    return (len(errors) == 0), errors


def _effective_entry(entry: Any) -> Optional[Dict[str, Any]]:
    """Normalize one raw config entry to a dispatchable profile dict.

    Returns None (with a warning) when the entry is invalid — a broken
    profile is skipped, never fatal for the parent agent.
    """
    ok, errors = validate_submodel(entry)
    if not ok:
        pid = str(entry.get("id") or "?") if isinstance(entry, dict) else "?"
        logger.warning(
            "Skipping invalid submodel profile '%s': %s", pid, "; ".join(errors)
        )
        return None
    out = dict(entry)
    out.setdefault("enabled", True)
    return out


def list_submodels(*, enabled_only: bool = False) -> List[Dict[str, Any]]:
    """Return the VALID configured profiles (invalid ones skipped+warned)."""
    out: List[Dict[str, Any]] = []
    seen_ids: set = set()
    for entry in load_submodels_raw():
        eff = _effective_entry(entry)
        if eff is None:
            continue
        pid = eff["id"]
        if pid in seen_ids:
            logger.warning(
                "Duplicate submodel id '%s' — keeping the first occurrence", pid
            )
            continue
        seen_ids.add(pid)
        if enabled_only and not eff.get("enabled", True):
            continue
        out.append(eff)
    return out


def resolve_submodel(
    submodel_id: str, *, enabled_only: bool = True
) -> Optional[Dict[str, Any]]:
    """Resolve one profile by id. None when unknown/disabled/invalid."""
    sid = str(submodel_id or "").strip()
    if not sid:
        return None
    for entry in list_submodels():
        if entry.get("id") == sid:
            if enabled_only and not entry.get("enabled", True):
                return None
            return entry
    return None


def mask_api_key(key: Any) -> str:
    """Mask an api_key for the RPC read path (never echo plaintext)."""
    text = str(key or "")
    if not text:
        return ""
    if len(text) <= 8:
        return "*" * len(text)
    return text[:4] + "…" + text[-4:]


def is_masked_api_key(key: Any) -> bool:
    """True when ``key`` matches :func:`mask_api_key`'s output shapes.

    Save-path echo-back guard: ``submodels.list`` hands the client a
    masked key, so an edit round-trip may carry the mask back. Two mask
    shapes exist — all-asterisks (keys of length <= 8) and
    ``first4 + '…' + last4`` (U+2026 ellipsis, longer keys). A real key
    matches neither. Empty string is NOT a mask ("no key" is legitimate).
    """
    text = str(key or "")
    if not text:
        return False
    if "\u2026" in text:
        return True
    return set(text) == {"*"}


def sanitize_for_client(entry: Dict[str, Any]) -> Dict[str, Any]:
    """Deep-copy a profile with its provider.api_key masked for RPC output."""
    out = copy.deepcopy(entry)
    provider = out.get("provider")
    if isinstance(provider, dict) and provider.get("api_key"):
        provider["api_key"] = mask_api_key(provider["api_key"])
    return out


def profile_to_delegation_cfg(profile: Dict[str, Any]) -> Dict[str, Any]:
    """Flatten a profile into a ``delegation:``-shaped credentials dict.

    Shape matches what ``tools.delegate_tool._resolve_delegation_credentials``
    consumes: {model, provider, base_url, api_key, api_mode}.  The profile's
    ``model: provider:model`` is split at the FIRST colon so model names
    containing slashes/colons survive intact.
    """
    raw_model = str(profile.get("model") or "").strip()
    provider_name = ""
    model_name = raw_model
    if ":" in raw_model:
        provider_name, model_name = raw_model.split(":", 1)
    provider_block = profile.get("provider") if isinstance(profile.get("provider"), dict) else {}
    provider_block = provider_block or {}
    cfg: Dict[str, Any] = {
        "model": model_name.strip(),
        "provider": provider_name.strip(),
        "base_url": str(provider_block.get("base_url") or "").strip(),
        "api_key": str(provider_block.get("api_key") or "").strip(),
        "api_mode": str(provider_block.get("api_mode") or "").strip(),
    }
    return cfg


def build_roster_section(entries: Optional[List[Dict[str, Any]]] = None) -> str:
    """Build the「可用子模型档案」description section for delegate_task.

    Budgeted: enabled profiles only, description truncated to
    ROSTER_MAX_DESC_CHARS, at most ROSTER_MAX_PROFILES listed (the rest
    collapse into a count line).  Empty/None roster → "" so the
    description gains no empty paragraph.
    """
    if entries is None:
        entries = list_submodels(enabled_only=True)
    if not entries:
        return ""
    lines = [
        "",
        "AVAILABLE SUBMODEL PROFILES (dispatch via tasks[].profile):",
        "Before delegating, judge in three steps:",
        "1. A task you can finish directly in a few steps — do it yourself; "
        "do NOT delegate.",
        "2. A task that cannot decompose along a profile's responsibility — "
        "do NOT force a dispatch.",
        "3. No profile matches the work — do NOT dispatch. Only dispatch when "
        "a profile clearly matches, and pass `reason` explaining why THIS "
        "profile fits.",
        "Profiles:",
    ]
    shown = entries[:ROSTER_MAX_PROFILES]
    for entry in shown:
        desc = str(entry.get("description") or "").strip().replace("\n", " ")
        if len(desc) > ROSTER_MAX_DESC_CHARS:
            desc = desc[:ROSTER_MAX_DESC_CHARS].rstrip() + "…"
        toolsets = entry.get("toolsets") or []
        toolsets_hint = f" tools: {', '.join(toolsets)}" if toolsets else ""
        lines.append(
            f"- profile \"{entry.get('id', '')}\" ({entry.get('name', '')}): "
            f"{desc}{toolsets_hint}"
        )
    overflow = len(entries) - len(shown)
    if overflow > 0:
        lines.append(f"(+{overflow} more profiles not listed)")
    return "\n".join(lines)


# ── Wizard (对话式设定) ────────────────────────────────────────────────
# System instructions for `submodels.wizard_turn`: a stateless one-shot
# call where the FRONTEND holds the full conversation history. The wizard
# clarifies in four questions (problem / example / output style / tools)
# and, once the conversation converges, emits a ```json draft fence whose
# fields are the writable subset of the §3.1 schema.

WIZARD_DRAFT_FIELDS = list(SUBMODEL_WRITABLE_FIELDS)

WIZARD_SYSTEM_PROMPT = (
    "You are the setup wizard for a custom submodel profile (子模型档案) in "
    "the Fulilian desktop app. The user is chatting with you to define a "
    "delegable sub-agent. Reply in the user's language.\n\n"
    "Your job, over a few short turns:\n"
    "1. Clarify FOUR things, asking at most 1-2 questions per turn and only "
    "for what the user hasn't already answered:\n"
    "   a. 问题 — what recurring kind of task should this submodel handle?\n"
    "   b. 示例 — one concrete example task it should be able to do.\n"
    "   c. 输出风格 — what should its results look like (format, tone, "
    "constraints)?\n"
    "   d. 工具 — which capabilities it needs (terminal/file/web/search "
    "...).\n"
    "2. Once you have enough answers (or the user says it's enough), "
    "produce the FINAL draft: append a fenced block exactly like:\n"
    "```json\n"
    "{\n"
    "  \"name\": \"...\",\n"
    "  \"description\": \"one-paragraph responsibility: scene + example + "
    "boundaries\",\n"
    "  \"toolsets\": [\"...\"],\n"
    "  \"model\": \"provider:model\",\n"
    "  \"max_iterations\": 12,\n"
    "  \"system_prompt_extra\": \"role instructions for the sub-agent\",\n"
    "  \"params\": {\"temperature\": 0.3},\n"
    "  \"enabled\": true\n"
    "}\n"
    "```\n"
    "Allowed draft fields: " + ", ".join(WIZARD_DRAFT_FIELDS) + ".\n"
    "Rules: description is the dispatch-matching key — write it as "
    "场景 + 示例 + 边界 in one paragraph; omit model to inherit the parent "
    "model; never invent toolset names outside the user's mentioned "
    "capabilities; keep the reply conversational (the JSON draft is "
    "additive, not a replacement for the answer).\n"
    "Edit mode: when the conversation already carries an existing "
    "profile's JSON, treat it as the current state — ask only incremental "
    "clarifying questions about what the user wants to change, and the "
    "final draft MUST be the complete modified profile (all fields, "
    "unchanged ones included), never a diff."
)


def extract_wizard_draft(text: Any) -> Optional[Dict[str, Any]]:
    """Extract the wizard's draft object from a reply.

    Scans ```json (or bare ``` ) fences from the LAST backwards; a fence
    parses as JSON AND is a dict with a non-empty "name" to count as a
    draft. A fence-less pure-JSON reply also counts. Parse failure /
    non-draft content → None (the caller returns just the reply — the
    wizard conversation simply hasn't converged yet, never an error).
    """
    import json as _json
    import re as _re

    if not text or not isinstance(text, str):
        return None
    candidates: List[str] = []
    for block in _re.findall(r"```[ \t]*json[ \t]*\n(.*?)```", text, _re.DOTALL):
        candidates.append(block)
    # Also accept unfenced bare-JSON replies.
    candidates.append(text)
    for block in reversed(candidates):
        try:
            data = _json.loads(block.strip())
        except Exception:
            continue
        if (
            isinstance(data, dict)
            and str(data.get("name") or "").strip()
        ):
            return data
    return None
