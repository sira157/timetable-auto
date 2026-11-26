"""ตัวจัดตารางสอนอัตโนมัติ ตามกฎใน docs/scheduling-rules.md

อัลกอริทึม
----------
1. แปลงการเปิดสอน (section) เป็น "หน่วยจัด" (unit) = ชุดคาบติดกันที่ต้องวางพร้อมกัน
   * วิชาปกติ/เรียนรวม/สอนร่วม: 1 ชุดคาบ = 1 หน่วย (สอนร่วม: ผู้สอนทุกคนอยู่ในหน่วยเดียวกัน)
   * วิชากลุ่มทักษะและการสอนกีฬา: จองห้องทฤษฎีและโรงยิม/สนามพร้อมกันในหน่วยเดียว (ข้อ 9.1)
   * กลุ่มวิชาเลือก (ข้อ 6): ชุดคาบลำดับเดียวกันของทุกวิชาในกลุ่ม = 1 หน่วย
   * วิชาเลือกเสรี (ข้อ 7): หน่วยเดียวที่ล็อกวันและคาบตามการตั้งค่า
2. CP-SAT (Google OR-Tools): ตัวแปร x[หน่วย, วัน, คาบเริ่ม] และ w[หน่วย, ห้อง, ช่วงเวลา]
   * ข้อจำกัดบังคับ: ผู้สอน/กลุ่มเรียน/ห้อง/สนาม ใช้ได้ครั้งละหนึ่งต่อคาบ, ชุดคาบวิชาเดียวกันคนละวัน,
     เวลาพัก/พบอาจารย์ที่ปรึกษา/กิจกรรม/ประชุมฝ่ายบริหาร (ตัดช่วงเวลาที่ขัดออกตั้งแต่ต้น)
   * ฟังก์ชันเป้าหมาย: จัดชั่วโมงได้มากที่สุด (น้ำหนักสูงสุด) แล้วจึงลดคาบว่างเกินกำหนดและคาบท้ายของวัน
   * ถ้าคำตอบได้ครบและพิสูจน์ได้ว่าดีที่สุด ตัวแก้จะหยุดก่อนหมดเวลา
3. วิธีละโมบแบบสุ่มเริ่มใหม่ (greedy + restarts) ใช้สร้างคำตอบตั้งต้น (hint) ให้ CP-SAT
   และใช้แทนเมื่อไม่มี OR-Tools หรือ CP-SAT หาคำตอบไม่ได้ในเวลาที่กำหนด
"""

from __future__ import annotations

import math
import random
import time
from collections import defaultdict
from dataclasses import dataclass, field

from .core import (
    DataIndex,
    effective_busy,
    field_candidates,
    is_computer_course,
    is_field_course,
    is_internship,
    parse_credits,
    split_hours,
)

MAX_ROOM_CHOICES = 8  # จำกัดจำนวนห้องที่เป็นตัวเลือกต่อหน่วย เพื่อให้แบบจำลองไม่ใหญ่เกินไป


@dataclass
class Member:
    sid: int
    bidx: int
    part: str
    length: int
    teachers: list[str]
    groups: list[str]
    rooms: list[str]   # ห้องทฤษฎี/ห้องเรียน (ตัวเลือกเรียงตามลำดับที่ควรใช้)
    fields: list[str]  # โรงยิม/สนามที่ใช้พร้อมกัน (เฉพาะวิชากีฬา)
    needs_field: bool
    kind: str
    course_code: str
    course_name: str
    prefer: str | None = None  # morning | afternoon


@dataclass
class Unit:
    uid: int
    key: str
    members: list[Member]
    groups: list[str]
    length: int
    label: str
    base_priority: float = 0.0
    fixed: tuple[int, int] | None = None
    fixed_rooms: dict[int, tuple[str | None, str | None]] = field(default_factory=dict)
    locked: bool = False

    @property
    def teachers(self) -> set[str]:
        return {t for m in self.members for t in m.teachers}


Choice = tuple[str | None, str | None]  # (ห้อง, สนาม) ของสมาชิกหนึ่งคนในหน่วย


# ---------- เตรียมข้อมูล ----------


class Cancelled(Exception):
    """ผู้ใช้กดยกเลิกการคำนวณ"""


def section_blocks(course: dict, settings: dict, max_block: int) -> list[tuple[str, int]] | None:
    """แบ่งชุดคาบ (ข้อ 2.3): แยกทฤษฎีกับปฏิบัติ ยกเว้นวิชากีฬาที่ทฤษฎีและปฏิบัติอยู่ในชุดเดียวกัน (ข้อ 9.1)"""
    if parse_credits(course.get("credits")) is None:
        h = int(course.get("hours") or 0)  # เช่น 1(90) เรียน 4 ชม. → ระบุชั่วโมงไว้ ไม่แยกทฤษฎี/ปฏิบัติ
        return [("all", x) for x in split_hours(h, max_block)] if h > 0 else None
    _, theory, practice, _ = parse_credits(course.get("credits"))
    if is_field_course(course, settings):
        return [("both", h) for h in split_hours(theory + practice, max_block)]
    return [("theory", h) for h in split_hours(theory, max_block)] + [
        ("practice", h) for h in split_hours(practice, max_block)
    ]


def slot_preference(part: str, course: dict) -> str | None:
    """ข้อ 11.2: ทฤษฎีช่วงเช้า ปฏิบัติช่วงบ่าย (วิชากีฬาดูว่าชั่วโมงปฏิบัติมากกว่าหรือไม่)"""
    if part == "theory":
        return "morning"
    if part == "practice":
        return "afternoon"
    if part == "both":
        cr = parse_credits(course.get("credits"))
        if cr:
            return "afternoon" if cr[2] > cr[1] else "morning"
    return None


