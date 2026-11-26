from backend import security
from backend.db import SessionLocal
from backend.models import UserAccount

from .conftest import H, login


def test_health_is_public(client):
    assert client.get("/api/health").status_code == 200


def test_api_requires_token(client):
    r = client.get("/api/data/summary")
    assert r.status_code == 401
    assert r.json()["detail"] == "กรุณาเข้าสู่ระบบ"
    assert r.headers["www-authenticate"] == "Bearer"


def test_login_wrong_and_unknown_same_message(client, admin_token):
    a = login(client, "admin", "wrong-pass")
    b = login(client, "nobody", "wrong-pass")
    assert a.status_code == b.status_code == 401
    assert a.json()["detail"] == b.json()["detail"] == "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"


def test_login_trims_and_lowercases(client, admin_token):
    r = login(client, "  ADMIN ", "admin-new-pw")
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "staff"


def test_rate_limit_after_five_failures(client, admin_token):
    for _ in range(5):
        assert login(client, "admin", "bad").status_code == 401
    r = login(client, "admin", "admin-new-pw")
    assert r.status_code == 429
    assert "5 นาที" in r.json()["detail"]


def test_must_change_password_blocks_api(client, admin_token):
    r = client.post("/api/auth/users", headers=H(admin_token),
                    json={"username": "staff2", "password": "start12", "role": "staff"})
    assert r.status_code == 200
    tok = login(client, "staff2", "start12").json()["token"]
    assert client.get("/api/auth/me", headers=H(tok)).status_code == 200
    r = client.get("/api/data/summary", headers=H(tok))
    assert r.status_code == 403
    assert r.json()["detail"] == "กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน"


def test_password_change_rules_and_old_token_invalid(client, admin_token):
    client.post("/api/auth/users", headers=H(admin_token),
                json={"username": "staff3", "password": "start12", "role": "staff"})
    tok = login(client, "staff3", "start12").json()["token"]
    assert client.post("/api/auth/password", headers=H(tok),
                       json={"old_password": "start12", "new_password": "123"}).status_code == 400
    assert client.post("/api/auth/password", headers=H(tok),
                       json={"old_password": "start12", "new_password": "start12"}).status_code == 400
    r = client.post("/api/auth/password", headers=H(tok), json={"old_password": "start12", "new_password": "newpass1"})
    assert r.status_code == 200
    new_tok = r.json()["token"]
    assert client.get("/api/auth/me", headers=H(tok)).status_code == 401
    assert client.get("/api/data/summary", headers=H(new_tok)).status_code == 200


def test_expired_token_rejected(client, admin_token):
    db = SessionLocal()
    try:
        user = db.query(UserAccount).filter_by(username="admin").one()
        orig = security.TOKEN_TTL_SECONDS
        security.TOKEN_TTL_SECONDS = -10
        try:
            tok = security.make_token(db, user)
        finally:
            security.TOKEN_TTL_SECONDS = orig
    finally:
        db.close()
    assert client.get("/api/auth/me", headers=H(tok)).status_code == 401


def test_tampered_token_rejected(client, admin_token):
    body, sig = admin_token.rsplit(".", 1)
    bad = body + "." + ("0" * len(sig))
    assert client.get("/api/auth/me", headers=H(bad)).status_code == 401


def _setup_schedule(client, admin_token):
    assert client.post("/api/import/sample", headers=H(admin_token)).status_code == 200
    r = client.post("/api/schedule/run", headers=H(admin_token), json={"name": "ทดสอบ", "wait": True})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _scoped_token(client, admin_token, role, username):
    targets = client.get(f"/api/auth/targets?role={role}", headers=H(admin_token)).json()
    scope, other = targets[0]["id"], targets[1]["id"]
    r = client.post("/api/auth/users", headers=H(admin_token),
                    json={"username": username, "password": "start12", "role": role, "scope_id": scope})
    assert r.status_code == 200, r.text
    tok = login(client, username, "start12").json()["token"]
    tok = client.post("/api/auth/password", headers=H(tok),
                      json={"old_password": "start12", "new_password": "mine123"}).json()["token"]
    return tok, scope, other


