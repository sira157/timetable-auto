"""อ่านไฟล์ Excel "ข้อมูลหลักสูตร" (แยกชีตตามชั้นปี) แล้วแปลงเป็นข้อมูลของระบบ

รูปแบบไฟล์ที่รองรับ
- ชีต "ชั้นปีที่ N": เป็นบล็อกต่อกลุ่มเรียน หัวคอลัมน์
  กลุ่มเรียน | จำนวน | ที่ | รหัสวิชา | ชื่อรายวิชา | อาจารย์ผู้สอน | สถานที่ที่ใช้ | หน่วยกิต | กลุ่มวิชา
  * แถวที่ "ที่" ว่างต่อจากแถววิชาเลือก (หน่วยกิตมีคำว่า "เลือกเรียน") = วิชาในกลุ่มเลือกเดียวกัน
  * หน่วยกิตแบบ "1(90) เรียน 4 ชม.เรียนรวมทั้งชั้นปี" = เรียน 4 ชม./สัปดาห์ และเรียนรวมทั้งชั้นปี
  * ผู้สอนหลายคน / สถานที่หลายแห่ง คั่นด้วยจุลภาค (สถานที่แรกมักเป็นห้องบรรยาย ที่เหลือเป็นสนาม)
- ชีต "ฝ่ายบริหาร": รายชื่ออาจารย์ฝ่ายบริหาร (ประชุมวันอังคารคาบ 1–4)
- ชีต "สถานที่เรียน": ห้องบรรยาย (พร้อมหมายเหตุห้องประจำกลุ่ม) และสถานที่ภาคปฏิบัติ (จุด/สนาม และกีฬาที่รองรับ)

ไม่มีข้อมูลจริงในไฟล์นี้ มีเฉพาะวิธีอ่าน
"""

from __future__ import annotations

import hashlib
import re
from collections import Counter, defaultdict

from .textnorm import match_key, norm_text

HEADER = ["กลุ่มเรียน", "จำนวน", "ที่", "รหัสวิชา", "ชื่อรายวิชา", "อาจารย์ผู้สอน", "สถานที่ที่ใช้", "หน่วยกิต", "กลุ่มวิชา"]
YEAR_SHEET = re.compile(r"ชั้นปีที่\s*(\d+)")
GROUP_RE = re.compile(r"ปี(?:ที่)?\s*(\d+)\s*/\s*(\d+)")
CREDIT_BASE = re.compile(r"^\s*(\d+\s*\([^)]*\))")
HOURS_RE = re.compile(r"เรียน\s*(\d+)\s*ชม")
CREDIT_RE_FULL = re.compile(r"\d+\s*\(\s*\d+\s*-\s*\d+\s*-\s*\d+\s*\)")
TITLES = ["ศาสตราจารย์", "รองศาสตราจารย์", "ผู้ช่วยศาสตราจารย์", "ศ.", "รศ.", "ผศ.", "อ.", "ดร.", "นาย", "นางสาว", "นาง",
          "สิบเอก", "สิบโท", "สิบตรี", "จ่าสิบเอก", "ร.ต.", "ร.ท.", "ร.อ.", "พ.ต.", "พ.ท.", "พ.อ.", "ส.อ.", "ส.ท.", "ส.ต."]
FIELD_WORDS = ("สนาม", "โรงยิม", "สระ", "ลาน", "สปอร์ต")


def is_curriculum_workbook(wb) -> bool:
    for ws in wb.worksheets:
        if not YEAR_SHEET.search(ws.title):
            continue
        for row in ws.iter_rows(min_row=1, max_row=6, values_only=True):
            cells = [str(c).strip() if c is not None else "" for c in row[:9]]
            if cells[:4] == HEADER[:4]:
                return True
    return False


def clean(text) -> str:
    """ตัดช่องว่างหน้า-ท้าย ยุบช่องว่างซ้อน และแปลงเลขไทยเป็นเลขอารบิก"""
    return norm_text(text)


