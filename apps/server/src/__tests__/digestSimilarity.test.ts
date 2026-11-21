/**
 * Digest duplicate detection on article TEXT.
 *
 * Real pairs from the production corpus, hand-read:
 *  - 0.748 and 0.328 are the same story written under different headlines;
 *  - 0.183 is two different stories and must NOT merge;
 *  - title clustering catches only one of the three merges, which is the reason
 *    this module exists at all.
 */

import { describe, it, expect } from 'vitest';
import {
  profileOf,
  similarity,
  leadOf,
  gramProfile,
  groupByText,
  SIMILARITY_THRESHOLD,
  MIN_COMPARABLE_CHARS,
  SHINGLE_SIZE,
  TOP_K,
  type StoryCandidate,
} from '../digestSimilarity.js';

/**
 * Real article bodies from the production corpus (first 900 chars each), so the
 * assertions below are the measured scores, not invented text.
 */
const YOUM7_ZAMALEK =
  "شيكوبانزا يقود إحدى الهجمات على فريق أبوقير للأسمدة - صورة أرشيفية انتظم الأنجولي شيكو بانزا جناح الفريق الأول لكرة القدم بنادي الزمالك في التدريبات الجماعية، خلال مران الفريق الذي أقيم اليوم السبت على الملعب الفرعي باستاد الدفاع الجوي، في إطار الاستعداد لمباراة الجونة المقبلة في مسابقة الدوري الممتاز. وعاد شيكوبانزا إلى القاهرة مساء أمس الجمعة قادمًا من بلاده، بعدما شارك في مباراتي منتخب أنجولا أمام جنوب السودان في التصفيات المؤهلة لبطولة كأس الأمم الأفريقية. ويستعد فريق الزمالك لمواجهة نظيره الجونة باستاد خالد بشارة، المقرر لها يوم الاثنين المقبل، ضمن منافسات الجولة التاسعة لمسابقة الدوري الممتاز.";

const MASRAWY_ZAMALEK =
  "انتظم الأنجولي شيكو بانزا جناح الفريق الأول لكرة القدم بنادي الزمالك فى التدريبات الجماعية، خلال مران الفريق الذي أقيم اليوم السبت على الملعب الفرعي باستاد الدفاع الجوي، في إطار الاستعداد لمباراة الجونة المقبلة في مسابقة الدوري الممتاز. الزمالك يستعيد شيكو بانزا قبل لقاء الجونة بالدوري وعاد شيكوبانزا إلى القاهرة مساء أمس، الجمعة، قادمًا من بلاده، بعدما شارك في مباراتي منتخب أنجولا أمام جنوب السودان فى التصفيات المؤهلة لبطولة كأس الأمم الأفريقية. ويستعد الزمالك لمواجهة الجونة باستاد خالد بشارة، الاثنين المقبل، ضمن منافسات الجولة التاسعة لمسابقة الدوري الممتاز.";

const ARABIYA_INFANTINO =
  "استمع للمقال النص المسموع تلقائي ناتج عن نظام آلي أعلن جياني إنفانتينو، رئيس الاتحاد الدولي لكرة القدم \"فيفا\"، يوم السبت، خطة لزيادة المنح المالية المقدمة للاتحادات الأعضاء بأكثر من ثلاثة أضعاف، لترتفع من 8 ملايين إلى 25 مليون دولار لكل اتحاد على مدار أربع سنوات. وجاء إعلان إنفانتينو خلال الجمعية العمومية العادية للاتحاد الأفريقي لكرة القدم \"كاف\" ، التي أقيمت في العاصمة النيجيرية أبوجا، حيث أكد أن تطوير كرة القدم في أفريقيا سيظل على رأس أولوياته. ومن المقرر أن تدخل الزيادة حيز التنفيذ اعتباراً من يناير 2027، ضمن برنامج \"فيفا فورورد 4.0\" الجديد، الذي طُرحت خطته في أكتوبر الماضي، وينتظر التصديق عليها خلال اجتماع مجلس فيفا الشهر المقبل. وقال إنفانتينو: عندما انتُخبتُ لأول مرة عام 2016، كان كل اتحاد يتلقى من فيفا 250 ألف دولار سنوياً، أو مليون دولار كل أربع سنوات، لتطوير كرة القدم. وأضاف: الآن بعد مرور 10 سنوات، ستتلقون 25 مليون دولار لاستثمارها في تطوير كرة القدم، وسنعمل على زيادة هذا المبلغ أكثر من ذلك، لأنكم تستحقون ذلك، ولأن شبابكم يستحقون ذلك. وتابع: أموال فيفا هي أموالكم، وأنتم تستثمرونها في البنية الأساسية والتنمية وتوفير الفرص. الجمعية العمومية العادية للاتحاد الأفريقي لكرة القدم وأكد إنفانتينو التزامه بدعم كرة القدم الأفريقية، قائلاً: ستجدون دائماً في شخصي وفي فيفا شريكاً موثوقاً به، وأخاً يمكن الاعتماد عليه، لنضمن أن تصبح أحلام الأطفال في أبوجا وكيب تاون والقاهرة وجميع أنحاء أفريقيا حقيقة واقعة. وختم وسط تصفيق الحاضرين: نحن نؤمن بأفريقيا لأننا نحب أفريقيا، ولأننا نحن أفريقيا.";

