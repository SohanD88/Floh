---
permalink: /privacy/
---

# Floh Privacy Policy

Last updated: June 6, 2026

Floh is a Chrome extension that helps users find and correct spelling mistakes in supported web editors using keyboard shortcuts.

## Information Floh Sends

Floh sends information to Floh's hosted spellcheck service only when you use the Floh shortcut.

When you use the shortcut, Floh may send:

- The full text from the active editor
- The current cursor position
- Your ignored words list
- Internal correction navigation offsets, such as the currently selected correction range

Floh does not continuously monitor editor text in the background. Floh does not send editor text unless you invoke the shortcut.

## How Floh Uses This Information

Floh uses the submitted editor text and cursor position to find a spelling mistake near the cursor and return a suggested correction.

Floh uses ignored words to avoid suggesting corrections for words you have chosen to ignore.

Floh uses correction navigation offsets to support keyboard navigation between spelling mistakes.

## Hosted Spellcheck Service

Floh sends spellcheck requests over HTTPS to Floh's hosted backend.

The backend processes spelling requests using self-hosted LanguageTool running in the same backend service.

The hosted backend is deployed on Fly.io. Fly.io may process operational metadata such as IP address, request timestamp, request status, routing information, and service logs as part of operating the hosted service.

## Storage

Floh stores extension settings using Chrome extension storage.

Floh may store:

- Whether Floh is enabled
- Your selected keyboard shortcut
- Your ignored words list

These settings are stored using `chrome.storage.sync`, which may sync through your Chrome account depending on your browser settings.

Floh does not intentionally store active editor text in a database.

## Data Sharing

Floh does not sell user data.

Floh does not use editor text for advertising.

Floh does not use editor text for analytics.

Floh does not use editor text for purposes unrelated to spelling correction.

Floh sends spellcheck requests only to Floh's hosted backend for the purpose of providing spelling corrections. The backend uses self-hosted LanguageTool to process those requests.

## Human Access

Floh does not intentionally provide humans access to editor text.

Operational logs may exist through the hosting provider as part of running and debugging the service, but Floh is not designed to store editor text for human review.

## User Control

You can disable Floh from the extension popup.

You can remove ignored words from the extension popup.

You can uninstall Floh from Chrome at any time.

## Chrome Web Store Limited Use

The use of information received from Chrome APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Contact

For support or privacy questions, contact:

darshsohan@gmail.com