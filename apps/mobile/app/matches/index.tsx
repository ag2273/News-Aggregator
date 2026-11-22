import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { palette } from '../../constants/colors';
import type { Theme } from '../../constants/colors';
import { useAuth } from '../../lib/auth';
import { AccountGateSheet, useAccountGate } from '../../components/AccountGate';
import {
  fetchMatches,
  followLeague,
  isNetworkFailure,
  unfollowLeague,
  type FootballCompetition,
  type FootballMatch,
  type MatchesDay,
} from '../../lib/api';
import { cairoDay, ribbonLabel } from '../../lib/dates';

type Filter = 'all' | 'live' | 'followed' | 'finished' | 'upcoming';

/**
 * Group order, as served.
 *
 * The server already sorts a day by competition priority (Egypt first) and each
 * match carries its competition's priority, so this only has to read that field.
 * The name-based fallback is for a match whose competition we do not know.
 */
function rankOf(m: FootballMatch): number {
  if (typeof m.competitionPriority === 'number') return m.competitionPriority;
  if (/المصري/.test(m.competitionName)) return 10;
  if (/كأس مصر/.test(m.competitionName)) return 15;
  if (/الإيطالي|الإسباني|الإنجليزي/.test(m.competitionName)) return 20;
  if (/أفريقيا|أوروبا/.test(m.competitionName)) return 30;
  return 50;
}

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'الكل' },
  { id: 'live', label: 'مباشر' },
  { id: 'followed', label: 'الفرق المتابعة' },
  { id: 'finished', label: 'انتهت' },
  { id: 'upcoming', label: 'القادمة' },
];

/**
 * جدول المباريات.
 *
 * Every section can be empty independently: the day may have no Egyptian
 * fixtures, no live match and no followed team. Each states that plainly rather
 * than rendering a blank area that looks broken.
 */
