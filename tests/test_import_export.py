"""ส่งออกข้อมูลแล้วนำเข้ากลับต้องได้ข้อมูลเดิม และรายงานส่งออกต้องถูกต้อง (ใช้ชุดข้อมูลตัวอย่าง)"""

import csv
import io
import json

from tests.conftest import H


def _snapshot(client, token):
    d = json.loads(client.get("/api/export/data.json", headers=H(token)).content)
    return {k: sorted(json.dumps(x, ensure_ascii=False, sort_keys=True) for x in d[k])
            for k in ("teachers", "groups", "rooms", "courses", "sections", "busy")}


def _import(client, token, name, content):
    r = client.post("/api/import", headers=H(token), files=[("files", (name, content, "application/octet-stream"))])
    assert r.status_code == 200, r.text


def test_export_import_round_trip_all_formats(client, admin_token):
    assert client.post("/api/import/sample?size=small", headers=H(admin_token)).status_code == 200
    base = _snapshot(client, admin_token)
    for path, name in (("/api/export/data.json", "d.json"), ("/api/export/data.zip", "d.zip"),
                       ("/api/export/data.xlsx", "d.xlsx")):
        _import(client, admin_token, name, client.get(path, headers=H(admin_token)).content)
        assert _snapshot(client, admin_token) == base, name
    # หน้ากรอกข้อมูล: เปิดแล้วบันทึกซ้ำโดยไม่แก้อะไร ข้อมูลต้องเหมือนเดิม
    model = client.get("/api/curriculum", headers=H(admin_token)).json()
    assert client.post("/api/curriculum", headers=H(admin_token), json=model).status_code == 200
    assert _snapshot(client, admin_token) == base


def test_curriculum_file_keeps_teacher_codes(client, admin_token):
    """ไฟล์ข้อมูลหลักสูตรไม่มีรหัสอาจารย์: นำเข้าซ้ำต้องใช้รหัสเดิม บัญชีผู้ใช้ที่ผูกไว้จึงยังใช้ได้"""
    assert client.post("/api/import/sample?size=small", headers=H(admin_token)).status_code == 200
    teachers = client.get("/api/data/teachers", headers=H(admin_token)).json()
    before = {t["name"]: (t["id"], t["code"]) for t in teachers}
    _import(client, admin_token, "d.xlsx", client.get("/api/export/data.xlsx", headers=H(admin_token)).content)
    after = {t["name"]: (t["id"], t["code"]) for t in client.get("/api/data/teachers", headers=H(admin_token)).json()}
    assert after == before


def test_reports_export_hours_and_building(client, admin_token):
    assert client.post("/api/import/sample?size=small", headers=H(admin_token)).status_code == 200
    r = client.post("/api/schedule/run", headers=H(admin_token), json={"name": "ทดสอบส่งออก", "wait": True})
    assert r.status_code == 200, r.text
    vid = r.json()["id"]
    groups = client.get("/api/data/groups", headers=H(admin_token)).json()
    hours = sum(e["length"] for g in groups for e in client.get(
        f"/api/schedule/versions/{vid}/timetable?view=group&id={g['id']}", headers=H(admin_token)).json()["entries"])
    text = client.get(f"/api/reports/group_timetables?version_id={vid}&format=csv", headers=H(admin_token)).content.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text)))[1:]
    assert sum(int(b) - int(a) + 1 for a, b in (r[2].split("-") for r in rows)) == hours

    # มุมมองอาคาร: ส่งออกเฉพาะห้องของอาคารที่เลือก
    rooms = client.get("/api/data/rooms", headers=H(admin_token)).json()
    building = rooms[0]["building"]
    names = {r["name"] for r in rooms if r["building"] == building}
    text = client.get(f"/api/reports/room_timetables?version_id={vid}&format=csv&building={building}",
                      headers=H(admin_token)).content.decode("utf-8-sig")
    titles = {r[0] for r in list(csv.reader(io.StringIO(text)))[1:]}
    assert titles and all(any(n in t for n in names) for t in titles)

    # ภาระงานสอนไม่แสดงรหัสอาจารย์
    load = client.get(f"/api/reports/teacher_load?version_id={vid}&format=json", headers=H(admin_token)).json()
    assert load["rows"][0] == ["อาจารย์", "ชั่วโมงสอน/สัปดาห์"]
