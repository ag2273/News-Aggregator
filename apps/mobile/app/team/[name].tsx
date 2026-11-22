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
import { competitionName } from '../../lib/competitions';
import {
  fetchTeamPage,
  isNetworkFailure,
  type FootballMatch,
  type TeamPage,
} from '../../lib/api';

/**
 * صفحة الفريق.
 *
 * Everything here comes from what the server already holds: the club's matches for
 * the week it caches, its competitions, and the coverage our corpus has. A club we
 * hold nothing for gets an honest empty page — never a fabricated fixture.
 */
export default function TeamScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { name } = useLocalSearchParams<{ name: string }>();
  const [page, setPage] = useState<TeamPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      setPage(await fetchTeamPage(name));
    } catch (err) {
      setError(isNetworkFailure(err) ? 'تعذّر الاتصال. حاول مرة أخرى.' : 'تعذّر تحميل بيانات الفريق.');
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    load();
  }, [load]);

  const matchRow = (m: FootballMatch) => {
    const isHome = m.home === name;
    const opponent = isHome ? m.away : m.home;
    const scoreFor = isHome ? m.homeScore : m.awayScore;
    const scoreAgainst = isHome ? m.awayScore : m.homeScore;
    return (
      <TouchableOpacity
        key={m.id}
        style={[styles.card, { backgroundColor: t.surface }]}
        onPress={() => router.push({ pathname: '/matches/[id]', params: { id: m.id, date: '' } })}
        accessibilityRole="button"
        accessibilityLabel={`${m.home} ضد ${m.away}`}
      >
        <View style={styles.cardTop}>
          <Text style={[styles.vs, { color: t.textMuted }]}>{isHome ? 'ضد' : 'ضد'}</Text>
          <Text style={[styles.opponent, { color: t.textPrimary }]} numberOfLines={1}>
            {opponent}
          </Text>
          <View style={styles.result}>
            {scoreFor === null || scoreAgainst === null ? (
              <Text style={[styles.kickoff, { color: t.textSecondary }]}>{m.kickoff ?? '—'}</Text>
            ) : (
              <Text
                style={[
                  styles.score,
                  { color: scoreFor > scoreAgainst ? t.accent : t.textPrimary },
                ]}
              >
                {scoreFor} - {scoreAgainst}
              </Text>
            )}
          </View>
        </View>
        <Text style={[styles.meta, { color: t.textMuted }]} numberOfLines={1}>
          {[m.competitionName, m.round, m.statusText].filter(Boolean).join(' · ')}
        </Text>
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
          <Text style={[styles.title, { color: t.textPrimary }]} numberOfLines={1}>
            {name ?? 'الفريق'}
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
            <View style={styles.hero}>
              <TeamCrest logo={page?.logo} name={name ?? ''} size={56} t={t} />
              <Text style={[styles.heroName, { color: t.textPrimary }]}>{name}</Text>
              {page?.competitionIds?.length ? (
                <View style={styles.comps}>
                  {page.competitionIds.slice(0, 4).map((id) => (
                    <TouchableOpacity
                      key={id}
                      onPress={() => router.push({ pathname: '/competition/[id]', params: { id } })}
                      style={[styles.compChip, { backgroundColor: t.pillInactiveBg }]}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.compChipText, { color: t.textSecondary }]}>{competitionName(id)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>

            <Text style={[styles.section, { color: t.textMuted }]}>المباريات القادمة</Text>
            {page?.upcoming?.length ? (
              page.upcoming.map(matchRow)
            ) : (
              <Text style={[styles.empty, { color: t.textMuted }]}>لا توجد مباريات قادمة مسجّلة لهذا الفريق.</Text>
            )}

            <Text style={[styles.section, { color: t.textMuted }]}>آخر النتائج</Text>
            {page?.recent?.length ? (
              page.recent.map(matchRow)
            ) : (
              <Text style={[styles.empty, { color: t.textMuted }]}>لا توجد نتائج مسجّلة لهذا الفريق.</Text>
            )}

            <Text style={[styles.section, { color: t.textMuted }]}>أخبار الفريق</Text>
            {page?.news?.length ? (
              page.news.map((n) => (
                <View key={n.id} style={[styles.newsCard, { backgroundColor: t.surface }]}>
                  <Text style={[styles.newsSource, { color: t.accent }]}>{n.sourceName}</Text>
                  <Text style={[styles.newsTitle, { color: t.textPrimary }]} numberOfLines={3}>{n.title}</Text>
                </View>
              ))
            ) : (
              <Text style={[styles.empty, { color: t.textMuted }]}>لا توجد تغطية صحفية لهذا الفريق في مصادرنا حتى الآن.</Text>
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
  hero: { alignItems: 'center', gap: 8, paddingVertical: 14 },
  heroName: { fontSize: 20, fontWeight: '800' },
  comps: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  compChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  compChipText: { fontSize: 11, fontWeight: '600' },
  section: { fontSize: 12, fontWeight: '700', marginTop: 10 },
  card: { borderRadius: 16, padding: 12, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vs: { fontSize: 11 },
  opponent: { flex: 1, fontSize: 14, fontWeight: '600' },
  result: { minWidth: 56, alignItems: 'flex-end' },
  score: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  kickoff: { fontSize: 13, fontWeight: '700' },
  meta: { fontSize: 11 },
  newsCard: { borderRadius: 14, padding: 12, gap: 4 },
  newsSource: { fontSize: 11, fontWeight: '700' },
  newsTitle: { fontSize: 13, fontWeight: '600', lineHeight: 21 },
  empty: { fontSize: 12, lineHeight: 20, paddingVertical: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  emptyTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  retry: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 14, borderWidth: 1 },
});