const ALJAZEERA_INFANTINO =
  "جدد باتريس موتسيبي رئيس الاتحاد الأفريقي لكرة القدم (الكاف) دعمه لإعادة انتخاب ⁠⁠جياني إنفانتينو ⁠⁠رئيسا للاتحاد الدولي للعبة (الفيفا)، وذلك في الوقت الذي أعلن فيه المسؤول السويسري اليوم السبت عن زيادة هائلة في مبالغ المنح المقدمة لكل ⁠⁠اتحاد عضو في الفيفا. وفي كلمة ألقاها خلال الجمعية العمومية العادية للاتحاد القاري في أبوجا بنيجيريا، قال موتسيبي إن الكاف يدعم إنفانتينو لولاية أخرى في مواجهة منافسيه ⁠⁠رئيس الاتحاد الفرنسي فيليب ديالو والرئيس الفخري للاتحاد الياباني كوزو تاشيما. وقال موتسيبي: \"شهدت خلال السنوات الخمس الماضية (وأنا رئيس للكاف) التزامه العميق. جياني أنت تحظى بدعمنا بين اتحادات الكاف البالغ عددها 54 اتحادا\". وقال إنفانتينو إنه سيواصل وضع تطوير كرة القدم في أفريقيا على رأس ‌‌أولوياته طوال فترة رئاسته للفيفا. وأضاف: \"ستجدون دائما في شخصي وفي الفيفا شريكا موثوقا به، وأخا يمكن الاعتماد عليه لنضمن أن تصبح أحلامنا جميعا والأحلام التي تراود الأطفال في أبوجا وفي كيب تاون وفي القاهرة وفي كل مكان من أفريقيا حقيقة واقعة\". وأكد إنفانتينو مجددا الخطة الرامية إلى زيادة المنحة الممنوحة للاتحادات الأعضاء في الفيفا حول العالم بأكثر من ضعفين، لتصبح 25 مليون دولار ⁠⁠بدلا من ثمانية ملايين حاليا على مدار أربع سنوات. وستدخل ⁠⁠هذه الزيادة حيز التنفيذ بدءا من يناير/كانون الثاني 2027، أي قبل ثلاثة أشهر من انتخابات رئاسة الفيفا في المغرب. وكانت خطة زيادة المنح في إطار برنامج \"فيفا فورورد 4.0\" الجديد قد طُرحت في ⁠⁠أكتوبر/تشرين الأول الماضي، ومن المقرر أن يتم التصديق عليها خلال اجتماع مجلس الفيفا الشهر المقبل. وقال إنفانتينو: \"عندما انتُخبتُ لأول مرة (عام ⁠⁠2016) كان كل اتحاد يتلقى من الفيفا 250 ألف ⁠⁠دولار سنويا أو مليون دولار كل أربع سنوات لتطوير كرة القدم\". وأوضح حجم زيادة تلك المنحة قائلا: \"الآن بعد مرور 10 سنوات، ستتلقون 25 مليون دولار لاستثمارها في تطوير كرة القدم. وسنعمل على زيادة هذا المبلغ أكثر من ذلك. لأنكم ‌‌تستحقون ذلك. ولأن شبابكم يستحقون ذلك، أموال الفيفا هي أموالكم وأنتم تستثمرونها في البنية الأساسية وفي التنمية وفي الفرص\". وأضاف وسط تصفيق حار: \"نحن نؤمن بأفريقيا لأننا نحب ‌‌أفريقيا ولأننا ‌‌نحن أفريقيا\". وجدد اتحاد أمريكا الجنوبية لكرة القدم (الكونميبول) أمس الجمع";

