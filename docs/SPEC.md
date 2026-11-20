# Spec — مجمّع أخبار "رئيس التحرير"

الحالة: مُنفّذ ومُشغَّل على الإنتاج. آخر مراجعة: 2026-11-18.

## Problem Statement
القارئ المصري محتاج يشوف كل الأخبار المهمة من مصادر موثوقة في مكان واحد، من غير ما يتنقل بين عشرات المواقع، ويقدر يخصّص مصارعه ويحفظ اللي يهمه، ويوصله العاجل فورًا.

## Solution
تطبيق موبايل عربي (RTL) اسمه "رئيس التحرير" بيجمع أخبار من مصادر عربية ومصرية (RSS + Google News RSS)، ويعرضها في فييد متوازن بين المصادر بتصنيفات وترند وبحث، مع حسابات لمتابعة المصادر والفييد المخصص وحفظ المقالات. المقال الكامل يفتح جوه التطبيق (WebView) من المصدر الأصلي. الإشعارات العاجلة بتوصل عبر Firebase Cloud Messaging مباشرة.

## User Stories
1. كقارئ، عايز موجز أخبار من مصادر موثوقة في مكان واحد، عشان أوفر الوقت.
2. كقارئ، عايز أشوف اسم المصدر ووقت النشر على كل خبر، عشان أثق وأعرف الحداثة.
3. كقارئ، عايز أفتح المقال كاملًا جوه التطبيق، عشان تجربة سلسة.
4. كقارئ، عايز أتصفح حسب التصنيف (مصر، اقتصاد، رياضة، صحة، تكنولوجيا، منوعات).
5. كقارئ، عايز أشوف "الأكثر تداولًا".
6. كقارئ، عايز صفحة مصدر تعرض كل أخباره.
7. كقارئ، عايز أخبار عاجلة بعلامة مميزة وإشعار، عشان أميّز المهم.
8. كمستخدم، عايز أعمل حساب بإيميل وباسورد، عشان أخزّن تفضيلاتي ومتابعاتي.
9. كمستخدم جديد، عايز أوثّق بريدي بلينك، عشان حسابي يبقى حقيقي.
10. كمستخدم، عايز أتابع/ألغي متابعة مصدر بزر واحد.
11. كمستخدم، عايز فييد مخصص "أخباري" بأخبار المصادر اللي بتابعها.
12. كمستخدم، عايز أحفظ مقال لأقراه لاحقًا.
13. كقارئ، عايز أبحث في الأخبار بالعربي (مع تطبيع الهمزات والتشكيل).
14. كمستخدم، عايز أختار إشعارات "العاجل فقط" أو "كل الأخبار" وأقفلها.
15. كقارئ، عايز واجهة عربي RTL كاملة + دارك مود.

## Implementation Decisions

- **Monorepo (pnpm workspaces)**: `apps/mobile` (Expo SDK 58 + expo-router + TypeScript، RTL إجباري) + `apps/server` (Node 22 + TypeScript + Hono + fast-xml-parser).
- **التخزين**: ملفات JSON على القرص تحت `DATA_DIR` (افتراضي `/data`) — `news.json`, `users.json`, `follows.json`, `saved.json`, `push-tokens.json`, `verify-tokens.json`. **مفيش SQLite ومفيش Supabase.** السبب: صفر تبعيات إضافية والنسخ الاحتياطي مجرد نسخة ملفات. التفاصيل في `docs/adr/0002`.
- **Article schema**: `id, title, summary, imageUrl, url, sourceId, sourceName, category, country, publishedAt, isBreaking`.
- **الجمع (ingestion)**: RSS مباشر + Google News RSS بفلتر `site:` — من السيرفر بس، تحديث كل 10 دقائق، إزالة تكرار بالـ URL. **ممنوع سكرابينج المقال الكامل** (عنوان + مقتطف + صورة + لينك فقط). راجع `docs/adr/0001`.
- **الفييد**: `GET /api/feed` بيعمل interleave بين المصادر (كل مصدر بياخد دوره) عشان مصدر واحد عالي النشر ما يبلعش الصفحة الأولى. راجع `apps/server/src/balance.ts`.
- **كشف العاجل**: تسمية صريحة في العنوان (`عاجل |`, `عاجل:`, `عاجل..`, `- عاجل -`, 🔴/🚨, BREAKING) أو كارثة مع ضحايا وعدد ≥ 3. استبعاد صريح للبيانات الصحفية والروتين والتحليلات والرياضة. راجع `docs/adr/0005` و`apps/server/src/categorize.ts`.
- **المصادقة**: JWT مخصّص موقّع بـ HMAC-SHA256 على مفتاح `AUTH_SECRET` (توكن 30 يوم في `Authorization: Bearer`)، الباسورد مشفّر بـ scrypt مع salt لكل مستخدم. التوكن بيتخزن في التطبيق في `expo-secure-store`. **مفيش Supabase ومفيش OAuth.** التفاصيل في `docs/adr/0002` و`docs/AUTH_DB_REC.md`.
- **توثيق البريد**: لينك في إيميل عبر Resend (المرسل `no-reply@nileorbit.com`). التوكن 32 بايت عشوائي، بيتخزن **هاش SHA-256 بس**، استخدام واحد، صلاحية 24 ساعة، وإعادة الإرسال 60 ثانية cooldown و5 مرات/يوم. المستخدم غير الموثّق يتصفح عادي، لكن كل إندبوينت مربوط بالحساب بيرجع **403 `EMAIL_NOT_VERIFIED`**. راجع `docs/adr/0006`.
- **الإشعارات**: FCM HTTP v1 مباشرة من السيرفر (مفيش خدمة Expo push). الجهاز بيسجّل توكن FCM الأصلي، والسيرفر بيوقّع JWT بحساب خدمة Firebase. قناتين على أندرويد: `breaking` (أهمية عالية) و`news`. بيتبعت بس للأخبار اللي اتنشرت خلال 15 دقيقة. راجع `docs/adr/0003` و`docs/PUSH-SETUP.md`.
- **الاستضافة**: سيرفر على GCP e2-micro + Caddy للـ TLS على `news.nileorbit.com`، Docker Compose، والنشر تلقائي من GitHub Actions (`deploy.yml`) على كل push لـ `main` يلمس مسارات السيرفر.
- **بناء الأندرويد**: GitHub Actions بس (`build-android.yml`)، APK لـ `arm64-v8a`، سقف 30 ميجا، بينزل كـ GitHub Release باسم `apk-<n>`. **ممنوع أي بناء محلي أو EAS.** راجع `docs/adr/0004`.
- **فتح المقال**: WebView جوه التطبيق.
- **الهوية**: اسم "رئيس التحرير"، تصميم sage/glassmorphism (كروت متراكبة، شريط سفلي عائم كبسولي)، خط Cairo، توكنز دارك مود. راجع `docs/VISUAL-DIRECTION.md`.

