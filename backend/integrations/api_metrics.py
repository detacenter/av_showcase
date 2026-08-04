from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import http.cookiejar
import threading as _threading

import requests
import requests.adapters
import requests.cookies

from core.paths import data_path, ensure_data_dir

# Python 3.14 free-threaded bug: DefaultCookiePolicy() raises TypeError when
# instantiated in a non-main thread. Fix by replacing DefaultCookiePolicy with a
# subclass whose __new__ returns a pre-built singleton when called from any thread
# other than main. Since __new__ returns an object of a different type (the original
# class, not the subclass), Python skips __init__ entirely — the crash never fires.
_default_policy = http.cookiejar.DefaultCookiePolicy()
_orig_DCP = http.cookiejar.DefaultCookiePolicy
_main_thread = _threading.main_thread()

class _ThreadSafeDCP(_orig_DCP):
    def __new__(cls, *args, **kwargs):
        if _threading.current_thread() is not _main_thread:
            return _default_policy
        return super().__new__(cls)

http.cookiejar.DefaultCookiePolicy = _ThreadSafeDCP

_session = requests.Session()

METRICS_FILE = data_path("api_metrics.json")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def load_events() -> list[dict]:
    if not METRICS_FILE.exists():
        return []
    try:
        with METRICS_FILE.open() as f:
            data = json.load(f)
    except Exception:
        return []
    events = data.get("events", data if isinstance(data, list) else [])
    return events if isinstance(events, list) else []


def save_events(events: list[dict]) -> None:
    ensure_data_dir()
    METRICS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with METRICS_FILE.open("w") as f:
        json.dump({"events": events}, f, indent=2)


def record_call(
    *,
    service: str,
    operation: str,
    method: str,
    status: int | str | None = None,
    duration_ms: int | None = None,
    ok: bool | None = None,
    error_body: str | None = None,
) -> None:
    event: dict = {
        "timestamp": _utc_now(),
        "service": service,
        "operation": operation,
        "method": method.upper(),
        "status": status if status is not None else "unknown",
        "duration_ms": duration_ms,
        "ok": ok,
    }
    if error_body:
        event["error_body"] = error_body[:1000]
    events = load_events()
    events.append(event)
    save_events(events)


def request(service: str, operation: str, method: str, url: str, **kwargs: Any) -> requests.Response:
    started = time.perf_counter()
    resp: requests.Response | None = None
    error_name: str | None = None
    try:
        resp = _session.request(method, url, **kwargs)
        return resp
    except Exception as exc:
        error_name = type(exc).__name__
        raise
    finally:
        duration_ms = int((time.perf_counter() - started) * 1000)
        error_body = None
        if resp is not None and not resp.ok:
            try:
                error_body = resp.text
            except Exception:
                pass
        record_call(
            service=service,
            operation=operation,
            method=method,
            status=resp.status_code if resp is not None else error_name,
            duration_ms=duration_ms,
            ok=resp.ok if resp is not None else False,
            error_body=error_body,
        )


def get(service: str, operation: str, url: str, **kwargs: Any) -> requests.Response:
    return request(service, operation, "GET", url, **kwargs)


def post(service: str, operation: str, url: str, **kwargs: Any) -> requests.Response:
    return request(service, operation, "POST", url, **kwargs)
