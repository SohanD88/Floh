"use strict"


let hotkey = "Mod+Shift+K"
let pendingCorrection = null
let correctionPopup = null
let ignoredWords = []
let spellCheckReqId = 0
let backendErrorPopup = null
let backendErrorTimeoutId = null
let unsupportedEditorPopup = null
const SPELLCHECK_CONTEXT_CHARS = 8000
const SPELLCHECK_BOUNDARY_SEARCH_CHARS = 200

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

    if (typeof event.key !== "string")
        {
            return ""
        }     

    const key = event.key.length === 1
        ? event.key.toUpperCase() : event.key  

    if (!["Control", "Shift", "Alt", "Meta"].includes(key)) {
        parts.push(key)
    }

    return parts.join("+")
}

function isTextElement(element) {
    if (element instanceof HTMLTextAreaElement) {
        return true
    }
    if(! (element instanceof HTMLInputElement)) {
        return false
    }

    const textTypes = ["text", "search", "url", "tel"]
    return textTypes.includes(element.type)
}

const CONTENT_EDITABLE_SELECTOR = [
    "[contenteditable='true']",
    "[contenteditable='plaintext-only']",
    "[g_editable='true'][contenteditable='true']",
    "[aria-label='Message Body'][contenteditable='true']",
    "[role='textbox'][contenteditable='true']"
].join(", ")

function getElementFromNode(node) {
    if (node instanceof HTMLElement) {
        return node
    }

    if (node instanceof Node) {
        return node.parentElement
    }

    return null
}

function getDeepActiveElement(root = document) {
    let active = root.activeElement

    while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement
    }

    return active
}

function getContentEditableElement(node) {
    const element = getElementFromNode(node)

    if (element === null) {
        return null
    }

    const editor = element.closest(CONTENT_EDITABLE_SELECTOR)

    if (!(editor instanceof HTMLElement)) {
        return null
    }

    return editor
}

const inputAdapter = {
    canHandle(target) {
        return isTextElement(target)
    },
    createEditor(target) {
        return createInputEditor(target)
    }
}

const contentEditableAdapter = {
    getEditorElement(target) {
        return getContentEditableElement(target)
    },
    canHandle(target) {
        return this.getEditorElement(target) !== null
    },
    createEditor(target) {
        return createContentEditableEditor(this.getEditorElement(target))
    }
}

const editorAdapters = [
    inputAdapter,
    contentEditableAdapter
]

function getActiveEditor() {
    const activeElement = getDeepActiveElement()

    for (const adapter of editorAdapters) {
        if (adapter.canHandle(activeElement)) {
            return adapter.createEditor(activeElement)
        }
    }

    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
        const selectedContentEditable = getContentEditableElement(selection.anchorNode)
        if (selectedContentEditable !== null) {
            return createContentEditableEditor(selectedContentEditable)
        }
    }

    return null
}

function looksEditable(target) {
    const element = getElementFromNode(target)

    if (element === null) {
        return false
    }

    return (
        isTextElement(element) ||
        getContentEditableElement(element) !== null ||
        element.getAttribute("role") === "textbox" ||
        element.hasAttribute("contenteditable")
    )
}

function dispatchReplacementInput(element, replacement) {
    try {
        element.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertReplacementText",
            data: replacement
        }))
    } catch (error) {
        element.dispatchEvent(new Event("input", {bubbles: true}))
    }
}


function createInputEditor(element) {
    return {
        root: element,
        getText() {
            return element.value
        },
        getCursorIndex() {
            return element.selectionStart ?? 0
        },

        focus() {
            element.focus()
        },
        selectRange(start, end) {
            if (!element.isConnected || !document.contains(element)) {
                return
            }
            element.focus()
            element.setSelectionRange(start, end)
        },

        replaceRange(start, end, replacement) {
            if (!element.isConnected || !document.contains(element)) {
                return
            }
            const prev = element.value.slice(0, start)
            const post = element.value.slice(end)
            element.value = prev + replacement + post
            dispatchReplacementInput(element, replacement)
        },


        getTextPosition(index)
        {
            return getInputTextPosition(element, index)
        }
    }
}

function buildContentEditableTextModel(element) {
    const parts = []
    let text = ""
    const blockElements = new Set(["DIV", "P", "BR"])

    function appendTextNode(node) {
        const val = node.nodeValue || ""
        const start = text.length
        text += val
        const end = text.length
        parts.push({node, start, end})
    }

    function appendLine()
    {
        if (text.length > 0 && !text.endsWith("\n")) {
            text += "\n"
        }
    }

    function walk(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            appendTextNode(node)
            return
        }

        if (!(node instanceof HTMLElement)) {
            return
        }

        if (node.tagName === "BR") {
            text += "\n"
            return
        }

        for (const child of node.childNodes) {
            walk(child)
        }
        
        if (node !== element && blockElements.has(node.tagName)) {
            appendLine()
        }
    }
    walk(element)
    return {text, parts}
}

