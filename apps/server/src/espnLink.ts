// The link between an ESPN fixture and our own live row (issue #36).
//
// WHY A NAME TABLE INSTEAD OF AN ID
// ---------------------------------
// Production live rows come from FilGoal, which has no usable clock; ESPN has the
// real one. To borrow the clock we must be sure the ESPN event is the same fixture,
// and kickoff time alone is not enough — six Champions League matches started at
// 22:00 Cairo on the day this was written, so a time match could attach Arsenal's
// clock to Napoli's match. A wrong minute is worse than no minute.
//
// So the pairing is by CLUB NAME, using a table built from real data rather than
// from memory: for each of our eight ESPN-covered competitions, ESPN's standings
// and FilGoal's standings were compared row by row, and every row agreed on points
// AND games played (129 clubs). That pins the Arabic spelling of each club. On top
// of that, 45 days of both sources' fixture lists were intersected on
// competition + kickoff minute, keeping only the buckets with exactly one fixture,
// and each club's alternative spellings were recorded from those. Two clubs
// (Al Ahli, Al Khaleej) showed a contradictory spelling once; only spellings seen
// at least three times are kept as aliases.
//
// Measured with this table over 45 days: 204 of 204 checkable fixtures linked, 203
// to the exactly right row, 0 to a wrong row, 1 ambiguous and therefore refused.
// A fixture that does not link keeps its state and shows no minute.

/** How a club is written by the two sources. */
interface ClubNames {
  /** The Arabic name our own rows use (their league table's spelling). */
  ar: string;
  /** Other spellings FilGoal uses on its fixture list, measured from real pages. */
  seen?: string[];
}

/**
 * ESPN club name → our Arabic spelling.
 *
 * Only clubs in the eight competitions we cover, and only where ESPN publishes a
 * fixture. Anything absent is left unmatched on purpose: an unmatched club means
 * "no minute" on screen, never a guessed name.
 */
