# قائمة مصادر عربية لمجمّع الأخبار

تاريخ الفحص: 2026 (اختبار حي لروابط RSS).

## طريقة الجلب
- **RSS مباشر** (شغال ومجرّب): المصدر ينشر فييد XML جاهز.
- **Google News RSS** (شغال ومجرّب): لأي مصدر مالهوش RSS مباشر أو بيحجب السيرفرات.
  النمط: `https://news.google.com/rss/search?q=site:DOMAIN&hl=ar&gl=EG&ceid=EG:ar`
  (مجرّب على alarabiya.net، aawsat.com، okaz.com.sa، ahram.org.eg، kooora.com — كلها رجّعت فييد صالح).
- ملاحظة: بعض المواقع بتحجب طلبات السيرفرات (curl) بترجع 403/مهلة؛ Google News RSS هو الحل البديل ليها.

## قنوات إخبارية (RSS مباشر ✅)
- الجزيرة عربي — https://www.aljazeera.net/aljazeerarss
- الجزيرة إنجليزي — https://www.aljazeera.com/xml/rss/all.xml
- BBC عربي — https://feeds.bbci.co.uk/arabic/rss.xml
- CNN عربي — https://arabic.cnn.com/rss
- فرانس 24 عربي — https://www.france24.com/ar/rss
- DW عربي — https://rss.dw.com/rdf/rss-ar-all
- الحرة — https://www.alhurra.com/rss
- سكاي نيوز عربية — https://www.skynewsarabia.com/rss
- RT عربي — https://www.rtarabic.com/rss

## قنوات/مواقع تلفزيونية (Google News RSS)
- العربية (alarabiya.net) — site:alarabiya.net
- الحدث (alhadath.net)
- يورونيوز عربي (arabic.euronews.com)
- الجزيرة مباشر، العربية الحدث

## صحف سعودية
RSS مباشر: —
Google News RSS (site:):
- الشرق الأوسط aawsat.com
- عكاظ okaz.com.sa
- الرياض alriyadh.com
- المدينة al-madina.com
- الوطن السعودية alwatan.com.sa
- سبق sabq.org
- اليوم al-yaum / alyaum.com
- الاقتصادية aleqt.com

## صحف مصرية
RSS مباشر ✅: اليوم السابع — https://www.youm7.com/rss/SectionRss?SectionID=1
Google News RSS (site:):
- الأهرام ahram.org.eg
- المصري اليوم almasryalyoum.com
- الوطن المصرية elwatannews.com
- الشروق shorouknews.com
- الدستور dostor.org
- فيتو vetogate.com
- مصراوي masrawy.com

## صحف خليجية (Google News RSS)
- الإمارات اليوم emaratalyoum.com
- البيان albayan.ae
- الخليج alkhaleej.ae
- الاتحاد alittihad.ae
- القبس (كويت) alqabas.com
- الرأي (كويت) alraimedia.com
- الأنباء (كويت) alanba.com.kw
- الجريدة (كويت) aljarida.com
- الأيام (بحرين) alayam.com
- العرب (قطر) alarab.qa

## مواقع إقليمية / مستقلة
RSS مباشر ✅: النهار (لبنان) — https://www.annahar.com/rss
Google News RSS (site:):
- العربي الجديد alaraby.co.uk
- القدس العربي alquds.co.uk
- عربي21 arabi21.com
- الميادين almayadeen.net
- المنار almanar.com.lb
- الأخبار (لبنان) al-akhbar.com

## مجلات / لايف ستايل (Google News RSS)
- سيدتي sayidaty.net
- هي hiamag.com
- لها lahamag.com
- ليالينا layalina.com
- البوابة albawaba.com

## رياضة (Google News RSS)
- كووورة kooora.com
- في الجول filgoal.com
- جول عربي goal.com/ar

## اقتصاد / أعمال (Google News RSS)
- أرقام argaam.com
- مباشر mubasher.info
- CNBC عربية cnbcarabia.com

## تقنية
RSS مباشر ✅:
- البوابة العربية للأخبار التقنية — https://aitnews.com/feed
- التقنية بلا حدود — https://www.unlimit-tech.com/feed
Google News RSS: عالم التقنية tech-wd.com

## سوشيال ميديا
- يوتيوب ✅ مجاني: RSS لكل قناة — `https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID` (مجرّب شغال)
- تويتر/X ❌: الـ API مدفوع (~$100+/شهر)؛ بديل Nitter غير مستقر. مش مضمون.
- فيسبوك ❌: مفيش RSS أو API مفتوح لأخبار الصفحات.
- إنستجرام ❌: مفيش API مفتوح.
- تيليجرام ⚠️: مفيش RSS رسمي؛ ممكن عبر بوتات/بدائل غير رسمية.

## خلاصة
- المصادر المباشرة (RSS خام): ~12 مصدر مجرّب شغال.
- الباقي (كل الصحف والمجلات والرياضة والاقتصاد): Google News RSS بـ site: — مجاني وشرعي ويغطي الكل.
- سوشيال ميديا: يوتيوب بس هو المجاني المضمون؛ تويتر محتاج API مدفوع، فيسبوك/إنستجرام مش متاحين.
