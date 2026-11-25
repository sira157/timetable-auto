# ระบบจัดตารางสอนอัตโนมัติ

โครงเริ่มต้นสำหรับ deploy บน Render (แผนฟรี)

## โครงสร้าง
- `backend/main.py` FastAPI, มี `/api/health` และเสิร์ฟหน้าเว็บ
- `frontend/index.html` หน้าเว็บเริ่มต้น (จะถูกแทนด้วย React + TypeScript ภายหลัง)
- `requirements.txt` แพ็กเกจ Python
- `render.yaml` การตั้งค่า Render (Blueprint)
- `docs/` กฎการจัดตาราง, สไตล์หน้าเว็บ, และระบบล็อกอิน (อ่านก่อนแก้โค้ดที่เกี่ยวข้อง)

## รันในเครื่อง
```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload
```
เปิด http://127.0.0.1:8000

## Deploy บน Render (แผนฟรี)
1. Push โค้ดนี้ขึ้น GitHub
2. ที่ Render เลือก New → Blueprint แล้วเลือก repo นี้ (Render จะอ่าน `render.yaml`)
3. ใส่ค่า `TIMETABLE_ADMIN_PASSWORD` ในหน้า Environment ก่อนกด Apply (ห้ามใช้ค่าเริ่มต้นบนระบบจริง)
4. รอ build เสร็จ แล้วเปิด URL ที่ Render ให้

## ข้อจำกัดของแผนฟรี
- บริการจะ sleep หลังไม่มีคนใช้ประมาณ 15 นาที เปิดครั้งแรกจะช้า ราว 30–60 วินาที
- ระบบไฟล์เป็นแบบชั่วคราว ข้อมูลที่เขียนลงไฟล์หรือ SQLite จะหายเมื่อ redeploy หรือรีสตาร์ต
  ดังนั้นยังไม่ควรใช้เก็บข้อมูลจริง จนกว่าจะเพิ่มฐานข้อมูลภายนอกหรือย้ายไปแผนที่มี disk ถาวร
