"""
    MCP server to allow LLM integration with the platform.

    The server provides the following tools:
        1. get_mcp_context() - Return the current MCP data-source configuration for Firebase, backend, and Supabase.
        2. list_devices() - List known IoT devices from Supabase, optionally filtered by owner_uid/firebase_uid.
        3. get_device_latest() - Fetch the latest realtime Firebase payload for a device and normalize it into metric samples.
        4. get_device_history() - Fetch historical readings for a device from Supabase over the last N hours.
        5. get_device_inference_context() - Return compact current-plus-history context formatted for downstream OpenAI inference prompts.
        6. get_backend_status() - Fetch the Express backend Firebase/ESG status.
        7. search() - Search devices and available data contexts for ChatGPT deep research and MCP retrieval flows.
        8. fetch() - Fetch a detailed context object for a search result id such as device:<device_id> or system:backend-status.

    Last edit: 4/19/2026, Nicholas Sardinia
"""

from __future__ import annotations

import argparse
import json
import math
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib import error, parse, request

from fastmcp import FastMCP


# Setting up the server
MCP_NAME = "ESGatorsMCP"
DEFAULT_FIREBASE_PROJECT_ID = "senior-project-esgators"
DEFAULT_FIREBASE_DEVICE_ROOT_PATH = "devices"
DEFAULT_FIREBASE_SOURCE = "firebase-rtdb"
DEFAULT_BACKEND_BASE_URL = "http://localhost:5000"
DEFAULT_HISTORY_LIMIT = 200
DEFAULT_FIREBASE_USER_DEVICE_ROOT_TEMPLATE = "users/{owner_uid}/devices"
FIREBASE_SENSOR_MAPPINGS = [
    {"bucket": "sht30", "field": "temperatureC", "metric_type": "temperature"},
    {"bucket": "sht30", "field": "humidityPct", "metric_type": "humidity"},
    {"bucket": "no2", "field": "raw", "metric_type": "no2"},
    {"bucket": "sound", "field": "raw", "metric_type": "noise_levels"},
    {"bucket": "air_quality", "field": "raw", "metric_type": "air_quality"},
    {"bucket": "pms5003", "field": "aqi", "metric_type": "air_quality"},
    {"bucket": "pms5003", "field": "airQuality", "metric_type": "air_quality"},
]
METRIC_TYPES = {"air_quality", "no2", "temperature", "humidity", "noise_levels"}
DEFAULT_THRESHOLDS = {
    "air_quality": {"min": 0, "max": 100, "warningMax": 150, "criticalMax": 150, "unit": "aqi"},
    "no2": {"min": 0, "max": 100, "warningMax": 150, "criticalMax": 150, "unit": "ppb"},
    "temperature": {"min": 18, "max": 28, "criticalMin": 18, "warningMax": 35, "criticalMax": 35, "unit": "celsius"},
    "humidity": {"min": 30, "max": 60, "criticalMin": 30, "warningMax": 80, "criticalMax": 80, "unit": "percent"},
    "noise_levels": {"min": 0, "max": 75, "warningMax": 90, "criticalMax": 90, "unit": "dba"},
}
FIREBASE_TIMESTAMP_MIN_SECONDS = 946684800
FIREBASE_TIMESTAMP_MIN_MS = FIREBASE_TIMESTAMP_MIN_SECONDS * 1000


mcp = FastMCP(MCP_NAME)
_FIREBASE_ADMIN_APP = None


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _load_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if not key:
            continue

        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]

        values[key] = value

    return values


def _config() -> dict[str, str]:
    root = _project_root()
    env = {}
    env.update(_load_env_file(root / "backend" / ".env"))
    env.update(os.environ)
    return env


def _safe_json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback

    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def _normalize_private_key(value: str | None) -> str:
    return str(value or "").replace("\\n", "\n").strip()


def _env_int(name: str, default: int) -> int:
    raw = str(os.environ.get(name, "")).strip()
    if not raw:
        return default

    try:
        return int(raw)
    except ValueError:
        return default


def _firebase_database_url(config: dict[str, str]) -> str:
    explicit = (
        config.get("FIREBASE_DATABASE_URL")
        or config.get("VITE_FIREBASE_DATABASE_URL")
        or ""
    ).strip().rstrip("/")
    if explicit:
        return explicit

    project_id = (
        config.get("FIREBASE_PROJECT_ID")
        or config.get("VITE_FIREBASE_PROJECT_ID")
        or DEFAULT_FIREBASE_PROJECT_ID
    ).strip()
    return f"https://{project_id}-default-rtdb.firebaseio.com"


