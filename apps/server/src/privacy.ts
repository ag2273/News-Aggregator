// Public privacy policy. Server-rendered, Arabic RTL by default, English at
// ?lang=en for Play reviewers, with a language toggle between them.
//
// This page is deliberately INDEXABLE: Google Play requires a reachable public
// policy URL, so no noindex/nofollow header or meta is set here. That is the
// opposite of /admin/*, whose guard sets noindex.
//
// Every claim below was checked against the code, not copied from a template:
// the data inventory is in docs/PRIVACY-DATA-MAP.md and the tests assert each
// named third party and each retained record appears.

export type PrivacyLang = 'ar' | 'en';

export const PRIVACY_CONTACT = 'privacy@nileorbit.com';
export const PRIVACY_PUBLISHER = 'رئيس التحرير — nileorbit.com';
/** Shown on the page; bump when the content changes. */
export const PRIVACY_UPDATED = '2026-11-21';

export interface PrivacyCopy {
  lang: PrivacyLang;
  dir: 'rtl' | 'ltr';
  title: string;
  updatedLabel: string;
  otherLang: { label: string; href: string };
  intro: string;
  sections: Array<{ heading: string; body: string[]; table?: { head: string[]; rows: string[][] } }>;
  contactLabel: string;
  contactBlurb: string;
}

