"""ตารางในฐานข้อมูล

ข้อมูลอ้างอิงกันด้วย "รหัส" (รหัสครู รหัสกลุ่ม รหัสวิชา ชื่อห้อง) แทน id
เพื่อให้นำเข้าข้อมูลใหม่หรือแก้ไขภายหลังได้โดยไม่ทำให้ความสัมพันธ์เสีย
"""

from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    """แปลงเวลาเป็นข้อความ ISO พร้อมเขตเวลา UTC (SQLite ไม่เก็บเขตเวลา)"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


# ---------- ข้อมูลพื้นฐาน ----------


class Teacher(Base):
    __tablename__ = "teachers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)  # อยู่ในชีตฝ่ายบริหาร
    is_excluded: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str] = mapped_column(Text, default="")


class StudentGroup(Base):
    __tablename__ = "student_groups"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    year: Mapped[int] = mapped_column(Integer, default=1)
    size: Mapped[int] = mapped_column(Integer, default=0)
    homeroom: Mapped[str] = mapped_column(String(100), default="")
    advisor: Mapped[str] = mapped_column(String(50), default="")  # รหัสครู
    is_excluded: Mapped[bool] = mapped_column(Boolean, default=False)


class Room(Base):
    __tablename__ = "rooms"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    building: Mapped[str] = mapped_column(String(100), default="")
    kind: Mapped[str] = mapped_column(String(20), default="classroom")  # classroom | computer | meeting | field
    capacity: Mapped[int] = mapped_column(Integer, default=0)
    sports: Mapped[list] = mapped_column(JSON, default=list)


class Course(Base):
    __tablename__ = "courses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    credits: Mapped[str] = mapped_column(String(30), default="")
    category: Mapped[str] = mapped_column(String(100), default="")
    combined: Mapped[bool] = mapped_column(Boolean, default=False)
    elective_set: Mapped[str] = mapped_column(String(100), default="")
    free_elective: Mapped[bool] = mapped_column(Boolean, default=False)
    venue: Mapped[str] = mapped_column(String(300), default="")
    sport: Mapped[str] = mapped_column(String(100), default="")
    hours: Mapped[int] = mapped_column(Integer, default=0)  # ชม./สัปดาห์ เมื่อหน่วยกิตไม่ใช่ น(ท-ป-ศ) เช่น 1(90) เรียน 4 ชม.
    is_excluded: Mapped[bool] = mapped_column(Boolean, default=False)


class Section(Base):
    """การเปิดสอน: วิชาหนึ่งสำหรับกลุ่มเรียนหนึ่งหรือหลายกลุ่ม พร้อมผู้สอน"""

    __tablename__ = "sections"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_code: Mapped[str] = mapped_column(String(50), index=True)
    group_codes: Mapped[list] = mapped_column(JSON, default=list)
    teacher_codes: Mapped[list] = mapped_column(JSON, default=list)
    places: Mapped[list] = mapped_column(JSON, default=list)  # สถานที่ที่ข้อมูลระบุ (ห้อง/สนาม) ใช้แทนค่าที่ระบบเลือก
    note: Mapped[str] = mapped_column(Text, default="")


class BusyTime(Base):
    """เวลาที่ไม่ว่าง: ประชุม / กิจกรรม / ผู้สอนไม่ว่าง"""

    __tablename__ = "busy_times"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), default="unavailable")  # meeting | activity | unavailable
    name: Mapped[str] = mapped_column(String(200), default="")
    day: Mapped[int] = mapped_column(Integer, default=0)  # 0 = จันทร์
    start: Mapped[int] = mapped_column(Integer, default=1)
    end: Mapped[int] = mapped_column(Integer, default=1)
    teacher_codes: Mapped[list] = mapped_column(JSON, default=list)
    group_codes: Mapped[list] = mapped_column(JSON, default=list)


# ---------- ระบบ ----------


class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class ScheduleVersion(Base):
    __tablename__ = "schedule_versions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_by: Mapped[str] = mapped_column(String(100), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    data_hash: Mapped[str] = mapped_column(String(64), default="")
    relaxed_gap: Mapped[bool] = mapped_column(Boolean, default=False)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    issues: Mapped[list] = mapped_column(JSON, default=list)
    unplaced: Mapped[list] = mapped_column(JSON, default=list)
    notices: Mapped[list] = mapped_column(JSON, default=list)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)


class Assignment(Base):
    __tablename__ = "assignments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("schedule_versions.id", ondelete="CASCADE"), index=True)
    section_id: Mapped[int] = mapped_column(Integer)
    block_index: Mapped[int] = mapped_column(Integer)
    unit_key: Mapped[str] = mapped_column(String(100))
    part: Mapped[str] = mapped_column(String(20))  # all | theory | practice
    kind: Mapped[str] = mapped_column(String(20))  # normal | combined | coteach | elective | free
    day: Mapped[int] = mapped_column(Integer)
    start: Mapped[int] = mapped_column(Integer)
    length: Mapped[int] = mapped_column(Integer)
    room: Mapped[str | None] = mapped_column(String(100), nullable=True)
    field: Mapped[str | None] = mapped_column(String(100), nullable=True)  # โรงยิม/สนาม ที่ใช้พร้อมกัน
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    # สำเนาข้อมูล ณ เวลาที่จัด เพื่อให้ตารางรุ่นเก่ายังแสดงได้แม้ข้อมูลถูกแก้
    course_code: Mapped[str] = mapped_column(String(50))
    course_name: Mapped[str] = mapped_column(String(200))
    teacher_codes: Mapped[list] = mapped_column(JSON, default=list)
    group_codes: Mapped[list] = mapped_column(JSON, default=list)


class ChangeHistory(Base):
    __tablename__ = "change_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    username: Mapped[str] = mapped_column(String(100), default="")
    action: Mapped[str] = mapped_column(String(50))
    entity: Mapped[str] = mapped_column(String(50), default="")
    detail: Mapped[str] = mapped_column(Text, default="")


class RunHistory(Base):
    __tablename__ = "run_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    username: Mapped[str] = mapped_column(String(100), default="")
    version_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    placed_hours: Mapped[int] = mapped_column(Integer, default=0)
    total_hours: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[int] = mapped_column(Integer, default=0)
    warnings: Mapped[int] = mapped_column(Integer, default=0)
    relaxed_gap: Mapped[bool] = mapped_column(Boolean, default=False)
    message: Mapped[str] = mapped_column(Text, default="")


class UserAccount(Base):
    __tablename__ = "user_accounts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(200), default="")
    role: Mapped[str] = mapped_column(String(20))  # staff | teacher | student
    scope_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(300))
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
