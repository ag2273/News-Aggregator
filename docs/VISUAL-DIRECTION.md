# Visual Direction & Design Specification (التوجيه البصري والمواصفات التصميمية)

> **وثيقة التوجيه البصري الصارمة لتطبيق الأخبار (React Native / Expo)**  
> مطابقة حرفية وتفصيلية لشاشات المرجع المرفقة (`1000164105.jpg` و `1000164106.jpg`).  
> هذه الوثيقة مخصصة لمطور الواجهات (Bolt) للتنفيذ المباشر بالبكسل والتنسيقات الجاهزة (Pixel-Close React Native Styles).

---

## ١. تحليل وتفكيك الشاشات المرجعية (Literal Reference Breakdown)

### أ) الشاشة الأولى: الشاشة الرئيسية (`1000164105.jpg`)
1. **الخلفية (Background)**:
   - ليست لوناً مصمتاً بل **تدرج لوني عمودي ناعم (Vertical Linear Gradient)**.
   - البداية من الأعلى: أخضر مريمي/نعناعي فاتح ناعم جداً (`#E4EFE7` إلى `#D2E5D8`).
   - المنتصف: أخضر باستيل هادئ ناصع (`#EAF3ED`).
   - الأسفل: أخضر مريمي متوسط يمنح عمقاً خلف الكبسولة العائمة (`#95BEA4` إلى `#85B295`).
2. **شريط الحالة والرأس (Header)**:
   - أقصى اليمين (RTL): التاريخ بخط رمادي فاتح رفيع `May, 10 2025` (حجم 13px، لون `#64748B`) وأسفله مباشرة العنوان الرئيسي العريض `News Hub` / `مركز الأخبار` (حجم 26px، وزن `Cairo_800ExtraBold`، لون `#0F172A`).
   - أقصى اليسار: زران دائريان أبيضان عائمان (`width: 44, height: 44, borderRadius: 22`، خلفية `#FFFFFF` مع ظل ناعم خفيف `shadowOpacity: 0.06, elevation: 2`)؛ الأول للبحث 🔍 والثاني للإشعارات 🔔.
3. **كبسولات التصنيفات (Category Filter Pills)**:
   - صف أفقي تمريري (Horizontal Scroll).
   - الكبسولة النشطة: خلفية سوداء داكنة مصمتة (`#000000` أو `#0F172A`)، نص أبيض عريض (`#FFFFFF`، حجم 13px، حشوة `paddingHorizontal: 20, paddingVertical: 10`، تدوير `borderRadius: 20`).
   - الكبسولات غير النشطة: خلفية بيضاء نقية أو شبه شفافة عائمة بدون إطار خارجي (`backgroundColor: '#FFFFFF'` أو `rgba(255,255,255,0.85)`، لون النص `#475569`، بدون `borderWidth`).
4. **عنوان القسم (Section Header)**:
   - عنوان القسم `Popular News` / `الأكثر قراءة الآن` بخط عريض (حجم 18px، لون `#0F172A`) يقابله على الطرف الآخر رابط `See All` / `عرض الكل` بخط رمادي ناعم (حجم 13px، لون `#64748B`).
5. **مجموعة الكروت المتراكبة (Tinder / Stacked Deck Cards)**:
   - ليست قائمة عمودية عادية؛ بل ثلاث بطاقات متراكبة في مكانها تبرز حواف البطاقات الخلفية في الأعلى:
     - البطاقة الثالثة (العميقة): يظهر الجزء العلوي منها بشعار CNN الأحمر.
     - البطاقة الثانية: يظهر الجزء العلوي منها بشعار Al Jazeera / الجزيرة.
     - البطاقة الأولى (الأمامية البارزة):
       - خلفية بيضاء نقية (`#FFFFFF`) بزوايا دائرية فائقة النعومة (`borderRadius: 28`) مع حشوة داخلية `padding: 16` وظل عائم عميق (`shadowOpacity: 0.08, shadowRadius: 20, elevation: 4`).
       - **ترويسة المصدر**: صورة دائرية للمصدر (`36×36px, borderRadius: 18`) + اسم المصدر مع شارة التوثيق الزرقاء (`✓` بلون `#2563EB`) + توقيت النشر النسبي (`2 hours ago` بالرمادي `#64748B`) + زر قائمة النقاط الثلاث `...` في دائرة بيضاء أو رمادية خفيفة على الطرف المقابل.
       - **العنوان**: خط عريض من سطرين (`fontSize: 17, lineHeight: 25`) ينتهي برمز النار التعبيري `🔥`.
       - **الصورة الكبيرة**: مستطيل كامل العرض داخل الكارت (`height: 190-200px, borderRadius: 20`) يملأ الكارت بعرضه الداخلي.
       - **شريط التفاعل السفلي (Engagement Bar)**:
         - أيقونة الإعجاب ❤️ + الرقم (`825`).
         - أيقونة التعليقات 💬 + الرقم (`200`).
         - أيقونة المشاهدات 👁️ + الرقم (`900`).
         - زر المشاركة الدائري ↗️ / 🔗 في أقصى الطرف الآخر.
