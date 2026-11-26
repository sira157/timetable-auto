"""API ของระบบ (นอกเหนือจากระบบล็อกอิน)"""

from __future__ import annotations

import csv
import io
import json
import os
import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .auth import current_user, current_username, log_change, require_staff
from .core import (
    DataIndex,
    dataset_hash,
    default_settings,
    effective_busy,
    load_dataset,
    load_settings,
    save_settings,
    validate_settings,
)
from .data_io import (
    SHEETS,
    ImportError_,
    apply_admins,
    csv_zip,
    normalize_rows,
    parse_csv_files,
    parse_json,
    parse_xlsx,
    replace_all,
)
from . import jobs
from .db import BASE_DIR, SessionLocal, get_db
from .models import Assignment, ChangeHistory, RunHistory, ScheduleVersion, iso
from .curriculum_import import curriculum_workbook
from .export_xlsx import grid_workbook, rows_workbook
from .scheduler import PART_LABEL, run_schedule
from .validate import check_data, validate

SAMPLE_DIR = Path(os.environ.get("TIMETABLE_SAMPLE_DIR") or (BASE_DIR / "sample-data"))

router = APIRouter(prefix="/api")
staff = [Depends(require_staff)]

ENTITY_LABEL = {
    "teachers": "อาจารย์", "groups": "กลุ่มเรียน", "rooms": "ห้องเรียน/สนาม", "courses": "รายวิชา",
    "sections": "การเปิดสอน", "busy": "เวลาที่ไม่ว่าง",
}


def _strip_ids(data: dict) -> dict:
    return {k: [{f: v for f, v in r.items() if f != "id"} for r in rows] for k, rows in data.items()}


# ---------- การตั้งค่า ----------


@router.get("/settings", dependencies=staff)
def get_settings(db: Session = Depends(get_db)):
    s = load_settings(db)
    return {"settings": s, "problems": validate_settings(s), "defaults": default_settings()}


@router.put("/settings", dependencies=staff)
def put_settings(body: dict, request: Request, db: Session = Depends(get_db)):
    merged = {**default_settings(), **load_settings(db), **(body or {})}
    problems = validate_settings(merged)
    if problems:
        raise HTTPException(400, "การตั้งค่าไม่ถูกต้อง: " + "; ".join(problems))
    save_settings(db, merged)
    log_change(db, current_username(request), "แก้ไขการตั้งค่า", "ตั้งค่าเงื่อนไข", ", ".join(sorted(body.keys())))
    db.commit()
    return {"settings": merged, "problems": []}


@router.post("/settings/reset", dependencies=staff)
def reset_settings(request: Request, db: Session = Depends(get_db)):
    save_settings(db, default_settings())
    log_change(db, current_username(request), "คืนค่าเริ่มต้น", "ตั้งค่าเงื่อนไข")
    db.commit()
    return {"settings": default_settings(), "problems": []}


# ---------- ข้อมูลพื้นฐาน ----------


def _entity_spec(entity: str):
    if entity not in SHEETS:
        raise HTTPException(404, "ไม่พบประเภทข้อมูล")
    return SHEETS[entity]


@router.get("/data/summary", dependencies=staff)
def data_summary(db: Session = Depends(get_db)):
    settings = load_settings(db)
    data = load_dataset(db)
    check = check_data(data, settings)
    active = db.scalar(select(ScheduleVersion).where(ScheduleVersion.is_active.is_(True)))
    current_hash = dataset_hash(data, settings)
    rooms = [r for r in data["rooms"] if r.get("kind") != "field"]
    fields = [r for r in data["rooms"] if r.get("kind") == "field"]
    return {
        "counts": {
            "teachers": len([t for t in data["teachers"] if not t.get("is_excluded")]),
            "courses": len([c for c in data["courses"] if not c.get("is_excluded")]),
            "groups": len([g for g in data["groups"] if not g.get("is_excluded")]),
            "rooms": len(rooms), "fields": len(fields), "sections": len(data["sections"]),
            "busy": len(data["busy"]),
        },
        "readiness": check["counts"],
        "data_errors": sum(1 for g in check["general"] if g["level"] == "error"),
        "settings_problems": validate_settings(settings),
        "active": _version_summary(db, active, current_hash) if active else None,
        "versions": db.scalar(select(func.count()).select_from(ScheduleVersion)) or 0,
    }


@router.get("/data/check", dependencies=staff)
def data_check(db: Session = Depends(get_db)):
    data = load_dataset(db)
    result = check_data(data, load_settings(db))
    secs = {s["id"]: s for s in data["sections"]}
    for row in result["sections"]:
        row["section"] = secs.get(row["section_id"])
    return result


@router.get("/data/{entity}", dependencies=staff)
def list_entity(entity: str, db: Session = Depends(get_db)):
    _entity_spec(entity)
    return load_dataset(db)[entity]


def _clean_payload(entity: str, body: dict, db: Session) -> dict:
    days = load_settings(db)["days"]
    try:
        return normalize_rows(entity, [body or {}], days, excel=False)[0]
    except ImportError_ as e:
        raise HTTPException(400, str(e).replace(f"{SHEETS[entity]['title']} แถว 1: ", ""))


def _check_unique(entity: str, row: dict, db: Session, exclude_id: int | None = None):
    spec = SHEETS[entity]
    key = spec["key"]
    if not key:
        return
    model = spec["model"]
    q = select(model).where(getattr(model, key) == row[key])
    found = db.scalar(q)
    if found is not None and found.id != exclude_id:
        raise HTTPException(409, f"{row[key]} มีอยู่แล้ว")


