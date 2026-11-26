"""สร้างชุดข้อมูลตัวอย่าง เล็ก / กลาง / ใหญ่ (ข้อมูลสมมติ) ลงในโฟลเดอร์นี้

รัน: python sample-data/generate_samples.py
ไฟล์ที่ได้: small.json, medium.json, large.json (นำเข้าผ่านหน้าเว็บได้โดยตรง)
"""

import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent

FIRST = ["สมชาย", "วิไลวรรณ", "ประเสริฐ", "กนกพร", "ธีระ", "สุภาวดี", "วรเชษฐ์", "นภัสสร", "ภานุวัฒน์", "ศิริพร",
         "ชาญวิทย์", "อรุณี", "เกียรติศักดิ์", "พิมพ์ชนก", "ณัฐพล", "จันทร์เพ็ญ", "อนุชา", "รัตนา", "สุรเชษฐ์", "มาลัย",
         "ปิยะพงษ์", "วนิดา", "ธนากร", "ลัดดา", "กิตติพงษ์", "ปวีณา", "ศักดิ์ชัย", "อัญชลี", "วีระพงษ์", "นงลักษณ์",
         "ชัยวัฒน์", "สมใจ", "ธวัชชัย", "พรทิพย์", "อำนาจ", "สุดารัตน์", "ไพโรจน์", "จิราพร", "สมศักดิ์", "กาญจนา"]
LAST = ["ใจดี", "ศรีสุข", "มั่นคง", "แสงทอง", "รุ่งเรือง", "พรหมมา", "บุญมา", "คงสวัสดิ์", "ทองดี", "วงศ์ใหญ่",
        "สมบูรณ์", "แก้วประเสริฐ", "ชัยมงคล", "รักษ์ไทย", "อินทร์แก้ว", "สายสุวรรณ", "ปัญญาดี", "ทองคำ", "เพชรรัตน์",
        "ศรีวงศ์", "สุขเจริญ", "ใจงาม", "พูลผล", "มีสุข", "ศรีเมือง", "บุญรอด", "จันทร์หอม", "นาคสุข"]

SK, IT = "ทักษะและการสอนกีฬา", "นวัตกรรมและเทคโนโลยี"
SPORT_BUILDING = {
    "กรีฑา": "สนามกรีฑา", "ฟุตบอล": "สนามฟุตบอล", "ว่ายน้ำ": "อาคารว่ายน้ำ", "การช่วยชีวิตทางน้ำ": "อาคารว่ายน้ำ",
    "วอลเลย์บอล": "อาคารสปอร์ตคอมเพล็ก 1", "แชร์บอล": "อาคารสปอร์ตคอมเพล็ก 1", "แอโรบิก": "อาคารสปอร์ตคอมเพล็ก 1",
    "กระบี่กระบอง": "โรงยิม", "บาสเกตบอล": "โรงยิม",
}