6. **شريط الملاحة السفلي العائم (Floating Capsule Dock)**:
   - كبسولة عائمة بيضاء منفصلة تماماً عن حواف الشاشة: عرض `~290-310px`، ارتفاع `~62px`، تدوير بيضاوي كامل (`borderRadius: 31`)، تطفو على مسافة `~20px` أعلى مؤشر الشاشة السفلي، مع ظل ناعم كثيف.
   - تحتوي على 4 أيقونات متساوية التوزيع:
     1. **الرئيسية (Home)**: زر دائري مميز بهالة متوهجة وتدرج أخضر ناصع (`#34D399` إلى `#10B981`) مع أيقونة منزل بلون أخضر غامق (`#064E3B`).
     2. **الفيديو / الوسائط (Video Cam)**: أيقونة كاميرا فيديو (`videocam-outline` أو `play-circle-outline`) باللون الرمادي، وليست شعلة نار!
     3. **المحفوظات (Bookmarks)**: أيقونة إشارة مرجعية (`bookmark-outline`).
     4. **الملف الشخصي (Profile)**: أيقونة مستخدم (`person-outline`).

---

### ب) الشاشة الثانية: فييد القائمة وتفاصيل الخبر (`1000164106.jpg`)

#### ١. فييد القائمة (الجانب الأيسر من الصورة المرجعية - News Feed)
- **الهيدر**: زر رجوع دائري `<` في الطرف الأيمن/الأيسر، عنوان الشاشة في الوسط `News` / `الأخبار` بخط عريض 18px، وزر قائمة ثلاث نقاط `...` دائري في الطرف المقابل.
- **كروت الأخبار المستقلة (Stacked Vertical Feed Cards)**:
  - كل خبر يمثل كارت أبيض عريض ومستقل (`borderRadius: 24-26, padding: 16, marginBottom: 16`) بنفس التركيبة الرأسية للكارت الرئيسي:
    - صف الناشر في الأعلى: لوجو دائري + اسم المصدر + شارة التوثيق الزرقاء + توقيت النشر النسبي + زر النقاط الثلاث.
    - العنوان في المنتصف في سطرين بخط عريض داكن ينتهي بـ `🔥`.
    - صورة الخبر الكبيرة بالعرض الكامل للبطاقة مع زوايا دائرية (`height: 170-190px, borderRadius: 18`).
  - **تنبيه صارم**: لا توجد في المرجع كروت مضغوطة أفقياً (نص يمين وصورة صغيرة يسار)؛ جميع الكروت في المرجع كروت رأسية كاملة العرض!

#### ٢. شاشة قراءة تفاصيل الخبر (الجانب الأيمن من الصورة المرجعية - Native Article Reader)
- **ليست WebView خارجي!** بل قارئ أصلي مخصص (Native Custom Reader):
- **النصف العلوي (Hero Image Section)**:
  - صورة الخبر الرئيسية ملء الشاشة تماماً (Edge-to-Edge) تمتد بارتفاع `~42-45%` من الشاشة.
  - أزرار عائمة شفافة (Frosted Glass / Translucent):
    - زر رجوع دائري شبه شفاف `<` بأعلى اليمين/اليسار.
    - عنوان القسم في المنتصف `Popular News` بخط أبيض ناصع مع نقاط مؤشر الصور (Pagination Dots).
    - زر ثلاث نقاط دائري شبه شفاف `...` على الطرف الآخر.