function getContentEditableTextPosition(root, model, index) {
    for (const part of model.parts) {
        if (index >= part.start && index <= part.end) {
            return {node: part.node, offset: index - part.start}
        }
    }

    const last = model.parts[model.parts.length - 1]
    if (last) {
        return {node: last.node, offset: (last.node.nodeValue || "").length}
    }

    return {node: root, offset: 0}
}


function getContentEditableRange(root, model, start, end) {
    const startPos = getContentEditableTextPosition(root, model, start)
    const endPos = getContentEditableTextPosition(root, model, end)

    const range = document.createRange()
    range.setStart(startPos.node, startPos.offset)
    range.setEnd(endPos.node, endPos.offset)

    return range
}

function isRangeConnected(range) {
    return (
        range.startContainer.isConnected &&
        range.endContainer.isConnected &&
        document.contains(range.startContainer) &&
        document.contains(range.endContainer)
    )
}

function getContentEditableCursorIndex(root, model) {
    const selection = window.getSelection()

    if (!selection || selection.rangeCount === 0) {
        return 0
    }

    const range = selection.getRangeAt(0)

    if (range.startContainer !== root && !root.contains(range.startContainer)) {
        return 0
    }

    if (range.startContainer.nodeType === Node.TEXT_NODE) {
        for (const part of model.parts) {
            if (part.node === range.startContainer) {
                const offset = Math.min(range.startOffset, part.end - part.start)
                return part.start + offset
            }
        }
    }

    const beforeCursorRange = document.createRange()
    beforeCursorRange.selectNodeContents(root)
    beforeCursorRange.setEnd(range.startContainer, range.startOffset)

    return Math.min(beforeCursorRange.toString().length, model.text.length)
}


function createContentEditableEditor(root) {
    if (!root.hasAttribute("tabindex")) 
    {
        root.setAttribute("tabindex", "-1")
    }
    let cachedModel = null

    function getModel() {
        if (cachedModel === null) {
            cachedModel = buildContentEditableTextModel(root)
        }

        return cachedModel
    }

    return {
        root,

        getText() {
            return getModel().text
        },

        getCursorIndex() {
            return getContentEditableCursorIndex(root, getModel())
        },

        focus() {
            root.focus()
        },

        selectRange(start, end) {
            if (!root.isConnected || !document.contains(root)) {
                return
            }
            root.focus()
            const range = getContentEditableRange(root, getModel(), start, end)
            if (!isRangeConnected(range)) {
                return
            }
            const selection = window.getSelection()
            selection.removeAllRanges()
            selection.addRange(range)
        },

        replaceRange(start, end, replacement) {
            if (!root.isConnected || !document.contains(root)) {
                return
            }
            const range = getContentEditableRange(root, getModel(), start, end)
            if (!isRangeConnected(range)) {
                return
            }
            range.deleteContents()
            range.insertNode(document.createTextNode(replacement))
            root.normalize()
            cachedModel = null
            dispatchReplacementInput(root, replacement)
        },




        getTextPosition(index) {
            const range = getContentEditableRange(root, getModel(), index, index + 1)
            const rect = range.getClientRects()[0] || range.getBoundingClientRect()
            if (rect.width === 0 && rect.height === 0) {
                const rootRect = root.getBoundingClientRect()
                return {left: rootRect.left, top: rootRect.bottom}
            }

            return {left: rect.left, top: rect.bottom}
        }


    }
}

function normalizeIgnoredWord(word) {
    return word.trim().toLowerCase()
}

function matchCasing(original, correction) {
    if (!correction) {
        return correction
    }
    if (original === original.toUpperCase()) {
        return correction.toUpperCase()
    }
    const firstLetter = original.charAt(0)
    const rest = original.slice(1)
    const isCapital = firstLetter === firstLetter.toUpperCase() && rest === rest.toLowerCase()
    if (isCapital) {
        return correction.charAt(0).toUpperCase() + correction.slice(1).toLowerCase()
    }
    return correction
}