export default function MatchesScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { token } = useAuth();
  const gate = useAccountGate();
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [day, setDay] = useState<MatchesDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const date = cairoDay(offset);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDay(await fetchMatches(date, token));
    } catch (err) {
      setError(isNetworkFailure(err) ? 'تعذّر الاتصال. حاول مرة أخرى.' : 'تعذّر تحميل المباريات.');
    } finally {
      setLoading(false);
    }
  }, [date, token]);

  useEffect(() => {
    load();
  }, [load]);

  const followed = useMemo(() => new Set(day?.followedTeams ?? []), [day]);
  const followedLeagues = useMemo(() => new Set(day?.followedLeagues ?? []), [day]);
  const matches = day?.matches ?? [];

  /**
   * Is this match one the reader chose to follow?
   *
   * Either club, or the whole competition. A league follow is why a reader follows
   * «الدوري المصري» in the first place: every Egyptian fixture today, not one club.
   */
  const isFavourite = useCallback(
    (m: FootballMatch): boolean =>
      followed.has(m.home) || followed.has(m.away) || followedLeagues.has(m.competitionId),
    [followed, followedLeagues],
  );

  const visible = useMemo(() => {
    switch (filter) {
      case 'live':
        return matches.filter((m) => m.status === 'live');
      case 'finished':
        return matches.filter((m) => m.status === 'finished');
      case 'upcoming':
        return matches.filter((m) => m.status === 'upcoming');
      case 'followed':
        return matches.filter(isFavourite);
      default:
        return matches;
    }
  }, [matches, filter, isFavourite]);

  const pinned = visible.filter(isFavourite);
  const liveNow = visible.filter((m) => m.status === 'live' && !pinned.includes(m));
  const rest = visible.filter((m) => !pinned.includes(m) && !liveNow.includes(m));
  /**
   * Groups in the order the spec ranks them: Egyptian league first, then Africa,
   * then Europe, then the rest.
   *
   * They used to come out in whatever order the API returned, so the Egyptian
   * league sat below seven European groups on a busy day — the user's «فين الدوري
   * المصري؟». Ordering here means it is always the first heading on the screen.
   */
  /**
   * Competitions we cover that have no match on this day.
   *
   * Computed from the served competition list, so a league that is simply not
   * playing today still gets its heading instead of vanishing.
   */
  const emptyGroups = useMemo<FootballCompetition[]>(() => {
    if (!day?.competitions?.length) return [];
    const names = new Set(matches.map((m) => m.competitionName));
    return day.competitions.filter((c) => !names.has(c.nameAr));
  }, [day, matches]);

  /**
   * Groups, including the competitions with nothing on this day.
   *
   * A league with no fixture used to disappear, which is why the Egyptian league
   * could not be found at all on a quiet day. Every competition we cover is now a
   * group, with the honest line «لا توجد مباريات لهذا الدوري اليوم» when it has
   * none. The empty groups only show under the «الكل» filter: a reader filtering
   * for live or finished matches does not want ten empty headings.
   */
  const groups = useMemo(() => {
    const map = new Map<string, FootballMatch[]>();
    for (const m of rest) {
      const key = m.competitionName || 'بطولات أخرى';
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    const present = [...map.entries()].sort(
      (a, b) => rankOf(a[1][0]!) - rankOf(b[1][0]!) || a[0].localeCompare(b[0], 'ar'),
    );
    if (filter !== 'all' || emptyGroups.length === 0) return present;
    // Insert each empty competition at its priority position.
    const all: Array<{ name: string; rows: FootballMatch[]; rank: number }> = [
      ...present.map(([name, rows]) => ({ name, rows, rank: rankOf(rows[0]!) })),
      ...emptyGroups.map((c) => ({ name: c.nameAr, rows: [], rank: c.priority ?? 99 })),
    ];
    all.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'ar'));
    return all.map((g) => [g.name, g.rows] as [string, FootballMatch[]]);
  }, [rest, filter, emptyGroups]);

  /**
   * Follow or unfollow a league from its group header.
   *
   * The group is identified by its display name, so the id comes from the served
   * competition list rather than being re-derived from the name.
   */
  const toggleLeagueByName = useCallback(
    async (name: string) => {
      const comp = day?.competitions?.find((c) => c.nameAr === name);
      if (!comp) return;
      if (!token) {
        gate.open();
        return;
      }
      try {
        const isOn = followedLeagues.has(comp.id);
        const next = isOn
          ? await unfollowLeague(token, comp.id)
          : await followLeague(token, comp.id);
        setDay((d) => (d ? { ...d, followedLeagues: next.map((l) => l.competitionId) } : d));
      } catch {
        /* the star simply does not change */
      }
    },
    [day, token, followedLeagues, gate],
  );

  /** A competition the reader follows, so its heading can say so. */
  const leagueFollowed = (name: string): boolean => {
    const group = groups.find(([n]) => n === name)?.[1];
    return Boolean(group?.[0] && followedLeagues.has(group[0].competitionId));
  };

  const liveCount = matches.filter((m) => m.status === 'live').length;
  const followedCount = matches.filter(isFavourite).length;

  const card = (m: FootballMatch) => {
    const isLive = m.status === 'live';
    return (
      <TouchableOpacity
        key={m.id}
        style={[
          styles.card,
          { backgroundColor: t.surface, borderColor: isLive ? t.accent : t.borderLight },
        ]}
        onPress={() =>
          router.push({ pathname: '/matches/[id]', params: { id: m.id, date } })
        }
        accessibilityRole="button"
        accessibilityLabel={`${m.home} ضد ${m.away}`}
      >
        <View style={styles.cardTop}>
          <Text style={[styles.team, { color: t.textPrimary }]} numberOfLines={2} ellipsizeMode="tail">
            {m.home}
          </Text>
          <View style={styles.scoreWrap}>
            {m.homeScore === null || m.awayScore === null ? (
              <Text style={[styles.kickoff, { color: t.textSecondary }]}>{m.kickoff ?? '—'}</Text>
            ) : (
              <Text style={[styles.score, { color: isLive ? t.accent : t.textPrimary }]}>
                {m.homeScore} - {m.awayScore}
              </Text>
            )}
            <Text style={[styles.status, { color: isLive ? t.accent : t.textMuted }]}>
              {isLive && m.minute ? `${m.minute}'` : m.statusText}
            </Text>
          </View>
          <Text style={[styles.team, { color: t.textPrimary }]} numberOfLines={2} ellipsizeMode="tail">
            {m.away}
          </Text>
        </View>
        {isLive ? (
          <View style={styles.liveDotRow}>
            <View style={[styles.liveDot, { backgroundColor: t.accent }]} />
            <Text style={[styles.liveText, { color: t.accent }]}>مباشر</Text>
          </View>
        ) : null}
        {/* Round and channel are different facts and are labelled as such. The
            old line joined them with a dot, so a card read «الجولة الثانية ·
            الكأس 9» and looked like a garbled round name. The channel name
            («الكأس 9») is a broadcaster, not a stadium or a round. */}
        {m.round ? (
          <Text style={[styles.round, { color: t.textMuted }]} numberOfLines={1}>
            {m.round}
          </Text>
        ) : null}
        {m.channel ? (
          <Text style={[styles.round, { color: t.textMuted }]} numberOfLines={1}>
            {`تُنقل على ${m.channel}`}
          </Text>
        ) : null}
        {isFavourite(m) ? (
          <Ionicons name="star" size={12} color={t.accent} style={styles.star} />
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <LinearGradient colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="رجوع">
            <Ionicons name="chevron-forward" size={22} color={t.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: t.textPrimary }]}>مباريات اليوم</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={() => router.push('/matches/upcoming')} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="المباريات القادمة ومواعيد البث">
              <Ionicons name="calendar-outline" size={19} color={t.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/matches/follow-teams')} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="الفرق المتابعة">
              <Ionicons name="star-outline" size={20} color={t.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Date ribbon: seven days, today highlighted. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.strip}
          contentContainerStyle={styles.ribbon}
        >
          {[-3, -2, -1, 0, 1, 2, 3].map((off) => (
            <TouchableOpacity
              key={off}
              onPress={() => setOffset(off)}
              style={[
                styles.ribbonItem,
                { backgroundColor: off === offset ? t.accent : t.pillInactiveBg },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: off === offset }}
            >
              <Text style={[styles.ribbonText, { color: off === offset ? '#FFFFFF' : t.textSecondary }]}>
                {ribbonLabel(off, cairoDay(off))}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Status filters with live counts. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.strip}
          contentContainerStyle={styles.filters}
        >
          {FILTERS.map((f) => {
            const count =
              f.id === 'live' ? liveCount : f.id === 'followed' ? followedCount : 0;
            const label = count ? `${f.label} (${count})` : f.label;
            return (
              <TouchableOpacity
                key={f.id}
                onPress={() => setFilter(f.id)}
                style={[styles.filterPill, { backgroundColor: f.id === filter ? t.pillActiveBg : t.pillInactiveBg }]}
                accessibilityRole="button"
                accessibilityState={{ selected: f.id === filter }}
              >
                <Text style={[styles.filterText, { color: f.id === filter ? t.pillActiveText : t.pillInactiveText }]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {loading ? (
          <View style={styles.stateWrap}>
            <ActivityIndicator color={t.accent} />
          </View>
        ) : error ? (
          /* Every non-list state is a scroller with a growing content area, so it
             stays centered on a tall screen, scrolls on a short one (keyboard,
             large font), and never collapses into the header above it. */
          <ScrollView contentContainerStyle={styles.stateScroll}>
            <Ionicons name="cloud-offline-outline" size={30} color={t.textMuted} />
            <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>{error}</Text>
            <TouchableOpacity style={[styles.retry, { borderColor: t.accent }]} onPress={load} accessibilityRole="button">
              <Text style={{ color: t.accent }}>إعادة المحاولة</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : day?.unavailable ? (
          <ScrollView contentContainerStyle={styles.stateScroll}>
            <Ionicons name="time-outline" size={30} color={t.textMuted} />
            <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>البيانات غير متاحة حاليًا</Text>
            <Text style={[styles.emptyBody, { color: t.textMuted }]}>مصدر النتائج لم يستجب لهذا اليوم. جرّب يومًا آخر أو أعد المحاولة بعد قليل.</Text>
            <TouchableOpacity style={[styles.retry, { borderColor: t.accent }]} onPress={load} accessibilityRole="button">
              <Text style={{ color: t.accent }}>إعادة المحاولة</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : visible.length === 0 ? (
          <ScrollView contentContainerStyle={styles.stateScroll}>
            <Ionicons name="football-outline" size={34} color={t.textMuted} />
            <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>
              {filter === 'all'
                ? 'لا توجد مباريات مجدولة اليوم في بطولاتك المفضلة'
                : filter === 'followed'
                  ? 'لا توجد مباريات لفرقك المفضلة اليوم'
                  : filter === 'live'
                    ? 'لا توجد مباريات مباشرة الآن'
                    : filter === 'finished'
                      ? 'لم تنتهِ أي مباراة اليوم بعد'
                      : 'لا توجد مباريات قادمة اليوم'}
            </Text>
            {filter === 'all' ? (
              <TouchableOpacity style={[styles.retry, { borderColor: t.accent }]} onPress={() => setOffset(1)} accessibilityRole="button">
                <Text style={{ color: t.accent }}>استعراض مباريات الغد</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.retry, { borderColor: t.accent }]} onPress={() => setFilter('all')} accessibilityRole="button">
                <Text style={{ color: t.accent }}>عرض كل المباريات</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {pinned.length ? (
              <>
                <Text style={[styles.section, { color: t.textMuted }]}>مباريات فرقي المفضلة</Text>
                {pinned.map(card)}
              </>
            ) : null}
            {liveNow.length ? (
              <>
                <Text style={[styles.section, { color: t.accent }]}>مباشر الآن</Text>
                {liveNow.map(card)}
              </>
            ) : null}
            {groups.map(([name, rows]) => {
              const followedThis = leagueFollowed(name);
              return (
                <View key={name}>
                  <View style={styles.groupHeaderRow}>
                    <TouchableOpacity
                      style={styles.groupHeaderTap}
                      onPress={() => setCollapsed((c) => ({ ...c, [name]: !c[name] }))}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: !collapsed[name] }}
                    >
                      <Ionicons
                        name={collapsed[name] ? 'chevron-back' : 'chevron-down'}
                        size={16}
                        color={t.textMuted}
                      />
                      <Text
                        style={[styles.groupTitle, { color: followedThis ? t.accent : t.textSecondary }]}
                        numberOfLines={1}
                      >
                        {name}
                      </Text>
                    </TouchableOpacity>
                    {/* Follow the league from the group itself: this is where a
                        reader is when they decide they care about it. */}
                    <TouchableOpacity
                      onPress={() => toggleLeagueByName(name)}
                      style={styles.groupFollow}
                      accessibilityRole="button"
                      accessibilityLabel={
                        followedThis ? `إلغاء متابعة ${name}` : `متابعة ${name}`
                      }
                    >
                      <Ionicons
                        name={followedThis ? 'star' : 'star-outline'}
                        size={16}
                        color={followedThis ? t.accent : t.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
                  {collapsed[name] ? null : rows.length === 0 ? (
                    <Text style={[styles.groupEmpty, { color: t.textMuted }]}>
                      لا توجد مباريات لهذا الدوري اليوم
                    </Text>
                  ) : (
                    rows.map(card)
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}
        <AccountGateSheet t={t} gate={gate} message="عشان تتابع البطولة" />
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 4 },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 19, fontWeight: '700' },
  // A horizontal strip must have its own height. Without it, a ScrollView inside
  // a column flex container either swallows the leftover space (RN-web stretched
  // the day ribbon to 300px) or collapses to nothing (the filter row vanished).
  strip: { flexGrow: 0, flexShrink: 0 },
  ribbon: { paddingHorizontal: 12, gap: 8, paddingVertical: 10 },
  ribbonItem: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  ribbonText: { fontSize: 12, fontWeight: '600' },
  filters: { paddingHorizontal: 12, gap: 8, paddingBottom: 8 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 15 },
  filterText: { fontSize: 12, fontWeight: '600' },
  list: { padding: 12, gap: 8, paddingBottom: 40 },
  section: { fontSize: 12, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  groupHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  groupHeaderTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  groupFollow: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  groupEmpty: { fontSize: 12, paddingVertical: 10, paddingHorizontal: 6 },
  groupTitle: { fontSize: 13, fontWeight: '700' },
  card: { borderRadius: 18, padding: 12, borderWidth: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  // `flexShrink` plus a smaller base size keeps a long club name («رويال يونيون
  // سان جيلواز») from being cut mid-glyph on a 360dp phone; the ellipsis is the
  // last resort, not the first thing that happens.
  // Two lines, so «رويال يونيون سان جيلواز» fits on a 360dp phone instead of
  // ending in an ellipsis at 113px. Long names are the norm in Arabic coverage.
  team: { flex: 1, flexShrink: 1, fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 19 },
  scoreWrap: { alignItems: 'center', width: 68 },
  score: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  kickoff: { fontSize: 14, fontWeight: '700' },
  status: { fontSize: 10, marginTop: 2 },
  round: { fontSize: 10, marginTop: 6, textAlign: 'center' },
  liveDotRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, justifyContent: 'center' },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 10, fontWeight: '700' },
  star: { position: 'absolute', top: 8, insetInlineStart: 8 },
  // The empty and error states sit in a scrollable container with a generous
  // minimum height, so they stay centered on a phone and never clip at large
  // font sizes. `flex:1` on a child of a padded SafeAreaView is what collapsed
  // the layout; contentContainerStyle owns the centering instead.
  stateScroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 28,
    paddingVertical: 36,
  },
  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // A fixed line height on a variable number of lines is what clipped a sentence
  // at large system fonts. These let the text grow and wrap instead.
  emptyTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center', flexShrink: 1, lineHeight: 24 },
  emptyBody: { fontSize: 12, textAlign: 'center', flexShrink: 1, lineHeight: 20 },
  retry: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 14, borderWidth: 1 },
});
