from __future__ import annotations

import colorsys
import unicodedata
from functools import lru_cache

FALLBACK_ART_COLOR = "#1ed760"


@lru_cache(maxsize=512)
def dominant_art_color(path: str) -> str:
    """Port of OGAV's _dominant_art_color using PIL instead of Qt."""
    if not path:
        return FALLBACK_ART_COLOR
    try:
        from PIL import Image

        from core.paths import resolve_data_path
        # Log entries store covers as "data/artwork/..." relative to the data dir, not
        # the working directory; opening the raw string fell back to green everywhere.
        resolved = resolve_data_path(path)
        if not resolved or not resolved.exists():
            return FALLBACK_ART_COLOR
        img = Image.open(resolved).convert("RGBA")
        img = img.resize((32, 32), Image.LANCZOS)

        counts: dict[tuple[int, int, int], int] = {}
        for y in range(32):
            for x in range(32):
                r, g, b, a = img.getpixel((x, y))
                if a < 24:
                    continue
                key = ((r // 24) * 24, (g // 24) * 24, (b // 24) * 24)
                counts[key] = counts.get(key, 0) + 1

        if not counts:
            return FALLBACK_ART_COLOR

        total_pixels = sum(counts.values())

        def _sv(r: int, g: int, b: int) -> tuple[int, int]:
            _, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            return int(s * 255), int(v * 255)

        def score(item: tuple[tuple[int, int, int], int]) -> float:
            (r, g, b), count = item
            s255, v255 = _sv(r, g, b)

            if v255 < 28:
                bw = 0.22
            elif v255 < 64:
                bw = 0.55
            elif v255 > 245 and s255 < 28:
                bw = 0.35
            elif v255 > 225 and s255 < 40:
                bw = 0.6
            else:
                bw = 1.0

            sw = 0.25 + (s255 / 255.0) ** 1.35 * 1.45
            if s255 < 20:
                sw *= 0.35
            elif s255 < 45:
                sw *= 0.7

            mw = 1.0 - (abs(v255 - 150) / 255.0) * 0.28
            return count * bw * sw * mw

        overall_item = max(counts.items(), key=score)

        chromatic = [
            item for item in counts.items()
            if _sv(*item[0])[0] >= 64 and 36 <= _sv(*item[0])[1] <= 236
        ]

        chosen = overall_item
        if chromatic:
            chrom = max(chromatic, key=score)
            if (chrom[1] / max(1, total_pixels) >= 0.02
                    and score(chrom) >= score(overall_item) * 0.22):
                chosen = chrom

        r, g, b = chosen[0]
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        s255, v255 = int(s * 255), int(v * 255)

        if s255 < 70:
            s255 = min(255, int(s255 * 1.25) + 12)
        if v255 < 72:
            v255 = 88
        elif v255 > 242 and s255 < 90:
            v255 = 230

        r2, g2, b2 = colorsys.hsv_to_rgb(h, s255 / 255, v255 / 255)
        return f"#{int(r2 * 255):02x}{int(g2 * 255):02x}{int(b2 * 255):02x}"
    except Exception:
        return FALLBACK_ART_COLOR



def vivid_art_color(path: str) -> str:
    """The color you'd name a cover by, at full strength (Sessions vinyl bars).

    dominant_art_color favours big mid-tone areas, so a red sunburst lost to its black
    edge and Marvin Gaye's orange to the brown around it. This picks the most saturated,
    brightest hue family instead and averages its vivid half. Covers with almost no
    color (B&W photos, cream sleeves) keep dominant_art_color's answer.
    """
    try:
        from PIL import Image

        from core.paths import resolve_data_path
        resolved = resolve_data_path(path)
        if not resolved or not resolved.exists():
            return dominant_art_color(path)
        raw = Image.open(resolved).convert("RGB").resize((48, 48), Image.LANCZOS).tobytes()
        px = []
        for i in range(0, len(raw), 3):
            r, g, b = raw[i], raw[i + 1], raw[i + 2]
            h, sat, val = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            px.append((h, sat, val, r, g, b))
        chroma = [p for p in px if p[1] >= 0.35 and p[2] >= 0.28]
        if len(chroma) < 0.06 * len(px):
            return dominant_art_color(path)
        bins = [0.0] * 24
        for h, sat, val, *_ in chroma:
            bins[int(h * 24) % 24] += sat * val
        smooth = [bins[i - 1] * 0.5 + bins[i] + bins[(i + 1) % 24] * 0.5 for i in range(24)]
        best = max(range(24), key=lambda i: smooth[i])
        family = [p for p in chroma if min(abs(int(p[0] * 24) % 24 - best), 24 - abs(int(p[0] * 24) % 24 - best)) <= 1]
        family.sort(key=lambda p: -(p[1] * p[2]))
        top = family[: max(1, len(family) // 2)]
        r = sum(p[3] for p in top) / len(top)
        g = sum(p[4] for p in top) / len(top)
        b = sum(p[5] for p in top) / len(top)
        h, sat, val = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        r2, g2, b2 = colorsys.hsv_to_rgb(h, sat, max(val, 0.42))  # readable on the dark grid
        return f"#{round(r2 * 255):02x}{round(g2 * 255):02x}{round(b2 * 255):02x}"
    except Exception:
        return dominant_art_color(path)

def normalize_search(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def relative_time(played_at: str) -> str:
    from datetime import datetime, timezone
    try:
        dt = datetime.fromisoformat(played_at.replace("Z", "+00:00"))
        diff = datetime.now(timezone.utc) - dt
        seconds = int(diff.total_seconds())
        if seconds < 60:
            return "just now"
        if seconds < 3600:
            m = seconds // 60
            return f"{m}m ago"
        if seconds < 86400:
            h = seconds // 3600
            return f"{h}h ago"
        d = seconds // 86400
        return f"{d}d ago"
    except Exception:
        return played_at


def format_duration(ms: int) -> str:
    s = ms // 1000
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"
