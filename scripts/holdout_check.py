#!/usr/bin/env python3
"""Hold-out check for breaking-rule G.

Rule G was tuned on production titles fetched up to TUNING_CUTOFF. This script
evaluates it on titles fetched AFTER that instant, which G has never seen, and
prints the per-source table plus every flag so each one can be hand-labelled.

Usage (on a box with the repo and the deploy key):
    ssh ... 'docker exec news-aggregator-server-1 cat /data/news.json' > news.json
    python3 scripts/holdout_check.py news.json

Exit code 0 only when the window looks big enough to judge; 1 when it is still
too small. It never decides precision itself — the labels are a judgement call.
"""

import json
import sys
import datetime
import collections

TUNING_CUTOFF = datetime.datetime(2026, 11, 20, 21, 36, 0, tzinfo=datetime.UTC).timestamp() * 1000

# Copied from apps/server/src/categorize.ts so this runs without Node. Keep in
# sync with the module; the vitest suite is the source of truth for behaviour.
CATASTROPHE_NOUNS = [
    'تحطم طائرة', 'سقوط طائرة', 'تحطم مروحية', 'غرق سفينة', 'غرق عبارة', 'انفجار',
    'انفجارات', 'زلزال', 'فيضانات', 'انهيار منزل', 'حريق هائل', 'هجوم', 'قصف',
    'غارات', 'تفجير', 'تصادم قطارين', 'هجمات', 'إطلاق نار', 'اطلاق نار', 'مجزرة',
    'اشتباكات', 'ضربات',
]
CASUALTY_WORDS = [
    'مقتل', 'قتلى', 'قتيل', 'إصابة', 'اصابة', 'إصابات', 'جرحى', 'ضحايا', 'وفيات',
    'مفقودين', 'مصرع', 'لا ناجين', 'غرق', 'انتشال جثة', 'تقتل', 'أسفر عن مقتل', 'سقط',
]
NON_EVENT_ALERT = [
    'لم يحدد', 'لم يتحدد', 'لم يلحق', 'لم يعرف بعد', 'لا ضرر', 'لم يصل', 'ينفي',
    'نفى', 'نفت', 'تنفي', 'نفي', 'تكذيب', 'مرتقب', 'مقرر', 'سيلقي', 'يلتقي',
    'لحضور', 'ندين', 'ستعالج', 'تهمة', 'محكمة العدل', 'سئم الحرب',
]
ROUTINE_MARKERS = [
    'ضبط', 'القبض', 'اعتقال', 'حملة', 'حملات', 'قضية', 'قضايا', 'متهم', 'متهمين',
    'سائق', 'مخدرات', 'بلطجة', 'تسول', 'سرقة', 'إحراز', 'رقابة', 'تموين', 'أسعار',
    'مستشفى', 'مدرسة', 'جامعة', 'محافظ', 'وزير', 'برلمان', 'محكمة', 'حبس', 'حكم',
    'قرار', 'تحرك', 'تحذير', 'نداء', 'بيان', 'رسالة', 'دراسة', 'تقرير', 'حوار',
    'مقابلة', 'رأي',
]
NOT_NEWS_MARKERS = [
    'ملعب', 'لاعب', 'مباراة', 'الدوري', 'منتخب', 'كأس', 'بطولة', 'يوفنتوس',
    'ريال مدريد', 'برشلونة', 'الأهلي', 'الزمالك', 'ليفربول', 'تشيلسي', 'طريقة',
    'وصفة', 'أعراض', 'علامات', 'نصائح', 'فوائد', 'أضرار', 'زى النهارده',
    'زي النهارده', 'في مثل هذا اليوم', 'ذكرى',
]
BREAKING_PREFIXES = ['عاجل', 'BREAKING', 'breaking']


def to_ascii(t: str) -> str:
    return ''.join(str(ord(c) - 0x0660) if '\u0660' <= c <= '\u0669' else c for c in t)


import re


