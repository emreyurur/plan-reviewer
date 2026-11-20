from __future__ import annotations

import re
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, model_validator


TaskId = Annotated[StrictStr, Field(min_length=1)]


class Task(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    id: TaskId
    name: StrictStr
    owner: StrictStr | None
    duration_days: Annotated[StrictInt, Field(ge=1)]
    depends_on: list[TaskId]


class ReviewTask(Task):
    quote: StrictStr


class Finding(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    title: StrictStr
    detail: StrictStr
    quote: StrictStr | None


class ScheduleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    tasks: Annotated[list[Task], Field(max_length=60)]
    deadline_day: StrictInt

    @model_validator(mode="after")
    def validate_references(self):
        ids = [task.id for task in self.tasks]
        if len(ids) != len(set(ids)):
            raise ValueError("task ids must be unique")
        known = set(ids)
        for task in self.tasks:
            unknown = set(task.depends_on) - known
            if unknown:
                raise ValueError(
                    f"task {task.id!r} has unknown dependencies: {', '.join(sorted(unknown))}"
                )
        return self


class Review(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    deadline_day: StrictInt | None
    tasks: Annotated[list[ReviewTask], Field(max_length=60)]
    findings: list[Finding]

    @model_validator(mode="after")
    def validate_references(self):
        ids = [task.id for task in self.tasks]
        if len(ids) != len(set(ids)):
            raise ValueError("task ids must be unique")
        known = set(ids)
        for task in self.tasks:
            unknown = set(task.depends_on) - known
            if unknown:
                raise ValueError(
                    f"task {task.id!r} has unknown dependencies: {', '.join(sorted(unknown))}"
                )
        return self


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def validate_review_quotes(review: Review, plan_text: str) -> None:
    normalized_plan = normalize_whitespace(plan_text)
    quotes = [task.quote for task in review.tasks]
    quotes.extend(finding.quote for finding in review.findings if finding.quote is not None)
    for quote in quotes:
        if normalize_whitespace(quote) not in normalized_plan:
            raise ValueError(f"quote is not present word for word in the plan: {quote!r}")