const ar: PrivacyCopy = {
  lang: 'ar',
  dir: 'rtl',
  title: 'سياسة الخصوصية — رئيس التحرير',
  updatedLabel: 'آخر تحديث',
  otherLang: { label: 'English', href: '/privacy?lang=en' },
  intro:
    'الصفحة دي بتشرح بالظبط إيه البيانات اللي تطبيق «رئيس التحرير» بيجمعها، وليه، وفين بتتخزن، وقد إيه بتفضل. مفيش كلام قانوني معقد — بنقول اللي بيحصل فعلًا في الكود.',
  sections: [
    {
      heading: 'من نحن',
      body: [
        '«رئيس التحرير» تطبيق مجاني بيجمع عناوين الأخبار من مصادر إخبارية عامة (RSS) ويعرضها في مكان واحد. الموقع nileorbit.com والتطبيق بيتشغّلوا على سيرفر واحد خاص بينا.',
        'المسؤول عن البيانات: ' + PRIVACY_PUBLISHER + '. للتواصل بشأن الخصوصية: ' + PRIVACY_CONTACT + '.',
      ],
    },
    {
      heading: 'البيانات اللي بنجمعها ولماذا',
      body: [
        'الجدول ده هو كل حاجة بنخزّنها. مفيش بيانات تانية بتتخزن على السيرفر.',
      ],
      table: {
        head: ['البيانات', 'ليه بنجمعها', 'فين بتتخزن', 'مدة الاحتفاظ'],
        rows: [
          [
            'البريد الإلكتروني، اسم الحساب، هاش كلمة المرور (scrypt)، حالة توثيق البريد، وقت الإنشاء والتوثيق',
            'إنشاء الحساب وتسجيل الدخول وتوثيق البريد',
            'سيرفرنا الخاص (ملف users)، مش عند طرف خارجي',
            'لغاية ما تحذف الحساب',
          ],
          [
            'توكن الجلسة (JWT)',
            'إنك تفضل داخل الحساب من غير ما تسجل دخول كل مرة',
            'جهازك (تخزين آمن) والسيرفر بيتحقق منه بس',
            '30 يوم من الإصدار',
          ],
          [
            'المصادر اللي بتتابعها، المقالات المحفوظة، التفاعلات (👍❤️😮😢😡) مع وقتها، الكلمات المتابَعة والمكتومة، المصادر المكتومة، تفضيلات الإشعارات',
            'إن الخلاصات والتصفية والتفاعلات تشتغل لحسابك',
            'سيرفرنا الخاص (ملفات JSON منفصلة)',
            'لغاية ما تحذف الحساب أو تلغي الفعل نفسه',
          ],
          [
            'توكن جهاز Firebase Cloud Messaging (FCM)',
            'إرسال الإشعارات لجهازك عن طريق جوجل',
            'سيرفرنا + جوجل (Firebase)',
            'لغاية ما تلغي الإشعارات أو تحذف الحساب',
          ],
          [
            'تقارير الأعطال (Crashlytics): بيانات العطل ونوع الجهاز ونظام التشغيل',
            'نعرف ليه التطبيق بيقفل ونصلّحه',
            'جوجل (Firebase Crashlytics)',
            'حسب إعدادات Firebase عندنا (مش بنربطها بحساب)',
          ],
          [
            'معرّف تثبيت عشوائي (install id) بيتبعت في هيدر مع بعض الطلبات، بيتحوّل لهاش بملح بيتغير كل يوم',
            'نعدّ الأجهزة النشطة يوميًا (DAU) وإحصاءات استخدام مجمّعة',
            'سيرفرنا الخاص. المعرّف الخام **مش بيتخزن أبدًا**',
            'الهاش نفسه يومين بس، وبعدها الأرقام المجمّعة 90 يوم',
          ],
          [
            'أعداد مجمّعة: فتح المقالات، المشاركات، زيارات صفحات المصادر، نص كلمات البحث (من غير ربط بأي شخص)، الحفظ والمتابعة والكتم',
            'إننا نعرف إيه اللي بيتستخدم فعلًا ونحسّن التطبيق',
            'سيرفرنا الخاص (إحصاءات مجمّعة)',
            '90 يوم',
          ],
          [
            'سجلات السيرفر: عنوان IP، الوقت، المسار المطلوب',
            'تشغيل الموقع وتأمينه وتشخيص الأعطال',
            'سجلات Docker علي سيرفرنا',
            'بنحدّها (rotated) ومش بنستخدمها لتحليل سلوك',
          ],
        ],
      },
    },
    {
      heading: 'الخدمات الخارجية',
      body: [
        'بنستخدم الخدمات دي بالاسم، وكلها بتاخد أقل قدر ممكن من البيانات:',
        '• **Google Firebase Cloud Messaging** — توصيل الإشعارات للجهاز. بياخد توكن الجهاز.',
        '• **Google Firebase Crashlytics** — تقارير الأعطال. بياخد بيانات العطل ونوع الجهاز والنظام. مفيش تحليلات استخدام ولا معرّف إعلانات.',
        '• **Resend** — إرسال رسالة توثيق البريد. بياخد البريد ونص الرسالة.',
        '• **Google Cloud** — السيرفر اللي بيشغّل الموقع والتطبيق (منطقة us-central1 في الولايات المتحدة).',
        '• **روابط Google News** — بعض المقالات روابطها من Google News؛ لما تفتحها بتخرج لموقع جوجل أو موقع المصدر الأصلي، وسياساتهم بتنطبق هناك.',
        'التطبيق كمان بيفتح روابط المقالات على مواقع المصادر (الجزيرة، اليوم السابع، وغيرها)، ودي مواقع مش بتاعتنا.',
      ],
    },
    {
      heading: 'ما لا نفعله',
      body: [
        '• مفيش إعلانات في التطبيق، ومفيش بيع أو تأجير لأي بيانات.',
        '• مفيش تتبّع إعلانات، ولا معرّف إعلانات (Advertising ID)، ولا أدوات تحليلات من طرف تالت (مفيش Firebase Analytics ولا غيره).',
        '• مش بنخزّن المقالات كاملة — بس العناوين والملخصات والصور والروابط من خلاصات RSS عامة، والمقال الكامل بيتفتح عند المصدر.',
        '• مش بنربط معرّف التثبيت العشوائي بحسابك، ومش بنحاول نعرف مين أنت.',
        '• مش بنبيع ولا بنشارك بيانات مع وسطاء بيانات.',
      ],
    },
    {
      heading: 'حقوقك',
      body: [
        '• **تحذف حسابك** من داخل التطبيق: «حسابي» ← «حذف الحساب»، أو من غير التطبيق من صفحة /delete-account.',
        '• الحذف **فوري**: بيتشال الحساب والبريد وهاش كلمة المرور، والمصادر المتابَعة، والمقالات المحفوظة، والتفاعلات، والكلمات والمصادر المكتومة، وتوكنات الإشعارات. مفيش نسخة احتياطية بترجع.',
        '• تقدر تسأل عن بياناتك أو تطلب توضيح على ' + PRIVACY_CONTACT + '.',
        '• لو عندك اقتراح أو شكوى، نفس العنوان بيوصلنا.',
      ],
    },
    {
      heading: 'الأطفال',
      body: [
        'التطبيق مش موجّه للأطفال أقل من 13 سنة، ومش بنجمع بيانات عنهم عن قصد. لو عرفت إن طفل تحته 13 عمل حساب، كلّمنا على ' +
          PRIVACY_CONTACT +
          ' وهنحذفه.',
      ],
    },
    {
      heading: 'التعديلات',
      body: [
        'لو غيّرنا حاجة في اللي بنجمعه، هنحدّث الصفحة دي وهنغيّر تاريخ «آخر تحديث» فوق. التغييرات المهمة هنوضّحها في التطبيق كمان.',
      ],
    },
  ],
  contactLabel: 'للتواصل',
  contactBlurb: 'لأي سؤال عن الخصوصية أو طلب يتعلق ببياناتك:',
};

