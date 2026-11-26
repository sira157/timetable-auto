"""ส่งออกตารางสอนเป็น Excel แบบตาราง (วัน x คาบ) หนึ่งชีตต่อหนึ่งกลุ่ม/อาจารย์/ห้อง"""

from __future__ import annotations

import io
import re

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

FILL = {
    "normal": "F0F9FF", "elective": "F0F9FF", "free": "F0F9FF", "combined": "F0FDF4", "coteach": "EEF2FF",
    "activity": "F5F3FF", "meeting": "F1F5F9", "lunch": "FFFBEB",
}
EDGE = {
    "normal": "BAE6FD", "elective": "BAE6FD", "free": "BAE6FD", "combined": "BBF7D0", "coteach": "C7D2FE",
    "activity": "DDD6FE", "meeting": "CBD5E1", "lunch": "FDE68A",
}


def _kind(e: dict) -> str:
    if e.get("kind") == "combined":
        return "combined"
    if e.get("coteach"):
        return "coteach"
    return e.get("kind") or "normal"


def merge_electives(entries: list[dict], view: str) -> list[dict]:
    """มุมมองชั้นปี: วิชาเลือกที่เรียนเวลาเดียวกันรวมเป็นช่องเดียว"""
    if view != "group":
        return entries
    out, seen = [], {}
    for e in entries:
        if e.get("kind") in ("elective", "free"):
            if e["unit_key"] in seen:
                seen[e["unit_key"]]["members"].append(e)
                continue
            box = {**e, "members": [e]}
            seen[e["unit_key"]] = box
            out.append(box)
        else:
            out.append(e)
    return out


def entry_text(e: dict, view: str) -> str:
    """ข้อความในช่อง ตามข้อ 14 ของกฎ (วิชาเลือกในมุมมองชั้นปี = กล่องเดียว มีรายละเอียดทุกวิชา)"""
    if e.get("members"):
        label = "วิชาเลือกเสรี" if e.get("kind") == "free" else "วิชาเลือก"
        head = f"{label}{' · ' + e['elective_set'] if e.get('elective_set') else ''} ({e.get('credits') or '-'})"
        lines = [head]
        for m in e["members"]:
            place = " + ".join(x for x in (m.get("room"), m.get("field")) if x) or "-"
            lines.append(f"• {m['course_code']} {m['course_name']} · {', '.join(m.get('teachers') or []) or '-'} · {place}")
        return "\n".join(lines)
    head = f"{e['course_code']} ({e.get('credits') or '-'})"
    place = " + ".join(x for x in (e.get("room"), e.get("field")) if x) or "-"
    group = e.get("group_label") or ", ".join(e.get("groups") or [])
    teachers = ", ".join(e.get("teachers") or []) or "-"
    if view == "teacher":
        third = group + (f"\nร่วมกับ {', '.join(e['co_teachers'])}" if e.get("co_teachers") else "")
        lines = [head, e["course_name"], third, place]
    elif view in ("room", "building"):
        lines = [head, e["course_name"], teachers, group if view == "room" else f"{place} · {group}"]
    else:
        lines = [head, e["course_name"], teachers, place]
    return "\n".join(lines)


def _lanes(items: list[dict]) -> list[list[dict]]:
    lanes: list[list[dict]] = []
    for it in sorted(items, key=lambda x: (x["start"], -x["length"])):
        for lane in lanes:
            last = lane[-1]
            if last["start"] + last["length"] <= it["start"]:
                lane.append(it)
                break
        else:
            lanes.append([it])
    return lanes or [[]]


def _sheet_title(title: str, used: set[str]) -> str:
    base = re.sub(r"[\[\]\*\?/\\:]", "-", title.replace("ตารางสอน ", "").replace("ตารางเรียน ", "")
                  .replace("ตารางการใช้ ", ""))[:28] or "ตาราง"
    name, n = base, 1
    while name in used:
        n += 1
        name = f"{base[:25]}-{n}"
    used.add(name)
    return name