def _read_service_account_from_env(config: dict[str, str]) -> dict[str, Any] | None:
    raw_json = str(config.get("FIREBASE_SERVICE_ACCOUNT_JSON") or "").strip()
    if raw_json:
        parsed = _safe_json_loads(raw_json, None)
        if isinstance(parsed, dict):
            return parsed
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON")

    project_id = str(config.get("FIREBASE_PROJECT_ID") or "").strip()
    client_email = str(config.get("FIREBASE_CLIENT_EMAIL") or "").strip()
    private_key = _normalize_private_key(config.get("FIREBASE_PRIVATE_KEY"))

    if not project_id or not client_email or not private_key:
        return None

    return {
        "project_id": project_id,
        "client_email": client_email,
        "private_key": private_key,
    }


def _firebase_admin_db(config: dict[str, str]):
    global _FIREBASE_ADMIN_APP

    if _FIREBASE_ADMIN_APP is not None:
        try:
            from firebase_admin import db

            return db
        except ImportError as exc:
            raise RuntimeError("firebase-admin package is not installed") from exc

    service_account = _read_service_account_from_env(config)
    if not service_account:
        return None

    try:
        import firebase_admin
        from firebase_admin import credentials, db
    except ImportError as exc:
        raise RuntimeError("firebase-admin package is not installed") from exc

    if firebase_admin._apps:
        _FIREBASE_ADMIN_APP = firebase_admin.get_app()
        return db

    _FIREBASE_ADMIN_APP = firebase_admin.initialize_app(
        credentials.Certificate(service_account),
        {"databaseURL": _firebase_database_url(config)},
    )
    return db


def _backend_base_url(config: dict[str, str]) -> str:
    return str(config.get("MCP_BACKEND_BASE_URL") or DEFAULT_BACKEND_BASE_URL).strip().rstrip("/")


def _device_root_path(config: dict[str, str]) -> str:
    return str(config.get("FIREBASE_DEVICE_ROOT_PATH") or DEFAULT_FIREBASE_DEVICE_ROOT_PATH).strip().strip("/")


def _firebase_source(config: dict[str, str]) -> str:
    return str(config.get("FIREBASE_SOURCE_NAME") or DEFAULT_FIREBASE_SOURCE).strip()


def _firebase_has_admin_credentials(config: dict[str, str]) -> bool:
    try:
        return _read_service_account_from_env(config) is not None
    except RuntimeError:
        return False

