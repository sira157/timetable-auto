"""ทดสอบการอ่านไฟล์ "ข้อมูลหลักสูตร" แบบแยกชีตชั้นปี (ข้อมูลสมมติ สร้างในการทดสอบ)"""

import io

from openpyxl import Workbook

from backend.core import default_settings
from backend.data_io import parse_xlsx
from backend.scheduler import run_schedule
from backend.validate import check_data, validate

HEAD = ["กลุ่มเรียน", "จำนวน", "ที่", "รหัสวิชา", "ชื่อรายวิชา", "อาจารย์ผู้สอน", "สถานที่ที่ใช้", "หน่วยกิต", "กลุ่มวิชา"]


def _workbook() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "ชั้นปีที่1"
    ws.append(["คณะทดสอบ ชั้นปีที่ 1"])
    for g, room in (("1/1", "ห้อง 101"), ("1/2", "ห้อง 102")):
        ws.append(HEAD)
        ws.append([f"ปีที่ {g}", 30, 1, "ทด 000001", "ภาษาทดสอบ", "อ.ดร.สมมติ หนึ่ง", room, "3(3-0-6)", "วิชาภาษา"])
        ws.append([None, None, 2, "ทด 000002", "ทักษะกีฬาทดสอบ", "อ.สมมติ สอง", f"{room},สนามทดสอบ จุดที่ 1", "2(1-2-3)", "ทักษะและการสอนกีฬา"])
        ws.append([None, None, 3, "ทด 000003", "ปฏิบัติการวิชาชีพทดสอบ", "อ.สิบเอกสมมติ สาม,อ.ดร.สมมติ หนึ่ง", "ห้องประชุม 1",
                   "1(90) เรียน 4 ชม.เรียนรวมทั้งชั้นปี", "วิชาชีพครู"])
        ws.append([None, None, 4, "ทด 000011", "เลือกกีฬา ก", "อ.สมมติ สี่", "โรงยิมส์ทดสอบ", "1(0-2-1) เลือกเรียน 1 รายวิชา", "ทักษะและการสอนกีฬาขั้นสูง"])
        ws.append([None, None, None, "ทด 000012", "เลือกกีฬา ข", "อ.สมมติ ห้า", "สนามทดสอบ จุดที่ 2", None, None])
        ws.append([None, None, "รวม 4 รายวิชา 12 คาบ"])
    ws4 = wb.create_sheet("ชั้นปีที่4")
    ws4.append(HEAD)
    ws4.append(["ปีที่ 4/1", 20, 1, "กศ 021037", "ปฏิบัติการสอนในสถานศึกษา 4", "อ.สมมติ หก", "-", "6(360)", "วิชาชีพครู"])
    adm = wb.create_sheet("ฝ่ายบริหาร")
    adm.append(["อาจารย์ฝ่ายบริหาร"])
    adm.append(["อ.สมมติ สาม"])  # เขียนชื่อไม่มียศ ต้องจับคู่กับ อ.สิบเอกสมมติ สาม ได้
    pl = wb.create_sheet("สถานที่เรียน")
    pl.append(["สถานที่เรียนบรรยาย", "หมายเหตุ", "สถานที่เรียนภาคปฏิบัติ", "หมายเหตุ"])
    pl.append(["ห้อง 101", "ห้องเรียนประจำนักศึกษาปีที่ 1/1", "สนามทดสอบ", "จุดที่ 1 สำหรับ กีฬาทดสอบ"])
    pl.append(["ห้อง 102", "ห้องเรียนประจำนักศึกษาปีที่ 1/2", None, "จุดที่ 2 สำหรับ กีฬา ข"])
    pl.append([None, None, "โรงยิม ทดสอบ", "ใช้สำหรับ กีฬา ก"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_curriculum_workbook():
    parsed = parse_xlsx(_workbook(), default_settings()["days"])
    warnings = parsed.pop("_warnings")
    assert warnings[0].startswith("อ่านได้")
    assert any("ห้องประชุม 1" in w for w in warnings)
    assert any("เป็นคนเดียวกัน" in w for w in warnings) is False  # มีชื่อแบบเดียวในชีตปี
    teachers = {t["name"]: t for t in parsed["teachers"]}
    assert teachers["อ.สิบเอกสมมติ สาม"]["is_admin"]
    groups = {g["code"]: g for g in parsed["groups"]}
    assert groups["1/1"]["homeroom"] == "ห้อง 101" and groups["1/1"]["size"] == 30
    courses = {c["code"]: c for c in parsed["courses"]}
    assert courses["ทด 000003"]["hours"] == 4 and courses["ทด 000003"]["combined"]
    assert courses["ทด 000012"]["elective_set"] == "ทักษะและการสอนกีฬาขั้นสูง"
    assert courses["ทด 000012"]["credits"] == "1(0-2-1)"
    secs = parsed["sections"]
    combined = [s for s in secs if s["course_code"] == "ทด 000003"]
    assert len(combined) == 1 and combined[0]["group_codes"] == ["ปี 1"] and len(combined[0]["teacher_codes"]) == 2
    sport = [s for s in secs if s["course_code"] == "ทด 000002" and s["group_codes"] == ["1/1"]][0]
    assert sport["places"] == ["ห้อง 101", "สนามทดสอบ จุดที่ 1"]
    gym = [s for s in secs if s["course_code"] == "ทด 000011"][0]
    assert gym["places"] == ["โรงยิม ทดสอบ"]  # "โรงยิมส์ทดสอบ" สะกดต่าง แต่จับคู่ได้


def test_curriculum_schedules_cleanly():
    s = default_settings()
    s["time_budget_sec"] = 5
    parsed = parse_xlsx(_workbook(), s["days"])
    parsed.pop("_warnings")
    assert "busy" not in parsed  # ไฟล์นี้ไม่มีเวลาที่ไม่ว่าง จึงต้องไม่ลบข้อมูลเดิม
    parsed["busy"] = []
    data = {k: [{"id": i + 1, **r} for i, r in enumerate(rows)] for k, rows in parsed.items()}
    assert check_data(data, s)["counts"].get("error", 0) == 0
    res = run_schedule(data, s, seed=1)
    assert res["stats"]["placed_hours"] == res["stats"]["total_hours"]
    assert any(n["course_code"] == "กศ 021037" for n in res["notices"])
    assert not [i for i in validate(data, s, res["assignments"]) if i["level"] == "error"]
    # วิชากีฬา 1(0-2-1) ที่ระบุเฉพาะสนาม ไม่ต้องใช้ห้องเรียน
    gym = [a for a in res["assignments"] if a["course_code"] == "ทด 000011"]
    assert gym and gym[0]["field"] == "โรงยิม ทดสอบ" and gym[0]["room"] is None


def test_template_round_trip():
    """แบบฟอร์มที่ระบบส่งออก อ่านกลับได้ข้อมูลเดิม"""
    from backend.curriculum_import import curriculum_workbook

    s = default_settings()
    parsed = parse_xlsx(_workbook(), s["days"])
    parsed.pop("_warnings")
    parsed["busy"] = []
    data = {k: [{"id": i + 1, **r} for i, r in enumerate(rows)] for k, rows in parsed.items()}
    again = parse_xlsx(curriculum_workbook(data, s), s["days"])
    again.pop("_warnings")
    key = lambda p: sorted((x["course_code"], tuple(x["group_codes"]), tuple(x["places"])) for x in p["sections"])  # noqa: E731
    assert key(again) == key(parsed)
    assert {c["code"]: (c["credits"], c["hours"], c["combined"]) for c in again["courses"]} == {
        c["code"]: (c["credits"], c["hours"], c["combined"]) for c in parsed["courses"]}
    blank = parse_xlsx(curriculum_workbook(None, s), s["days"])
    assert blank["sections"] == [] and blank["groups"] == []


def test_names_with_spacing_and_thai_digits_match():
    """ชื่อที่เว้นวรรคต่างกัน มีช่องว่างเกิน หรือใช้เลขไทย ต้องจับคู่กับชื่อในชีตสถานที่และชีตอาจารย์ได้"""
    wb = Workbook()
    ws = wb.active
    ws.title = "ชั้นปีที่1"
    ws.append(HEAD)
    ws.append(["ปีที่ ๑/๑", 30, 1, "ทด ๐๐๐๐๐๑", "ภาษาทดสอบ", "อ.ดร.สมมติ  หนึ่ง ", "ห้อง๑๐๑  ", "3(3-0-6)", "วิชาภาษา"])
    ws.append([None, None, 2, "ทด 000002", "ทักษะทดสอบ", " อ. สมมติ สอง", "ห้องประชุม1", "2(1-2-3)", "วิชาภาษา"])
    ws.append([None, None, 3, "ทด 000003", "ภาษาทดสอบ 2", "อ.ดร.สมมติ หนึ่ง", "ห้อง 101", "3(3-0-6)", "วิชาภาษา"])
    adm = wb.create_sheet("ฝ่ายบริหาร")
    adm.append(["อาจารย์ฝ่ายบริหาร"])
    adm.append(["อ.สมมติสอง"])
    pl = wb.create_sheet("สถานที่เรียน")
    pl.append(["สถานที่เรียนบรรยาย", "หมายเหตุ", "สถานที่เรียนภาคปฏิบัติ", "หมายเหตุ"])
    pl.append(["ห้อง 101 ", "ห้องเรียนประจำนักศึกษาปีที่ 1/1", None, None])
    pl.append(["ห้องประชุม 1", None, None, None])
    buf = io.BytesIO()
    wb.save(buf)

    parsed = parse_xlsx(buf.getvalue(), default_settings()["days"])
    warnings = parsed.pop("_warnings")
    assert [r["name"] for r in parsed["rooms"]] == ["ห้อง 101", "ห้องประชุม 1"]  # ไม่มีห้องซ้ำ
    assert not any("ไม่พบ" in w or "เพิ่ม ห้อง" in w for w in warnings)
    assert [g["code"] for g in parsed["groups"]] == ["1/1"]
    assert {c["code"] for c in parsed["courses"]} == {"ทด 000001", "ทด 000002", "ทด 000003"}
    places = {s["course_code"]: s["places"] for s in parsed["sections"]}
    assert places["ทด 000001"] == ["ห้อง 101"] and places["ทด 000002"] == ["ห้องประชุม 1"]
    assert len(parsed["teachers"]) == 2  # "อ.ดร.สมมติ  หนึ่ง " กับ "อ.ดร.สมมติ หนึ่ง" เป็นคนเดียวกัน
    assert [t["is_admin"] for t in parsed["teachers"] if "สอง" in t["name"]] == [True]


def test_json_import_links_names_with_spacing():
    """ไฟล์ JSON/CSV: การเปิดสอนอ้างห้อง กลุ่ม และอาจารย์ด้วยชื่อที่เว้นวรรคหรือใช้เลขไทยต่างกัน"""
    import json

    from backend.data_io import link_names, parse_json

    payload = {
        "teachers": [{"code": "T01", "name": "อ.สมมติ หนึ่ง"}],
        "groups": [{"code": "1/1", "year": 1, "size": 30, "homeroom": "ห้อง101"}],
        "rooms": [{"name": "ห้อง 101", "kind": "ห้องเรียน", "capacity": 40}],
        "courses": [{"code": "ทด 000001", "name": "ทดสอบ", "credits": "3(3-0-6)"}],
        "sections": [{"course_code": "ทด ๐๐๐๐๐๑ ", "group_codes": ["๑/๑"], "teacher_codes": ["t01 "], "places": ["ห้อง  ๑๐๑"]}],
        "busy": [{"kind": "ประชุม", "name": "ประชุม", "day": "จันทร์", "start": "๑", "end": 2, "teacher_codes": ["T 01"]}],
    }
    parsed = parse_json(json.dumps(payload, ensure_ascii=False).encode("utf-8"), default_settings()["days"])
    link_names(None, parsed)
    sec = parsed["sections"][0]
    assert sec["course_code"] == "ทด 000001" and sec["group_codes"] == ["1/1"]
    assert sec["teacher_codes"] == ["T01"] and sec["places"] == ["ห้อง 101"]
    assert parsed["groups"][0]["homeroom"] == "ห้อง 101"
    assert parsed["busy"][0]["start"] == 1 and parsed["busy"][0]["teacher_codes"] == ["T01"]