class Prepared:
    def __init__(self, idx: DataIndex, locks: dict | None):
        self.idx = idx
        s = idx.settings
        self.units: list[Unit] = []
        self.unplaced: list[dict] = []
        self.notices: list[dict] = []
        self.skipped: list[dict] = []
        self.locks = locks or {}
        self.lock_dropped = 0
        self.teacher_busy: dict[tuple[str, int, int], str] = {}
        self.group_busy: dict[tuple[str, int, int], str] = {}
        for b in effective_busy(idx.data, s):
            groups = idx.section_groups({"group_codes": b.get("group_codes") or []})[0]
            for p in range(int(b["start"]), int(b["end"]) + 1):
                for t in b.get("teacher_codes") or []:
                    self.teacher_busy[(t, int(b["day"]), p)] = b.get("name") or "ไม่ว่าง"
                for gc in groups:
                    self.group_busy[(gc, int(b["day"]), p)] = b.get("name") or "กิจกรรม"

        elective_sets = idx.elective_sets()
        elective_sid = {sec["id"]: key for key, secs in elective_sets.items() for sec in secs}

        # ช่วงคาบติดกันที่ยาวที่สุดโดยไม่มีพักกลางวัน
        longest_run, run = 0, 0
        for p in range(1, idx.n_periods + 1):
            run = 0 if p in idx.lunch else run + 1
            longest_run = max(longest_run, run)

        uid = 0
        elective_members: dict[tuple[int, str], list[list[Member]]] = defaultdict(list)
        free_members: list[list[Member]] = []

        for sec in idx.data["sections"]:
            course = idx.courses.get(sec["course_code"])
            base_info = {"section_id": sec["id"], "course_code": sec["course_code"]}
            if course is None:
                self._fail(base_info, sec, f"ไม่พบรายวิชา {sec['course_code']}")
                continue
            base_info["course_name"] = course["name"]
            groups, _missing = idx.section_groups(sec)
            groups = [g for g in groups if not idx.groups[g].get("is_excluded")]
            teachers, _ = idx.section_teachers(sec)
            teachers = [t for t in teachers if not idx.teachers[t].get("is_excluded")]
            if course.get("is_excluded"):
                self.skipped.append({**base_info, "reason": "รายวิชาไม่ลงทะเบียน"})
                continue
            if is_internship(course, s):
                # ข้อ 2.5: ไม่จัดลงตาราง ผู้สอนรับผิดชอบรายวิชาโดยไม่มีคาบสอน
                self.notices.append({
                    "type": "internship", **base_info, "group_codes": groups, "teacher_codes": teachers,
                    "text": "ปฏิบัติการสอนในสถานศึกษา",
                })
                continue
            blocks = section_blocks(course, s, idx.max_block)
            if blocks is None:
                self._fail(base_info, sec, f"หน่วยกิต {course.get('credits') or '-'} ผิดรูปแบบ (ต้องเป็น 3(2-2-5))")
                continue
            if not blocks:
                self._fail(base_info, sec, "ไม่มีชั่วโมงเรียน")
                continue
            if not groups:
                self._fail(base_info, sec, "ไม่มีกลุ่มเรียน")
                continue

            year = idx.section_year(groups)
            if course.get("free_elective"):
                kind = "free"
            elif sec["id"] in elective_sid:
                kind = "combined" if course.get("combined") else "elective"
            elif course.get("combined"):
                kind = "combined"
            elif len(teachers) > 1:
                kind = "coteach"
            else:
                kind = "normal"

            if kind == "free":
                # วิชาเลือกเสรีเรียนต่อเนื่องเป็นช่วงเดียว (ข้อ 7.1) ถ้ายาวเกินช่วงที่ไม่มีพักจึงแบ่งตามปกติ
                total = sum(h for _, h in blocks)
                if total <= longest_run:
                    blocks = [("all", total)]

            is_field = is_field_course(course, s)
            fields = field_candidates(course, idx.field_rooms) if is_field else []
            rooms = self._room_candidates(course, groups, kind, year)
            given = idx.section_places(sec)
            if given is not None:  # สถานที่ที่ข้อมูลระบุไว้ ใช้ตามนั้น
                rooms = given[0]
                fields = given[1] or fields
            members = [
                Member(
                    sid=sec["id"], bidx=bidx, part=part, length=length, teachers=teachers, groups=groups,
                    rooms=rooms, fields=fields, needs_field=is_field, kind=kind,
                    course_code=course["code"], course_name=course["name"],
                    # วิชาเลือกเสรีเรียนพร้อมกันทุกชั้นปี: เลือกช่วงบ่ายก่อน เพื่อเว้นช่วงเช้าให้วิชาทฤษฎี (ไม่บังคับ)
                    prefer="afternoon" if kind == "free" else slot_preference(part, course),
                )
                for bidx, (part, length) in enumerate(blocks)
            ]

            if sec["id"] in elective_sid and kind in ("elective", "combined"):
                elective_members[elective_sid[sec["id"]]].append(members)
                continue
            if kind == "free":
                free_members.append(members)
                continue

            for m in members:
                uid += 1
                unit = Unit(
                    uid=uid, key=f"S:{m.sid}:{m.bidx}", members=[m], groups=list(groups), length=m.length,
                    label=f"{course['code']} {course['name']}",
                )
                self._apply_locks(unit)
                unit.base_priority = self._priority(unit)
                self.units.append(unit)

        for (year, set_name), per_section in elective_members.items():
            year_groups = idx.year_groups.get(year, [])
            max_len = max(len(x) for x in per_section)
            for i in range(max_len):
                members = [x[i] for x in per_section if i < len(x)]
                uid += 1
                groups = sorted(set(year_groups) | {g for m in members for g in m.groups})
                unit = Unit(
                    uid=uid, key=f"E:{year}:{set_name}:{i}", members=members, groups=groups,
                    length=max(m.length for m in members), label=f"กลุ่มวิชาเลือก {set_name} (ปี {year})",
                )
                self._apply_locks(unit)
                unit.base_priority = self._priority(unit)
                self.units.append(unit)

        # วิชาเลือกเสรีทุกวิชาเริ่มเรียนพร้อมกัน (ข้อ 7.1) ไม่ล็อกวันและคาบ ระบบเลือกเวลาที่ว่างตรงกันให้
        # ชุดคาบที่ i ของทุกวิชารวมเป็นหน่วยเดียวกัน (เหมือนกลุ่มวิชาเลือก)
        if free_members:
            for i in range(max(len(x) for x in free_members)):
                members = [x[i] for x in free_members if i < len(x)]
                uid += 1
                unit = Unit(
                    uid=uid, key=f"F:free:{i}", members=members,
                    groups=sorted({g for m in members for g in m.groups}),
                    length=max(m.length for m in members), label="วิชาเลือกเสรี",
                )
                self._apply_locks(unit)
                unit.base_priority = self._priority(unit)
                self.units.append(unit)

        self.lock_dropped = len(self.locks) - sum(
            1 for u in self.units for m in u.members if (m.sid, m.bidx) in self.locks
        )
        self.teacher_load, self.teacher_capacity = self._teacher_load()

    def _fail(self, base_info: dict, sec: dict, reason: str) -> None:
        self.unplaced.append({
            **base_info, "hours": 0, "group_codes": sec.get("group_codes") or [],
            "teacher_codes": sec.get("teacher_codes") or [], "reason": reason, "factor": "special",
        })

    def _room_candidates(self, course, groups, kind, year) -> list[str]:
        idx = self.idx
        need = sum(int(idx.groups[g].get("size") or 0) for g in groups)
        by_kind = lambda k: [r for r in idx.data["rooms"] if r.get("kind") == k]  # noqa: E731

        def fit_order(rooms, need_):
            # ข้อ 8.4 ที่นั่งต้องพอ: ถ้ามีห้องที่จุพอ ให้เลือกได้เฉพาะห้องเหล่านั้น
            enough = [r for r in rooms if int(r.get("capacity") or 0) >= need_]
            rooms = sorted(enough or rooms, key=lambda r: int(r.get("capacity") or 0))
            return [r["name"] for r in rooms]

        if kind == "free":
            years = [year] + [y for y in (1, 2, 3, 4) if y != year]
            homes = []
            for y in years:
                homes += [idx.groups[g]["homeroom"] for g in idx.year_groups.get(y, [])]
            names = [h for h in homes if h in idx.rooms and idx.rooms[h].get("kind") == "classroom"]
            seen: set[str] = set()
            return [x for x in names if not (x in seen or seen.add(x))]
        if is_computer_course(course, idx.settings):
            # ข้อ 8.7 นวัตกรรมและเทคโนโลยี ใช้ห้องคอมพิวเตอร์ทั้งบรรยายและปฏิบัติ
            return fit_order(by_kind("computer"), need)
        if kind == "elective":
            homes = [idx.groups[g]["homeroom"] for g in idx.year_groups.get(year, [])]
            names = [h for h in homes if h in idx.rooms]
            names += [r for r in fit_order(by_kind("classroom"), 0) if r not in names]
            return names[:MAX_ROOM_CHOICES]
        if kind == "combined" or len(groups) > 1:
            pool = [r for r in idx.data["rooms"] if r.get("kind") in ("classroom", "meeting")]
            ordered = fit_order(pool, need)
            first = [n for n in idx.combined_rooms if n in ordered]  # ข้อ 5.2 ใช้ห้องเรียนรวมก่อน
            return (first + [n for n in ordered if n not in first])[:MAX_ROOM_CHOICES]
        home = idx.groups[groups[0]].get("homeroom") or ""
        return [home] if home in idx.rooms else []

    def _apply_locks(self, unit: Unit) -> None:
        for mi, m in enumerate(unit.members):
            lk = self.locks.get((m.sid, m.bidx))
            if lk:
                unit.locked = True
                unit.fixed = (int(lk["day"]), int(lk["start"]))
                unit.fixed_rooms[mi] = (lk.get("room"), lk.get("field"))

    def _priority(self, unit: Unit) -> float:
        m0 = unit.members[0]
        p = unit.length * 5 + len(unit.teachers) * 8 + len(unit.groups) * 2
        if m0.kind == "free":
            p += 500
        elif m0.kind == "elective":
            p += 300 + len(unit.members) * 10
        elif m0.kind == "combined":
            p += 200
        if any(m.needs_field for m in unit.members):
            p += 20 + max(0, 6 - min(len(m.fields) for m in unit.members)) * 4
        return p

    def _teacher_load(self):
        load: dict[str, int] = defaultdict(int)
        for u in self.units:
            for m in u.members:
                for t in m.teachers:
                    load[t] += m.length
        slots = self.idx.n_days * len(self.idx.teaching_periods)
        capacity = {}
        for t in load:
            busy = sum(1 for (code, _d, p) in self.teacher_busy if code == t and p not in self.idx.lunch)
            capacity[t] = slots - busy
        return dict(load), capacity