@router.post("/data/{entity}", dependencies=staff)
def create_entity(entity: str, body: dict, request: Request, db: Session = Depends(get_db)):
    spec = _entity_spec(entity)
    row = _clean_payload(entity, body, db)
    _check_unique(entity, row, db)
    obj = spec["model"](**row)
    db.add(obj)
    db.flush()
    label = row.get(spec["key"]) if spec["key"] else f"#{obj.id}"
    log_change(db, current_username(request), "เพิ่ม", ENTITY_LABEL[entity], f"{label} {row.get('name', '')}".strip())
    db.commit()
    return {"id": obj.id, **row}


@router.put("/data/{entity}/{item_id}", dependencies=staff)
def update_entity(entity: str, item_id: int, body: dict, request: Request, db: Session = Depends(get_db)):
    spec = _entity_spec(entity)
    obj = db.get(spec["model"], item_id)
    if obj is None:
        raise HTTPException(404, "ไม่พบรายการ")
    row = _clean_payload(entity, body, db)
    _check_unique(entity, row, db, exclude_id=item_id)
    changed = [k for k, v in row.items() if getattr(obj, k) != v]
    for k, v in row.items():
        setattr(obj, k, v)
    label = row.get(spec["key"]) if spec["key"] else f"#{item_id}"
    log_change(db, current_username(request), "แก้ไข", ENTITY_LABEL[entity], f"{label}: {', '.join(changed) or '-'}")
    db.commit()
    return {"id": obj.id, **row}


@router.delete("/data/{entity}/{item_id}", dependencies=staff)
def delete_entity(entity: str, item_id: int, request: Request, db: Session = Depends(get_db)):
    spec = _entity_spec(entity)
    obj = db.get(spec["model"], item_id)
    if obj is None:
        raise HTTPException(404, "ไม่พบรายการ")
    label = getattr(obj, spec["key"]) if spec["key"] else f"#{item_id}"
    db.delete(obj)
    log_change(db, current_username(request), "ลบ", ENTITY_LABEL[entity], str(label))
    db.commit()
    return {"ok": True}


# ---------- นำเข้า/ส่งออก ----------


def _import_parsed(db: Session, parsed: dict, request: Request, source: str, admins: set | None = None) -> dict:
    warnings = parsed.pop("_warnings", [])
    counts = replace_all(db, parsed)
    if admins is not None:
        try:
            counts["admins"] = apply_admins(db, admins)
        except ImportError_ as e:
            db.rollback()
            raise HTTPException(400, str(e))
    label = {**ENTITY_LABEL, "admins": "ฝ่ายบริหาร"}
    log_change(db, current_username(request), "นำเข้าข้อมูล", "ข้อมูลพื้นฐาน",
               f"{source}: " + ", ".join(f"{label[k]} {v}" for k, v in counts.items()))
    db.commit()
    core = {"teachers", "groups", "rooms", "courses", "sections"}
    return {"ok": True, "counts": counts, "partial": not core <= set(counts), "warnings": warnings}


@router.post("/import", dependencies=staff)
async def import_file(request: Request, files: list[UploadFile] = File(...), db: Session = Depends(get_db)):
    """นำเข้า: Excel/JSON 1 ไฟล์ = แทนที่ทั้งหมด, CSV หลายไฟล์หรือ .zip = แทนที่เฉพาะชนิดที่มีในไฟล์"""
    items = []
    for f in files:
        content = await f.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(400, f"{f.filename}: ไฟล์ใหญ่เกิน 10 MB")
        items.append(((f.filename or "").strip(), content))
    days = load_settings(db)["days"]
    kinds = {name.lower().rsplit(".", 1)[-1] for name, _ in items}
    names = ", ".join(n for n, _ in items)
    try:
        if kinds <= {"csv", "zip"}:
            parsed, admins = parse_csv_files(items, days)
            return _import_parsed(db, parsed, request, names, admins)
        if len(items) != 1:
            raise ImportError_("เลือกไฟล์ Excel หรือ JSON ครั้งละ 1 ไฟล์ (CSV เลือกได้หลายไฟล์)")
        name, content = items[0]
        if name.lower().endswith(".json"):
            parsed = parse_json(content, days)
        elif name.lower().endswith(".xlsx"):
            parsed = parse_xlsx(content, days)
        else:
            raise ImportError_("รองรับไฟล์ .xlsx .csv .zip และ .json")
    except ImportError_ as e:
        raise HTTPException(400, str(e))
    return _import_parsed(db, parsed, request, names)


SAMPLE_SIZES = {"small": "เล็ก", "medium": "กลาง", "large": "ใหญ่"}


def _sample_path(size: str) -> Path:
    if size not in SAMPLE_SIZES:
        raise HTTPException(404, "ไม่พบชุดข้อมูลตัวอย่าง")
    path = SAMPLE_DIR / f"{size}.json"
    if not path.exists():
        raise HTTPException(404, "ไม่พบไฟล์ข้อมูลตัวอย่าง")
    return path


@router.get("/samples", dependencies=staff)
def list_samples():
    out = []
    for size, label in SAMPLE_SIZES.items():
        path = SAMPLE_DIR / f"{size}.json"
        if path.exists():
            d = json.loads(path.read_text(encoding="utf-8"))
            out.append({"size": size, "label": label, "teachers": len(d["teachers"]), "groups": len(d["groups"]),
                        "courses": len(d["courses"]), "sections": len(d["sections"]), "rooms": len(d["rooms"])})
    return out


@router.post("/import/sample", dependencies=staff)
def import_sample(request: Request, size: str = "medium", db: Session = Depends(get_db)):
    try:
        parsed = parse_json(_sample_path(size).read_bytes(), load_settings(db)["days"])
    except ImportError_ as e:
        raise HTTPException(400, str(e))
    return _import_parsed(db, parsed, request, f"ข้อมูลตัวอย่างชุด{SAMPLE_SIZES[size]}")


