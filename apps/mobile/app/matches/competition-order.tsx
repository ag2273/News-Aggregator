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
  fetchCompetitionOrder,
  fetchCompetitions,
  resetCompetitionOrder,
  saveCompetitionOrder,
  type FootballCompetition,
} from '../../lib/api';

/**
 * ترتيب البطولات (#26) — the reorder sheet, drawn to the approved preview.
 *
 * The preview specifies: a tinted hero banner, one row per league with a rank badge
 * (the first row's badge in accent), ▲▼ arrows for instant movement, a drag handle
 * for the gesture, then Save and Reset. 44px touch targets because the whole point is
 * a phone at 360dp.
 *
 * The backend already serves and stores the order (#26). This screen is the surface
 * for it: it edits a local copy, and only writes when the reader asks — an accidental
 * drag should not silently reorder their board.
 */

/** Emoji flag per country, matching how the rest of the app badges competitions. */
const COUNTRY_FLAG: Record<string, string> = {
  EG: '🇪🇬',
  GB: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  ES: '🇪🇸',
  IT: '🇮🇹',
  DE: '🇩🇪',
  FR: '🇫🇷',
  SA: '🇸🇦',
  AF: '🌍',
  EU: '🏆',
};

export default function CompetitionOrderScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { token, loading: authLoading } = useAuth();
  const gate = useAccountGate();

  const [competitions, setCompetitions] = useState<FootballCompetition[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  /** The saved order as the server has it, so "unsaved changes" is honest. */
  const [saved, setSaved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, current] = await Promise.all([
        fetchCompetitions(token),
        fetchCompetitionOrder(token),
      ]);
      setCompetitions(list);
      // A reader who never arranged one starts from the served order, which IS the
      // default — so the screen opens showing what they already see elsewhere.
      const initial = current.order.length ? current.order : list.map((c) => c.id);
      setOrder(initial);
      setSaved(current.order);
    } catch {
      setError('تعذّر تحميل الترتيب.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const byId = useMemo(() => {
    const map = new Map<string, FootballCompetition>();
    for (const c of competitions) map.set(c.id, c);
    return map;
  }, [competitions]);

  /** Move a row by one, in the direction the arrow points. */
  const move = (index: number, delta: -1 | 1) => {
    setOrder((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setSavedFlash(false);
  };

  /** The order this screen would save: the ranked ids, then anything unranked. */
  const effectiveOrder = useMemo(() => {
    const ranked = order.filter((id) => byId.has(id));
    const rest = competitions.map((c) => c.id).filter((id) => !ranked.includes(id));
    return [...ranked, ...rest];
  }, [order, byId, competitions]);

  const dirty = useMemo(
    () => effectiveOrder.join('|') !== (saved.length ? saved.join('|') : ''),
    [effectiveOrder, saved],
  );

  const save = async () => {
    if (!token) {
      gate.open();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await saveCompetitionOrder(token, effectiveOrder);
      setSaved(result.order);
      setSavedFlash(true);
    } catch {
      setError('تعذّر حفظ الترتيب.');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!token) {
      gate.open();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetCompetitionOrder(token);
      // The server now serves the default; re-read it rather than assuming.
      await load();
    } catch {
      setError('تعذّر إرجاع الترتيب الافتراضي.');
    } finally {
      setBusy(false);
    }
  };

  const gatedOut = !authLoading && !token;

  const row = (id: string, index: number) => {
    const comp = byId.get(id);
    if (!comp) return null;
    const first = index === 0;
    return (
      <View
        key={id}
        style={[
          styles.rowItem,
          first
            ? { borderWidth: 1.5, borderColor: t.accentBorder, backgroundColor: t.surfaceElevated }
            : { borderWidth: 1, borderColor: t.borderLight, backgroundColor: t.surface },
        ]}
      >
        <View
          style={[
            styles.rankBadge,
            first
              ? { backgroundColor: t.accent }
              : { backgroundColor: t.badgePlate },
          ]}
        >
          <Text style={[styles.rankText, { color: first ? t.accentInk : t.textPrimary }]}>
            {index + 1}
          </Text>
        </View>

        <View style={styles.leagueInfo}>
          <Text style={styles.flag}>{COUNTRY_FLAG[comp.country] ?? '⚽'}</Text>
          <Text style={[styles.leagueName, { color: t.textPrimary }]} numberOfLines={1}>
            {comp.nameAr}
          </Text>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity
            onPress={() => move(index, -1)}
            disabled={index === 0}
            style={[
              styles.arrowBtn,
              { borderColor: t.borderLight, opacity: index === 0 ? 0.35 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`تحريك ${comp.nameAr} لأعلى`}
          >
            <Text style={[styles.arrowText, { color: t.textSecondary }]}>▲</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => move(index, 1)}
            disabled={index === order.length - 1}
            style={[
              styles.arrowBtn,
              { borderColor: t.borderLight, opacity: index === order.length - 1 ? 0.35 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`تحريك ${comp.nameAr} لأسفل`}
          >
            <Text style={[styles.arrowText, { color: t.textSecondary }]}>▼</Text>
          </TouchableOpacity>
          {/* The preview's drag handle. Arrows are the accessible path; the handle is
              the visual affordance the design draws beside them. */}
          <View style={[styles.handle, { backgroundColor: t.badgePlate }]}>
            <Text style={[styles.handleText, { color: t.textDim }]}>⋮⋮</Text>
          </View>
        </View>
      </View>
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
            accessibilityLabel="إغلاق"
          >
            <Ionicons name="close" size={18} color={t.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: t.textPrimary }]} numberOfLines={1}>
            ترتيب البطولات
          </Text>
          <View style={styles.headerBtn} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={t.accent} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
            {/* The preview's hero banner, verbatim in structure. */}
            <View style={[styles.hero, { borderColor: t.accentBorder }]}>
              <Text style={[styles.heroTitle, { color: t.accent }]}>⇅ رتّب البطولات حسب اهتمامك</Text>
              <Text style={[styles.heroBody, { color: t.textSecondary }]}>
                البطولات في الأعلى تظهر أولاً في جدول المباريات. استخدم ▲ ▼ للتحريك الفوري.
              </Text>
            </View>

            {gatedOut ? (
              <View style={[styles.gateBox, { backgroundColor: t.accentSoft, borderColor: t.accentBorder }]}>
                <Ionicons name="lock-closed-outline" size={20} color={t.textMuted} />
                <Text style={[styles.gateText, { color: t.textMuted }]}>
                  الترتيب محفوظ مع حسابك عشان يفضل معاك على أي جهاز. سجّل دخولك الأول.
                </Text>
                <TouchableOpacity
                  style={[styles.gateBtn, { backgroundColor: t.accent }]}
                  onPress={gate.open}
                  accessibilityRole="button"
                >
                  <Text style={styles.gateBtnText}>تسجيل الدخول</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {error ? (
              <Text style={[styles.error, { color: t.liveRed }]}>{error}</Text>
            ) : null}

            {effectiveOrder.map(row)}

            {/* Save and reset, as the preview draws them. */}
            <View style={styles.actions}>
              <TouchableOpacity
                onPress={save}
                disabled={busy || !dirty || gatedOut}
                style={[
                  styles.saveBtn,
                  { backgroundColor: t.accent, opacity: busy || !dirty || gatedOut ? 0.5 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="حفظ الترتيب"
              >
                <Text style={[styles.saveText, { color: t.accentInk }]}>
                  {busy ? '…' : dirty ? 'حفظ الترتيب' : savedFlash ? '✓ محفوظ' : 'محفوظ'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={reset}
                disabled={busy || gatedOut}
                style={[styles.resetBtn, { borderColor: t.borderLight }]}
                accessibilityRole="button"
                accessibilityLabel="استعادة الترتيب الافتراضي"
              >
                <Text style={[styles.resetText, { color: t.textSecondary }]}>
                  استعادة الافتراضي
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
        <AccountGateSheet t={t} gate={gate} message="عشان ترتّب بطولاتك" />
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
  list: { padding: 12, paddingBottom: 40, gap: 6 },
  // The preview's hero: tinted surface, accent border, 12px radius.
  hero: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
    backgroundColor: 'transparent',
  },
  heroTitle: { fontFamily: 'Cairo_700Bold', fontSize: 12.5 },
  heroBody: { fontFamily: 'Cairo_400Regular', fontSize: 10.5, lineHeight: 16 },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: 7,
    paddingHorizontal: 10,
    gap: 8,
    // The preview's 44px touch target.
    minHeight: 44,
  },
  rankBadge: { width: 22, height: 22, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontFamily: 'Cairo_700Bold', fontSize: 11 },
  leagueInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6 },
  flag: { fontSize: 13 },
  leagueName: { fontFamily: 'Cairo_700Bold', fontSize: 12, flexShrink: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  arrowBtn: {
    width: 26,
    height: 30,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowText: { fontSize: 9 },
  handle: { width: 28, height: 34, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  handleText: { fontSize: 14 },
  actions: { gap: 6, paddingTop: 4, marginTop: 4 },
  saveBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  saveText: { fontFamily: 'Cairo_700Bold', fontSize: 12.5 },
  resetBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  resetText: { fontFamily: 'Cairo_700Bold', fontSize: 11 },
  error: { fontFamily: 'Cairo_400Regular', fontSize: 12, textAlign: 'center', marginTop: 6 },
  gateBox: { alignItems: 'center', gap: 8, padding: 14, borderRadius: 14, borderWidth: 1 },
  gateText: { fontFamily: 'Cairo_400Regular', fontSize: 12, lineHeight: 19, textAlign: 'center' },
  gateBtn: { paddingHorizontal: 22, paddingVertical: 10, borderRadius: 14 },
  gateBtnText: { fontFamily: 'Cairo_700Bold', fontSize: 13, color: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
