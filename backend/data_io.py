"""นำเข้า/ส่งออกข้อมูล (Excel .xlsx, CSV และ JSON)

นิยามคอลัมน์ในไฟล์นี้เป็น "รูปแบบไฟล์" เท่านั้น ข้อมูลจริงต้องอยู่ในไฟล์ที่ผู้ใช้นำเข้า
"""

from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from typing import Any

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import BusyTime, Course, Room, Section, StudentGroup, Teacher
from .textnorm import match_key, norm_text

# (คีย์ข้อมูล, ชื่อคอลัมน์ภาษาไทย, ชนิด)
SHEETS: dict[str, dict[str, Any]] = {
    "teachers": {"title": "อาจารย์", "model": Teacher, "key": "code", "columns": [
        ("code", "รหัสอาจารย์", "str"), ("name", "ชื่อ-สกุล", "str"), ("is_admin", "ฝ่ายบริหาร", "bool"),
        ("is_excluded", "ไม่ลงทะเบียน", "bool"), ("note", "หมายเหตุ", "str"),
    ]},
    "groups": {"title": "กลุ่มเรียน", "model": StudentGroup, "key": "code", "columns": [
        ("code", "รหัสกลุ่ม", "str"), ("name", "ชื่อกลุ่ม", "str"), ("year", "ชั้นปี", "int"),
        ("size", "จำนวนนักศึกษา", "int"), ("homeroom", "ห้องประจำ", "str"),
        ("advisor", "อาจารย์ที่ปรึกษา (รหัส)", "str"), ("is_excluded", "ไม่ลงทะเบียน", "bool"),
    ]},
    "rooms": {"title": "ห้องและสนาม", "model": Room, "key": "name", "columns": [
        ("name", "ชื่อห้อง/จุด", "str"), ("building", "อาคาร/สนาม", "str"), ("kind", "ประเภท", "roomkind"),
        ("capacity", "ความจุ", "int"), ("sports", "กีฬาที่รองรับ", "list"),
    ]},
    "courses": {"title": "รายวิชา", "model": Course, "key": "code", "columns": [
        ("code", "รหัสวิชา", "str"), ("name", "ชื่อวิชา", "str"), ("credits", "หน่วยกิต น(ท-ป-ศ)", "str"),
        ("category", "หมวดวิชา", "str"), ("combined", "เรียนรวม", "bool"), ("elective_set", "กลุ่มวิชาเลือก", "str"),
        ("free_elective", "วิชาเลือกเสรี", "bool"), ("venue", "สถานที่ใช้", "str"), ("sport", "กีฬา", "str"),
        ("hours", "ชั่วโมง/สัปดาห์", "int"), ("is_excluded", "ไม่ลงทะเบียน", "bool"),
    ]},
    "sections": {"title": "การเปิดสอน", "model": Section, "key": None, "columns": [
        ("course_code", "รหัสวิชา", "str"), ("group_codes", "กลุ่มเรียน", "list"),
        ("teacher_codes", "ผู้สอน (รหัส)", "list"), ("places", "สถานที่ที่ใช้", "list"), ("note", "หมายเหตุ", "str"),
    ]},
    "busy": {"title": "เวลาที่ไม่ว่าง", "model": BusyTime, "key": None, "columns": [
        ("kind", "ประเภท", "busykind"), ("name", "ชื่อรายการ", "str"), ("day", "วัน", "day"),
        ("start", "คาบเริ่ม", "int"), ("end", "คาบสิ้นสุด", "int"),
        ("teacher_codes", "ผู้สอน (รหัส)", "list"), ("group_codes", "กลุ่มเรียน", "list"),
    ]},
}

ROOM_KIND = {"ห้องเรียน": "classroom", "ห้องคอมพิวเตอร์": "computer", "ห้องประชุม": "meeting", "สนาม": "field",
             "โรงยิม": "field", "สนาม/โรงยิม": "field", "classroom": "classroom", "computer": "computer",
             "meeting": "meeting", "field": "field"}
