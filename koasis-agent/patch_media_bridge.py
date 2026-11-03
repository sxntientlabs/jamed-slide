"""Add the Koasis attachment contract to the pinned Hermes Runs API.

Telegram already gives Hermes two useful media primitives: it stores inbound
files in the agent-visible cache and passes image files as native content
parts, while outbound MEDIA:/path directives are delivered as native
attachments. This patch applies the same contract to the private HTTP Runs
API without changing Hermes' public Telegram adapter.
"""

from pathlib import Path
import os


source_root = Path(os.environ.get("HERMES_SOURCE_ROOT", "/opt/hermes-source"))
path = source_root / "gateway/platforms/api_server_runs.py"
source = path.read_text()
marker = "# KOASIS_MEDIA_BRIDGE_V1"
if marker in source:
    raise SystemExit("Koasis media bridge is already installed")

anchor = 'logger = logging.getLogger("gateway.platforms.api_server")\n'
if anchor not in source:
    raise SystemExit("Hermes Runs API logger anchor changed upstream")

helpers = r'''

# KOASIS_MEDIA_BRIDGE_V1
# Mirrors the Telegram adapter's media contract for the private Koasis HTTP
# client: materialize inbound data URLs in Hermes' own profile, make images
# native vision parts, and expose outbound MEDIA files as bounded data URLs.
import base64 as _koasis_base64
import binascii as _koasis_binascii
import mimetypes as _koasis_mimetypes
import re as _koasis_re
from pathlib import Path as _koasis_Path

_KOASIS_MEDIA_INPUT_MAX_BYTES = 8 * 1024 * 1024
_KOASIS_MEDIA_INPUT_TOTAL_MAX_BYTES = 32 * 1024 * 1024
_KOASIS_MEDIA_OUTPUT_MAX_BYTES = 8 * 1024 * 1024
_KOASIS_MEDIA_OUTPUT_TOTAL_MAX_BYTES = 32 * 1024 * 1024
_KOASIS_MEDIA_DATA_URL_RE = _koasis_re.compile(
    r"^data:(?P<mime>[^;,\s]+)(?:;[^,]*)?;base64,(?P<data>[A-Za-z0-9+/=]+)$",
    _koasis_re.IGNORECASE,
)
_KOASIS_MEDIA_TAG_RE = _koasis_re.compile(
    r"MEDIA:\s*(?:\x60(?P<backtick>[^\x60]+)\x60|\"(?P<double>[^\"]+)\"|'(?P<single>[^']+)'|(?P<bare>[^\s<>]+))",
    _koasis_re.IGNORECASE,
)


def _koasis_safe_name(value: Any, fallback: str = "attachment") -> str:
    name = _koasis_Path(str(value or "")).name
    name = _koasis_re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip(".-")
    return name[:180] or fallback


def _koasis_decode_data_url(value: Any) -> tuple[bytes, str]:
    match = _KOASIS_MEDIA_DATA_URL_RE.fullmatch(str(value or "").strip())
    if not match:
        raise ValueError("Koasis attachment harus berupa data URL base64.")
    try:
        raw = _koasis_base64.b64decode(match.group("data"), validate=True)
    except (_koasis_binascii.Error, ValueError) as exc:
        raise ValueError("Koasis attachment tidak dapat didekode.") from exc
    if not raw or len(raw) > _KOASIS_MEDIA_INPUT_MAX_BYTES:
        raise ValueError("Koasis attachment melewati batas 8 MB.")
    return raw, match.group("mime").lower()


def _koasis_prune_input_cache(root: _koasis_Path) -> None:
    """Bound abandoned uploads when a client disconnects before a run starts."""
    import shutil
    import time as _koasis_time

    cutoff = _koasis_time.time() - 24 * 60 * 60
    try:
        for child in root.iterdir():
            if child.is_dir() and child.stat().st_mtime < cutoff:
                shutil.rmtree(child, ignore_errors=True)
    except OSError:
        pass


def _koasis_prepare_input_attachments(message: dict) -> tuple[Any, list[str]]:
    raw_items = message.get("attachments") or message.get("media") or []
    if not isinstance(raw_items, list) or not raw_items:
        return message.get("content", ""), []
    root = _koasis_Path(os.environ.get("HERMES_HOME", "/opt/data")) / "cache" / "koasis-inputs"
    root.mkdir(parents=True, exist_ok=True)
    _koasis_prune_input_cache(root)
    run_dir = root / uuid.uuid4().hex
    run_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
    total = 0
    paths: list[str] = []
    notes: list[str] = []
    image_paths: list[str] = []
    try:
        for index, item in enumerate(raw_items[:6]):
            if not isinstance(item, dict):
                raise ValueError("Format attachment Koasis tidak valid.")
            raw, data_mime = _koasis_decode_data_url(item.get("dataUrl") or item.get("data_url"))
            total += len(raw)
            if total > _KOASIS_MEDIA_INPUT_TOTAL_MAX_BYTES:
                raise ValueError("Total attachment Koasis melewati batas 32 MB.")
            name = _koasis_safe_name(item.get("name") or item.get("fileName") or item.get("filename"), f"attachment-{index + 1}")
            declared_mime = str(item.get("mimeType") or item.get("mime_type") or data_mime).strip().lower() or data_mime
            path = run_dir / f"{index + 1:02d}-{name}"
            path.write_bytes(raw)
            paths.append(str(path))
            if declared_mime.startswith("image/") or str(item.get("kind") or "").lower() == "image":
                image_paths.append(str(path))
            notes.append(
                f"[The user sent an attachment: '{name}'. MIME: {declared_mime}. "
                f"It is saved at: {path}. Use the appropriate file, vision, or media tool "
                "when the request depends on its contents; do not ask the user to upload it again.]"
            )
        message_text = str(message.get("content") or "")
        message_text = "\n\n".join([*notes, message_text]).strip()
        if image_paths:
            try:
                from agent.image_routing import build_native_content_parts

                parts, skipped = build_native_content_parts(message_text, image_paths)
                if not skipped and any(part.get("type") == "image_url" for part in parts):
                    return parts, paths
            except Exception:
                logger.debug("Koasis native image attachment failed; retaining file paths", exc_info=True)
        return message_text, paths
    except Exception:
        import shutil
        shutil.rmtree(run_dir, ignore_errors=True)
        raise


def _koasis_file_artifact(path_value: str, session_key: str = "") -> dict | None:
    from gateway.platforms.base import validate_media_delivery_path

    safe = validate_media_delivery_path(path_value, session_key=session_key)
    if not safe:
        return None
    path = _koasis_Path(safe)
    try:
        if not path.is_file() or path.stat().st_size <= 0 or path.stat().st_size > _KOASIS_MEDIA_OUTPUT_MAX_BYTES:
            return None
        raw = path.read_bytes()
    except OSError:
        return None
    mime = _koasis_mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return {
        "kind": "image" if mime.startswith("image/") else "file",
        "fileName": _koasis_safe_name(path.name, "output"),
        "mimeType": mime,
        "dataUrl": f"data:{mime};base64,{_koasis_base64.b64encode(raw).decode('ascii')}",
    }


def _koasis_output_attachments(result: dict, session_key: str = "") -> list[dict]:
    attachments: list[dict] = []
    seen: set[str] = set()
    total = 0

    def add_data_record(item: Any) -> None:
        nonlocal total
        if not isinstance(item, dict):
            return
        value = item.get("dataUrl") or item.get("data_url") or item.get("fileDataUrl")
        match = _KOASIS_MEDIA_DATA_URL_RE.fullmatch(str(value or "").strip())
        if not match or str(value) in seen:
            return
        try:
            raw = _koasis_base64.b64decode(match.group("data"), validate=True)
        except (_koasis_binascii.Error, ValueError):
            return
        if not raw or len(raw) > _KOASIS_MEDIA_OUTPUT_MAX_BYTES or total + len(raw) > _KOASIS_MEDIA_OUTPUT_TOTAL_MAX_BYTES:
            return
        mime = str(item.get("mimeType") or item.get("mime_type") or match.group("mime")).lower()
        attachments.append({
            "kind": "image" if mime.startswith("image/") else "file",
            "fileName": _koasis_safe_name(item.get("fileName") or item.get("filename") or item.get("name"), "output"),
            "mimeType": mime,
            "title": str(item.get("title") or item.get("label") or "").strip()[:240],
            "dataUrl": str(value),
        })
        seen.add(str(value))
        total += len(raw)

    for key in ("attachments", "files", "media", "artifacts", "output_attachments", "output_files"):
        value = result.get(key)
        if isinstance(value, list):
            for item in value:
                add_data_record(item)

    final_response = result.get("final_response")
    if isinstance(final_response, str):
        for match in _KOASIS_MEDIA_TAG_RE.finditer(final_response):
            raw_path = next((value for value in match.groups() if value), "").strip()
            artifact = _koasis_file_artifact(raw_path, session_key=session_key)
            if not artifact or artifact["dataUrl"] in seen:
                continue
            raw_size = len(artifact["dataUrl"].split(",", 1)[-1]) * 3 // 4
            if total + raw_size > _KOASIS_MEDIA_OUTPUT_TOTAL_MAX_BYTES:
                break
            artifact["title"] = "File output dari Agent"
            attachments.append(artifact)
            seen.add(artifact["dataUrl"])
            total += raw_size
            if len(attachments) >= 6:
                break
    return attachments
'''

