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
import {
  fetchMatches,
  isNetworkFailure,
  type FootballMatch,
  type MatchesDay,
} from '../../lib/api';
import { cairoDay, ribbonLabel } from '../../lib/dates';

type Filter = 'all' | 'live' | 'followed' | 'finished' | 'upcoming';

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
  const matches = day?.matches ?? [];

  const visible = useMemo(() => {
    switch (filter) {
      case 'live':
        return matches.filter((m) => m.status === 'live');
      case 'finished':
        return matches.filter((m) => m.status === 'finished');
      case 'upcoming':
        return matches.filter((m) => m.status === 'upcoming');
      case 'followed':
        return matches.filter((m) => followed.has(m.home) || followed.has(m.away));
      default:
        return matches;
    }
  }, [matches, filter, followed]);

  const pinned = visible.filter((m) => followed.has(m.home) || followed.has(m.away));
  const liveNow = visible.filter((m) => m.status === 'live' && !pinned.includes(m));
  const rest = visible.filter((m) => !pinned.includes(m) && !liveNow.includes(m));
  const groups = useMemo(() => {
    const map = new Map<string, FootballMatch[]>();
    for (const m of rest) {
      const key = m.competitionName || 'بطولات أخرى';
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    return [...map.entries()];
  }, [rest]);

  const liveCount = matches.filter((m) => m.status === 'live').length;
  const followedCount = matches.filter((m) => followed.has(m.home) || followed.has(m.away)).length;

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
        {m.round || m.channel ? (
          <Text style={[styles.round, { color: t.textMuted }]}>
            {[m.round, m.channel].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        {followed.has(m.home) || followed.has(m.away) ? (
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ribbon}>
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
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
              {filter === 'all' ? 'لا توجد مباريات مجدولة اليوم في بطولاتك المفضلة' : 'لا توجد مباريات بهذه الحالة'}
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
            {groups.map(([name, rows]) => (
              <View key={name}>
                <TouchableOpacity
                  style={styles.groupHeader}
                  onPress={() => setCollapsed((c) => ({ ...c, [name]: !c[name] }))}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !collapsed[name] }}
                >
                  <Ionicons name={collapsed[name] ? 'chevron-back' : 'chevron-down'} size={16} color={t.textMuted} />
                  <Text style={[styles.groupTitle, { color: t.textSecondary }]}>{name}</Text>
                </TouchableOpacity>
                {collapsed[name] ? null : rows.map(card)}
              </View>
            ))}
          </ScrollView>
        )}
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
  ribbon: { paddingHorizontal: 12, gap: 8, paddingVertical: 10 },
  ribbonItem: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  ribbonText: { fontSize: 12, fontWeight: '600' },
  filters: { paddingHorizontal: 12, gap: 8, paddingBottom: 8 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 15 },
  filterText: { fontSize: 12, fontWeight: '600' },
  list: { padding: 12, gap: 8, paddingBottom: 40 },
  section: { fontSize: 12, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
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
  emptyTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  emptyBody: { fontSize: 12, lineHeight: 20, textAlign: 'center' },
  retry: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 14, borderWidth: 1 },
});
