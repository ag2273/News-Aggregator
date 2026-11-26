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
import {
  MATCHES_FETCH_DEADLINE_MS,
  classifyFailure,
  failureMessage,
  withDeadline,
} from '../../lib/matchesState';
import { LeagueStrip, MatchCard, matchCountLabel } from '../../components/FootballCard';

type Filter = 'all' | 'live' | 'followed' | 'finished' | 'upcoming';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'الكل' },
  { id: 'live', label: 'مباشر' },
  { id: 'followed', label: 'فرقي' },
  { id: 'finished', label: 'انتهت' },
  { id: 'upcoming', label: 'القادمة' },
];

/** A group: a competition name, its served rank and country, and its rows. */
interface Group {
  key: string;
  name: string;
  country?: string;
  competitionId?: string;
  rank: number;
  rows: FootballMatch[];
}

/**
 * Server rank first, then the name-based fallback for a row whose competition we
 * do not recognise (Yallakora groups its extra leagues under «other»).
 */
function rankOf(m: FootballMatch): number {
  if (typeof m.competitionPriority === 'number') return m.competitionPriority;
  if (/المصري/.test(m.competitionName)) return 10;
  if (/كأس مصر/.test(m.competitionName)) return 15;
  if (/الإيطالي|الإسباني|الإنجليزي/.test(m.competitionName)) return 20;
  if (/أفريقيا|أوروبا/.test(m.competitionName)) return 30;
  return 50;
}

/**
 * جدول المباريات.
 *
 * Rebuilt to the approved design: ONE merged row holding the live toggle and the
 * day ribbon (it was two rows and ate a quarter of the screen), the followed
 * teams pinned above the leagues, then a league strip per competition.
 *
 * Every section can be empty independently, and each states that plainly rather
 * than rendering a blank area that looks broken.
 */
