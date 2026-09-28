---
version: 1
slug: "issue-voice"
primary_target: "src/components/issue-voice.tsx"
related_targets: ["src/components/issue-voice.module.css","src/components/problem-discussion.tsx","src/components/problem-discussion.module.css","src/components/issue-conversation.tsx","docs/retell-issue-voice.md"]
---

# Issue voice conversation

Mode: Operate. This is an additive extension of the existing issue conversation. PRODUCT.md and DESIGN.md remain authoritative: neutral Attio-style surfaces, inherited Geist typography, fine dividers, compact labeled controls, and semantic status colors. No new identity, global tokens, or visual world were introduced, so the global design contract and sidecar remain unchanged.

## Surface and hierarchy

“Discuss this issue” opens a conversation panel with a maximum width of 760px. “Talk about this issue” sits between message history and the existing composer, separated by a fine border. The disclosure leads to the AI-assistant explanation, Retell audio/context processing notice, five-minute limit, and explicit “Start conversation” action. Opening either disclosure does not start a call.

Copy uses 13px text with 1.6 leading; status, elapsed time, speaker labels, and supporting privacy text use 12px. Controls stay flat, with neutral surfaces and boundaries. End uses the existing danger roles; connection state includes text alongside the success dot. Voice controls wrap, body gutters reduce from 20px to 16px at narrow widths, and mobile/coarse-pointer controls have at least 44px targets. Focus outlines remain visible; the transcript has bounded scrolling and keyboard focus. No decorative looping animation is added.

## Behavior contract

- Start explicitly requests microphone access before creating a provider session. Connecting exposes Cancel; a live call exposes Mute/Unmute, elapsed time, and End. The duration is capped at five minutes.
- The outer discussion disclosure is disabled while connecting or live, with an instruction to end the call before closing. The inner voice disclosure also cannot collapse during that interval. Ordinary panel collapse preserves the mounted conversation, unsent draft, and ended-call transcript in the current tab.
- Captions appear when available, with explicit You/CloseSpan attribution. If unavailable, the notice leaves voice and text usable. Captions are not automatically announced over the audio.
- After ending, “Use my notes in chat” appends only the user's speech, labeled as notes rather than test evidence, to the existing draft and focuses Discuss. Nothing is saved until the user sends it. If the combined draft exceeds 2,000 characters, the draft remains unchanged and a recovery notice explains how to shorten it or copy a shorter transcript excerpt.
- Voice and copied notes confer no coding, merge, or deployment approval. Existing result/preview links are references; the conversation does not create a preview or verify the application.

## Evidence and limits

Recorded from the components and note-handoff helper. Desktop/mobile entry review is captured in `.impeccable/review/issue-voice-desktop.png`, `issue-voice-mobile.png`, and `issue-voice-mobile-controls.png`. No actual call was started during this review; microphone permission, audio quality, live connectivity, and provider caption behavior remain unverified by those screenshots. Setup and provider boundaries are documented in `docs/retell-issue-voice.md`.