async function checkSpelling(sentence, cursorPosition, skipRange = null) {
    const payload = {
        sentence,
        cursor_position: cursorPosition,
        ignored_words: ignoredWords
    }

    if (skipRange !== null) {
        payload.skip_start = skipRange.start
        payload.skip_end = skipRange.end
    }

    const response = await chrome.runtime.sendMessage({
        type: "SPELLCHECK",
        payload
    })

    if (!response?.ok) {
        const error = new Error(response?.error || "Spellcheck request failed")
        error.status = response?.status
        throw error
    }

    return response.body
}

function isWordCharacter(char) {
    return /[A-Za-z0-9_'-]/.test(char)
}

function getScopedBaseOffset(text, cursorPosition) {
    const initialBaseOffset = Math.max(0, cursorPosition - SPELLCHECK_CONTEXT_CHARS)

    if (
        initialBaseOffset === 0 ||
        !isWordCharacter(text.charAt(initialBaseOffset - 1)) ||
        !isWordCharacter(text.charAt(initialBaseOffset))
    ) {
        return initialBaseOffset
    }

    const maxOffset = Math.min(
        cursorPosition,
        initialBaseOffset + SPELLCHECK_BOUNDARY_SEARCH_CHARS
    )

    for (let offset = initialBaseOffset; offset < maxOffset; offset += 1) {
        if (!isWordCharacter(text.charAt(offset))) {
            return offset + 1
        }
    }

    return initialBaseOffset
}

function getScopedEndOffset(text, cursorPosition) {
    if (
        cursorPosition === 0 ||
        cursorPosition === text.length ||
        !isWordCharacter(text.charAt(cursorPosition - 1)) ||
        !isWordCharacter(text.charAt(cursorPosition))
    ) {
        return cursorPosition
    }

    const minOffset = Math.max(0, cursorPosition - SPELLCHECK_BOUNDARY_SEARCH_CHARS)

    for (let offset = cursorPosition; offset > minOffset; offset -= 1) {
        if (!isWordCharacter(text.charAt(offset - 1))) {
            return offset
        }
    }

    return cursorPosition
}

function createSpellcheckScope(text, cursorPosition, skipRange = null) {
    const safeCursorPosition = Math.max(0, Math.min(cursorPosition, text.length))
    const endOffset = getScopedEndOffset(text, safeCursorPosition)
    const baseOffset = getScopedBaseOffset(text, endOffset)
    const sentence = text.slice(baseOffset, endOffset)
    const scopedCursorPosition = endOffset - baseOffset
    let scopedSkipRange = null

    if (skipRange !== null) {
        const skipStart = Math.max(skipRange.start, baseOffset)
        const skipEnd = Math.min(skipRange.end, endOffset)

        if (skipStart < skipEnd) {
            scopedSkipRange = {
                start: skipStart - baseOffset,
                end: skipEnd - baseOffset
            }
        }
    }

    return {
        sentence,
        cursorPosition: scopedCursorPosition,
        baseOffset,
        skipRange: scopedSkipRange
    }
}

function mapSpellcheckResultToEditor(result, baseOffset) {
    if (
        result.word === null ||
        result.correction === null ||
        !Number.isInteger(result.start) ||
        !Number.isInteger(result.end)
    ) {
        return result
    }

    return {
        ...result,
        start: result.start + baseOffset,
        end: result.end + baseOffset,
        cursor_position: Number.isInteger(result.cursor_position)
            ? result.cursor_position + baseOffset
            : result.cursor_position
    }
}

function isExtensionContextInvalidatedError(error) {
    return String(error?.message || error).includes("Extension context invalidated")
}

function hideCorrectionPopup() {
    if (correctionPopup !== null) {
        correctionPopup.remove()
        correctionPopup = null
    }
}



function hideBackendError() {
    if (backendErrorTimeoutId !== null) {
        clearTimeout(backendErrorTimeoutId)
        backendErrorTimeoutId = null
    }

    if (backendErrorPopup !== null) {
        backendErrorPopup.remove()
        backendErrorPopup = null
    }
}

function showBackendError(editor, cursorPosition, message) {
    hideBackendError()

    const popup = document.createElement("div")
    const position = editor.getTextPosition(cursorPosition)

    popup.textContent = message
    popup.style.position = "fixed"
    popup.style.left = `${position.left}px`
    popup.style.top = `${position.top + 8}px`
    popup.style.zIndex = "2147483647"
    popup.style.maxWidth = "320px"
    popup.style.background = "#111827"
    popup.style.color = "#ffffff"
    popup.style.padding = "10px 12px"
    popup.style.borderRadius = "8px"
    popup.style.boxShadow = "0 14px 32px rgba(0, 0, 0, 0.28)"
    popup.style.font = "13px system-ui, sans-serif"
    popup.style.lineHeight = "1.35"

    document.documentElement.appendChild(popup)
    backendErrorPopup = popup

    backendErrorTimeoutId = setTimeout(() => {
        if (backendErrorPopup === popup) {
            hideBackendError()
        }
    }, 3000)
}

function hideUnsupportedEditorMessage() {
    if (unsupportedEditorPopup !== null) {
        unsupportedEditorPopup.remove()
        unsupportedEditorPopup = null
    }
}

function showUnsupportedEditorMessage() {
    hideUnsupportedEditorMessage()

    const popup = document.createElement("div")
    popup.textContent = "Floh cannot read this editor yet."
    popup.style.position = "fixed"
    popup.style.right = "16px"
    popup.style.bottom = "16px"
    popup.style.zIndex = "2147483647"
    popup.style.background = "#111827"
    popup.style.color = "#ffffff"
    popup.style.padding = "10px 12px"
    popup.style.borderRadius = "8px"
    popup.style.boxShadow = "0 14px 32px rgba(0, 0, 0, 0.28)"
    popup.style.font = "13px system-ui, sans-serif"

    document.documentElement.appendChild(popup)
    unsupportedEditorPopup = popup
}


function clearPendingCorrection() {
    pendingCorrection = null
    hideCorrectionPopup()
}

function isEditorConnected(editor) {
    return (
        editor?.root instanceof Element &&
        editor.root.isConnected &&
        document.contains(editor.root)
    )
}

function isPendingCorrectionCurrent() {
    if (pendingCorrection === null) {
        return false
    }

    const item = pendingCorrection

    if (!isEditorConnected(item.editor)) {
        return false
    }

    try {
        const currentText = item.editor.getText()
        return currentText.slice(item.start, item.end) === item.word
    } catch (error) {
        return false
    }
}

function clearPendingCorrectionIfStale() {
    if (pendingCorrection !== null && !isPendingCorrectionCurrent()) {
        clearPendingCorrection()
        return true
    }

    return false
}

function getCursorPositionAfterReplacement(originalCursor, start, end, replacement) {
    if (originalCursor <= start) {
        return originalCursor
    }

    if (originalCursor >= end) {
        return originalCursor + replacement.length - (end - start)
    }

    return start + Math.min(originalCursor - start, replacement.length)
}

function restoreEditorCursor(editor, cursorPosition) {
    function restore() {
        if (!isEditorConnected(editor)) {
            return
        }

        try {
            editor.focus()
            editor.selectRange(cursorPosition, cursorPosition)
        } catch (error) {
            console.warn("Floh cursor target disappeared: ", error)
        }
    }

    restore()
    requestAnimationFrame(restore)
    setTimeout(restore, 0)
}

function saveIgnoredWord(word) {
    const normalizedWord = normalizeIgnoredWord(word)

    if (!normalizedWord) {
        return false
    }

    if (ignoredWords.includes(normalizedWord)) {
        return false
    }

    ignoredWords = [...ignoredWords, normalizedWord].sort()
    void chrome.storage.sync.set({"ignoredWords": ignoredWords})
    return true
}


function getInputTextPosition(element, index) {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)

    const mirror = document.createElement("div")
    mirror.style.position = "fixed"
    mirror.style.visibility = "hidden"
    mirror.style.whiteSpace = element instanceof HTMLTextAreaElement ? "pre-wrap" : "pre"
    mirror.style.wordWrap = "break-word"
    mirror.style.overflow = "hidden"

    mirror.style.left = `${rect.left}px`
    mirror.style.top = `${rect.top}px`
    mirror.style.width = `${rect.width}px`
    mirror.style.height = `${rect.height}px`

    mirror.style.font = style.font
    mirror.style.letterSpacing = style.letterSpacing
    mirror.style.padding = style.padding
    mirror.style.border = style.border
    mirror.style.boxSizing = style.boxSizing
    mirror.style.lineHeight = style.lineHeight

    const before = document.createTextNode(element.value.slice(0, index))
    const marker = document.createElement("span")
    marker.textContent = element.value.slice(index, index + 1) || " "

    mirror.appendChild(before)
    mirror.appendChild(marker)
    document.body.appendChild(mirror)

    const markerRect = marker.getBoundingClientRect()
    document.body.removeChild(mirror)

    return {
        left: markerRect.left - element.scrollLeft,
        top: markerRect.bottom - element.scrollTop
    }
}