def clean_person(text) -> str:
    s = clean(text)
    return re.sub(r"\.\s+", ".", s)  # "อ. สุธน" → "อ.สุธน"


def person_key(name: str) -> str:
    """ชื่อสำหรับเทียบว่าเป็นคนเดียวกัน: ตัดคำนำหน้า ยศ ตำแหน่งวิชาการ และช่องว่าง"""
    s = match_key(name)
    changed = True
    while changed:
        changed = False
        for t in sorted(TITLES, key=len, reverse=True):
            if s.startswith(t):
                s = s[len(t):]
                changed = True
    return s


def place_key(text: str) -> str:
    s = match_key(text)
    s = s.replace("ส์", "").replace("พละศึกษา", "พลศึกษา").replace("คณะพละ", "คณะพล")
    return s


def teacher_code(key: str, used: set[str]) -> str:
    base = "T" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:5].upper()
    code, n = base, 1
    while code in used:
        n += 1
        code = f"{base}{n}"
    used.add(code)
    return code


def _rows(ws):
    for row in ws.iter_rows(values_only=True):
        yield [row[i] if i < len(row) else None for i in range(9)]


def _parse_places_sheet(ws, warnings: list[str]):
    """คืน (ห้องบรรยาย, จุดปฏิบัติ, ห้องประจำของกลุ่ม)"""
    lecture: list[dict] = []
    points: list[dict] = []
    homeroom: dict[str, str] = {}
    building = ""
    first = True
    for row in ws.iter_rows(values_only=True):
        a, b, c, d = [(row[i] if i < len(row) else None) for i in range(4)]
        if first:
            first = False
            continue
        if a and clean(a):
            name = clean(a)
            cap = re.search(r"ความจุ\s*(\d+)", clean(b))
            meeting = "ประชุม" in name
            lecture.append({"name": name, "building": name.split(" ")[0] if name.startswith("อาคาร") else "อาคารเรียน",
                            "kind": "meeting" if meeting else "classroom",
                            "capacity": int(cap.group(1)) if cap else (120 if meeting else 40), "sports": []})
            m = GROUP_RE.search(clean(b))
            if m:
                homeroom[f"{m.group(1)}/{m.group(2)}"] = name
        if c and clean(c):
            building = clean(c)
        note = clean(d)
        if not building or not (note or c):
            continue
        if building.startswith("ห้องคอมพิวเตอร์"):
            m = re.search(r"(\d+)\s*เครื่อง", note)
            lecture.append({"name": building, "building": "ห้องคอมพิวเตอร์", "kind": "computer",
                            "capacity": int(m.group(1)) if m else 30, "sports": []})
            continue
        prefix, _, sport = note.partition("สำหรับ")
        prefix = re.sub(r"ใช้$", "", prefix.strip()).strip()
        sport = re.sub(r"^(กีฬา|วิชา)", "", sport.strip()).strip()
        name = f"{building} {prefix}".strip() if prefix else building
        points.append({"name": name, "building": building, "kind": "field", "capacity": 60,
                       "sports": [sport] if sport else []})
    return lecture, points, homeroom


