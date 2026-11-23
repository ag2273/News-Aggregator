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
import { fetchMatches, isNetworkFailure, type FootballMatch } from '../../lib/api';
import { cairoDay, ribbonLabel, toArabicDigits } from '../../lib/dates';
import { TeamCrest } from '../../components/TeamCrest';
import { MatchCard, matchCountLabel } from '../../components/FootballCard';

/**
 * مباريات اليوم القادمة ومواعيد البث.
 *
 * Screen five in the spec. It shows the next days with each match's broadcasting
 * channel. The spec also asks for the commentator, and the source does not
 * publish one — so the field is absent and the note says so, rather than being
 * invented or silently dropped.
 */
export default function UpcomingScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const [offset, setOffset] = useState(1);
  const [matches, setMatches] = useState<FootballMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const date = cairoDay(offset);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const day = await fetchMatches(date);
      // Upcoming only: a fixture that already finished belongs on the matches
      // screen, not on a "coming up" list.
      setMatches(day.matches.filter((m) => m.status !== 'finished'));
    } catch (err) {
      setError(isNetworkFailure(err) ? 'تعذّر الاتصال. حاول مرة أخرى.' : 'تعذّر تحميل المواعيد.');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, FootballMatch[]>();
    for (const m of matches) {
      const key = m.competitionName || 'بطولات أخرى';
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    return [...map.entries()];
  }, [matches]);

  return (
    <LinearGradient colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="رجوع">
            <Ionicons name="chevron-forward" size={22} color={t.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: t.textPrimary }]}>المباريات القادمة</Text>
          <View style={styles.headerBtn} />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.strip}
          contentContainerStyle={styles.ribbon}
        >
          {[1, 2, 3, 4, 5, 6, 7].map((off) => (
            <TouchableOpacity
              key={off}
              onPress={() => setOffset(off)}
              style={[styles.ribbonItem, { backgroundColor: off === offset ? t.accent : t.pillInactiveBg }]}
              accessibilityRole="button"
              accessibilityState={{ selected: off === offset }}
            >
              <Text style={[styles.ribbonText, { color: off === offset ? '#FFFFFF' : t.textSecondary }]}>
                {ribbonLabel(off, cairoDay(off))}
              </Text>
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
        ) : groups.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="calendar-outline" size={32} color={t.textMuted} />
            <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>لا توجد مباريات قادمة في هذا اليوم</Text>
            <Text style={[styles.emptyBody, { color: t.textMuted }]}>جرّب يومًا آخر من الشريط بالأعلى.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {/* A numeric date heading, per the design: «مواجهات السبت ٢٣ نوفمبر»
                with the day's count, not a bare league name. */}
            <Text style={[styles.dayHeading, { color: t.textPrimary }]}>
              {`مواجهات ${ribbonLabel(offset, date)} • ${matchCountLabel(matches.length)}`}
            </Text>
            {groups.map(([league, rows]) => (
              <View key={league}>
                <Text style={[styles.groupTitle, { color: t.textMuted }]}>
                  {`${league} • ${matchCountLabel(rows.length)}`}
                </Text>
                {rows.map((m) => (
                  <MatchCard
                    key={m.id}
                    t={t}
                    m={m}
                    onPress={() => router.push({ pathname: '/matches/[id]', params: { id: m.id, date } })}
                    onPressTeam={(name) => router.push({ pathname: '/team/[name]', params: { name } })}
                    channelFallback="القناة الناقلة غير معلنة بعد"
                  />
                ))}
              </View>
            ))}
            <Text style={[styles.note, { color: t.textMuted }]}>
              القنوات الناقلة كما يعلنها المصدر. أسماء المعلقين غير متاحة من المصدر حاليًا.
            </Text>
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
  ribbon: { paddingHorizontal: 12, gap: 8, paddingVertical: 10 },
  ribbonItem: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  ribbonText: { fontSize: 12, fontWeight: '600' },
  strip: { flexGrow: 0, flexShrink: 0 },
  list: { padding: 12, gap: 8, paddingBottom: 40 },
  dayHeading: { fontFamily: 'Cairo_700Bold', fontSize: 14, marginTop: 2, marginBottom: 4 },
  groupTitle: { fontFamily: 'Cairo_700Bold', fontSize: 11, marginTop: 10, marginBottom: 4 },
  card: { borderRadius: 16, padding: 12, gap: 8, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  kickoff: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 48 },
  teams: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  team: { fontSize: 13, fontWeight: '600' },
  versus: { fontSize: 10 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { fontSize: 11 },
  note: { fontSize: 10, lineHeight: 17, marginTop: 10, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  emptyTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  emptyBody: { fontSize: 12, lineHeight: 20, textAlign: 'center' },
  retry: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 14, borderWidth: 1 },
});
