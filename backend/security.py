"""รหัสผ่าน (PBKDF2-HMAC-SHA256) และโทเคนแบบลงนาม HMAC-SHA256 ตาม docs/auth-rules.md"""

import base64
import hashlib
import hmac
import json
import secrets
import time

from sqlalchemy.orm import Session

from .models import AppSetting, UserAccount

PBKDF2_ROUNDS = 200_000
TOKEN_TTL_SECONDS = 12 * 60 * 60
MIN_PASSWORD_LENGTH = 6
BULK_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return f"pbkdf2${PBKDF2_ROUNDS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, rounds, salt_hex, hash_hex = stored.split("$")
        if scheme != "pbkdf2":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(rounds))
        return hmac.compare_digest(digest.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


# hash จำลอง ใช้ตรวจรหัสเมื่อไม่พบชื่อผู้ใช้ เพื่อให้เวลาตอบสนองเท่ากัน
DUMMY_HASH = hash_password(secrets.token_hex(16))


def random_password(length: int = 8) -> str:
    return "".join(secrets.choice(BULK_PASSWORD_ALPHABET) for _ in range(length))


def get_auth_secret(db: Session) -> bytes:
    row = db.get(AppSetting, "auth_secret")
    if row is None:
        row = AppSetting(key="auth_secret", value=secrets.token_hex(32))
        db.add(row)
        db.commit()
    return bytes.fromhex(row.value)


def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def password_fingerprint(user: UserAccount) -> str:
    return user.password_hash[-16:]


def make_token(db: Session, user: UserAccount) -> str:
    payload = {"uid": user.id, "exp": int(time.time()) + TOKEN_TTL_SECONDS, "pv": password_fingerprint(user)}
    body = _b64e(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(get_auth_secret(db), body.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def user_from_token(db: Session, token: str | None) -> UserAccount | None:
    if not token or "." not in token:
        return None
    body, sig = token.rsplit(".", 1)
    expected = hmac.new(get_auth_secret(db), body.encode("ascii", "ignore"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        payload = json.loads(_b64d(body))
        uid = int(payload["uid"])
        exp = int(payload["exp"])
        pv = str(payload["pv"])
    except (ValueError, KeyError, TypeError):
        return None
    if exp < time.time():
        return None
    user = db.get(UserAccount, uid)
    if user is None or not user.is_active:
        return None
    if not hmac.compare_digest(pv, password_fingerprint(user)):
        return None
    return user
