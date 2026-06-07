"use strict";

function setBadgeText(enabled) {
    const text = enabled ? "ON" : "OFF"
    void chrome.action.setBadgeText({text: text})
}

const checkbox = document.getElementById("enabled")
const statusText = document.getElementById("status-text")
const ignoredWordInput = document.getElementById("ignored-word-input")
const addIgnoredWordButton = document.getElementById("add-ignored-word")
const ignoredWordsList = document.getElementById("ignored-words-list")
const ignoredWordsEmpty = document.getElementById("ignored-words-empty")
const reloadNotice = document.getElementById("reload-notice")
const reloadPageButton = document.getElementById("reload-page")

let ignoredWords = []
function normalizeIgnoredWord(word) {
    return word.trim().toLowerCase()
}

function renderIgnoredWords() {
    ignoredWordsList.innerHTML = ""
    ignoredWordsEmpty.hidden = ignoredWords.length > 0
    for (const word of ignoredWords) {
        const piece = document.createElement("div")
        piece.className = "ignored-word-chip"
        const text = document.createElement("span")
        text.textContent = word
        const removeButton = document.createElement("button")
        removeButton.type = "button"
        removeButton.textContent = "Remove"
        removeButton.addEventListener("click", () => {
            ignoredWords = ignoredWords.filter(w => w !== word)
            void chrome.storage.sync.set({"ignoredWords": ignoredWords})
            renderIgnoredWords()
        })
        piece.appendChild(text)
        piece.appendChild(removeButton)
        ignoredWordsList.appendChild(piece)
    }
}

function addIgnoredWord() {
    const word = normalizeIgnoredWord(ignoredWordInput.value)
    if (!word) {
        return
    }
    if (!ignoredWords.includes(word)) {
        ignoredWords = [...ignoredWords, word].sort()
        void chrome.storage.sync.set({"ignoredWords": ignoredWords})
    }
    ignoredWordInput.value = ""
    renderIgnoredWords()
}

chrome.storage.sync.get("ignoredWords", (data) => {
    ignoredWords = Array.isArray(data.ignoredWords) ? data.ignoredWords : []
    renderIgnoredWords()
})

addIgnoredWordButton.addEventListener("click", addIgnoredWord)

ignoredWordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault()
        addIgnoredWord()
    }
})


function renderEnabledState(enabled) {
    checkbox.checked = enabled
    statusText.textContent = enabled ? "On" : "Off"
    statusText.classList.toggle("off", !enabled)
    void setBadgeText(enabled)
}

function showReloadNotice() {
    reloadNotice.hidden = false
}

chrome.storage.sync.get("enabled", (data) => {
    renderEnabledState(data.enabled !== false)
})

checkbox.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement) {
        const enabled = event.target.checked
        void chrome.storage.sync.set({"enabled": enabled})
        renderEnabledState(enabled)
        showReloadNotice()
    }
})

reloadPageButton.addEventListener("click", () => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        const tab = tabs[0]

        if (!tab?.id) {
            reloadNotice.querySelector("p").textContent = "Reload this page manually to apply the change."
            return
        }

        chrome.tabs.reload(tab.id, () => {
            if (chrome.runtime.lastError) {
                reloadNotice.querySelector("p").textContent = "Reload this page manually to apply the change."
                return
            }

            window.close()
        })
    })
})


const hotKeyInput = document.getElementById("hotkey")

function isMac() {
    return navigator.platform.toUpperCase().includes("MAC")
}

function eventToHotkey(event) {
    const parts = []
    const usesMod = isMac() ? event.metaKey : event.ctrlKey
    if (usesMod)
    {
        parts.push("Mod")
    }
    if (isMac() && event.ctrlKey)
    {
        parts.push("Ctrl")
    }
    if (event.altKey)
    {
        parts.push("Alt")
    }
    if (event.shiftKey)
    {
        parts.push("Shift")
    }
    const key = event.key.length === 1
        ? event.key.toUpperCase() : event.key

    if (!["Control", "Shift", "Alt", "Meta"].includes(key)) {
        parts.push(key)
    }

    return parts.join("+")
}

chrome.storage.sync.get("hotkey", (data) => {
    hotKeyInput.value = data.hotkey || "Mod+Shift+K"
})

hotKeyInput.addEventListener("keydown", (event) => {
    event.preventDefault()
    const hotkey = eventToHotkey(event)
    if (hotkey) {
        hotKeyInput.value = hotkey
        void chrome.storage.sync.set({"hotkey": hotkey})
    }
})
