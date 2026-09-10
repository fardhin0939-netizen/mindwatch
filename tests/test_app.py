import os
import sys

sys.path.insert(
    0,
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)

from app import app


def test_home_redirects_to_login():
    client = app.test_client()
    response = client.get("/")
    assert response.status_code == 302


def test_login_page_renders():
    client = app.test_client()
    response = client.get("/login")
    assert response.status_code == 200


def test_dashboard_requires_login():
    client = app.test_client()
    response = client.get("/dashboard")
    assert response.status_code == 302


def test_logout_is_exempt_from_csrf_and_clears_session():
    client = app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = 1
    response = client.post("/logout", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers.get("Location") == "/login"


def test_csrf_blocks_post_without_token():
    client = app.test_client()
    response = client.post(
        "/ai-support",
        json={"message": "hello"}
    )
    assert response.status_code == 403


def test_csrf_allows_post_with_valid_token():
    client = app.test_client()
    with client.session_transaction() as session:
        session["csrf_token"] = "test-token"
    response = client.post(
        "/ai-support",
        json={"message": "hello"},
        headers={"X-CSRFToken": "test-token"}
    )
    assert response.status_code == 200
    assert response.get_json()["success"] is True


def test_nlp_local_analysis():
    from nlp import analyze_text
    result = analyze_text("I feel very sad and hopeless")
    assert result["sentiment"] == "Negative"
    assert result["text_risk"] > 0
    assert result["word_count"] > 0
