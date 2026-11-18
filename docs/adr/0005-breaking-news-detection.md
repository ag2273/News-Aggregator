# 0005 — Breaking-news detection: explicit labels plus a catastrophe toll

## Context
`isBreaking` drives the "العاجل فقط" push mode, so a false positive is a real
notification on a real phone. The first rule was `title.includes('عاجل')`, which
flagged ordinary news ("تحرك عاجل من السلطات", "قرار عاجل من الأعلى للإعلام")
and treated "لحظة بلحظة" (sport live blogs) as breaking. A label-only rule was
precise but produced nothing from the Egyptian outlets, which never tag breaking
news at all.

## Decision
Two tiers in `apps/server/src/categorize.ts`, both data-driven lists:
1. **Label**: `عاجل` followed by a separator at the start (`|`, `:`, `..`, `-`), a
   trailing `- عاجل -` (Google News form), a leading 🔴/🚨, or `BREAKING`.
   Excluded when the headline is a holding statement or a scheduled event
   ("لم يحدد بعد السبب", "نفي", "لحضور قمة").
2. **Incident**: a catastrophe noun plus human cost and a stated toll ≥ 3, with
   Arabic-Indic digits and عشرات/مئات counted, cargo tonnage excluded. Routine
   coverage, sport, lifestyle and retrospectives are excluded by marker lists.

## Consequences
Measured on ~25 hours of production titles (2,132 rows): **11 flags, ~91%
precision (10/11 hand-labelled)**, versus 21 flags at ~52% for the keyword rule and
10 at ~60% for label-only. Egyptian sources went from 0 to 3 flags.
- This is a **precision-first** rule. Outlets that publish breaking news without a
  marker are missed by design; raising recall needs source-provided breaking feeds
  (checked: none of the ten expose one).
- The measurement window is short. Re-measure over a longer span before tuning
  again; the rates are per-day figures that must be recomputed from `fetchedAt`,
  not assumed.
- Every rejected candidate and its numbers are recorded in the source file so the
  next person does not re-litigate them.