function isTransparentColor(color) {
    if (!color) {
        return true
    }

    const normalized = color.trim().toLowerCase()
    if (normalized === "transparent") {
        return true
    }

    const parsedColor = parseRgbColor(color)
    return parsedColor !== null && parsedColor.alpha === 0
}

function parseAlpha(value) {
    if (!value) {
        return 1
    }

    const normalized = value.trim()
    let parsedValue = parseFloat(normalized)

    if (!Number.isFinite(parsedValue)) {
        return 1
    }

    if (normalized.endsWith("%")) {
        parsedValue = parsedValue / 100
    }

    return Math.max(0, Math.min(1, parsedValue))
}

function parseColorChannel(value) {
    if (!value) {
        return null
    }

    const normalized = value.trim()
    let parsedValue = parseFloat(normalized)

    if (!Number.isFinite(parsedValue)) {
        return null
    }

    if (normalized.endsWith("%")) {
        parsedValue = (parsedValue / 100) * 255
    }

    return Math.max(0, Math.min(255, parsedValue))
}

function parseRgbColor(color) {
    if (typeof color !== "string") {
        return null
    }

    const normalized = color.trim()

    if (normalized.startsWith("#")) {
        const hex = normalized.slice(1)
        const fullHex = hex.length === 3
            ? hex.split("").map((char) => char + char).join("")
            : hex

        if (fullHex.length !== 6 || !/^[0-9a-f]+$/i.test(fullHex)) {
            return null
        }

        return {
            red: parseInt(fullHex.slice(0, 2), 16),
            green: parseInt(fullHex.slice(2, 4), 16),
            blue: parseInt(fullHex.slice(4, 6), 16),
            alpha: 1
        }
    }

    const rgbMatch = normalized.match(/^rgba?\((.*)\)$/i)
    if (!rgbMatch) {
        return null
    }

    const rawValue = rgbMatch[1].trim()
    const slashParts = rawValue.split("/")
    const colorPart = slashParts[0].trim()
    const alphaPart = slashParts[1]
    const parts = colorPart.includes(",")
        ? colorPart.split(",").map((part) => part.trim())
        : colorPart.split(/\s+/)

    if (parts.length < 3) {
        return null
    }

    const alpha = alphaPart !== undefined
        ? parseAlpha(alphaPart)
        : parseAlpha(parts[3])

    const red = parseColorChannel(parts[0])
    const green = parseColorChannel(parts[1])
    const blue = parseColorChannel(parts[2])

    if (red === null || green === null || blue === null) {
        return null
    }

    return {
        red,
        green,
        blue,
        alpha
    }
}

