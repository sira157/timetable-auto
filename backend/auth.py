"""ระบบล็อกอิน บัญชีผู้ใช้ และตัวป้องกัน API ตาม docs/auth-rules.md

หลักการ: ปฏิเสธทุกอย่างที่ไม่ได้อนุญาตไว้อย่างชัดเจน (deny by default)
"""

from __future__ import annotations

import os
import re
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db import SessionLocal, get_db
from .models import iso, ChangeHistory, ScheduleVersion, StudentGroup, Teacher, UserAccount
from .security import (
    DUMMY_HASH,
    MIN_PASSWORD_LENGTH,
    hash_password,
    make_token,
    random_password,
    user_from_token,
    verify_password,
)

ROLES = {"staff": "ผู้ดูแลเว็บไซต์", "teacher": "อาจารย์", "student": "นักเรียน"}
LOGIN_FAILED = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
MSG_LOGIN_REQUIRED = "กรุณาเข้าสู่ระบบ"
MSG_MUST_CHANGE = "กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน"
MSG_FORBIDDEN = "บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้"
MSG_TOO_MANY = "ใส่รหัสผิดหลายครั้ง กรุณารอ 5 นาทีแล้วลองใหม่"
MISSING_LINK = "ไม่พบข้อมูล (ถูกลบ/นำเข้าใหม่)"

PUBLIC_ROUTES = {("POST", "/api/auth/login"), ("GET", "/api/health")}
SELF_ROUTES = {("GET", "/api/auth/me"), ("POST", "/api/auth/password")}

router = APIRouter(prefix="/api/auth")


def auth_disabled() -> bool:
    return os.environ.get("TIMETABLE_AUTH_DISABLED") == "1"


# ---------- จำกัดการลองรหัสผิด (เก็บในหน่วยความจำ) ----------

_FAIL_WINDOW = 5 * 60
_FAIL_LIMIT = 5
_failures: dict[str, deque] = defaultdict(deque)
_fail_lock = threading.Lock()


def _recent_failures(key: str) -> int:
    now = time.time()
    with _fail_lock:
        q = _failures[key]
        while q and now - q[0] > _FAIL_WINDOW:
            q.popleft()
        return len(q)


def _record_failure(key: str) -> None:
    with _fail_lock:
        _failures[key].append(time.time())


def _clear_failures(key: str) -> None:
    with _fail_lock:
        _failures.pop(key, None)


def reset_rate_limit() -> None:
    with _fail_lock:
        _failures.clear()


# ---------- ตัวช่วย ----------


def user_public(user: UserAccount) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "role_label": ROLES.get(user.role, user.role),
        "scope_id": user.scope_id,
        "must_change_password": user.must_change_password,
        "is_active": user.is_active,
        "last_login_at": iso(user.last_login_at),
    }


def log_change(db: Session, username: str, action: str, entity: str, detail: str = "") -> None:
    """บันทึกประวัติการแก้ไข (ห้ามส่งรหัสผ่านเข้ามาในฟังก์ชันนี้)"""
    db.add(ChangeHistory(username=username or "", action=action, entity=entity, detail=detail[:2000]))


def current_user(request: Request) -> UserAccount | None:
    return getattr(request.state, "user", None)


def current_username(request: Request) -> str:
    u = current_user(request)
    return u.username if u else "system"


def require_staff(request: Request) -> None:
    if auth_disabled():
        return
    u = current_user(request)
    if u is None or u.role != "staff":
        raise HTTPException(403, MSG_FORBIDDEN)


def ensure_default_admin(db: Session) -> None:
    # ชื่อบทบาทเดิม "งานหลักสูตร" เปลี่ยนเป็น "ผู้ดูแลเว็บไซต์": ปรับชื่อแสดงของบัญชีที่ยังใช้ชื่อเดิม
    old = "งาน" + "หลักสูตร"
    renamed = db.scalars(select(UserAccount).where(UserAccount.role == "staff", UserAccount.display_name == old)).all()
    for u in renamed:
        u.display_name = ROLES["staff"]
    if renamed:
        db.commit()
    has_staff = db.scalar(select(func.count()).select_from(UserAccount).where(UserAccount.role == "staff"))
    if has_staff:
        return
    password = os.environ.get("TIMETABLE_ADMIN_PASSWORD") or "admin1234"
    db.add(UserAccount(
        username="admin", display_name="ผู้ดูแลเว็บไซต์", role="staff", scope_id=None,
        password_hash=hash_password(password), must_change_password=True, is_active=True,
    ))
    db.commit()


