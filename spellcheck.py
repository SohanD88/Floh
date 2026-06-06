import os
import re
import sys

import requests

LANGUAGETOOL_URL = os.getenv(
    "LANGUAGETOOL_URL",
    "http://127.0.0.1:8081/v2/check",
)

LANGUAGE = os.getenv("LANGUAGETOOL_LANGUAGE", "en-US")
TIMEOUT_SECONDS = 5

def check_languagetool_health():
    response = requests.post(
        LANGUAGETOOL_URL,
        data={
            "text": "health check",
            "language": LANGUAGE,
        },
        timeout=2,
    )
    response.raise_for_status()

def empty_result(cursor_position):
    return {
        "word": None,
        "correction": None,
        "suggestions": [],
        "start": None,
        "end": None,
        "cursor_position": cursor_position,
    }


def normalize_ignored_words(ignored_words): 
    return {
        word.strip().lower()
        for word in (ignored_words or [])
        if word.strip()
    }


def is_spelling_match(match):
    rule = match.get("rule", {})
    category = rule.get("category", {})

    return (
        rule.get("issueType") == "misspelling"
        or category.get("id") == "TYPOS"
    )


def has_whitespace(text):
    return re.search(r"\s", text) is not None


def get_languagetool_matches(sentence):
    response = requests.post(
        LANGUAGETOOL_URL,
        data={
            "text": sentence,
            "language": LANGUAGE,
        },
        timeout=TIMEOUT_SECONDS,
    )

    response.raise_for_status()
    data = response.json()
    return data.get("matches", [])


def find_misspelled_word(sentence, cursor_position, ignored_words=None, skip_start=None, skip_end=None):
    cursor_position = max(0, min(cursor_position, len(sentence)))
    ignored_words = normalize_ignored_words(ignored_words)

    if not sentence.strip():
        return empty_result(cursor_position)

    matches = get_languagetool_matches(sentence)
    candidates = []

    for match in matches:
        if not is_spelling_match(match):
            continue

        start = match.get("offset")
        length = match.get("length")
        replacements = match.get("replacements", [])

        if not isinstance(start, int) or not isinstance(length, int):
            continue

        end = start + length

        if skip_start is not None and skip_end is not None and start == skip_start and end == skip_end:
            continue

        if not replacements:
            continue

        wrong_text = sentence[start:end]
        suggestions = list(dict.fromkeys(
            replacement.get("value")
            for replacement in replacements
            if replacement.get("value")
        ))[:5]

        if not suggestions:
            continue

        correction = suggestions[0]
        if has_whitespace(wrong_text):
            continue

        if wrong_text.lower() in ignored_words:
            continue

        candidates.append({
            "word": wrong_text,
            "correction": correction,
            "suggestions": suggestions,
            "start": start,
            "end": end,
            "cursor_position": cursor_position,
        })

    if not candidates:
        return empty_result(cursor_position)

    before_cursor = [
        candidate for candidate in candidates
        if candidate["start"] <= cursor_position
    ]

    if before_cursor:
        return max(before_cursor, key=lambda item: item["start"])

    return max(candidates, key=lambda item: item["start"])


if __name__ == "__main__":
    if len(sys.argv) == 3:
        sentence = sys.argv[1]
        cursor_position = int(sys.argv[2])
    else:
        sentence = input("Enter a sentence: ")
        cursor_position = len(sentence)

    result = find_misspelled_word(sentence, cursor_position)
    print(result)