def test_teacher_scope(client, admin_token):
    vid = _setup_schedule(client, admin_token)
    tok, mine, other = _scoped_token(client, admin_token, "teacher", "teach1")
    assert client.get("/api/schedule/active", headers=H(tok)).status_code == 200
    ok = client.get(f"/api/schedule/versions/{vid}/timetable?view=teacher&id={mine}", headers=H(tok))
    assert ok.status_code == 200
    assert client.get(f"/api/schedule/versions/{vid}/timetable?view=teacher&id={other}", headers=H(tok)).status_code == 403
    assert client.get(f"/api/schedule/versions/{vid}/timetable?view=group&id={mine}", headers=H(tok)).status_code == 403
    assert client.get(f"/api/reports/teacher_timetables?id={mine}", headers=H(tok)).status_code == 200
    assert client.get(f"/api/reports/teacher_timetables?id={other}", headers=H(tok)).status_code == 403
    assert client.get("/api/reports/teacher_timetables", headers=H(tok)).status_code == 403
    r = client.get("/api/data/teachers", headers=H(tok))
    assert r.status_code == 403
    assert r.json()["detail"] == "บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้"


def test_student_scope(client, admin_token):
    vid = _setup_schedule(client, admin_token)
    tok, mine, other = _scoped_token(client, admin_token, "student", "stud1")
    assert client.get(f"/api/schedule/versions/{vid}/timetable?view=group&id={mine}", headers=H(tok)).status_code == 200
    assert client.get(f"/api/schedule/versions/{vid}/timetable?view=group&id={other}", headers=H(tok)).status_code == 403
    assert client.get("/api/auth/users", headers=H(tok)).status_code == 403
    assert client.post("/api/schedule/run", headers=H(tok), json={}).status_code == 403
    assert client.get(f"/api/reports/group_timetables?id={mine}&version_id=99999", headers=H(tok)).status_code == 403
    assert client.get(f"/api/reports/issues?id={mine}", headers=H(tok)).status_code == 403


def test_cannot_disable_or_delete_last_staff(client, admin_token):
    users = client.get("/api/auth/users", headers=H(admin_token)).json()
    for u in users:
        if u["role"] == "staff" and u["username"] != "admin":
            assert client.delete(f"/api/auth/users/{u['id']}", headers=H(admin_token)).status_code == 200
    admin = next(u for u in client.get("/api/auth/users", headers=H(admin_token)).json() if u["username"] == "admin")
    r = client.patch(f"/api/auth/users/{admin['id']}", headers=H(admin_token), json={"is_active": False})
    assert r.status_code == 400
    assert client.delete(f"/api/auth/users/{admin['id']}", headers=H(admin_token)).status_code == 400


def test_duplicate_username_409(client, admin_token):
    body = {"username": "dupe", "password": "start12", "role": "staff"}
    assert client.post("/api/auth/users", headers=H(admin_token), json=body).status_code == 200
    assert client.post("/api/auth/users", headers=H(admin_token), json=body).status_code == 409


def test_passwords_never_in_history(client, admin_token):
    client.post("/api/auth/users", headers=H(admin_token),
                json={"username": "secretcheck", "password": "SuperSecret99", "role": "staff"})
    text = str(client.get("/api/history/changes", headers=H(admin_token)).json())
    assert "SuperSecret99" not in text
    assert "admin-new-pw" not in text


def test_password_hash_format():
    h = security.hash_password("abcdef")
    scheme, rounds, salt, _digest = h.split("$")
    assert scheme == "pbkdf2" and rounds == "200000" and len(salt) == 32
    assert security.verify_password("abcdef", h)
    assert not security.verify_password("abcdeg", h)


def test_bulk_create_accounts(client, admin_token):
    r = client.post("/api/auth/users/bulk", headers=H(admin_token), json={"role": "student"})
    assert r.status_code == 200
    created = r.json()["created"]
    assert created and all(len(c["password"]) == 8 for c in created)
    r2 = client.post("/api/auth/users/bulk", headers=H(admin_token), json={"role": "student"})
    assert r2.json()["created"] == []


def test_assignment_lock_and_move(client, admin_token):
    vid = _setup_schedule(client, admin_token)
    tt = client.get(f"/api/schedule/versions/{vid}/timetable?view=group&id=1", headers=H(admin_token)).json()
    entry = next(e for e in tt["entries"] if e["kind"] == "normal")
    r = client.patch(f"/api/schedule/assignments/{entry['id']}", headers=H(admin_token), json={"locked": True})
    assert r.status_code == 200 and r.json()["assignment"]["locked"]
    r = client.patch(f"/api/schedule/assignments/{entry['id']}", headers=H(admin_token), json={"start": 4, "day": 0})
    if entry["length"] > 1:
        assert r.status_code == 400  # คร่อมพักกลางวัน
    r = client.post("/api/schedule/run", headers=H(admin_token), json={"keep_locks": True, "wait": True})
    assert r.status_code == 200
    tt2 = client.get(f"/api/schedule/versions/{r.json()['id']}/timetable?view=group&id=1", headers=H(admin_token)).json()
    same = next(e for e in tt2["entries"] if e["section_id"] == entry["section_id"] and e["block_index"] == entry["block_index"])
    assert (same["day"], same["start"], same["locked"]) == (entry["day"], entry["start"], True)