# ---------- วิธีละโมบ (ใช้เป็นคำตอบตั้งต้นและตัวสำรอง) ----------


class Solver:
    def __init__(self, prep: Prepared, rng: random.Random):
        self.prep = prep
        self.idx = prep.idx
        self.rng = rng
        self.N = self.idx.n_periods
        self.D = self.idx.n_days
        self.lunch = self.idx.lunch
        self.max_gap = int(self.idx.settings.get("max_gap") or 3)
        self.avoid_last = bool(self.idx.settings.get("avoid_last_period", True))
        self.tpos = {p: i for i, p in enumerate(self.idx.teaching_periods)}
        self._starts: dict[int, list[int]] = {}
        self.reset()

    def half_mismatch(self, u: Unit, s: int) -> int:
        """จำนวนสมาชิกในหน่วยที่ผิดช่วง (ทฤษฎีไปบ่าย / ปฏิบัติไปเช้า)"""
        return sum(1 for m in u.members if wrong_half(m.prefer, s, self.idx.lunch))

    def reset(self) -> None:
        self.t_occ: dict[tuple, int] = {}
        self.g_occ: dict[tuple, int] = {}
        self.r_occ: dict[tuple, int] = {}
        self.sec_days: dict[int, set[int]] = defaultdict(set)
        self.sec_slots: dict[tuple, list[tuple]] = defaultdict(list)  # (sid, วัน) → [(เริ่ม, ยาว, ภาค)]
        self.g_day: dict[tuple, set[int]] = defaultdict(set)
        self.sec_room: dict[tuple, str] = {}  # (sid, วัน) → ห้องที่ใช้ (ให้อีกภาคใช้ห้องเดิม)
        self.placement: dict[int, tuple[int, int, list[Choice]]] = {}

    def starts(self, length: int) -> list[int]:
        if length not in self._starts:
            self._starts[length] = [
                s for s in range(1, self.N - length + 2)
                if all(p not in self.lunch for p in range(s, s + length))
            ]
        return self._starts[length]

    def gap_ok(self, periods: set[int]) -> bool:
        pos = sorted(self.tpos[p] for p in periods if p in self.tpos)
        return all(b - a - 1 <= self.max_gap for a, b in zip(pos, pos[1:]))

    def _pick(self, cands: list[str], used: set[str], d: int, s: int, length: int) -> str | None:
        for r in cands:
            if r not in used and all((r, d, p) not in self.r_occ for p in range(s, s + length)):
                return r
        return None

    def check(self, u: Unit, d: int, s: int, enforce_gap: bool):
        """คืน (รายการ (ห้อง, สนาม), None) ถ้าวางได้ หรือ (None, เหตุผล)"""
        L = u.length
        span = range(s, s + L)
        if s < 1 or s + L - 1 > self.N or any(p in self.lunch for p in span) or not (0 <= d < self.D):
            return None, "range"
        seen: dict[str, str] = {}
        for m in u.members:
            if d in self.sec_days[m.sid]:
                # ทฤษฎีกับปฏิบัติของวิชาเดียวกันอยู่วันเดียวกันได้ ถ้าเรียนต่อเนื่องกัน
                same = self.sec_slots[(m.sid, d)]
                if not (len(same) == 1 and pair_ok(same[0], (s, m.length, m.part), self.lunch)):
                    return None, "sameday"
            for t in m.teachers:
                if seen.get(t, m.course_code) != m.course_code:
                    return None, "teacher"
                seen[t] = m.course_code
                for p in range(s, s + m.length):
                    if (t, d, p) in self.t_occ or (t, d, p) in self.prep.teacher_busy:
                        return None, "teacher"
        for g in u.groups:
            for p in span:
                if (g, d, p) in self.g_occ or (g, d, p) in self.prep.group_busy:
                    return None, "group"
        if enforce_gap:
            for g in u.groups:
                occ = self.g_day[(g, d)]
                if occ and not self.gap_ok(occ | set(span)):
                    return None, "gap"
        choices: list[Choice] = []
        used: set[str] = set()
        for mi, m in enumerate(u.members):
            if mi in u.fixed_rooms:
                room, fld = u.fixed_rooms[mi]
            else:
                # ทฤษฎี+ปฏิบัติต่อเนื่องในวันเดียวกัน: ใช้ห้องเดิมก่อน (ข้อ 11.6)
                partner = self.sec_room.get((m.sid, d))
                cands = [partner] + [r for r in m.rooms if r != partner] if partner in m.rooms else m.rooms
                room = self._pick(cands, used, d, s, m.length) if m.rooms else None
                if m.rooms and room is None:
                    return None, "room"
                fld = self._pick(m.fields, used, d, s, m.length) if m.fields else None
                if m.fields and fld is None:
                    return None, "room"
            used |= {x for x in (room, fld) if x}
            choices.append((room, fld))
        return choices, None

    def place(self, u: Unit, d: int, s: int, choices: list[Choice]) -> None:
        for p in range(s, s + u.length):
            for g in u.groups:
                self.g_occ[(g, d, p)] = u.uid
                self.g_day[(g, d)].add(p)
        for m, (room, fld) in zip(u.members, choices):
            self.sec_days[m.sid].add(d)
            self.sec_slots[(m.sid, d)].append((s, m.length, m.part))
            if room:
                self.sec_room.setdefault((m.sid, d), room)
            for p in range(s, s + m.length):
                for t in m.teachers:
                    self.t_occ[(t, d, p)] = u.uid
                for r in (room, fld):
                    if r:
                        self.r_occ[(r, d, p)] = u.uid
        self.placement[u.uid] = (d, s, choices)

    def force_place(self, u: Unit) -> None:
        d, s = u.fixed
        choices, _ = self.check(u, d, s, enforce_gap=False)
        if choices is None:
            choices = [
                u.fixed_rooms.get(mi) or (m.rooms[0] if m.rooms else None, m.fields[0] if m.fields else None)
                for mi, m in enumerate(u.members)
            ]
        self.place(u, d, s, choices)

    def score(self, u: Unit, d: int, s: int) -> float:
        end = s + u.length - 1
        sc = self.rng.random() * 0.8
        if self.avoid_last and end == self.N:
            sc += 3.0
        sc += self.half_mismatch(u, s) * 2.0
        sc -= self.adjacent_pairs(u, d, s) * 6.0
        if u.groups:
            load = sum(len(self.g_day[(g, d)]) for g in u.groups) / len(u.groups)
            sc += load * 0.45
            occ = self.g_day[(u.groups[0], d)]
            if occ and ((s - 1) in occ or (end + 1) in occ):
                sc -= 0.6
        for t in u.teachers:
            sc += sum(1 for p in range(1, self.N + 1) if (t, d, p) in self.t_occ) * 0.08
        return sc

    def candidates(self, u: Unit) -> list[tuple[int, int]]:
        if u.fixed:
            return [u.fixed]
        slots = [(d, s) for d in range(self.D) for s in self.starts(u.length)]
        slots.sort(key=lambda ds: self.score(u, *ds))
        return slots

    def attempt(self, order: list[Unit], enforce_gap: bool) -> list[Unit]:
        self.reset()
        for u in order:
            if u.locked:
                self.force_place(u)
        failed = []
        for u in order:
            if u.locked:
                continue
            for d, s in self.candidates(u):
                choices, _ = self.check(u, d, s, enforce_gap)
                if choices is not None:
                    self.place(u, d, s, choices)
                    break
            else:
                failed.append(u)
        return failed

    def adjacent_pairs(self, u: Unit, d: int, s: int) -> int:
        """จำนวนชุดคาบที่จะต่อเนื่องกับชุดคาบอีกภาคของวิชาเดียวกัน (ข้อ 11.6)"""
        return sum(
            1 for m in u.members for x in self.sec_slots[(m.sid, d)] if pair_ok(x, (s, m.length, m.part), self.lunch)
        )

    def penalty(self) -> float:
        pen = 0.0
        pen -= sum(
            1 for slots in self.sec_slots.values() for i, a in enumerate(slots) for b in slots[i + 1:] if pair_ok(a, b, self.lunch)
        ) * 6
        units = {u.uid: u for u in self.prep.units}
        for uid, (_d, s, _r) in self.placement.items():
            if self.avoid_last and s + units[uid].length - 1 == self.N:
                pen += 1
            pen += self.half_mismatch(units[uid], s) * 2
        for occ in self.g_day.values():
            if occ and not self.gap_ok(occ):
                pen += 20
        return pen

    def diagnose(self, u: Unit, enforce_gap: bool) -> tuple[str, str]:
        """เหตุผลสั้นๆ ที่จัดไม่ได้ และหมวดปัจจัย (teacher | room | time | special)"""
        over = [t for t in u.teachers if self.prep.teacher_load.get(t, 0) > self.prep.teacher_capacity.get(t, 0)]
        if over:
            t = over[0]
            return (
                f"{self.idx.teacher_name(t)} สอน {self.prep.teacher_load[t]} ชม. เกินคาบที่มี "
                f"{self.prep.teacher_capacity[t]} คาบ/สัปดาห์",
                "teacher",
            )
        if any(m.needs_field and not m.fields for m in u.members):
            return "ไม่มีโรงยิม/สนามที่รองรับกีฬาของวิชานี้", "room"
        tally: dict[str, int] = defaultdict(int)
        for d, s in self.candidates(u):
            _, why = self.check(u, d, s, enforce_gap)
            tally[why or "ok"] += 1
        labels = {
            "teacher": ("ครูไม่ว่าง", "teacher"),
            "group": ("กลุ่มเรียนไม่ว่าง", "time"),
            "room": ("ห้อง/สนามไม่ว่าง", "room"),
            "sameday": ("ชนวันกับชุดคาบอื่นของวิชาเดียวกัน", "special"),
            "gap": ("คาบว่างเกินกำหนด", "time"),
            "range": ("นอกช่วงคาบ", "time"),
        }
        top = [k for k, _v in sorted(tally.items(), key=lambda kv: -kv[1]) if k in labels][:2]
        if not top:
            return "ไม่มีช่วงเวลาที่ว่างพร้อมกัน", "time"
        head = "เวลาที่ล็อกไว้ไม่ว่าง" if u.fixed else "ไม่มีเวลาว่างตรงกัน"
        return f"{head}: " + ", ".join(labels[k][0] for k in top), labels[top[0]][1]


