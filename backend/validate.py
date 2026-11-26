"""ตรวจสอบตารางสอนทุกคาบ (ข้อ 13 ใน docs/scheduling-rules.md)

แยกผลเป็น "error" (ข้อผิดพลาด) และ "warning" (คำเตือน)
ใช้ได้ทั้งกับผลจากตัวจัดตาราง และตารางที่ผู้ใช้แก้ไข/ล็อกเอง
"""

from __future__ import annotations

from collections import defaultdict

from .core import (
    DataIndex,
    course_sport,
    field_candidates,
    is_computer_course,
    is_field_course,
    is_internship,
    norm,
)
from .scheduler import Prepared, pair_ok


def _issue(level, type_, message, **refs):
    return {"level": level, "type": type_, "message": message, **refs}


def validate(data: dict, settings: dict, assignments: list[dict]) -> list[dict]:
    idx = DataIndex(data, settings)
    prep = Prepared(idx, None)
    days = settings["days"]
    issues: list[dict] = []

    def where(d, p=None):
        day = days[d] if 0 <= d < len(days) else f"วันที่ {d + 1}"
        return f"วัน{day}" + (f" คาบ {p}" if p is not None else "")

    teacher_slots = defaultdict(list)
    group_slots = defaultdict(set)
    group_slot_items = defaultdict(list)
    room_slots = defaultdict(list)

    for a in assignments:
        d, s, L = int(a["day"]), int(a["start"]), int(a["length"])
        label = f"{a['course_code']} {a['course_name']}"
        aid = a.get("id")
        for p in range(s, s + L):
            if p < 1 or p > idx.n_periods or not (0 <= d < idx.n_days):
                issues.append(_issue("error", "out_of_range", f"{label} อยู่นอกช่วงคาบที่เปิดสอน", assignment_id=aid))
                break
            if p in idx.lunch:
                issues.append(_issue("error", "lunch", f"{label} ทับเวลาพักเที่ยง ({where(d, p)})", assignment_id=aid))
            for t in a["teacher_codes"]:
                teacher_slots[(t, d, p)].append(a)
                busy = prep.teacher_busy.get((t, d, p))
                if busy:
                    issues.append(_issue(
                        "error", "teacher_busy",
                        f"{idx.teacher_name(t)} ติด{busy} แต่มีสอน {label} ({where(d, p)})",
                        assignment_id=aid, teacher_code=t,
                    ))
            for g in a["group_codes"]:
                group_slots[(g, d, p)].add(a["unit_key"])
                group_slot_items[(g, d, p)].append(a)
                busy = prep.group_busy.get((g, d, p))
                if busy:
                    issues.append(_issue(
                        "error", "group_busy",
                        f"กลุ่ม {idx.group_name(g)} ติด{busy} แต่มีเรียน {label} ({where(d, p)})",
                        assignment_id=aid, group_code=g,
                    ))
            for r in {a.get("room"), a.get("field")} - {None, ""}:
                room_slots[(r, d, p)].append(a)

    def labels(items):
        return ", ".join(sorted({x["course_code"] for x in items}))

    for (t, d, p), items in teacher_slots.items():
        # วิชาเรียนรวมที่แยกห้อง: ผู้สอนคนเดียวกันในหน่วยเดียวกันไม่นับว่าซ้อน
        if len({(x["unit_key"], x["course_code"]) for x in items}) > 1:
            issues.append(_issue(
                "error", "teacher_overlap", f"{idx.teacher_name(t)} สอนซ้อนเวลา {where(d, p)}: {labels(items)}",
                teacher_code=t, day=d, period=p, assignment_id=items[0].get("id"),
            ))
    for (g, d, p), keys in group_slots.items():
        if len(keys) > 1:
            items = group_slot_items[(g, d, p)]
            issues.append(_issue(
                "error", "group_overlap", f"กลุ่ม {idx.group_name(g)} เรียนซ้อนเวลา {where(d, p)}: {labels(items)}",
                group_code=g, day=d, period=p, assignment_id=items[0].get("id"),
            ))
    for (r, d, p), items in room_slots.items():
        if len(items) > 1:
            issues.append(_issue(
                "error", "room_overlap", f"{r} ถูกใช้ซ้อนเวลา {where(d, p)}: {labels(items)}",
                room=r, day=d, period=p, assignment_id=items[0].get("id"),
            ))

    # ---------- ต่อการเปิดสอน ----------
    by_section = defaultdict(list)
    for a in assignments:
        by_section[a["section_id"]].append(a)

    fe = settings.get("free_elective") or {}
    year_homerooms = {
        idx.groups[g]["homeroom"] for y in (1, 2, 3, 4) for g in idx.year_groups.get(y, [])
        if idx.groups[g].get("homeroom")
    }
    elective_sets = idx.elective_sets()
    expected_units = {}
    for u in prep.units:
        for m in u.members:
            expected_units[(m.sid, m.bidx)] = m

    for sec in data["sections"]:
        course = idx.courses.get(sec["course_code"])
        items = by_section.get(sec["id"], [])
        if course is None:
            continue
        label = f"{course['code']} {course['name']}"
        if is_internship(course, settings) or course.get("is_excluded"):
            if items:
                issues.append(_issue("error", "not_scheduled_course", f"{label} เป็นวิชาที่ไม่ต้องจัดลงตาราง แต่ถูกจัดไว้", section_id=sec["id"]))
            continue
        expected = sum(m.length for (sid, _), m in expected_units.items() if sid == sec["id"])
        got = sum(int(a["length"]) for a in items)
        if expected and got != expected:
            issues.append(_issue(
                "error", "hours_mismatch",
                f"{label} ชั่วโมงเรียนไม่ครบหรือเกิน (จัดได้ {got} จาก {expected} ชม.)", section_id=sec["id"],
            ))
        if not (sec.get("teacher_codes") or []):
            issues.append(_issue("warning", "no_teacher", f"{label} ยังไม่มีผู้สอน", section_id=sec["id"]))

        days_used = defaultdict(list)
        for a in items:
            days_used[a["day"]].append(a)
        for d, same in days_used.items():
            if len(same) > 1:
                # ทฤษฎี+ปฏิบัติวันเดียวกันได้เมื่อต่อเนื่องกัน (คั่นด้วยพักเที่ยงได้) ข้อ 2.4, 11.6
                contiguous = len(same) == 2 and pair_ok(
                    *[(x["start"], x["length"], x.get("part")) for x in same], idx.lunch
                )
                if not contiguous:
                    issues.append(_issue(
                        "warning", "split_block", f"{label} ชุดคาบเดียวกันไม่ต่อเนื่อง ({where(d)})", section_id=sec["id"],
                    ))

        groups, _ = idx.section_groups(sec)
        need = sum(int(idx.groups[g].get("size") or 0) for g in groups if g in idx.groups)
        given = idx.section_places(sec)  # สถานที่ที่ข้อมูลระบุไว้ = ถือตามข้อมูล
        for a in items:
            aid = a.get("id")
            m = expected_units.get((a["section_id"], a["block_index"]))
            room = a.get("room")
            if a["kind"] == "free":
                if fe and (a["day"] != int(fe["day"]) or a["start"] != int(fe["start"])):
                    issues.append(_issue("error", "free_elective_time", f"{label} วิชาเลือกเสรีไม่อยู่ในเวลาที่กำหนด", assignment_id=aid))
                if room and room not in year_homerooms:
                    issues.append(_issue("error", "free_elective_room", f"{label} วิชาเลือกเสรีไม่อยู่ในห้องเรียนประจำชั้นปี 1–4", assignment_id=aid))
            if is_field_course(course, settings):
                fld = a.get("field")
                if not fld:
                    issues.append(_issue("warning", "no_field", f"{label} ยังไม่มีโรงยิม/สนาม ({where(a['day'])})", assignment_id=aid))
                else:
                    fr = idx.rooms.get(fld)
                    sport = course_sport(course, idx.field_rooms)
                    if fr is None:
                        issues.append(_issue("error", "field_sport", f"ไม่พบโรงยิม/สนาม {fld}", assignment_id=aid))
                    elif given is None and sport and not any(norm(x) == norm(sport) for x in fr.get("sports") or []):
                        issues.append(_issue("error", "field_sport", f"{fld} ไม่รองรับกีฬา{sport} ของวิชา {label}", assignment_id=aid))
            if not room:
                if given is not None and not given[0]:
                    continue  # ข้อมูลระบุเฉพาะสนาม ไม่ต้องใช้ห้องเรียน
                issues.append(_issue("error", "no_room", f"{label} ยังไม่มีห้องเรียน ({where(a['day'])})", assignment_id=aid))
                continue
            computer = is_computer_course(course, settings)
            if computer and idx.rooms.get(room, {}).get("kind") != "computer":
                issues.append(_issue("error", "not_computer_room", f"{label} วิชานวัตกรรมและเทคโนโลยีไม่ได้เรียนในห้องคอมพิวเตอร์ ({room})", assignment_id=aid))
            r = idx.rooms.get(room)
            if a["kind"] in ("normal", "coteach") and len(groups) == 1 and not computer and given is None:
                home = idx.groups[groups[0]].get("homeroom")
                if home and room != home:
                    issues.append(_issue(
                        "error", "not_homeroom", f"{label} ไม่ได้เรียนที่ห้องประจำของกลุ่ม ({room} แทน {home})", assignment_id=aid,
                    ))
            cap_need = need
            if a["kind"] == "free":
                cap_need = 0
            elif a["kind"] == "elective":
                members = elective_sets.get((idx.section_year(groups), (course.get("elective_set") or "").strip()), [])
                cap_need = need // max(1, len({x["course_code"] for x in members}))
            if r and cap_need and int(r.get("capacity") or 0) < cap_need:
                issues.append(_issue(
                    "warning", "capacity", f"{room} ที่นั่งไม่พอสำหรับ {label} (จุ {r.get('capacity')} คน, ผู้เรียน {cap_need} คน)",
                    assignment_id=aid,
                ))

    # ---------- กลุ่มวิชาเลือกต้องอยู่เวลาเดียวกัน ----------
    for (year, set_name), secs in idx.elective_sets().items():
        positions = defaultdict(set)
        for sec in secs:
            for a in by_section.get(sec["id"], []):
                positions[a["block_index"]].add((a["day"], a["start"]))
        for bidx, slots in positions.items():
            if len(slots) > 1:
                issues.append(_issue(
                    "error", "elective_not_aligned",
                    f"วิชาในกลุ่มวิชาเลือก {set_name} (ปี {year}) ชุดคาบที่ {bidx + 1} ไม่อยู่เวลาเดียวกัน",
                ))

    # ---------- คาบว่างระหว่างวันของกลุ่มเรียน ----------
    max_gap = int(settings.get("max_gap") or 3)
    tpos = {p: i for i, p in enumerate(idx.teaching_periods)}
    per_group_day = defaultdict(set)
    for (g, d, p) in group_slots:
        if p in tpos:
            per_group_day[(g, d)].add(tpos[p])
    for (g, d), pos in sorted(per_group_day.items()):
        pos = sorted(pos)
        worst = max((b - a - 1 for a, b in zip(pos, pos[1:])), default=0)
        if worst > max_gap:
            issues.append(_issue(
                "warning", "gap", f"กลุ่ม {idx.group_name(g)} มีคาบว่างระหว่างวัน {worst} คาบ ({where(d)}) เกิน {max_gap} คาบ",
                group_code=g, day=d,
            ))

    # ไม่ให้ข้อความซ้ำกัน
    seen = set()
    unique = []
    for it in issues:
        key = (it["level"], it["type"], it["message"])
        if key not in seen:
            seen.add(key)
            unique.append(it)
    unique.sort(key=lambda x: (x["level"] != "error", x["type"]))
    return unique


