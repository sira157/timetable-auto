"""ข้อมูลในระบบ ↔ โครงสร้าง "ข้อมูลหลักสูตร" (แบบเดียวกับไฟล์ Excel ที่ใช้นำเข้า)

ใช้ร่วมกันโดย
- หน้ากรอกข้อมูล (GET/POST /api/curriculum)
- แบบฟอร์มและการส่งออกข้อมูลปัจจุบันเป็น Excel

โครงสร้าง (model)
{"years": [{"year": 1, "groups": [{"code": "1/1", "size": 30, "rows": [แถว]}]}],
 "admins": [ชื่ออาจารย์], "lecture": [{"name", "note"}], "practice": [{"place", "note"}]}
แถว = {"no", "code", "name", "teachers", "places", "credits", "category"}
แถววิชาในกลุ่มเลือกเดียวกันที่ต่อจากแถวแรก: no / credits / category ว่าง (เหมือนในไฟล์)
"""

from __future__ import annotations

import io
import re

from .curriculum_import import GUIDE, HEADER, _style_header, clean, clean_person, parse_credits_safe


def curriculum_model(data: dict | None, settings: dict) -> dict:
    from .core import DataIndex, is_internship

    data = data or {"teachers": [], "groups": [], "rooms": [], "courses": [], "sections": []}
    data = {**data, "busy": data.get("busy", [])}
    idx = DataIndex(data, settings)
    tname = {t["code"]: t["name"] for t in data["teachers"]}
    years = sorted({int(g.get("year") or 0) for g in data["groups"]} | {1, 2, 3, 4})
    model: dict = {"years": [], "admins": [], "lecture": [], "practice": []}
    for year in years:
        groups_out = []
        for g in sorted([g for g in data["groups"] if int(g.get("year") or 0) == year], key=lambda x: x["code"]):
            secs = [x for x in data["sections"] if g["code"] in idx.section_groups(x)[0]]
            rows, sets_done, n = [], set(), 0
            for sec in secs:
                c = idx.courses.get(sec["course_code"])
                if c is None:
                    continue
                set_name = (c.get("elective_set") or "").strip()
                if set_name and set_name in sets_done:
                    continue
                members = [sec]
                if set_name:
                    sets_done.add(set_name)
                    members = [x for x in secs
                               if (idx.courses.get(x["course_code"]) or {}).get("elective_set", "").strip() == set_name]
                n += 1
                for k, m in enumerate(members):
                    mc = idx.courses[m["course_code"]]
                    credits = mc.get("credits") or ""
                    if parse_credits_safe(credits) is None and int(mc.get("hours") or 0) > 0:
                        credits += f" เรียน {mc['hours']} ชม."
                    if mc.get("combined"):
                        credits += " เรียนรวมทั้งชั้นปี"
                    if set_name:
                        credits += " เลือกเรียน 1 รายวิชา"
                    rows.append({
                        "no": n if k == 0 else None, "code": mc["code"], "name": mc["name"],
                        "teachers": ",".join(tname.get(t, t) for t in m.get("teacher_codes") or []),
                        "places": ",".join(m.get("places") or []) or ("-" if is_internship(mc, settings) else ""),
                        "credits": credits.strip() if k == 0 else None,
                        "category": (mc.get("category") or "") if k == 0 else None,
                    })
            groups_out.append({"code": g["code"], "size": int(g.get("size") or 0), "rows": rows})
        model["years"].append({"year": year, "groups": groups_out})

    model["admins"] = [t["name"] for t in data["teachers"] if t.get("is_admin")]
    home_of = {g.get("homeroom"): g for g in data["groups"] if g.get("homeroom")}
    for r in data["rooms"]:
        if r.get("kind") in ("classroom", "meeting"):
            note = []
            if r["name"] in home_of:
                note.append(f"ห้องเรียนประจำนักศึกษาปีที่ {home_of[r['name']]['code']}")
            note.append(f"ความจุ {int(r.get('capacity') or 0)} คน")
            model["lecture"].append({"name": r["name"], "note": " · ".join(note)})
    for r in data["rooms"]:
        if r.get("kind") == "computer":
            model["practice"].append({"place": r["name"], "note": f"จำนวนคอมพิวเตอร์ {int(r.get('capacity') or 0)} เครื่อง"})
    fields: dict[str, list[dict]] = {}
    for r in data["rooms"]:
        if r.get("kind") == "field":
            fields.setdefault(r.get("building") or r["name"], []).append(r)
    for building, pts in fields.items():
        for i, r in enumerate(pts):
            prefix = r["name"][len(building):].strip() if r["name"].startswith(building) else ""
            sport = ", ".join(r.get("sports") or []) or "-"
            if not sport.startswith(("การ", "กิจกรรม", "-")):
                sport = f"กีฬา{sport}"
            model["practice"].append({
                "place": building if i == 0 else "",
                "note": f"{prefix} สำหรับ {sport}" if prefix else f"ใช้สำหรับ {sport}",
            })
    return model