def _active_version_id(db: Session) -> int | None:
    return db.scalar(select(ScheduleVersion.id).where(ScheduleVersion.is_active.is_(True)))


# ---------- ตัวป้องกันกลาง ----------

_TIMETABLE_RE = re.compile(r"^/api/schedule/versions/(\d+)/timetable$")
_REPORT_RE = re.compile(r"^/api/reports/([A-Za-z_]+)$")


def _scoped_allowed(request: Request, user: UserAccount, db: Session) -> bool:
    """สิทธิ์ของบัญชี teacher/student: เฉพาะ 3 เส้นทาง และต้องตรงกับบัญชีและตารางที่ใช้งานอยู่"""
    if request.method != "GET":
        return False
    path = request.url.path.rstrip("/")
    q = request.query_params
    view_for_role = {"teacher": "teacher", "student": "group"}[user.role]
    report_for_role = {"teacher": "teacher_timetables", "student": "group_timetables"}[user.role]
    if path == "/api/schedule/active":
        return True
    m = _TIMETABLE_RE.match(path)
    if m:
        active = _active_version_id(db)
        return (
            active is not None and int(m.group(1)) == active
            and q.get("view") == view_for_role and q.get("id") == str(user.scope_id)
        )
    m = _REPORT_RE.match(path)
    if m:
        if m.group(1) != report_for_role or q.get("id") != str(user.scope_id):
            return False
        vid = q.get("version_id")
        if not vid:
            return True
        active = _active_version_id(db)
        return active is not None and vid == str(active)
    return False


def _deny(status: int, message: str) -> JSONResponse:
    headers = {"WWW-Authenticate": "Bearer"} if status == 401 else None
    return JSONResponse({"detail": message}, status_code=status, headers=headers)


async def auth_guard(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api"):
        return await call_next(request)
    request.state.user = None
    if auth_disabled():
        return await call_next(request)
    key = (request.method, path.rstrip("/") or path)
    if key in PUBLIC_ROUTES:
        return await call_next(request)

    header = request.headers.get("authorization") or ""
    token = header[7:].strip() if header.lower().startswith("bearer ") else None
    db = SessionLocal()
    try:
        user = user_from_token(db, token)
        if user is None:
            return _deny(401, MSG_LOGIN_REQUIRED)
        request.state.user = user
        if key in SELF_ROUTES:
            pass
        elif user.must_change_password:
            return _deny(403, MSG_MUST_CHANGE)
        elif user.role == "staff":
            pass
        elif user.role in ("teacher", "student") and user.scope_id is not None:
            if not _scoped_allowed(request, user, db):
                return _deny(403, MSG_FORBIDDEN)
        else:
            return _deny(403, MSG_FORBIDDEN)
    finally:
        db.close()
    return await call_next(request)


# ---------- เส้นทางเข้าสู่ระบบ ----------


class LoginIn(BaseModel):
    username: str = ""
    password: str = ""


class PasswordIn(BaseModel):
    old_password: str = ""
    new_password: str = ""


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    username = (body.username or "").strip().lower()
    ip = request.client.host if request.client else "-"
    key = f"{ip}|{username}"
    if _recent_failures(key) >= _FAIL_LIMIT:
        raise HTTPException(429, MSG_TOO_MANY)
    user = db.scalar(select(UserAccount).where(UserAccount.username == username)) if username else None
    ok = verify_password(body.password or "", user.password_hash if user else DUMMY_HASH)
    if not user or not ok or not user.is_active:
        _record_failure(key)
        raise HTTPException(401, LOGIN_FAILED)
    _clear_failures(key)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    return {"token": make_token(db, user), "user": user_public(user)}


@router.get("/me")
def me(request: Request):
    user = current_user(request)
    if user is None:
        if auth_disabled():
            return {"id": 0, "username": "test", "display_name": "ทดสอบ", "role": "staff", "role_label": ROLES["staff"],
                    "scope_id": None, "must_change_password": False, "is_active": True, "last_login_at": None}
        raise HTTPException(401, MSG_LOGIN_REQUIRED)
    return user_public(user)


@router.post("/password")
def change_password(body: PasswordIn, request: Request, db: Session = Depends(get_db)):
    current = current_user(request)
    if current is None:
        raise HTTPException(401, MSG_LOGIN_REQUIRED)
    user = db.get(UserAccount, current.id)
    if not verify_password(body.old_password or "", user.password_hash):
        raise HTTPException(400, "รหัสผ่านปัจจุบันไม่ถูกต้อง")
    if len(body.new_password or "") < MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"รหัสผ่านใหม่ต้องมีอย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร")
    if body.new_password == body.old_password:
        raise HTTPException(400, "รหัสผ่านใหม่ต้องไม่ซ้ำรหัสผ่านเดิม")
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    log_change(db, user.username, "เปลี่ยนรหัสผ่าน", "บัญชีผู้ใช้", f"บัญชี {user.username} เปลี่ยนรหัสผ่านของตนเอง")
    db.commit()
    return {"token": make_token(db, user), "user": user_public(user)}


