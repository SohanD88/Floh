const SPELLCHECK_API_URL = "https://floh-api-sohand88.fly.dev/spellcheck"
const MAX_SENTENCE_LENGTH = 20000
const MAX_IGNORED_WORDS = 500
const MAX_IGNORED_WORD_LENGTH = 100
const SPELLCHECK_TIMEOUT_MS = 15000

"use strict"

function setbadgeText(enabled) {
    const text = enabled ? "ON" : "OFF"
    void chrome.action.setBadgeText({text: text})
}

function isValidOptionalOffset(payload, key) {
    return (
        payload[key] === undefined ||
        payload[key] === null ||
        (
            Number.isInteger(payload[key]) &&
            payload[key] >= 0 &&
            payload[key] <= payload.sentence.length
        )
    )
}

function isValidSpellcheckPayload(payload) {
    return (
        typeof payload?.sentence === "string" &&
        payload.sentence.length <= MAX_SENTENCE_LENGTH &&
        Number.isInteger(payload.cursor_position) &&
        payload.cursor_position >= 0 &&
        payload.cursor_position <= payload.sentence.length &&
        Array.isArray(payload.ignored_words) &&
        payload.ignored_words.length <= MAX_IGNORED_WORDS &&
        payload.ignored_words.every(word =>
            typeof word === "string" && word.length <= MAX_IGNORED_WORD_LENGTH
        ) &&
        isValidOptionalOffset(payload, "skip_start") &&
        isValidOptionalOffset(payload, "skip_end")
    )
}

async function requestSpellcheck(payload) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), SPELLCHECK_TIMEOUT_MS)

    try {
        const response = await fetch(SPELLCHECK_API_URL, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload),
            signal: controller.signal
        })

        const body = await response.json().catch(() => null)

        if (!response.ok) {
            return {
                ok: false,
                status: response.status,
                error: body?.detail || "Spellcheck request failed"
            }
        }

        return {
            ok: true,
            body
        }
    } finally {
        clearTimeout(timeout)
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "SPELLCHECK") {
        return false
    }

    if (!isValidSpellcheckPayload(message.payload)) {
        sendResponse({
            ok: false,
            status: 400,
            error: "Invalid spellcheck request"
        })
        return false
    }

    requestSpellcheck(message.payload)
        .then(sendResponse)
        .catch(error => {
            sendResponse({
                ok: false,
                error: String(error)
            })
        })

    return true
})

function startUp(){
    chrome.storage.sync.get("enabled", (data) => {
        setbadgeText(data.enabled !== false)
    })
}

chrome.runtime.onStartup.addListener(startUp)
chrome.runtime.onInstalled.addListener(startUp)