const en: PrivacyCopy = {
  lang: 'en',
  dir: 'ltr',
  title: 'Privacy Policy — Rais Al-Tahrir',
  updatedLabel: 'Last updated',
  otherLang: { label: 'العربية', href: '/privacy' },
  intro:
    'This page states exactly what the «Rais Al-Tahrir» news app collects, why, where it is stored, and for how long. No legal boilerplate — it describes what the code actually does.',
  sections: [
    {
      heading: 'Who we are',
      body: [
        '«Rais Al-Tahrir» (رئيس التحرير) is a free news reader that collects headlines from public news sources (RSS) and shows them in one place. The site nileorbit.com and the app run on our own server.',
        'Data controller: ' + PRIVACY_PUBLISHER + '. Privacy contact: ' + PRIVACY_CONTACT + '.',
      ],
    },
    {
      heading: 'What we collect and why',
      body: ['The table below is everything we store. Nothing else is kept on the server.'],
      table: {
        head: ['Data', 'Purpose', 'Where it is stored', 'Retention'],
        rows: [
          [
            'Email address, account name, scrypt password hash, email-verification status, created/verified times',
            'Creating the account, signing in, verifying the email',
            'Our own server (users store), not a third party',
            'Until you delete the account',
          ],
          [
            'Session token (JWT)',
            'Keeping you signed in',
            'Your device (secure storage); the server only verifies it',
            '30 days from issue',
          ],
          [
            'Followed sources, saved articles, reactions (👍❤️😮😢😡) with timestamps, followed/muted keywords, muted sources, notification preferences',
            'Your personalised feed, filters and reactions',
            'Our own server (separate JSON stores)',
            'Until you delete the account or undo the action',
          ],
          [
            'Firebase Cloud Messaging (FCM) device token',
            'Delivering notifications to your device via Google',
            'Our server + Google (Firebase)',
            'Until you disable notifications or delete the account',
          ],
          [
            'Crash reports (Crashlytics): crash data, device and OS info',
            'Finding and fixing crashes',
            'Google (Firebase Crashlytics)',
            'Per our Firebase settings (never linked to an account)',
          ],
          [
            'A random install id sent as a header on some requests, hashed with a salt that rotates daily',
            'Counting daily active devices and aggregate usage',
            'Our server. The raw id is **never stored**',
            'The hash for 2 days, then aggregate counts only, for 90 days',
          ],
          [
            'Aggregate counts: article opens, shares, source page views, search query text (not linked to anyone), saves, follows, mutes',
            "Understanding what is actually used so we can improve the app",
            'Our own server (aggregate statistics)',
            '90 days',
          ],
          [
            'Server logs: IP address, time, request path',
            'Running and securing the site, diagnosing faults',
            'Docker logs on our server',
            'Rotated; not used for behavioural analysis',
          ],
        ],
      },
    },
    {
      heading: 'Third-party services',
      body: [
        'These are used by name, and each receives the minimum it needs:',
        '• **Google Firebase Cloud Messaging** — notification delivery. Receives the device token.',
        '• **Google Firebase Crashlytics** — crash reports. Receives crash data, device and OS info. No usage analytics, no advertising id.',
        '• **Resend** — sends the email-verification message. Receives the address and the message.',
        '• **Google Cloud** — the server that runs the site and app (us-central1, United States).',
        '• **Google News links** — some articles link to Google News; opening one takes you to Google or the original publisher, where their policies apply.',
        'The app also opens article links on publisher sites (Al Jazeera, Youm7 and others). Those are not our sites.',
      ],
    },
    {
      heading: 'What we do not do',
      body: [
        '• No ads in the app, and no selling or renting of any data.',
        '• No ad tracking, no advertising id, and no third-party analytics SDK (no Firebase Analytics).',
        '• We do not store full articles — only titles, summaries, images and links from public RSS feeds; the full story opens at the publisher.',
        '• We do not link the random install id to your account, and we do not try to identify you.',
        '• No selling or sharing of data with data brokers.',
      ],
    },
    {
      heading: 'Your rights',
      body: [
        '• **Delete your account** in the app (حسابي → حذف الحساب) or without the app at /delete-account.',
        '• Deletion is **immediate**: the account, email and password hash, followed sources, saved articles, reactions, keywords and mutes, and notification tokens are removed. There is no backup that restores them.',
        '• Ask about your data or request clarification at ' + PRIVACY_CONTACT + '.',
        '• Suggestions and complaints go to the same address.',
      ],
    },
    {
      heading: 'Children',
      body: [
        'The app is not directed at children under 13, and we do not knowingly collect their data. If you learn that a child under 13 created an account, contact ' +
          PRIVACY_CONTACT +
          ' and we will delete it.',
      ],
    },
    {
      heading: 'Changes',
      body: [
        'If what we collect changes, we will update this page and the «last updated» date above. Material changes will also be noted in the app.',
      ],
    },
  ],
  contactLabel: 'Contact',
  contactBlurb: 'For any privacy question or a request about your data:',
};