- **النصف السفلي (Curved Bottom Sheet Card)**:
  - بطاقة بيضاء بنهايات دائرية كبيرة في الأعلى (`backgroundColor: '#FFFFFF', borderTopLeftRadius: 36, borderTopRightRadius: 36`).
  - تتراكب وتصعد فوق الجزء السفلي من الصورة بحوالي `~24px`.
  - محتويات البطاقة من الأعلى للأسفل:
    1. **صف المصدر**: لوجو المصدر دائري (مثل CNN) + اسم المصدر مع شارة التوثيق الزرقاء + توقيت النشر النسبي (`2 hours ago`) + زر مشاركة دائري على الطرف الآخر.
    2. **العنوان الرئيسي العريض**: خط كبير عريض بحجم `22px` وارتفاع سطر `30px` ينتهي برمز تعبيري `🔥`.
    3. **تاريخ ووقت النشر الدقيق**: سطر رمادي ناعم `10 May 2025, 01 pm` (حجم 13px، لون `#64748B`).
    4. **شريط بيانات الكاتب والإعجاب (Metadata Row)**:
       - اسم الكاتب (مثال: `By Daniel Carter` أو `بقلم دانييل كارتر`).
       - اسم المؤسسة (`BBC News`).
       - شارة التفاعل: رمز الإعجاب مع العداد (`👍 10k liked` أو `❤️ 10k`).
    5. **نص الخبر الصحفي (Editorial Body Paragraphs)**:
       - خط قراءة عربي أنيق (`Cairo_400Regular` بحجم 16px مع `lineHeight: 28px` ولون فحم ناعم `#334155`).
       - حواشي وتنسيق صحفي مريح للعين مع مسافات بين الفقرات.

---

## ٢. قائمة الفجوات الحالية في الكود مقارنة بالمرجع (Gap Analysis)

| # | العنصر | الوضع الحالي في الكود (`apps/mobile`) | المطلوب للمطابقة الحرفية للمرجع | الملف المعني |
|---|---|---|---|---|
| **١** | **خلفية التطبيق** | لون رمادي مصمت ثابت (`#F5F9F6`) على `SafeAreaView` | تدرج لوني عمودي ناعم (`#E4EFE7` إلى `#85B295`) باستخدام `expo-linear-gradient` | `colors.ts`, `index.tsx`, `trending.tsx` |
| **٢** | **القسم الرئيسي بالهوم** | قائمة `FlatList` عادية تبدأ مباشرة بكروت صغيرة | مجموعة كروت متراكبة ثلاثية (Deck Stack) تظهر حواف كروت CNN والجزيرة خلف الكارت الأول | `app/index.tsx` |
| **٣** | **تصميم كارت الخبر** | صف أفقي مضغوط (`flexDirection: 'row'`, صورة صغيرة 110×110) | كارت رأسي أبيض واسع: ناشر بالأعلى، عنوان مع `🔥`، صورة عريضة بارتفاع ~190px وزوايا 20px | `app/index.tsx`, `trending.tsx` |
| **٤** | **شريط التفاعل بالكروت** | غير موجود نهائياً في الكروت الحالية | شريط سفلي داخل الكارت: إعجاب (825)، تعليق (200)، مشاهدات (900)، وزر مشاركة | `app/index.tsx`, `trending.tsx` |
| **٥** | **ترويسة كارت الخبر** | مجرد اسم مصدر بلون أزرق وتوقيت بدون صور | لوجو المصدر دائري (36px)، شارة توثيق زرقاء `✓`، وقت نسبي، وزر `...` | `app/index.tsx`, `trending.tsx` |
| **٦** | **شاشة المقال (`article.tsx`)** | مجرد `WebView` خارجي مع شريط أبيض بسيط | قارئ أصلي (Native Reader): صورة غلاف علوية بكامل العرض مع أزرار شفافة، ولوح سفلي مقوس (`borderRadius: 36`) للنص والمصادر | `app/article.tsx` |
| **٧** | **كبسولة الملاحة السفلية** | الأيقونة الثانية شعلة نار (`flame-outline`)، والزر النشط دائرة خضراء مسطحة | الأيقونة الثانية كاميرا فيديو (`videocam-outline`)، والزر النشط هالة خضراء متوهجة ذات تدرج | `app/index.tsx`, `constants/colors.ts` |
| **٨** | **كبسولات التصنيفات** | إطار رمادي واضح `borderWidth: 1` في الكبسولات غير النشطة | كبسولات بيضاء عائمة نقية بدون إطار خارجي (`borderWidth: 0`)، والنشطة سوداء فاحمة | `app/index.tsx` |
| **٩** | **ترويسة الشاشة الرئيسية** | غياب رابط "عرض الكل" بجانب عنوان "الأكثر قراءة الآن" | إضافة رابط `عرض الكل` أو `See All` على يسار عنوان القسم لينقل لفييد الأخبار الكامل | `app/index.tsx` |