ROOM_KIND_LABEL = {"classroom": "ห้องเรียน", "computer": "ห้องคอมพิวเตอร์", "meeting": "ห้องประชุม", "field": "สนาม/โรงยิม"}
OPTIONAL_LABELS = {"ฝ่ายบริหาร", "ชั่วโมง/สัปดาห์", "สถานที่ที่ใช้"}  # คอลัมน์ที่ไม่มีในแบบฟอร์มรุ่นเก่าได้
ADMIN_SHEET = "ฝ่ายบริหาร"  # ชีตรายชื่ออาจารย์ฝ่ายบริหาร (ประชุมวันอังคารคาบ 1–4)
BUSY_KIND = {"ประชุม": "meeting", "กิจกรรม": "activity", "ไม่ว่าง": "unavailable", "meeting": "meeting",
             "activity": "activity", "unavailable": "unavailable"}
BUSY_KIND_LABEL = {"meeting": "ประชุม", "activity": "กิจกรรม", "unavailable": "ไม่ว่าง"}
TRUE_WORDS = {"1", "true", "yes", "y", "ใช่", "รวม", "x", "✓", "/", "เรียนรวม", "เลือกเสรี", "ไม่ลงทะเบียน"}


class ImportError_(ValueError):
    pass


def coerce(value, typ: str, days: list[str], *, excel: bool):
    if value is None:
        value = ""
    if typ == "str":
        if isinstance(value, float) and value.is_integer():
            value = int(value)
        return norm_text(value)
    if typ == "int":
        if value == "" or value is None:
            return 0
        try:
            return int(float(norm_text(value)))
        except ValueError:
            raise ImportError_(f"ค่า \"{value}\" ต้องเป็นตัวเลข")
    if typ == "bool":
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in TRUE_WORDS
    if typ == "list":
        if isinstance(value, list):
            return [norm_text(x) for x in value if norm_text(x)]
        return [norm_text(x) for x in re.split(r"[,，、;\n]", str(value)) if norm_text(x)]
    if typ == "roomkind":
        v = norm_text(value) or "ห้องเรียน"
        if v not in ROOM_KIND:
            raise ImportError_(f"ประเภทห้อง \"{v}\" ไม่รู้จัก (ใช้ ห้องเรียน / ห้องคอมพิวเตอร์ / ห้องประชุม / สนาม / โรงยิม)")
        return ROOM_KIND[v]
    if typ == "busykind":
        v = norm_text(value) or "ไม่ว่าง"
        if v not in BUSY_KIND:
            raise ImportError_(f"ประเภท \"{v}\" ไม่รู้จัก (ใช้ ประชุม / กิจกรรม / ไม่ว่าง)")
        return BUSY_KIND[v]
    if typ == "day":
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            n = int(value)
            n = n - 1 if excel else n  # Excel: จันทร์ = 1, JSON: จันทร์ = 0
            if not 0 <= n < len(days):
                raise ImportError_(f"วัน \"{value}\" ไม่ถูกต้อง")
            return n
        v = norm_text(value).removeprefix("วัน").strip()
        if v.isdigit():
            return coerce(int(v), "day", days, excel=excel)
        if v in days:
            return days.index(v)
        raise ImportError_(f"วัน \"{value}\" ไม่ถูกต้อง")
    raise ImportError_(f"ชนิดข้อมูล {typ} ไม่รู้จัก")