def check_data(data: dict, settings: dict) -> dict:
    """ตรวจความพร้อมของข้อมูลก่อนจัดตาราง

    สถานะของแต่ละการเปิดสอน: ready (พร้อม), review (ต้องตรวจ), error (ผิดพลาด), missing (ไม่พบในทะเบียน)
    """
    idx = DataIndex(data, settings)
    rows = []
    for sec in data["sections"]:
        msgs: list[tuple[str, str]] = []
        course = idx.courses.get(sec["course_code"])
        groups, missing_g = idx.section_groups(sec)
        teachers, missing_t = idx.section_teachers(sec)
        if course is None:
            msgs.append(("missing", f"ไม่พบรายวิชา {sec['course_code']}"))
        for g in missing_g:
            msgs.append(("missing", f"ไม่พบกลุ่มเรียน {g}"))
        for t in missing_t:
            msgs.append(("missing", f"ไม่พบผู้สอน {t}"))
        if course is not None:
            skip = is_internship(course, settings) or course.get("is_excluded")
            if not skip:
                from .core import course_hours

                hrs = course_hours(course)
                if hrs is None:
                    msgs.append(("error", f"หน่วยกิต \"{course.get('credits')}\" ไม่ใช่ น(ท-ป-ศ) และไม่ได้ระบุชั่วโมง/สัปดาห์"))
                elif sum(hrs) == 0:
                    msgs.append(("error", "ไม่มีชั่วโมงเรียน"))
                if not groups and not missing_g:
                    msgs.append(("error", "ยังไม่ได้ระบุกลุ่มเรียน"))
                years = idx.section_years(groups)
                if len(years) > 1 and (course.get("combined") or course.get("elective_set")):
                    msgs.append(("error", "กลุ่มเรียนของวิชาเรียนรวม/วิชาเลือกต้องอยู่ชั้นปีเดียวกัน"))
                if not teachers and not missing_t:
                    msgs.append(("review", "ยังไม่มีผู้สอน"))
                given = idx.section_places(sec)
                if is_field_course(course, settings) and not field_candidates(course, idx.field_rooms) and not (given and given[1]):
                    msgs.append(("review", "ไม่พบโรงยิม/สนามที่รองรับวิชานี้ (ตรวจคอลัมน์สถานที่ใช้หรือกีฬา)"))
                if is_computer_course(course, settings) and not any(r.get("kind") == "computer" for r in data["rooms"]):
                    msgs.append(("error", "วิชานวัตกรรมและเทคโนโลยีต้องใช้ห้องคอมพิวเตอร์ แต่ยังไม่มีห้องคอมพิวเตอร์ในข้อมูล"))
                for place in sec.get("places") or []:
                    if place not in idx.rooms:
                        msgs.append(("missing", f"ไม่พบสถานที่ {place}"))
                if given is None and not course.get("combined") and not course.get("free_elective") and len(groups) == 1 and not is_computer_course(course, settings):
                    g = idx.groups[groups[0]]
                    home = g.get("homeroom")
                    if not home:
                        msgs.append(("review", f"กลุ่ม {g['name']} ยังไม่มีห้องเรียนประจำ"))
                    elif home not in idx.rooms:
                        msgs.append(("review", f"ไม่พบห้อง {home} ที่เป็นห้องประจำของกลุ่ม {g['name']}"))
        order = ["missing", "error", "review"]
        status = next((s for s in order if any(m[0] == s for m in msgs)), "ready")
        if course is not None and (is_internship(course, settings) or course.get("is_excluded")) and status == "ready":
            status = "skip"
        rows.append({"section_id": sec["id"], "status": status, "messages": [m[1] for m in msgs]})

    general: list[dict] = []
    for p in _settings_problems(settings):
        general.append({"level": "error", "message": f"การตั้งค่าเวลา: {p}"})
    for g in data["groups"]:
        if not g.get("is_excluded") and g.get("homeroom") and g["homeroom"] not in idx.rooms:
            general.append({"level": "warning", "message": f"กลุ่ม {g['name']}: ไม่พบห้องประจำ {g['homeroom']}"})
        if g.get("advisor") and g["advisor"] not in idx.teachers:
            general.append({"level": "warning", "message": f"กลุ่ม {g['name']}: ไม่พบอาจารย์ที่ปรึกษา {g['advisor']}"})
    for name in settings.get("combined_rooms") or []:
        if name not in idx.rooms:
            general.append({"level": "warning", "message": f"ไม่พบห้องสำหรับเรียนรวม {name}"})
    for b in data["busy"]:
        for t in b.get("teacher_codes") or []:
            if t not in idx.teachers:
                general.append({"level": "warning", "message": f"{b.get('name') or 'เวลาที่ไม่ว่าง'}: ไม่พบผู้สอน {t}"})
    prep = Prepared(idx, None)
    for t, h in prep.teacher_load.items():
        if h > prep.teacher_capacity.get(t, 0):
            general.append({
                "level": "error",
                "message": f"{idx.teacher_name(t)} มีชั่วโมงสอนรวม {h} ชม. มากกว่าจำนวนคาบที่สอนได้ {prep.teacher_capacity[t]} คาบ/สัปดาห์ จึงจัดไม่ได้ครบ",
            })

    counts = defaultdict(int)
    for r in rows:
        counts[r["status"]] += 1
    return {"sections": rows, "general": general, "counts": dict(counts)}


def _settings_problems(settings):
    from .core import validate_settings

    return validate_settings(settings)
