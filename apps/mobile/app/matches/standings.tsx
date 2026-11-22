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
import { router } from 'expo-router';
import { palette } from '../../constants/colors';
import type { Theme } from '../../constants/colors';
import { useAuth } from '../../lib/auth';
import {
  FALLBACK_COMPETITIONS,
  fetchCompetitions,
  fetchStandings,
  fetchTeamFollows,
  isNetworkFailure,
  type FootballCompetition,
  type StandingRow,
} from '../../lib/api';

/** Colours that mark qualification and relegation, per the spec. */
function zoneColor(position: number, total: number): string | null {
  if (position <= 2) return '#34D399'; // continental places
  if (position <= 4) return '#3B82F6'; // secondary competition
  if (total > 6 && position >= total - 2) return '#EF4444'; // relegation
  return null;
}

export default function StandingsScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { token } = useAuth();
  // Tabs come from the server, so the names and the competition list live in one
  // place. A cup is listed but says it has no table, instead of being hidden.
  const [competitions, setCompetitions] = useState<FootballCompetition[]>(FALLBACK_COMPETITIONS);
  const [competition, setCompetition] = useState<string>('egyptian-premier');
  const [rows, setRows] = useState<StandingRow[]>([]);
  const [group, setGroup] = useState<string | null>(null);
  const [fullRecord, setFullRecord] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followed, setFollowed] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchCompetitions()
      .then((list) => setCompetitions(list.length ? list : FALLBACK_COMPETITIONS))
      .catch(() => setCompetitions(FALLBACK_COMPETITIONS));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchStandings(competition);
      setUnavailable(data.unavailable);
      setRows(data.tables[0]?.rows ?? []);
      setGroup(data.tables[0]?.group ?? null);
      setFullRecord(data.tables[0]?.hasFullRecord ?? true);
      if (token) {
        const follows = await fetchTeamFollows(token);
        setFollowed(new Set(follows.map((f) => f.name)));
      }
    } catch (err) {
      setError(isNetworkFailure(err) ? 'تعذّر الاتصال. حاول مرة أخرى.' : 'تعذّر تحميل الترتيب.');
    } finally {
      setLoading(false);
    }
  }, [competition, token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <LinearGradient colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="رجوع">
            <Ionicons name="chevron-forward" size={22} color={t.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: t.textPrimary }]}>جداول الترتيب</Text>
          <View style={styles.headerBtn} />
        </View>

        {/* Eleven competitions cannot share a phone width, so this strip scrolls —
            but it needs its own height, or it is squeezed and the selected tab is
            clipped at the top (measured: the active chip was cut in half). */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.strip}
          contentContainerStyle={styles.tabs}
        >
          {competitions.map((x) => (
            <TouchableOpacity
              key={x.id}
              onPress={() => setCompetition(x.id)}
              style={[styles.tab, { backgroundColor: x.id === competition ? t.accent : t.pillInactiveBg }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: x.id === competition }}
            >
              <Text style={[styles.tabText, { color: x.id === competition ? '#FFFFFF' : t.textSecondary }]}>{x.nameAr}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={t.accent} /></View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>{error}</Text>
            <TouchableOpacity style={[styles.retry, { borderColor: t.accent }]} onPress={load} accessibilityRole="button">
              <Text style={{ color: t.accent }}>إعادة المحاولة</Text>
            </TouchableOpacity>
          </View>
        ) : unavailable || rows.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="time-outline" size={30} color={t.textMuted} />
            <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>الترتيب غير متاح حاليًا</Text>
            <Text style={[styles.emptyBody, { color: t.textMuted }]}>
              المصدر لا يوفّر جدولًا لهذه البطولة الآن. البطولات الأخرى متاحة.
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {group ? <Text style={[styles.group, { color: t.textMuted }]}>{group}</Text> : null}
            <View style={[styles.tableHead, { borderBottomColor: t.borderLight }]}>
              <Text style={[styles.th, styles.colPos, { color: t.textMuted }]}>#</Text>
              <Text style={[styles.th, styles.colTeam, { color: t.textMuted }]}>الفريق</Text>
              {(fullRecord ? ['ل', 'ف', 'ت', 'خ', 'ف.أ', 'ن'] : ['ل', 'ف.أ', 'ن']).map((h, i) => (
                <Text key={`${h}-${i}`} style={[styles.th, styles.colNum, { color: t.textMuted }]}>{h}</Text>
              ))}
            </View>
            {rows.map((r) => {
              const zone = zoneColor(r.position, rows.length);
              const isFollowed = followed.has(r.team);
              return (
                <View
                  key={`${r.position}-${r.team}`}
                  style={[
                    styles.row,
                    { borderBottomColor: t.borderLight },
                    isFollowed && { backgroundColor: t.surfaceSubtle },
                  ]}
                >
                  {zone ? <View style={[styles.zone, { backgroundColor: zone }]} /> : null}
                  <Text style={[styles.td, styles.colPos, { color: t.textSecondary }]}>{r.position}</Text>
                  <Text style={[styles.td, styles.colTeam, { color: t.textPrimary, fontWeight: isFollowed ? '800' : '500' }]} numberOfLines={1}>
                    {r.team}
                  </Text>
                  <Text style={[styles.td, styles.colNum, { color: t.textSecondary }]}>{r.played}</Text>
                  {fullRecord ? (
                    <>
                      <Text style={[styles.td, styles.colNum, { color: t.textSecondary }]}>{r.won}</Text>
                      <Text style={[styles.td, styles.colNum, { color: t.textSecondary }]}>{r.drawn}</Text>
                      <Text style={[styles.td, styles.colNum, { color: t.textSecondary }]}>{r.lost}</Text>
                    </>
                  ) : null}
                  <Text style={[styles.td, styles.colNum, { color: t.textSecondary }]}>
                    {r.goalsFor - r.goalsAgainst > 0 ? '+' : ''}{r.goalsFor - r.goalsAgainst}
                  </Text>
                  <Text style={[styles.td, styles.colNum, { color: t.accent, fontWeight: '800' }]}>{r.points}</Text>
                </View>
              );
            })}
            {fullRecord ? null : (
              <Text style={[styles.note, { color: t.textMuted }]}>
                المصدر يعرض لهذه البطولة عدد المباريات والأهداف والنقاط فقط، بدون تفصيل الفوز والتعادل والخسارة.
              </Text>
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
  title: { fontSize: 18, fontWeight: '700' },
  strip: { flexGrow: 0, flexShrink: 0 },
  tabs: { gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  tabText: { fontSize: 12, fontWeight: '600' },
  list: { paddingHorizontal: 12, paddingBottom: 40 },
  group: { fontSize: 11, fontWeight: '700', paddingVertical: 6 },
  tableHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1 },
  th: { fontSize: 10, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1 },
  zone: { width: 3, height: 18, borderRadius: 2, marginEnd: 6 },
  td: { fontSize: 12 },
  colPos: { width: 22, textAlign: 'center' },
  colTeam: { flex: 1, marginEnd: 6 },
  colNum: { width: 26, textAlign: 'center', fontVariant: ['tabular-nums'] },
  note: { fontSize: 10, lineHeight: 17, marginTop: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  emptyTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  emptyBody: { fontSize: 12, lineHeight: 20, textAlign: 'center' },
  retry: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 14, borderWidth: 1 },
});