def normalize_rows(entity: str, rows: list[dict], days: list[str], *, excel: bool) -> list[dict]:
    spec = SHEETS[entity]
    out = []
    errors = []
    for i, raw in enumerate(rows, start=2 if excel else 1):
        try:
            row = {}
            for key, _label, typ in spec["columns"]:
                row[key] = coerce(raw.get(key), typ, days, excel=excel)
            if entity == "busy":
                if row["end"] < row["start"]:
                    raise ImportError_("คาบสิ้นสุดต้องไม่น้อยกว่าคาบเริ่ม")
            k = spec["key"]
            if k and not row[k]:
                raise ImportError_(f"ไม่มี{dict((c[0], c[1]) for c in spec['columns'])[k]}")
            if entity == "sections" and not row["course_code"]:
                raise ImportError_("ไม่มีรหัสวิชา")
            if entity in ("teachers", "courses", "groups") and not row["name"]:
                row["name"] = row["code"]
            out.append(row)
        except ImportError_ as e:
            errors.append(f"{spec['title']} แถว {i}: {e}")
    k = spec["key"]
    if k:
        seen = set()
        for r in out:
            if r[k] in seen:
                errors.append(f"{spec['title']}: {r[k]} ซ้ำกัน")
            seen.add(r[k])
    if errors:
        raise ImportError_("\n".join(errors[:30]))
    return out


def parse_json(content: bytes, days: list[str]) -> dict[str, list[dict]]:
    try:
        payload = json.loads(content.decode("utf-8-sig"))
    except (ValueError, UnicodeDecodeError):
        raise ImportError_("ไฟล์ JSON ไม่ถูกต้อง")
    if isinstance(payload, dict) and "data" in payload and isinstance(payload["data"], dict):
        payload = payload["data"]
    if not isinstance(payload, dict):
        raise ImportError_("ไฟล์ JSON ต้องเป็นออบเจกต์ที่มี teachers, groups, rooms, courses, sections, busy")
    result = {}
    errors = []
    for entity in SHEETS:
        try:
            result[entity] = normalize_rows(entity, payload.get(entity) or [], days, excel=False)
        except ImportError_ as e:
            errors.append(str(e))
    admins = {norm_text(x) for x in payload.get("admins") or [] if norm_text(x)}
    _mark_admins(result, admins, errors)
    if errors:
        raise ImportError_("\n".join(errors))
    return result


def _mark_admins(result: dict, admins: set[str], errors: list[str]) -> None:
    """กำหนดอาจารย์ฝ่ายบริหารจากชีต/รายการ ฝ่ายบริหาร"""
    if not admins or "teachers" not in result:
        return
    codes = {match_key(t["code"]) for t in result["teachers"]}
    for code in sorted(a for a in admins if match_key(a) not in codes):
        errors.append(f"{ADMIN_SHEET}: ไม่พบรหัสอาจารย์ {code} ในชีตอาจารย์")
    wanted = {match_key(a) for a in admins}
    for t in result["teachers"]:
        if match_key(t["code"]) in wanted:
            t["is_admin"] = True


def parse_xlsx(content: bytes, days: list[str]) -> dict[str, list[dict]]:
    try:
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception:
        raise ImportError_("เปิดไฟล์ Excel ไม่ได้ กรุณาใช้ไฟล์ .xlsx จากแบบฟอร์ม")
    from .curriculum_import import is_curriculum_workbook, parse_curriculum

    if is_curriculum_workbook(wb):
        # ไฟล์ "ข้อมูลหลักสูตร" แยกชีตตามชั้นปี
        raw, warnings = parse_curriculum(wb)
        result = {}
        errors = []
        for entity in SHEETS:
            if entity not in raw:
                continue
            try:
                result[entity] = normalize_rows(entity, raw[entity], days, excel=False)
            except ImportError_ as e:
                errors.append(str(e))
        if errors:
            raise ImportError_("\n".join(errors))
        result["_warnings"] = warnings
        return result
    result = {}
    errors = []
    for entity, spec in SHEETS.items():
        if spec["title"] not in wb.sheetnames:
            errors.append(f"ไม่พบชีต \"{spec['title']}\"")
            continue
        ws = wb[spec["title"]]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            result[entity] = []
            continue
        header = [str(h).strip() if h is not None else "" for h in rows[0]]
        label_to_key = {label: key for key, label, _ in spec["columns"]}
        missing = [label for label in label_to_key if label not in header and label not in OPTIONAL_LABELS]
        if missing:
            errors.append(f"ชีต \"{spec['title']}\" ไม่มีคอลัมน์: {', '.join(missing)}")
            continue
        dict_rows = []
        for r in rows[1:]:
            if r is None or all(v is None or str(v).strip() == "" for v in r):
                continue
            dict_rows.append({label_to_key[h]: v for h, v in zip(header, r) if h in label_to_key})
        try:
            result[entity] = normalize_rows(entity, dict_rows, days, excel=True)
        except ImportError_ as e:
            errors.append(str(e))
    if ADMIN_SHEET in wb.sheetnames:
        rows = list(wb[ADMIN_SHEET].iter_rows(values_only=True))
        header = [str(h).strip() if h is not None else "" for h in (rows[0] if rows else [])]
        if "รหัสอาจารย์" not in header:
            errors.append(f"ชีต \"{ADMIN_SHEET}\" ต้องมีคอลัมน์ รหัสอาจารย์")
        else:
            col = header.index("รหัสอาจารย์")
            admins = {
                coerce(r[col], "str", days, excel=True) for r in rows[1:] if r and col < len(r) and r[col] is not None
            }
            _mark_admins(result, {a for a in admins if a}, errors)
    if errors:
        raise ImportError_("\n".join(errors))
    return result