function relativeLuminance(rgb) {
    const channels = [rgb.red, rgb.green, rgb.blue].map((channel) => {
        const value = channel / 255
        return value <= 0.03928
            ? value / 12.92
            : Math.pow((value + 0.055) / 1.055, 2.4)
    })

    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}

function contrastRatio(first, second) {
    const firstLuminance = relativeLuminance(first)
    const secondLuminance = relativeLuminance(second)
    const lighter = Math.max(firstLuminance, secondLuminance)
    const darker = Math.min(firstLuminance, secondLuminance)

    return (lighter + 0.05) / (darker + 0.05)
}

function findReadableBackground(element) {
    let current = element

    while (current instanceof Element) {
        const background = window.getComputedStyle(current).backgroundColor
        if (!isTransparentColor(background) && parseRgbColor(background) !== null) {
            return background
        }

        current = current.parentElement
    }

    if (document.body instanceof Element) {
        const bodyBackground = window.getComputedStyle(document.body).backgroundColor
        if (!isTransparentColor(bodyBackground) && parseRgbColor(bodyBackground) !== null) {
            return bodyBackground
        }
    }

    return "#ffffff"
}

function getReadableTextColor(background, preferredTextColor) {
    const backgroundColor = parseRgbColor(background)
    const preferredColor = parseRgbColor(preferredTextColor)

    if (backgroundColor === null) {
        return "#111827"
    }

    if (
        preferredColor !== null &&
        preferredColor.alpha > 0 &&
        contrastRatio(backgroundColor, preferredColor) >= 4.5
    ) {
        return preferredTextColor
    }

    const darkText = parseRgbColor("#111827")
    const lightText = parseRgbColor("#ffffff")
    const darkContrast = contrastRatio(backgroundColor, darkText)
    const lightContrast = contrastRatio(backgroundColor, lightText)

    return darkContrast >= lightContrast ? "#111827" : "#ffffff"
}

