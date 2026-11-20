import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.scheduler import schedule  # noqa: E402


def task(id, duration_days, depends_on=(), owner=None):
    return {"id": id, "name": id, "owner": owner, "duration_days": duration_days, "depends_on": list(depends_on)}


def test_single_task_ends_after_its_duration():
    result = schedule([task("A", 3)], 10)
    assert result["schedule"] == [{"id": "A", "start_day": 0, "end_day": 3}]
    assert result["end_day"] == 3


def test_dependent_task_starts_after_its_dependency():
    result = schedule([task("A", 3), task("B", 2, ["A"])], 10)
    by_id = {item["id"]: item for item in result["schedule"]}
    assert by_id["B"]["start_day"] == 3
    assert result["end_day"] == 5


def test_tasks_for_same_owner_never_overlap_and_finish_optimally():
    result = schedule(
        [task("A", 3, owner="Ann"), task("B", 2, ["A"], "Ann"), task("C", 4, owner="Ann")],
        10,
    )
    assert result["end_day"] == 9
    assert result["optimal"] is True
    items = sorted(result["schedule"], key=lambda item: item["start_day"])
    assert all(left["end_day"] <= right["start_day"] for left, right in zip(items, items[1:]))


def test_different_and_null_owners_can_work_in_parallel():
    result = schedule(
        [task("A", 5, owner="Ann"), task("B", 4, owner="Bob"), task("C", 3)], 5
    )
    assert result["end_day"] == 5
    assert {item["start_day"] for item in result["schedule"]} == {0}


def test_cycle_is_reported():
    result = schedule([task("A", 1, ["B"]), task("B", 1, ["A"])], 10)
    assert result["status"] == "cycle"
    assert result["schedule"] == []
    assert set(result["cycle"]) == {"A", "B"}
    assert result["end_day"] is None


def test_self_dependency_is_a_cycle():
    result = schedule([task("A", 1, ["A"])], 10)
    assert result["cycle"] == ["A"]


def test_unknown_deadline_keeps_schedule_but_not_feasibility():
    result = schedule([task("A", 1)], None)
    assert result["end_day"] == 1
    assert result["meets_deadline"] is None
    assert result["days_late"] is None
