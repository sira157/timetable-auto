"""ตัวช่วยกลาง: การตั้งค่าเงื่อนไข, การอ่านข้อมูลทั้งหมดเป็น dict, และการจำแนกรายวิชา"""

import copy
import hashlib
import json
import math
import re
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AppSetting, BusyTime, Course, Room, Section, StudentGroup, Teacher

DEFAULT_SETTINGS_FILE = Path(__file__).with_name("default_settings.json")

CREDIT_RE = re.compile(r"(\d+)\s*\(\s*(\d+)\s*-\s*(\d+)\s*-\s*(\d+)\s*\)")
YEAR_TOKEN_RE = re.compile(r"^(?:ทั้งหมด\s*)?(?:ปี|ชั้นปี)\s*(\d+)$")

KIND_LABEL = {"meeting": "ประชุม", "activity": "กิจกรรม", "unavailable": "ไม่ว่าง", "advisor": "พบอาจารย์ที่ปรึกษา"}


# ---------- การตั้งค่า ----------


def default_settings() -> dict:
    return json.loads(DEFAULT_SETTINGS_FILE.read_text(encoding="utf-8"))


def load_settings(db: Session) -> dict:
    settings = default_settings()
    row = db.get(AppSetting, "schedule_settings")
    if row:
        try:
            settings.update(json.loads(row.value))
        except ValueError:
            pass
    return settings


def save_settings(db: Session, settings: dict) -> None:
    row = db.get(AppSetting, "schedule_settings")
    text = json.dumps(settings, ensure_ascii=False)
    if row:
        row.value = text
    else:
        db.add(AppSetting(key="schedule_settings", value=text))


def _minutes(hhmm: str) -> int | None:
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", str(hhmm or "").strip())
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2))


def validate_settings(settings: dict) -> list[str]:
    """คืนรายการปัญหาของการตั้งค่า (ว่าง = ถูกต้อง)"""
    problems: list[str] = []
    days = settings.get("days") or []
    periods = settings.get("periods") or []
    if not days:
        problems.append("ยังไม่ได้กำหนดวันที่เปิดสอน")
    if not periods:
        problems.append("ยังไม่ได้กำหนดคาบเรียน")
    prev_end = None
    for i, p in enumerate(periods, start=1):
        if p.get("no") != i:
            problems.append(f"ลำดับคาบไม่ต่อเนื่องที่คาบ {i}")
        s, e = _minutes(p.get("start")), _minutes(p.get("end"))
        if s is None or e is None:
            problems.append(f"เวลาของคาบ {i} ไม่ถูกต้อง (ใช้รูปแบบ 08:00)")
            continue
        if e <= s:
            problems.append(f"คาบ {i} เวลาสิ้นสุดต้องหลังเวลาเริ่ม")
        if prev_end is not None and s < prev_end:
            problems.append(f"คาบ {i} เริ่มก่อนคาบก่อนหน้าจบ")
        prev_end = e
    n = len(periods)
    for lp in settings.get("lunch_periods") or []:
        if not (1 <= int(lp) <= n):
            problems.append(f"คาบพักกลางวัน {lp} อยู่นอกช่วงคาบที่มี")
    if int(settings.get("max_block") or 0) < 1:
        problems.append("จำนวนคาบติดกันสูงสุดต้องมากกว่า 0")
    lunch_set = {int(x) for x in settings.get("lunch_periods") or []}
    fixed = list(settings.get("common_blocks") or [])
    if settings.get("admin_meeting"):
        fixed.append(settings["admin_meeting"])
    for b in fixed:
        name = b.get("name") or "ช่วงเวลาที่กำหนด"
        try:
            day, start, end = int(b.get("day", -1)), int(b.get("start", 0)), int(b.get("end", 0))
        except (TypeError, ValueError):
            problems.append(f"{name}: วันหรือคาบไม่ถูกต้อง")
            continue
        if not (0 <= day < len(days)) or not (1 <= start <= end <= n):
            problems.append(f"{name}: วันหรือคาบไม่ถูกต้อง")
    fe = settings.get("free_elective") or {}
    if fe:
        if not (0 <= int(fe.get("day", -1)) < len(days)):
            problems.append("วันของวิชาเลือกเสรีไม่ถูกต้อง")
        if not (1 <= int(fe.get("start", 0)) <= int(fe.get("end", 0)) <= n):
            problems.append("ช่วงคาบของวิชาเลือกเสรีไม่ถูกต้อง")
        else:
            lunch = {int(x) for x in settings.get("lunch_periods") or []}
            if any(p in lunch for p in range(int(fe["start"]), int(fe["end"]) + 1)):
                problems.append("ช่วงคาบของวิชาเลือกเสรีทับเวลาพักกลางวัน")
    return problems


