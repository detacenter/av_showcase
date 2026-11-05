import json

from core.paths import data_path, ensure_data_dir

RADAR_FILE = data_path("radar.json")


def load_radar() -> list[dict]:
    if not RADAR_FILE.exists():
        return []
    try:
        with RADAR_FILE.open() as f:
            return json.load(f)
    except Exception:
        return []


def save_radar(items: list[dict]) -> None:
    ensure_data_dir()
    with RADAR_FILE.open("w") as f:
        json.dump(items, f, indent=2)
