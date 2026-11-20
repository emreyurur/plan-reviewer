import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.review import ReviewError, review_plan  # noqa: E402


class FakeResponse:
    def __init__(self, content):
        self.content = content

    def raise_for_status(self):
        return None

    def json(self):
        return {"choices": [{"message": {"content": self.content}}]}


class FakeClient:
    def __init__(self, replies):
        self.replies = iter(replies)

    def post(self, *_args, **_kwargs):
        return FakeResponse(next(self.replies))


def fake_client(*replies):
    return FakeClient(replies)


def valid_review(quote="Ann books the hall in three days."):
    return (
        '{"deadline_day":10,"tasks":[{"id":"A","name":"Book hall","owner":"Ann",'
        f'"duration_days":3,"depends_on":[],"quote":"{quote}"}}],"findings":[]}}'
    )


def test_review_accepts_exact_quote():
    result = review_plan(
        "Plan\nAnn books the hall in three days.", client=fake_client(valid_review())
    )
    assert result["tasks"][0]["id"] == "A"


def test_review_retries_invalid_json():
    result = review_plan(
        "Ann books the hall in three days.", client=fake_client("not json", valid_review())
    )
    assert result["deadline_day"] == 10


def test_review_rejects_invented_quote_after_retry():
    bad = valid_review("This sentence was invented.")
    with pytest.raises(ReviewError, match="usable review"):
        review_plan("Ann books the hall in three days.", client=fake_client(bad, bad))