source = source.replace(anchor, anchor + helpers, 1)
source = source.replace(
    "    user_message: str\n",
    "    user_message: Any\n",
    1,
)
old_input = '''    if isinstance(raw_input, str):
        user_message = raw_input
    else:
        user_message = raw_input[-1].get("content", "") if isinstance(raw_input, list) else ""
'''
new_input = '''    if isinstance(raw_input, str):
        user_message = raw_input
    else:
        user_message = raw_input[-1].get("content", "") if isinstance(raw_input, list) and raw_input and isinstance(raw_input[-1], dict) else ""
        if isinstance(raw_input, list) and raw_input and isinstance(raw_input[-1], dict):
            try:
                user_message, _koasis_input_paths = _koasis_prepare_input_attachments(raw_input[-1])
            except ValueError as exc:
                return _json_error(_openai_error, str(exc), code="invalid_attachment", status=400)
'''
if old_input not in source:
    raise SystemExit("Hermes Runs API input parsing changed upstream")
source = source.replace(old_input, new_input, 1)
old_finish = '            _finish(status, fields, output=result.get("final_response", ""), usage=usage)'
new_finish = '''            media_attachments = _koasis_output_attachments(result, session_key=run.approval_session_key)
            _finish(
                status,
                fields,
                output=result.get("final_response", ""),
                usage=usage,
                **({"attachments": media_attachments} if media_attachments else {}),
            )'''
old_finish_with_runtime = '            _finish(status, fields, output=result.get("final_response", ""), usage=usage, runtime=served_runtime)'
new_finish_with_runtime = '''            media_attachments = _koasis_output_attachments(result, session_key=run.approval_session_key)
            _finish(
                status,
                fields,
                output=result.get("final_response", ""),
                usage=usage,
                runtime=served_runtime,
                **({"attachments": media_attachments} if media_attachments else {}),
            )'''
if old_finish in source:
    source = source.replace(old_finish, new_finish, 1)
elif old_finish_with_runtime in source:
    source = source.replace(old_finish_with_runtime, new_finish_with_runtime, 1)
else:
    raise SystemExit("Hermes Runs API terminal finish changed upstream")
path.write_text(source)