def pair_ok(a: tuple, b: tuple, lunch=()) -> bool:
    """ชุดคาบ 2 ชุดของวิชาเดียวกันอยู่วันเดียวกันได้ เมื่อเป็นทฤษฎี+ปฏิบัติ และเรียนต่อเนื่องกัน (start, length, part)

    ต่อเนื่อง = ชุดหนึ่งเริ่มทันทีที่อีกชุดจบ หรือคั่นด้วยเวลาพักเที่ยงเท่านั้น (เช่น ทฤษฎีคาบ 3–4 ปฏิบัติคาบ 6–7)
    """
    if {a[2], b[2]} != {"theory", "practice"}:
        return False
    first, second = (a, b) if a[0] <= b[0] else (b, a)
    end = first[0] + first[1]
    return end <= second[0] and all(p in lunch for p in range(end, second[0]))


def wrong_half(prefer: str | None, start: int, lunch: set[int]) -> bool:
    if not prefer or not lunch:
        return False
    if prefer == "morning":
        return start > min(lunch)
    return start < max(lunch)


def _greedy(prep: Prepared, enforce_gap: bool, budget: float, seed: int, cancel=None) -> dict:
    rng = random.Random(seed)
    solver = Solver(prep, rng)
    bump: dict[int, float] = defaultdict(float)
    best = None
    started = time.perf_counter()
    iterations = 0
    total_hours = sum(m.length for u in prep.units for m in u.members)
    while True:
        if cancel is not None and cancel.is_set():
            raise Cancelled()
        iterations += 1
        order = sorted(prep.units, key=lambda u: (-(u.base_priority + bump[u.uid]), rng.random()))
        failed = solver.attempt(order, enforce_gap)
        placed_hours = total_hours - sum(m.length for u in failed for m in u.members)
        metric = (placed_hours, -solver.penalty())
        if best is None or metric > best["metric"]:
            best = {"metric": metric, "placement": dict(solver.placement), "failed": [u.uid for u in failed]}
        for u in failed:
            bump[u.uid] += 40 + rng.random() * 20
        elapsed = time.perf_counter() - started
        complete = best["metric"][0] == total_hours
        if complete and (best["metric"][1] == 0 or elapsed > budget * 0.35):
            break
        if elapsed > budget or iterations >= 4000:
            break
    best.update(iterations=iterations, total_hours=total_hours, method="greedy")
    return best