def parse_curriculum(wb) -> tuple[dict[str, list[dict]], list[str]]:
    warnings: list[str] = []

    # ---------- สถานที่ ----------
    lecture, points, homeroom_note = [], [], {}
    place_ws = next((ws for ws in wb.worksheets if "สถานที่" in ws.title), None)
    if place_ws is not None:
        lecture, points, homeroom_note = _parse_places_sheet(place_ws, warnings)
    else:
        warnings.append("ไม่พบชีตสถานที่เรียน ระบบสร้างห้องจากคอลัมน์สถานที่ที่ใช้")
    rooms: dict[str, dict] = {}
    for r in lecture + points:
        rooms.setdefault(r["name"], r)
    by_key = {place_key(n): n for n in rooms}

    def resolve(token: str, course: str) -> list[str]:
        token = clean(token)
        if not token or token == "-":
            return []
        k = place_key(token)
        if k in by_key:
            return [by_key[k]]
        # เทียบท้ายชื่อ เช่น "ลานตึกคณะพละ ลานตึกคณะพละศึกษาทิศใต้" กับจุด "...ทิศใต้"
        # ใช้เฉพาะคำท้ายที่เจาะจงพอ (ไม่ใช่ตัวเลขหรือคำสั้น) เพื่อไม่ให้ "ห้องประชุม 1" ไปตรงกับ "จุดที่ 1"
        last = place_key(token.split(" ")[-1])
        if " " in token and len(last) >= 6 and not re.search(r"\d", last):
            hits = [n for kk, n in by_key.items() if kk.endswith(last) and rooms[n]["kind"] == "field"]
            if len(hits) == 1:
                return hits
        building = [n for n, r in rooms.items() if place_key(r["building"]) == k and r["kind"] == "field"]
        if building:
            return building
        kind = "meeting" if "ประชุม" in token else "field" if any(w in token for w in FIELD_WORDS) else "classroom"
        rooms[token] = {"name": token, "building": token if kind == "field" else "อื่นๆ", "kind": kind,
                        "capacity": 120 if kind == "meeting" else 60 if kind == "field" else 40, "sports": []}
        by_key[k] = token
        if kind == "meeting":
            warnings.append(f"เพิ่ม {token} (ไม่มีในชีตสถานที่เรียน) ความจุ 120 คน แก้ได้ที่เมนูห้องเรียน")
        else:
            warnings.append(f"ไม่พบ \"{token}\" ในชีตสถานที่เรียน ({course}) จึงเพิ่มเป็นสถานที่ใหม่")
        return [token]

    # ---------- อาจารย์ ----------
    teacher_variants: dict[str, Counter] = defaultdict(Counter)

    def teachers_of(text) -> list[str]:
        keys = []
        for part in re.split(r"[,，]", str(text or "")):
            name = clean_person(part)
            if name and name != "-":
                key = person_key(name)
                teacher_variants[key][name] += 1
                keys.append(key)
        return keys

    # ---------- ชั้นปี ----------
    groups: dict[str, dict] = {}
    entries: list[dict] = []
    set_heads: dict[tuple, str] = {}
    for ws in wb.worksheets:
        m = YEAR_SHEET.search(ws.title)
        if not m:
            continue
        year = int(m.group(1))
        group = None
        head = None
        for row in _rows(ws):
            a, b, c, d, e, f, g, h, i = row
            cells = [clean(x) for x in row]
            if cells[:4] == HEADER[:4] or (cells[2].startswith("รวม") and not cells[3]):
                head = None
                continue
            if a and GROUP_RE.search(clean(a)):
                gm = GROUP_RE.search(clean(a))
                code = f"{gm.group(1)}/{gm.group(2)}"
                group = groups.setdefault(code, {"code": code, "name": clean(a), "year": int(gm.group(1)),
                                                 "size": int(b) if isinstance(b, (int, float)) else 0,
                                                 "homeroom": homeroom_note.get(code, ""), "advisor": ""})
            if group is None or not cells[3]:
                continue
            course_code = cells[3]
            if cells[2]:  # แถววิชาหลัก (มีเลขลำดับ)
                credits_raw = cells[7]
                category = cells[8]
                head = {"credits_raw": credits_raw, "category": category, "code": course_code}
                if "เลือกเรียน" in credits_raw:
                    # ชื่อกลุ่มวิชาเลือก = กลุ่มวิชา (ถ้าซ้ำกับอีกชุดในชั้นปีเดียวกัน ต่อท้ายด้วยรหัสวิชาแรก)
                    owner = set_heads.setdefault((year, category), course_code)
                    head["set"] = category if owner == course_code else f"{category} {course_code}"
            elif head is not None and "เลือกเรียน" in head["credits_raw"]:
                credits_raw, category = head["credits_raw"], head["category"]  # วิชาในกลุ่มเลือกเดียวกัน
            else:
                credits_raw, category = cells[7], cells[8]
            places = []
            for tok in re.split(r"[,，]", str(g or "")):
                places += resolve(tok, course_code)
            entries.append({
                "year": year, "group": group["code"], "code": course_code, "name": cells[4],
                "teachers": teachers_of(f), "places": places, "credits_raw": credits_raw, "category": category,
                "elective": "เลือกเรียน" in credits_raw, "combined": "เรียนรวม" in credits_raw,
                "set": head.get("set", head["category"]) if head and "เลือกเรียน" in credits_raw else "",
            })

    # อาจารย์: ใช้ชื่อที่ยาวที่สุด (มีตำแหน่ง/ยศครบ) เป็นชื่อแสดง และแจ้งเมื่อรวมชื่อที่เขียนต่างกัน
    used: set[str] = set()
    teacher_rows, code_of = [], {}
    for key, variants in teacher_variants.items():
        name = max(variants, key=lambda n: (len(n), variants[n]))
        code = teacher_code(key, used)
        code_of[key] = code
        teacher_rows.append({"code": code, "name": name, "is_admin": False, "is_excluded": False, "note": ""})
        if len(variants) > 1:
            warnings.append(f"รวมชื่อ {' / '.join(sorted(variants))} เป็นคนเดียวกัน")

    admin_ws = next((ws for ws in wb.worksheets if "บริหาร" in ws.title), None)
    if admin_ws is not None:
        for row in admin_ws.iter_rows(min_row=2, values_only=True):
            name = clean_person(row[0] if row else "")
            if not name:
                continue
            key = person_key(name)
            hit = next((t for t in teacher_rows if t["code"] == code_of.get(key)), None)
            if hit is None:
                warnings.append(f"ฝ่ายบริหาร: {name} ไม่มีชั่วโมงสอนในไฟล์ จึงเพิ่มเป็นอาจารย์ใหม่")
                code = teacher_code(key, used)
                code_of[key] = code
                hit = {"code": code, "name": name, "is_admin": False, "is_excluded": False, "note": ""}
                teacher_rows.append(hit)
            hit["is_admin"] = True

    # ---------- รายวิชาและการเปิดสอน ----------
    courses: dict[str, dict] = {}
    for en in entries:
        if en["code"] in courses:
            continue
        raw = en["credits_raw"]
        base = CREDIT_BASE.match(raw)
        hm = HOURS_RE.search(raw)
        courses[en["code"]] = {
            "code": en["code"], "name": en["name"], "credits": clean(base.group(1)) if base else raw,
            "category": re.sub(r"^วิชา(?=ภาษา|สังคม)", "", en["category"]) if en["category"] else "",
            "combined": en["combined"], "elective_set": en["set"], "free_elective": "เลือกเสรี" in en["category"], "venue": "", "sport": "",
            "hours": int(hm.group(1)) if hm else 0, "is_excluded": False,
        }

    sections: list[dict] = []
    by_course_year: dict[tuple, list[dict]] = defaultdict(list)
    for en in entries:
        by_course_year[(en["year"], en["code"])].append(en)
    for (year, code), items in by_course_year.items():
        course = courses[code]
        first = items[0]
        teach = [code_of[k] for k in first["teachers"]]
        same_places = all(x["places"] == first["places"] for x in items)
        same_teach = all(x["teachers"] == first["teachers"] for x in items)
        whole_year = (
            course["combined"] or course["elective_set"] or course["free_elective"]
            or (not course["hours"] and not CREDIT_RE_FULL.search(course["credits"]))  # วิชาฝึกสอนทั้งภาคเรียน
        )
        if whole_year and same_places and same_teach:
            # เรียนรวม/วิชาเลือกทั้งชั้นปี: เปิดสอนครั้งเดียวสำหรับทุกกลุ่ม
            sections.append({"course_code": code, "group_codes": [f"ปี {year}"], "teacher_codes": teach,
                             "places": first["places"], "note": ""})
            continue
        if course["elective_set"] and not same_places:
            # วิชาเลือกเปิดครั้งเดียวทั้งชั้นปี แต่แต่ละกลุ่มเขียนสถานที่ต่างกัน:
            # เลือกสถานที่ที่รองรับกีฬาของวิชา (ดูจากชื่อวิชา) ก่อน ถ้าไม่มี ใช้ของกลุ่มแรก
            options = []
            for x in items:
                if x["places"] not in options:
                    options.append(x["places"])

            def fits(places, name=course["name"]):
                return any(sp and sp in name for p_ in places for sp in rooms.get(p_, {}).get("sports") or [])

            chosen = next((o for o in options if fits(o)), first["places"])
            said = "; ".join(
                f"{', '.join(x['group'] for x in items if x['places'] == o)} ระบุ {' + '.join(o) or '-'}" for o in options
            )
            warnings.append(f"{code} สถานที่ไม่ตรงกัน ({said}) ใช้ {' + '.join(chosen) or '-'}")
            sections.append({"course_code": code, "group_codes": [f"ปี {year}"], "teacher_codes": teach,
                             "places": chosen, "note": ""})
            continue
        for x in items:
            sections.append({"course_code": code, "group_codes": [x["group"]],
                             "teacher_codes": [code_of[k] for k in x["teachers"]], "places": x["places"], "note": ""})
            home = groups[x["group"]].get("homeroom")
            classrooms = [p for p in x["places"] if rooms.get(p, {}).get("kind") == "classroom"]
            if home and classrooms and classrooms[0] != home and not course["combined"]:
                warnings.append(f"{code} กลุ่ม {x['group']} ระบุ {classrooms[0]} ไม่ใช่ห้องประจำ ({home}) ใช้ตามข้อมูล")

    # กลุ่มที่ไม่มีห้องประจำในชีตสถานที่: ใช้ห้องบรรยายที่ใช้บ่อยที่สุดของกลุ่ม
    for code, g in groups.items():
        if not g["homeroom"]:
            used_rooms = Counter(p for x in entries if x["group"] == code for p in x["places"]
                                 if rooms.get(p, {}).get("kind") == "classroom")
            if used_rooms:
                g["homeroom"] = used_rooms.most_common(1)[0][0]

    summary = (f"อ่านได้: {len(groups)} กลุ่มเรียน, {len(teacher_rows)} อาจารย์, {len(courses)} รายวิชา, "
               f"{len(sections)} การเปิดสอน, {len(rooms)} ห้อง/สนาม")
    warnings.insert(0, summary)
    return {
        "teachers": teacher_rows,
        "groups": sorted(groups.values(), key=lambda g: (g["year"], g["code"])),
        "rooms": list(rooms.values()),
        "courses": list(courses.values()),
        "sections": sections,
        # ไม่มีข้อมูลเวลาที่ไม่ว่างในไฟล์นี้ จึงไม่แตะข้อมูลเวลาที่ไม่ว่างเดิม
    }, warnings


