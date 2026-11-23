import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { relativeTime } from '../../lib/api';
import { logoUrl } from '../../lib/api';
import {
  fetchTeamPage,
  isNetworkFailure,
  type FootballMatch,
  type TeamPage,
} from '../../lib/api';

/**
 * صفحة النادي (#40), built to the approved preview.
 *
 * Two rules from the approval decide what is on screen:
 *
 *   1. **Real data only.** The hero carries the crest, the club's name and its
 *      competition; the table strip shows the four columns the sources publish
 *      (position, played, goal difference, points) and nothing else. The Egyptian
 *      league sends no W/D/L, so a column of zeros would be a fabricated record.
 *
 *   2. **No scorer line.** The preview drew «كهربا '44 • وسام أبو علي '78» under each
 *      result. Measured: the club endpoint returns zero goals for real Egyptian
 *      results, because scorers are only fetched per match on demand and only when a
 *      source published them. Rather than a line that is usually empty, the element
 *      is gone — the approved correction says to remove it if the sources do not
 *      provide it.
 *
 * The form strip is computed on the server from finished matches with a real score.
 */

/** The preview's form letters, in Arabic. */
const FORM_LETTER: Record<'W' | 'D' | 'L', string> = { W: 'ف', D: 'ت', L: 'خ' };
const FORM_COLOR: Record<'W' | 'D' | 'L', string> = {
  W: '#34D399',
  D: '#94A3B8',
  L: '#EF4444',
};

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

  const openMatch = (m: FootballMatch) =>
    router.push({ pathname: '/matches/[id]', params: { id: m.id, date: '' } });

  /** One previous result: the two clubs, the score, and the date. */
  const resultRow = (m: FootballMatch) => {
    const isHome = m.home === name;
    const hasScore = m.homeScore !== null && m.awayScore !== null;
    return (
      <TouchableOpacity
        key={m.id}
        style={[styles.resultRow, { backgroundColor: t.surface, borderColor: t.borderLight }]}
        onPress={() => openMatch(m)}
        accessibilityRole="button"
        accessibilityLabel={`${m.home} ضد ${m.away}`}
      >
        <View style={styles.resultTeams}>
          <View style={styles.resultTeamLine}>
            <TeamCrest logo={m.homeLogo} name={m.home} size={16} t={t} />
            <Text style={[styles.resultTeamName, { color: t.textPrimary }]} numberOfLines={1}>
              {m.home}
            </Text>
          </View>
          <View style={styles.resultTeamLine}>
            <TeamCrest logo={m.awayLogo} name={m.away} size={16} t={t} />
            <Text style={[styles.resultTeamName, { color: t.textPrimary }]} numberOfLines={1}>
              {m.away}
            </Text>
          </View>
        </View>
        <View style={styles.resultScoreBox}>
          <Text style={[styles.resultScore, { color: hasScore ? t.accent : t.textMuted }]}>
            {hasScore ? `${m.homeScore} - ${m.awayScore}` : '—'}
          </Text>
          <Text style={[styles.resultMeta, { color: t.textDim }]} numberOfLines={1}>
            {[m.competitionName, isHome ? 'على أرضه' : 'خارج أرضه'].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

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
            صفحة النادي
          </Text>
          <View style={styles.headerBtn} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={t.accent} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>{error}</Text>
            <TouchableOpacity style={[styles.retry, { borderColor: t.accent }]} onPress={load} accessibilityRole="button">
              <Text style={{ color: t.accent }}>إعادة المحاولة</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {/* Hero: the preview's club card — a tinted banner with the crest, the
                club's name and its competition, instead of a lone crest in black. */}
            <View style={styles.heroCard}>
              <View style={styles.heroInner}>
                <View style={[styles.crestWell, { borderColor: t.accentBorder }]}>
                  <TeamCrest logo={page?.logo} name={name ?? ''} size={54} t={t} />
                </View>
                <Text style={[styles.heroName, { color: t.textPrimary }]} numberOfLines={2}>
                  {name}
                </Text>
                {page?.competitionIds?.length ? (
                  <View style={styles.comps}>
                    {page.competitionIds.slice(0, 3).map((id) => (
                      <TouchableOpacity
                        key={id}
                        onPress={() => router.push({ pathname: '/competition/[id]', params: { id } })}
                        style={[styles.compChip, { backgroundColor: t.badgePlate, borderColor: t.borderLight }]}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.compChipText, { color: t.textSecondary }]}>
                          {competitionName(id)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>

            {/* The table strip, four real columns. Hidden entirely when we hold no
                table rather than shown with placeholder numbers. */}
            {page?.standing ? (
              <View style={[styles.striple, { backgroundColor: t.surfaceElevated, borderColor: t.accentBorder }]}>
                <View style={styles.stripTop}>
                  <Text style={[styles.stripPos, { color: t.accent }]}>
                    {`${page.standing.position}`}
                  </Text>
                  <Text style={[styles.stripLabel, { color: t.textMuted }]}>المركز</Text>
                  {page.standing.continental ? (
                    <View style={[styles.qualBadge, { backgroundColor: t.accentSoft }]}>
                      <Text style={[styles.qualText, { color: t.accent }]}>🟢 تأهل قاري</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.stripCols}>
                  {[
                    ['لعب', String(page.standing.played)],
                    ['+/-', `${page.standing.goalDiff > 0 ? '+' : ''}${page.standing.goalDiff}`],
                    ['نقاط', String(page.standing.points)],
                  ].map(([label, value]) => (
                    <View key={label} style={styles.stripCol}>
                      <Text style={[styles.stripColLabel, { color: t.textDim }]}>{label}</Text>
                      <Text style={[styles.stripColValue, { color: t.textPrimary }]}>{value}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Next fixture, as the preview's hero card. */}
            {page?.upcoming?.length ? (
              <>
                <Text style={[styles.section, { color: t.textMuted }]}>⏳ المباراة القادمة</Text>
                {page.upcoming.slice(0, 1).map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.nextCard, { borderColor: t.accentBorder, backgroundColor: t.surface }]}
                    onPress={() => openMatch(m)}
                    accessibilityRole="button"
                    accessibilityLabel={`${m.home} ضد ${m.away}`}
                  >
                    <Text style={[styles.nextMeta, { color: t.textDim }]} numberOfLines={1}>
                      {[m.competitionName, m.round, m.stadium].filter(Boolean).join(' · ')}
                    </Text>
                    <View style={styles.nextRow}>
                      <View style={styles.nextSide}>
                        <TeamCrest logo={m.homeLogo} name={m.home} size={34} t={t} />
                        <Text style={[styles.nextTeam, { color: t.textPrimary }]} numberOfLines={1}>
                          {m.home}
                        </Text>
                      </View>
                      <View style={styles.nextMiddle}>
                        <Text style={[styles.nextTime, { color: t.accent }]}>{m.kickoff ?? '—'}</Text>
                        {m.channel ? (
                          <Text style={[styles.nextChannel, { color: t.textDim }]} numberOfLines={1}>
                            {`📺 ${m.channel}`}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.nextSide}>
                        <TeamCrest logo={m.awayLogo} name={m.away} size={34} t={t} />
                        <Text style={[styles.nextTeam, { color: t.textPrimary }]} numberOfLines={1}>
                          {m.away}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            ) : null}

            {/* Results with the form strip, both from real scores. */}
            <Text style={[styles.section, { color: t.textMuted }]}>🏁 آخر النتائج</Text>
            {page?.form?.length ? (
              <View style={[styles.formBar, { backgroundColor: t.surface, borderColor: t.borderLight }]}>
                <Text style={[styles.formLabel, { color: t.textMuted }]}>سلسلة النتائج</Text>
                <View style={styles.formDots}>
                  {page.form.map((f, i) => (
                    <View
                      key={`${f}-${i}`}
                      style={[
                        styles.formDot,
                        { borderColor: FORM_COLOR[f], backgroundColor: `${FORM_COLOR[f]}22` },
                      ]}
                      accessibilityLabel={f === 'W' ? 'فوز' : f === 'D' ? 'تعادل' : 'خسارة'}
                    >
                      <Text style={[styles.formDotText, { color: FORM_COLOR[f] }]}>
                        {FORM_LETTER[f]}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            {page?.recent?.length ? (
              page.recent.slice(0, 5).map(resultRow)
            ) : (
              <Text style={[styles.empty, { color: t.textMuted }]}>لا توجد نتائج مسجّلة لهذا الفريق.</Text>
            )}

            {/* Coverage. The preview's editorial wire: text-first cards with the
                outlet's mark, because nine articles in ten carry no image. */}
            <Text style={[styles.section, { color: t.textMuted }]}>📰 الأخبار والتغطية</Text>
            {page?.news?.length ? (
              page.news.map((n) => {
                const uri = logoUrl(n.imageUrl ?? null);
                return (
                  <View
                    key={n.id}
                    style={[styles.wireCard, { backgroundColor: t.surface, borderColor: t.borderLight }]}
                  >
                    {uri ? (
                      <Image source={{ uri }} style={styles.wireThumb} resizeMode="cover" />
                    ) : null}
                    <View style={styles.wireTopRow}>
                      <View style={[styles.sourcePlate, { backgroundColor: t.badgePlate }]}>
                        <Text style={[styles.sourceInitial, { color: t.textSecondary }]}>
                          {n.sourceName.trim().charAt(0)}
                        </Text>
                      </View>
                      <Text style={[styles.wireSource, { color: t.textSecondary }]} numberOfLines={1}>
                        {n.sourceName}
                      </Text>
                      <Text style={[styles.wireTime, { color: t.textDim }]} numberOfLines={1}>
                        {`• ${relativeTime(n.publishedAt)}`}
                      </Text>
                    </View>
                    <Text style={[styles.wireHeadline, { color: t.textPrimary }]} numberOfLines={3}>
                      {n.title}
                    </Text>
                  </View>
                );
              })
            ) : (
              <Text style={[styles.empty, { color: t.textMuted }]}>
                لا توجد تغطية صحفية لهذا الفريق في مصادرنا حتى الآن.
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
  list: { padding: 12, paddingBottom: 40, gap: 8 },
  // The preview's club hero: tinted gradient, 20px radius, crest centred in a well.
  heroCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    backgroundColor: 'rgba(153,27,27,0.35)',
    overflow: 'hidden',
  },
  heroInner: { alignItems: 'center', paddingVertical: 18, paddingHorizontal: 16, gap: 8 },
  crestWell: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  heroName: { fontFamily: 'Cairo_700Bold', fontSize: 19, textAlign: 'center' },
  comps: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  compChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, borderWidth: 1 },
  compChipText: { fontFamily: 'Cairo_600SemiBold', fontSize: 10.5 },
  striple: { borderRadius: 16, borderWidth: 1, padding: 12, gap: 8 },
  stripTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stripPos: { fontFamily: 'Cairo_700Bold', fontSize: 26 },
  stripLabel: { fontFamily: 'Cairo_400Regular', fontSize: 11, flex: 1 },
  qualBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  qualText: { fontFamily: 'Cairo_700Bold', fontSize: 9.5 },
  stripCols: { flexDirection: 'row', justifyContent: 'space-around' },
  stripCol: { alignItems: 'center', gap: 2 },
  stripColLabel: { fontFamily: 'Cairo_400Regular', fontSize: 10 },
  stripColValue: { fontFamily: 'Cairo_700Bold', fontSize: 14, fontVariant: ['tabular-nums'] },
  section: { fontFamily: 'Cairo_700Bold', fontSize: 12.5, marginTop: 8, marginBottom: 2 },
  nextCard: { borderRadius: 16, borderWidth: 1.5, padding: 12, gap: 10 },
  nextMeta: { fontFamily: 'Cairo_400Regular', fontSize: 10 },
  nextRow: { flexDirection: 'row', alignItems: 'center' },
  nextSide: { flex: 1, alignItems: 'center', gap: 4 },
  nextTeam: { fontFamily: 'Cairo_700Bold', fontSize: 12.5, textAlign: 'center' },
  nextMiddle: { alignItems: 'center', minWidth: 88, gap: 2 },
  nextTime: { fontFamily: 'Cairo_700Bold', fontSize: 17, fontVariant: ['tabular-nums'] },
  nextChannel: { fontFamily: 'Cairo_400Regular', fontSize: 9 },
  formBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  formLabel: { fontFamily: 'Cairo_700Bold', fontSize: 11 },
  formDots: { flexDirection: 'row', gap: 5 },
  formDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formDotText: { fontFamily: 'Cairo_700Bold', fontSize: 11 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  resultTeams: { flex: 1, gap: 3 },
  resultTeamLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultTeamName: { fontFamily: 'Cairo_600SemiBold', fontSize: 12, flexShrink: 1 },
  resultScoreBox: { alignItems: 'flex-end', minWidth: 84 },
  resultScore: { fontFamily: 'Cairo_700Bold', fontSize: 14, fontVariant: ['tabular-nums'] },
  resultMeta: { fontFamily: 'Cairo_400Regular', fontSize: 9, marginTop: 2 },
  wireCard: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 6, overflow: 'hidden' },
  wireThumb: { width: '100%', height: 125, borderRadius: 10, marginBottom: 4 },
  wireTopRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sourcePlate: { width: 16, height: 16, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  sourceInitial: { fontFamily: 'Cairo_700Bold', fontSize: 9 },
  wireSource: { fontFamily: 'Cairo_400Regular', fontSize: 10, flexShrink: 1 },
  wireTime: { fontFamily: 'Cairo_400Regular', fontSize: 10 },
  wireHeadline: { fontFamily: 'Cairo_700Bold', fontSize: 12.5, lineHeight: 19 },
  empty: { fontFamily: 'Cairo_400Regular', fontSize: 12, lineHeight: 20, textAlign: 'center', paddingVertical: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  emptyTitle: { fontFamily: 'Cairo_700Bold', fontSize: 15, textAlign: 'center' },
  retry: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 14, borderWidth: 1 },
});