function getPopupTheme(editorRoot) {
    try {
        const background = findReadableBackground(editorRoot)
        const editorTheme = editorRoot instanceof Element
            ? window.getComputedStyle(editorRoot)
            : null
        const text = getReadableTextColor(background, editorTheme?.color)
        const backgroundColor = parseRgbColor(background)
        const lightBackground = backgroundColor === null
            ? true
            : relativeLuminance(backgroundColor) > 0.45
        const border = lightBackground
            ? "rgba(17, 24, 39, 0.18)"
            : "rgba(255, 255, 255, 0.22)"

        return {background, text, border}
    } catch (error) {
        console.warn("Floh popup theme error: ", error)
        return {
            background: "#ffffff",
            text: "#111827",
            border: "rgba(17, 24, 39, 0.18)"
        }
    }
}

function setImportantStyle(element, property, value) {
    element.style.setProperty(property, value, "important")
}


function showCorrectionPopup(item) {
    hideCorrectionPopup()

    const popup = document.createElement("div")
    const popupTheme = getPopupTheme(item.editor.root)
    const background = popupTheme.background
    const textColor = popupTheme.text
    const borderColor = popupTheme.border
    const position = item.editor.getTextPosition(item.start)

    popup.style.position = "fixed"
    popup.style.left = `${position.left}px`
    popup.style.top = `${position.top + 8}px`
    popup.style.zIndex = "2147483647"
    popup.style.minWidth = "260px"
    popup.style.maxWidth = "380px"
    setImportantStyle(popup, "background", background)
    setImportantStyle(popup, "color", textColor)
    popup.style.padding = "12px"
    popup.style.borderRadius = "10px"
    popup.style.boxShadow = "0 14px 32px rgba(0, 0, 0, 0.28)"
    popup.style.font = "13px system-ui, sans-serif"
    popup.style.lineHeight = "1.35"
    popup.style.pointerEvents = "auto"
    setImportantStyle(popup, "border", `1px solid ${borderColor}`)
    popup.style.opacity = "0"
    popup.style.transform = "translateY(4px) scale(0.98)"
    popup.style.transition = "opacity 120ms ease, transform 120ms ease"

    const label = document.createElement("div")
    label.textContent = "Floh suggestion"
    label.style.fontSize = "11px"
    label.style.fontWeight = "700"
    label.style.letterSpacing = "0"
    label.style.marginBottom = "8px"
    label.style.opacity = "0.68"
    setImportantStyle(label, "color", textColor)

    const correctionButton = document.createElement("button")
    correctionButton.type = "button"
    correctionButton.dataset.action = "accept"
    correctionButton.style.all = "unset"
    correctionButton.style.boxSizing = "border-box"
    correctionButton.style.display = "flex"
    correctionButton.style.alignItems = "center"
    correctionButton.style.gap = "8px"
    correctionButton.style.width = "100%"
    correctionButton.style.cursor = "pointer"
    correctionButton.style.fontWeight = "750"
    correctionButton.style.fontSize = "15px"
    setImportantStyle(correctionButton, "color", textColor)

    const wrongWord = document.createElement("span")
    wrongWord.textContent = item.word
    wrongWord.style.textDecoration = "line-through"
    wrongWord.style.opacity = "0.72"
    setImportantStyle(wrongWord, "color", textColor)

    const arrow = document.createElement("span")
    arrow.textContent = "->"
    arrow.style.opacity = "0.7"
    setImportantStyle(arrow, "color", textColor)

    const correctedWord = document.createElement("span")
    correctedWord.textContent = item.correction
    setImportantStyle(correctedWord, "color", textColor)

    correctionButton.appendChild(wrongWord)
    correctionButton.appendChild(arrow)
    correctionButton.appendChild(correctedWord)

    const actions = document.createElement("div")
    actions.style.display = "flex"
    actions.style.flexWrap = "wrap"
    actions.style.gap = "6px"
    actions.style.marginTop = "10px"

    function createActionButton(action, key, labelText) {
        const button = document.createElement("button")
        button.type = "button"
        button.dataset.action = action
        button.style.all = "unset"
        button.style.boxSizing = "border-box"
        button.style.display = "inline-flex"
        button.style.alignItems = "center"
        button.style.gap = "5px"
        setImportantStyle(button, "border", `1px solid ${borderColor}`)
        button.style.borderRadius = "999px"
        button.style.padding = "5px 8px"
        button.style.cursor = "pointer"
        button.style.fontSize = "12px"
        button.style.fontWeight = "650"
        button.style.opacity = "0.82"
        setImportantStyle(button, "color", textColor)

        const keyElement = document.createElement("span")
        keyElement.textContent = key
        keyElement.style.font = "700 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        setImportantStyle(keyElement, "color", textColor)

        const textElement = document.createElement("span")
        textElement.textContent = labelText
        setImportantStyle(textElement, "color", textColor)

        button.appendChild(keyElement)
        button.appendChild(textElement)
        return button
    }

    actions.appendChild(createActionButton("accept", "Enter", "Accept"))
    actions.appendChild(createActionButton("cancel", "Esc", "Cancel"))
    actions.appendChild(createActionButton("dictionary", "D", "Add word"))

    popup.appendChild(label)
    popup.appendChild(correctionButton)
    popup.appendChild(actions)

    popup.addEventListener("mousedown", (event) => {
        event.preventDefault()
    })

    popup.addEventListener("click", (event) => {
        const target = event.target
        if (!(target instanceof HTMLElement)) {
            return
        }
        const actionElement = target.closest("[data-action]")
        if (!(actionElement instanceof HTMLElement) || !popup.contains(actionElement)) {
            return
        }
        if (actionElement.dataset.action === "accept") {
            acceptCorrection()
        }
        if (actionElement.dataset.action === "cancel") {
            cancelCorrection()
        }

        if (actionElement.dataset.action === "dictionary") {
            void addCurrentWordToDictionary()
        }

    })
    document.documentElement.appendChild(popup)

    const popupRect = popup.getBoundingClientRect()
    const margin = 8
    let left = position.left
    let top = position.top + 8

    if (left + popupRect.width + margin > window.innerWidth) {
        left = Math.max(margin, window.innerWidth - popupRect.width - margin)
    }
    if (left < margin) {
        left = margin
    }
    if (top + popupRect.height + margin > window.innerHeight) {
        top = Math.max(margin, position.top - popupRect.height - 8)
    }

    popup.style.left = `${left}px`
    popup.style.top = `${top}px`

    requestAnimationFrame(() => {
        popup.style.opacity = "1"
        popup.style.transform = "translateY(0) scale(1)"
    })

    correctionPopup = popup
}

