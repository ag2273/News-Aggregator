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
import { palette } from '../constants/colors';
import type { Theme } from '../constants/colors';
import { useAuth } from '../lib/auth';
import { useAccountGate } from '../components/AccountGate';
import {
  fetchDigestPrefs,
  saveDigestTopics,
  DIGEST_TOPIC_LABEL,
  type DigestTopic,
} from '../lib/api';

/**
 * اختيار مواضيع الخلاصة.
 *
 * Which sections the reader gets in their twice-daily digest. Sport starts off
 * because it is the highest-volume, lowest-signal category, so a first digest is
 * worth reading. Saving an empty selection is allowed and respected.
 */
export default function DigestTopicsScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { token, user, loading: authLoading, emailVerified } = useAuth();
  const gate = useAccountGate();

  const [available, setAvailable] = useState<DigestTopic[]>([]);
  const [chosen, setChosen] = useState<Set<DigestTopic>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The server gates this on a verified account. Check before requesting, so an
  // unverified reader never hits a 403 that renders as a generic error.
  const mayLoad = Boolean(user && emailVerified);

  const load = useCallback(async () => {
    if (!token || !mayLoad) {
      setLoading(false);
      return;
    }
    try {
      const prefs = await fetchDigestPrefs(token);
      setAvailable(prefs.available);
      setChosen(new Set(prefs.topics));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر تحميل المواضيع');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load, mayLoad]);

  const toggle = (topic: DigestTopic) => {
    setSaved(false);
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  };

  const save = async () => {
    if (!token || saving) return;
    setSaving(true);
    setError(null);
    try {
      const topics = await saveDigestTopics(token, [...chosen]);
      setChosen(new Set(topics));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="رجوع"
        style={styles.back}
      >
        <Ionicons name="chevron-forward" size={22} color={t.textPrimary} />
      </TouchableOpacity>
      <Text style={[styles.title, { color: t.textPrimary }]}>مواضيع الخلاصة</Text>
      <View style={styles.back} />
    </View>
  );

  if (authLoading) {
    return (
      <View style={[styles.center, { backgroundColor: t.surface }]}>
        <ActivityIndicator size="large" color={t.accent} />
      </View>
    );
  }

  // The server gates this on a verified account, so show the same gate rather
  // than a toggle that would fail on save.
  if (!user || !emailVerified) {
    return (
      <View style={[styles.center, { backgroundColor: t.surface }]}>
        <Ionicons name="lock-closed-outline" size={28} color={t.textMuted} />
        <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>وثّق بريدك أولاً</Text>
        <TouchableOpacity
          style={[styles.save, { backgroundColor: t.accent, paddingHorizontal: 24, width: 'auto' }]}
          onPress={() => gate.openWith('verify')}
          accessibilityRole="button"
        >
          <Text style={styles.saveText}>توثيق الحساب</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <LinearGradient
      colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]}
      style={styles.root}
    >
      <SafeAreaView style={styles.safe} edges={['top']}>
        {header}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={t.accent} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={[styles.intro, { color: t.textMuted }]}>
              اختار المواضيع اللي تهمك، وهتشوفها بس في خلاصتك. الخلاصة بتتجهز يوميًا
              الساعة ٩ صباحًا و٦ مساءً.
            </Text>

            {available.map((topic) => {
              const on = chosen.has(topic);
              return (
                <TouchableOpacity
                  key={topic}
                  style={[styles.row, { backgroundColor: t.surface }]}
                  onPress={() => toggle(topic)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={DIGEST_TOPIC_LABEL[topic]}
                >
                  <Text style={[styles.rowText, { color: t.textPrimary }]}>
                    {DIGEST_TOPIC_LABEL[topic]}
                  </Text>
                  <Switch
                    value={on}
                    onValueChange={() => toggle(topic)}
                    trackColor={{ true: t.accent, false: t.borderLight }}
                  />
                </TouchableOpacity>
              );
            })}

            {error ? <Text style={[styles.error, { color: t.breaking }]}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.save, { backgroundColor: t.accent }, saving && styles.disabled]}
              onPress={save}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="حفظ المواضيع"
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.saveText}>{saved ? 'تم الحفظ ✓' : 'حفظ'}</Text>
              )}
            </TouchableOpacity>

            {chosen.size === 0 ? (
              <Text style={[styles.warn, { color: t.textMuted }]}>
                مفيش مواضيع مختارة — الخلاصة هتكون فاضية.
              </Text>
            ) : null}
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
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
  },
  back: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '700' },
  list: { padding: 16, gap: 10, paddingBottom: 32 },
  intro: { fontSize: 13, lineHeight: 22, marginBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowText: { fontSize: 15, fontWeight: '600' },
  save: {
    marginTop: 18,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.6 },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  error: { fontSize: 12, marginTop: 6 },
  warn: { fontSize: 11, marginTop: 10, lineHeight: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
});