export function privacyCopy(lang: PrivacyLang): PrivacyCopy {
  return lang === 'en' ? en : ar;
}

/** Parse `?lang=`; anything unrecognised means Arabic. */
export function privacyLang(value: string | undefined): PrivacyLang {
  return value === 'en' ? 'en' : 'ar';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Minimal inline formatting: **bold** only, and everything is escaped first. */
function inline(text: string): string {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/**
 * The public page.
 *
 * Indexable on purpose (no robots meta), and with no JS beyond nothing at all:
 * a language link and text. `canonical` points at the Arabic page so the two
 * versions are not treated as duplicates.
 */
export function renderPrivacyPage(copy: PrivacyCopy): string {
  const sections = copy.sections
    .map((s) => {
      const paras = s.body.map((p) => `<p>${inline(p)}</p>`).join('');
      const table = s.table
        ? `<div class="tableWrap"><table>
            <thead><tr>${s.table.head.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
            <tbody>${s.table.rows
              .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
              .join('')}</tbody>
          </table></div>`
        : '';
      return `<section><h2>${escapeHtml(s.heading)}</h2>${paras}${table}</section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="${copy.lang}" dir="${copy.dir}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(copy.title)}</title>
    <meta name="description" content="${escapeHtml(
      copy.lang === 'ar'
        ? 'سياسة الخصوصية لتطبيق رئيس التحرير: البيانات اللي بنجمعها، وليه، وفين بتتخزن، وقد إيه بتفضل.'
        : 'Privacy policy for the Rais Al-Tahrir news app: what data is collected, why, where it is stored and for how long.',
    )}" />
    <link rel="canonical" href="https://news.nileorbit.com/privacy" />
    <style>
      :root{color-scheme:dark}
      body{margin:0;min-height:100vh;background:#0B1511;color:#F8FAFC;
           font-family:system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif;
           direction:${copy.dir};text-align:${copy.dir === 'rtl' ? 'right' : 'left'};padding:24px 16px}
      .wrap{max-width:640px;margin:0 auto;background:#182721;border-radius:20px;padding:28px}
      h1{font-size:22px;margin:0 0 6px}
      h2{font-size:16px;margin:26px 0 8px;color:#34D399}
      p,li,td{font-size:14px;line-height:26px;color:#CBD5E1}
      .meta{font-size:12px;color:#94A3B8;margin-bottom:8px}
      .lang{display:inline-block;margin-bottom:16px;padding:6px 14px;border-radius:14px;
            background:rgba(255,255,255,.08);color:#CBD5E1;text-decoration:none;font-size:12px}
      .tableWrap{overflow-x:auto;margin-top:10px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{padding:9px 8px;text-align:${copy.dir === 'rtl' ? 'right' : 'left'};vertical-align:top;
            border-bottom:1px solid rgba(255,255,255,.08);line-height:22px}
      th{color:#94A3B8;font-weight:600;font-size:11px}
      strong{color:#F8FAFC}
      .contact{margin-top:26px;padding:16px;background:#12221B;border-radius:14px}
      .contact a{color:#34D399;text-decoration:none;font-size:15px;font-weight:700}
      .foot{margin-top:18px;font-size:11px;color:#94A3B8}
      @media (max-width:640px){ .wrap{padding:20px} th,td{font-size:11px} }
    </style>
  </head>
  <body>
    <div class="wrap">
      <a class="lang" href="${escapeHtml(copy.otherLang.href)}" hreflang="${
        copy.lang === 'ar' ? 'en' : 'ar'
      }">${escapeHtml(copy.otherLang.label)}</a>
      <h1>${escapeHtml(copy.title)}</h1>
      <div class="meta">${escapeHtml(copy.updatedLabel)}: ${escapeHtml(PRIVACY_UPDATED)}</div>
      <p>${inline(copy.intro)}</p>
      ${sections}
      <div class="contact">
        <h2 style="margin-top:0">${escapeHtml(copy.contactLabel)}</h2>
        <p>${escapeHtml(copy.contactBlurb)}</p>
        <a href="mailto:${escapeHtml(PRIVACY_CONTACT)}">${escapeHtml(PRIVACY_CONTACT)}</a>
      </div>
      <div class="foot">${escapeHtml(PRIVACY_PUBLISHER)}</div>
    </div>
  </body>
</html>`;
}
