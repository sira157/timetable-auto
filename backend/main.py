"""ระบบจัดตารางสอนอัตโนมัติ — จุดเริ่มต้นของ backend (FastAPI)

ขั้นตอนนี้เป็นโครงเริ่มต้นสำหรับ deploy บน Render:
- /api/health สำหรับ health check
- เสิร์ฟหน้าเว็บจากโฟลเดอร์ frontend/

ระบบล็อกอินและการจัดตาราง ยังไม่ได้ทำในขั้นนี้ (ดู docs/auth-rules.md และ docs/scheduling-rules.md)
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="ระบบจัดตารางสอนอัตโนมัติ")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "app": "ระบบจัดตารางสอนอัตโนมัติ"}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="frontend")