## API (الواقع الفعلي)
عام: `GET /api/feed` · `/api/sources` · `/api/sources/:id/articles` · `/api/categories` · `/api/trending` · `/api/articles/:id` · `/api/search?q=` · `GET /health`

مصادقة: `POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me` · `POST /api/auth/logout` · `POST /api/auth/resend-verification` · `GET /verify?token=`

محمي بالتوكن، ومحتاج توثيق بريد: `GET/PUT/DELETE /api/follows[/:sourceId]` · `GET /api/feed/following` · `GET /api/saved` · `GET/PUT/DELETE /api/saved/:articleId` · `POST/DELETE /api/push/register` · `GET/PUT /api/push/preferences`

## Testing Decisions
- الاختبارات تختبر السلوك الخارجي مش التفاصيل الداخلية.
- السيرفر: vitest — بارسر/موحّد RSS، كشف العاجل، توازن الفييد، توثيق البريد، دفع FCM، ومصادقة. منها integration test إن `GET /api/feed` بيرجع أخبار صالحة (شكل Article كامل) من أكتر من مصدر: `apps/server/src/__tests__/feed.test.ts`.
- الموبايل: **component tests حقيقية** بـ jest-expo + @testing-library/react-native لكارت الخبر (`__tests__/FeedCard.test.tsx`) وحالات زر المتابعة والبوابة (`__tests__/FollowButton.test.tsx`)، بالإضافة لفحوصات node scripts للسلوك اللي مش rendering (السحب، التحميل المسبق، الإشعارات، الكيبورد، شاشة الحساب، التوثيق) في `apps/mobile/scripts/check-*.mjs`.
- التشغيل: `pnpm --filter @news/mobile test` بيشغّل الفحوصات كلها + jest. `pnpm --filter @news/server test` لـ vitest.
- الأسلوب: TDD red-green-refactor عند الـ seams (الباكرسر + إندبوينتس الفييد).

## Out of Scope
- تعليقات/تفاعل اجتماعي
- إعلانات/تحقيق دخل
- دول تانية (مصر الأول بس)
- تخزين/أرشفة المقال الكامل
- النشر للمتاجر (Play/TestFlight) — التوزيع حاليًا APK على GitHub Releases
- نسخة iOS (الكود بيتبني لـ iOS لكن مفيش تسليم)

## الخصوصية والبيانات (الفعلي)
- **صفحة عامة:** `GET /privacy` — سياسة خصوصية عربية RTL، ونسخة إنجليزية على `/privacy?lang=en` مع رابط تبديل اللغة. الصفحة **قابلة للفهرسة** (بدون noindex) لأن Google Play بتحتاج رابط عام للسياسة؛ عكس صفحات `/admin/*`.
- **من التطبيق:** رابط «سياسة الخصوصية» في «حسابي» (مسجّل داخل وخارج)، وأسفل زر «إنشاء الحساب» في التسجيل (سطر الموافقة)، وشاشة تأكيد حذف الحساب. بيفتح في الـ WebView الداخلي (`/webview`). ومربوط كمان من `/delete-account` وذيل رسالة توثيق البريد.
- **جرد البيانات الكامل** — كل صف متحقَّق من الكود: `docs/PRIVACY-DATA-MAP.md`. أهمها: مفيش إعلانات ولا معرّف إعلانات ولا أدوات تحليلات من طرف تالت؛ التحليلات كلها سيرفر-سايد ومجمّعة (ADR 0007)؛ معرّف التثبيت العشوائي بيتحوّل لهاش بملح بيتغير كل يوم والخام مش بيتخزن؛ الحذف فوري وبيشيل كل بيانات الحساب.
- **التواصل:** privacy@nileorbit.com (مذكور في سجل DMARC للدومين).

## Further Notes
- قائمة المصادر: `docs/SOURCES.md`. المعجم: `GLOSSARY.md`. القرارات المعمارية: `docs/adr/`. إعداد الدفع: `docs/PUSH-SETUP.md`.
- الـ seam الأساسي بين الطبقات: الـ REST API بتاع السيرفر (السيرفر والتطبيق لا يلتقيان إلا عبره).
