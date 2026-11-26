import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp(prefix="timetable-test-")
os.environ["TIMETABLE_DATA_DIR"] = _tmp
os.environ["TIMETABLE_ADMIN_PASSWORD"] = "admin-start"
os.environ.pop("TIMETABLE_AUTH_DISABLED", None)

from fastapi.testclient import TestClient  # noqa: E402

from backend import auth  # noqa: E402
from backend.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    auth.reset_rate_limit()
    yield


def login(client, username, password):
    return client.post("/api/auth/login", json={"username": username, "password": password})


@pytest.fixture(scope="session")
def admin_token(client):
    r = login(client, "admin", "admin-start")
    assert r.status_code == 200
    tok = r.json()["token"]
    r = client.post("/api/auth/password", json={"old_password": "admin-start", "new_password": "admin-new-pw"},
                    headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    return r.json()["token"]


def H(token):
    return {"Authorization": f"Bearer {token}"}