CSV_ALIASES = {
    "teachers": ["teachers", "teacher"], "groups": ["groups", "group"], "rooms": ["rooms", "room"],
    "courses": ["courses", "course"], "sections": ["sections", "section"], "busy": ["busy"],
}
MAX_ZIP_FILES = 20
MAX_ZIP_BYTES = 10 * 1024 * 1024


def _decode_csv(content: bytes) -> str:
    """CSV จาก Excel ภาษาไทยอาจเป็น UTF-8 (มี/ไม่มี BOM) หรือ TIS-620 (cp874)"""
    for enc in ("utf-8-sig", "cp874"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ImportError_("อ่านไฟล์ CSV ไม่ได้ (บันทึกเป็น CSV UTF-8)")


def _csv_entity(filename: str, header: list[str]) -> str | None:
    """ระบุชนิดข้อมูลของไฟล์ CSV จากชื่อไฟล์ หรือจากหัวคอลัมน์"""
    name = filename.lower()
    if ADMIN_SHEET in filename:
        return "admins"
    for entity, spec in SHEETS.items():
        if spec["title"] in filename or any(a in name for a in CSV_ALIASES[entity]):
            return entity
    hs = set(header)
    best, best_score = None, 0
    for entity, spec in SHEETS.items():
        required = {label for _, label, _ in spec["columns"] if label not in OPTIONAL_LABELS}
        if required <= hs and len(required) > best_score:
            best, best_score = entity, len(required)
    if best:
        return best
    if "รหัสอาจารย์" in hs and len(hs) <= 2:
        return "admins"
    return None


def parse_csv_files(files: list[tuple[str, bytes]], days: list[str]) -> tuple[dict[str, list[dict]], set[str] | None]:
    """อ่านไฟล์ CSV หลายไฟล์ (หรือ .zip ที่มี CSV) คืน (ข้อมูลแยกตามชนิด, รายชื่อฝ่ายบริหาร หรือ None)"""
    expanded: list[tuple[str, bytes]] = []
    for name, content in files:
        if name.lower().endswith(".zip"):
            try:
                zf = zipfile.ZipFile(io.BytesIO(content))
            except zipfile.BadZipFile:
                raise ImportError_(f"เปิดไฟล์ {name} ไม่ได้")
            members = [i for i in zf.infolist() if i.filename.lower().endswith(".csv") and not i.is_dir()]
            if len(members) > MAX_ZIP_FILES or sum(i.file_size for i in members) > MAX_ZIP_BYTES:
                raise ImportError_(f"ไฟล์ {name} ใหญ่เกินไป")
            for info in members:
                fname = info.filename.encode("cp437").decode("utf-8", "ignore") if not info.flag_bits & 0x800 else info.filename
                expanded.append((fname.rsplit("/", 1)[-1], zf.read(info)))
        else:
            expanded.append((name, content))
    if not expanded:
        raise ImportError_("ไม่พบไฟล์ CSV")

    result: dict[str, list[dict]] = {}
    admins: set[str] | None = None
    errors: list[str] = []
    for name, content in expanded:
        try:
            rows = list(csv.reader(io.StringIO(_decode_csv(content))))
        except ImportError_ as e:
            errors.append(f"{name}: {e}")
            continue
        if not rows:
            continue
        header = [h.strip() for h in rows[0]]
        entity = _csv_entity(name, header)
        if entity is None:
            errors.append(f"{name}: ไม่รู้ว่าเป็นข้อมูลชนิดใด (ตั้งชื่อไฟล์ตามแบบฟอร์ม เช่น อาจารย์.csv)")
            continue
        body = [r for r in rows[1:] if any(c.strip() for c in r)]
        if entity == "admins":
            if "รหัสอาจารย์" not in header:
                errors.append(f"{name}: ต้องมีคอลัมน์ รหัสอาจารย์")
                continue
            col = header.index("รหัสอาจารย์")
            admins = {norm_text(r[col]) for r in body if col < len(r) and norm_text(r[col])}
            continue
        spec = SHEETS[entity]
        label_to_key = {label: key for key, label, _ in spec["columns"]}
        missing = [lb for lb in label_to_key if lb not in header and lb not in OPTIONAL_LABELS]
        if missing:
            errors.append(f"{name}: ไม่มีคอลัมน์ {', '.join(missing)}")
            continue
        dict_rows = [{label_to_key[h]: v for h, v in zip(header, r) if h in label_to_key} for r in body]
        try:
            result[entity] = normalize_rows(entity, dict_rows, days, excel=True)
        except ImportError_ as e:
            errors.append(str(e))
    if admins is not None and "teachers" in result:
        _mark_admins(result, admins, errors)
        admins = None
    if errors:
        raise ImportError_("\n".join(errors))
    if not result and admins is None:
        raise ImportError_("ไม่พบข้อมูลในไฟล์")
    return result, admins


def apply_admins(db: Session, codes: set[str]) -> int:
    """อัปเดตรายชื่อฝ่ายบริหารจากไฟล์ ฝ่ายบริหาร.csv ไฟล์เดียว"""
    teachers = db.scalars(select(Teacher)).all()
    known = {match_key(t.code) for t in teachers}
    missing = sorted(c for c in codes if match_key(c) not in known)
    if missing:
        raise ImportError_(f"{ADMIN_SHEET}: ไม่พบรหัสอาจารย์ {', '.join(missing)}")
    wanted = {match_key(c) for c in codes}
    for t in teachers:
        t.is_admin = match_key(t.code) in wanted
    return len(codes)


def link_names(db: Session, parsed: dict[str, list[dict]]) -> None:
    """อ้างอิงข้ามชีตด้วยชื่อที่สะกดต่างกันเล็กน้อย เช่น "ห้องประชุม1" ในการเปิดสอน กับ "ห้องประชุม 1" ในชีตห้อง
    ให้เปลี่ยนเป็นชื่อในชีตหลัก (เทียบแบบไม่สนช่องว่าง ตัวพิมพ์ และเลขไทย) ชื่อที่ไม่พบคงไว้ตามเดิมให้ระบบตรวจแจ้ง"""

    def pool(entity: str, model, attr: str) -> dict[str, str]:
        names = [r[attr] for r in parsed[entity]] if entity in parsed else list(db.scalars(select(getattr(model, attr))).all())
        return {match_key(n): n for n in names if n}

    teachers = pool("teachers", Teacher, "code")
    groups = pool("groups", StudentGroup, "code")
    rooms = pool("rooms", Room, "name")
    courses = pool("courses", Course, "code")

    def one(value: str, names: dict[str, str]) -> str:
        return names.get(match_key(value), value) if value else value

    def many(values: list[str], names: dict[str, str]) -> list[str]:
        return [one(v, names) for v in values or []]

    for r in parsed.get("groups", []):
        r["homeroom"] = one(r.get("homeroom", ""), rooms)
        r["advisor"] = one(r.get("advisor", ""), teachers)
    for r in parsed.get("sections", []):
        r["course_code"] = one(r["course_code"], courses)
        r["group_codes"] = many(r["group_codes"], groups)
        r["teacher_codes"] = many(r["teacher_codes"], teachers)
        r["places"] = many(r.get("places", []), rooms)
    for r in parsed.get("busy", []):
        r["teacher_codes"] = many(r["teacher_codes"], teachers)
        r["group_codes"] = many(r["group_codes"], groups)


def replace_all(db: Session, parsed: dict[str, list[dict]]) -> dict[str, int]:
    """แทนที่ข้อมูลเฉพาะชนิดที่มีในไฟล์ โดยคง id ของรายการที่รหัสเดิมยังอยู่ (บัญชีผู้ใช้ที่ผูกไว้ยังใช้ได้)"""
    link_names(db, parsed)
    counts = {}
    for entity, spec in SHEETS.items():
        if entity not in parsed:
            continue
        model = spec["model"]
        rows = parsed[entity]
        key = spec["key"]
        existing = db.scalars(select(model)).all()
        if key:
            by_key = {getattr(o, key): o for o in existing}
            keep = set()
            for r in rows:
                obj = by_key.get(r[key])
                if obj is None:
                    obj = model(**r)
                    db.add(obj)
                else:
                    for k, v in r.items():
                        setattr(obj, k, v)
                keep.add(r[key])
            for k, obj in by_key.items():
                if k not in keep:
                    db.delete(obj)
        elif entity == "sections":
            # จับคู่ด้วย (รหัสวิชา, กลุ่มเรียน) เพื่อคง id ให้คาบที่ล็อกไว้ยังใช้ได้
            pool: dict[tuple, list] = {}
            for o in sorted(existing, key=lambda o: o.id):
                pool.setdefault((o.course_code, tuple(o.group_codes or [])), []).append(o)
            used = set()
            for r in rows:
                cands = pool.get((r["course_code"], tuple(r["group_codes"])), [])
                obj = cands.pop(0) if cands else None
                if obj is None:
                    db.add(model(**r))
                else:
                    for k, v in r.items():
                        setattr(obj, k, v)
                    used.add(obj.id)
            for o in existing:
                if o.id not in used:
                    db.delete(o)
        else:
            db.execute(delete(model))
            for r in rows:
                db.add(model(**r))
        counts[entity] = len(rows)
        db.flush()
    return counts


def _export_values(spec: dict, row: dict, days: list[str]) -> list:
    values = []
    for key, _label, typ in spec["columns"]:
        v = row.get(key)
        if typ == "list":
            v = ", ".join(v or [])
        elif typ == "bool":
            v = "ใช่" if v else ""
        elif typ == "roomkind":
            v = ROOM_KIND_LABEL.get(v, v)
        elif typ == "busykind":
            v = BUSY_KIND_LABEL.get(v, v)
        elif typ == "day":
            v = days[v] if isinstance(v, int) and 0 <= v < len(days) else v
        values.append(v)
    return values


def csv_zip(days: list[str], data: dict | None = None) -> bytes:
    """แบบฟอร์ม/ข้อมูลเป็นไฟล์ CSV (UTF-8 มี BOM เปิดใน Excel ได้) รวมใน .zip"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for entity, spec in SHEETS.items():
            out = io.StringIO()
            w = csv.writer(out)
            w.writerow([label for _, label, _ in spec["columns"]])
            for row in (data or {}).get(entity, []):
                w.writerow(["" if v is None else v for v in _export_values(spec, row, days)])
            zf.writestr(f"{spec['title']}.csv", "﻿" + out.getvalue())
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["รหัสอาจารย์", "ชื่อ-สกุล"])
        for t in (data or {}).get("teachers", []):
            if t.get("is_admin"):
                w.writerow([t["code"], t["name"]])
        zf.writestr(f"{ADMIN_SHEET}.csv", "﻿" + out.getvalue())
    return buf.getvalue()


def template_workbook(days: list[str], data: dict | None = None) -> bytes:
    """สร้างแบบฟอร์ม Excel (ถ้าส่ง data มาด้วยจะใส่ข้อมูลปัจจุบันลงไป = ส่งออกข้อมูล)"""
    wb = Workbook()
    wb.remove(wb.active)
    head_fill = PatternFill("solid", fgColor="EEF2FF")
    head_font = Font(bold=True, color="3730A3")
    for entity, spec in SHEETS.items():
        ws = wb.create_sheet(spec["title"])
        ws.append([label for _, label, _ in spec["columns"]])
        for cell in ws[1]:
            cell.fill = head_fill
            cell.font = head_font
            cell.alignment = Alignment(vertical="center")
        for col_idx, (_k, label, _t) in enumerate(spec["columns"], start=1):
            ws.column_dimensions[ws.cell(1, col_idx).column_letter].width = max(14, len(label) + 6)
        for row in (data or {}).get(entity, []):
            ws.append(_export_values(spec, row, days))
        ws.freeze_panes = "A2"
    admin_ws = wb.create_sheet(ADMIN_SHEET)
    admin_ws.append(["รหัสอาจารย์", "ชื่อ-สกุล"])
    for cell in admin_ws[1]:
        cell.fill = head_fill
        cell.font = head_font
    admin_ws.column_dimensions["A"].width = 16
    admin_ws.column_dimensions["B"].width = 32
    for t in (data or {}).get("teachers", []):
        if t.get("is_admin"):
            admin_ws.append([t["code"], t["name"]])
    guide = wb.create_sheet("คำอธิบาย", 0)
    lines = [
        "แบบฟอร์มนำเข้าข้อมูล ระบบจัดตารางสอนอัตโนมัติ",
        "",
        "• ห้ามเปลี่ยนชื่อชีตและชื่อคอลัมน์แถวแรก",
        "• หน่วยกิตเขียนรูปแบบ น(ท-ป-ศ) เช่น 3(2-2-5)",
        "• คอลัมน์ที่มีหลายค่า (กลุ่มเรียน ผู้สอน กีฬา) คั่นด้วยเครื่องหมายจุลภาค เช่น 1/1, 1/2",
        "• กลุ่มเรียนพิมพ์ \"ปี 1\" แทนทุกกลุ่มในชั้นปีที่ 1 ได้ (ใช้กับวิชาเรียนรวม/วิชาเลือก)",
        "• ช่องใช่/ไม่ใช่ (เรียนรวม วิชาเลือกเสรี ไม่ลงทะเบียน) พิมพ์ \"ใช่\" หรือเว้นว่าง",
        "• ประเภทห้อง: ห้องเรียน / ห้องคอมพิวเตอร์ / ห้องประชุม / สนาม / โรงยิม — สนามและโรงยิมตั้งชื่อเป็นจุด เช่น สนามฟุตบอล จุดที่ 1",
        "• ชีตฝ่ายบริหาร: รายชื่ออาจารย์ที่ประชุมวันอังคารคาบ 1–4 (ไม่จัดสอนในช่วงนั้น)",
        "• วิชาหมวดนวัตกรรมและเทคโนโลยีเรียนในห้องคอมพิวเตอร์ วิชากีฬาจองห้องเรียนและโรงยิม/สนามพร้อมกัน",
        "• สถานที่ใช้: ใส่ชื่อจุดหรือชื่อสนาม หลายจุดคั่นด้วยจุลภาค (ระบบจะเลือกจุดที่ว่าง)",
        "• เวลาที่ไม่ว่าง: ประเภท ประชุม / กิจกรรม / ไม่ว่าง, วันเป็นชื่อวัน เช่น จันทร์",
        f"• วันที่เปิดสอน: {', '.join(days)}",
    ]
    for line in lines:
        guide.append([line])
    guide["A1"].font = Font(bold=True, size=14, color="4F46E5")
    guide.column_dimensions["A"].width = 100
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
