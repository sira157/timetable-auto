"""งานคำนวณที่รันเบื้องหลัง: ให้หน้าเว็บดูความคืบหน้า และกดยกเลิกได้

เก็บในหน่วยความจำของเซิร์ฟเวอร์ (รีสตาร์ตแล้วหาย) และรันได้ทีละงาน
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Callable

PHASES = {
    # ระยะ: (ข้อความ, ช่วงเปอร์เซ็นต์เริ่ม, ช่วงเปอร์เซ็นต์จบ)
    "queued": ("รอเริ่ม", 0.0, 0.0),
    "prepare": ("เตรียมข้อมูล", 0.0, 0.05),
    "greedy": ("หาคำตอบเบื้องต้น", 0.05, 0.15),
    "search": ("ค้นหาตารางที่ดีที่สุด (CP-SAT)", 0.15, 0.90),
    "build": ("สร้างตาราง", 0.90, 0.93),
    "check": ("ตรวจผลทุกคาบ", 0.93, 0.97),
    "save": ("บันทึก", 0.97, 1.0),
}


class Job:
    def __init__(self, username: str, options: dict):
        self.id = uuid.uuid4().hex[:12]
        self.username = username
        self.options = options
        self.status = "running"  # running | done | failed | cancelled
        self.phase = "queued"
        self.fraction = 0.0
        self.info: dict = {}
        self.message = ""
        self.version_id: int | None = None
        self.started = time.time()
        self.finished: float | None = None
        self.cancel = threading.Event()

    def progress(self, phase: str, fraction: float, info: dict | None = None) -> None:
        self.phase = phase
        self.fraction = max(0.0, min(1.0, fraction))
        if info:
            self.info.update(info)

    def public(self) -> dict:
        label, lo, hi = PHASES.get(self.phase, (self.phase, 0.0, 1.0))
        pct = 1.0 if self.status == "done" else lo + (hi - lo) * self.fraction
        return {
            "id": self.id, "status": self.status, "phase": self.phase, "phase_label": label,
            "percent": round(pct * 100), "elapsed_sec": round((self.finished or time.time()) - self.started, 1),
            "budget_sec": self.options.get("budget_sec"), "placed_hours": self.info.get("placed_hours"),
            "total_hours": self.info.get("total_hours"), "message": self.message, "version_id": self.version_id,
            "options": {k: v for k, v in self.options.items() if k in ("name", "keep_locks")},
        }


_jobs: dict[str, Job] = {}
_lock = threading.Lock()


def current() -> Job | None:
    with _lock:
        running = [j for j in _jobs.values() if j.status == "running"]
        if running:
            return running[0]
        return max(_jobs.values(), key=lambda j: j.started, default=None)


def get(job_id: str) -> Job | None:
    return _jobs.get(job_id)


def start(username: str, options: dict, work: Callable[[Job], int]) -> Job:
    """เริ่มงานใหม่ work(job) ต้องคืน version_id (ยก Cancelled ได้)"""
    with _lock:
        if any(j.status == "running" for j in _jobs.values()):
            raise RuntimeError("มีการคำนวณอยู่แล้ว รอให้เสร็จหรือกดยกเลิกก่อน")
        job = Job(username, options)
        _jobs[job.id] = job
        # เก็บไว้ไม่เกิน 20 งานล่าสุด
        for old in sorted(_jobs.values(), key=lambda j: j.started)[:-20]:
            _jobs.pop(old.id, None)

    def run():
        from .scheduler import Cancelled

        try:
            job.version_id = work(job)
            job.status = "done"
            job.message = "เสร็จแล้ว"
        except Cancelled:
            job.status = "cancelled"
            job.message = "ยกเลิกแล้ว ไม่ได้บันทึกตาราง"
        except Exception as e:  # noqa: BLE001 - ส่งข้อความสั้นกลับไปให้ผู้ใช้
            job.status = "failed"
            job.message = str(e) or "เกิดข้อผิดพลาด"
        finally:
            job.finished = time.time()

    threading.Thread(target=run, daemon=True).start()
    return job