# ---------- CP-SAT ----------


def _cpsat(prep: Prepared, budget: float, seed: int, hint: dict | None, cancel=None, progress=None) -> dict | None:
    try:
        from ortools.sat.python import cp_model
    except ImportError:
        return None

    idx = prep.idx
    N, D = idx.n_periods, idx.n_days
    lunch = idx.lunch
    max_gap = int(idx.settings.get("max_gap") or 3)
    avoid_last = bool(idx.settings.get("avoid_last_period", True))
    model = cp_model.CpModel()

    # ทรัพยากรที่คาบล็อกใช้ไปแล้ว (วางก่อนแบบตายตัว)
    fixed_solver = Solver(prep, random.Random(seed))
    locked = [u for u in prep.units if u.locked]
    for u in locked:
        fixed_solver.force_place(u)
    pre_t = set(fixed_solver.t_occ)
    pre_g = set(fixed_solver.g_occ)
    pre_r = set(fixed_solver.r_occ)
    pre_sd = {(sid, d) for sid, days in fixed_solver.sec_days.items() for d in days}

    cells: dict[tuple, list] = defaultdict(list)  # ทรัพยากรต่อคาบ → ตัวแปรที่ใช้
    # วิชาที่มีทั้งชุดทฤษฎีและชุดปฏิบัติ (เรียนห้องเดิม) จัดวันเดียวกันได้ถ้าต่อเนื่องกัน
    parts_of: dict[int, set] = defaultdict(set)
    for u in prep.units:
        for m in u.members:
            parts_of[m.sid].add(m.part)
    pair_sids = {sid for sid, parts in parts_of.items() if {"theory", "practice"} <= parts}
    sd_items: dict[tuple, list] = defaultdict(list)  # (sid, วัน) → [(x, เริ่ม, ยาว, ภาค)]
    group_terms: dict[tuple, list] = defaultdict(list)  # (กลุ่ม, วัน, คาบ) → ตัวแปร (ใช้คำนวณคาบว่าง)
    placed_vars: dict[int, list] = {}
    xvars: dict[tuple, object] = {}
    wvars: dict[tuple, object] = {}
    objective = []

    def free_cell(cell, pre):
        return cell not in pre

    for u in prep.units:
        if u.locked:
            continue
        slots = [u.fixed] if u.fixed else [
            (d, s) for d in range(D) for s in range(1, N - u.length + 2)
            if all(p not in lunch for p in range(s, s + u.length))
        ]
        lits = []
        for d, s in slots:
            span = range(s, s + u.length)
            if any(p in lunch or p > N for p in span):
                continue
            ok = all(
                free_cell((g, d, p), pre_g) and (g, d, p) not in prep.group_busy for g in u.groups for p in span
            )
            ok = ok and all(
                free_cell((t, d, p), pre_t) and (t, d, p) not in prep.teacher_busy
                for m in u.members for t in m.teachers for p in range(s, s + m.length)
            )
            ok = ok and all((m.sid, d) not in pre_sd for m in u.members)
            teacher_course: dict[str, set] = defaultdict(set)
            for m in u.members:
                for t in m.teachers:
                    teacher_course[t].add(m.course_code)
            ok = ok and all(len(v) == 1 for v in teacher_course.values())
            if not ok:
                continue
            # ห้อง/สนามที่ยังว่างในช่วงนี้ (ไม่นับที่ถูกคาบล็อกใช้)
            room_opts = []
            for m in u.members:
                rs = [r for r in m.rooms if all((r, d, p) not in pre_r for p in range(s, s + m.length))]
                fs = [r for r in m.fields if all((r, d, p) not in pre_r for p in range(s, s + m.length))]
                if (m.rooms and not rs) or (m.fields and not fs):
                    ok = False
                    break
                room_opts.append((rs, fs))
            if not ok:
                continue
            x = model.NewBoolVar(f"x_{u.uid}_{d}_{s}")
            xvars[(u.uid, d, s)] = x
            lits.append(x)
            for p in span:
                for g in u.groups:
                    cells[("g", g, d, p)].append(x)
                    group_terms[(g, d, p)].append(x)
            teacher_done: set[tuple] = set()
            for mi, (m, (rs, fs)) in enumerate(zip(u.members, room_opts)):
                if m.sid in pair_sids and m.part in ("theory", "practice") and len(u.members) == 1:
                    sd_items[(m.sid, d)].append((x, s, m.length, m.part, u.uid))
                else:
                    cells[("sd", m.sid, d)].append(x)
                for p in range(s, s + m.length):
                    for t in m.teachers:
                        if (t, p) not in teacher_done:  # ผู้สอนคนเดียวกันในหน่วยเดียวกันนับครั้งเดียว
                            teacher_done.add((t, p))
                            cells[("t", t, d, p)].append(x)
                for kind, opts in (("r", rs), ("f", fs)):
                    if not opts:
                        continue
                    if len(opts) == 1:
                        for p in range(s, s + m.length):
                            cells[("r", opts[0], d, p)].append(x)
                        wvars[(u.uid, mi, kind, opts[0], d, s)] = x
                        continue
                    ws = []
                    pref = m.rooms if kind == "r" else m.fields
                    for r in opts:
                        w = model.NewBoolVar(f"w_{u.uid}_{mi}_{kind}_{d}_{s}_{len(wvars)}")
                        wvars[(u.uid, mi, kind, r, d, s)] = w
                        ws.append(w)
                        rank = min(pref.index(r), 3)
                        if rank:  # ใช้ห้องลำดับแรกก่อน (ห้องประจำชั้นปีเดียวกัน / ห้องเรียนรวม)
                            objective.append(-rank * w)
                        for p in range(s, s + m.length):
                            cells[("r", r, d, p)].append(w)
                    model.Add(sum(ws) == x)
            if avoid_last and s + u.length - 1 == N:
                objective.append(-4 * x)  # เลี่ยงคาบท้ายของวัน (ข้อ 11.3)
            wrong = sum(1 for m in u.members if wrong_half(m.prefer, s, lunch))
            if wrong:
                objective.append(-6 * wrong * x)  # ทฤษฎีเช้า ปฏิบัติบ่าย (ข้อ 11.2)
        placed_vars[u.uid] = lits
        if lits:
            model.Add(sum(lits) <= 1)
            hours = sum(m.length for m in u.members)
            objective.append(1000 * hours * sum(lits))

    for key, lits in cells.items():
        if len(lits) > 1:
            model.Add(sum(lits) <= 1)

    room_lits: dict[tuple, dict] = defaultdict(dict)  # (หน่วย, วัน, เริ่ม) → {ห้อง: ตัวแปร} (สมาชิกคนแรก)
    for (uid, mi, kind, r, d, s), w in wvars.items():
        if mi == 0 and kind == "r":
            room_lits[(uid, d, s)][r] = w

    # ทฤษฎี+ปฏิบัติวันเดียวกัน: ได้เฉพาะเมื่อต่อเนื่อง และให้คะแนนเพิ่มเมื่อเรียนห้องเดิม (ข้อ 11.6 ไม่บังคับ)
    for (sid, d), items in sd_items.items():
        for part in ("theory", "practice"):
            same = [it[0] for it in items if it[3] == part]
            if len(same) > 1:
                model.Add(sum(same) <= 1)  # ภาคเดียวกันห้ามอยู่วันเดียวกัน
        for i, a in enumerate(items):
            for b in items[i + 1:]:
                if a[3] == b[3] or a[0] is b[0]:
                    continue
                if pair_ok(a[1:4], b[1:4], lunch):
                    z = model.NewBoolVar(f"adj_{sid}_{d}_{i}")
                    model.AddImplication(z, a[0])
                    model.AddImplication(z, b[0])
                    # ได้คะแนนเมื่อเรียนห้องเดิมทั้งสองชุด (ข้อ 11.6)
                    rooms_a = room_lits.get((a[4], d, a[1]), {})
                    rooms_b = room_lits.get((b[4], d, b[1]), {})
                    for r in set(rooms_a) | set(rooms_b):
                        if r in rooms_a and r in rooms_b:
                            model.Add(rooms_a[r] == rooms_b[r]).OnlyEnforceIf(z)
                        else:
                            # ห้ามใช้ or กับตัวแปรของ CP-SAT (ประเมินเป็นค่าจริง/เท็จไม่ได้)
                            model.Add((rooms_a[r] if r in rooms_a else rooms_b[r]) == 0).OnlyEnforceIf(z)
                    objective.append(20 * z)
                else:
                    model.Add(a[0] + b[0] <= 1)

    # คาบว่างระหว่างวันเกินกำหนด = ค่าปรับ (ข้อ 4.3, 12.2)
    tp = idx.teaching_periods
    for g in {k[0] for k in group_terms}:
        for d in range(D):
            occ = []
            for p in tp:
                if (g, d, p) in pre_g:
                    occ.append(1)
                else:
                    terms = group_terms.get((g, d, p), [])
                    occ.append(sum(terms) if terms else 0)
            if sum(1 for o in occ if not isinstance(o, int) or o) < 2:
                continue
            for i in range(len(tp)):
                for j in range(i + max_gap + 2, len(tp)):
                    if isinstance(occ[i], int) and occ[i] == 0 or isinstance(occ[j], int) and occ[j] == 0:
                        continue
                    v = model.NewBoolVar(f"gap_{g}_{d}_{i}_{j}")
                    model.Add(v >= occ[i] + occ[j] - 1 - sum(occ[i + 1:j]))
                    objective.append(-60 * v)  # คาบว่างเกินกำหนด (ข้อ 4.3)

    model.Maximize(sum(objective))

    if hint:
        chosen = {uid: (d, s, ch) for uid, (d, s, ch) in hint["placement"].items()}
        for (uid, d, s), x in xvars.items():
            model.AddHint(x, 1 if uid in chosen and chosen[uid][:2] == (d, s) else 0)
        for (uid, mi, kind, r, d, s), w in wvars.items():
            if w is xvars.get((uid, d, s)):
                continue  # ห้องตัวเลือกเดียวใช้ตัวแปร x ร่วมกัน ใส่ hint ไปแล้ว
            val = 0
            if uid in chosen and chosen[uid][:2] == (d, s) and mi < len(chosen[uid][2]):
                room, fld = chosen[uid][2][mi]
                val = int((kind == "r" and room == r) or (kind == "f" and fld == r))
            model.AddHint(w, val)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(1.0, budget)
    solver.parameters.num_workers = 8
    solver.parameters.random_seed = seed % (1 << 31)

    total_hours_all = sum(m.length for u in prep.units for m in u.members)
    best_seen = {"hours": hint["metric"][0] if hint else 0}  # เริ่มจากคำตอบของวิธีละโมบ

    class Progress(cp_model.CpSolverSolutionCallback):
        def on_solution_callback(self):
            # คะแนน = 1000 x ชั่วโมงที่จัดได้ - ค่าปรับ จึงประมาณชั่วโมงที่จัดได้จากคะแนน
            locked_hours = sum(m.length for u in locked for m in u.members)
            found = min(total_hours_all, math.ceil(self.ObjectiveValue() / 1000) + locked_hours)
            best_seen["hours"] = max(best_seen["hours"], found)

    # เธรดเฝ้าดู: รายงานเวลา/ความคืบหน้า และหยุดการค้นหาเมื่อผู้ใช้กดยกเลิก
    import threading

    done = threading.Event()
    started = time.perf_counter()

    def watch():
        while not done.wait(0.25):
            if cancel is not None and cancel.is_set():
                solver.stop_search()
                return
            if progress:
                progress("search", min(0.99, (time.perf_counter() - started) / max(1.0, budget)),
                         {"placed_hours": best_seen["hours"], "total_hours": total_hours_all})

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    try:
        status = solver.Solve(model, Progress())
    finally:
        done.set()
    if cancel is not None and cancel.is_set():
        raise Cancelled()
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None

    placement: dict[int, tuple[int, int, list[Choice]]] = dict(fixed_solver.placement)
    failed = []
    by_uid: dict[int, list[tuple]] = defaultdict(list)
    for key, w in wvars.items():
        by_uid[key[0]].append((key, w))
    for u in prep.units:
        if u.locked:
            continue
        slot = next(((d, s) for (uid, d, s), x in xvars.items() if uid == u.uid and solver.Value(x)), None)
        if slot is None:
            failed.append(u.uid)
            continue
        d, s = slot
        choices: list[Choice] = []
        for mi, m in enumerate(u.members):
            room = fld = None
            for (uid, mi_, kind, r, dd, ss), w in by_uid[u.uid]:
                if mi_ == mi and (dd, ss) == (d, s) and solver.Value(w):
                    if kind == "r":
                        room = r
                    else:
                        fld = r
            choices.append((room, fld))
        placement[u.uid] = (d, s, choices)

    total_hours = sum(m.length for u in prep.units for m in u.members)
    placed = total_hours - sum(m.length for u in prep.units if u.uid in failed for m in u.members)
    return {
        "metric": (placed, 0),
        "placement": placement,
        "failed": failed,
        "iterations": int(solver.NumBranches()),
        "total_hours": total_hours,
        "method": "cpsat",
        "status": "optimal" if status == cp_model.OPTIMAL else "feasible",
        "objective": solver.ObjectiveValue(),
    }


