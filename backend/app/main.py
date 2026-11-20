import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from .scheduler import schedule
from .schemas import ScheduleRequest
from .review import ReviewError, review_plan

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
DIST = ROOT / "frontend" / "dist"

app = FastAPI()


@app.get("/api/health", include_in_schema=False)
def health_check():
    return {"status": "ok"}


@app.get("/api/plans")
def list_plans():
    plans = []
    for path in sorted((DATA / "plans").glob("*.md"), reverse=True):
        title = next((line.lstrip("# ").strip() for line in path.read_text(encoding="utf-8").splitlines() if line.startswith("#")), path.stem)
        plans.append({"id": path.stem, "title": title})
    return plans


@app.get("/api/plans/{plan_id}")
def get_plan(plan_id: str):
    if not plan_id or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in plan_id):
        raise HTTPException(status_code=404, detail="Plan not found")
    plan_path = DATA / "plans" / f"{plan_id}.md"
    review_path = DATA / "reviews" / f"{plan_id}.json"
    if not plan_path.is_file() or not review_path.is_file():
        raise HTTPException(status_code=404, detail="Plan not found")
    text = plan_path.read_text(encoding="utf-8")
    review = json.loads(review_path.read_text(encoding="utf-8"))
    return {
        "id": plan_id,
        "text": text,
        "review": review,
        "schedule": schedule(review["tasks"], review["deadline_day"]),
    }


@app.post("/api/plans/{plan_id}/review")
def run_ai_review(plan_id: str):
    if not plan_id or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in plan_id):
        raise HTTPException(status_code=404, detail="Plan not found")
    plan_path = DATA / "plans" / f"{plan_id}.md"
    if not plan_path.is_file():
        raise HTTPException(status_code=404, detail="Plan not found")
    if not os.environ.get("DEEPSEEK_API_KEY"):
        raise HTTPException(status_code=503, detail="AI review is not configured on the server")
    try:
        review = review_plan(plan_path.read_text(encoding="utf-8"))
    except ReviewError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {
        "review": review,
        "schedule": schedule(review["tasks"], review["deadline_day"]),
        "provider": "DeepSeek",
        "model": os.environ.get("REVIEW_MODEL", "deepseek-flash"),
    }


@app.post("/api/schedule")
def post_schedule(body: ScheduleRequest):
    return schedule(body.tasks, body.deadline_day)


if DIST.exists():
    app.mount("/", StaticFiles(directory=DIST, html=True))