export const ESPN_CLUB_NAMES: Record<string, ClubNames> = {
  "1. FC Union Berlin": { ar: "يونيون برلين" },
  "Abha": { ar: "أبها" },
  "AC Milan": { ar: "ميلان" },
  "AEK Athens": { ar: "ايك اثينا" },
  "AFC Bournemouth": { ar: "بورنموث" },
  "AJ Auxerre": { ar: "اوكسير" },
  "Al Ahli": { ar: "أهلي جدة", seen: ["الأهلي"] },
  "Al Diriyah": { ar: "الدرعية" },
  "Al Ettifaq": { ar: "الاتفـــــاق" },
  "Al Faisaly": { ar: "الفيصلي" },
  "Al Fateh": { ar: "الفتح" },
  "Al Fayha": { ar: "الفيحاء" },
  "Al Hazem": { ar: "الحزم" },
  "Al Hilal": { ar: "الهلال" },
  "Al Ittihad": { ar: "الاتحاد" },
  "Al Khaleej": { ar: "الخليج" },
  "Al Kholood": { ar: "الخلود" },
  "Al Nassr": { ar: "النصر" },
  "Al Qadsiah": { ar: "القادسية" },
  "Al Riyadh": { ar: "الرياض" },
  "Al Shabab": { ar: "الشباب" },
  "Al Taawoun": { ar: "التعاون" },
  "Alavés": { ar: "ألافيس", seen: ["ديبورتيفو ألافيس"] },
  "Angers": { ar: "أنجيه" },
  "Arsenal": { ar: "أرسنال" },
  "AS Monaco": { ar: "موناكو" },
  "AS Roma": { ar: "روما" },
  "Aston Villa": { ar: "أستون فيلا" },
  "Atalanta": { ar: "أتالانتا" },
  "Athletic Club": { ar: "أتلتيك بلباو", seen: ["أتليتك بلباو"] },
  "Atlético Madrid": { ar: "اتلتيكو مدريد" },
  "Barcelona": { ar: "برشلونة" },
  "Bayer Leverkusen": { ar: "باير ليفركوزن" },
  "Bayern Munich": { ar: "بايرن ميونيخ" },
  "Bodo/Glimt": { ar: "جليمت" },
  "Bologna": { ar: "بولونيا" },
  "Borussia Dortmund": { ar: "بروسيا دورتموند", seen: ["بوروسيا دورتموند"] },
  "Borussia Mönchengladbach": { ar: "مونشنجلادباخ", seen: ["بوروسيا مونشنجلادباخ"] },
  "Brentford": { ar: "برينتفورد" },
  "Brest": { ar: "بريست", seen: ["ستاد بريست 29"] },
  "Brighton & Hove Albion": { ar: "برايتون" },
  "Cagliari": { ar: "كالياري" },
  "Celta Vigo": { ar: "سيلتا فيجو" },
  "Chelsea": { ar: "تشيلسي" },
  "Club Brugge": { ar: "كلوب بروج" },
  "Como": { ar: "كومو" },
  "Coventry City": { ar: "كوفنتري سيتي" },
  "Crystal Palace": { ar: "كريستال بالاس" },
  "Deportivo": { ar: "ديبورتيفو لاكورونيا" },
  "Eintracht Frankfurt": { ar: "آ. فرانكفورت", seen: ["آينتراخت فرانكفورت"] },
  "Elche": { ar: "إلتشي" },
  "Espanyol": { ar: "اسبانيول" },
  "Everton": { ar: "إيفرتون" },
  "FC Augsburg": { ar: "أوجسبورج" },
  "FC Cologne": { ar: "كولن" },
  "FC Porto": { ar: "بورتو" },
  "Fenerbahce": { ar: "فنربخشة" },
  "Feyenoord Rotterdam": { ar: "فينورد", seen: ["فيينورد"] },
  "Fiorentina": { ar: "فيورنتينا" },
  "Frosinone": { ar: "فروزينوني" },
  "Fulham": { ar: "فولهام", seen: ["فولام"] },
  "Galatasaray": { ar: "جالاتا سراي" },
  "Genoa": { ar: "جنوى" },
  "Getafe": { ar: "خيتافي" },
  "Hamburg SV": { ar: "هامبورج" },
  "Hull City": { ar: "هال سيتي" },
  "Internazionale": { ar: "إنتر ميلان", seen: ["إنتر"] },
  "Ipswich Town": { ar: "إيبسويتش تاون" },
  "Juventus": { ar: "يوفنتوس" },
  "LASK Linz": { ar: "لاسك لينز" },
  "Lazio": { ar: "لاتسيو" },
  "Le Havre AC": { ar: "لوهافر", seen: ["لو هافر"] },
  "Le Mans": { ar: "لو مان" },
  "Lecce": { ar: "ليتشي" },
  "Leeds United": { ar: "ليدز يونايتد" },
  "Lens": { ar: "لانس" },
  "Levante": { ar: "ليفانتي" },
  "Lille": { ar: "ليل" },
  "Liverpool": { ar: "ليفربول" },
  "Lorient": { ar: "لوريان" },
  "Lyon": { ar: "ليون", seen: ["أولمبيك ليون"] },
  "Mainz": { ar: "ماينز", seen: ["ماينز 05"] },
  "Málaga": { ar: "مالاجا" },
  "Manchester City": { ar: "مانشستر سيتي" },
  "Manchester United": { ar: "مانشستر يونايتد" },
  "Marseille": { ar: "مارسيليا", seen: ["أولمبيك مارسيليا"] },
  "Monza": { ar: "مونزا" },
  "Napoli": { ar: "نابولي" },
  "Neom SC": { ar: "نادي نيوم", seen: ["نيوم"] },
  "Newcastle United": { ar: "نيوكاسل", seen: ["نيوكاسل يونايتد"] },
  "Nice": { ar: "نيس" },
  "Nottingham Forest": { ar: "نوتينجهام فورست", seen: ["نوتنجهام فورست"] },
  "Osasuna": { ar: "أوساسونا" },
  "Paris FC": { ar: "باريس إف سي", seen: ["باريس"] },
  "Paris Saint-Germain": { ar: "باريس سان جيرمان" },
  "Parma": { ar: "بارما" },
  "PSV Eindhoven": { ar: "إيندهوفن" },
  "Racing Santander": { ar: "ر.سانتاندير", seen: ["راسينج سانتاندير"] },
  "Rayo Vallecano": { ar: "رايو فاييكانو", seen: ["رايو فايكانو"] },
  "RB Leipzig": { ar: "لايبزيج", seen: ["لايبزج"] },
  "Real Betis": { ar: "ريال بيتيس" },
  "Real Madrid": { ar: "ريال مدريد" },
  "Real Sociedad": { ar: "ريال سوسيداد" },
  "Sabah FK": { ar: "صباح إف كيه" },
  "Sassuolo": { ar: "ساسولو" },
  "SC Freiburg": { ar: "فرايبورج" },
  "SC Paderborn 07": { ar: "بادربورن" },
  "Schalke 04": { ar: "شالكه" },
  "Sevilla": { ar: "اشبيلية" },
  "Shakhtar Donetsk": { ar: "شاختار دونيتسك" },
  "Slavia Prague": { ar: "سلافيا براج" },
  "Slovan Bratislava": { ar: "سلوفان براتيسلافا" },
  "Sporting CP": { ar: "سبورتنج لشبونة" },
  "Stade Rennais": { ar: "رين", seen: ["ستاد رين"] },
  "Strasbourg": { ar: "ستراسبورج" },
  "Sunderland": { ar: "سندرلاند" },
  "SV Elversberg": { ar: "إس في إلفيرسبيرج", seen: ["إلفيرسبيرج"] },
  "Torino": { ar: "تورينو" },
  "Tottenham Hotspur": { ar: "توتنهام هوتسبر", seen: ["توتنام هوتسبر"] },
  "Toulouse": { ar: "تولوز" },
  "Troyes": { ar: "تروا" },
  "TSG Hoffenheim": { ar: "هوفنهايم" },
  "Udinese": { ar: "أودينيزي" },
  "Valencia": { ar: "فالنسيا" },
  "Venezia": { ar: "فينيزيا", seen: ["فينيسيا"] },
  "VfB Stuttgart": { ar: "شتوتجارت" },
  "Viking FK": { ar: "نادى فيكينج" },
  "Villarreal": { ar: "فياريال" },
  "Werder Bremen": { ar: "فيردر بريمن" },
};

