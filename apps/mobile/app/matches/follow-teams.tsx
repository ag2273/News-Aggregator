import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
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
import { useAccountGate } from '../../components/AccountGate';
import {
  fetchTeamFollows,
  followFootballTeam,
  unfollowFootballTeam,
  setFootballTeamNotify,
  POPULAR_TEAMS,
  type TeamFollow,
} from '../../lib/api';

/**
 * متابعة الفرق.
 *
 * Follows are account-bound, so the screen gates exactly like following a source.
 * The three notification switches default on, and are per team.
 */
export default function FollowTeamsScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { token, user, loading: authLoading, emailVerified } = useAuth();
  const gate = useAccountGate();

  const [follows, setFollows] = useState<TeamFollow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      setFollows(await fetchTeamFollows(token));
    } catch {
      setError('تعذّر تحميل الفرق المتابعة.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (team: string) => {
    if (!token || busy) return;
    setBusy(team);
    setError(null);
    try {
      const followed = follows.some((f) => f.name === team);
      setFollows(
        followed ? await unfollowFootballTeam(token, team) : await followFootballTeam(token, team),
      );
    } catch {
      setError('تعذّر تحديث المتابعة.');
    } finally {
      setBusy(null);
    }
  };

  const setNotify = async (team: string, key: 'notifyKickoff' | 'notifyGoals' | 'notifyFinal', value: boolean) => {
    if (!token) return;
    try {
      const updated = await setFootballTeamNotify(token, team, { [key]: value });
      setFollows((list) => list.map((f) => (f.name === team ? updated : f)));
    } catch {
      setError('تعذّر حفظ التنبيهات.');
    }
  };

  if (!authLoading && (!user || !emailVerified)) {
    return (
      <LinearGradient colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]} style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.center}>
            <Ionicons name="lock-closed-outline" size={28} color={t.textMuted} />
            <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>وثّق بريدك أولاً</Text>
            <Text style={[styles.emptyBody, { color: t.textMuted }]}>
              متابعة الفرق مرتبطة بحسابك، زي متابعة المصادر.
            </Text>
            <TouchableOpacity style={[styles.primary, { backgroundColor: t.accent }]} onPress={() => gate.openWith('verify')} accessibilityRole="button">
              <Text style={styles.primaryText}>توثيق الحساب</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="رجوع">
            <Ionicons name="chevron-forward" size={22} color={t.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: t.textPrimary }]}>متابعة الفرق</Text>
          <View style={styles.headerBtn} />
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={t.accent} /></View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={[styles.section, { color: t.textMuted }]}>الأندية الأكثر شعبية</Text>
            <View style={styles.chips}>
              {POPULAR_TEAMS.map((team) => {
                const on = follows.some((f) => f.name === team);
                return (
                  <TouchableOpacity
                    key={team}
                    onPress={() => toggle(team)}
                    style={[styles.chip, { backgroundColor: on ? t.accent : t.pillInactiveBg }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={team}
                  >
                    <Text style={[styles.chipText, { color: on ? '#FFFFFF' : t.textSecondary }]}>
                      {busy === team ? '…' : team}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {error ? <Text style={[styles.error, { color: t.breaking }]}>{error}</Text> : null}

            <Text style={[styles.section, { color: t.textMuted }]}>فرقك المتابعة وتنبيهاتها</Text>
            {follows.length === 0 ? (
              <Text style={[styles.emptyBody, { color: t.textMuted }]}>
                لم تتابع أي فريق بعد — اختر من الأعلى.
              </Text>
            ) : (
              follows.map((f) => (
                <View key={f.name} style={[styles.card, { backgroundColor: t.surface }]}>
                  <View style={styles.cardHead}>
                    <Text style={[styles.teamName, { color: t.textPrimary }]}>{f.name}</Text>
                    <TouchableOpacity onPress={() => toggle(f.name)} accessibilityRole="button" accessibilityLabel={`إلغاء متابعة ${f.name}`}>
                      <Ionicons name="star" size={18} color={t.accent} />
                    </TouchableOpacity>
                  </View>
                  {(
                    [
                      ['notifyKickoff', 'إشعار انطلاق المباراة'],
                      ['notifyGoals', 'إشعار الأهداف'],
                      ['notifyFinal', 'إشعار النتيجة النهائية'],
                    ] as const
                  ).map(([key, label]) => (
                    <View key={key} style={styles.switchRow}>
                      <Text style={[styles.switchLabel, { color: t.textSecondary }]}>{label}</Text>
                      <Switch
                        value={f[key]}
                        onValueChange={(v) => setNotify(f.name, key, v)}
                        trackColor={{ true: t.accent, false: t.borderLight }}
                        accessibilityLabel={label}
                      />
                    </View>
                  ))}
                </View>
              ))
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
  list: { padding: 14, gap: 8, paddingBottom: 40 },
  section: { fontSize: 12, fontWeight: '700', marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 15 },
  chipText: { fontSize: 13, fontWeight: '600' },
  card: { borderRadius: 16, padding: 14, gap: 6, marginTop: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  teamName: { fontSize: 15, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 },
  switchLabel: { fontSize: 13 },
  error: { fontSize: 12, marginTop: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  emptyTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptyBody: { fontSize: 13, lineHeight: 21, textAlign: 'center' },
  primary: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 11, borderRadius: 16 },
  primaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});