# helper for HTTP request handling.
def _http_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: Any = None,
    timeout: int = 15,
) -> Any:
    request_headers = {"Accept": "application/json", **(headers or {})}
    payload = None

    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")

    req = request.Request(url, data=payload, headers=request_headers, method=method.upper())

    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            if not raw:
                return None
            return json.loads(raw.decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Request failed for {url}: {exc.reason}") from exc


def _join_firebase_path(*segments: str) -> str:
    return "/".join(str(segment).strip().strip("/") for segment in segments if str(segment or "").strip())


def _expand_device_root_template(template: str, *, device_id: str, owner_uid: str = "") -> str:
    root = str(template or "").strip().strip("/")
    if not root:
        return ""

    replacements = {
        "{device_id}": device_id,
        "{owner_uid}": owner_uid,
        "{ownerFirebaseUid}": owner_uid,
    }
    for marker, value in replacements.items():
        root = root.replace(marker, value)

    return _join_firebase_path(root)


def _firebase_device_path_from_root(root: str, *, device_id: str) -> str:
    normalized_root = _join_firebase_path(root)
    if not normalized_root:
        return ""
    if normalized_root.endswith(f"/{device_id}") or normalized_root == device_id:
        return normalized_root
    return _join_firebase_path(normalized_root, device_id)


def _normalize_firebase_timestamp(raw_timestamp: Any, fallback_timestamp_ms: int | None = None) -> int:
    fallback = int(fallback_timestamp_ms or int(datetime.now(tz=timezone.utc).timestamp() * 1000))

    try:
        numeric = float(raw_timestamp)
    except (TypeError, ValueError):
        return fallback

    if not math.isfinite(numeric) or numeric <= 0:
        return fallback

    if numeric >= FIREBASE_TIMESTAMP_MIN_MS:
        return int(numeric)

    if numeric >= FIREBASE_TIMESTAMP_MIN_SECONDS:
        return int(numeric * 1000)

    return fallback


def _normalize_firebase_device_payload(device_id: str, payload: dict[str, Any], now_ms: int | None = None) -> list[dict[str, Any]]:
    current_ms = now_ms or int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    default_sensor_id = str(
        device_id
        or payload.get("sht30", {}).get("latest", {}).get("deviceId")
        or payload.get("no2", {}).get("latest", {}).get("deviceId")
        or payload.get("sound", {}).get("latest", {}).get("deviceId")
        or payload.get("pms5003", {}).get("latest", {}).get("deviceId")
        or payload.get("air_quality", {}).get("latest", {}).get("deviceId")
        or ""
    ).strip()

    samples: list[dict[str, Any]] = []
    for mapping in FIREBASE_SENSOR_MAPPINGS:
        latest = payload.get(mapping["bucket"], {}).get("latest")
        if not latest:
            continue

        try:
            numeric_value = float(latest.get(mapping["field"]))
        except (TypeError, ValueError):
            continue

        sensor_id = str(latest.get("deviceId") or default_sensor_id).strip()
        if not sensor_id:
            continue

        samples.append(
            {
                "sensor_id": sensor_id,
                "metric_type": mapping["metric_type"],
                "value": numeric_value,
                "timestamp": _normalize_firebase_timestamp(
                    latest.get("updatedAtMs") or latest.get("timestamp") or latest.get("recordedAt"),
                    current_ms,
                ),
            }
        )

    return samples


def _resolve_thresholds(config: dict[str, str]) -> dict[str, dict[str, Any]]:
    env_overrides = _safe_json_loads(config.get("SENSOR_THRESHOLDS_JSON"), {})
    thresholds: dict[str, dict[str, Any]] = {}

    for metric_type, defaults in DEFAULT_THRESHOLDS.items():
        override = env_overrides.get(metric_type, {}) if isinstance(env_overrides, dict) else {}
        merged = dict(defaults)
        merged.update(override)
        thresholds[metric_type] = merged

    return thresholds


def _evaluate_anomaly(metric_type: str, value: float, thresholds: dict[str, dict[str, Any]]) -> dict[str, Any]:
    threshold = thresholds.get(metric_type)
    if not threshold:
        return {"detected": False, "severity": "normal", "score": 0, "threshold": None}

    minimum = threshold.get("min")
    maximum = threshold.get("max")
    critical_min = threshold.get("criticalMin")
    critical_max = threshold.get("criticalMax")
    warning_min = threshold.get("warningMin")
    warning_max = threshold.get("warningMax")

    if minimum is not None and maximum is not None and minimum <= value <= maximum:
        return {"detected": False, "severity": "normal", "score": 0, "threshold": threshold}

    if critical_min is not None and value < critical_min:
        score = round((critical_min - value) / max(abs(critical_min), 1), 4)
        return {"detected": True, "severity": "critical", "score": score, "threshold": threshold}

    if critical_max is not None and value >= critical_max:
        score = round((value - critical_max) / max(abs(critical_max), 1), 4)
        return {"detected": True, "severity": "critical", "score": score, "threshold": threshold}

    if warning_min is not None and minimum is not None and value < minimum:
        score = round((minimum - value) / max(abs(minimum - warning_min), 1), 4)
        return {"detected": True, "severity": "warning", "score": score, "threshold": threshold}

    if warning_max is not None and maximum is not None and value > maximum:
        score = round((value - maximum) / max(abs(warning_max - maximum), 1), 4)
        return {"detected": True, "severity": "warning", "score": score, "threshold": threshold}

    boundary = minimum if minimum is not None and value < minimum else maximum
    boundary = boundary if boundary is not None else value
    score = round(abs(value - boundary) / max(abs(boundary), 1), 4)
    return {"detected": True, "severity": "warning", "score": score, "threshold": threshold}


def _format_timestamp(timestamp_ms: int | None) -> str | None:
    if not timestamp_ms:
        return None
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).isoformat()