---

## ٣. حزمة الألوان والتنسيقات المحدثة (Exact Design Tokens)

### التدرجات والألوان (`apps/mobile/constants/colors.ts`)

```typescript
export const palette = {
  light: {
    // الخلفية المتدرجة
    bgGradientTop: '#E6F0E9',       // أخضر باستيل علوي ناعم
    bgGradientMid: '#EEF6F1',       // منتصف فاتح هادئ
    bgGradientBottom: '#8FB99F',    // أخضر مريمي سفلي يبرز الكبسولة
    
    // الأسطح والكروت
    surface: '#FFFFFF',             // أبيض نقي للكروت
    surfaceTranslucent: 'rgba(255, 255, 255, 0.85)',
    surfaceFrosted: 'rgba(255, 255, 255, 0.45)', // للأزرار فوق الصور
    
    // شريط الملاحة العائم
    dockBg: '#FFFFFF',
    dockShadow: 'rgba(0, 0, 0, 0.12)',
    dockActiveGradientStart: '#34D399',
    dockActiveGradientEnd: '#10B981',
    dockActiveIcon: '#064E3B',
    
    // النصوص
    textPrimary: '#0F172A',         // أسود فحمي ناصع
    textSecondary: '#475569',       // رمادي داكن مقروء
    textMuted: '#64748B',           // رمادي للمقاييس والتواريخ
    
    // الكبسولات والشارات
    pillActiveBg: '#0F172A',        // أسود كلاسيكي
    pillActiveText: '#FFFFFF',
    pillInactiveBg: '#FFFFFF',      // أبيض بدون حدود
    pillInactiveText: '#475569',
    
    // الشارات والعلامات
    verified: '#2563EB',            // أزرق التحقق الرسمي
    breaking: '#EF4444',            // أحمر الأخبار العاجلة والرموز 🔥
    accent: '#10B981',
    
    // الحدود
    borderLight: 'rgba(226, 232, 240, 0.6)',
  },
  dark: {
    bgGradientTop: '#0B1511',
    bgGradientMid: '#12221B',
    bgGradientBottom: '#07100D',
    surface: '#182721',
    surfaceTranslucent: 'rgba(24, 39, 33, 0.85)',
    surfaceFrosted: 'rgba(0, 0, 0, 0.45)',
    dockBg: '#182721',
    dockShadow: 'rgba(0, 0, 0, 0.4)',
    dockActiveGradientStart: '#10B981',
    dockActiveGradientEnd: '#059669',
    dockActiveIcon: '#ECFDF5',
    textPrimary: '#F8FAFC',
    textSecondary: '#CBD5E1',
    textMuted: '#94A3B8',
    pillActiveBg: '#F1F5F9',
    pillActiveText: '#0F172A',
    pillInactiveBg: 'rgba(255, 255, 255, 0.1)',
    pillInactiveText: '#CBD5E1',
    verified: '#3B82F6',
    breaking: '#F87171',
    accent: '#34D399',
    borderLight: 'rgba(255, 255, 255, 0.1)',
  },
};
```

---

## ٤. مواصفات المكونات الجاهزة للتنفيذ (Component Specifications)

### ١. غلاف الخلفية المتدرج (Gradient Root Wrapper)
يجب استخدام `LinearGradient` من مكتبة `expo-linear-gradient` لتغليف كامل الشاشات:
```tsx
import { LinearGradient } from 'expo-linear-gradient';

<LinearGradient
  colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]}
  style={styles.rootGradient}
>
  <SafeAreaView style={styles.safeArea} edges={['top']}>
    {/* محتوى الشاشة */}
  </SafeAreaView>
</LinearGradient>
```