const ALJAZEERA_SUPPORT =
  "أعلن الاتحاد الإفريقي لكرة القدم \"كاف\"، السبت، دعمه بالإجماع لرئيس الاتحاد الدولي لكرة القدم \"فيفا\"، جياني إنفانتينو، من أجل الحصول على ولاية جديدة، وذلك خلال جمعيته العمومية الـ48 التي انعقدت السبت في العاصمة النيجيرية أبوجا، في خطوة تشكل تطورا لافتا في سباق الرئاسة، الذي يخوضه الفرنسي فيليب ديالو منافسا لإنفانتينو. وجاء إعلان الدعم على لسان رئيس الكاف، باتريس موتسيبي ، الذي دعا ممثلي الاتحادات الإفريقية الـ54 إلى الوقوف والتصفيق لإنفانتينو، مؤكدا أن القارة تقف موحدة خلف ترشحه لولاية جديدة . وقال موتسيبي: لقد كان دائما إلى جانبنا في الماضي، ويمكننا الاعتماد عليه دائما ، مضيفا: خلال السنوات الخمس الماضية، تمكنت من ملاحظة مدى تفانيه العميق في تطوير كرة القدم بإفريقيا . وتابع رئيس الكاف أن إنفانتينو أعلن تخصيص 25 مليون دولار لكل اتحاد من الاتحادات الإفريقية الـ54 اعتبارا من الأول من يناير 2027، قبل أن يخاطبه قائلا: يمكننا الآن الوقوف والتصفيق للتعبير عن دعمنا لجياني إنفانتينو. أنت مرشحنا . وكان إنفانتينو حاضرا في الجمعية العمومية، إلى جانب منافسه الفرنسي فيليب ديالو ، رئيس الاتحاد الفرنسي لكرة القدم، الذي اختار أبوجا لتكون أول محطة في حملته الانتخابية، بالنظر إلى الثقل الانتخابي للقارة الإفريقية التي تمتلك 54 صوتا، أي أقل بصوت واحد فقط من أوروبا . لكن حضور ديالو تراجع أمام الاهتمام الذي حظي به الرئيس الحالي للفيفا، الذي استقبل بتصفيق حار، فيما ظهر المرشح الفرنسي واقفا خلال لحظة التصفيق دون أن يظهر وهو يشارك فيه، بحسب المشاهد المنقولة مباشرة، إذ بدا منشغلا بتعديل ربطة عنقه . وألقى إنفانتينو كلمة استمرت نحو 20 دقيقة، استعرض خلالها حصيلته على رأس الفيفا، وأشاد بتطور كرة القدم الإفريقية، قائلا إن القارة حصلت على 10 مقاعد في كأس العالم 2026، مقارنة بخمسة مقاعد سابقا، مضيفا: هذا لأنكم تستحقون ذلك . كما قال مخاطبا الاتحادات الإفريقية: أموال الفيفا هي أموالكم ، مؤكدا استمرار شراكته مع القارة ودعم طموحاتها في تطوير كرة القدم . ويأتي الموقف الإفريقي امتدادا لدعم معلن لإنفانتينو من جهات كروية أخرى، إذ جدد اتحاد أميركا الجنوبية لكرة القدم كونميبول ، الذي يمتلك 10 أصوات، واتحاد الاتحادات العربية لكرة القدم، الذي يمثل 22 صوتا، دعمهما لرئيس الفيفا الجمعة . وكان ديالو قد أعلن ترشحه ل";

function cand(id: string, sourceId: string, title: string, text: string): StoryCandidate {
  return {
    id,
    title,
    sourceId,
    sourceName: sourceId,
    publishedAt: 1_700_000_000_000,
    text,
    textSource: 'full',
  };
}

describe('digestSimilarity: normalisation and profiles', () => {
  it('strips tashkeel and unifies alef, yeh and teh-marbuta', () => {
    // Both spellings must land on the same lead, or a duplicate is missed.
    expect(leadOf('إِنْفَانْتِينُو')).toBe(leadOf('انفانتينو'));
    expect(leadOf('مُصَابُونَ')).toBe(leadOf('مصابون'));
    expect(leadOf('كرة القدم')).toBe(leadOf('كره القدم'));
  });

  it('keeps only the lead, so a long tail cannot dominate', () => {
    const long = 'خبر مهم '.repeat(2000);
    expect(leadOf(long).length).toBeLessThanOrEqual(2000);
  });

  it('caps the gram set so page furniture cannot flood the comparison', () => {
    const grams = gramProfile('نص '.repeat(5000));
    expect(grams.size).toBeLessThanOrEqual(TOP_K);
    expect(SHINGLE_SIZE).toBe(5);
  });

  it('scores identical text 1 and unrelated text near 0', () => {
    expect(similarity(profileOf(ARABIYA_INFANTINO).grams, profileOf(ARABIYA_INFANTINO).grams)).toBe(1);
    expect(
      similarity(profileOf(ARABIYA_INFANTINO).grams, profileOf(ALJAZEERA_SUPPORT).grams),
    ).toBeLessThan(SIMILARITY_THRESHOLD);
  });

  it('reports a body as comparable only when it has a lead', () => {
    expect(profileOf('خبر قصير').comparable).toBe(false);
    expect(profileOf(ARABIYA_INFANTINO).comparable).toBe(true);
    expect(MIN_COMPARABLE_CHARS).toBeLessThan(leadOf(ARABIYA_INFANTINO).length);
  });
});