# (รหัส, ชื่อ, หน่วยกิต, หมวด, ประเภท, กีฬา) ประเภท: group | combined | elective | free | intern
YEAR_COURSES = {
    1: [
        ("ทศ 101101", "ภาษาไทยเพื่อการสื่อสาร", "3(2-2-5)", "ภาษา", "group", ""),
        ("ทศ 101102", "ภาษาอังกฤษเพื่อการสื่อสาร", "3(2-2-5)", "ภาษา", "group", ""),
        ("กศ 011101", "จิตวิทยาสำหรับครู", "3(3-0-6)", "วิชาชีพครู", "combined", ""),
        ("พล 111101", "ทักษะและการสอนกรีฑา", "2(1-2-3)", SK, "group", "กรีฑา"),
        ("พล 111102", "ทักษะและการสอนว่ายน้ำ", "2(1-2-3)", SK, "group", "ว่ายน้ำ"),
        ("วท 121101", "วิทยาศาสตร์การกีฬาเบื้องต้น", "3(2-2-5)", "วิทยาศาสตร์", "group", ""),
        ("คณ 131101", "คณิตศาสตร์ในชีวิตประจำวัน", "3(3-0-6)", "คณิตศาสตร์", "combined", ""),
        ("นท 171101", "เทคโนโลยีดิจิทัลเพื่อการศึกษา", "3(2-2-5)", IT, "group", ""),
        ("ลส 161001", "ลีลาศเพื่อสุขภาพ", "3(2-2-5)", "วิชาเลือกเสรี", "free", ""),
    ],
    2: [
        ("ทศ 102201", "ภาษาอังกฤษสำหรับครูพลศึกษา", "3(2-2-5)", "ภาษา", "group", ""),
        ("กศ 012201", "หลักสูตรและการจัดการเรียนรู้", "3(2-2-5)", "วิชาชีพครู", "combined", ""),
        ("พล 112201", "ทักษะและการสอนฟุตบอล", "2(1-2-3)", SK, "group", "ฟุตบอล"),
        ("พล 112202", "ทักษะและการสอนวอลเลย์บอล", "2(1-2-3)", SK, "group", "วอลเลย์บอล"),
        ("พล 051383", "ทักษะการเรียนรู้กีฬากระบี่กระบอง", "2(1-2-3)", SK, "group", "กระบี่กระบอง"),
        ("วท 122201", "สรีรวิทยาการออกกำลังกาย", "3(2-2-5)", "วิทยาศาสตร์", "group", ""),
        ("สค 142201", "สังคมกับการเป็นพลเมือง", "3(3-0-6)", "สังคมศาสตร์และมนุษยศาสตร์", "group", ""),
        ("นท 172201", "นวัตกรรมการเรียนรู้พลศึกษา", "3(2-2-5)", IT, "group", ""),
        ("จน 161002", "ภาษาจีนเบื้องต้น", "3(2-2-5)", "วิชาเลือกเสรี", "free", ""),
    ],
    3: [
        ("กศ 013301", "การวัดและประเมินผลการเรียนรู้", "3(2-2-5)", "วิชาชีพครู", "combined", ""),
        ("กศ 013302", "การวิจัยในชั้นเรียน", "3(2-2-5)", "วิชาชีพครู", "group", ""),
        ("พล 113311", "ทักษะและการสอนกีฬาขั้นสูง", "3(2-2-5)", SK, "elective", "ฟุตบอล"),
        ("พล 113312", "การตัดสินกีฬา", "3(2-2-5)", SK, "elective", "วอลเลย์บอล"),
        ("พล 113313", "กลวิธีการฝึกกีฬา", "3(2-2-5)", SK, "elective", "บาสเกตบอล"),
        ("พล 113301", "ทักษะและการสอนแชร์บอล", "2(1-2-3)", SK, "group", "แชร์บอล"),
        ("พล 113302", "การช่วยชีวิตทางน้ำ", "2(1-2-3)", SK, "group", "การช่วยชีวิตทางน้ำ"),
        ("พล 113303", "แอโรบิกเพื่อสุขภาพ", "2(1-2-3)", SK, "group", "แอโรบิก"),
        ("สศ 153301", "สุขศึกษาในโรงเรียน", "3(2-2-5)", "วิชาบังคับ", "group", ""),
        ("นว 161003", "การนวดแผนไทยเพื่อสุขภาพ", "3(2-2-5)", "วิชาเลือกเสรี", "free", ""),
    ],
    4: [
        ("กศ 021037", "ปฏิบัติการสอนในสถานศึกษา 4", "6(360)", "วิชาชีพครู", "intern", ""),
    ],
}

SIZE_BY_YEAR = {1: 30, 2: 30, 3: 25, 4: 20}

SCALES = {
    "small": {"groups": {1: 2, 2: 2, 4: 1}, "only": {
        1: ["ทศ 101101", "กศ 011101", "พล 111101", "นท 171101", "ลส 161001"],
        2: ["ทศ 102201", "กศ 012201", "พล 051383", "วท 122201"],
        4: ["กศ 021037"],
    }, "per_teacher": 2, "class_cap": 40},
    "medium": {"groups": {1: 4, 2: 4, 3: 3, 4: 3}, "only": None, "per_teacher": 2, "class_cap": 40},
    "large": {"groups": {1: 6, 2: 6, 3: 5, 4: 5}, "only": None, "per_teacher": 3, "class_cap": 45},
}


def hours(credits: str) -> int:
    inside = credits.split("(")[1].rstrip(")").split("-")
    return int(inside[0]) + int(inside[1]) if len(inside) >= 2 else 0


