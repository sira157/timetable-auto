"""ปรับข้อความจากไฟล์นำเข้าให้เทียบกันได้

คนกรอก Excel มักพิมพ์เว้นวรรคต่างกันเล็กน้อย เช่น "ห้องประชุม 1" กับ "ห้องประชุม1"
มีช่องว่างเกินท้ายชื่อ หรือใช้เลขไทย ก่อนเทียบชื่อจึงต้องปรับข้อความให้อยู่รูปเดียวกัน
"""

from __future__ import annotations

import re

THAI_DIGITS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")
# อักขระที่มองไม่เห็นซึ่งมักติดมาจากการคัดลอก (zero-width space/joiner, BOM)
INVISIBLE = re.compile("[​‌‍⁠﻿]")
SPACES = re.compile(r"\s+")  # รวมช่องว่างไม่ตัดบรรทัด (NBSP) และแท็บ


def norm_text(value) -> str:
    """ตัดช่องว่างหน้า-ท้าย ยุบช่องว่างซ้อนเหลือช่องเดียว และแปลงเลขไทยเป็นเลขอารบิก"""
    s = INVISIBLE.sub("", str(value if value is not None else ""))
    s = s.translate(THAI_DIGITS)
    return SPACES.sub(" ", s).strip()


def match_key(value) -> str:
    """คีย์สำหรับเทียบชื่อ: เหมือน norm_text แต่ไม่สนใจช่องว่างเลยและไม่สนตัวพิมพ์เล็กใหญ่"""
    return SPACES.sub("", norm_text(value)).casefold()