# ---------- จัดการบัญชี (เฉพาะ staff) ----------


def _link_name(db: Session, user: UserAccount) -> tuple[str, bool]:
    if user.role == "staff":
        return "ทั้งหมด", True
    model = Teacher if user.role == "teacher" else StudentGroup
    obj = db.get(model, user.scope_id) if user.scope_id is not None else None
    if obj is None:
        return MISSING_LINK, False
    return (obj.name if user.role == "teacher" else f"{obj.code} {obj.name}"), True


@router.get("/users", dependencies=[Depends(require_staff)])
def list_users(db: Session = Depends(get_db)):
    out = []
    for u in db.scalars(select(UserAccount).order_by(UserAccount.role, UserAccount.username)).all():
        name, ok = _link_name(db, u)
        out.append({**user_public(u), "linked_name": name, "linked_ok": ok})
    return out


@router.get("/targets", dependencies=[Depends(require_staff)])
def list_targets(role: str, db: Session = Depends(get_db)):
    if role == "teacher":
        rows = db.scalars(select(Teacher).order_by(Teacher.code)).all()
    elif role == "student":
        rows = db.scalars(select(StudentGroup).order_by(StudentGroup.code)).all()
    else:
        raise HTTPException(400, "บทบาทไม่ถูกต้อง")
    return [{"id": r.id, "code": r.code, "name": r.name, "is_excluded": r.is_excluded} for r in rows]


class UserCreateIn(BaseModel):
    username: str = ""
    password: str = ""
    role: str = ""
    scope_id: int | None = None
    display_name: str = ""


def _scope_display(db: Session, role: str, scope_id: int | None) -> str:
    if role == "staff":
        return ROLES["staff"]
    model = Teacher if role == "teacher" else StudentGroup
    obj = db.get(model, scope_id) if scope_id is not None else None
    if obj is None:
        raise HTTPException(400, "ไม่พบครูหรือกลุ่มเรียนที่เลือก")
    return obj.name


@router.post("/users", dependencies=[Depends(require_staff)])
def create_user(body: UserCreateIn, request: Request, db: Session = Depends(get_db)):
    username = (body.username or "").strip().lower()
    if not username or re.search(r"\s", username):
        raise HTTPException(400, "ชื่อผู้ใช้ต้องไม่ว่างและไม่มีช่องว่าง")
    if body.role not in ROLES:
        raise HTTPException(400, "บทบาทไม่ถูกต้อง")
    if len(body.password or "") < MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"รหัสผ่านต้องมีอย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร")
    scope_id = None if body.role == "staff" else body.scope_id
    if body.role != "staff" and scope_id is None:
        raise HTTPException(400, "กรุณาเลือกครูหรือกลุ่มเรียนที่ผูกกับบัญชี")
    default_name = _scope_display(db, body.role, scope_id)
    if db.scalar(select(UserAccount).where(UserAccount.username == username)):
        raise HTTPException(409, "ชื่อผู้ใช้นี้ถูกใช้แล้ว")
    user = UserAccount(
        username=username, display_name=(body.display_name or "").strip() or default_name, role=body.role,
        scope_id=scope_id, password_hash=hash_password(body.password), must_change_password=True, is_active=True,
    )
    db.add(user)
    log_change(db, current_username(request), "สร้างบัญชี", "บัญชีผู้ใช้", f"{username} ({ROLES[body.role]})")
    db.commit()
    return user_public(user)


class BulkIn(BaseModel):
    role: str = ""


