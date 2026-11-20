from __future__ import annotations

from collections import defaultdict

from ortools.sat.python import cp_model


def _as_dict(task):
    return task.model_dump() if hasattr(task, "model_dump") else task


def _find_cycle(tasks: list[dict]) -> list[str]:
    dependencies = {task["id"]: task["depends_on"] for task in tasks}
    state: dict[str, int] = {}
    stack: list[str] = []
    positions: dict[str, int] = {}

    def visit(task_id: str) -> list[str] | None:
        state[task_id] = 1
        positions[task_id] = len(stack)
        stack.append(task_id)
        for dependency in dependencies[task_id]:
            if state.get(dependency, 0) == 0:
                cycle = visit(dependency)
                if cycle:
                    return cycle
            elif state.get(dependency) == 1:
                return stack[positions[dependency] :]
        stack.pop()
        positions.pop(task_id)
        state[task_id] = 2
        return None

    for task_id in dependencies:
        if state.get(task_id, 0) == 0:
            cycle = visit(task_id)
            if cycle:
                return cycle
    return []


def schedule(tasks, deadline_day):
    tasks = [_as_dict(task) for task in tasks]
    cycle = _find_cycle(tasks)
    if cycle:
        return {
            "status": "cycle",
            "schedule": [],
            "end_day": None,
            "deadline_day": deadline_day,
            "meets_deadline": None,
            "days_late": None,
            "cycle": cycle,
        }

    if not tasks:
        return {
            "status": "scheduled",
            "schedule": [],
            "end_day": 0,
            "deadline_day": deadline_day,
            "meets_deadline": None if deadline_day is None else 0 <= deadline_day,
            "days_late": None if deadline_day is None else max(0, -deadline_day),
            "cycle": [],
            "optimal": True,
        }

    horizon = sum(task["duration_days"] for task in tasks)
    model = cp_model.CpModel()
    starts = {}
    ends = {}
    intervals = {}
    for task in tasks:
        task_id = task["id"]
        starts[task_id] = model.new_int_var(0, horizon, f"start_{task_id}")
        ends[task_id] = model.new_int_var(0, horizon, f"end_{task_id}")
        intervals[task_id] = model.new_interval_var(
            starts[task_id], task["duration_days"], ends[task_id], f"task_{task_id}"
        )

    for task in tasks:
        for dependency in task["depends_on"]:
            model.add(starts[task["id"]] >= ends[dependency])

    by_owner = defaultdict(list)
    for task in tasks:
        if task["owner"] is not None:
            by_owner[task["owner"]].append(intervals[task["id"]])
    for owner_intervals in by_owner.values():
        if len(owner_intervals) > 1:
            model.add_no_overlap(owner_intervals)

    makespan = model.new_int_var(0, horizon, "makespan")
    model.add_max_equality(makespan, list(ends.values()))
    model.minimize(makespan)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 8.0
    solver.parameters.num_search_workers = 8
    status = solver.solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError("the scheduler could not produce a valid schedule")

    items = [
        {
            "id": task["id"],
            "start_day": solver.value(starts[task["id"]]),
            "end_day": solver.value(ends[task["id"]]),
        }
        for task in tasks
    ]
    end_day = solver.value(makespan)
    return {
        "status": "scheduled",
        "schedule": items,
        "end_day": end_day,
        "deadline_day": deadline_day,
        "meets_deadline": None if deadline_day is None else end_day <= deadline_day,
        "days_late": None if deadline_day is None else max(0, end_day - deadline_day),
        "cycle": [],
        "optimal": status == cp_model.OPTIMAL,
        "best_bound": int(round(solver.best_objective_bound)),
    }