# ---------- การอ่านข้อมูล ----------


def _row(obj, fields) -> dict:
    return {f: copy.deepcopy(getattr(obj, f)) for f in fields}


TEACHER_FIELDS = ["id", "code", "name", "is_admin", "is_excluded", "note"]
GROUP_FIELDS = ["id", "code", "name", "year", "size", "homeroom", "advisor", "is_excluded"]
ROOM_FIELDS = ["id", "name", "building", "kind", "capacity", "sports"]
COURSE_FIELDS = [
    "id", "code", "name", "credits", "category", "combined", "elective_set",
    "free_elective", "venue", "sport", "hours", "is_excluded",
]
SECTION_FIELDS = ["id", "course_code", "group_codes", "teacher_codes", "places", "note"]
BUSY_FIELDS = ["id", "kind", "name", "day", "start", "end", "teacher_codes", "group_codes"]


def load_dataset(db: Session) -> dict:
    def all_of(model, fields, order):
        return [_row(o, fields) for o in db.scalars(select(model).order_by(order)).all()]

    return {
        "teachers": all_of(Teacher, TEACHER_FIELDS, Teacher.code),
        "groups": all_of(StudentGroup, GROUP_FIELDS, StudentGroup.code),
        "rooms": all_of(Room, ROOM_FIELDS, Room.name),
        "courses": all_of(Course, COURSE_FIELDS, Course.code),
        "sections": all_of(Section, SECTION_FIELDS, Section.id),
        "busy": all_of(BusyTime, BUSY_FIELDS, BusyTime.id),
    }


