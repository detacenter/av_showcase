"""Year page for Stats › Periods: the twelve months, year over year, rhythm, the days one
song took over, discovery (and what stuck), sound and release years, and the AV Club
superlatives. One payload per year, built from the whole history."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

from insights.collection_insights import normalize_title
from insights.recap import _genre_shares

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August",
               "September", "October", "November", "December"]
SESSION_GAP_S = 30 * 60
TOP_ALBUMS = 16
NEW_ARTIST_TILES = 12
LOOPS = 5
GENRE_ROWS = 12


def _min(e: dict) -> float:
    return (e.get("duration_ms") or 0) / 60000


def _artist(e: dict) -> str:
    names = e.get("artist_names") or []
    return names[0] if names else ""


def _song_key(e: dict) -> tuple[str, str]:
    return (normalize_title(e.get("track_name", "")) or e.get("track_id", ""), _artist(e))


def _hours(m: float) -> int:
    return round(m / 60)


def _fmt_minutes(m: float) -> str:
    h, mm = divmod(int(round(m)), 60)
    return f"{h}h {mm}m" if h else f"{mm}m"


def _pct_change(now: float, then: float) -> int | None:
    return round((now - then) / then * 100) if then else None


def _day_label(d: date) -> str:
    return f"{d.strftime('%a')}, {MONTHS[d.month - 1]} {d.day}"


def _longest_run(days: list[date]) -> tuple[int, date | None, date | None]:
    """Longest run of consecutive days in a sorted, de-duplicated list."""
    best, start, end = 0, None, None
    run_start, prev, run = None, None, 0
    for d in days:
        if prev and (d - prev).days == 1:
            run += 1
        else:
            run, run_start = 1, d
        if run > best:
            best, start, end = run, run_start, d
        prev = d
    return best, start, end


def _monthly(rows: list[tuple[datetime, dict]]) -> list[float]:
    out = [0.0] * 12
    for t, e in rows:
        out[t.month - 1] += _min(e)
    return out


def build_year_recap(history: list[dict], lib: dict, year: int, parse) -> dict:
    """`history` is newest first, as state.history is; `parse` turns played_at into a
    local datetime."""
    artists_lib = lib.get("artists", {})
    dated = [(parse(e["played_at"]), e) for e in reversed(history) if e.get("played_at")]
    if not dated:
        return {"year": year, "years": [], "empty": True}
    years = sorted({t.year for t, _ in dated})
    latest = dated[-1][0].date()
    first_day = dated[0][0].date()
    yr = [(t, e) for t, e in dated if t.year == year]
    prev = [(t, e) for t, e in dated if t.year == year - 1]
    before = [(t, e) for t, e in dated if t.year < year]
    after = [(t, e) for t, e in dated if t.year > year]
    in_progress = latest.year == year
    if not yr:
        return {"year": year, "years": years, "empty": True, "in_progress": in_progress}

    jan1 = date(year, 1, 1)
    last_day = latest if in_progress else date(year, 12, 31)
    span_start = max(jan1, first_day)
    days_total = (last_day - span_start).days + 1

    # Lookups over the year: album info, artist art (their most-played album's cover).
    album_info: dict[str, dict] = {}
    album_min: Counter = Counter()
    artist_min: Counter = Counter()
    artist_album_min: dict[str, Counter] = defaultdict(Counter)
    song_info: dict[tuple, dict] = {}
    for _, e in yr:
        aid = e.get("album_id") or e.get("album_name", "")
        album_info.setdefault(aid, {
            "album_id": aid, "title": e.get("album_name", ""), "artist": _artist(e),
            "art_path": e.get("album_art_local_path"),
        })
        if not album_info[aid]["art_path"] and e.get("album_art_local_path"):
            album_info[aid]["art_path"] = e["album_art_local_path"]
        m = _min(e)
        album_min[aid] += m
        a = _artist(e)
        if a:
            artist_min[a] += m
            artist_album_min[a][aid] += m
        song_info.setdefault(_song_key(e), {
            "title": e.get("track_name", ""), "artist": a, "album": e.get("album_name", ""),
            "art_path": e.get("album_art_local_path"),
            "length_ms": e.get("track_duration_ms") or e.get("duration_ms") or 0,
        })

    def artist_art(name: str) -> str | None:
        for aid, _ in artist_album_min[name].most_common():
            if album_info[aid]["art_path"]:
                return album_info[aid]["art_path"]
        return None

    minutes = sum(_min(e) for _, e in yr)
    prev_minutes = sum(_min(e) for _, e in prev)
    music_days = sorted({t.date() for t, _ in yr})
    day_min: Counter = Counter()
    for t, e in yr:
        day_min[t.date()] += _min(e)
    biggest_day = max(day_min.items(), key=lambda kv: kv[1])
    streak, s_start, s_end = _longest_run(music_days)

    seen_artists = {_artist(e) for _, e in before if _artist(e)}
    seen_albums = {e.get("album_id") for _, e in before}
    year_artists = {_artist(e) for _, e in yr if _artist(e)}
    year_albums = {e.get("album_id") for _, e in yr if e.get("album_id")}
    new_artists = year_artists - seen_artists
    prev_artists = {_artist(e) for _, e in prev if _artist(e)}

    band = {
        "minutes": round(minutes),
        "plays": len(yr),
        "prev_minutes": round(prev_minutes) if prev else None,
        "prev_plays": len(prev) if prev else None,
        "hours_change": _pct_change(minutes, prev_minutes) if prev else None,
        "plays_change": _pct_change(len(yr), len(prev)) if prev else None,
        "artists": len(year_artists),
        "artists_delta": len(year_artists) - len(prev_artists) if prev else None,
        "new_artists": len(new_artists),
        "albums": len(year_albums),
        "new_albums": len(year_albums - seen_albums),
        "days_with_music": len(music_days),
        "days_total": days_total,
        "biggest_day": {"date": biggest_day[0].isoformat(), "minutes": round(biggest_day[1])},
        "longest_streak": {"days": streak, "start": s_start.isoformat() if s_start else None, "end": s_end.isoformat() if s_end else None},
    }

    # ── The year in months ────────────────────────────────────────────────────
    by_month: list[list[tuple[datetime, dict]]] = [[] for _ in range(12)]
    for t, e in yr:
        by_month[t.month - 1].append((t, e))
    top16 = [aid for aid, _ in album_min.most_common(TOP_ALBUMS)]
    months = []
    for i, rows in enumerate(by_month):
        future = in_progress and i + 1 > latest.month
        if not rows:
            months.append({"month": i + 1, "minutes": 0, "future": future, "album": None, "artist": None, "song": None})
            continue
        am, ar, so = Counter(), Counter(), Counter()
        for _, e in rows:
            m = _min(e)
            am[e.get("album_id") or e.get("album_name", "")] += m
            if _artist(e):
                ar[_artist(e)] += m
            so[_song_key(e)] += m
        aid, a_m = am.most_common(1)[0]
        art_name, ar_m = ar.most_common(1)[0] if ar else ("", 0)
        sk, s_m = so.most_common(1)[0]
        months.append({
            "month": i + 1,
            "minutes": round(sum(_min(e) for _, e in rows)),
            "future": False,
            "album": {**album_info[aid], "minutes": round(a_m), "in_top": aid in top16},
            "artist": {"name": art_name, "art_path": artist_art(art_name), "minutes": round(ar_m)},
            "song": {**song_info[sk], "minutes": round(s_m)},
        })

    # Longest reign: the most consecutive weeks one album was the week's #1.
    week_album: dict[date, Counter] = defaultdict(Counter)
    for t, e in yr:
        monday = t.date() - timedelta(days=t.weekday())
        week_album[monday][e.get("album_id") or e.get("album_name", "")] += _min(e)
    reign = None
    run_aid, run_start, run_len, prev_week = None, None, 0, None
    for monday in sorted(week_album):
        top = week_album[monday].most_common(1)[0][0]
        if top == run_aid and prev_week and (monday - prev_week).days == 7:
            run_len += 1
        else:
            run_aid, run_start, run_len = top, monday, 1
        if not reign or run_len > reign["weeks"]:
            reign = {"weeks": run_len, "album": album_info[top]["title"], "start": run_start.isoformat(),
                     "end": (monday + timedelta(days=6)).isoformat()}
        prev_week = monday

    leaders = [m["album"]["album_id"] for m in months if m["album"]]
    month_facts = {
        "distinct": len(set(leaders)),
        "months_with_music": len(leaders),
        "repeats": [
            {"album": album_info[aid]["title"], "months": [m["month"] for m in months if m["album"] and m["album"]["album_id"] == aid]}
            for aid, n in Counter(leaders).items() if n > 1
        ],
        "reign": reign,
        "off_list": [m["month"] for m in months if m["album"] and not m["album"]["in_top"]],
    }

    # ── Year over year ────────────────────────────────────────────────────────
    year_minutes = Counter()
    for t, e in dated:
        year_minutes[t.year] += _min(e)
    ranked = sorted(year_minutes, key=lambda y: -year_minutes[y])
    month_min = _monthly(yr)
    played = [(i, v) for i, v in enumerate(month_min) if v > 0]
    yoy = {
        "now": [round(v) for v in month_min],
        "prev": [round(v) for v in _monthly(prev)] if prev else None,
        "rank": ranked.index(year) + 1,
        "of": len(ranked),
        "peak": {"month": max(played, key=lambda x: x[1])[0] + 1, "minutes": round(max(played, key=lambda x: x[1])[1])},
        "quietest": {"month": min(played, key=lambda x: x[1])[0] + 1, "minutes": round(min(played, key=lambda x: x[1])[1])},
    }

    # ── Rhythm ────────────────────────────────────────────────────────────────
    heat = [[0.0] * 24 for _ in range(7)]
    hour_min = [0.0] * 24
    for t, e in yr:
        heat[t.weekday()][t.hour] += _min(e)
        hour_min[t.hour] += _min(e)
    peak_hour = max(range(24), key=lambda h: hour_min[h])
    evening = sum(hour_min[18:]) / minutes * 100 if minutes else 0
    wkend_days = sum(1 for i in range(days_total) if (span_start + timedelta(days=i)).weekday() >= 5)
    wkday_days = days_total - wkend_days
    wkend_min = sum(sum(heat[d]) for d in (5, 6))
    wkday_min = minutes - wkend_min
    weekend_ratio = (wkend_min / wkend_days) / (wkday_min / wkday_days) if wkend_days and wkday_days and wkday_min else None

    longest = None
    s_begin, s_end_t = None, None
    for t, e in yr:
        end = t + timedelta(milliseconds=e.get("duration_ms") or 0)
        if s_begin is None or (t - s_end_t).total_seconds() > SESSION_GAP_S:
            s_begin, s_end_t = t, end
        else:
            s_end_t = max(s_end_t, end)
        length = (s_end_t - s_begin).total_seconds() / 60
        if not longest or length > longest["minutes"]:
            longest = {"minutes": round(length), "date": s_begin.date().isoformat()}

    dry = (0, None, None)
    span_days = [span_start + timedelta(days=i) for i in range(days_total)]
    quiet = [d for d in span_days if d not in day_min]
    if quiet:
        dry = _longest_run(quiet)

    rhythm = {
        "peak_hour": peak_hour,
        "evening_pct": round(evening),
        "weekend_ratio": round(weekend_ratio, 1) if weekend_ratio else None,
        "longest_session": longest,
        "dry_spell": {"days": dry[0], "start": dry[1].isoformat() if dry[1] else None, "end": dry[2].isoformat() if dry[2] else None},
        "heat": [[round(v) for v in row] for row in heat],
    }

    # ── On repeat: the days one song took over ────────────────────────────────
    loops: dict[tuple, dict] = {}
    for t, e in yr:
        key = (t.date(), _song_key(e))
        x = loops.setdefault(key, {"n": 0, "minutes": 0.0, "first": t, "last": t})
        x["n"] += 1
        x["minutes"] += _min(e)
        x["last"] = t
    best_per_song: dict[tuple, tuple] = {}
    for (d, sk), x in loops.items():
        if x["n"] >= 3 and (sk not in best_per_song or x["n"] > best_per_song[sk][1]["n"]):
            best_per_song[sk] = (d, x)
    on_repeat = [
        {**song_info[sk], "date": d.isoformat(), "plays": x["n"], "minutes": round(x["minutes"]),
         "first": x["first"].strftime("%-I:%M %p"), "last": x["last"].strftime("%-I:%M %p")}
        for sk, (d, x) in sorted(best_per_song.items(), key=lambda kv: (-kv[1][1]["n"], kv[1][0]))[:LOOPS]
    ]

    # ── Discovery ─────────────────────────────────────────────────────────────
    first_seen: dict[str, datetime] = {}
    for t, e in dated:
        a = _artist(e)
        if a and a not in first_seen:
            first_seen[a] = t
    artist_plays = Counter(_artist(e) for _, e in yr if _artist(e))
    artist_month: dict[str, list[float]] = defaultdict(lambda: [0.0] * 12)
    for t, e in yr:
        if _artist(e):
            artist_month[_artist(e)][t.month - 1] += _min(e)
    new_sorted = sorted(new_artists, key=lambda a: -artist_plays[a])
    new_tiles = [{"name": a, "plays": artist_plays[a], "month": first_seen[a].month, "art_path": artist_art(a)}
                 for a in new_sorted[:NEW_ARTIST_TILES]]
    per_month = [0] * 12
    for a in new_artists:
        per_month[first_seen[a].month - 1] += 1
    artist_rank = {a: i + 1 for i, (a, _) in enumerate(artist_min.most_common())}

    def char(kind: str, name: str, sub: str) -> dict:
        return {"kind": kind, "name": name, "sub": sub, "art_path": artist_art(name),
                "bars": [round(v) for v in artist_month[name]]}

    last_month = latest.month if in_progress else 12
    chars: list[dict] = []
    used: set[str] = set()
    if new_sorted:
        top_new = max(new_artists, key=lambda a: artist_min[a])
        d = first_seen[top_new]
        chars.append(char("discovery", top_new, f"First heard {MONTHS[d.month - 1]} {d.day} · finished #{artist_rank[top_new]} overall"))
        used.add(top_new)

    # Slow burn: steady climb through the year (needs at least half the year in it).
    def climb(v: list[float]) -> float:
        xs = [i for i in range(last_month) if v[i] > 0]
        if len(xs) < max(4, last_month // 2):
            return 0
        rising = sum(1 for i in range(1, last_month) if v[i] >= v[i - 1] * 0.9 and v[i] > 0)
        half = last_month // 2
        early, late = sum(v[:half]), sum(v[half:last_month])
        return rising / last_month * (late / early if early else 0)
    burn = max((a for a in artist_min if a not in used and artist_min[a] >= 180),
               key=lambda a: climb(artist_month[a]), default=None)
    if burn and climb(artist_month[burn]) > 1.5:
        chars.append(char("slow_burn", burn, "A little more every month"))
        used.add(burn)

    # The fling: most of a year's listening in one month.
    flings = [(a, max(range(12), key=lambda i: artist_month[a][i])) for a in artist_min
              if a not in used and artist_min[a] >= 120]
    flings = [(a, i) for a, i in flings if artist_month[a][i] >= 0.75 * artist_min[a]]
    if flings:
        a, i = max(flings, key=lambda x: artist_month[x[0]][x[1]])
        rest_after = sum(artist_month[a][i + 1:])
        tail = "then nothing" if rest_after < 1 else "then barely"
        chars.append(char("fling", a, f"{_hours(artist_month[a][i])} hours in {MONTHS[i]}, {tail}"))
        used.add(a)

    # The comeback: gone two months or more, then back with real listening.
    best_cb = None
    for a in artist_min:
        if a in used or artist_min[a] < 120:
            continue
        v = artist_month[a]
        i = 0
        while i < last_month:
            if v[i] == 0 and i > 0 and sum(v[:i]) >= 30:
                j = i
                while j < last_month and v[j] == 0:
                    j += 1
                if j < last_month and j - i >= 2 and sum(v[j:last_month]) >= 60:
                    score = (j - i) * sum(v[j:last_month])
                    if not best_cb or score > best_cb[0]:
                        best_cb = (score, a, i, j)
                i = j
            else:
                i += 1
    if best_cb:
        _, a, i, j = best_cb
        gone = MONTHS[i] if j - i == 1 else f"{MONTHS[i]} to {MONTHS[j - 1]}"
        chars.append(char("comeback", a, f"Gone {gone}, back in {MONTHS_LONG[j]}"))

    what_stuck = None
    if not in_progress and after:
        later_years: dict[str, set[int]] = defaultdict(set)
        for t, e in after:
            if _artist(e) in new_artists:
                later_years[_artist(e)].add(t.year)
        total_plays = Counter(_artist(e) for _, e in dated if _artist(e) in new_artists)
        groups = Counter()
        for a in new_artists:
            if latest.year in later_years[a]:
                groups["still"] += 1
            elif later_years[a]:
                groups["faded"] += 1
            elif total_plays[a] > 1:
                groups["only"] += 1
            else:
                groups["once"] += 1
        keepers = [t for t in new_tiles if latest.year in later_years[t["name"]]]
        what_stuck = {
            "still": groups["still"], "faded": groups["faded"], "only": groups["only"], "once": groups["once"],
            "faded_until": max((max(y) for a, y in later_years.items() if y and latest.year not in y), default=None),
            "current_year": latest.year,
            "keepers": [{"name": k["name"], "art_path": k["art_path"]} for k in keepers],
            "of_tiles": len(new_tiles),
        }

    discovery = {
        "count": len(new_artists),
        "tiles": new_tiles,
        "per_month": per_month,
        "chars": chars,
        "what_stuck": what_stuck,
    }

    # ── Sound and release years ───────────────────────────────────────────────
    genres = []
    new_genres = 0
    if prev:
        now_s = _genre_shares([e for _, e in yr], artists_lib)
        then_s = _genre_shares([e for _, e in prev], artists_lib)
        names = sorted(set(now_s) | set(then_s), key=lambda g: -abs(now_s.get(g, 0) - then_s.get(g, 0)))[:GENRE_ROWS]
        rows = [{"name": g, "now": round(now_s.get(g, 0)), "prev": round(then_s.get(g, 0))} for g in names]
        genres = sorted(rows, key=lambda r: -(r["now"] - r["prev"]))
        seen_genres = set(_genre_shares([e for _, e in before], artists_lib))
        new_genres = len(set(now_s) - seen_genres)

    def median_year(rows: list[tuple[datetime, dict]]) -> int | None:
        pairs = sorted((e["release_year"], _min(e)) for _, e in rows if isinstance(e.get("release_year"), int) and e["release_year"] > 0)
        total = sum(m for _, m in pairs)
        acc = 0.0
        for y, m in pairs:
            acc += m
            if acc >= total / 2:
                return y
        return None

    # Release years are still being filled in for part of the imported history, so the
    # shares here are of the plays whose year is known, and the payload says how many.
    decades: Counter = Counter()
    oldest = None
    released_now = 0.0
    known_min = 0.0
    for _, e in yr:
        y = e.get("release_year")
        if isinstance(y, int) and y > 0:
            known_min += _min(e)
            decades[(y // 10) * 10] += 1
            if not oldest or y < oldest[0]:
                oldest = (y, e.get("album_name", ""))
            if y == year:
                released_now += _min(e)
    dec_total = sum(decades.values())
    oldest_plays = sum(1 for _, e in yr if oldest and e.get("release_year") == oldest[0] and e.get("album_name") == oldest[1])
    made = {
        "median": median_year(yr),
        "prev_median": median_year(prev) if prev else None,
        "decades": [{"decade": d, "pct": round(100 * n / dec_total, 1)} for d, n in sorted(decades.items())],
        "oldest": {"year": oldest[0], "album": oldest[1], "plays": oldest_plays} if oldest else None,
        "released_this_year_pct": round(released_now / known_min * 100) if known_min else 0,
        "known_pct": round(dec_total / len(yr) * 100),
    }

    return {
        "year": year,
        "years": years,
        "empty": False,
        "in_progress": in_progress,
        "through": latest.isoformat() if in_progress else None,
        "band": band,
        "months": months,
        "month_facts": month_facts,
        "yoy": yoy,
        "rhythm": rhythm,
        "on_repeat": on_repeat,
        "discovery": discovery,
        "genres": genres,
        "new_genres": new_genres,
        "made": made,
        # The AV Club is a slide in the year-end recap: never shown for the year still running.
        "club": None if in_progress else _av_club(yr, album_info, song_info, artist_min, artist_month, artist_art, first_seen, year),
    }


def _av_club(yr, album_info, song_info, artist_min, artist_month, artist_art, first_seen, year) -> list[dict]:
    """Yearbook superlatives, each picked by the numbers. Nobody wins twice: an artist
    holds at most one title, counting their albums and songs."""
    used: set[str] = set()
    out: list[dict] = []

    album_month: dict[str, list[float]] = defaultdict(lambda: [0.0] * 12)
    album_min: Counter = Counter()
    song_month: dict[tuple, list[float]] = defaultdict(lambda: [0.0] * 12)
    song_plays: Counter = Counter()
    artist_days: dict[str, set[date]] = defaultdict(set)
    album_days: dict[str, set[date]] = defaultdict(set)
    album_night: Counter = Counter()
    for t, e in yr:
        aid = e.get("album_id") or e.get("album_name", "")
        m = _min(e)
        album_month[aid][t.month - 1] += m
        album_min[aid] += m
        album_days[aid].add(t.date())
        if t.hour < 5:
            album_night[aid] += m
        sk = _song_key(e)
        song_month[sk][t.month - 1] += m
        song_plays[sk] += 1
        if _artist(e):
            artist_days[_artist(e)].add(t.date())

    def album_free(aid: str) -> bool:
        return album_info[aid]["artist"] not in used

    def song_free(sk: tuple) -> bool:
        return song_info[sk]["artist"] not in used

    def add(title: str, kind: str, artist: str, name: str, art: str | None, stat: str, why: str, math: str, bars: list[float]):
        used.add(artist)
        out.append({"title": title, "kind": kind, "name": name, "art_path": art, "stat": stat, "why": why,
                    "math": math, "bars": [round(v) for v in bars]})

    # Most likely to succeed: an artist first heard Jul–Oct, still climbing into December.
    dec_rank = {a: i + 1 for i, (a, _) in enumerate(sorted(((a, v[11]) for a, v in artist_month.items() if v[11] > 0), key=lambda x: -x[1]))}
    cands = [a for a, d in first_seen.items() if d.year == year and 7 <= d.month <= 10 and a in dec_rank
             and artist_month[a][11] > artist_month[a][10] > 0]
    if cands:
        a = min(cands, key=lambda x: dec_rank[x])
        d = first_seen[a]
        add("MOST LIKELY TO SUCCEED", "artist", a, a, artist_art(a), f"#{dec_rank[a]} in December",
            f"First heard in {MONTHS_LONG[d.month - 1]}, still climbing when the year ended.",
            "Artist first heard July to October, more in December than November, ranked by December minutes",
            artist_month[a])

    # Most improved: biggest gain, second half over first half.
    gains = {aid: sum(v[6:]) - sum(v[:6]) for aid, v in album_month.items() if sum(v[:6]) >= 120 and album_free(aid)}
    if gains:
        aid = max(gains, key=lambda x: gains[x])
        v = album_month[aid]
        if gains[aid] >= 180:
            add("MOST IMPROVED", "album", album_info[aid]["artist"], album_info[aid]["title"], album_info[aid]["art_path"], f"+{_hours(gains[aid])}h",
                f"{_hours(sum(v[:6]))}h in the first half, {_hours(sum(v[6:]))}h in the second.",
                "Biggest gain, July to December hours minus January to June hours (2h minimum in the first half)", v)

    # Perfect attendance: played on the most different days.
    regulars = [x for x in artist_days if x not in used]
    if regulars:
        a = max(regulars, key=lambda x: (len(artist_days[x]), artist_min[x]))
        ds = sorted(artist_days[a])
        gap = max(((b - c).days - 1 for c, b in zip(ds, ds[1:])), default=0)
        add("PERFECT ATTENDANCE", "artist", a, a, artist_art(a), f"{len(ds)} days",
            f"Played on more days than anyone else. Never gone more than {gap} days.",
            "Most distinct days with at least one play", artist_month[a])

    # Best comeback: the longest absence from an album, then back for real.
    best = None
    for aid, ds in album_days.items():
        if not album_free(aid) or album_min[aid] < 120:
            continue
        ds_sorted = sorted(ds)
        for c, b in zip(ds_sorted, ds_sorted[1:]):
            gap = (b - c).days
            after_min = sum(album_month[aid][b.month - 1:])
            if gap >= 30 and after_min >= 60 and (not best or gap > best[0]):
                best = (gap, aid, c, b)
    if best:
        gap, aid, c, b = best
        add("BEST COMEBACK", "album", album_info[aid]["artist"], album_info[aid]["title"], album_info[aid]["art_path"], f"{gap} days away",
            f"Gone from {MONTHS[c.month - 1]} {c.day} to {MONTHS[b.month - 1]} {b.day}, then back.",
            "Longest gap between plays, followed by at least an hour more", album_month[aid])

    # Night owl: highest share played between midnight and 5 AM.
    owls = [aid for aid in album_min if album_min[aid] >= 180 and album_free(aid)]
    if owls:
        aid = max(owls, key=lambda x: album_night[x] / album_min[x])
        share = album_night[aid] / album_min[aid]
        if share >= 0.25:
            add("NIGHT OWL", "album", album_info[aid]["artist"], album_info[aid]["title"], album_info[aid]["art_path"], f"{round(share * 100)}% after midnight",
                f"{_fmt_minutes(album_night[aid])} of its {_fmt_minutes(album_min[aid])} was played between midnight and 5 AM.",
                "Highest share of minutes from 12 AM to 5 AM (3h minimum)", album_month[aid])

    # Class clown: the shortest song you kept replaying.
    shorts = [sk for sk, n in song_plays.items() if n >= 15 and song_info[sk]["length_ms"] and song_free(sk)]
    if shorts:
        sk = min(shorts, key=lambda x: song_info[x]["length_ms"])
        secs = round(song_info[sk]["length_ms"] / 1000)
        add("CLASS CLOWN", "song", song_info[sk]["artist"], song_info[sk]["title"], song_info[sk]["art_path"], f"{secs // 60}:{secs % 60:02d} × {song_plays[sk]}",
            f"Your shortest song with 15+ plays, and you played it {song_plays[sk]} times.",
            "Shortest track among songs played 15 times or more", song_month[sk])

    # Never graduated: started most often, almost never finished.
    runs: dict[str, list[list[dict]]] = defaultdict(list)
    last_t: dict[str, datetime] = {}
    for t, e in yr:
        aid = e.get("album_id") or e.get("album_name", "")
        if aid in last_t and (t - last_t[aid]).total_seconds() <= SESSION_GAP_S:
            runs[aid][-1].append(e)
        else:
            runs[aid].append([e])
        last_t[aid] = t
    grads = []
    for aid, rs in runs.items():
        total = next((e.get("album_total_tracks") for r in rs for e in r if e.get("album_total_tracks")), None)
        if not total or total < 5 or not album_free(aid):
            continue
        # A start is track 1 plus at least one more track: track 1 alone on repeat is a song, not an album.
        started = [r for r in rs if any(e.get("track_number") == 1 for e in r) and len({e.get("track_number") for e in r}) >= 2]
        finished = [r for r in started if any(e.get("track_number") == total for e in r)]
        if len(started) >= 4 and len(finished) <= len(started) * 0.25:
            stalls = sorted(max((e.get("track_number") or 0) for e in r) for r in started if r not in finished)
            grads.append((len(started) - len(finished), aid, len(started), len(finished), stalls[len(stalls) // 2] if stalls else None))
    if grads:
        _, aid, s, f, stall = max(grads)
        why = f"Begun {s} times, " + ("never finished." if f == 0 else "finished once." if f == 1 else f"finished {f} times.")
        if stall:
            why += f" You stall around track {stall}."
        add("NEVER GRADUATED", "album", album_info[aid]["artist"], album_info[aid]["title"], album_info[aid]["art_path"], f"started {s} times", why,
            "Most album starts (track 1 played) with the fewest listens that reached the last track", album_month[aid])

    # Prom king: song of the summer.
    summer = Counter()
    lo, hi = date(year, 6, 21), date(year, 9, 22)
    for t, e in yr:
        if lo <= t.date() <= hi:
            summer[_song_key(e)] += 1
    for sk, n in summer.most_common():
        if not song_free(sk):
            continue
        add("PROM KING", "song", song_info[sk]["artist"], song_info[sk]["title"], song_info[sk]["art_path"], "Song of the summer",
            f"{n} plays from June 21 to September 22, the most of any song.",
            "Most plays between the summer solstice and the autumn equinox", song_month[sk])
        break

    return out