# ======================================================================
# เขียนไฟล์รูปแบบ "ข้อมูลหลักสูตร" (ใช้เป็นแบบฟอร์ม และส่งออกข้อมูลปัจจุบันให้แก้แล้วนำเข้ากลับได้)
# ======================================================================

GUIDE = [
    "แบบฟอร์มข้อมูลหลักสูตร สำหรับนำเข้าระบบจัดตารางสอน",
    "",
    "ชีตที่ต้องมี",
    "• ชั้นปีที่ 1 – ชั้นปีที่ 4: รายวิชาของแต่ละกลุ่มเรียน (1 บล็อกต่อ 1 กลุ่ม เริ่มด้วยแถวหัวตาราง)",
    "• ฝ่ายบริหาร: รายชื่ออาจารย์ฝ่ายบริหาร (ไม่จัดสอนวันอังคารคาบ 1–4)",
    "• สถานที่เรียน: ห้องบรรยาย (หมายเหตุบอกห้องประจำกลุ่ม) และสถานที่ภาคปฏิบัติ (สนาม/จุด และกีฬาที่ใช้)",
    "",
    "วิธีกรอกในชีตชั้นปี",
    "• กลุ่มเรียน: พิมพ์ ปีที่ 1/1 ในแถวแรกของบล็อก พร้อมจำนวนนักศึกษา",
    "• ที่: เลขลำดับรายวิชา",
    "• อาจารย์ผู้สอน: หลายคน (สอนร่วม) คั่นด้วยจุลภาค เช่น อ.ก ใจดี,อ.ข มีสุข",
    "• สถานที่ที่ใช้: ห้องบรรยายก่อน แล้วตามด้วยสนาม คั่นด้วยจุลภาค เช่น ห้อง 321,สระว่ายน้ำ สระน้ำด้านบน",
    "• หน่วยกิต: 3(2-2-5) หรือ 1(90) เรียน 4 ชม.  ถ้าเรียนพร้อมกันทั้งชั้นปี เติม เรียนรวมทั้งชั้นปี",
    "• วิชาเลือก (นักศึกษาเลือก 1 วิชา): แถวแรกใส่เลขที่และเติม เลือกเรียน 1 รายวิชา ในช่องหน่วยกิต",
    "  วิชาอื่นในกลุ่มเลือกเดียวกันใส่ในแถวถัดไป โดยเว้นช่องที่ หน่วยกิต และกลุ่มวิชา",
    "• กลุ่มวิชา: ใช้ชื่อเดียวกับในหลักสูตร เช่น วิชาภาษา, นวัตกรรมและเทคโนโลยี, ทักษะและการสอนกีฬา",
    "• วิชาฝึกสอนทั้งภาคเรียน (เช่น กศ 021037 6(360)) ใส่สถานที่เป็น - ระบบจะไม่จัดลงตาราง",
    "",
    "ชีตสถานที่เรียน",
    "• คอลัมน์ ก–ข: ชื่อห้อง และหมายเหตุ เช่น ห้องเรียนประจำนักศึกษาปีที่ 1/1 · ความจุ 40 คน",
    "• คอลัมน์ ค–ง: ชื่อสนาม/อาคาร (ใส่ครั้งเดียว) และหมายเหตุแต่ละจุด เช่น สนามที่ 1 สำหรับ กีฬามวยไทย",
    "  สนามที่มีจุดเดียว เขียนหมายเหตุว่า ใช้สำหรับ กีฬาฟุตซอล",
    "",
    "หมายเหตุ: เวลาที่ไม่ว่างอื่น (เช่น ไปราชการ) และการตั้งค่าเวลา แก้ในระบบ ไม่อยู่ในไฟล์นี้ และนำเข้าไฟล์นี้จะไม่ลบข้อมูลเหล่านั้น",
]


def _style_header(ws, row, ncol, fill, font, border, center):
    for col in range(1, ncol + 1):
        c = ws.cell(row, col)
        c.fill, c.font, c.border, c.alignment = fill, font, border, center


def curriculum_workbook(data: dict | None, settings: dict) -> bytes:
    """ไฟล์ Excel รูปแบบข้อมูลหลักสูตร (data=None → แบบฟอร์มเปล่า)"""
    from .curriculum_writer import curriculum_model, model_workbook

    return model_workbook(curriculum_model(data, settings))


def group_cell(g: dict) -> str:
    """ชื่อกลุ่มในไฟล์: ปีที่ 1/1 (ตัวอ่านใช้รูปแบบนี้ระบุกลุ่ม)"""
    return f"ปีที่ {g['code']}" if re.fullmatch(r"\d+/\d+", g["code"]) else g["name"]


def parse_credits_safe(text):
    from .core import parse_credits

    return parse_credits(text)
