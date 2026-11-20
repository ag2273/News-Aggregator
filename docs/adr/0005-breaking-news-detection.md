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
### First measurement (~25 h)
On ~25 hours of production titles (2,132 rows): **11 flags, ~91%
precision (10/11 hand-labelled)**, versus 21 flags at ~52% for the keyword rule and
10 at ~60% for label-only. Egyptian sources went from 0 to 3 flags.
- This is a **precision-first** rule. Outlets that publish breaking news without a
  marker are missed by design; raising recall needs source-provided breaking feeds
  (checked: none of the ten expose one).

### Re-measurement 2026-11-21 (3.25 days)
Rule unchanged (`e7cdba8`, which is what deploys). Corpus is the live
`/data/news.json` on the server volume.

- Span: `fetchedAt` **2026-11-17T15:38:38Z → 2026-11-20T21:36:36Z** = **3.249 days**
  (not "24.9 h"; the earlier per-day rate was understated ~3× on this span).
- **5,805 rows, 1,787 rows/day.** 10 sources: المصري اليوم 2292, آر تي عربي 888,
  الجزيرة 643, اليوم السابع 602, سكاي نيوز 326, الأهرام 292, العربية 291,
  سي إن إن 220, مصراوي 178, بي بي سي 73.
- **Current rule: 19 flags = 5.85/day** (0.33% of rows). Per source: الجزيرة 13
  (4.00/day), المصري اليوم 2, سكاي/Ahram/Arabiya/Masrawy 1 each, RT/youm7/CNN/BBC 0.
  **Egyptian sources: 4** of 19.
- **Precision: 14/19 = 73.7%** (all 19 hand-labelled, no sample). The 5 false
  positives are all the label tier: an NSA internal-comms outage from unnamed
  sources, a Lebanese judicial charge sheet, an ICJ condemnation, a Kataib Hezbollah
  statement about future channels, and a second-hand claim about Putin being war-weary.
  The incident tier alone was **6/6 = 100%**.
- **Recall: the incident tier is blind to ordinary war wording.** Screening all
  5,786 non-flagged rows for a violent noun plus a stated toll ≥3 finds **6 truly
  breaking misses in 3.25 days (~1.8/day)**: 3 × «إطلاق نار»/«هجمات» strikes in
  Syria/Ukraine with 3–7 dead, a family shooting with 8 dead in Deir ez-Zor, the
  Nyala massacre (37 civilians), and «6 قتلى في غزة». Causes: the noun whitelist has
  no «هجمات»/«إطلاق نار»/«مجزرة», the verb «تقتل» is not a casualty word, and the
  toll regex reads digits only *after* the casualty word, so «6 قتلى» reads as 0.
- Candidates over the same span:

  | candidate | flags | /day | precision |
  |---|---|---|---|
  | current (label + incident ≥3) | 19 | 5.85 | 73.7% |
  | label only | 14 | 4.31 | 64.3% |
  | C: incident, no toll requirement | 14 | 4.31 | 78.6% |
  | D: incident toll ≥5 | 6 | 1.85 | 100% |
  | E: current + toll read before the casualty word | 7 | 2.15 | 100% |
  | F: wider nouns + fixed toll, no label | 10 | 3.08 | 100% (was 90% before `مجزرة`/`تقتل`) |
  | **G: tightened label + wider nouns + fixed toll** | **20** | **6.16** | **100%** |

### Recommendation (not yet shipped)
Adopt **G**: same daily volume as today (6.16 vs 5.85) but 100% precise on the 20
hand-labelled flags, and it recovers **all 6** current misses. It is three
mechanical fixes, no new tier:
1. read the toll on either side of the casualty word (`6 قتلى`, not just `مقتل 6`);
2. add the everyday war nouns («هجمات»، «إطلاق نار»، «مجزرة»، «اشتباكات»، «ضربات»)
   and the verb «تقتل» to the casualty list;
3. tighten the label tier with the markers that caused all 5 false positives
   («ندين»، «ستعالج»، «عن مصادر»، «تهمة»، institutional attribution).

**That 100% is in-sample, not a forecast.** G's markers and nouns were chosen
while reading this same 3.25-day corpus, so it is scored on the data it was
tuned on. If G is approved, the ship must include a hold-out check on articles
fetched after 2026-11-20T21:36Z (the tuning cutoff) before the threshold is
trusted; report precision over that hold-out window separately.

- The measurement window is still short (3.25 days, and the corpus only starts when
  the volume does). Re-measure after ≥14 days before tuning the toll threshold.
  Rates are per-day figures recomputed from `fetchedAt`, never assumed.
- Every rejected candidate and its numbers are recorded in the source file so the
  next person does not re-litigate them.
