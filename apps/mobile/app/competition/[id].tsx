import React, { useCallback, useEffect, useState } from 'react';
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
import { router, useLocalSearchParams } from 'expo-router';
import { palette } from '../../constants/colors';
import type { Theme } from '../../constants/colors';
import { TeamCrest } from '../../components/TeamCrest';
import { fetchCompetitionPage, isNetworkFailure, type CompetitionPage } from '../../lib/api';

/**
 * صفحة البطولة (#42), built to the approved preview.
 *
 * The preview's hierarchy: a header with the competition's name and season, then
 * three sections — the table, the round's fixtures, the competition's coverage.
 *
 * Two constraints from the approval decide the details:
 *
 *   1. **Four columns only.** The Egyptian league publishes played, goal difference
 *      and points; it does not publish W/D/L. The table therefore prints position,
 *      club, played, +/-, points, and nothing else — the same rule as the standings
 *      screen and the club page.
 *   2. **Channels are real.** Verified before building: every Egyptian fixture the
 *      API serves carries a broadcaster (`أون سبورت`, `أون سبورت ماكس`), so the
 *      channel line stays. It is printed only when the row has one, so a competition
 *      without broadcast data simply shows less rather than a blank slot.
 *
 * Qualification dots follow the convention the standings screen already uses: the
 * top two are continental places, then a secondary place, then relegation — applied
 * only where the table is long enough to have those places.
 */

/** The preview's zone colours, one per qualification band. */
function zoneOf(position: number, total: number): 'continental' | 'secondary' | 'relegation' | null {
  if (position <= 2) return 'continental';
  if (position <= 4) return 'secondary';
  if (total > 6 && position >= total - 2) return 'relegation';
  return null;
}

const ZONE_COLOR: Record<'continental' | 'secondary' | 'relegation', string> = {
  continental: '#34D399',
  secondary: '#3B82F6',
  relegation: '#EF4444',
};