def dataset_hash(data: dict, settings: dict) -> str:
    stripped = {}
    for key, rows in data.items():
        stripped[key] = [{k: v for k, v in r.items() if k != "id" or key == "sections"} for r in rows]
    text = json.dumps({"data": stripped, "settings": settings}, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ---------- การจำแนกรายวิชา ----------


def norm(text: str) -> str:
    return re.sub(r"\s+", "", str(text or "")).lower()


def parse_credits(text: str):
    """คืน (หน่วยกิต, ทฤษฎี, ปฏิบัติ, ศึกษาเอง) หรือ None"""
    m = CREDIT_RE.search(str(text or ""))
    if not m:
        return None
    return tuple(int(x) for x in m.groups())


def split_hours(hours: int, max_block: int) -> list[int]:
    """แบ่งชั่วโมงเป็นชุดคาบติดกัน ชุดละไม่เกิน max_block เช่น 4 → [2,2], 5 → [3,2]"""
    if hours <= 0:
        return []
    n = math.ceil(hours / max_block)
    base, extra = divmod(hours, n)
    return [base + 1] * extra + [base] * (n - extra)


def course_hours(course: dict) -> tuple[int, int] | None:
    """(ชม.ทฤษฎี, ชม.ปฏิบัติ) ต่อสัปดาห์ จากหน่วยกิต น(ท-ป-ศ) หรือจากช่องชั่วโมง/สัปดาห์ (นับเป็นทฤษฎี+ปฏิบัติรวม)"""
    cr = parse_credits(course.get("credits"))
    if cr is not None:
        return cr[1], cr[2]
    h = int(course.get("hours") or 0)
    return (h, 0) if h > 0 else None


def is_internship(course: dict, settings: dict) -> bool:
    """วิชาฝึกสอนทั้งภาคเรียน: ตรงรหัสที่ตั้งไว้ หรือชื่อตรงคำค้นและไม่มีชั่วโมงเรียนรายสัปดาห์"""
    codes = {norm(c) for c in settings.get("internship_codes") or []}
    if norm(course.get("code")) in codes:
        return True
    name = course.get("name") or ""
    if not any(k and k in name for k in settings.get("internship_keywords") or []):
        return False
    return course_hours(course) is None


def is_field_course(course: dict, settings: dict) -> bool:
    return (course.get("category") or "").strip() in set(settings.get("field_categories") or [])


def is_computer_course(course: dict, settings: dict) -> bool:
    return (course.get("category") or "").strip() in set(settings.get("computer_categories") or [])


def effective_busy(data: dict, settings: dict) -> list[dict]:
    """เวลาที่ไม่ว่างทั้งหมด = จากไฟล์ข้อมูล + ช่วงเวลาที่กำหนดในการตั้งค่า
    (พบอาจารย์ที่ปรึกษา / กิจกรรม ของทุกกลุ่ม และประชุมของอาจารย์ในชีตฝ่ายบริหาร)"""
    out = [dict(b) for b in data["busy"]]
    years = sorted({int(g.get("year") or 0) for g in data["groups"] if not g.get("is_excluded")})
    all_groups = [f"ปี {y}" for y in years]
    for cb in settings.get("common_blocks") or []:
        advisors: list[str] = []
        if cb.get("kind") == "advisor":
            advisors = sorted({
                g["advisor"] for g in data["groups"] if g.get("advisor") and not g.get("is_excluded")
            })
        out.append({
            "id": None, "kind": "advisor" if cb.get("kind") == "advisor" else "activity",
            "name": cb.get("name") or KIND_LABEL.get(cb.get("kind"), "กิจกรรม"),
            "day": int(cb["day"]), "start": int(cb["start"]), "end": int(cb["end"]),
            "teacher_codes": advisors, "group_codes": all_groups,
        })
    am = settings.get("admin_meeting")
    if am:
        admins = [t["code"] for t in data["teachers"] if t.get("is_admin") and not t.get("is_excluded")]
        if admins:
            out.append({
                "id": None, "kind": "meeting", "name": am.get("name") or "ประชุมฝ่ายบริหาร",
                "day": int(am["day"]), "start": int(am["start"]), "end": int(am["end"]),
                "teacher_codes": admins, "group_codes": [],
            })
    return out


def expand_groups(codes: list[str], groups_by_code: dict, year_groups: dict) -> tuple[list[str], list[str]]:
    """แปลงรหัสกลุ่ม (รองรับ "ปี 1" = ทุกกลุ่มของชั้นปี 1) คืน (รหัสที่พบ, รหัสที่ไม่พบ)"""
    found: list[str] = []
    missing: list[str] = []
    for raw in codes or []:
        code = str(raw).strip()
        if not code:
            continue
        m = YEAR_TOKEN_RE.match(code)
        if m:
            year = int(m.group(1))
            if year_groups.get(year):
                found.extend(year_groups[year])
            else:
                missing.append(code)
        elif code in groups_by_code:
            found.append(code)
        else:
            missing.append(code)
    seen = set()
    unique = [c for c in found if not (c in seen or seen.add(c))]
    return unique, missing


def course_sport(course: dict, field_rooms: list[dict]) -> str:
    """กีฬาของวิชา: ใช้ค่าที่ระบุไว้ หรือหาจากชื่อวิชาที่มีชื่อกีฬาที่สนามรองรับ"""
    if (course.get("sport") or "").strip():
        return course["sport"].strip()
    name = norm(course.get("name"))
    sports = sorted({s for r in field_rooms for s in (r.get("sports") or []) if s}, key=len, reverse=True)
    for s in sports:
        if norm(s) and norm(s) in name:
            return s
    return ""


def field_candidates(course: dict, field_rooms: list[dict]) -> list[str]:
    """จุดสนามที่ใช้ได้ของวิชา ตามข้อ 9.1–9.3"""
    sport = course_sport(course, field_rooms)
    parts = [p.strip() for p in re.split(r"[,，、]", course.get("venue") or "") if p.strip()]

    def supports(r):
        return not sport or any(norm(s) == norm(sport) for s in r.get("sports") or [])

    result: list[str] = []
    for part in parts:
        exact = [r for r in field_rooms if norm(r["name"]) == norm(part)]
        if exact:
            result += [r["name"] for r in exact]
            continue
        within = [
            r for r in field_rooms
            if norm(r.get("building")) == norm(part) or norm(part) in norm(r["name"])
        ]
        matching = [r for r in within if supports(r)]
        result += [r["name"] for r in (matching or within)]
    if not result and sport:
        result = [r["name"] for r in field_rooms if supports(r)]
    seen = set()
    return [x for x in result if not (x in seen or seen.add(x))]


class DataIndex:
    """ดัชนีของข้อมูลทั้งหมดที่ใช้ร่วมกันระหว่างตัวจัดตาราง ตัวตรวจข้อมูล และตัวตรวจผล"""

    def __init__(self, data: dict, settings: dict):
        self.data = data
        self.settings = settings
        self.teachers = {t["code"]: t for t in data["teachers"]}
        self.groups = {g["code"]: g for g in data["groups"]}
        self.rooms = {r["name"]: r for r in data["rooms"]}
        self.courses = {c["code"]: c for c in data["courses"]}
        self.field_rooms = [r for r in data["rooms"] if r.get("kind") == "field"]
        self.year_groups: dict[int, list[str]] = {}
        for g in data["groups"]:
            if not g.get("is_excluded"):
                self.year_groups.setdefault(int(g.get("year") or 0), []).append(g["code"])
        for codes in self.year_groups.values():
            codes.sort()
        self.n_days = len(settings["days"])
        self.n_periods = len(settings["periods"])
        self.lunch = {int(x) for x in settings.get("lunch_periods") or []}
        self.teaching_periods = [p for p in range(1, self.n_periods + 1) if p not in self.lunch]
        self.max_block = int(settings.get("max_block") or 3)
        self.homeroom_categories = set(settings.get("homeroom_categories") or [])
        self.combined_rooms = [r for r in settings.get("combined_rooms") or [] if r in self.rooms]

    def section_groups(self, section: dict) -> tuple[list[str], list[str]]:
        return expand_groups(section.get("group_codes") or [], self.groups, self.year_groups)

    def section_teachers(self, section: dict) -> tuple[list[str], list[str]]:
        found, missing = [], []
        for raw in section.get("teacher_codes") or []:
            code = str(raw).strip()
            if not code:
                continue
            (found if code in self.teachers else missing).append(code)
        return found, missing

    def section_year(self, groups: list[str]) -> int | None:
        years = {int(self.groups[g].get("year") or 0) for g in groups if g in self.groups}
        return min(years) if years else None

    def section_years(self, groups: list[str]) -> set[int]:
        return {int(self.groups[g].get("year") or 0) for g in groups if g in self.groups}

    def elective_sets(self) -> dict[tuple[int, str], list[dict]]:
        """ชุดการเปิดสอนที่ต้องเรียนเวลาเดียวกัน: (ปี, ชื่อชุด) → รายการ section

        * กลุ่มวิชาเลือกที่มีมากกว่า 1 วิชาในชั้นปีเดียวกัน (ข้อ 6.1)
        * วิชาเรียนรวมที่แยกห้องตามกลุ่ม (มีหลาย section ในชั้นปีเดียวกัน) ต้องเรียนพร้อมกันทั้งชั้นปี (ข้อ 5.1)
        """
        buckets: dict[tuple[int, str], list[dict]] = {}
        for s in self.data["sections"]:
            c = self.courses.get(s["course_code"])
            if not c or c.get("free_elective"):
                continue
            groups, _ = self.section_groups(s)
            year = self.section_year(groups)
            if year is None:
                continue
            if (c.get("elective_set") or "").strip():
                buckets.setdefault((year, c["elective_set"].strip()), []).append(s)
            elif c.get("combined"):
                buckets.setdefault((year, f"เรียนรวม {c['code']}"), []).append(s)
        out = {}
        for k, v in buckets.items():
            if k[1].startswith("เรียนรวม "):
                if len(v) >= 2:
                    out[k] = v
            elif len({s["course_code"] for s in v}) >= 2:
                out[k] = v
        return out

    def section_places(self, section: dict) -> tuple[list[str], list[str]] | None:
        """สถานที่ที่ข้อมูลระบุไว้: (ห้อง, โรงยิม/สนาม) หรือ None ถ้าไม่ได้ระบุ"""
        names = [p for p in section.get("places") or [] if p in self.rooms]
        if not names:
            return None
        rooms = [p for p in names if self.rooms[p].get("kind") != "field"]
        fields = [p for p in names if self.rooms[p].get("kind") == "field"]
        return rooms, fields

    def teacher_name(self, code: str) -> str:
        t = self.teachers.get(code)
        return t["name"] if t else code

    def group_name(self, code: str) -> str:
        g = self.groups.get(code)
        return g["name"] if g else code
