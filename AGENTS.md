# AGENTS.md

## Agent skills

### Issue tracker

GitHub Issues on `ag2273/News-Aggregator` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

single-context: `GLOSSARY.md` at the repo root + `docs/adr/` for architectural decisions. See `docs/agents/domain.md`.

### Skills

This project works with Matt Pocock's "Skills for Real Engineers" methodology. The skill files live in `.agents/skills/`; the orchestrator invokes them (grill-with-docs → to-spec → to-tickets → implement/tdd → code-review).
