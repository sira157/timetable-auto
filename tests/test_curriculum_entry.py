"""หน้ากรอกข้อมูล: GET/POST /api/curriculum ใช้รูปแบบเดียวกับไฟล์ Excel ข้อมูลหลักสูตร"""

from tests.conftest import H


def test_curriculum_requires_staff(client):
    assert client.get("/api/curriculum").status_code == 401
    assert client.post("/api/curriculum", json={"years": []}).status_code == 401


def test_curriculum_round_trip(client, admin_token):
    r = client.post("/api/import/sample?size=small", headers=H(admin_token))
    assert r.status_code == 200, r.text
    before = client.get("/api/data/summary", headers=H(admin_token)).json()["counts"]

    model = client.get("/api/curriculum", headers=H(admin_token)).json()
    assert {"years", "admins", "lecture", "practice"} <= set(model)
    assert any(g["rows"] for y in model["years"] for g in y["groups"])

    # ตั้งอาจารย์ที่ปรึกษาไว้ก่อน: ไม่มีในรูปแบบข้อมูลหลักสูตร ต้องคงค่าเดิมหลังบันทึก
    groups = client.get("/api/data/groups", headers=H(admin_token)).json()
    teachers = client.get("/api/data/teachers", headers=H(admin_token)).json()
    g0 = groups[0]
    client.put(f"/api/data/groups/{g0['id']}", json={**g0, "advisor": teachers[0]["code"]}, headers=H(admin_token))

    r = client.post("/api/curriculum", json=model, headers=H(admin_token))
    assert r.status_code == 200, r.text
    after = client.get("/api/data/summary", headers=H(admin_token)).json()["counts"]
    for k in ("teachers", "groups", "courses", "sections"):
        assert after[k] == before[k], (k, before, after)
    g_after = next(g for g in client.get("/api/data/groups", headers=H(admin_token)).json() if g["code"] == g0["code"])
    assert g_after["advisor"] == teachers[0]["code"]


def test_curriculum_add_course_row(client, admin_token):
    client.post("/api/import/sample?size=small", headers=H(admin_token))
    model = client.get("/api/curriculum", headers=H(admin_token)).json()
    group = next(g for y in model["years"] for g in y["groups"] if g["rows"])
    group["rows"].append({
        "no": len(group["rows"]) + 1, "code": "ทด 999999", "name": "วิชาทดลองกรอกบนเว็บ",
        "teachers": "อ.ทดลอง ใจดี", "places": "", "credits": "3(2-2-5)", "category": "วิชาบังคับ",
    })
    r = client.post("/api/curriculum", json=model, headers=H(admin_token))
    assert r.status_code == 200, r.text
    courses = client.get("/api/data/courses", headers=H(admin_token)).json()
    assert any(c["code"] == "ทด 999999" and c["credits"] == "3(2-2-5)" for c in courses)


def test_curriculum_rejects_empty(client, admin_token):
    r = client.post("/api/curriculum", json={"years": [{"year": 1, "groups": []}]}, headers=H(admin_token))
    assert r.status_code == 400
    r = client.post("/api/curriculum", json={"years": "x"}, headers=H(admin_token))
    assert r.status_code == 400
