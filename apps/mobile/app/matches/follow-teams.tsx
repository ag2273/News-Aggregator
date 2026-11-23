import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
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
import { TeamCrest } from '../../components/TeamCrest';
import {
  fetchCompetitions,
  fetchFollowCatalog,
  fetchLeagueFollows,
  fetchTeamFollows,
  followFootballTeam,
  followLeague,
  setFootballTeamNotify,
  setLeagueNotify,
  unfollowFootballTeam,
  unfollowLeague,
  type CatalogTeam,
  type FootballCompetition,
  type LeagueFollow,
  type TeamFollow,
} from '../../lib/api';

/**
 * متابعة الفرق والمنتخبات — the sports dashboard.
 *
 * Rebuilt to the approved design: crests and flags, a search field, the four
 * sections in hierarchy order (Egypt first), and one rich card per followed
 * team with its next fixture and its three honest toggles.
 *
 * Follows stay account-bound, so the screen gates exactly like following a
 * source. Nothing on it is invented: a club with no crest shows the shield, and a
 * national team with no fixture in the cached window says so instead of showing a
 * friendly we cannot confirm.
 */

/** The design file's six pills, verbatim. */
const FILTERS: Array<{ id: 'all' | CatalogTeam['section']; label: string }> = [
  { id: 'all', label: '✨ الكل' },
  { id: 'egypt', label: '🇪🇬 الدوري المصري' },
  { id: 'europe', label: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 كبار أوروبا' },
  { id: 'continental', label: '🏆 البطولات القارية' },
  { id: 'saudi', label: '🇸🇦 دوري روشن السعودي' },
  { id: 'national', label: '🌍 المنتخبات الوطنية' },
];



export default function FollowTeamsScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { token, loading: authLoading } = useAuth();
  const gate = useAccountGate();

  const [follows, setFollows] = useState<TeamFollow[]>([]);
  const [leagues, setLeagues] = useState<LeagueFollow[]>([]);
  const [, setCompetitions] = useState<FootballCompetition[]>([]);
  const [sections, setSections] = useState<
    Array<{ id: CatalogTeam['section']; title: string; teams: CatalogTeam[] }>
  >([]);
  const [filter, setFilter] = useState<'all' | CatalogTeam['section']>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // The catalogue is public: a signed-out reader can browse it. Follows are not.
    fetchFollowCatalog()
      .then((c) => setSections(c.sections))
      .catch(() => setError('تعذّر تحميل قائمة الفرق.'));
    try {
      const list = await fetchCompetitions();
      setCompetitions(list);
    } catch {
      /* the catalogue carries its own competition names */
    }
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      setFollows(await fetchTeamFollows(token));
    } catch {
      setError('تعذّر تحميل الفرق المتابعة.');
    }
    try {
      setLeagues(await fetchLeagueFollows(token));
    } catch {
      /* a league list that fails must not hide the teams */
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const followedNames = useMemo(() => new Set(follows.map((f) => f.name)), [follows]);

  const toggle = async (team: string, competitionId: string) => {
    if (!gate.allowed) {
      gate.open();
      return;
    }
    if (!token || busy) return;
    setBusy(team);
    setError(null);
    try {
      const followed = follows.some((f) => f.name === team);
      setFollows(
        followed
          ? await unfollowFootballTeam(token, team)
          : await followFootballTeam(token, team, competitionId),
      );
    } catch {
      setError('تعذّر تحديث المتابعة.');
    } finally {
      setBusy(null);
    }
  };

  const toggleLeague = async (competitionId: string) => {
    if (!gate.allowed) {
      gate.open();
      return;
    }
    if (!token || busy) return;
    setBusy(competitionId);
    setError(null);
    try {
      const on = leagues.some((l) => l.competitionId === competitionId);
      setLeagues(
        on ? await unfollowLeague(token, competitionId) : await followLeague(token, competitionId),
      );
    } catch {
      setError('تعذّر تحديث متابعة البطولة.');
    } finally {
      setBusy(null);
    }
  };

  const setLeagueSwitch = async (
    competitionId: string,
    key: 'notifyKickoff' | 'notifyFinal',
    value: boolean,
  ) => {
    if (!token) return;
    try {
      const updated = await setLeagueNotify(token, competitionId, { [key]: value });
      setLeagues((list) => list.map((l) => (l.competitionId === competitionId ? updated : l)));
    } catch {
      setError('تعذّر حفظ تنبيهات البطولة.');
    }
  };

  const setNotify = async (
    team: string,
    key: 'notifyKickoff' | 'notifyGoals' | 'notifyFinal',
    value: boolean,
  ) => {
    if (!token) return;
    try {
      const updated = await setFootballTeamNotify(token, team, { [key]: value });
      setFollows((list) => list.map((f) => (f.name === team ? updated : f)));
    } catch {
      setError('تعذّر حفظ التنبيهات.');
    }
  };

  /** Every catalogue team, flattened, so a followed club can find its own row. */
  const catalogByName = useMemo(() => {
    const map = new Map<string, CatalogTeam>();
    for (const s of sections) for (const team of s.teams) map.set(team.name, team);
    return map;
  }, [sections]);

  const visibleSections = useMemo(() => {
    const q = query.trim();
    return sections
      .filter((s) => filter === 'all' || s.id === filter)
      .map((s) => ({
        ...s,
        teams: q ? s.teams.filter((x) => x.name.includes(q)) : s.teams,
      }))
      .filter((s) => s.teams.length > 0);
  }, [sections, filter, query]);

  const gatedOut = !authLoading && !gate.allowed;

  /** A followed team's card: crest, position, next fixture, three toggles. */
  const followedCard = (f: TeamFollow) => {
    const entry = catalogByName.get(f.name);
    const team = entry && !entry.nextMatch ? entry : entry;
    const next = team?.nextMatch ?? null;
    const toggles: Array<{
      key: 'notifyKickoff' | 'notifyGoals' | 'notifyFinal';
      label: string;
    }> = [
      { key: 'notifyKickoff', label: 'انطلاق المباراة' },
      { key: 'notifyGoals', label: 'الأهداف' },
      { key: 'notifyFinal', label: 'النتيجة النهائية' },
    ];
    return (
      <View key={f.name} style={[styles.followCard, { borderColor: t.accentBorder }]}>
        <View style={[styles.cardRail, { backgroundColor: t.accent }]} />
        <View style={styles.followedTop}>
          <View style={styles.crestInfo}>
            <View style={[styles.crestWell, { backgroundColor: t.badgePlate, borderColor: t.borderLight }]}>
              {team?.flag ? (
                <Text style={styles.flagBig}>{team.flag}</Text>
              ) : (
                <TeamCrest logo={team?.logo ?? null} name={f.name} size={34} t={t} />
              )}
            </View>
            <View style={styles.nameBox}>
              <Text style={[styles.followedName, { color: t.textPrimary }]} numberOfLines={1}>
                {f.name}
              </Text>
              <Text style={[styles.followedSub, { color: t.textMuted }]} numberOfLines={1}>
                {[team?.competitionName, team?.position ? `المركز ${team.position}` : null]
                  .filter(Boolean)
                  .join(' • ') || 'متابع'}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => toggle(f.name, f.competitionId)}
            style={[styles.unfollowBtn, { borderColor: t.borderLight }]}
            accessibilityRole="button"
            accessibilityLabel={`إلغاء متابعة ${f.name}`}
          >
            <Text style={[styles.unfollowText, { color: t.textMuted }]}>مُتابع ✓</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.nextPill, { backgroundColor: t.surfaceElevated }]}>
          <Text style={[styles.nextLabel, { color: t.accent }]}>
            {next ? '⚽ المباراة القادمة:' : '⚽ المباراة القادمة:'}
          </Text>
          <Text style={[styles.nextDetails, { color: t.textSecondary }]} numberOfLines={1}>
            {next
              ? `${f.name} ${next.isHome ? 'ضد' : 'خارج أرضه أمام'} ${next.opponent}${
                  next.kickoff ? ` • ${next.kickoff}` : ''
                }`
              : // Honest gap: no fixture for this team inside the days we hold.
                'لا توجد مباراة مسجّلة في الأيام القادمة'}
          </Text>
        </View>

        <View style={[styles.togglesBar, { backgroundColor: t.badgePlate }]}>
          {toggles.map((x) => (
            <View key={x.key} style={styles.toggleCell}>
              <Switch
                value={f[x.key]}
                onValueChange={(v) => setNotify(f.name, x.key, v)}
                trackColor={{ true: t.accent, false: t.borderLight }}
                accessibilityLabel={`${x.label} — ${f.name}`}
              />
              <Text style={[styles.toggleLabel, { color: f[x.key] ? t.textSecondary : t.textMuted }]}>
                {x.label}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  /** A team still to follow: crest or flag, position, and an add button. */
  const addCard = (team: CatalogTeam) => {
    const on = followedNames.has(team.name);
    return (
      <TouchableOpacity
        key={team.name}
        onPress={() => toggle(team.name, team.competitionId)}
        style={[styles.addCard, { backgroundColor: t.surface, borderColor: t.borderLight }]}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={on ? `إلغاء متابعة ${team.name}` : `متابعة ${team.name}`}
      >
        <View style={[styles.crestWell, { backgroundColor: t.badgePlate, borderColor: t.borderLight }]}>
          {team.flag ? (
            <Text style={styles.flagBig}>{team.flag}</Text>
          ) : (
            <TeamCrest logo={team.logo} name={team.name} size={34} t={t} />
          )}
        </View>
        <Text style={[styles.addName, { color: t.textPrimary }]} numberOfLines={2}>
          {team.name}
        </Text>
        <Text style={[styles.addSub, { color: t.textMuted }]} numberOfLines={1}>
          {team.position ? `المركز ${team.position}` : team.competitionName}
        </Text>
        <View
          style={[
            styles.addBtn,
            { backgroundColor: on ? t.accentSoft : 'transparent', borderColor: on ? t.accent : t.borderLight },
          ]}
        >
          <Text style={[styles.addBtnText, { color: on ? t.accent : t.textSecondary }]}>
            {busy === team.name ? '…' : on ? '✓ متابع' : '+ متابعة'}
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
            <Ionicons name="close" size={18} color={t.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: t.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
            متابعة الفرق والمنتخبات
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/matches')}
            style={[styles.headerBtn, { backgroundColor: t.badgePlate, borderColor: t.borderLight }]}
            accessibilityRole="button"
            accessibilityLabel="مركز المباريات"
          >
            <Ionicons name="checkmark" size={18} color={t.accent} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={t.accent} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
            {/* Search: the design's field, not a fake placeholder. */}
            <View style={[styles.searchBox, { backgroundColor: t.surface, borderColor: t.borderLight }]}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="ابحث عن نادٍ أو منتخب لإضافته..."
                placeholderTextColor={t.textMuted}
                style={[styles.searchInput, { color: t.textPrimary }]}
                accessibilityLabel="ابحث عن نادٍ أو منتخب"
              />
              <Ionicons name="search" size={16} color={t.textMuted} />
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.pillsScroll}
              contentContainerStyle={styles.pillsRow}
            >
              {FILTERS.map((f) => {
                const active = f.id === filter;
                return (
                  <TouchableOpacity
                    key={f.id}
                    onPress={() => setFilter(f.id)}
                    style={[
                      styles.pill,
                      {
                        backgroundColor: active ? t.accentSoft : 'transparent',
                        borderColor: active ? t.accent : t.borderLight,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.pillText, { color: active ? t.accent : t.textSecondary }]}>
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* A guest can browse the catalogue; the follow ACTION is what needs
                an account, so it opens the shared sign-in sheet. Hiding the whole
                screen behind a lock was telling them the list did not exist. */}
            {gatedOut ? (
              <View style={[styles.gateBox, { backgroundColor: t.accentSoft, borderColor: t.accentBorder }]}>
                <Ionicons name="lock-closed-outline" size={20} color={t.textMuted} />
                <Text style={[styles.emptyBody, { color: t.textMuted }]}>
                  تقدر تتفرج على الفرق كلها. عشان تتابع فريق وتوصلك تنبيهاته، سجّل دخولك.
                </Text>
                <TouchableOpacity
                  style={[styles.primary, { backgroundColor: t.accent }]}
                  onPress={gate.open}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryText}>تسجيل الدخول</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <>
                <View style={styles.sectionHeadline}>
                  <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>
                    ⭐ الفرق التي تتابعها حالياً
                  </Text>
                  {follows.length ? (
                    <Text style={[styles.counter, { color: t.accent, backgroundColor: t.accentSoft }]}>
                      {`${follows.length} ${follows.length === 1 ? 'فريق' : 'فرق'} نشطة`}
                    </Text>
                  ) : null}
                </View>
                {follows.length === 0 ? (
                  <Text style={[styles.emptyBody, { color: t.textMuted }]}>
                    لم تتابع أي فريق بعد — اختر من الأقسام بالأسفل.
                  </Text>
                ) : (
                  follows.map(followedCard)
                )}

                {error ? <Text style={[styles.error, { color: t.liveRed }]}>{error}</Text> : null}

                {visibleSections.map((section) => (
                  <View key={section.id}>
                    <View style={styles.sectionHeadline}>
                      {/* The served title already carries the design's own number
                          and flag, so it is rendered as-is. */}
                      <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>
                        {section.title}
                      </Text>
                    </View>
                    <View style={styles.grid}>
                      {section.teams.map(addCard)}
                    </View>
                  </View>
                ))}

                {query.trim() && visibleSections.length === 0 ? (
                  <Text style={[styles.emptyBody, { color: t.textMuted }]}>
                    {`لا يوجد فريق اسمه «${query.trim()}» في البطولات التي نغطيها.`}
                  </Text>
                ) : null}

                {/* Followed competitions. Additive: the team list above is
                    untouched, and a cup cannot be followed (no table, no season). */}
                <View style={styles.sectionHeadline}>
                  <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>🏆 البطولات</Text>
                </View>
                <Text style={[styles.hint, { color: t.textMuted }]}>
                  متابعة بطولة تعني متابعة كل مبارياتها، وتظهر في فلتر الفرق المتابعة.
                </Text>
                <View style={styles.leagueGrid}>
                  {leagues.map((l) => (
                    <View key={l.competitionId} style={[styles.leagueCard, { backgroundColor: t.surface }]}>
                      <View style={styles.cardHead}>
                        <Text style={[styles.leagueName, { color: t.textPrimary }]} numberOfLines={1}>
                          {l.nameAr}
                        </Text>
                        <TouchableOpacity
                          onPress={() => toggleLeague(l.competitionId)}
                          accessibilityRole="button"
                          accessibilityLabel={`إلغاء متابعة ${l.nameAr}`}
                          style={styles.starTap}
                        >
                          <Ionicons name="star" size={16} color={t.accent} />
                        </TouchableOpacity>
                      </View>
                      {(
                        [
                          ['notifyKickoff', 'تنبيه انطلاق المباريات'],
                          ['notifyFinal', 'تنبيه النتائج النهائية'],
                        ] as const
                      ).map(([key, label]) => (
                        <View key={key} style={styles.switchRow}>
                          <Text style={[styles.switchLabel, { color: t.textSecondary }]} numberOfLines={1}>
                            {label}
                          </Text>
                          <Switch
                            value={l[key]}
                            onValueChange={(v) => setLeagueSwitch(l.competitionId, key, v)}
                            trackColor={{ true: t.accent, false: t.borderLight }}
                            accessibilityLabel={`${label} — ${l.nameAr}`}
                          />
                        </View>
                      ))}
                    </View>
                  ))}
                  {leagues.length === 0 ? (
                    <Text style={[styles.emptyBody, { color: t.textMuted }]}>
                      لم تتابع بطولة بعد.
                    </Text>
                  ) : null}
                </View>
            </>
          </ScrollView>
        )}
        <AccountGateSheet t={t} gate={gate} message="عشان تتابع فرقك" />
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
  title: { flex: 1, textAlign: 'center', fontFamily: 'Cairo_700Bold', fontSize: 17 },
  list: { padding: 12, paddingBottom: 40 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  searchInput: { flex: 1, fontFamily: 'Cairo_400Regular', fontSize: 13, paddingVertical: 8 },
  // A horizontal strip inside a column flex needs its own height, or it eats the
  // rest of the screen (the bug that once left the filters invisible).
  pillsScroll: { flexGrow: 0, flexShrink: 0, marginTop: 10 },
  pillsRow: { gap: 8, paddingBottom: 4 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  pillText: { fontFamily: 'Cairo_700Bold', fontSize: 12 },
  sectionHeadline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 8,
    gap: 8,
  },
  sectionTitle: { fontFamily: 'Cairo_700Bold', fontSize: 14, flexShrink: 1 },
  counter: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
  followCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
    gap: 12,
    marginBottom: 10,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  cardRail: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 4 },
  followedTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  crestInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  crestWell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  flagBig: { fontSize: 22 },
  nameBox: { flexShrink: 1 },
  followedName: { fontFamily: 'Cairo_700Bold', fontSize: 15 },
  followedSub: { fontFamily: 'Cairo_400Regular', fontSize: 11, marginTop: 2 },
  unfollowBtn: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 4 },
  unfollowText: { fontFamily: 'Cairo_700Bold', fontSize: 11 },
  nextPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  nextLabel: { fontFamily: 'Cairo_700Bold', fontSize: 11 },
  nextDetails: { fontFamily: 'Cairo_600SemiBold', fontSize: 11, flexShrink: 1, textAlign: 'left' },
  togglesBar: { flexDirection: 'row', borderRadius: 12, paddingVertical: 6, paddingHorizontal: 4 },
  toggleCell: { flex: 1, alignItems: 'center', gap: 4 },
  toggleLabel: { fontFamily: 'Cairo_700Bold', fontSize: 10, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // Two per row on a 360dp phone: (360 - 24 padding - 10 gap) / 2 = 163.
  addCard: {
    width: '48%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
    gap: 6,
  },
  addName: { fontFamily: 'Cairo_700Bold', fontSize: 13, textAlign: 'center' },
  addSub: { fontFamily: 'Cairo_400Regular', fontSize: 10, textAlign: 'center' },
  addBtn: {
    marginTop: 2,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  addBtnText: { fontFamily: 'Cairo_700Bold', fontSize: 11 },
  hint: { fontFamily: 'Cairo_400Regular', fontSize: 11, lineHeight: 18 },
  leagueGrid: { gap: 8, marginTop: 8 },
  leagueCard: { borderRadius: 16, padding: 12, gap: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  leagueName: { fontFamily: 'Cairo_700Bold', fontSize: 14, flexShrink: 1 },
  starTap: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 2,
  },
  switchLabel: { fontFamily: 'Cairo_400Regular', fontSize: 12, flexShrink: 1 },
  error: { fontFamily: 'Cairo_400Regular', fontSize: 12, marginTop: 8, textAlign: 'center' },
  gateBox: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 10,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  emptyBody: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 13,
    lineHeight: 21,
    textAlign: 'center',
    paddingHorizontal: 8,
    marginTop: 4,
  },
  primary: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 11, borderRadius: 16 },
  primaryText: { color: '#FFFFFF', fontFamily: 'Cairo_700Bold', fontSize: 14 },
});