function acceptCorrection() {
    if (pendingCorrection === null) {
        return false
    }
    if (!isPendingCorrectionCurrent()) {
        clearPendingCorrection()
        return true
    }

    const item = pendingCorrection
    try {
        item.editor.replaceRange(item.start, item.end, item.correction)
        const newCursorPos = getCursorPositionAfterReplacement(
            item.originalCursor,
            item.start,
            item.end,
            item.correction
        )
        restoreEditorCursor(item.editor, newCursorPos)
    } catch (error) {
        console.warn("Floh correction target disappeared: ", error)
    }

    pendingCorrection = null
    hideCorrectionPopup()
    return true
}


function cancelCorrection() {
    if (pendingCorrection === null) {
        return false
    }

    if (!isEditorConnected(pendingCorrection.editor)) {
        clearPendingCorrection()
        return true
    }
    const item = pendingCorrection
    restoreEditorCursor(item.editor, item.originalCursor)

    pendingCorrection = null
    hideCorrectionPopup()
    return true
}

function handleCorrection(event) {

    if (backendErrorPopup !== null && event.key === "Escape") {
        event.preventDefault()
        hideBackendError()
        return true
    }

    if (unsupportedEditorPopup !== null && event.key === "Escape") {
        event.preventDefault()
        hideUnsupportedEditorMessage()
        return true
    }

    if (pendingCorrection !== null && !isPendingCorrectionCurrent()) {
        clearPendingCorrection()
        return true
    }

    if (pendingCorrection === null) {
        return false
    }

    if (event.key === "Enter") {
        event.preventDefault()
        return acceptCorrection()
    }

    if (event.key === "Escape") {
        event.preventDefault()
        return cancelCorrection()
    }

    if (event.key.toLowerCase() === "d") {
        event.preventDefault()
        void addCurrentWordToDictionary()
        return true
    }


    const modifierKeys = ["Control", "Meta", "Alt", "Shift"]
    if (modifierKeys.includes(event.key)) {
        return false
    }

    if (eventToHotkey(event) === hotkey) {
        return false
    }

    clearPendingCorrection()
    return false

}

async function addCurrentWordToDictionary() {
    if (pendingCorrection === null) {
        return false
    }

    if (!isPendingCorrectionCurrent()) {
        clearPendingCorrection()
        return true
    }

    const item = pendingCorrection
    saveIgnoredWord(item.word)

    const editor = item.editor
    const cursorPosition = Math.max(0, item.start - 1)
    const originalCursor = item.originalCursor

    clearPendingCorrection()

    await runSpellcheck(editor, cursorPosition, originalCursor, true)
    return true
}



// Enable the content script by default.
let enabled = true
const keys = ["enabled", "hotkey", "ignoredWords"]