export default function CompetitionScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { id } = useLocalSearchParams<{ id: string }>();
  const [page, setPage] = useState<CompetitionPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setPage(await fetchCompetitionPage(id));
    } catch (err) {
      setError(isNetworkFailure(err) ? 'تعذّر الاتصال. حاول مرة أخرى.' : 'تعذّر تحميل البطولة.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const openMatch = (matchId: string) =>
    router.push({ pathname: '/matches/[id]', params: { id: matchId, date: '' } });

  /** One fixture: crests, kickoff or score, and the broadcaster when published. */
  const fixture = (m: NonNullable<CompetitionPage['upcoming']>[number]) => {
    const isLive = m.status === 'live';
    const hasScore = m.homeScore !== null && m.awayScore !== null;
    return (
      <TouchableOpacity
        key={m.id}
        style={[
          styles.fixtureCard,
          {
            backgroundColor: t.surface,
            borderColor: isLive ? t.accentBorder : t.borderLight,
          },
        ]}
        onPress={() => openMatch(m.id)}
        accessibilityRole="button"
        accessibilityLabel={`${m.home} ضد ${m.away}`}
      >
        <View style={styles.fixtureRow}>
          <View style={styles.fixtureSide}>
            <TeamCrest logo={m.homeLogo} name={m.home} size={28} t={t} />
            <Text style={[styles.fixtureTeam, { color: t.textPrimary }]} numberOfLines={1}>
              {m.home}
            </Text>
          </View>
          <View style={styles.fixtureMiddle}>
            {hasScore ? (
              <Text style={[styles.fixtureScore, { color: isLive ? t.accent : t.textPrimary }]}>
                {`${m.homeScore} - ${m.awayScore}`}
              </Text>
            ) : (
              <Text style={[styles.fixtureTime, { color: t.accent }]}>{m.kickoff ?? '—'}</Text>
            )}
            <Text style={[styles.fixtureStatus, { color: isLive ? t.accent : t.textDim }]} numberOfLines={1}>
              {m.statusText}
            </Text>
          </View>
          <View style={styles.fixtureSide}>
            <TeamCrest logo={m.awayLogo} name={m.away} size={28} t={t} />
            <Text style={[styles.fixtureTeam, { color: t.textPrimary }]} numberOfLines={1}>
              {m.away}
            </Text>
          </View>
        </View>
        {/* Only what the source sent: round and channel each disappear when absent. */}
        {m.round || m.channel ? (
          <Text style={[styles.fixtureMeta, { color: t.textDim }]} numberOfLines={1}>
            {[m.round, m.channel ? `📺 ${m.channel}` : null].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  const rows = page?.standings ?? [];
  const showsTable = !page?.isCup && rows.length > 0;

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
          <Text style={[styles.headerTitle, { color: t.textPrimary }]} numberOfLines={1}>
            {page?.nameAr ?? 'البطولة'}
          </Text>
          <View style={styles.headerBtn} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={t.accent} />
          </View>
        ) : error || !page ? (
          <View style={styles.center}>
            <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>{error ?? 'البطولة غير متاحة'}</Text>
            <TouchableOpacity style={[styles.retry, { borderColor: t.accent }]} onPress={load} accessibilityRole="button">
              <Text style={{ color: t.accent }}>إعادة المحاولة</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {/* Header card: the design's competition banner. */}
            <View style={[styles.heroCard, { borderColor: t.accentBorder }]}>
              <View style={styles.heroInner}>
                <Ionicons name="trophy" size={26} color={t.accent} />
                <Text style={[styles.heroName, { color: t.textPrimary }]} numberOfLines={2}>
                  {page.nameAr}
                </Text>
                <Text style={[styles.heroSub, { color: t.textMuted }]}>
                  {page.isCup ? 'بطولة كأس' : 'الدوري'}
                </Text>
              </View>
            </View>

            {/* The table, four real columns. A cup says it has none by nature. */}
            <Text style={[styles.section, { color: t.textMuted }]}>📊 جدول الترتيب</Text>
            {showsTable ? (
              <View style={[styles.tableCard, { backgroundColor: t.surface, borderColor: t.borderLight }]}>
                <View style={[styles.tableHead, { borderBottomColor: t.borderLight }]}>
                  <Text style={[styles.th, styles.colPos, { color: t.textDim }]}>#</Text>
                  <Text style={[styles.th, styles.colTeam, { color: t.textDim }]}>الفريق</Text>
                  <Text style={[styles.th, styles.colNum, { color: t.textDim }]}>لعب</Text>
                  <Text style={[styles.th, styles.colNum, { color: t.textDim }]}>+/-</Text>
                  <Text style={[styles.th, styles.colNum, { color: t.textDim }]}>نقاط</Text>
                </View>
                {rows.map((r) => {
                  const zone = zoneOf(r.position, rows.length);
                  const diff = r.goalsFor - r.goalsAgainst;
                  return (
                    <TouchableOpacity
                      key={`${r.position}-${r.team}`}
                      style={[styles.tableRow, { borderTopColor: t.borderLight }]}
                      onPress={() => router.push({ pathname: '/team/[name]', params: { name: r.team } })}
                      accessibilityRole="button"
                      accessibilityLabel={`${r.team} — صفحة الفريق`}
                    >
                      <View style={styles.colPos}>
                        {zone ? (
                          <View style={[styles.zoneDot, { backgroundColor: ZONE_COLOR[zone] }]} />
                        ) : null}
                        <Text style={[styles.td, { color: t.textSecondary }]}>{r.position}</Text>
                      </View>
                      <View style={styles.teamCell}>
                        <TeamCrest logo={r.logo} name={r.team} size={18} t={t} />
                        <Text style={[styles.td, styles.teamName, { color: t.textPrimary }]} numberOfLines={1}>
                          {r.team}
                        </Text>
                      </View>
                      <Text style={[styles.td, styles.colNumText, { color: t.textSecondary }]}>{r.played}</Text>
                      <Text
                        style={[
                          styles.td,
                          styles.colNumText,
                          { color: diff > 0 ? t.accent : t.textSecondary },
                        ]}
                      >
                        {`${diff > 0 ? '+' : ''}${diff}`}
                      </Text>
                      <Text style={[styles.td, styles.colNumText, styles.pts, { color: t.textPrimary }]}>
                        {r.points}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <Text style={[styles.empty, { color: t.textMuted }]}>
                {page.isCup
                  ? 'البطولة كأس، فمالهاش جدول ترتيب.'
                  : 'المصدر مش ناشر جدول ترتيب للبطولة دي.'}
              </Text>
            )}

            {/* Fixtures, with the channel when the source names one. */}
            <Text style={[styles.section, { color: t.textMuted }]}>📅 مباريات الجولة</Text>
            {page.upcoming?.length ? (
              page.upcoming.slice(0, 10).map(fixture)
            ) : (
              <Text style={[styles.empty, { color: t.textMuted }]}>لا توجد مباريات مسجّلة.</Text>
            )}

            <Text style={[styles.section, { color: t.textMuted }]}>🏁 آخر النتائج</Text>
            {page.recent?.length ? (
              page.recent.slice(0, 5).map(fixture)
            ) : (
              <Text style={[styles.empty, { color: t.textMuted }]}>لا توجد نتائج مسجّلة.</Text>
            )}
          </ScrollView>
        )}
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
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: 'Cairo_700Bold', fontSize: 17 },
  list: { padding: 12, paddingBottom: 40, gap: 4 },
  heroCard: {
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: 'rgba(24,39,33,0.9)',
    overflow: 'hidden',
  },
  heroInner: { alignItems: 'center', paddingVertical: 16, paddingHorizontal: 14, gap: 6 },
  heroName: { fontFamily: 'Cairo_700Bold', fontSize: 18, textAlign: 'center' },
  heroSub: { fontFamily: 'Cairo_400Regular', fontSize: 11 },
  section: { fontFamily: 'Cairo_700Bold', fontSize: 12.5, marginTop: 10, marginBottom: 4 },
  tableCard: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  tableHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1 },
  th: { fontFamily: 'Cairo_700Bold', fontSize: 10 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  colPos: { width: 30, flexDirection: 'row', alignItems: 'center', gap: 4 },
  colTeam: { flex: 1 },
  colNum: { width: 34, textAlign: 'center' },
  colNumText: { width: 34, textAlign: 'center', fontVariant: ['tabular-nums'] },
  td: { fontFamily: 'Cairo_400Regular', fontSize: 11 },
  teamCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  teamName: { flexShrink: 1, fontFamily: 'Cairo_600SemiBold' },
  zoneDot: { width: 3, height: 16, borderRadius: 2 },
  pts: { fontFamily: 'Cairo_700Bold', fontSize: 12 },
  fixtureCard: { borderRadius: 14, borderWidth: 1, padding: 10, gap: 6 },
  fixtureRow: { flexDirection: 'row', alignItems: 'center' },
  fixtureSide: { flex: 1, alignItems: 'center', gap: 4 },
  fixtureTeam: { fontFamily: 'Cairo_600SemiBold', fontSize: 11.5, textAlign: 'center' },
  fixtureMiddle: { alignItems: 'center', minWidth: 76, gap: 1 },
  fixtureScore: { fontFamily: 'Cairo_700Bold', fontSize: 16, fontVariant: ['tabular-nums'] },
  fixtureTime: { fontFamily: 'Cairo_700Bold', fontSize: 14, fontVariant: ['tabular-nums'] },
  fixtureStatus: { fontFamily: 'Cairo_400Regular', fontSize: 9 },
  fixtureMeta: { fontFamily: 'Cairo_400Regular', fontSize: 9.5, textAlign: 'center' },
  empty: { fontFamily: 'Cairo_400Regular', fontSize: 12, lineHeight: 20, paddingVertical: 8, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  emptyTitle: { fontFamily: 'Cairo_700Bold', fontSize: 15, textAlign: 'center' },
  retry: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 14, borderWidth: 1 },
});
