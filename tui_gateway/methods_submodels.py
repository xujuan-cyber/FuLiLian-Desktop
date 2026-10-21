"""submodels.* JSON-RPC handlers (step 21 自定义子模型派发).

CRITICAL (see method_ctx.py): handler BODIES are rebound onto server.py's
globals via ``types.FunctionType`` at install time — a body may only
reference names that exist in server.py (``_ok`` / ``_err`` /
``_load_cfg_raw`` / ``_save_cfg`` / ...) plus imports made INSIDE the
body. Module-level constants of THIS file are invisible to the installed
handlers, so every constant lives in ``agent.submodel_profiles`` and is
imported at call time.

Methods:
  - submodels.list      full roster (provider.api_key masked, per-entry
                        validation verdict included so the UI can flag
                        hand-edited broken profiles)
  - submodels.save      single-profile upsert; server-side §3.1 validation,
                        invalid entries are REJECTED (never persisted)
  - submodels.delete    remove by id
  - submodels.templates built-in template list (pure static data)
  - submodels.wizard_turn stateless one-shot wizard call; the caller owns
                        the full conversation history, the backend never
                        touches the main session's history

Write path follows the config.set convention: read→mutate→_save_cfg
(comment/ordering-preserving full-state write; fail-closed on an
unreadable existing config.yaml — see atomic_roundtrip_yaml_save, which
refuses the write rather than clobbering; no separate .corrupt backup is
added by this module).
"""

from .method_ctx import HandlerRegistry

_registry = HandlerRegistry()
method = _registry.method


@method("submodels.list")
def _(rid, params: dict) -> dict:
    try:
        from agent.submodel_profiles import load_submodels_raw, sanitize_for_client, validate_submodel

        entries = []
        for raw in load_submodels_raw():
            if not isinstance(raw, dict):
                entries.append(
                    {"raw": raw, "valid": False, "errors": ["profile must be an object"]}
                )
                continue
            ok, errors = validate_submodel(raw)
            view = sanitize_for_client(raw)
            view["valid"] = ok
            view["errors"] = errors
            entries.append(view)
        return _ok(rid, {"submodels": entries})
    except Exception as e:
        return _err(rid, 5101, str(e))


@method("submodels.save")
def _(rid, params: dict) -> dict:
    try:
        from agent.submodel_profiles import SUBMODEL_WRITABLE_FIELDS, validate_submodel

        entry = params.get("entry")
        if not isinstance(entry, dict):
            return _err(rid, 5101, "params.entry (object) required")

        # Whitelist to the writable schema — unknown keys are dropped so
        # they can't ride into the user's config file.
        clean = {k: entry[k] for k in SUBMODEL_WRITABLE_FIELDS if k in entry}
        dropped = sorted(set(entry.keys()) - set(clean.keys()))
        pid = str(clean.get("id") or "").strip()
        if not pid:
            return _err(rid, 5101, "entry.id is required")
        clean["id"] = pid

        cfg = _load_cfg_raw()
        existing = cfg.get("submodels")
        if not isinstance(existing, list):
            existing = []
        other_ids = [
            str(e.get("id") or "")
            for e in existing
            if isinstance(e, dict) and str(e.get("id") or "") != pid
        ]
        ok, errors = validate_submodel(clean, existing_ids=other_ids)
        if not ok:
            return _err(rid, 5102, "invalid profile: " + "; ".join(errors))

        clean.setdefault("enabled", True)
        replaced = False
        new_list = []
        for e in existing:
            if isinstance(e, dict) and str(e.get("id") or "") == pid:
                new_list.append(clean)
                replaced = True
            else:
                new_list.append(e)
        if not replaced:
            new_list.append(clean)
        cfg["submodels"] = new_list
        _save_cfg(cfg)
        return _ok(rid, {"id": pid, "replaced": replaced, "dropped": dropped})
    except Exception as e:
        return _err(rid, 5101, str(e))


@method("submodels.delete")
def _(rid, params: dict) -> dict:
    try:
        pid = str(params.get("id") or "").strip()
        if not pid:
            return _err(rid, 5101, "id required")
        cfg = _load_cfg_raw()
        existing = cfg.get("submodels")
        if not isinstance(existing, list):
            existing = []
        new_list = [
            e
            for e in existing
            if not (isinstance(e, dict) and str(e.get("id") or "") == pid)
        ]
        removed = len(new_list) < len(existing)
        if removed:
            cfg["submodels"] = new_list
            _save_cfg(cfg)
        return _ok(rid, {"id": pid, "removed": removed})
    except Exception as e:
        return _err(rid, 5101, str(e))


@method("submodels.templates")
def _(rid, params: dict) -> dict:
    try:
        import copy as _copy

        from agent.submodel_profiles import SUBMODEL_TEMPLATES

        return _ok(rid, {"templates": _copy.deepcopy(SUBMODEL_TEMPLATES)})
    except Exception as e:
        return _err(rid, 5101, str(e))


@method("submodels.wizard_turn")
def _(rid, params: dict) -> dict:
    try:
        from agent.oneshot import run_oneshot
        from agent.submodel_profiles import WIZARD_SYSTEM_PROMPT, extract_wizard_draft

        raw_messages = params.get("messages")
        if not isinstance(raw_messages, list) or not raw_messages:
            return _err(
                rid, 5103, "messages (non-empty list of {role, content}) required"
            )
        history = []
        for m in raw_messages:
            if not isinstance(m, dict):
                continue
            role = str(m.get("role") or "user")
            if role not in {"user", "assistant"}:
                role = "user"
            history.append({"role": role, "content": str(m.get("content") or "")})
        if not history or history[-1]["role"] != "user":
            return _err(rid, 5103, "the last message must have role 'user'")

        call_messages = [{"role": "system", "content": WIZARD_SYSTEM_PROMPT}] + history
        reply = run_oneshot(
            messages=call_messages,
            max_tokens=2048,
            temperature=0.4,
            timeout=120.0,
        )
        # A draft means the conversation has converged. No draft is NOT an
        # error — the wizard simply needs another turn.
        draft = extract_wizard_draft(reply)
        result = {"reply": reply}
        if draft is not None:
            result["draft"] = draft
        return _ok(rid, result)
    except Exception as e:
        return _err(rid, 5104, str(e))


def register(server) -> None:
    """Bind this module's handlers onto ``server``'s globals and registry."""
    _registry.install(server)