@router.post("/users/bulk", dependencies=[Depends(require_staff)])
def bulk_create(body: BulkIn, request: Request, db: Session = Depends(get_db)):
    # บัญชีอาจารย์ให้ผู้ดูแลเว็บไซต์สร้างทีละบัญชีและตั้งชื่อผู้ใช้เอง (ไม่ใช้รหัสอาจารย์)
    if body.role != "student":
        raise HTTPException(400, "สร้างอัตโนมัติได้เฉพาะบัญชีกลุ่มเรียน")
    model = StudentGroup
    linked = set(db.scalars(select(UserAccount.scope_id).where(UserAccount.role == body.role)).all())
    taken = set(db.scalars(select(UserAccount.username)).all())
    created = []
    for obj in db.scalars(select(model).order_by(model.code)).all():
        if obj.is_excluded or obj.id in linked:
            continue
        base = re.sub(r"\s+", "", obj.code).lower() or f"{body.role}{obj.id}"
        username, n = base, 1
        while username in taken:
            n += 1
            username = f"{base}-{n}"
        taken.add(username)
        password = random_password(8)
        db.add(UserAccount(
            username=username, display_name=obj.name, role=body.role, scope_id=obj.id,
            password_hash=hash_password(password), must_change_password=True, is_active=True,
        ))
        created.append({"username": username, "password": password, "display_name": obj.name, "code": obj.code})
    log_change(db, current_username(request), "สร้างบัญชีอัตโนมัติ", "บัญชีผู้ใช้",
               f"{ROLES[body.role]} {len(created)} บัญชี")
    db.commit()
    return {"role": body.role, "created": created}


class UserPatchIn(BaseModel):
    password: str | None = None
    display_name: str | None = None
    is_active: bool | None = None


def _staff_count(db: Session, active_only: bool) -> int:
    q = select(func.count()).select_from(UserAccount).where(UserAccount.role == "staff")
    if active_only:
        q = q.where(UserAccount.is_active.is_(True))
    return db.scalar(q) or 0


@router.patch("/users/{user_id}", dependencies=[Depends(require_staff)])
def patch_user(user_id: int, body: UserPatchIn, request: Request, db: Session = Depends(get_db)):
    user = db.get(UserAccount, user_id)
    if user is None:
        raise HTTPException(404, "ไม่พบบัญชี")
    changes = []
    if body.password is not None:
        if len(body.password) < MIN_PASSWORD_LENGTH:
            raise HTTPException(400, f"รหัสผ่านต้องมีอย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร")
        user.password_hash = hash_password(body.password)
        user.must_change_password = True
        changes.append("ตั้งรหัสผ่านใหม่")
    if body.display_name is not None and body.display_name.strip():
        user.display_name = body.display_name.strip()
        changes.append("แก้ชื่อแสดง")
    if body.is_active is not None and body.is_active != user.is_active:
        if not body.is_active and user.role == "staff" and user.is_active and _staff_count(db, True) <= 1:
            raise HTTPException(400, "ไม่สามารถปิดใช้งานบัญชีผู้ดูแลเว็บไซต์บัญชีสุดท้ายได้")
        user.is_active = body.is_active
        changes.append("เปิดใช้งาน" if body.is_active else "ปิดใช้งาน")
    log_change(db, current_username(request), "แก้ไขบัญชี", "บัญชีผู้ใช้", f"{user.username}: {', '.join(changes) or '-'}")
    db.commit()
    return user_public(user)


@router.delete("/users/{user_id}", dependencies=[Depends(require_staff)])
def delete_user(user_id: int, request: Request, db: Session = Depends(get_db)):
    user = db.get(UserAccount, user_id)
    if user is None:
        raise HTTPException(404, "ไม่พบบัญชี")
    me_ = current_user(request)
    if me_ is not None and me_.id == user.id:
        raise HTTPException(400, "ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่ของตัวเองได้")
    if user.role == "staff" and _staff_count(db, False) <= 1:
        raise HTTPException(400, "ไม่สามารถลบบัญชีผู้ดูแลเว็บไซต์บัญชีสุดท้ายได้")
    if user.role == "staff" and user.is_active and _staff_count(db, True) <= 1:
        raise HTTPException(400, "ไม่สามารถลบบัญชีผู้ดูแลเว็บไซต์ที่ใช้งานอยู่บัญชีสุดท้ายได้")
    db.delete(user)
    log_change(db, current_username(request), "ลบบัญชี", "บัญชีผู้ใช้", user.username)
    db.commit()
    return {"ok": True}