def grid_workbook(timetables: list[dict]) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    used: set[str] = set()
    thin = Side(style="thin", color="CBD5E1")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    cell_align = Alignment(horizontal="left", vertical="top", wrap_text=True)
    for tt in timetables:
        ws = wb.create_sheet(_sheet_title(tt["title"], used))
        periods = tt["periods"]
        n = len(periods)
        lunch = set(tt.get("lunch_periods") or [])
        ws.cell(1, 1, tt["title"]).font = Font(bold=True, size=14, color="1E293B")
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=n + 1)
        ws.cell(2, 1, f"{tt.get('subtitle', '')} · {tt.get('total_hours', 0)} คาบ/สัปดาห์ · {tt['version']['name']}")
        ws.cell(2, 1).font = Font(color="64748B")
        ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=n + 1)
        for nt in tt.get("notices") or []:
            ws.cell(2, 1).value += f" · {nt['text']}" + (f" · ผู้รับผิดชอบ {', '.join(nt['teachers'])}" if nt.get("teachers") else "") + (
                f" (ที่ปรึกษา {nt['advisor']})" if nt.get("advisor") else "")
        head = ws.cell(3, 1, "วัน / คาบ")
        head.font, head.alignment, head.border = Font(bold=True, color="475569"), center, border
        head.fill = PatternFill("solid", fgColor="F8FAFC")
        for i, p in enumerate(periods, start=2):
            c = ws.cell(3, i, f"คาบ {p['no']}\n{p['start']}–{p['end']}")
            c.font, c.alignment, c.border = Font(bold=True, color="475569"), center, border
            c.fill = PatternFill("solid", fgColor="F8FAFC")
            ws.column_dimensions[get_column_letter(i)].width = 22
        ws.column_dimensions["A"].width = 11
        ws.row_dimensions[3].height = 32

        row = 4
        for d, day in enumerate(tt["days"]):
            items = [{"type": "e", "start": e["start"], "length": e["length"], "e": e}
                     for e in merge_electives(tt["entries"], tt["view"]) if e["day"] == d]
            items += [{"type": "v", "start": ev["start"], "length": ev["length"], "e": ev} for ev in tt["events"] if ev["day"] == d]
            # ตัดช่วงที่ทับพักเที่ยงออก
            split = []
            for it in items:
                seg = None
                for p_ in range(it["start"], it["start"] + it["length"]):
                    if p_ in lunch:
                        seg = None
                        continue
                    if seg is None:
                        seg = {**it, "start": p_, "length": 1}
                        split.append(seg)
                    else:
                        seg["length"] += 1
            lanes = _lanes(split)
            first = row
            for lane in lanes:
                lines = max([len(it["e"].get("members") or []) + 1 for it in lane if it["type"] == "e"] + [4])
                ws.row_dimensions[row].height = max(78, lines * 16)
                for col in range(2, n + 2):
                    ws.cell(row, col).border = border
                for it in lane:
                    col = it["start"] + 1
                    c = ws.cell(row, col)
                    if it["type"] == "e":
                        kind = _kind(it["e"])
                        c.value = entry_text(it["e"], tt["view"])
                        c.font = Font(size=9, color="0C4A6E")
                    else:
                        kind = it["e"]["kind"]
                        c.value = it["e"]["name"]
                        c.font = Font(size=9, bold=True, color="5B21B6" if kind == "activity" else "334155")
                    c.fill = PatternFill("solid", fgColor=FILL.get(kind, "F0F9FF"))
                    c.alignment = cell_align if it["type"] == "e" else center
                    c.border = Border(left=Side(style="thin", color=EDGE.get(kind)), right=Side(style="thin", color=EDGE.get(kind)),
                                      top=Side(style="thin", color=EDGE.get(kind)), bottom=Side(style="thin", color=EDGE.get(kind)))
                    if it["length"] > 1:
                        ws.merge_cells(start_row=row, start_column=col, end_row=row, end_column=col + it["length"] - 1)
                row += 1
            dc = ws.cell(first, 1, day)
            dc.font, dc.alignment, dc.border = Font(bold=True, color="1E293B"), center, border
            if row - first > 1:
                ws.merge_cells(start_row=first, start_column=1, end_row=row - 1, end_column=1)
            for lp in lunch:
                ws.cell(first, lp + 1).fill = PatternFill("solid", fgColor=FILL["lunch"])
        # พักกลางวัน: แถบเดียวตลอดทุกวัน มีคำเดียว
        for lp in lunch:
            lc = ws.cell(4, lp + 1, "พักกลางวัน")
            lc.fill, lc.alignment, lc.font = PatternFill("solid", fgColor=FILL["lunch"]), center, Font(size=10, bold=True, color="92400E")
            if row - 1 > 4:
                ws.merge_cells(start_row=4, start_column=lp + 1, end_row=row - 1, end_column=lp + 1)
        ws.freeze_panes = "B4"
        ws.page_setup.orientation = "landscape"
        ws.page_setup.paperSize = ws.PAPERSIZE_A4
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 1
        ws.sheet_properties.pageSetUpPr.fitToPage = True
    if not wb.sheetnames:
        wb.create_sheet("ว่าง")
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def rows_workbook(name: str, rows: list[list]) -> bytes:
    """รายงานแบบรายการ (ผลตรวจ, ภาระงานสอน ฯลฯ) เป็น Excel"""
    wb = Workbook()
    ws = wb.active
    ws.title = name[:30]
    for r in rows:
        ws.append(r)
    for c in ws[1]:
        c.font = Font(bold=True, color="3730A3")
        c.fill = PatternFill("solid", fgColor="EEF2FF")
    for i in range(1, (len(rows[0]) if rows else 1) + 1):
        ws.column_dimensions[get_column_letter(i)].width = 24
    ws.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