@router.get("/samples/{size}.{fmt}", dependencies=staff)
def download_sample(size: str, fmt: str, db: Session = Depends(get_db)):
    """ดาวน์โหลดชุดตัวอย่างเป็นไฟล์จริง เพื่อทดลองนำเข้าทุกรูปแบบ"""
    path = _sample_path(size)
    label = SAMPLE_SIZES[size]
    if fmt == "json":
        return _attachment(path.read_bytes(), "application/json", f"ตัวอย่าง-{label}.json")
    days = load_settings(db)["days"]
    parsed = parse_json(path.read_bytes(), days)
    if fmt == "xlsx":
        return _attachment(curriculum_workbook(parsed, load_settings(db)), XLSX, f"ตัวอย่างข้อมูลหลักสูตร-{label}.xlsx")
    if fmt == "zip":
        return _attachment(csv_zip(days, parsed), "application/zip", f"ตัวอย่าง-{label}-csv.zip")
    raise HTTPException(404, "ไม่รองรับรูปแบบนี้")


XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _attachment(content: bytes, media: str, filename: str) -> Response:
    from urllib.parse import quote

    return Response(content, media_type=media, headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
    })


@router.get("/export/template.xlsx", dependencies=staff)
def export_template(db: Session = Depends(get_db)):
    """แบบฟอร์มรูปแบบเดียวกับไฟล์ข้อมูลหลักสูตร (ชีตชั้นปี / ฝ่ายบริหาร / สถานที่เรียน)"""
    return _attachment(curriculum_workbook(None, load_settings(db)), XLSX, "แบบฟอร์มข้อมูลหลักสูตร.xlsx")


@router.get("/export/template.zip", dependencies=staff)
def export_template_csv(db: Session = Depends(get_db)):
    return _attachment(csv_zip(load_settings(db)["days"]), "application/zip", "แบบฟอร์มข้อมูลตารางสอน-csv.zip")


@router.get("/export/data.xlsx", dependencies=staff)
def export_data_xlsx(db: Session = Depends(get_db)):
    return _attachment(curriculum_workbook(load_dataset(db), load_settings(db)), XLSX, "ข้อมูลหลักสูตร.xlsx")


@router.get("/export/data.zip", dependencies=staff)
def export_data_csv(db: Session = Depends(get_db)):
    return _attachment(csv_zip(load_settings(db)["days"], load_dataset(db)), "application/zip", "ข้อมูลตารางสอน-csv.zip")


@router.get("/export/data.json", dependencies=staff)
def export_data_json(db: Session = Depends(get_db)):
    data = _strip_ids(load_dataset(db))
    data["admins"] = [t["code"] for t in data["teachers"] if t.get("is_admin")]
    payload = {"format": "timetable-dataset", "version": 2, **data}
    return _attachment(json.dumps(payload, ensure_ascii=False, indent=1).encode("utf-8"), "application/json",
                       "ข้อมูลตารางสอน.json")


# ---------- การจัดตาราง ----------


def _version_summary(db: Session, v: ScheduleVersion, current_hash: str | None = None) -> dict:
    errors = sum(1 for i in v.issues or [] if i["level"] == "error")
    warnings = sum(1 for i in v.issues or [] if i["level"] == "warning")
    return {
        "id": v.id, "name": v.name, "created_at": iso(v.created_at),
        "created_by": v.created_by, "is_active": v.is_active, "relaxed_gap": v.relaxed_gap, "stats": v.stats,
        "errors": errors, "warnings": warnings, "unplaced": len(v.unplaced or []),
        "data_changed": current_hash is not None and current_hash != v.data_hash,
    }


class RunIn(BaseModel):
    name: str = ""
    keep_locks: bool = True
    wait: bool = False  # True = รอผลในคำขอเดียว (ใช้กับสคริปต์/การทดสอบ)


def _prepare_run(db: Session, keep_locks: bool):
    settings = load_settings(db)
    problems = validate_settings(settings)
    if problems:
        raise HTTPException(400, "ตั้งค่าเวลาไม่ถูกต้อง: " + "; ".join(problems))
    data = load_dataset(db)
    if not data["sections"]:
        raise HTTPException(400, "ยังไม่มีข้อมูล นำเข้าข้อมูลก่อน")
    locks = {}
    active = db.scalar(select(ScheduleVersion).where(ScheduleVersion.is_active.is_(True)))
    if keep_locks and active:
        for a in db.scalars(select(Assignment).where(Assignment.version_id == active.id, Assignment.locked.is_(True))):
            locks[(a.section_id, a.block_index)] = {"day": a.day, "start": a.start, "room": a.room, "field": a.field}
    return settings, data, locks