### ٢. مجموعة الكروت المتراكبة (Hero Deck Stack)
في الشاشة الرئيسية، كود الكروت الثلاثة المتراكبة:
```tsx
<View style={styles.deckContainer}>
  {/* كارت الطبقة 3 الخلفي (CNN) */}
  <View style={[styles.deckLayer3, { backgroundColor: t.surface }]}>
    <View style={styles.miniBadge}>
      <Text style={styles.miniBadgeText}>CNN</Text>
    </View>
  </View>

  {/* كارت الطبقة 2 الأوسط (Al Jazeera) */}
  <View style={[styles.deckLayer2, { backgroundColor: t.surface }]}>
    <View style={styles.miniBadge}>
      <Text style={styles.miniBadgeText}>Al Jazeera</Text>
    </View>
  </View>

  {/* كارت الطبقة 1 الأمامي الفعلي (Front Active Card) */}
  <TouchableOpacity
    activeOpacity={0.9}
    onPress={() => openArticle(featuredArticle)}
    style={[styles.frontCard, { backgroundColor: t.surface }]}
  >
    {/* ترويسة الكارت */}
    <View style={styles.cardHeader}>
      <View style={styles.publisherRow}>
        <Image source={{ uri: featuredArticle.sourceLogo }} style={styles.avatar} />
        <View style={styles.publisherMeta}>
          <View style={styles.nameVerifiedRow}>
            <Text style={[styles.publisherName, { color: t.textPrimary }]}>
              {featuredArticle.sourceName}
            </Text>
            <Ionicons name="checkmark-circle" size={14} color={t.verified} />
          </View>
          <Text style={[styles.timestamp, { color: t.textMuted }]}>
            {relativeTime(featuredArticle.publishedAt)}
          </Text>
        </View>
      </View>
      <TouchableOpacity style={styles.moreBtn}>
        <Ionicons name="ellipsis-vertical" size={18} color={t.textMuted} />
      </TouchableOpacity>
    </View>

    {/* العنوان */}
    <Text style={[styles.deckTitle, { color: t.textPrimary }]} numberOfLines={2}>
      {featuredArticle.title} 🔥
    </Text>

    {/* الصورة الكبيرة */}
    <Image source={{ uri: featuredArticle.imageUrl }} style={styles.deckImage} />

    {/* شريط التفاعل السفلي */}
    <View style={styles.metricsBar}>
      <View style={styles.metricItem}>
        <Ionicons name="heart-outline" size={16} color={t.textMuted} />
        <Text style={[styles.metricText, { color: t.textMuted }]}>825</Text>
      </View>
      <View style={styles.metricItem}>
        <Ionicons name="chatbubble-outline" size={15} color={t.textMuted} />
        <Text style={[styles.metricText, { color: t.textMuted }]}>200</Text>
      </View>
      <View style={styles.metricItem}>
        <Ionicons name="eye-outline" size={16} color={t.textMuted} />
        <Text style={[styles.metricText, { color: t.textMuted }]}>900</Text>
      </View>
      <TouchableOpacity style={styles.shareIconBtn}>
        <Ionicons name="share-outline" size={16} color={t.textMuted} />
      </TouchableOpacity>
    </View>
  </TouchableOpacity>
</View>
```