async function runSpellcheck(editor, cursorPosition, originalCursor, isSkippingCurrent, skipRange = null) {
    const reqId = ++spellCheckReqId
    hideBackendError()
    try {
        const text = editor.getText()
        const scope = createSpellcheckScope(text, cursorPosition, skipRange)
        const scopedResult = await checkSpelling(scope.sentence, scope.cursorPosition, scope.skipRange)
        const result = mapSpellcheckResultToEditor(scopedResult, scope.baseOffset)
        if (reqId !== spellCheckReqId) {
            return false
        }

        if (!isEditorConnected(editor)) {
            clearPendingCorrection()
            return false
        }

        if (
            result.word !== null &&
            result.correction !== null &&
            Number.isInteger(result.start) &&
            Number.isInteger(result.end)
        ) {
            const casedC = matchCasing(result.word, result.correction)

            pendingCorrection = {
                editor,
                word: result.word,
                correction: casedC,
                start: result.start,
                end: result.end,
                originalCursor: originalCursor,
            }

            editor.focus()
            editor.selectRange(result.start, result.end)
            showCorrectionPopup(pendingCorrection)
            return true
        }

        if (isSkippingCurrent) {
            restoreEditorCursor(editor, originalCursor)
        }

        clearPendingCorrection()
        return false
    }
    catch (error) {
        if (reqId !== spellCheckReqId) {
            return false
        }

        if (isExtensionContextInvalidatedError(error)) {
            clearPendingCorrection()
            hideBackendError()
            return false
        }

        console.error("Spellcheck error: ", error)
        if (isSkippingCurrent && isEditorConnected(editor)) {
            restoreEditorCursor(editor, originalCursor)
        }
        clearPendingCorrection()

        if (!isEditorConnected(editor)) {
            return false
        }

        let message = "Unable to connect to Floh backend. Please try again later."

        if (error.status === 413 || error.status === 422) {
            message = "Floh could not check this text selection."
        }

        if (error.status === 429) {
            message = "Floh is receiving too many requests. Try again shortly."
        }

        if (error.status === 503) {
            message = "Floh's spellcheck service is temporarily unavailable."
        }

        showBackendError(editor, cursorPosition, message)
        return false
    }
}

document.addEventListener("keydown", async (event) => {
    if (handleCorrection(event)) {
        return
    }

    if (!enabled) {
        return
    }
    if (eventToHotkey(event) !== hotkey) {
        return
    }
    const editor = getActiveEditor()

    if (editor === null) {
        const activeElement = getDeepActiveElement()
        if (looksEditable(activeElement)) {
            event.preventDefault()
            showUnsupportedEditorMessage()
        }
        return
    }
    hideUnsupportedEditorMessage()
    event.preventDefault()
    
    const visibleCursor = editor.getCursorIndex()

    const previousCorrection = pendingCorrection
    const isSkippingCurrent = previousCorrection !== null && previousCorrection.editor.root === editor.root
    const cursorPosition = isSkippingCurrent ? Math.max(0, previousCorrection.start - 1) : visibleCursor
    const originalCursor = isSkippingCurrent ? previousCorrection.originalCursor : visibleCursor
    const skipRange = isSkippingCurrent
        ? {start: previousCorrection.start, end: previousCorrection.end}
        : null
    await runSpellcheck(editor, cursorPosition, originalCursor, isSkippingCurrent, skipRange)

}, true)

document.addEventListener("pointerdown", (event) => {
    if (pendingCorrection === null) {
        return
    }

    const target = event.target

    if (!(target instanceof Node)) {
        clearPendingCorrection()
        return
    }

    if (correctionPopup !== null && correctionPopup.contains(target)) {
        return
    }

    const editorRoot = pendingCorrection.editor.root

    if (editorRoot instanceof Node && editorRoot.contains(target)) {
        return
    }

    clearPendingCorrection()
}, true)

chrome.storage.sync.get(keys, (data) => {
    if (data.enabled === false) {
        enabled = false
    }
    
    if (data.hotkey) {
        hotkey = data.hotkey
    }

    if (Array.isArray(data.ignoredWords)) {
        ignoredWords = data.ignoredWords
    }


})

const pendingCorrectionObserver = new MutationObserver(() => {
    clearPendingCorrectionIfStale()
})

pendingCorrectionObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
})

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") {
        return
    }
    if (changes.enabled) {
        enabled = changes.enabled.newValue === true

    }
    if (changes.hotkey) {
        hotkey = changes.hotkey.newValue || "Mod+Shift+K"
    }

    if (changes.ignoredWords) {
        ignoredWords = Array.isArray(changes.ignoredWords.newValue) ? changes.ignoredWords.newValue : []
    }
})
