"""ระบบจัดตารางสอนอัตโนมัติ — จุดเริ่มต้นของ backend (FastAPI)

- /api/... ทุกเส้นทางผ่านตัวป้องกันกลาง (auth_guard) ตาม docs/auth-rules.md
- เสิร์ฟหน้าเว็บ React ที่ build แล้วจาก frontend/dist
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import api, auth
from .db import BASE_DIR, Base, SessionLocal, engine, ensure_columns

DIST_DIR = BASE_DIR / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(engine)
    ensure_columns()
    db = SessionLocal()
    try:
        auth.ensure_default_admin(db)
    finally:
        db.close()
    yield


app = FastAPI(title="ระบบจัดตารางสอนอัตโนมัติ", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.middleware("http")(auth.auth_guard)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "app": "ระบบจัดตารางสอนอัตโนมัติ"}


app.include_router(auth.router)
app.include_router(api.router)


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def api_not_found(rest: str):
    return JSONResponse({"detail": "ไม่พบเส้นทางนี้"}, status_code=404)


if (DIST_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    target = (DIST_DIR / full_path).resolve()
    if full_path and target.is_file() and DIST_DIR.resolve() in target.parents:
        return FileResponse(target)
    index = DIST_DIR / "index.html"
    if index.exists():
        return FileResponse(index)
    return JSONResponse({"detail": "ยังไม่ได้ build หน้าเว็บ (cd frontend && npm install && npm run build)"}, status_code=503)
