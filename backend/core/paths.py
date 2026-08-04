from __future__ import annotations

import os
import shutil
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent
REPO_DATA_DIR = APP_ROOT / "data"
ENV_DATA_DIR = "AUDIOVAULT_DATA_DIR"
APP_SUPPORT_DATA_DIR = Path.home() / "Library" / "Application Support" / "Audiovault"


def data_dir() -> Path:
    override = os.environ.get(ENV_DATA_DIR)
    if override:
        return Path(override).expanduser().resolve()
    return APP_SUPPORT_DATA_DIR


def data_path(*parts: str) -> Path:
    return data_dir().joinpath(*parts)


def ensure_data_dir() -> Path:
    target = data_dir()
    target.mkdir(parents=True, exist_ok=True)
    if not os.environ.get(ENV_DATA_DIR) and REPO_DATA_DIR.exists() and not os.listdir(target):
        shutil.copytree(REPO_DATA_DIR, target, dirs_exist_ok=True)
    return target


def resolve_data_path(path: str | os.PathLike | None) -> Path | None:
    if not path:
        return None
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate
    parts = candidate.parts
    if parts and parts[0] == "data":
        return data_dir().joinpath(*parts[1:])
    return candidate


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(APP_ROOT))
    except ValueError:
        return str(path)