describe('digestSimilarity: the measured threshold', () => {
  it('merges the same story under two different headlines', () => {
    // 0.748 on the real bodies: one story, two outlets, different wording.
    const a = profileOf(MASRAWY_ZAMALEK).grams;
    const b = profileOf(YOUM7_ZAMALEK).grams;
    expect(similarity(a, b)).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  it('merges the Infantino grant story that title clustering misses', () => {
    // 0.328 on the real bodies — the weakest true duplicate in the pool, and the
    // reason the threshold is 0.30 rather than 0.45.
    const score = similarity(profileOf(ARABIYA_INFANTINO).grams, profileOf(ALJAZEERA_INFANTINO).grams);
    expect(score).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
    expect(score).toBeLessThan(0.4); // i.e. it needs the lower threshold
  });

  it('never merges two different stories (the 0.183 pair)', () => {
    const score = similarity(
      profileOf(ALJAZEERA_SUPPORT).grams,
      profileOf(ALJAZEERA_INFANTINO).grams,
    );
    expect(score).toBeLessThan(SIMILARITY_THRESHOLD);
  });

  it('is not the title-based 0.45 threshold any more', () => {
    // A deliberate guard: 0.45 was the feed's value and would miss the Infantino
    // pair, so a silent revert to it must fail here.
    expect(SIMILARITY_THRESHOLD).toBeLessThan(0.45);
  });
});

describe('digestSimilarity: grouping', () => {
  it('merges the same story across outlets and keeps the count honest', () => {
    const groups = groupByText([
      cand('a', 'almasry', 'شيكوبانزا ينتظم في تدريبات الزمالك', MASRAWY_ZAMALEK),
      cand('b', 'youm7', 'شيكو بانزا ينتظم فى تدريبات الزمالك بعد العودة', YOUM7_ZAMALEK),
      cand('c', 'alarabiya', 'إنفانتينو يعلن زيادة ضخمة في منح الاتحادات', ARABIYA_INFANTINO),
    ]);
    expect(groups).toHaveLength(2);
    const merged = groups.find((g) => g.members.length > 1);
    expect(merged?.sourceCount).toBe(2);
    expect(merged?.via).toBe('text');
    expect(merged?.similarity).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  it('never merges two reports from one outlet, even word-for-word', () => {
    // That is a republish or a follow-up, not independent coverage.
    const groups = groupByText([
      cand('a', 'youm7', 'خبر', MASRAWY_ZAMALEK),
      cand('b', 'youm7', 'خبر تاني', MASRAWY_ZAMALEK),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.sourceCount === 1)).toBe(true);
  });

  it('does not compare bodies too short to have a lead', () => {
    const groups = groupByText([
      cand('a', 'youm7', 'خبر', 'خبر قصير'),
      cand('b', 'almasry', 'خبر', 'خبر قصير'),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('anchors a group on its lead, so a chain cannot weld two stories', () => {
    // A and B are near-identical; C shares half of B but not A. C stays out.
    const groups = groupByText([
      cand('a', 'almasry', 'أ', MASRAWY_ZAMALEK),
      cand('b', 'youm7', 'ب', YOUM7_ZAMALEK),
      cand('c', 'alarabiya', 'ج', ARABIYA_INFANTINO + ' ' + YOUM7_ZAMALEK),
    ]);
    expect(groups.find((g) => g.members.some((m) => m.id === 'c'))?.members).toHaveLength(1);
  });

  it('is decoupled from the feed clustering', async () => {
    // The feed's module must not be imported here: its «من N مصادر» thresholds
    // are closed for changes, and this comparator replaces neither.
    const source = (await import('node:fs')).readFileSync(
      new URL('../digestSimilarity.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/from '\.\/cluster\.js'/);

  });
});