def _execute_run(db: Session, name: str, username: str, settings: dict, data: dict, locks: dict,
                 progress=None, cancel=None) -> ScheduleVersion:
    report = progress or (lambda *_a, **_k: None)
    result = run_schedule(data, settings, locks, progress=progress, cancel=cancel)
    report("check", 0.0, {})
    count = db.scalar(select(func.count()).select_from(ScheduleVersion)) or 0
    version = ScheduleVersion(
        name=(name or "").strip() or f"ตารางสอน ครั้งที่ {count + 1}", created_by=username,
        is_active=True, data_hash=dataset_hash(data, settings), relaxed_gap=result["relaxed_gap"],
        stats=result["stats"], issues=[], unplaced=result["unplaced"], notices=result["notices"], settings=settings,
    )
    for v in db.scalars(select(ScheduleVersion).where(ScheduleVersion.is_active.is_(True))):
        v.is_active = False
    db.add(version)
    db.flush()
    rows = []
    for a in result["assignments"]:
        row = Assignment(version_id=version.id, **a)
        db.add(row)
        rows.append(row)
    db.flush()
    version.issues = validate(data, settings, [_assignment_dict(r) for r in rows])
    if result["relaxed_gap"]:
        version.issues.insert(0, {
            "level": "warning", "type": "relaxed",
            "message": "บางกลุ่มมีคาบว่างเกิน 3 คาบ เพื่อให้จัดวิชาได้ครบ",
        })
    report("save", 0.5, {})
    errors = sum(1 for i in version.issues if i["level"] == "error")
    warnings = sum(1 for i in version.issues if i["level"] == "warning")
    st = result["stats"]
    db.add(RunHistory(
        username=username, version_id=version.id, duration_ms=st["duration_ms"], placed_hours=st["placed_hours"],
        total_hours=st["total_hours"], errors=errors, warnings=warnings, relaxed_gap=result["relaxed_gap"],
        message=(
            f"{'CP-SAT' if st.get('method') == 'cpsat' else 'Greedy'}: จัดได้ {st['placed_hours']}/{st['total_hours']} ชม., "
            f"จัดไม่ได้ {len(result['unplaced'])} รายการ"
        ),
    ))
    log_change(db, username, "จัดตาราง", "ตารางสอน", f"{version.name} (ล็อกไว้ {st['locks_kept']} คาบ)")
    db.commit()
    return version


@router.post("/schedule/run", dependencies=staff)
def schedule_run(body: RunIn, request: Request, db: Session = Depends(get_db)):
    username = current_username(request)
    settings, data, locks = _prepare_run(db, body.keep_locks)
    if body.wait:
        return _version_detail(db, _execute_run(db, body.name, username, settings, data, locks))

    def work(job: jobs.Job) -> int:
        session = SessionLocal()
        try:
            return _execute_run(session, body.name, username, settings, data, locks, job.progress, job.cancel).id
        finally:
            session.close()

    try:
        job = jobs.start(username, {"name": body.name, "keep_locks": body.keep_locks,
                                    "budget_sec": settings.get("time_budget_sec")}, work)
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return job.public()


@router.get("/schedule/jobs/current", dependencies=staff)
def job_current():
    job = jobs.current()
    return job.public() if job else None


@router.get("/schedule/jobs/{job_id}", dependencies=staff)
def job_status(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "ไม่พบงานนี้ (เซิร์ฟเวอร์อาจรีสตาร์ต) กดลองใหม่")
    return job.public()


@router.post("/schedule/jobs/{job_id}/cancel", dependencies=staff)
def job_cancel(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "ไม่พบงานนี้")
    job.cancel.set()
    return job.public()


def _assignment_dict(a: Assignment) -> dict:
    return {
        "id": a.id, "section_id": a.section_id, "block_index": a.block_index, "unit_key": a.unit_key, "part": a.part,
        "kind": a.kind, "day": a.day, "start": a.start, "length": a.length, "room": a.room, "field": a.field,
        "locked": a.locked,
        "course_code": a.course_code, "course_name": a.course_name, "teacher_codes": list(a.teacher_codes or []),
        "group_codes": list(a.group_codes or []),
    }


def _version_detail(db: Session, v: ScheduleVersion) -> dict:
    current_hash = dataset_hash(load_dataset(db), load_settings(db))
    return {**_version_summary(db, v, current_hash), "issues": v.issues, "unplaced": v.unplaced, "notices": v.notices}


def _get_version(db: Session, vid: int) -> ScheduleVersion:
    v = db.get(ScheduleVersion, vid)
    if v is None:
        raise HTTPException(404, "ไม่พบตารางสอนรุ่นนี้")
    return v


@router.get("/schedule/active")
def schedule_active(request: Request, db: Session = Depends(get_db)):
    v = db.scalar(select(ScheduleVersion).where(ScheduleVersion.is_active.is_(True)))
    if v is None:
        return None
    user = current_user(request)
    if user is not None and user.role != "staff":
        return {"id": v.id, "name": v.name, "created_at": iso(v.created_at)}
    return _version_detail(db, v)


@router.get("/schedule/versions", dependencies=staff)
def list_versions(db: Session = Depends(get_db)):
    current_hash = dataset_hash(load_dataset(db), load_settings(db))
    rows = db.scalars(select(ScheduleVersion).order_by(ScheduleVersion.id.desc())).all()
    return [_version_summary(db, v, current_hash) for v in rows]


@router.get("/schedule/versions/{vid}", dependencies=staff)
def get_version(vid: int, db: Session = Depends(get_db)):
    return _version_detail(db, _get_version(db, vid))


@router.post("/schedule/versions/{vid}/activate", dependencies=staff)
def activate_version(vid: int, request: Request, db: Session = Depends(get_db)):
    v = _get_version(db, vid)
    for other in db.scalars(select(ScheduleVersion).where(ScheduleVersion.is_active.is_(True))):
        other.is_active = False
    v.is_active = True
    log_change(db, current_username(request), "เลือกใช้ตาราง", "ตารางสอน", v.name)
    db.commit()
    return _version_detail(db, v)


class RenameIn(BaseModel):
    name: str


@router.patch("/schedule/versions/{vid}", dependencies=staff)
def rename_version(vid: int, body: RenameIn, request: Request, db: Session = Depends(get_db)):
    v = _get_version(db, vid)
    if not body.name.strip():
        raise HTTPException(400, "กรุณาใส่ชื่อ")
    old = v.name
    v.name = body.name.strip()
    log_change(db, current_username(request), "เปลี่ยนชื่อตาราง", "ตารางสอน", f"{old} → {v.name}")
    db.commit()
    return _version_detail(db, v)