#### تنسيقات الـ Deck في StyleSheet:
```typescript
deckContainer: {
  marginHorizontal: 16,
  marginTop: 10,
  marginBottom: 20,
  position: 'relative',
  alignItems: 'center',
},
deckLayer3: {
  position: 'absolute',
  top: -16,
  width: '84%',
  height: 50,
  borderRadius: 24,
  opacity: 0.6,
  paddingHorizontal: 16,
  paddingTop: 8,
  zIndex: 1,
},
deckLayer2: {
  position: 'absolute',
  top: -8,
  width: '92%',
  height: 50,
  borderRadius: 26,
  opacity: 0.85,
  paddingHorizontal: 16,
  paddingTop: 8,
  zIndex: 2,
},
frontCard: {
  width: '100%',
  borderRadius: 28,
  padding: 16,
  zIndex: 3,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.08,
  shadowRadius: 24,
  elevation: 5,
},
cardHeader: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
},
publisherRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
},
avatar: {
  width: 38,
  height: 38,
  borderRadius: 19,
  backgroundColor: '#E2E8F0',
},
publisherMeta: {
  justifyContent: 'center',
},
nameVerifiedRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 4,
},
publisherName: {
  fontFamily: 'Cairo_700Bold',
  fontSize: 14,
},
timestamp: {
  fontFamily: 'Cairo_400Regular',
  fontSize: 11,
},
moreBtn: {
  width: 32,
  height: 32,
  borderRadius: 16,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#F8FAFC',
},
deckTitle: {
  fontFamily: 'Cairo_700Bold',
  fontSize: 16,
  lineHeight: 24,
  marginBottom: 12,
},
deckImage: {
  width: '100%',
  height: 190,
  borderRadius: 20,
  marginBottom: 14,
},
metricsBar: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingTop: 4,
  paddingHorizontal: 4,
},
metricItem: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
},
metricText: {
  fontFamily: 'Cairo_600SemiBold',
  fontSize: 12,
},
shareIconBtn: {
  padding: 4,
},
```

---

### ٣. كبسولة الملاحة السفلية العائمة (Floating Capsule Dock)
```tsx
<View style={[styles.dock, { backgroundColor: t.dockBg }]}>
  {/* زر الهوم النشط المتوهج */}
  <TouchableOpacity style={styles.dockItemActiveWrap}>
    <LinearGradient
      colors={[t.dockActiveGradientStart, t.dockActiveGradientEnd]}
      style={styles.dockActiveGradient}
    >
      <Ionicons name="home" size={20} color={t.dockActiveIcon} />
    </LinearGradient>
  </TouchableOpacity>

  {/* زر الفيديو */}
  <TouchableOpacity style={styles.dockItem} onPress={() => router.push('/trending')}>
    <Ionicons name="videocam-outline" size={22} color={t.textMuted} />
  </TouchableOpacity>

  {/* زر المفضلة */}
  <TouchableOpacity style={styles.dockItem}>
    <Ionicons name="bookmark-outline" size={20} color={t.textMuted} />
  </TouchableOpacity>

  {/* زر الحساب */}
  <TouchableOpacity style={styles.dockItem}>
    <Ionicons name="person-outline" size={20} color={t.textMuted} />
  </TouchableOpacity>
</View>
```

#### تنسيقات الـ Dock في StyleSheet:
```typescript
dock: {
  position: 'absolute',
  bottom: 22,
  alignSelf: 'center',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: 290,
  height: 62,
  borderRadius: 31,
  paddingHorizontal: 12,
  shadowColor: '#000',
  shadowOpacity: 0.12,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 8 },
  elevation: 8,
},
dockItem: {
  width: 44,
  height: 44,
  borderRadius: 22,
  alignItems: 'center',
  justifyContent: 'center',
},
dockItemActiveWrap: {
  width: 46,
  height: 46,
  borderRadius: 23,
  alignItems: 'center',
  justifyContent: 'center',
  shadowColor: '#10B981',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.35,
  shadowRadius: 10,
  elevation: 6,
},
dockActiveGradient: {
  width: '100%',
  height: '100%',
  borderRadius: 23,
  alignItems: 'center',
  justifyContent: 'center',
},
```

---

### ٤. شاشة تفاصيل المقال الأصلية (Native Article Screen — `app/article.tsx`)
بدلاً من الاقتصار على مجرد WebView، يتم توفير واجهة القراءة الأصلية المطابقة للجانب الأيمن من المرجع الثاني (`1000164106.jpg`):

