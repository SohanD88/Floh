import spellcheck

def typo_match(offset, length, replacements, issue_type="misspelling", category_id="TYPOS"):
    return {
        "offset": offset,
        "length": length,
        "replacements": [{"value": value} for value in replacements],
        "rule": {"issueType": issue_type, "category": {"id": category_id},},
    }

def test_empty_sentence():
    result = spellcheck.find_misspelled_word("", 10)
    assert result == {
        "word": None,
        "correction": None,
        "suggestions": [],
        "start": None,
        "end": None,
        "cursor_position": 0,
    }

def test_cursor_position_clamp(monkeypatch):
    monkeypatch.setattr(spellcheck, "get_languagetool_matches", lambda sentence: [])

    result = spellcheck.find_misspelled_word("hello", 999)

    assert result["cursor_position"] == 5

def test_nearest_typo_to_cursor(monkeypatch):
    sentence = "This is a speling and setnece"
    matches = [
        typo_match(10, 7, ["spelling"]),
        typo_match(22, 7, ["sentence"]),
    ]
    monkeypatch.setattr(spellcheck, "get_languagetool_matches", lambda sentence: matches)

    result = spellcheck.find_misspelled_word(sentence, len(sentence))

    assert result["word"] == "setnece"
    assert result["correction"] == "sentence"
    assert result["start"] == 22
    assert result["end"] == 29


def test_ignore_typo_after_cursorpos(monkeypatch):
    sentence = "bad speling"
    matches = [typo_match(4, 7, ["spelling"])]
    monkeypatch.setattr(spellcheck, "get_languagetool_matches", lambda sentence: matches)

    result = spellcheck.find_misspelled_word(sentence, 3)

    assert result["word"] is None
    assert result["correction"] is None

def test_ignored_words_are_skipped(monkeypatch):
    sentence = "Floh"
    matches = [typo_match(0, 4, ["Flow"])]
    monkeypatch.setattr(spellcheck, "get_languagetool_matches", lambda sentence: matches)

    result = spellcheck.find_misspelled_word(sentence, 4, ignored_words=["floh"])

    assert result["word"] is None
    assert result["correction"] is None


def test_non_spelling_match_is_ignored(monkeypatch):
    sentence = "This are wrong"
    matches = [typo_match(5, 3, ["is"], issue_type="grammar", category_id="GRAMMAR")]
    monkeypatch.setattr(spellcheck, "get_languagetool_matches", lambda sentence: matches)

    result = spellcheck.find_misspelled_word(sentence, len(sentence))

    assert result["word"] is None
    assert result["correction"] is None


def test_match_with_whitespace_is_ignored(monkeypatch):
    sentence = "bad phrase"
    matches = [typo_match(0, 10, ["badphrase"])]
    monkeypatch.setattr(spellcheck, "get_languagetool_matches", lambda sentence: matches)

    result = spellcheck.find_misspelled_word(sentence, len(sentence))

    assert result["word"] is None
    assert result["correction"] is None


def test_suggestions_are_deduped_and_limited(monkeypatch):
    sentence = "mesage"
    replacements = [
        "message",
        "message",
        "massage",
        "messages",
        "messaged",
        "messenger",
        "mess",
    ]
    matches = [typo_match(0, 6, replacements)]
    monkeypatch.setattr(spellcheck, "get_languagetool_matches", lambda sentence: matches)

    result = spellcheck.find_misspelled_word(sentence, len(sentence))

    assert result["correction"] == "message"
    assert result["suggestions"] == [
        "message",
        "massage",
        "messages",
        "messaged",
        "messenger",
    ]


def test_match_without_replacements_is_ignored(monkeypatch):
    sentence = "speling"
    matches = [typo_match(0, 7, [])]
    monkeypatch.setattr(spellcheck, "get_languagetool_matches", lambda sentence: matches)

    result = spellcheck.find_misspelled_word(sentence, len(sentence))

    assert result["word"] is None
    assert result["correction"] is None