@router.delete("/schedule/versions/{vid}", dependencies=staff)
def delete_version(vid: int, request: Request, db: Session = Depends(get_db)):
    v = _get_version(db, vid)
    db.execute(delete(Assignment).where(Assignment.version_id == vid))
    db.delete(v)
    log_change(db, current_username(request), "ลบตาราง", "ตารางสอน", v.name)
    db.commit()
    return {"ok": True}


def group_label(idx: DataIndex, codes: list[str]) -> str:
    """ชื่อกลุ่มแบบสั้น: ถ้าเป็นทุกกลุ่มของชั้นปี แสดง "ปี 1 (ทั้งชั้น)" """
    years = idx.section_years(codes)
    if len(years) == 1 and len(codes) > 1:
        y = next(iter(years))
        if set(codes) >= set(idx.year_groups.get(y, [])):
            return f"ปี {y} (ทั้งชั้น)"
    return ", ".join(idx.group_name(c) for c in codes)


def _timetable(db: Session, v: ScheduleVersion, view: str, ident: str) -> dict:
    data = load_dataset(db)
    settings = v.settings or load_settings(db)
    idx = DataIndex(data, settings)
    rows = [_assignment_dict(a) for a in db.scalars(select(Assignment).where(Assignment.version_id == v.id))]
    title, subtitle = "", ""
    events: list[dict] = []
    notices: list[dict] = []
    kind_label = {"meeting": "ประชุม", "activity": "กิจกรรม", "unavailable": "ไม่ว่าง", "advisor": "พบอาจารย์ที่ปรึกษา"}
    all_busy = effective_busy(data, settings)

    def busy_events(match):
        for b in all_busy:
            if match(b):
                events.append({
                    "kind": "activity" if b["kind"] in ("activity", "advisor") else "meeting",
                    "name": b.get("name") or kind_label.get(b["kind"], ""), "day": b["day"],
                    "start": b["start"], "length": b["end"] - b["start"] + 1,
                })

    if view == "teacher":
        t = next((x for x in data["teachers"] if str(x["id"]) == ident), None)
        if t is None:
            raise HTTPException(404, "ไม่พบอาจารย์")
        rows = [a for a in rows if t["code"] in a["teacher_codes"]]
        title, subtitle = f"ตารางสอน {t['name']}", f"รหัส {t['code']}"
        busy_events(lambda b: t["code"] in (b.get("teacher_codes") or []))
        for n in v.notices or []:
            if n.get("type") == "internship" and t["code"] in (n.get("teacher_codes") or []):
                notices.append({
                    "text": f"รับผิดชอบรายวิชา {n['course_code']} {n.get('course_name', '')} (ไม่มีคาบสอน)",
                    "course": f"{n['course_code']} {n.get('course_name', '')}", "advisor": "",
                })
    elif view == "group":
        g = next((x for x in data["groups"] if str(x["id"]) == ident), None)
        if g is None:
            raise HTTPException(404, "ไม่พบกลุ่มเรียน")
        rows = [a for a in rows if g["code"] in a["group_codes"]]
        title = f"ตารางเรียน {g['name']}"
        subtitle = f"ชั้นปี {g['year']} · ห้องประจำ {g.get('homeroom') or '-'} · {g.get('size') or 0} คน"
        busy_events(lambda b: g["code"] in idx.section_groups({"group_codes": b.get("group_codes") or []})[0])
        for n in v.notices or []:
            if n.get("type") == "internship" and g["code"] in (n.get("group_codes") or []):
                notices.append({
                    "text": f"{n['course_code']} {n.get('course_name', '')} · ฝึกสอนในสถานศึกษาตลอดภาคเรียน ไม่มีคาบเรียน",
                    "course": f"{n['course_code']} {n.get('course_name', '')}",
                    "advisor": idx.teacher_name(g["advisor"]) if g.get("advisor") else "",
                    "teachers": [idx.teacher_name(c) for c in n.get("teacher_codes") or []],
                })
    elif view == "room":
        if ident not in idx.rooms:
            raise HTTPException(404, "ไม่พบห้องเรียน")
        r = idx.rooms[ident]
        rows = [a for a in rows if ident in (a["room"], a.get("field"))]
        title = f"ตารางการใช้ {ident}"
        subtitle = f"{r.get('building') or ''} · จุ {r.get('capacity') or 0} คน"
    elif view == "building":
        names = {r["name"] for r in data["rooms"] if (r.get("building") or "") == ident}
        if not names:
            raise HTTPException(404, "ไม่พบอาคาร")
        rows = [a for a in rows if a["room"] in names or a.get("field") in names]
        title, subtitle = f"ตารางการใช้ {ident}", f"{len(names)} ห้อง/จุด"
    else:
        raise HTTPException(400, "มุมมองไม่ถูกต้อง")

    teacher_code = t["code"] if view == "teacher" else None
    entries = []
    for a in rows:
        course = idx.courses.get(a["course_code"]) or {}
        entries.append({
            **a,
            "credits": course.get("credits", ""),
            "elective_set": course.get("elective_set", "") if a["kind"] in ("elective", "free") else "",
            "group_label": group_label(idx, a["group_codes"]),
            "part_label": PART_LABEL.get(a["part"], ""),
            "teachers": [idx.teacher_name(c) for c in a["teacher_codes"]],
            "groups": [idx.group_name(c) for c in a["group_codes"]],
            "coteach": len(a["teacher_codes"]) > 1,
            # ตารางอาจารย์: แสดงรายชื่อผู้สอนร่วมอีกคน (ข้อ 3.2)
            "co_teachers": [idx.teacher_name(c) for c in a["teacher_codes"] if view != "teacher" or c != teacher_code],
        })
    entries.sort(key=lambda e: (e["day"], e["start"]))
    # นับชั่วโมง: วิชาเลือกที่คาบซ้อนกันในมุมมองกลุ่มนับครั้งเดียว
    slots = {(e["day"], p) for e in entries for p in range(e["start"], e["start"] + e["length"])}
    return {
        "version": {"id": v.id, "name": v.name, "created_at": iso(v.created_at)},
        "view": view, "id": ident, "title": title, "subtitle": subtitle,
        "days": settings["days"], "periods": settings["periods"], "lunch_periods": settings.get("lunch_periods") or [],
        "entries": entries, "events": events, "notices": notices, "total_hours": len(slots),
    }