def casualty_toll(title: str) -> int:
    t = to_ascii(title)
    after = re.search(
        r'(?:مقتل|مصرع|إصابة|اصابة|قتل|وفاة|غرق|قتلى|جرحى|ضحايا)[^\d]{0,18}(\d+|عشرات|العشرات|المئات|مئات)', t)
    mass = re.search(r'(?:عشرات|العشرات|المئات|مئات)[^\d]{0,15}(?:قتلى|مصابين|جرحى|ضحايا)', t)
    before = re.search(
        r'(?:^|[^\d])(\d+|عشرات|العشرات|المئات|مئات)\s*'
        r'(?:شخصا|شخصًا|أشخاص|مدنيا|مدنيين|قتيل|قتلى|مصاب|مصابين|جرحى|ضحايا|عنصر|عناصر|طالب|طالبة|تلميذ|تلميذة|عاملا|عمال)?'
        r'[^\d]{0,10}(?:مقتل|قتلى|قتيل|مصرع|إصابة|جرحى|ضحايا|وفيات|تقتل)', t)
    raw = (after.group(1) if after else None) or (before.group(1) if before else None)
    if not raw:
        return 30 if mass else 0
    if re.search(r'عشرات|العشرات', raw):
        return 30
    if re.search(r'المئات|مئات', raw):
        return 300
    if re.search(r'\d+\s*(?:ألف|آلاف|الف)?\s*طن', t):
        return 0
    try:
        return int(raw)
    except ValueError:
        return 0


def is_label(title: str) -> bool:
    n = title.strip()
    for b in ('🔴', '🚨'):
        while n.startswith(b):
            n = n[len(b):].lstrip()
    n = re.sub(r'^[-–—|:،]\s*', '', n)
    hit = False
    for w in BREAKING_PREFIXES:
        if n.startswith(w):
            rest = n[len(w):]
            if rest == '' or re.match(r'^[\s|:،,\-–—!.]', rest):
                hit = True
                break
    if not hit:
        hit = bool(re.search(r'(?:^|\s)-\s*عاجل\s*(?:-\s*[^-]{1,40})?$', title.strip()))
    return hit and not any(m in title for m in NON_EVENT_ALERT)


def is_incident(title: str, min_toll: int = 3) -> bool:
    if any(m in title for m in NOT_NEWS_MARKERS):
        return False
    if any(m in title for m in ROUTINE_MARKERS):
        return False
    if '؟' in title:
        return False
    if not any(n in title for n in CATASTROPHE_NOUNS):
        return False
    if not any(w in title for w in CASUALTY_WORDS):
        return False
    return casualty_toll(title) >= min_toll


def g(title: str) -> bool:
    return is_label(title) or is_incident(title, 3)


def main() -> int:
    rows = json.load(open(sys.argv[1], encoding='utf-8'))
    after = [r for r in rows if r['fetchedAt'] > TUNING_CUTOFF]
    if not after:
        print('hold-out: no rows past the tuning cutoff yet')
        return 1
    ts = [r['fetchedAt'] for r in after]
    hours = (max(ts) - min(ts)) / 3_600_000
    days = hours / 24
    flags = [r for r in after if g(r['title'])]

    print(f'hold-out span: {hours:.2f} h ({days:.2f} d)')
    print(f'hold-out rows: {len(after)} ({len(after) / max(hours, 0.01) * 24:.0f}/day)')
    print(f'G flags: {len(flags)} ({len(flags) / max(days, 0.01):.2f}/day)')
    print('\nper source:')
    all_src = collections.Counter(r['sourceName'] for r in after)
    fl_src = collections.Counter(r['sourceName'] for r in flags)
    for name, n in all_src.most_common():
        print(f'  {name:<20} rows {n:>4}  flags {fl_src[name]:>3}')

    print('\nflags to hand-label:')
    for r in sorted(flags, key=lambda x: x['fetchedAt']):
        when = datetime.datetime.fromtimestamp(r['fetchedAt'] / 1000, datetime.UTC).strftime('%m-%d %H:%M')
        print(f'  {when} | {r["sourceName"]:<16} | {r["title"]}')

    if hours < 20:
        print('\nTOO SMALL TO JUDGE: need about a day of hold-out before the 85% gate.')
        return 1
    print('\nWindow is big enough: hand-label every flag above, then compare to 85%.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
