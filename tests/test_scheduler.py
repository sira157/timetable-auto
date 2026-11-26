from collections import defaultdict
from functools import lru_cache
from pathlib import Path

from backend.core import default_settings, split_hours
from backend.data_io import parse_json
from backend.scheduler import pair_ok, run_schedule
from backend.validate import validate

SAMPLE = Path(__file__).resolve().parent.parent / "sample-data" / "medium.json"


def load_sample():
    parsed = parse_json(SAMPLE.read_bytes(), default_settings()["days"])
    return {k: [{"id": i + 1, **r} for i, r in enumerate(rows)] for k, rows in parsed.items()}


def settings(**kw):
    s = default_settings()
    s["time_budget_sec"] = 15
    s.update(kw)
    return s


@lru_cache(maxsize=None)
def _cached(seed: int):
    data = load_sample()
    s = settings()
    return data, s, run_schedule(data, s, seed=seed)


def test_split_hours():
    assert split_hours(3, 3) == [3]
    assert split_hours(4, 3) == [2, 2]
    assert split_hours(5, 3) == [3, 2]
    assert split_hours(6, 3) == [3, 3]


def test_cpsat_places_everything_without_errors():
    data, s, res = _cached(1)
    st = res["stats"]
    assert st["method"] == "cpsat"
    assert st["placed_hours"] == st["total_hours"], res["unplaced"]
    issues = validate(data, s, res["assignments"])
    assert [i for i in issues if i["level"] == "error"] == []
    assert not [i for i in issues if i["type"] == "capacity"]


def test_new_rules_hold():
    data, _s, res = _cached(1)
    A = res["assignments"]
    groups = {g["code"]: g for g in data["groups"]}
    rooms = {r["name"]: r for r in data["rooms"]}
    admins = {t["code"] for t in data["teachers"] if t.get("is_admin")}
    assert admins == {f"T0{i}" for i in range(1, 8)}
    for a in A:
        span = set(range(a["start"], a["start"] + a["length"]))
        assert 5 not in span, "ทับพักเที่ยง"
        if a["day"] == 2:  # วันพุธ คาบ 8 พบที่ปรึกษา คาบ 9 กิจกรรม
            assert not span & {8, 9}, f"ทับคาบพบที่ปรึกษา/กิจกรรม: {a['course_code']}"
        if a["day"] == 1 and span & {1, 2, 3, 4}:  # วันอังคาร คาบ 1–4 ประชุมฝ่ายบริหาร
            assert not set(a["teacher_codes"]) & admins, f"สอนทับประชุมฝ่ายบริหาร: {a['course_code']}"
    # ชั้นปี 4 ฝึกสอนทั้งภาคเรียน ไม่มีคาบเรียน
    assert not any(groups[g]["year"] == 4 for a in A for g in a["group_codes"])
    intern = [n for n in res["notices"] if n["course_code"] == "กศ 021037"]
    assert intern and len(intern[0]["teacher_codes"]) == 1
    # นวัตกรรมและเทคโนโลยี → ห้องคอมพิวเตอร์
    for a in A:
        if a["course_code"].startswith("นท"):
            assert rooms[a["room"]]["kind"] == "computer"
    # วิชากีฬา: ห้องทฤษฎี + โรงยิม/สนาม ช่วงเวลาเดียวกัน และ 2(1-2-3) = 3 ชม. ต่อเนื่อง
    kk = [a for a in A if a["course_code"] == "พล 051383"]
    assert kk and all(a["length"] == 3 and a["room"] and a["field"].startswith("โรงยิม จุดที่") for a in kk)
    for a in A:
        if a["part"] == "both" and a["kind"] != "free":
            assert a["room"] and a["field"], a
    # สอนร่วม: ผู้สอนทั้ง 2 คนอยู่ในคาบเดียวกัน
    co = [a for a in A if a["course_code"] == "วท 121101" and "1/1" in a["group_codes"]]
    assert co and all(len(a["teacher_codes"]) == 2 for a in co)
    # ทฤษฎีส่วนใหญ่อยู่ช่วงเช้า ปฏิบัติส่วนใหญ่อยู่ช่วงบ่าย (ข้อ 11.2)
    theory = [a for a in A if a["part"] == "theory"]
    practice = [a for a in A if a["part"] == "practice"]
    # ข้อ 11.2/11.6: ทฤษฎีเช้า ปฏิบัติบ่าย หรือทฤษฎี+ปฏิบัติต่อเนื่องกัน (การต่อเนื่องอาจดึงชุดหนึ่งไปอีกช่วง)
    by_day = defaultdict(list)
    for a in theory + practice:
        by_day[(a["section_id"], a["day"])].append(a)
    paired_ids = {id(a) for v in by_day.values() if len(v) == 2 for a in v}
    good = sum(
        1 for a in theory + practice
        if id(a) in paired_ids or (a["part"] == "theory" and a["start"] < 5) or (a["part"] == "practice" and a["start"] > 5)
    )
    assert good >= 0.8 * len(theory + practice), f"{good}/{len(theory + practice)}"
    assert sum(a["start"] < 5 for a in theory) >= 0.6 * len(theory)
    # วิชาเลือกกีฬาอยู่เวลาเดียวกันทั้ง 3 วิชา
    elect = defaultdict(set)
    for a in A:
        if a["kind"] == "elective":
            elect[a["unit_key"]].add((a["day"], a["start"]))
    assert elect and all(len(v) == 1 for v in elect.values())
    # ชุดคาบวิชาเดียวกันคนละวัน ยกเว้นทฤษฎี+ปฏิบัติที่เรียนต่อเนื่องกัน (ข้อ 2.4, 11.6)
    days = defaultdict(list)
    for a in A:
        days[(a["section_id"], a["day"])].append(a)
    for same in days.values():
        if len(same) > 1:
            assert len(same) == 2 and pair_ok(*[(x["start"], x["length"], x["part"]) for x in same], {5}), same
    # วิชาเลือกเสรีไม่ล็อกวันและคาบ แต่ทุกวิชาเริ่มเรียนพร้อมกันเป็นช่วงเดียว (ข้อ 7.1)
    free = [a for a in A if a["kind"] == "free"]
    assert free and len({(a["day"], a["start"]) for a in free}) == 1