@router.get("/schedule/versions/{vid}/timetable")
def get_timetable(vid: int, view: str, id: str, db: Session = Depends(get_db)):
    return _timetable(db, _get_version(db, vid), view, id)


class AssignmentPatch(BaseModel):
    day: int | None = None
    start: int | None = None
    room: str | None = None
    field: str | None = None
    locked: bool | None = None


@router.patch("/schedule/assignments/{aid}", dependencies=staff)
def patch_assignment(aid: int, body: AssignmentPatch, request: Request, db: Session = Depends(get_db)):
    a = db.get(Assignment, aid)
    if a is None:
        raise HTTPException(404, "ไม่พบคาบนี้")
    v = _get_version(db, a.version_id)
    settings = v.settings or load_settings(db)
    n = len(settings["periods"])
    lunch = set(settings.get("lunch_periods") or [])
    unit = db.scalars(select(Assignment).where(Assignment.version_id == v.id, Assignment.unit_key == a.unit_key)).all()
    changes = []
    if body.day is not None or body.start is not None:
        day = a.day if body.day is None else body.day
        start = a.start if body.start is None else body.start
        if not (0 <= day < len(settings["days"])):
            raise HTTPException(400, "วันไม่ถูกต้อง")
        longest = max(x.length for x in unit)
        if start < 1 or start + longest - 1 > n:
            raise HTTPException(400, "เกินคาบสุดท้ายของวัน")
        if any(p in lunch for p in range(start, start + longest)):
            raise HTTPException(400, "วางทับพักเที่ยงไม่ได้")
        for x in unit:  # ย้ายทั้งหน่วย (เช่น วิชาเลือกในกลุ่มเดียวกัน) เพื่อให้ยังอยู่เวลาเดียวกัน
            x.day, x.start = day, start
        changes.append(f"ย้ายไปวัน{settings['days'][day]} คาบ {start}")
    if body.room is not None:
        a.room = body.room or None
        changes.append(f"ห้อง {a.room or '-'}")
    if body.field is not None:
        a.field = body.field or None
        changes.append(f"โรงยิม/สนาม {a.field or '-'}")
    if body.locked is not None:
        for x in unit:
            x.locked = body.locked
        changes.append("ล็อก" if body.locked else "ปลดล็อก")
    db.flush()
    data = load_dataset(db)
    all_rows = db.scalars(select(Assignment).where(Assignment.version_id == v.id)).all()
    v.issues = validate(data, settings, [_assignment_dict(r) for r in all_rows])
    log_change(db, current_username(request), "แก้ไขคาบ", "ตารางสอน",
               f"{v.name}: {a.course_code} {', '.join(changes)}")
    db.commit()
    return {"assignment": _assignment_dict(a), "errors": sum(1 for i in v.issues if i["level"] == "error"),
            "warnings": sum(1 for i in v.issues if i["level"] == "warning")}


@router.get("/schedule/assignments/{aid}/moves", dependencies=staff)
def assignment_moves(aid: int, db: Session = Depends(get_db)):
    """ตรวจทุกช่องว่าย้ายคาบนี้ (ทั้งหน่วย) ไปวางได้หรือไม่ พร้อมเหตุผลสั้นๆ ใช้แสดงช่องสีเขียวตอนลากวาง"""
    a = db.get(Assignment, aid)
    if a is None:
        raise HTTPException(404, "ไม่พบคาบนี้")
    v = _get_version(db, a.version_id)
    settings = v.settings or load_settings(db)
    data = load_dataset(db)
    from .scheduler import Prepared, pair_ok

    prep = Prepared(DataIndex(data, settings), None)
    all_rows = db.scalars(select(Assignment).where(Assignment.version_id == v.id)).all()
    unit = [x for x in all_rows if x.unit_key == a.unit_key]
    others = [x for x in all_rows if x.unit_key != a.unit_key]
    t_occ, g_occ, r_occ = set(), set(), set()
    sec_slots: dict[tuple, list] = {}
    for x in others:
        for p_ in range(x.start, x.start + x.length):
            for t in x.teacher_codes or []:
                t_occ.add((t, x.day, p_))
            for g in x.group_codes or []:
                g_occ.add((g, x.day, p_))
            for r in (x.room, x.field):
                if r:
                    r_occ.add((r, x.day, p_))
        sec_slots.setdefault((x.section_id, x.day), []).append((x.start, x.length, x.part))
    n = len(settings["periods"])
    lunch = set(settings.get("lunch_periods") or [])
    length = max(x.length for x in unit)
    slots = []
    for d in range(len(settings["days"])):
        for start in range(1, n - length + 2):
            span = range(start, start + length)
            if any(p_ in lunch for p_ in span):
                continue
            reason = ""
            for x in unit:
                own = range(start, start + x.length)
                if any((t, d, p_) in prep.teacher_busy for t in x.teacher_codes or [] for p_ in own):
                    reason = "ครูติดประชุม/พบที่ปรึกษา"
                elif any((g, d, p_) in prep.group_busy for g in x.group_codes or [] for p_ in span):
                    reason = "ช่วงกิจกรรม/พบที่ปรึกษา"
                elif any((t, d, p_) in t_occ for t in x.teacher_codes or [] for p_ in own):
                    reason = "ครูสอนวิชาอื่น"
                elif any((g, d, p_) in g_occ for g in x.group_codes or [] for p_ in span):
                    reason = "กลุ่มเรียนมีวิชาอื่น"
                elif any((r, d, p_) in r_occ for r in (x.room, x.field) if r for p_ in own):
                    reason = "ห้อง/สนามไม่ว่าง"
                elif (x.section_id, d) in sec_slots and not (
                    len(sec_slots[(x.section_id, d)]) == 1
                    and pair_ok(sec_slots[(x.section_id, d)][0], (start, x.length, x.part))
                ):
                    reason = "วิชานี้มีคาบวันนี้แล้ว"
                if reason:
                    break
            slots.append({"day": d, "start": start, "ok": not reason, "reason": reason,
                          "current": d == a.day and start == a.start})
    return {"length": length, "slots": slots, "linked": len(unit) > 1}


