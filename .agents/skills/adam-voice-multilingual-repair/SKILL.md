---
name: adam-voice-multilingual-repair
description: "Audit and repair ADAM's Italian/Darija text/voice pipeline and preserve the currently preferred voice. Work on a dedicated branch, test, then open a draft PR."
---

# ADAM VOICE & DARIJA — CODEX EXECUTION SKILL

## Mission
You are the implementation agent for `Lucifer-AI-666/adam-mesh`. Inspect the **current** default-branch code before acting; do not copy outdated assumptions from issue #20 or earlier prompts. Implement and test the smallest reliable fix for multilingual input/output and voice behavior. Work only on a dedicated feature branch, and create a draft PR. **Never merge, deploy, change production settings, read secrets, or modify other PRs.**

## Confirmed starting observations (2026-11-12, review before coding)
- `client/src/pages/Chat.tsx`: Web Speech Recognition is hardcoded to `recognition.lang = "it-IT"`.
- `server/routers.ts`: `DEFAULT_SYSTEM_PROMPT` says “Rispondi in italiano”; `getSystemPrompt()` may override this with `db.getSetting("system_prompt")`. There is an admin-managed custom prompt; do NOT overwrite database values.
- `shared/speechText.ts`: `speechPieces(text, maxLen = 380)` already exists. Client-side queue in `Chat.tsx` already uses it. **Do not recreate resolved 2000-character truncation work.** Audit its behavior and tests.
- `server/gemini.ts`: current voice uses **xAI TTS `https://api.x.ai/v1/tts`, default voice `eve`, `language: "it"`**. Do not assume Gemini/Orus. User reports Arabic-script input pronounced correctly and voice unchanged; preserve the voice unless an explicit change is requested.
- `server/routers.ts`: `chat.speak` is `publicProcedure`; evaluate abuse/cost defenses without breaking legitimate usage.
- Issue #20 is historically stale regarding Gemini TTS and truncation. Cite it as prior context, not proof of current behavior.

## Acceptance criteria
1. **Language behavior:** Given typed Arabic script or Moroccan Darija, ADAM answers in Darija/Arabic consistent with the message, unless user asks for a different language. Given Italian, reply Italian. Never assert “Darija recognition” or “auto language detection” without testing.
2. **STT:** Provide explicit recognition-language selection (at least `it-IT` and `ar-MA`) with persistence only if appropriate to existing app patterns. Surface unsupported browsers and recognition inaccuracies transparently; do not silently force `it-IT` when `ar-MA` selected.
3. **TTS:** Preserve the existing user-preferred voice and current provider initially. Investigate `language: "it"` and service-supported language codes; ensure language selection is consistent with actual supported API contract. Fall back clearly or explicitly report unsupported Darija; never fabricate support. Avoid accidental change to voice identity.
4. **Prompt:** Fix hardcoded Italian-only default instructions while preserving all other ADAM role/safety/behavior constraints. Inspect possible custom prompt precedence and document how admin can update a custom prompt safely; do not modify DB directly.
5. **Audio queue:** Audit existing `speechPieces`, queue, interruption invalidation, asynchronous stale responses and error handling. Fix demonstrated bugs only, with regression tests for >5000 chars, ordering, stop and race conditions.
6. **Safety:** Audit unauthenticated TTS cost exposure; implement an appropriately scoped mitigation if feasible within this PR, otherwise describe blocker and open follow-up issue. Never log prompts, user personal data, tokens or API keys.
7. **Verification:** Add focused unit/integration tests (mocks, no paid TTS calls); run typecheck and relevant test suite. Distinguish mock results from real-device/browser listening tests. Report actual files and commit SHA.

## Workflow
1. Read `AGENTS.md` if present (this file is root guidance; an existing agent policy may supersede). Inspect package scripts, chat router, system prompt, `speechPieces`, TTS implementation and CI.
2. Write a concise failure matrix: typed Darija, spoken Darija, Italian, mixed-language, TTS, 5000-character queue, STOP.
3. Make minimal focused changes on a feature branch; do not alter `main`, PR #18, unrelated authentication, or deployment.
4. Run tests. Fix failures introduced by your changes. Do not mark unexecuted tests as PASS.
5. Open **draft PR** referencing issue #20, clearly saying that its older Gemini/Orus assumptions are superseded by actual xAI/eve implementation.
6. Provide final report in Italian: STATO, BRANCH, COMMIT, PR, MODIFICHE, TEST PASS/FAIL/NOT RUN, RISCHI, ONE NEXT ACTION.

## Hard stops
No automatic merge. No production deploy. No credential disclosure. No unauthorized account or DB writes. If unable to run code or access required tools, state exact blocker and hand off a reproducible command or patch rather than claiming work completed.
