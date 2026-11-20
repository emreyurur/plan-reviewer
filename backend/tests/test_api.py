import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402


def test_plans_are_listed():
    response = TestClient(app).get("/api/plans")
    assert response.status_code == 200
    assert {plan["id"] for plan in response.json()} == {"spring-market", "lantern-festival", "harbour-run"}


def test_health_check():
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_vercel_frontend_is_allowed_by_cors():
    response = TestClient(app).options(
        "/api/plans",
        headers={
            "Origin": "https://plan-reviewer-example.vercel.app",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://plan-reviewer-example.vercel.app"


def valid_body():
    return {
        "tasks": [
            {"id": "A", "name": "A", "owner": None, "duration_days": 1, "depends_on": []}
        ],
        "deadline_day": 10,
    }


def test_schedule_accepts_valid_input():
    response = TestClient(app).post("/api/schedule", json=valid_body())
    assert response.status_code == 200
    assert response.json()["end_day"] == 1


def test_schedule_rejects_duplicate_ids():
    body = valid_body()
    body["tasks"].append(dict(body["tasks"][0]))
    assert TestClient(app).post("/api/schedule", json=body).status_code == 422


def test_schedule_rejects_unknown_dependencies():
    body = valid_body()
    body["tasks"][0]["depends_on"] = ["missing"]
    assert TestClient(app).post("/api/schedule", json=body).status_code == 422


def test_schedule_rejects_boolean_duration_and_too_many_tasks():
    body = valid_body()
    body["tasks"][0]["duration_days"] = True
    assert TestClient(app).post("/api/schedule", json=body).status_code == 422

    body = valid_body()
    body["tasks"] = [
        {"id": str(i), "name": "task", "owner": None, "duration_days": 1, "depends_on": []}
        for i in range(61)
    ]
    assert TestClient(app).post("/api/schedule", json=body).status_code == 422


def test_unknown_plan_is_404():
    assert TestClient(app).get("/api/plans/not-a-plan").status_code == 404


def test_ai_review_requires_server_configuration(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    response = TestClient(app).post("/api/plans/spring-market/review")
    assert response.status_code == 503
    assert response.json()["detail"] == "AI review is not configured on the server"