# header config for supabase
def _supabase_headers(config: dict[str, str]) -> dict[str, str]:
    api_key = str(config.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not configured")

    return {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
    }


def _supabase_rest_base_url(config: dict[str, str]) -> str:
    supabase_url = str(config.get("SUPABASE_URL") or "").strip().rstrip("/")
    if not supabase_url:
        raise RuntimeError("SUPABASE_URL is not configured")
    return f"{supabase_url}/rest/v1"

# helper for SQL queries on supabase
def _supabase_select(
    table: str,
    *,
    select: str,
    filters: list[str] | None = None,
    order: str | None = None,
    limit: int | None = None,
    config: dict[str, str],
) -> list[dict[str, Any]]:
    query_items = [("select", select)]
    for item in filters or []:
        key, value = item.split("=", 1)
        query_items.append((key, value))
    if order:
        query_items.append(("order", order))
    if limit is not None:
        query_items.append(("limit", str(limit)))

    url = f"{_supabase_rest_base_url(config)}/{table}?{parse.urlencode(query_items)}"
    response = _http_json(url, headers=_supabase_headers(config))
    return response if isinstance(response, list) else []

# helper for payload generation from firebase
def _firebase_device_payload(device_id: str, config: dict[str, str]) -> dict[str, Any] | None:
    metadata = _device_metadata_map([device_id], config).get(device_id, {})
    owner_uid = str(metadata.get("owner_uid") or "").strip()

    candidate_paths: list[str] = []
    configured_root = _expand_device_root_template(
        _device_root_path(config),
        device_id=device_id,
        owner_uid=owner_uid,
    )
    if configured_root:
        candidate_paths.append(_firebase_device_path_from_root(configured_root, device_id=device_id))

    if owner_uid:
        candidate_paths.append(
            _firebase_device_path_from_root(
                _expand_device_root_template(
                    DEFAULT_FIREBASE_USER_DEVICE_ROOT_TEMPLATE,
                    device_id=device_id,
                    owner_uid=owner_uid,
                ),
                device_id=device_id,
            )
        )

    deduped_paths: list[str] = []
    seen_paths: set[str] = set()
    for path_value in candidate_paths:
        normalized = _join_firebase_path(path_value)
        if normalized and normalized not in seen_paths:
            seen_paths.add(normalized)
            deduped_paths.append(normalized)

    admin_db = _firebase_admin_db(config)
    errors: list[str] = []

    for device_path in deduped_paths:
        try:
            if admin_db is not None:
                response = admin_db.reference(device_path).get()
            else:
                url = f"{_firebase_database_url(config)}/{device_path}.json"
                response = _http_json(url)
        except Exception as exc:
            errors.append(f"{device_path}: {exc}")
            continue

        if response is None:
            continue
        if not isinstance(response, dict):
            raise RuntimeError(f"Unexpected Firebase payload at {device_path}")
        return response

    if errors:
        raise RuntimeError("Firebase lookup failed for all candidate paths: " + " | ".join(errors))

    return None


def _device_metadata_map(device_ids: list[str], config: dict[str, str]) -> dict[str, dict[str, Any]]:
    if not str(config.get("SUPABASE_URL") or "").strip() or not str(config.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip():
        return {}

    unique_device_ids = sorted({device_id.strip() for device_id in device_ids if str(device_id).strip()})
    if not unique_device_ids:
        return {}

    device_rows = _supabase_select(
        "devices",
        select="device_id,owner_uid,name",
        filters=[f"device_id=in.({','.join(unique_device_ids)})"],
        limit=len(unique_device_ids),
        config=config,
    )

    owner_keys = sorted(
        {
            str(row.get("owner_uid")).strip()
            for row in device_rows
            if str(row.get("owner_uid") or "").strip()
        }
    )
    owner_rows: list[dict[str, Any]] = []

    if owner_keys:
        owner_rows = _supabase_select(
            "users",
            select="id,email,firebase_uid",
            filters=[f"firebase_uid=in.({','.join(owner_keys)})"],
            limit=len(owner_keys),
            config=config,
        )
        if not owner_rows:
            owner_rows = _supabase_select(
                "users",
                select="id,email,firebase_uid",
                filters=[f"id=in.({','.join(owner_keys)})"],
                limit=len(owner_keys),
                config=config,
            )

    owners_by_key: dict[str, dict[str, Any]] = {}
    for owner in owner_rows:
        if owner.get("id"):
            owners_by_key[str(owner["id"])] = owner
        if owner.get("firebase_uid"):
            owners_by_key[str(owner["firebase_uid"])] = owner

    metadata: dict[str, dict[str, Any]] = {}
    for device in device_rows:
        owner = owners_by_key.get(str(device.get("owner_uid") or "").strip(), {})
        device_id = str(device.get("device_id") or "").strip()
        if not device_id:
            continue

        metadata[device_id] = {
            "device_id": device_id,
            "owner_uid": owner.get("firebase_uid") or device.get("owner_uid") or "unknown",
            "owner_email": owner.get("email") or "unknown",
            "device_name": device.get("name") or device_id,
        }

    return metadata


def _history_rows(
    *,
    device_id: str,
    metric_type: str | None,
    start_iso: str,
    end_iso: str,
    limit: int,
    config: dict[str, str],
) -> list[dict[str, Any]]:
    metric_mappings = [
        ("no2", "no2"),
        ("sound_level", "noise_levels"),
        ("particulate_matter_level", "air_quality"),
        ("temperature", "temperature"),
        ("humidity", "humidity"),
    ]

    device_history_rows = _supabase_select(
        "device_history",
        select=(
            "sample_key,device_id,captured_at,source_updated_at,sample_interval_start,"
            "no2,sound_level,particulate_matter_level,temperature,humidity"
        ),
        filters=[
            f"device_id=eq.{device_id}",
            f"sample_interval_start=gte.{start_iso}",
            f"sample_interval_start=lte.{end_iso}",
        ],
        order="sample_interval_start.desc",
        limit=limit,
        config=config,
    )

    normalized_rows: list[dict[str, Any]] = []
    for row in device_history_rows:
        sensor_id = str(row.get("device_id") or "").strip()
        if not sensor_id:
            continue

        timestamp = row.get("source_updated_at") or row.get("captured_at") or row.get("sample_interval_start")
        created_at = row.get("captured_at") or row.get("sample_interval_start")

        for source_field, normalized_metric_type in metric_mappings:
            if metric_type and normalized_metric_type != metric_type:
                continue

            numeric_value = row.get(source_field)
            if numeric_value is None:
                continue

            try:
                value = float(numeric_value)
            except (TypeError, ValueError):
                continue

            normalized_rows.append(
                {
                    "id": row.get("sample_key") or f"{sensor_id}:{normalized_metric_type}:{timestamp}",
                    "sensor_id": sensor_id,
                    "metric_type": normalized_metric_type,
                    "value": value,
                    "recorded_at": timestamp,
                    "created_at": created_at,
                }
            )

    if normalized_rows:
        return normalized_rows[:limit]

    filters = [
        f"sensor_id=eq.{device_id}",
        f"recorded_at=gte.{start_iso}",
        f"recorded_at=lte.{end_iso}",
    ]
    if metric_type:
        filters.append(f"metric_type=eq.{metric_type}")

    return _supabase_select(
        "sensor_readings",
        select="id,sensor_id,metric_type,value,recorded_at,created_at",
        filters=filters,
        order="recorded_at.desc",
        limit=limit,
        config=config,
    )


def _list_device_rows(config: dict[str, str], limit: int = 200) -> list[dict[str, Any]]:
    if not str(config.get("SUPABASE_URL") or "").strip() or not str(config.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip():
        return []

    rows = _supabase_select(
        "devices",
        select="device_id,owner_uid,name",
        order="device_id.asc",
        limit=limit,
        config=config,
    )

    metadata = _device_metadata_map([str(row.get("device_id") or "") for row in rows], config)
    results = []
    for row in rows:
        device_id = str(row.get("device_id") or "").strip()
        if not device_id:
            continue
        results.append(
            {
                "device_id": device_id,
                "owner_uid": metadata.get(device_id, {}).get("owner_uid") or row.get("owner_uid") or "unknown",
                "owner_email": metadata.get(device_id, {}).get("owner_email") or "unknown",
                "device_name": metadata.get(device_id, {}).get("device_name") or row.get("name") or device_id,
            }
        )

    return results


def _summarize_history(rows: list[dict[str, Any]], thresholds: dict[str, dict[str, Any]]) -> dict[str, Any]:
    grouped: dict[str, list[float]] = defaultdict(list)
    anomaly_counts = {"warning": 0, "critical": 0}

    for row in rows:
        metric_type = str(row.get("metric_type") or "")
        try:
            numeric_value = float(row.get("value"))
        except (TypeError, ValueError):
            continue

        grouped[metric_type].append(numeric_value)
        anomaly = _evaluate_anomaly(metric_type, numeric_value, thresholds)
        if anomaly["detected"]:
            anomaly_counts[anomaly["severity"]] += 1

    metrics_summary: dict[str, Any] = {}
    for metric_type, values in grouped.items():
        metrics_summary[metric_type] = {
            "count": len(values),
            "min": round(min(values), 4),
            "max": round(max(values), 4),
            "avg": round(sum(values) / len(values), 4),
        }

    return {
        "sample_count": len(rows),
        "metrics": metrics_summary,
        "anomaly_counts": anomaly_counts,
    }

# The remaining code defines the MCP tools themselves, using the above
# methods as helpers. 
@mcp.tool
def get_mcp_context() -> dict[str, Any]:
    """Return the current MCP data-source configuration for Firebase, backend, and Supabase."""
    config = _config()
    return {
        "server": MCP_NAME,
        "backend_base_url": _backend_base_url(config),
        "firebase_database_url": _firebase_database_url(config),
        "firebase_device_root_path": _device_root_path(config),
        "firebase_admin_configured": _firebase_has_admin_credentials(config),
        "firebase_source": _firebase_source(config),
        "has_supabase": bool(str(config.get("SUPABASE_URL") or "").strip() and str(config.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()),
        "supported_metrics": sorted(METRIC_TYPES),
    }


@mcp.tool
def list_devices(owner_uid: str = "", limit: int = 50) -> dict[str, Any]:
    """List known IoT devices from Supabase, optionally filtered by owner_uid/firebase_uid."""
    config = _config()
    if not str(config.get("SUPABASE_URL") or "").strip() or not str(config.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip():
        return {
            "count": 0,
            "devices": [],
            "warning": "Supabase is not configured, so device discovery is unavailable.",
        }

    resolved_limit = max(1, min(int(limit), 200))
    filters: list[str] = []
    normalized_owner_uid = owner_uid.strip()

    if normalized_owner_uid:
        filters.append(f"owner_uid=eq.{normalized_owner_uid}")

    rows = _supabase_select(
        "devices",
        select="device_id,owner_uid,name",
        filters=filters,
        order="device_id.asc",
        limit=resolved_limit,
        config=config,
    )

    owner_metadata = _device_metadata_map([str(row.get("device_id") or "") for row in rows], config)
    devices = []
    for row in rows:
        device_id = str(row.get("device_id") or "").strip()
        enriched = owner_metadata.get(device_id, {})
        devices.append(
            {
                "device_id": device_id,
                "owner_uid": enriched.get("owner_uid") or row.get("owner_uid") or "unknown",
                "owner_email": enriched.get("owner_email") or "unknown",
                "device_name": enriched.get("device_name") or row.get("name") or device_id,
            }
        )

    return {
        "count": len(devices),
        "devices": devices,
    }


@mcp.tool
def get_device_latest(device_id: str) -> dict[str, Any]:
    """Fetch the latest realtime Firebase payload for a device and normalize it into metric samples."""
    normalized_device_id = device_id.strip()
    if not normalized_device_id:
        raise ValueError("device_id is required")

    config = _config()
    payload = _firebase_device_payload(normalized_device_id, config)
    if payload is None:
        return {
            "device_id": normalized_device_id,
            "found": False,
            "message": "No Firebase payload found for this device.",
        }

    thresholds = _resolve_thresholds(config)
    metadata = _device_metadata_map([normalized_device_id], config).get(
        normalized_device_id,
        {
            "device_id": normalized_device_id,
            "owner_uid": "unknown",
            "owner_email": "unknown",
            "device_name": normalized_device_id,
        },
    )
    samples = []
    for sample in _normalize_firebase_device_payload(normalized_device_id, payload):
        anomaly = _evaluate_anomaly(sample["metric_type"], float(sample["value"]), thresholds)
        samples.append(
            {
                **sample,
                "timestamp_iso": _format_timestamp(sample["timestamp"]),
                "source": _firebase_source(config),
                "anomaly": anomaly,
            }
        )

    return {
        "device_id": normalized_device_id,
        "found": True,
        "path": _join_firebase_path(_device_root_path(config), normalized_device_id),
        "metadata": metadata,
        "sample_count": len(samples),
        "samples": samples,
        "raw": payload,
    }


@mcp.tool
def get_device_history(device_id: str, metric_type: str = "", hours: int = 24, limit: int = DEFAULT_HISTORY_LIMIT) -> dict[str, Any]:
    """Fetch historical readings for a device from Supabase over the last N hours."""
    normalized_device_id = device_id.strip()
    if not normalized_device_id:
        raise ValueError("device_id is required")

    normalized_metric = metric_type.strip().lower()
    if normalized_metric and normalized_metric not in METRIC_TYPES:
        raise ValueError(f"metric_type must be one of: {', '.join(sorted(METRIC_TYPES))}")

    resolved_hours = max(1, min(int(hours), 24 * 365))
    resolved_limit = max(1, min(int(limit), 1000))

    end_time = datetime.now(tz=timezone.utc)
    start_time = end_time - timedelta(hours=resolved_hours)
    config = _config()
    thresholds = _resolve_thresholds(config)
    rows = _history_rows(
        device_id=normalized_device_id,
        metric_type=normalized_metric or None,
        start_iso=start_time.isoformat(),
        end_iso=end_time.isoformat(),
        limit=resolved_limit,
        config=config,
    )

    summary = _summarize_history(rows, thresholds)
    return {
        "device_id": normalized_device_id,
        "metric_type": normalized_metric or None,
        "window": {
            "hours": resolved_hours,
            "start": start_time.isoformat(),
            "end": end_time.isoformat(),
        },
        "row_count": len(rows),
        "summary": summary,
        "rows": rows,
    }


@mcp.tool
def get_device_inference_context(device_id: str, hours: int = 24, include_raw: bool = False) -> dict[str, Any]:
    """Return compact current-plus-history context formatted for downstream OpenAI inference prompts."""
    normalized_device_id = device_id.strip()
    if not normalized_device_id:
        raise ValueError("device_id is required")

    latest = get_device_latest(normalized_device_id)
    history = get_device_history(normalized_device_id, hours=hours)

    current_metrics = {
        sample["metric_type"]: {
            "value": sample["value"],
            "timestamp_iso": sample["timestamp_iso"],
            "anomaly": sample["anomaly"],
        }
        for sample in latest.get("samples", [])
    }

    interpretation_hints = []
    for metric_type, metric_summary in history.get("summary", {}).get("metrics", {}).items():
        current_value = current_metrics.get(metric_type, {}).get("value")
        if current_value is None:
            continue

        avg = metric_summary.get("avg")
        deviation = round(current_value - avg, 4)
        interpretation_hints.append(
            {
                "metric_type": metric_type,
                "current_value": current_value,
                "historical_avg": avg,
                "deviation_from_avg": deviation,
            }
        )

    response = {
        "device_id": normalized_device_id,
        "metadata": latest.get("metadata", {}),
        "current_metrics": current_metrics,
        "history_summary": history.get("summary", {}),
        "interpretation_hints": interpretation_hints,
        "suggested_prompt_focus": [
            "Call out any metrics currently outside their normal threshold bands.",
            "Compare current values with the recent historical average for each metric.",
            "Explain likely environmental conditions or risk signals in plain language.",
            "Avoid claiming causation beyond what the sensor readings support.",
        ],
    }

    if include_raw:
        response["latest"] = latest
        response["history"] = history

    return response


@mcp.tool
def get_backend_status() -> dict[str, Any]:
    """Fetch the Express backend Firebase/ESG status if the local backend server is running."""
    config = _config()
    base_url = _backend_base_url(config)
    firebase_status = _http_json(f"{base_url}/firebase/status")
    esg_status = _http_json(f"{base_url}/esg/status")
    anomaly_status = _http_json(f"{base_url}/iot/anomalies")

    return {
        "backend_base_url": base_url,
        "firebase": firebase_status,
        "esg": esg_status,
        "anomalies": anomaly_status,
    }


@mcp.tool
def search(query: str, limit: int = 8, hours: int = 24) -> dict[str, Any]:
    """Search devices and available data contexts for ChatGPT deep research and MCP retrieval flows."""
    config = _config()
    normalized_query = query.strip().lower()
    resolved_limit = max(1, min(int(limit), 20))
    resolved_hours = max(1, min(int(hours), 24 * 30))
    device_rows = _list_device_rows(config, limit=250)
    supabase_available = bool(str(config.get("SUPABASE_URL") or "").strip() and str(config.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip())

    if normalized_query:
        filtered = [
            device
            for device in device_rows
            if normalized_query in device["device_id"].lower()
            or normalized_query in str(device["device_name"]).lower()
            or normalized_query in str(device["owner_uid"]).lower()
            or normalized_query in str(device["owner_email"]).lower()
        ]
    else:
        filtered = device_rows

    results = []
    for device in filtered[:resolved_limit]:
        device_id = device["device_id"]
        results.append(
            {
                "id": f"device:{device_id}",
                "title": f"{device['device_name']} ({device_id})",
                "text": (
                    f"Realtime Firebase and historical Supabase context for device {device_id}. "
                    f"Owner: {device['owner_email']} ({device['owner_uid']}). "
                    f"Use fetch on this id to retrieve current metrics and a {resolved_hours}-hour summary."
                ),
                "url": None,
                "metadata": {
                    "device_id": device_id,
                    "owner_uid": device["owner_uid"],
                    "owner_email": device["owner_email"],
                    "hours": resolved_hours,
                },
            }
        )

    if not normalized_query or "status".find(normalized_query) >= 0 or normalized_query in {"backend", "firebase", "esg"}:
        results.append(
            {
                "id": "system:backend-status",
                "title": "Backend status",
                "text": "Backend Firebase sync, anomaly, and ESG status summary.",
                "url": None,
                "metadata": {},
            }
        )

    return {
        "query": query,
        "count": len(results),
        "results": results[:resolved_limit],
        "warning": None if supabase_available else "Supabase is not configured, so search results only include non-historical system entries.",
    }


@mcp.tool
def fetch(id: str, hours: int = 24) -> dict[str, Any]:
    """Fetch a detailed context object for a search result id such as device:<device_id> or system:backend-status."""
    normalized_id = id.strip()
    resolved_hours = max(1, min(int(hours), 24 * 30))

    if normalized_id == "system:backend-status":
        return {
            "id": normalized_id,
            "kind": "backend-status",
            "content": get_backend_status(),
        }

    if normalized_id.startswith("device:"):
        device_id = normalized_id.split(":", 1)[1].strip()
        return {
            "id": normalized_id,
            "kind": "device",
            "content": get_device_inference_context(device_id=device_id, hours=resolved_hours, include_raw=True),
        }

    raise ValueError("Unsupported fetch id. Use a value returned by the search tool.")

# allow for flexibility in server startup
def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the ESGators MCP server for local or ChatGPT integration.")
    parser.add_argument(
        "--transport",
        default=os.environ.get("MCP_TRANSPORT", "stdio"),
        choices=["stdio", "sse", "http", "streamable-http"],
        help="MCP transport to run. Use streamable-http or sse for remote ChatGPT connections.",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("MCP_HOST", "127.0.0.1"),
        help="Host for HTTP-based transports.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=_env_int("MCP_PORT", _env_int("PORT", 8000)),
        help="Port for HTTP-based transports.",
    )
    parser.add_argument(
        "--path",
        default=os.environ.get("MCP_PATH", "/mcp"),
        help="HTTP path for streamable-http or sse transports.",
    )
    parser.add_argument(
        "--stateless-http",
        action="store_true",
        default=str(os.environ.get("FASTMCP_STATELESS_HTTP", "")).strip().lower() in {"1", "true", "yes", "on"},
        help="Enable stateless HTTP mode for hosted MCP clients.",
    )
    parser.add_argument(
        "--no-banner",
        action="store_true",
        help="Disable the FastMCP startup banner.",
    )
    return parser.parse_args()

# Run the server
if __name__ == "__main__":
    args = _parse_args()
    show_banner = not args.no_banner

    if args.transport == "stdio":
        mcp.run(transport="stdio", show_banner=show_banner)
    else:
        mcp.run(
            transport=args.transport,
            host=args.host,
            port=args.port,
            path=args.path,
            stateless_http=args.stateless_http if args.transport in {"http", "streamable-http"} else None,
            show_banner=show_banner,
        )