def build(scale: str) -> dict:
    cfg = SCALES[scale]
    teachers: list[dict] = []
    load: dict[str, int] = {}

    def new_teacher() -> str:
        n = len(teachers)
        code = f"T{n + 1:02d}"
        # ชื่อไม่ซ้ำกัน: จับคู่ชื่อกับนามสกุลโดยเลื่อนนามสกุลทุกครั้งที่ชื่อวนรอบ
        teachers.append({"code": code, "name": f"อ.{FIRST[n % len(FIRST)]} {LAST[(n + n // len(FIRST) * 11) % len(LAST)]}"})
        load[code] = 0
        return code

    groups, rooms, courses, sections = [], [], [], []
    year_groups: dict[int, list[str]] = {}
    room_no = 0
    for year, count in cfg["groups"].items():
        for i in range(1, count + 1):
            code = f"{year}/{i}"
            room_no += 1
            home = f"{3 + (room_no - 1) // 6}{(room_no - 1) % 6 + 1:02d}"
            groups.append({"code": code, "name": f"ปี {code}", "year": year, "size": SIZE_BY_YEAR[year],
                           "homeroom": home, "advisor": ""})
            rooms.append({"name": home, "building": f"อาคาร {3 + (room_no - 1) // 6}", "kind": "classroom",
                          "capacity": cfg["class_cap"], "sports": []})
            year_groups.setdefault(year, []).append(code)

    # ฝ่ายบริหาร 7 คน (สอนวิชาเรียนรวมเป็นหลัก ภาระน้อย)
    admins = [new_teacher() for _ in range(min(7, 2 + len(groups) // 2))]
    admin_iter = iter(admins * 10)

    sport_hours: dict[str, int] = {}
    computer_hours = 0
    per_teacher = cfg["per_teacher"]
    for year, items in YEAR_COURSES.items():
        if year not in year_groups:
            continue
        only = (cfg["only"] or {}).get(year)
        gs = year_groups[year]
        for code, name, credits, cat, kind, sport in items:
            if only is not None and code not in only:
                continue
            venue = SPORT_BUILDING.get(sport, "")
            courses.append({"code": code, "name": name, "credits": credits, "category": cat,
                            "combined": kind == "combined", "elective_set": "วิชาเลือกกีฬา" if kind == "elective" else "",
                            "free_elective": kind == "free", "venue": venue, "sport": sport})
            h = hours(credits)
            if kind in ("combined", "intern"):
                t = next(admin_iter)
                if kind == "combined" and year == 2:  # สอนร่วม
                    sections.append({"course_code": code, "group_codes": [f"ปี {year}"], "teacher_codes": [t, next(admin_iter)]})
                else:
                    sections.append({"course_code": code, "group_codes": [f"ปี {year}"], "teacher_codes": [t]})
                continue
            if kind in ("elective", "free"):
                t = new_teacher()
                load[t] += h
                sections.append({"course_code": code, "group_codes": [f"ปี {year}"], "teacher_codes": [t]})
                if kind == "elective":
                    sport_hours[sport] = sport_hours.get(sport, 0) + h
                continue
            t = None
            for idx, g in enumerate(gs):
                if idx % per_teacher == 0 or t is None:
                    t = new_teacher()
                teach = [t]
                if code == "วท 121101" and idx == 0:  # สอนร่วม 2 คน
                    teach = [t, new_teacher()]
                for x in teach:
                    load[x] += h
                sections.append({"course_code": code, "group_codes": [g], "teacher_codes": teach})
                if sport:
                    sport_hours[sport] = sport_hours.get(sport, 0) + h
                if cat == IT:
                    computer_hours += h

    # อาจารย์ที่ปรึกษา: กระจายให้อาจารย์ที่ไม่ใช่ฝ่ายบริหาร
    pool = [t["code"] for t in teachers if t["code"] not in admins]
    for i, g in enumerate(groups):
        g["advisor"] = pool[i % len(pool)]

    for i in range(max(1, math.ceil(computer_hours / 22))):
        rooms.append({"name": f"ห้องคอมพิวเตอร์ {i + 1}", "building": "อาคารเทคโนโลยี", "kind": "computer",
                      "capacity": 40, "sports": []})
    rooms.append({"name": "ห้องประชุม 1", "building": "อาคารอำนวยการ", "kind": "meeting", "capacity": 120, "sports": []})
    rooms.append({"name": "ห้องประชุม 2", "building": "อาคารอำนวยการ", "kind": "meeting", "capacity": 120, "sports": []})
    if max(len(v) * SIZE_BY_YEAR[y] for y, v in year_groups.items()) > 120:
        rooms.append({"name": "หอประชุมใหญ่", "building": "อาคารอำนวยการ", "kind": "meeting", "capacity": 300, "sports": []})
    point_count: dict[str, int] = {}
    for sport, h in sorted(sport_hours.items()):
        b = SPORT_BUILDING[sport]
        for _ in range(max(1, math.ceil(h / 18))):
            point_count[b] = point_count.get(b, 0) + 1
            rooms.append({"name": f"{b} จุดที่ {point_count[b]}", "building": b, "kind": "field",
                          "capacity": 60, "sports": [sport]})

    busy = []
    if len(pool) > 3:
        busy.append({"kind": "unavailable", "name": "ไปราชการ", "day": 3, "start": 1, "end": 4,
                     "teacher_codes": [pool[3]], "group_codes": []})
    return {"format": "timetable-dataset", "version": 2, "name": scale, "teachers": teachers, "admins": admins,
            "groups": groups, "rooms": rooms, "courses": courses, "sections": sections, "busy": busy}


if __name__ == "__main__":
    for scale in SCALES:
        data = build(scale)
        (HERE / f"{scale}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{scale}: อาจารย์ {len(data['teachers'])}, กลุ่ม {len(data['groups'])}, รายวิชา {len(data['courses'])}, "
              f"การเปิดสอน {len(data['sections'])}, ห้อง/จุด {len(data['rooms'])}")