def _periods(credits: str) -> int:
    m = re.search(r"\((\d+)-(\d+)-\d+\)", credits or "")
    if m:
        return int(m.group(1)) + int(m.group(2))
    h = re.search(r"เรียน\s*(\d+)\s*ชม", credits or "")
    return int(h.group(1)) if h else 0


def model_workbook(model: dict) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    wb = Workbook()
    wb.remove(wb.active)
    thin = Side(style="thin", color="CBD5E1")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    head_fill = PatternFill("solid", fgColor="EEF2FF")
    head_font = Font(bold=True, color="3730A3")
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    wrap = Alignment(vertical="top", wrap_text=True)
    widths = [12, 8, 6, 13, 38, 34, 40, 30, 26]

    for y in model.get("years") or []:
        year = int(y.get("year") or 0)
        ws = wb.create_sheet(f"ชั้นปีที่{year}")
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[chr(64 + i)].width = w
        ws.append([f"ข้อมูลหลักสูตร ชั้นปีที่ {year}"])
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=9)
        ws.cell(1, 1).font = Font(bold=True, size=14, color="1E293B")
        groups = [g for g in y.get("groups") or [] if clean(g.get("code"))]
        if not groups:
            ws.append(HEADER)
            _style_header(ws, ws.max_row, 9, head_fill, head_font, border, center)
            continue
        for g in groups:
            code = clean(g.get("code"))
            ws.append(HEADER)
            _style_header(ws, ws.max_row, 9, head_fill, head_font, border, center)
            first_row = ws.max_row + 1
            label = f"ปีที่ {code}" if re.fullmatch(r"\d+/\d+", code) else code
            rows = [r for r in g.get("rows") or [] if clean(r.get("code")) or clean(r.get("name"))]
            subjects, periods, set_start = 0, 0, None
            for k, r in enumerate(rows):
                is_member = k > 0 and r.get("no") in (None, "")
                if not is_member:
                    subjects += 1
                    periods += _periods(r.get("credits") or "")
                ws.append([
                    label if k == 0 else None, g.get("size") if k == 0 else None,
                    None if is_member else (r.get("no") or subjects), clean(r.get("code")), clean(r.get("name")),
                    clean(r.get("teachers")), clean(r.get("places")),
                    None if is_member else clean(r.get("credits")), None if is_member else clean(r.get("category")),
                ])
                for col in range(1, 10):
                    ws.cell(ws.max_row, col).border = border
                    ws.cell(ws.max_row, col).alignment = wrap
                if not is_member:
                    if set_start is not None and ws.max_row - 1 > set_start:
                        for col in (3, 8, 9):
                            ws.merge_cells(start_row=set_start, start_column=col, end_row=ws.max_row - 1, end_column=col)
                    set_start = ws.max_row
            if set_start is not None and ws.max_row > set_start:
                for col in (3, 8, 9):
                    ws.merge_cells(start_row=set_start, start_column=col, end_row=ws.max_row, end_column=col)
            if not rows:
                ws.append([label, g.get("size")])
            last = ws.max_row
            if last > first_row:
                ws.merge_cells(start_row=first_row, start_column=1, end_row=last, end_column=1)
                ws.merge_cells(start_row=first_row, start_column=2, end_row=last, end_column=2)
            ws.cell(first_row, 1).alignment = center
            ws.cell(first_row, 2).alignment = center
            ws.append([None, None, f"รวม {subjects} รายวิชา {periods} คาบ"])
            ws.merge_cells(start_row=ws.max_row, start_column=3, end_row=ws.max_row, end_column=9)
            ws.cell(ws.max_row, 3).font = Font(bold=True, color="475569")
        ws.freeze_panes = "A2"

    adm = wb.create_sheet("ฝ่ายบริหาร")
    adm.append(["อาจารย์ฝ่ายบริหาร"])
    adm.cell(1, 1).font, adm.cell(1, 1).fill = head_font, head_fill
    adm.column_dimensions["A"].width = 40
    for name in model.get("admins") or []:
        if clean(name):
            adm.append([clean_person(name)])

    pl = wb.create_sheet("สถานที่เรียน")
    pl.append(["สถานที่เรียนบรรยาย", "หมายเหตุ", "สถานที่เรียนภาคปฏิบัติ", "หมายเหตุ"])
    _style_header(pl, 1, 4, head_fill, head_font, border, center)
    for col, w in zip("ABCD", (24, 44, 32, 44)):
        pl.column_dimensions[col].width = w
    left = [[clean(x.get("name")), clean(x.get("note"))] for x in model.get("lecture") or [] if clean(x.get("name"))]
    right = [[clean(x.get("place")) or None, clean(x.get("note"))] for x in model.get("practice") or []
             if clean(x.get("place")) or clean(x.get("note"))]
    for i in range(max(len(left), len(right))):
        a = left[i] if i < len(left) else [None, None]
        b = right[i] if i < len(right) else [None, None]
        pl.append(a + b)

    guide = wb.create_sheet("คำอธิบาย")
    for line in GUIDE:
        guide.append([line])
    guide["A1"].font = Font(bold=True, size=14, color="4F46E5")
    guide.column_dimensions["A"].width = 110
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