def test_template_and_reimport(client, admin_token):
    r = client.get("/api/export/data.xlsx", headers=H(admin_token))
    assert r.status_code == 200
    r = client.post("/api/import", headers=H(admin_token),
                    files={"files": ("data.xlsx", r.content, "application/octet-stream")})
    assert r.status_code == 200, r.text
    assert r.json()["counts"]["sections"] == 78
    teachers = client.get("/api/data/teachers", headers=H(admin_token)).json()
    assert sum(1 for t in teachers if t["is_admin"]) == 7


def test_csv_import_and_partial_replace(client, admin_token):
    import io
    import zipfile

    r = client.get("/api/samples/small.zip", headers=H(admin_token))
    assert r.status_code == 200
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert "อาจารย์.csv" in names and "ฝ่ายบริหาร.csv" in names
    r = client.post("/api/import", headers=H(admin_token), files={"files": ("small.zip", r.content, "application/zip")})
    assert r.status_code == 200, r.text
    assert r.json()["counts"]["sections"] == 16
    # CSV ไฟล์เดียว (TIS-620) แทนที่เฉพาะห้อง ข้อมูลอื่นคงเดิม
    csv_text = "ชื่อห้อง/จุด,อาคาร/สนาม,ประเภท,ความจุ,กีฬาที่รองรับ\r\n301,อาคาร 3,ห้องเรียน,40,\r\n"
    r = client.post("/api/import", headers=H(admin_token),
                    files={"files": ("rooms.csv", csv_text.encode("cp874"), "text/csv")})
    assert r.status_code == 200, r.text
    assert r.json()["counts"] == {"rooms": 1} and r.json()["partial"]
    assert len(client.get("/api/data/sections", headers=H(admin_token)).json()) == 16
    bad = client.post("/api/import", headers=H(admin_token), files={"files": ("x.csv", "ก,ข\r\n1,2".encode("utf-8"), "text/csv")})
    assert bad.status_code == 400


def test_job_progress_moves_and_exports(client, admin_token):
    import time as _t

    client.post("/api/import/sample?size=small", headers=H(admin_token))
    r = client.post("/api/schedule/run", headers=H(admin_token), json={"name": "งาน"})
    assert r.status_code == 200
    job = r.json()
    assert client.post("/api/schedule/run", headers=H(admin_token), json={}).status_code in (200, 409)
    for _ in range(120):
        job = client.get(f"/api/schedule/jobs/{job['id']}", headers=H(admin_token)).json()
        if job["status"] != "running":
            break
        _t.sleep(0.5)
    assert job["status"] == "done" and job["version_id"]
    vid = job["version_id"]
    tt = client.get(f"/api/schedule/versions/{vid}/timetable?view=group&id=1", headers=H(admin_token)).json()
    e = tt["entries"][0]
    assert e["credits"] and e["group_label"]
    moves = client.get(f"/api/schedule/assignments/{e['id']}/moves", headers=H(admin_token)).json()
    assert any(m["current"] for m in moves["slots"]) and any(m["ok"] for m in moves["slots"])
    assert all(m["reason"] for m in moves["slots"] if not m["ok"])
    x = client.get(f"/api/reports/group_timetables?version_id={vid}&format=xlsx", headers=H(admin_token))
    assert x.status_code == 200 and x.content[:2] == b"PK"
    # ยกเลิกงาน
    r = client.post("/api/schedule/run", headers=H(admin_token), json={})
    jid = r.json()["id"]
    client.post(f"/api/schedule/jobs/{jid}/cancel", headers=H(admin_token))
    for _ in range(60):
        st = client.get(f"/api/schedule/jobs/{jid}", headers=H(admin_token)).json()
        if st["status"] != "running":
            break
        _t.sleep(0.5)
    assert st["status"] in ("cancelled", "done")