export default function MatchesScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { token } = useAuth();
  const gate = useAccountGate();
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const date = cairoDay(offset);
  // Network-first, as before #59. The device cache was rolled back by user decision:
  // "the situation before it was better". What stays is the deadline, so the spinner
  // still always ends with a sentence instead of hanging.
  const [day, setDay] = useState<MatchesDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Shown while a slow attempt is still in flight after the deadline passed. */
  const [slowNotice, setSlowNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSlowNotice(null);
    try {
      setDay(await withDeadline(fetchMatches(date, token), MATCHES_FETCH_DEADLINE_MS));
    } catch (err) {
      const kind = classifyFailure(err, isNetworkFailure);
      setError(failureMessage(kind));
    } finally {
      setLoading(false);
    }
  }, [date, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const followed = useMemo(() => new Set(day?.followedTeams ?? []), [day]);
  const followedLeagues = useMemo(() => new Set(day?.followedLeagues ?? []), [day]);
  const matches = day?.matches ?? [];

  /** Either club, or the whole competition: a league follow pins every fixture. */
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
  // Live matches that are NOT already pinned. A pinned live match belongs in the
  // favourites strip; printing it twice on one screen is the duplication the user
  // photographed on the old cards.
  const liveNow = visible.filter((m) => m.status === 'live' && !pinned.includes(m));
  const rest = visible.filter((m) => !pinned.includes(m) && !liveNow.includes(m));

  /** Competitions with no fixture today, so their heading never disappears. */
  const emptyGroups = useMemo<FootballCompetition[]>(() => {
    if (!day?.competitions?.length) return [];
    const names = new Set(matches.map((m) => m.competitionName));
    return day.competitions.filter((c) => !names.has(c.nameAr));
  }, [day, matches]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, FootballMatch[]>();
    for (const m of rest) {
      const key = m.competitionName || 'بطولات أخرى';
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    // «other» is Yallakora's bucket for a competition we do not follow, so each of
    // its names is still its own group — never merged into one «بطولات أخرى» pile.
    const present: Group[] = [...map.entries()].map(([name, rows]) => {
      const comp = day?.competitions?.find((c) => c.nameAr === name);
      return {
        key: comp?.id ?? name,
        name,
        country: comp?.country,
        competitionId: comp?.id ?? rows[0]?.competitionId,
        rank: rankOf(rows[0]!),
        rows,
      };
    });
    if (filter !== 'all') {
      return present.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'ar'));
    }
    const withEmpty: Group[] = emptyGroups.map((c) => ({
      key: c.id,
      name: c.nameAr,
      country: c.country,
      competitionId: c.id,
      rank: c.priority ?? 99,
      rows: [],
    }));
    return [...present, ...withEmpty].sort(
      (a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'ar'),
    );
  }, [rest, filter, emptyGroups, day]);

  const toggleLeague = useCallback(
    async (competitionId: string | undefined) => {
      if (!competitionId) return;
      if (!token) {
        gate.open();
        return;
      }
      try {
        const isOn = followedLeagues.has(competitionId);
        const next = isOn
          ? await unfollowLeague(token, competitionId)
          : await followLeague(token, competitionId);
        setDay((d) => (d ? { ...d, followedLeagues: next.map((l) => l.competitionId) } : d));
      } catch {
        /* the star simply does not change */
      }
    },
    [token, followedLeagues, gate],
  );

  const openTeam = useCallback((name: string) => {
    router.push({ pathname: '/team/[name]', params: { name } });
  }, []);

  const card = (m: FootballMatch) => (
    <MatchCard
      key={m.id}
      t={t}
      m={m}
      favourite={isFavourite(m)}
      onPress={() => router.push({ pathname: '/matches/[id]', params: { id: m.id, date } })}
      onPressTeam={openTeam}
    />
  );

  const liveCount = matches.filter((m) => m.status === 'live').length;
  const followedCount = matches.filter(isFavourite).length;

  return (
    <LinearGradient colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.headerBtn, { backgroundColor: t.badgePlate, borderColor: t.borderLight }]}
            accessibilityRole="button"
            accessibilityLabel="رجوع"
          >
            <Ionicons name="chevron-forward" size={20} color={t.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: t.textPrimary }]} numberOfLines={1}>
            مباريات اليوم
          </Text>
          <View style={styles.headerActions}>
            {/* The preview's «⚙️ تخصيص» entry: the way into the reorder sheet (#26). */}
            <TouchableOpacity
              onPress={() => router.push('/matches/competition-order')}
              style={[styles.headerBtn, { backgroundColor: t.badgePlate, borderColor: t.borderLight }]}
              accessibilityRole="button"
              accessibilityLabel="تخصيص ترتيب البطولات"
            >
              <Ionicons name="options-outline" size={17} color={t.accent} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/matches/standings')}
              style={[styles.headerBtn, { backgroundColor: t.badgePlate, borderColor: t.borderLight }]}
              accessibilityRole="button"
              accessibilityLabel="جداول الترتيب"
            >
              <Ionicons name="stats-chart" size={17} color={t.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/matches/follow-teams')}
              style={[styles.headerBtn, { backgroundColor: t.badgePlate, borderColor: t.borderLight }]}
              accessibilityRole="button"
              accessibilityLabel="الفرق المتابعة"
            >
              <Ionicons name="star-outline" size={17} color={t.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ONE merged filter row: the live toggle, then the day ribbon. It used to
            be two rows, which took a quarter of a 360dp screen before any match. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.strip}
          contentContainerStyle={styles.mergedRow}
        >
          <TouchableOpacity
            onPress={() => setFilter(filter === 'live' ? 'all' : 'live')}
            style={[
              styles.liveToggle,
              {
                backgroundColor: filter === 'live' ? t.liveRedBorder : t.liveRedBg,
                borderColor: t.liveRedBorder,
              },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === 'live' }}
            accessibilityLabel="مباشر فقط"
          >
            <View style={[styles.liveDot, { backgroundColor: t.liveRed }]} />
            <Text style={[styles.liveToggleText, { color: t.liveRed }]}>
              {liveCount ? `مباشر (${liveCount})` : 'مباشر'}
            </Text>
          </TouchableOpacity>
          <View style={[styles.divider, { backgroundColor: t.borderLight }]} />
          {[-3, -2, -1, 0, 1, 2, 3].map((off) => (
            <TouchableOpacity
              key={off}
              onPress={() => setOffset(off)}
              style={[
                styles.dateChip,
                off === offset
                  ? { backgroundColor: t.surfaceElevated, borderColor: t.borderLight, borderWidth: 1 }
                  : null,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: off === offset }}
            >
              <Text
                style={[
                  styles.dateChipText,
                  { color: off === offset ? t.textPrimary : t.textMuted },
                ]}
              >
                {ribbonLabel(off, cairoDay(off))}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Status filters, one line, no counts competing with the live toggle. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.strip}
          contentContainerStyle={styles.filters}
        >
          {FILTERS.map((f) => {
            const label =
              f.id === 'followed' && followedCount
                ? `${f.label} (${followedCount})`
                : f.label;
            return (
              <TouchableOpacity
                key={f.id}
                onPress={() => setFilter(f.id)}
                style={[
                  styles.filterPill,
                  {
                    backgroundColor: f.id === filter ? t.pillActiveBg : 'transparent',
                    borderColor: f.id === filter ? t.pillActiveBg : t.borderLight,
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: f.id === filter }}
              >
                <Text
                  style={[
                    styles.filterText,
                    { color: f.id === filter ? t.pillActiveText : t.textSecondary },
                  ]}
                >
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
        ) : slowNotice ? (
          <View style={[styles.updateBar, { borderBottomColor: t.borderLight }]}>
            <ActivityIndicator size="small" color={t.accent} />
            <Text style={[styles.updateText, { color: t.textSecondary }]}>{slowNotice}</Text>
          </View>
        ) : null}

        {loading ? null : error ? (
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
            <Text style={[styles.emptyBody, { color: t.textMuted }]}>
              مصدر النتائج لم يستجب لهذا اليوم. جرّب يومًا آخر أو أعد المحاولة بعد قليل.
            </Text>
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
                {/* «فرقك» whether one club or five: the strip is the reader's
                    followed fixtures, and the count is already on the filter. */}
                <Text style={[styles.section, { color: t.accent }]}>
                  ⭐ مباريات فرقك المتابعة
                </Text>
                {pinned.map(card)}
              </>
            ) : null}
            {liveNow.length ? (
              <>
                <Text style={[styles.section, { color: t.liveRed }]}>مباشر الآن</Text>
                {liveNow.map(card)}
              </>
            ) : null}
            {groups.map((g) => (
              <View key={g.key}>
                <LeagueStrip
                  t={t}
                  name={g.name}
                  country={g.country}
                  rows={g.rows}
                  followed={Boolean(g.competitionId && followedLeagues.has(g.competitionId))}
                  collapsed={Boolean(collapsed[g.name])}
                  onToggleCollapse={() => setCollapsed((c) => ({ ...c, [g.name]: !c[g.name] }))}
                  onToggleFollow={() => toggleLeague(g.competitionId)}
                  onOpen={
                    g.competitionId && g.competitionId !== 'other'
                      ? () =>
                          router.push({
                            pathname: '/competition/[id]',
                            params: { id: g.competitionId! },
                          })
                      : undefined
                  }
                />
                {collapsed[g.name] ? null : g.rows.length === 0 ? (
                  <Text style={[styles.groupEmpty, { color: t.textMuted }]}>
                    لا توجد مباريات لهذا الدوري اليوم
                  </Text>
                ) : (
                  g.rows.map(card)
                )}
              </View>
            ))}
            {visible.length ? (
              <Text style={[styles.footnote, { color: t.textDim }]}>
                {`${matchCountLabel(visible.length)} — النتائج كما يعلنها المصدر، بلا دقائق غير منشورة.`}
              </Text>
            ) : null}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 4,
    gap: 8,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1, textAlign: 'center', fontFamily: 'Cairo_700Bold', fontSize: 17 },
  // A horizontal strip must own its height, or a column flex lets it swallow the
  // screen (measured: the day ribbon stretched to 300px and hid the filters).
  strip: { flexGrow: 0, flexShrink: 0 },
  mergedRow: { alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  liveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveToggleText: { fontFamily: 'Cairo_700Bold', fontSize: 12 },
  divider: { width: 1, height: 22, marginHorizontal: 2 },
  dateChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: 'transparent' },
  dateChipText: { fontFamily: 'Cairo_700Bold', fontSize: 11 },
  filters: { paddingHorizontal: 12, gap: 6, paddingBottom: 8 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, borderWidth: 1 },
  filterText: { fontFamily: 'Cairo_600SemiBold', fontSize: 12 },
  list: { padding: 12, gap: 8, paddingBottom: 40 },
  section: { fontFamily: 'Cairo_700Bold', fontSize: 12, marginTop: 4 },
  groupEmpty: { fontFamily: 'Cairo_400Regular', fontSize: 12, paddingVertical: 10, paddingHorizontal: 6 },
  footnote: { fontFamily: 'Cairo_400Regular', fontSize: 10, lineHeight: 16, textAlign: 'center', marginTop: 14 },
  stateScroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 28,
    paddingVertical: 36,
  },
  updateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  updateText: { fontFamily: 'Cairo_400Regular', fontSize: 11 },
  stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: 'Cairo_700Bold', fontSize: 15, textAlign: 'center', flexShrink: 1, lineHeight: 24 },
  emptyBody: { fontFamily: 'Cairo_400Regular', fontSize: 12, textAlign: 'center', flexShrink: 1, lineHeight: 20 },
  retry: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 14, borderWidth: 1 },
});