def run_schedule(data: dict, settings: dict, locks: dict | None = None, seed: int | None = None,
                 progress=None, cancel=None) -> dict:
    """จัดตาราง คืน dict ของผลลัพธ์ (ยังไม่ได้ตรวจสอบ ให้ส่งต่อไป validate)

    progress(phase, fraction, info): รายงานความคืบหน้า (prepare | greedy | search | build)
    cancel: threading.Event ถ้าถูก set ระหว่างคำนวณจะยก Cancelled
    """
    started = time.perf_counter()
    report = progress or (lambda *_a, **_k: None)
    report("prepare", 0.0, {})
    idx = DataIndex(data, settings)
    prep = Prepared(idx, locks)
    report("greedy", 0.0, {"total_hours": sum(m.length for u in prep.units for m in u.members)})
    budget = float(settings.get("time_budget_sec") or 20)
    seed = seed if seed is not None else random.randrange(1 << 30)

    # คำตอบตั้งต้นจากวิธีละโมบ (ใช้เวลาส่วนน้อย ที่เหลือให้ CP-SAT)
    use_cp = settings.get("solver", "cpsat") == "cpsat"
    greedy_budget = min(1.5, budget / 8) if use_cp else budget / 2
    best = _greedy(prep, True, greedy_budget, seed, cancel)
    if best["metric"][0] < best["total_hours"]:
        relaxed = _greedy(prep, False, greedy_budget, seed + 1, cancel)
        if relaxed["metric"][0] > best["metric"][0]:
            best = relaxed

    if use_cp:
        remaining = budget - (time.perf_counter() - started)
        report("search", 0.0, {"placed_hours": best["metric"][0], "total_hours": best["total_hours"]})
        cp = _cpsat(prep, max(2.0, remaining), seed, best, cancel, report)
        if cp is not None and cp["metric"][0] >= best["metric"][0]:
            best = cp

    report("build", 1.0, {"placed_hours": best["metric"][0], "total_hours": best["total_hours"]})
    # สร้างผลลัพธ์จากคำตอบที่ดีที่สุด
    solver = Solver(prep, random.Random(seed))
    units = {u.uid: u for u in prep.units}
    for uid, (d, s, choices) in best["placement"].items():
        solver.place(units[uid], d, s, choices)

    assignments = []
    for uid, (d, s, choices) in sorted(best["placement"].items()):
        u = units[uid]
        for mi, (m, (room, fld)) in enumerate(zip(u.members, choices)):
            assignments.append({
                "section_id": m.sid, "block_index": m.bidx, "unit_key": u.key, "part": m.part, "kind": m.kind,
                "day": d, "start": s, "length": m.length, "room": room, "field": fld,
                "locked": u.locked and mi in u.fixed_rooms,
                "course_code": m.course_code, "course_name": m.course_name,
                "teacher_codes": list(m.teachers), "group_codes": list(m.groups),
            })

    gap_violations = sum(1 for occ in solver.g_day.values() if occ and not solver.gap_ok(occ))
    unplaced = list(prep.unplaced)
    for uid in best["failed"]:
        u = units[uid]
        reason, factor = solver.diagnose(u, enforce_gap=False)
        for m in u.members:
            unplaced.append({
                "section_id": m.sid, "block_index": m.bidx, "course_code": m.course_code,
                "course_name": m.course_name, "hours": m.length, "part": m.part, "factor": factor,
                "group_codes": list(m.groups), "teacher_codes": list(m.teachers), "reason": reason,
            })

    overload = [
        {"teacher_code": t, "teacher_name": idx.teacher_name(t), "hours": h, "capacity": prep.teacher_capacity[t]}
        for t, h in prep.teacher_load.items() if h > prep.teacher_capacity[t]
    ]
    return {
        "assignments": assignments,
        "unplaced": unplaced,
        "notices": prep.notices,
        "skipped": prep.skipped,
        "relaxed_gap": gap_violations > 0,
        "stats": {
            "total_hours": best["total_hours"],
            "placed_hours": best["metric"][0],
            "units": len(prep.units),
            "iterations": best["iterations"],
            "method": best["method"],
            "solver_status": best.get("status", ""),
            "duration_ms": int((time.perf_counter() - started) * 1000),
            "locks_kept": sum(1 for a in assignments if a["locked"]),
            "locks_dropped": prep.lock_dropped,
            "teacher_overload": overload,
            "gap_violations": gap_violations,
            "adjacent_pairs": sum(
                1 for slots in solver.sec_slots.values() for i, a in enumerate(slots) for b in slots[i + 1:] if pair_ok(a, b, idx.lunch)
            ),
            "half_mismatch": sum(solver.half_mismatch(units[uid], s) for uid, (_d, s, _c) in best["placement"].items()),
            "seed": seed,
        },
    }