def test_locks_are_kept():
    _d, _s, res = _cached(1)
    target = next(a for a in res["assignments"] if a["kind"] == "normal" and a["field"])
    lock = {(target["section_id"], target["block_index"]):
            {"day": target["day"], "start": target["start"], "room": target["room"], "field": target["field"]}}
    data = load_sample()
    res2 = run_schedule(data, settings(time_budget_sec=8), lock, seed=99)
    again = next(a for a in res2["assignments"]
                 if a["section_id"] == target["section_id"] and a["block_index"] == target["block_index"])
    assert (again["day"], again["start"], again["room"], again["field"]) == (
        target["day"], target["start"], target["room"], target["field"])
    assert again["locked"]


def test_greedy_fallback_runs():
    data = load_sample()
    res = run_schedule(data, settings(solver="greedy", time_budget_sec=2), seed=1)
    assert res["stats"]["method"] == "greedy"
    assert res["stats"]["placed_hours"] > 0


def test_overloaded_teacher_reported():
    data = load_sample()
    for sec in data["sections"]:
        sec["teacher_codes"] = ["T10"]
    res = run_schedule(data, settings(time_budget_sec=3), seed=1)
    assert res["stats"]["teacher_overload"]
    assert any("เกินคาบ" in u["reason"] for u in res["unplaced"])


def test_validator_detects_overlap_and_advisor_period():
    data, s, res = _cached(1)
    A = [dict(a) for a in res["assignments"]]
    normals = [a for a in A if a["kind"] == "normal" and a["teacher_codes"]]
    a = normals[0]
    b = next(x for x in normals[1:] if x["teacher_codes"] == a["teacher_codes"])
    b["day"], b["start"] = a["day"], a["start"]
    c = next(x for x in normals if x is not a and x is not b and x["length"] == 1) if any(
        x["length"] == 1 for x in normals) else None
    if c is not None:
        c["day"], c["start"] = 2, 8
    types = {i["type"] for i in validate(data, s, A) if i["level"] == "error"}
    assert "teacher_overlap" in types
    if c is not None:
        assert "group_busy" in types


def test_cancel_stops_search():
    import threading

    data = load_sample()
    ev = threading.Event()
    phases = []

    def progress(phase, _f, _i):
        phases.append(phase)
        if phase == "search":
            ev.set()

    from backend.scheduler import Cancelled

    try:
        run_schedule(data, settings(time_budget_sec=30), progress=progress, cancel=ev, seed=1)
    except Cancelled:
        pass
    else:
        raise AssertionError("ต้องยกเลิกได้")
    assert "search" in phases


def test_small_and_large_samples_complete():
    for size, budget in (("small", 5), ("large", 40)):
        parsed = parse_json((SAMPLE.parent / f"{size}.json").read_bytes(), default_settings()["days"])
        data = {k: [{"id": i + 1, **r} for i, r in enumerate(rows)] for k, rows in parsed.items()}
        s = settings(time_budget_sec=budget)
        res = run_schedule(data, s, seed=3)
        assert res["stats"]["placed_hours"] == res["stats"]["total_hours"], (size, res["unplaced"][:3])
        assert not [i for i in validate(data, s, res["assignments"]) if i["level"] == "error"]


def test_pair_ok_counts_lunch_as_continuous():
    lunch = {5}
    assert pair_ok((1, 2, "theory"), (3, 2, "practice"), lunch)
    assert pair_ok((3, 2, "theory"), (6, 2, "practice"), lunch)  # คั่นด้วยพักเที่ยงเท่านั้น
    assert pair_ok((6, 2, "practice"), (3, 2, "theory"), lunch)
    assert not pair_ok((1, 2, "theory"), (4, 2, "practice"), lunch)  # มีคาบว่างคั่น
    assert not pair_ok((1, 2, "theory"), (3, 2, "theory"), lunch)  # ภาคเดียวกัน
    assert not pair_ok((1, 2, "theory"), (2, 2, "practice"), lunch)  # ทับกัน


def test_theory_practice_same_room_prefers_consecutive():
    """ข้อ 11.6 (ไม่บังคับ): ทฤษฎี+ปฏิบัติที่เรียนห้องเดิม ส่วนใหญ่ได้เรียนต่อเนื่องในวันเดียวกันและห้องเดียวกัน"""
    _data, _s, res = _cached(1)
    by_sec = defaultdict(list)
    for a in res["assignments"]:
        if a["part"] in ("theory", "practice"):
            by_sec[a["section_id"]].append(a)
    both = {sid: xs for sid, xs in by_sec.items() if {x["part"] for x in xs} == {"theory", "practice"}}
    assert both
    paired = 0
    for xs in both.values():
        for t in (x for x in xs if x["part"] == "theory"):
            for p in (x for x in xs if x["part"] == "practice"):
                if t["day"] == p["day"] and pair_ok((t["start"], t["length"], "theory"), (p["start"], p["length"], "practice"), {5}):
                    assert t["room"] == p["room"], (t, p)
                    paired += 1
    # เป้าหมายรอง (ไม่บังคับ) ผลแปรผันตามเวลาที่ CP-SAT ได้ จึงใช้เกณฑ์ขั้นต่ำ
    assert paired >= 0.45 * len(both), f"ต่อเนื่อง {paired} จาก {len(both)} วิชา"