```tsx
<View style={styles.articleRoot}>
  {/* صورة الغلاف العلوية كاملة العرض */}
  <View style={styles.heroWrap}>
    <Image source={{ uri: article.imageUrl }} style={styles.heroImage} />
    
    {/* أزرار الهيدر العائمة الشبه شفافة */}
    <SafeAreaView style={styles.heroHeader} edges={['top']}>
      <TouchableOpacity onPress={() => router.back()} style={styles.frostedBtn}>
        <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
      </TouchableOpacity>
      
      <View style={styles.heroTitleWrap}>
        <Text style={styles.heroCategoryTitle}>Popular News</Text>
        {/* Pagination Dots */}
        <View style={styles.dotsRow}>
          <View style={[styles.dot, styles.dotActive]} />
          <View style={styles.dot} />
          <View style={styles.dot} />
        </View>
      </View>

      <TouchableOpacity style={styles.frostedBtn}>
        <Ionicons name="ellipsis-vertical" size={18} color="#FFFFFF" />
      </TouchableOpacity>
    </SafeAreaView>
  </View>

  {/* اللوح السفلي المقوس المنزلق (Curved Bottom Sheet) */}
  <ScrollView
    style={[styles.bottomSheet, { backgroundColor: t.surface }]}
    contentContainerStyle={styles.bottomSheetContent}
    showsVerticalScrollIndicator={false}
  >
    {/* صف المصدر والمشاركة */}
    <View style={styles.sheetPublisherRow}>
      <View style={styles.publisherInfo}>
        <Image source={{ uri: article.sourceLogo }} style={styles.sheetAvatar} />
        <View>
          <View style={styles.nameVerifiedRow}>
            <Text style={[styles.sheetPublisherName, { color: t.textPrimary }]}>
              {article.sourceName}
            </Text>
            <Ionicons name="checkmark-circle" size={14} color={t.verified} />
          </View>
          <Text style={[styles.timestamp, { color: t.textMuted }]}>
            {relativeTime(article.publishedAt)}
          </Text>
        </View>
      </View>
      <TouchableOpacity style={styles.sheetShareBtn}>
        <Ionicons name="share-outline" size={18} color={t.textPrimary} />
      </TouchableOpacity>
    </View>

    {/* العنوان الرئيسي */}
    <Text style={[styles.sheetTitle, { color: t.textPrimary }]}>
      {article.title} 🔥
    </Text>

    {/* وقت النشر الدقيق */}
    <Text style={[styles.sheetDate, { color: t.textMuted }]}>
      10 May 2025, 01 pm
    </Text>

    {/* شريط الكاتب والتفاعل */}
    <View style={styles.metaRow}>
      <Text style={[styles.metaText, { color: t.textSecondary }]}>
        {article.author ? `بقلم ${article.author}` : 'بقلم محرري الموقع'}
      </Text>
      <Text style={[styles.metaDot, { color: t.textMuted }]}>•</Text>
      <Text style={[styles.metaText, { color: t.textSecondary }]}>{article.sourceName}</Text>
      <Text style={[styles.metaDot, { color: t.textMuted }]}>•</Text>
      <View style={styles.likeCountWrap}>
        <Ionicons name="thumbs-up" size={14} color={t.textPrimary} />
        <Text style={[styles.metaText, { color: t.textPrimary }]}>10k إعجاب</Text>
      </View>
    </View>

    {/* نص المقال والفقرات */}
    <Text style={[styles.bodyParagraph, { color: t.textSecondary }]}>
      {article.summary ?? article.content}
    </Text>

    {/* زر فتح الرابط الكامل من المصدر كخيار إضافي */}
    <TouchableOpacity
      style={[styles.openWebBtn, { borderColor: t.borderLight }]}
      onPress={() => openInBrowser(article.url)}
    >
      <Text style={[styles.openWebText, { color: t.textPrimary }]}>
        قراءة التقرير الكامل من الموقع الأصلي ↗
      </Text>
    </TouchableOpacity>
  </ScrollView>
</View>
```

