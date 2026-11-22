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
import {
  fetchCompetitionPage,
  isNetworkFailure,
  type CompetitionPage,
  type FootballMatch,
  type StandingRow,
} from '../../lib/api';

/**
 * صفحة البطولة.
 *
 * This is where a league lives even on a day it does not play — the reason
 * «الدوري المصري» could not be found. It shows the table, then the fixtures, then
 * the results, and states plainly when the source publishes no table (a cup, or an
 * unpopulated group stage).
 */
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

  const row = (r: StandingRow) => (
    <View key={`${r.position}-${r.team}`} style={[styles.tableRow, { borderBottomColor: t.borderLight }]}>
      <Text style={[styles.td, styles.colPos, { color: t.textSecondary }]}>{r.position}</Text>
      <View style={styles.teamCell}>
        <TeamCrest logo={r.logo} name={r.team} size={18} t={t} />
        <Text style={[styles.td, styles.colTeam, { color: t.textPrimary }]} numberOfLines={1}>
          {r.team}
        </Text>
      </View>
      <Text style={[styles.td, styles.colNum, { color: t.textSecondary }]}>{r.played}</Text>
      <Text style={[styles.td, styles.colNum, { color: t.accent, fontWeight: '800' }]}>{r.points}</Text>
    </View>
  );

  const fixture = (m: FootballMatch) => (
    <TouchableOpacity
      key={m.id}
      style={[styles.card, { backgroundColor: t.surface }]}
      onPress={() => router.push({ pathname: '/matches/[id]', params: { id: m.id, date: '' } })}
      accessibilityRole="button"
      accessibilityLabel={`${m.home} ضد ${m.away}`}
    >
      <View style={styles.cardTop}>
        <Text style={[styles.team, { color: t.textPrimary }]} numberOfLines={1}>{m.home}</Text>
        <Text style={[styles.score, { color: m.status === 'live' ? t.accent : t.textPrimary }]}>
          {m.homeScore === null || m.awayScore === null ? m.kickoff ?? '—' : `${m.homeScore} - ${m.awayScore}`}
        </Text>
        <Text style={[styles.team, { color: t.textPrimary }]} numberOfLines={1}>{m.away}</Text>
      </View>
      <Text style={[styles.meta, { color: t.textMuted }]}>{m.statusText}</Text>
    </TouchableOpacity>
  );

  return (
    <LinearGradient colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="رجوع">
            <Ionicons name="chevron-forward" size={22} color={t.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: t.textPrimary }]} numberOfLines={1}>
            {page?.nameAr ?? 'البطولة'}
          </Text>
          <View style={styles.headerBtn} />
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={t.accent} /></View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>{error}</Text>
            <TouchableOpacity style={[styles.retry, { borderColor: t.accent }]} onPress={load} accessibilityRole="button">
              <Text style={{ color: t.accent }}>إعادة المحاولة</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={[styles.section, { color: t.textMuted }]}>الترتيب</Text>
            {page?.standings?.length ? (
              <View style={[styles.table, { backgroundColor: t.surface }]}>
                <View style={[styles.tableHead, { borderBottomColor: t.borderLight }]}>
                  <Text style={[styles.th, styles.colPos, { color: t.textMuted }]}>#</Text>
                  <Text style={[styles.th, styles.colTeam, { color: t.textMuted }]}>الفريق</Text>
                  <Text style={[styles.th, styles.colNum, { color: t.textMuted }]}>ل</Text>
                  <Text style={[styles.th, styles.colNum, { color: t.textMuted }]}>ن</Text>
                </View>
                {page.standings.map(row)}
              </View>
            ) : (
              <Text style={[styles.empty, { color: t.textMuted }]}>
                {page?.isCup
                  ? 'كأس — مفيش جدول ترتيب بطبيعته.'
                  : 'الترتيب غير متاح من المصدر حاليًا.'}
              </Text>
            )}

            <Text style={[styles.section, { color: t.textMuted }]}>المباريات القادمة</Text>
            {page?.upcoming?.length ? (
              page.upcoming.map(fixture)
            ) : (
              <Text style={[styles.empty, { color: t.textMuted }]}>لا توجد مباريات قادمة مسجّلة.</Text>
            )}

            <Text style={[styles.section, { color: t.textMuted }]}>آخر النتائج</Text>
            {page?.recent?.length ? (
              page.recent.map(fixture)
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 4 },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' },
  list: { padding: 14, gap: 8, paddingBottom: 40 },
  section: { fontSize: 12, fontWeight: '700', marginTop: 8 },
  table: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4 },
  tableHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1 },
  th: { fontSize: 10, fontWeight: '700' },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1 },
  td: { fontSize: 12 },
  colPos: { width: 22, textAlign: 'center' },
  teamCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, marginEnd: 6 },
  colTeam: { flexShrink: 1, flex: 1 },
  colNum: { width: 30, textAlign: 'center', fontVariant: ['tabular-nums'] },
  card: { borderRadius: 14, padding: 12, gap: 5 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  team: { flex: 1, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  score: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 56, textAlign: 'center' },
  meta: { fontSize: 10, textAlign: 'center' },
  empty: { fontSize: 12, lineHeight: 20, paddingVertical: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  emptyTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  retry: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 14, borderWidth: 1 },
});