# ---------- รายงาน ----------


def _csv(rows: list[list], filename: str) -> Response:
    buf = io.StringIO()
    writer = csv.writer(buf)
    for r in rows:
        writer.writerow(r)
    return _attachment(("﻿" + buf.getvalue()).encode("utf-8"), "text/csv; charset=utf-8", filename)


def _timetable_rows(tt: dict) -> list[list]:
    periods = {p["no"]: p for p in tt["periods"]}
    out = []
    for e in tt["entries"]:
        p1, p2 = periods.get(e["start"]), periods.get(e["start"] + e["length"] - 1)
        out.append([
            tt["title"], tt["days"][e["day"]], f"{e['start']}-{e['start'] + e['length'] - 1}",
            f"{p1['start'] if p1 else ''}-{p2['end'] if p2 else ''}", e["course_code"], e["course_name"],
            e.get("credits", ""), ", ".join(e["teachers"]), e.get("group_label") or ", ".join(e["groups"]),
            " + ".join(x for x in (e["room"], e.get("field")) if x),
        ])
    return out


@router.get("/reports/{key}")
def report(key: str, request: Request, id: str | None = None, version_id: int | None = None,
           format: str = "csv", db: Session = Depends(get_db)):
    user = current_user(request)
    is_staff = user is None or user.role == "staff"
    if version_id is None:
        v = db.scalar(select(ScheduleVersion).where(ScheduleVersion.is_active.is_(True)))
        if v is None:
            raise HTTPException(404, "ยังไม่มีตารางสอนที่ใช้งานอยู่")
    else:
        v = _get_version(db, version_id)
    data = load_dataset(db)
    header = ["ตาราง", "วัน", "คาบ", "เวลา", "รหัสวิชา", "ชื่อวิชา", "หน่วยกิต", "ผู้สอน", "กลุ่มเรียน",
              "สถานที่เรียน"]
    grids: list[dict] = []

    def many(view, items, ident_of):
        rows = [header]
        for it in items:
            tt = _timetable(db, v, view, ident_of(it))
            grids.append(tt)
            rows += _timetable_rows(tt)
        return rows

    if key == "teacher_timetables":
        items = [t for t in data["teachers"] if id is None or str(t["id"]) == id]
        rows, name = many("teacher", items, lambda t: str(t["id"])), "ตารางสอนอาจารย์"
    elif key == "group_timetables":
        items = [g for g in data["groups"] if id is None or str(g["id"]) == id]
        rows, name = many("group", items, lambda g: str(g["id"])), "ตารางเรียนกลุ่มเรียน"
    elif not is_staff:
        raise HTTPException(403, "บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้")
    elif key == "room_timetables":
        items = [r for r in data["rooms"] if id is None or r["name"] == id]
        rows, name = many("room", items, lambda r: r["name"]), "ตารางการใช้ห้องเรียน"
    elif key == "issues":
        rows = [["ระดับ", "ประเภท", "รายละเอียด"]] + [
            ["ข้อผิดพลาด" if i["level"] == "error" else "คำเตือน", i["type"], i["message"]] for i in v.issues or []
        ]
        name = "ผลการตรวจสอบ"
    elif key == "unplaced":
        rows = [["รหัสวิชา", "ชื่อวิชา", "ชั่วโมง", "กลุ่มเรียน", "ผู้สอน", "เหตุผล"]] + [
            [u["course_code"], u.get("course_name", ""), u.get("hours", ""), ", ".join(u.get("group_codes") or []),
             ", ".join(u.get("teacher_codes") or []), u["reason"]] for u in v.unplaced or []
        ]
        name = "วิชาที่จัดไม่ได้"
    elif key == "teacher_load":
        idx = DataIndex(data, v.settings or load_settings(db))
        load: dict[str, int] = {}
        for a in db.scalars(select(Assignment).where(Assignment.version_id == v.id)):
            for t in a.teacher_codes or []:
                load[t] = load.get(t, 0) + a.length
        rows = [["รหัสอาจารย์", "ชื่อ", "ชั่วโมงสอน/สัปดาห์"]] + [
            [t["code"], t["name"], load.get(t["code"], 0)] for t in data["teachers"]
        ]
        del idx
        name = "ภาระงานสอน"
    else:
        raise HTTPException(404, "ไม่พบรายงาน")
    if format == "json":
        return {"name": name, "rows": rows}
    if format == "xlsx":
        content = grid_workbook(grids) if grids else rows_workbook(name, rows)
        return _attachment(content, XLSX, f"{name}-{v.name}.xlsx")
    return _csv(rows, f"{name}-{v.name}.csv")


