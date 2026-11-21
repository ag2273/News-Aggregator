# ADR 0008 — Digest duplicate detection on article text

## Context
The feed's «من N مصادر» card groups articles by **title** (`cluster.ts`,
0.45 Jaccard over title bigrams). That is tuned for the feed's job and stays as
shipped: precision-first, and it barely fires (68 multi-source clusters across
6,768 articles / 3 days, 67 of them 2-source).

The digest has two advantages the feed does not:

1. it already holds the **full article text** of every candidate (96% of sources,
   see ADR 0007 and `articleText.ts`);
2. it only compares ~30 candidates per run.

Comparing bodies catches duplicates that headlines miss. The clearest measured
example is one NSA story written two ways:

- ««CNN»: تعطل شبكة اتصالات أمريكية بالغة السرية مخصصة للأمن القومي»
- «مصادر لـCNN: تعطل شبكة اتصالات بالغة السرية تابعة لوكالة الأمن القومي»

Headline n-grams keep those apart; the bodies are the same report.

## Decision
A digest-only comparator in `apps/server/src/digestSimilarity.ts`:

- **Normalise** with `normalizeForSearch` (tashkeel, alef/yeh/teh-marbuta
  variants, digits) — the same routine search uses, so "مصابون"/"والمصابون"
  do not diverge;
- **Lead only**: the first 2,000 normalised characters. The opening carries
  who/what/where; the rest is colour and costs comparison time;
- **Character 5-grams**, not word shingles. Arabic attaches prefixes and
  suffixes (`و`, `ب`, `ال`, `ون`), so whole words differ while the stem does not;
- keep the **600 most frequent** grams, so a repeated page footer cannot dominate
  the score;
- **weighted Jaccard** (sum of min counts / sum of max counts) — a plain set
  Jaccard throws away repetition that is itself a duplicate signal;
- merge when the score is **>= 0.42** (chosen from the sweep below);
- never merge two reports from **one outlet** (that is a republish, and counting
  it as independent coverage would be a lie);
- sketch-only bodies below 180 characters are **not compared** on content.

The groups feed the existing prompt line («منشور في N مصادر مستقلة»), so one
model call per story group and one digest item per story. The feed's clustering
and thresholds are untouched.

## Measurement
180 candidates from the live corpus, 24 h window, capped 40 per source; 170 with
full article text (94%). Every merge below was hand-read.

**Threshold 0.30**, and the data says why:

| metric | value |
|---|---|
| TEXT groups (0.30) | **3** |
| TITLE-clustering groups on the same pool | **1** |
| true duplicates found only by text | **2** |
| false merges | **0** |
| highest scoring NON-duplicate pair | **0.183** |
| lowest scoring true duplicate | **0.328** |

The gap between 0.183 and 0.328 is the whole argument: 0.30 sits inside it, not
on a shoulder. A lower threshold (0.20) also merged the Infantino/CAF pair at
0.183, which is two different stories — one is FIFA raising grants, the other is
the CAF president backing Infantino — so the sweep stops there.

The three merges, with the similarity:

- **0.748** «شيكوبانزا ينتظم في تدريبات الزمالك» (المصري اليوم) + «شيكو بانزا
  ينتظم فى تدريبات الزمالك بعد العودة من أنجولا» (اليوم السابع) — one story.
- **0.427** «وزير التخطيط ومحافظ السويس يترجلان من سيارتهما…» + «لفتة
  إنسانية.. وزير التخطيط ومحافظ السويس يطمئنان…» — one story. Title clustering
  also catches this one.
- **0.328** «من 8 إلى 25 مليون دولار.. إنفانتينو يعلن زيادة ضخمة في منح
  الاتحادات» (العربية) + «الكاف يجدد الثقة في إنفانتينو.. والفيفا يرفع المنح
  إلى 25 مليون دولار» (الجزيرة) — one story, **different headlines, title
  clustering misses it**. This is the case the feature exists for.

**Known limitation, measured live:** a candidate whose publisher refused full text
is compared on its ~200-character snippet. Two such items score ~0.05 against a
full body even when they cover the same event, so they stay separate. In the live
digest after this shipped, «ترامب: اتفاق دائم مع إيران» (سكاي, full body) and
«ترامب: سأبرم اتفاقًا دائمًا…» (المصري اليوم, **snippet only, 197 chars**) were
not merged. That is the documented behaviour — an uncomparable body is never
merged on a guess — and it is visible: the item is labelled `textSource:
'snippet'` in the API and «ملخص من المقتطف» in the app. Closing it properly needs
full text from those sources, not a looser threshold.

## Consequences

- Cost stays flat: no second AI call, no embedding API.
- The app needs nothing new: `sourceCount` and the «المصدر · N مصادر» label are
  already rendered since apk-31.
- A snippet-only candidate is clustered on its snippet and stays marked as
  `textSource: 'snippet'`, so a merge made without full text is visible.
