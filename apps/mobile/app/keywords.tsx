import React, { useCallback, useEffect, useState } from 'react';
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
import { palette } from '../constants/colors';
import type { Theme } from '../constants/colors';
import { useAuth } from '../lib/auth';
import { VerifyBanner } from '../components/VerifyBanner';
import {
  fetchPreferences,
  addFollowedKeyword,
  removeFollowedKeyword,
  setKeywordNotify as apiSetKeywordNotify,
  mute,
  unmute,
  isEmailNotVerified,
  type KeywordPrefs,
} from '../lib/api';

/**
 * Followed keywords and muted content, per the batch-2 design: one screen with
 * two sections, reached from حسابي. Verified accounts only (the server gates it).
 */
export default function KeywordsScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { token, user, loading: authLoading, emailVerified } = useAuth();

  const [prefs, setPrefs] = useState<KeywordPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newKeyword, setNewKeyword] = useState('');
  const [newMute, setNewMute] = useState('');

  const load = useCallback(async () => {
    if (!token || !emailVerified) {
      setLoading(false);
      return;
    }
    try {
      setError(null);
      setPrefs(await fetchPreferences(token));
    } catch (err) {
      setError(
        isEmailNotVerified(err)
          ? 'التفضيلات متاحة بعد توثيق بريدك.'
          : 'تعذّر تحميل التفضيلات. حاول مرة أخرى.',
      );
    } finally {
      setLoading(false);
    }
  }, [token, emailVerified]);

  useEffect(() => {
    if (authLoading) return;
    load();
  }, [authLoading, load]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (token) setPrefs(await fetchPreferences(token));
    } catch (err) {
      setError(
        isEmailNotVerified(err)
          ? 'التفضيلات متاحة بعد توثيق بريدك.'
          : 'تعذّر حفظ التغيير. حاول مرة أخرى.',
      );
    } finally {
      setBusy(false);
    }
  };

  const onAdd = () =>
    run(async () => {
      if (!token || !newKeyword.trim()) return;
      await addFollowedKeyword(token, newKeyword.trim());
      setNewKeyword('');
    });

  const onMuteAdd = () =>
    run(async () => {
      if (!token || !newMute.trim()) return;
      await mute(token, { keyword: newMute.trim() });
      setNewMute('');
    });

  const keywordCount = prefs?.keywords.length ?? 0;
  const limit = prefs?.limits.keywords ?? 20;

  if (!authLoading && !user) {
    return (
      <LinearGradient colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]} style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <Header t={t} title="تفضيلات المحتوى والكتم" />
          <View style={styles.center}>
            <Text style={[styles.muted, { color: t.textMuted }]}>
              سجّل الدخول لإدارة الكلمات والكتم
            </Text>
          </View>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header t={t} title="تفضيلات المحتوى والكتم" />

        <VerifyBanner t={t} />

        {!emailVerified ? (
          <View style={styles.center}>
            <Ionicons name="lock-closed-outline" size={36} color={t.textMuted} />
            <Text style={[styles.muted, { color: t.textMuted }]}>
              الكلمات والكتم متاحة بعد توثيق بريدك.
            </Text>
          </View>
        ) : loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={t.accent} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {/* Followed keywords */}
            <Text style={[styles.sectionLabel, { color: t.textSecondary }]}>
              {`كلمات أتابعها (${keywordCount} من ${limit})`}
            </Text>

            <View style={[styles.card, { backgroundColor: t.surface }]}>
              <View style={styles.inputRow}>
                <TouchableOpacity
                  style={[
                    styles.addBtn,
                    { backgroundColor: t.accent },
                    (!newKeyword.trim() || busy) && styles.disabled,
                  ]}
                  onPress={onAdd}
                  disabled={!newKeyword.trim() || busy}
                  accessibilityRole="button"
                  accessibilityLabel="إضافة كلمة"
                >
                  <Ionicons name="add" size={18} color="#FFFFFF" />
                </TouchableOpacity>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: t.surfaceSubtle,
                      borderColor: t.borderLight,
                      color: t.textPrimary,
                    },
                  ]}
                  value={newKeyword}
                  onChangeText={setNewKeyword}
                  placeholder="أدخل كلمة للمتابعة..."
                  placeholderTextColor={t.textMuted}
                  textAlign="right"
                />
              </View>

              {prefs?.keywords.length ? (
                prefs.keywords.map((k) => (
                  <View key={k.keyword} style={[styles.row, { borderColor: t.borderLight }]}>
                    <TouchableOpacity
                      onPress={() => run(async () => {
                        if (!token) return;
                        await removeFollowedKeyword(token, k.keyword);
                      })}
                      accessibilityRole="button"
                      accessibilityLabel={`حذف ${k.label}`}
                      style={styles.removeBtn}
                    >
                      <Ionicons name="close" size={16} color={t.textMuted} />
                    </TouchableOpacity>

                    <Switch
                      value={k.notify}
                      onValueChange={(v) => run(async () => {
                        if (!token) return;
                        await apiSetKeywordNotify(token, k.keyword, v);
                      })}
                      trackColor={{ false: t.borderLight, true: t.accent }}
                      accessibilityLabel={`إشعارات ${k.label}`}
                    />

                    <Text style={[styles.rowLabel, { color: t.textPrimary }]} numberOfLines={1}>
                      {k.label}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={[styles.empty, { color: t.textMuted }]}>
                  لم تتابع أي كلمة بعد. أضف كلمة لتصلك الأخبار اللي تخصها.
                </Text>
              )}
            </View>

            {/* Muted content */}
            <Text style={[styles.sectionLabel, { color: t.textSecondary }]}>المحتوى المكتوم</Text>

            <View style={[styles.card, { backgroundColor: t.surface }]}>
              <Text style={[styles.subLabel, { color: t.textMuted }]}>
                {`الكلمات المكتومة (${prefs?.mutedKeywords.length ?? 0})`}
              </Text>
              <View style={styles.inputRow}>
                <TouchableOpacity
                  style={[
                    styles.addBtn,
                    { backgroundColor: t.textMuted },
                    (!newMute.trim() || busy) && styles.disabled,
                  ]}
                  onPress={onMuteAdd}
                  disabled={!newMute.trim() || busy}
                  accessibilityRole="button"
                  accessibilityLabel="كتم كلمة"
                >
                  <Ionicons name="add" size={18} color="#FFFFFF" />
                </TouchableOpacity>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: t.surfaceSubtle,
                      borderColor: t.borderLight,
                      color: t.textPrimary,
                    },
                  ]}
                  value={newMute}
                  onChangeText={setNewMute}
                  placeholder="كلمة تتكتم من الأخبار..."
                  placeholderTextColor={t.textMuted}
                  textAlign="right"
                />
              </View>

              <View style={styles.chips}>
                {prefs?.mutedKeywords.map((k) => (
                  <TouchableOpacity
                    key={k}
                    style={[styles.chip, { backgroundColor: t.pillInactiveBg }]}
                    onPress={() => run(async () => {
                      if (!token) return;
                      await unmute(token, { keyword: k });
                    })}
                    accessibilityRole="button"
                    accessibilityLabel={`إلغاء كتم ${k}`}
                  >
                    <Text style={[styles.chipText, { color: t.textSecondary }]}>{k}</Text>
                    <Ionicons name="close" size={12} color={t.textMuted} />
                  </TouchableOpacity>
                ))}
                {!prefs?.mutedKeywords.length ? (
                  <Text style={[styles.empty, { color: t.textMuted }]}>لا توجد كلمات مكتومة</Text>
                ) : null}
              </View>

              <View style={[styles.divider, { backgroundColor: t.borderLight }]} />

              <Text style={[styles.subLabel, { color: t.textMuted }]}>
                {`المصادر المكتومة (${prefs?.mutedSources.length ?? 0})`}
              </Text>
              <View style={styles.chips}>
                {prefs?.mutedSources.map((id) => (
                  <TouchableOpacity
                    key={id}
                    style={[styles.chip, { backgroundColor: t.pillInactiveBg }]}
                    onPress={() => run(async () => {
                      if (!token) return;
                      await unmute(token, { sourceId: id });
                    })}
                    accessibilityRole="button"
                    accessibilityLabel={`إلغاء كتم المصدر ${id}`}
                  >
                    <Text style={[styles.chipText, { color: t.textSecondary }]}>{id}</Text>
                    <Ionicons name="close" size={12} color={t.textMuted} />
                  </TouchableOpacity>
                ))}
                {!prefs?.mutedSources.length ? (
                  <Text style={[styles.empty, { color: t.textMuted }]}>
                    لا توجد مصادر مكتومة. تقدر تكتم مصدر من قائمة ⋯ في الكارت.
                  </Text>
                ) : null}
              </View>
            </View>

            {busy ? <ActivityIndicator style={styles.busy} color={t.accent} /> : null}

            {error ? (
              <View style={[styles.errorToast, { backgroundColor: t.breaking }]}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

function Header({ t, title }: { t: Theme; title: string }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={() => router.back()}
        style={[styles.circleBtn, { backgroundColor: t.surface }]}
        accessibilityRole="button"
        accessibilityLabel="رجوع"
      >
        <Ionicons name="arrow-forward" size={18} color={t.textPrimary} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: t.textPrimary }]}>{title}</Text>
      <View style={styles.circleSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitle: { fontFamily: 'Cairo_700Bold', fontSize: 16 },
  circleBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  circleSpacer: { width: 38 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  muted: { fontFamily: 'Cairo_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  sectionLabel: { fontFamily: 'Cairo_600SemiBold', fontSize: 13, marginTop: 18, marginBottom: 8, paddingHorizontal: 4 },
  subLabel: { fontFamily: 'Cairo_600SemiBold', fontSize: 12, marginBottom: 8 },
  card: { borderRadius: 20, padding: 14 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontFamily: 'Cairo_400Regular',
    fontSize: 13,
  },
  addBtn: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    marginTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { flex: 1, fontFamily: 'Cairo_600SemiBold', fontSize: 13 },
  removeBtn: { padding: 4 },
  empty: { fontFamily: 'Cairo_400Regular', fontSize: 12, lineHeight: 20, paddingVertical: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  chipText: { fontFamily: 'Cairo_600SemiBold', fontSize: 12 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  busy: { marginTop: 16 },
  errorToast: { marginTop: 16, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  errorText: { fontFamily: 'Cairo_600SemiBold', color: '#FFFFFF', fontSize: 12 },
});