/** Fold a club name to a comparable key (same rules as the news matcher). */
export function clubKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every Arabic spelling a club is known to use, folded.
 *
 * Built once from the table above, so a lookup does not walk the table per fixture.
 */
const CLUB_BY_KEY: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [en, names] of Object.entries(ESPN_CLUB_NAMES)) {
    for (const spelling of [names.ar, ...(names.seen ?? [])]) {
      const key = clubKey(spelling);
      // First writer wins. Two different English clubs folding to one Arabic key
      // would be a table error, not something to paper over at runtime.
      if (!map.has(key)) map.set(key, en);
    }
  }
  return map;
})();

/** The ESPN club name for one Arabic spelling, or null when it is not a club we map. */
export function espnNameOf(club: string): string | null {
  return CLUB_BY_KEY.get(clubKey(club)) ?? null;
}

/**
 * The Arabic name an ESPN club is written as in our rows.
 *
 * Returns null for a club outside the table: the caller then treats the fixture as
 * unmatched, which means "no minute" rather than a wrong pairing.
 */
export function arabicNameOf(espnName: string): string | null {
  return ESPN_CLUB_NAMES[espnName]?.ar ?? null;
}

/**
 * Is this ESPN event the same fixture as the two clubs we hold?
 *
 * Our side is Arabic and ESPN's is Latin, so both of our names are resolved to
 * their ESPN club first; a name outside the table refuses the link outright rather
 * than falling back to a fuzzy comparison. Both sides must agree, and they may be
 * the other way round — FilGoal and ESPN disagree about home/away for some
 * fixtures, which is harmless because the club PAIR is what identifies a match.
 */
export function sameClubs(
  espnHome: string,
  espnAway: string,
  ourHome: string,
  ourAway: string,
): boolean {
  const ourHomeEn = espnNameOf(ourHome);
  const ourAwayEn = espnNameOf(ourAway);
  if (!ourHomeEn || !ourAwayEn) return false;
  return (
    (ourHomeEn === espnHome && ourAwayEn === espnAway) ||
    (ourHomeEn === espnAway && ourAwayEn === espnHome)
  );
}