#### تنسيقات القارئ الأصلي في StyleSheet:
```typescript
articleRoot: { flex: 1, backgroundColor: '#000000' },
heroWrap: { height: '46%', width: '100%', position: 'relative' },
heroImage: { width: '100%', height: '100%', resizeMode: 'cover' },
heroHeader: {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: 16,
  paddingTop: 8,
},
frostedBtn: {
  width: 40,
  height: 40,
  borderRadius: 20,
  backgroundColor: 'rgba(0, 0, 0, 0.35)',
  alignItems: 'center',
  justifyContent: 'center',
},
heroTitleWrap: { alignItems: 'center' },
heroCategoryTitle: {
  color: '#FFFFFF',
  fontFamily: 'Cairo_700Bold',
  fontSize: 16,
  textShadowColor: 'rgba(0,0,0,0.4)',
  textShadowRadius: 6,
},
dotsRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.4)' },
dotActive: { width: 14, backgroundColor: '#FFFFFF' },
bottomSheet: {
  flex: 1,
  marginTop: -30,
  borderTopLeftRadius: 36,
  borderTopRightRadius: 36,
},
bottomSheetContent: {
  padding: 22,
  paddingBottom: 60,
},
sheetPublisherRow: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 16,
},
publisherInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
sheetAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#E2E8F0' },
sheetPublisherName: { fontFamily: 'Cairo_700Bold', fontSize: 15 },
sheetShareBtn: {
  width: 38,
  height: 38,
  borderRadius: 19,
  backgroundColor: '#F1F5F9',
  alignItems: 'center',
  justifyContent: 'center',
},
sheetTitle: {
  fontFamily: 'Cairo_700Bold',
  fontSize: 21,
  lineHeight: 31,
  marginBottom: 8,
},
sheetDate: {
  fontFamily: 'Cairo_400Regular',
  fontSize: 13,
  marginBottom: 14,
},
metaRow: {
  flexDirection: 'row',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  paddingVertical: 10,
  borderTopWidth: StyleSheet.hairlineWidth,
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderColor: '#E2E8F0',
  marginBottom: 16,
},
metaText: { fontFamily: 'Cairo_600SemiBold', fontSize: 13 },
metaDot: { fontSize: 14 },
likeCountWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
bodyParagraph: {
  fontFamily: 'Cairo_400Regular',
  fontSize: 15,
  lineHeight: 27,
  marginBottom: 20,
},
openWebBtn: {
  paddingVertical: 14,
  borderRadius: 16,
  borderWidth: 1,
  alignItems: 'center',
  justifyContent: 'center',
  marginTop: 10,
},
openWebText: { fontFamily: 'Cairo_600SemiBold', fontSize: 14 },
```

---

## ٥. خطوات التنفيذ المطلوبة من مبرمج الواجهات (Action Items for Bolt)

1. **تثبيت مكتبة التدرج اللوني**:
   - تثبيت `expo-linear-gradient` داخل `apps/mobile`:
     ```bash
     pnpm --filter @news/mobile add expo-linear-gradient
     ```
2. **تحديث ملف الألوان (`apps/mobile/constants/colors.ts`)**:
   - إدخال مفاتيح التدرج (`bgGradientTop`, `bgGradientMid`, `bgGradientBottom`) وهالة الأيقونة النشطة كما وردت في القسم ٣ أعلاه.
3. **إعادة بناء الشاشة الرئيسية (`apps/mobile/app/index.tsx`)**:
   - تغليف الشاشة بـ `LinearGradient`.
   - إزالة الإطار الرمادي من الكبسولات غير النشطة وجعلها بيضاء نقية عائمة.
   - إضافة مكوّن الـ `HeroDeckStack` المتراكب المكون من 3 كروت في مقدمة الشاشة بقسم "الأكثر قراءة الآن" مع زر "عرض الكل".
   - تحويل كروت القائمة العادية إلى كروت رأسية كاملة العرض (بدلاً من الصف الأفقي المضغوط).
   - تعديل كبسولة الملاحة السفلية: تغيير أيقونة الزر الثاني إلى `videocam-outline` وتطبيق الهالة الخضراء المتوهجة على الزر الأول.
4. **تطوير شاشة تفاصيل المقال الأصلية (`apps/mobile/app/article.tsx`)**:
   - تحويل الشاشة من مجرد `WebView` خام إلى قارئ أصلي مطابقة للجانب الأيمن من المرجع (صورة علوية Edge-to-Edge، بطاقة سفلية مقوسة `borderRadius: 36`، بيانات الكاتب، الإعجابات، والنص الكامل المريح للعين).
5. **تحديث شاشة الترند / فييد الأخبار (`apps/mobile/app/trending.tsx`)**:
   - اعتماد نفس الكروت الرأسية العائمة مع رأس المصدر وشارة التوثيق والصورة العريضة وشريط التفاعل.