# ---------- สำรอง/กู้คืน/ล้างข้อมูล ----------


@router.get("/backup", dependencies=staff)
def backup(db: Session = Depends(get_db)):
    versions = []
    for v in db.scalars(select(ScheduleVersion).order_by(ScheduleVersion.id)):
        versions.append({
            "name": v.name, "created_at": iso(v.created_at),
            "created_by": v.created_by, "is_active": v.is_active, "data_hash": v.data_hash,
            "relaxed_gap": v.relaxed_gap, "stats": v.stats, "issues": v.issues, "unplaced": v.unplaced,
            "notices": v.notices, "settings": v.settings,
            "assignments": [
                {k: val for k, val in _assignment_dict(a).items() if k != "id"}
                for a in db.scalars(select(Assignment).where(Assignment.version_id == v.id))
            ],
        })
    payload = {
        "format": "timetable-backup", "version": 1, "settings": load_settings(db),
        "data": _strip_ids(load_dataset(db)), "schedules": versions,
    }
    content = json.dumps(payload, ensure_ascii=False, indent=1).encode("utf-8")
    return _attachment(content, "application/json", "สำรองข้อมูลตารางสอน.json")


@router.post("/backup/restore", dependencies=staff)
async def restore(request: Request, file: UploadFile = File(...), db: Session = Depends(get_db)):
    content = await file.read()
    try:
        payload = json.loads(content.decode("utf-8-sig"))
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "ไฟล์สำรองไม่ถูกต้อง")
    if not isinstance(payload, dict) or payload.get("format") != "timetable-backup":
        raise HTTPException(400, "ไฟล์นี้ไม่ใช่ไฟล์สำรองของระบบ")
    settings = {**default_settings(), **(payload.get("settings") or {})}
    problems = validate_settings(settings)
    if problems:
        raise HTTPException(400, "การตั้งค่าในไฟล์สำรองไม่ถูกต้อง: " + "; ".join(problems))
    try:
        parsed = parse_json(json.dumps(payload.get("data") or {}).encode("utf-8"), settings["days"])
    except ImportError_ as e:
        raise HTTPException(400, str(e))
    save_settings(db, settings)
    replace_all(db, parsed)
    db.execute(delete(Assignment))
    db.execute(delete(ScheduleVersion))
    from datetime import datetime

    for sv in payload.get("schedules") or []:
        v = ScheduleVersion(
            name=sv.get("name") or "ตารางสอน", created_by=sv.get("created_by") or "",
            is_active=bool(sv.get("is_active")), data_hash=sv.get("data_hash") or "",
            relaxed_gap=bool(sv.get("relaxed_gap")), stats=sv.get("stats") or {}, issues=sv.get("issues") or [],
            unplaced=sv.get("unplaced") or [], notices=sv.get("notices") or [], settings=sv.get("settings") or settings,
        )
        if sv.get("created_at"):
            try:
                v.created_at = datetime.fromisoformat(sv["created_at"])
            except ValueError:
                pass
        db.add(v)
        db.flush()
        allowed = {c.name for c in Assignment.__table__.columns} - {"id", "version_id"}
        for a in sv.get("assignments") or []:
            db.add(Assignment(version_id=v.id, **{k: val for k, val in a.items() if k in allowed}))
    log_change(db, current_username(request), "กู้คืนข้อมูล", "ข้อมูลทั้งหมด", file.filename or "")
    db.commit()
    return {"ok": True}


class ClearIn(BaseModel):
    target: str


@router.post("/backup/clear", dependencies=staff)
def clear(body: ClearIn, request: Request, db: Session = Depends(get_db)):
    if body.target not in ("data", "schedules", "all"):
        raise HTTPException(400, "ไม่รู้จักรายการที่จะล้าง")
    if body.target in ("schedules", "all"):
        db.execute(delete(Assignment))
        db.execute(delete(ScheduleVersion))
    if body.target in ("data", "all"):
        for spec in SHEETS.values():
            db.execute(delete(spec["model"]))
    label = {"data": "ข้อมูลพื้นฐาน", "schedules": "ตารางสอนทุกรุ่น", "all": "ข้อมูลพื้นฐานและตารางสอน"}[body.target]
    log_change(db, current_username(request), "ล้างข้อมูล", label)
    db.commit()
    return {"ok": True}


# ---------- ประวัติ ----------


@router.get("/history/changes", dependencies=staff)
def history_changes(limit: int = 300, q: str = "", db: Session = Depends(get_db)):
    stmt = select(ChangeHistory).order_by(ChangeHistory.id.desc()).limit(min(max(limit, 1), 1000))
    rows = db.scalars(stmt).all()
    out = [{"id": r.id, "at": iso(r.at), "username": r.username, "action": r.action,
            "entity": r.entity, "detail": r.detail} for r in rows]
    if q:
        pattern = re.compile(re.escape(q), re.I)
        out = [r for r in out if any(pattern.search(str(r[k])) for k in ("username", "action", "entity", "detail"))]
    return out


@router.get("/history/runs", dependencies=staff)
def history_runs(db: Session = Depends(get_db)):
    rows = db.scalars(select(RunHistory).order_by(RunHistory.id.desc()).limit(200)).all()
    return [{
        "id": r.id, "at": iso(r.at), "username": r.username, "version_id": r.version_id,
        "duration_ms": r.duration_ms, "placed_hours": r.placed_hours, "total_hours": r.total_hours,
        "errors": r.errors, "warnings": r.warnings, "relaxed_gap": r.relaxed_gap, "message": r.message,
    } for r in rows]
