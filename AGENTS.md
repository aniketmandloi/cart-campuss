## T3 Code model preferences

- Use Cursor Grok 4.7 (`cursor` / `grok-4.7`) for code implementation, code searches, and routine small tasks, with `reasoning_effort: "xhigh"` and `fastMode: false`.
- Use Codex Sol 6.1 (`codex` / `gpt-6.1-sol`) for consequential decisions, reviews, and other important work, with `reasoningEffort: "high"`.

## Agent skills

### Issue tracker

Track issues and specs in GitHub Issues for `aniketmandloi/cart-campuss`.
Read `docs/agents/issue-tracker.md` before working with tickets.

### Triage labels

Use the five canonical triage labels.
Read `docs/agents/triage-labels.md` before triaging or changing triage labels.

### Domain docs

Use a single-context layout: root `GLOSSARY.md` and `docs/adr/`.
Read `docs/agents/domain.md` before exploring the codebase.
