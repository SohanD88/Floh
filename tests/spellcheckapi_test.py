import requests
from fastapi.testclient import TestClient

import spellcheckAPI


client = TestClient(spellcheckAPI.app)


def test_health_ok(monkeypatch):
    monkeypatch.setattr(spellcheckAPI, "check_languagetool_health", lambda: None)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "languagetool": "ok",
    }


def test_health_degraded_when_languagetool_unavailable(monkeypatch):
    def raise_error():
        raise requests.RequestException("down")

    monkeypatch.setattr(spellcheckAPI, "check_languagetool_health", raise_error)

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {
        "status": "degraded",
        "languagetool": "unavailable",
    }


def test_spellcheck_success(monkeypatch):
    expected = {
        "word": "sentnce",
        "correction": "sentence",
        "suggestions": ["sentence"],
        "start": 10,
        "end": 17,
        "cursor_position": 17,
    }

    def fake_find_misspelled_word(sentence, cursor_position, ignored_words):
        assert sentence == "bad sentnce"
        assert cursor_position == 17
        assert ignored_words == []
        return expected

    monkeypatch.setattr(spellcheckAPI, "find_misspelled_word", fake_find_misspelled_word)

    response = client.post("/spellcheck", json={
        "sentence": "bad sentnce",
        "cursor_position": 17,
    })

    assert response.status_code == 200
    assert response.json() == expected


def test_spellcheck_passes_ignored_words(monkeypatch):
    expected = {
        "word": None,
        "correction": None,
        "suggestions": [],
        "start": None,
        "end": None,
        "cursor_position": 4,
    }

    def fake_find_misspelled_word(sentence, cursor_position, ignored_words):
        assert ignored_words == ["floh"]
        return expected

    monkeypatch.setattr(spellcheckAPI, "find_misspelled_word", fake_find_misspelled_word)

    response = client.post("/spellcheck", json={
        "sentence": "Floh",
        "cursor_position": 4,
        "ignored_words": ["floh"],
    })

    assert response.status_code == 200
    assert response.json() == expected


def test_spellcheck_returns_503_when_languagetool_unavailable(monkeypatch):
    def raise_error(sentence, cursor_position, ignored_words):
        raise requests.RequestException("down")

    monkeypatch.setattr(spellcheckAPI, "find_misspelled_word", raise_error)

    response = client.post("/spellcheck", json={
        "sentence": "bad sentnce",
        "cursor_position": 11,
    })

    assert response.status_code == 503
    assert response.json() == {
        "detail": "LanguageTool is unavailable",
    }

def test_spellcheck_rejects_oversized_sentence():
    response = client.post("/spellcheck", json={
        "sentence": "a" * 20_001,
        "cursor_position": 0,
        "ignored_words": [],
    })

    assert response.status_code == 422


def test_spellcheck_rejects_too_many_ignored_words():
    response = client.post("/spellcheck", json={
        "sentence": "hello",
        "cursor_position": 5,
        "ignored_words": ["word"] * 501,
    })

    assert response.status_code == 422


def test_spellcheck_rejects_large_request_body():
    response = client.post(
        "/spellcheck",
        content=b"x" * 100_001,
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 413

def test_spellcheck_response_is_not_cached(monkeypatch):
    monkeypatch.setattr(
        spellcheckAPI,
        "find_misspelled_word",
        lambda sentence, cursor_position, ignored_words: {
            "word": None,
            "correction": None,
            "suggestions": [],
            "start": None,
            "end": None,
            "cursor_position": cursor_position,
        },
    )

    response = client.post("/spellcheck", json={
        "sentence": "hello",
        "cursor_position": 5,
        "ignored_words": [],
    })

    assert response.headers["cache-control"] == "no-store"