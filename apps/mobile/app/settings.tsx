import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
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
import { VerifyBanner } from '../components/VerifyBanner';
import {
  PushError,
  getPermissionStatus,
  registerDevice,
  requestPermissions,
  updatePrefs,
  type PermissionStatus,
  type PushFailureKind,
  type PushMode,
} from '../lib/notifications';

/** What we know about this device's push state. */
type DeviceState =
  | { status: 'loading' }
  | { status: 'ready' }
  /** The build cannot mint a push token at all (no Firebase/FCM wiring). */
  | { status: 'unavailable' }
  /** Network/auth/server trouble; retrying can help. */
  | { status: 'error'; kind: PushFailureKind };

export default function SettingsScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { user, token, loading: authLoading, emailVerified } = useAuth();

  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<PushMode>('urgent');
  /** The twice-daily digest, on unless explicitly turned off. */
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [permission, setPermission] = useState<PermissionStatus | null>(null);
  const [device, setDevice] = useState<DeviceState>({ status: 'loading' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshPermission = useCallback(async () => {
    try {
      setPermission(await getPermissionStatus());
    } catch {
      setPermission(null);
    }
  }, []);

  /**
   * Make sure this device is registered, then read its stored preferences.
   * A token-fetch failure is a build/config problem, not a connection problem,
   * and is reported as such.
   */
  const loadPrefs = useCallback(async () => {
    if (!token) return;
    if (!emailVerified) {
      // The server would answer 403; show the reason instead of an error.
      setDevice({ status: 'ready' });
      return;
    }
    setError(null);
    setDevice({ status: 'loading' });
    try {
      const registered = await registerDevice(token);
      setEnabled(registered.enabled);
      setMode(registered.mode);
      setDigestEnabled(registered.digestEnabled !== false);
      setDevice({ status: 'ready' });
    } catch (err) {
      const pushErr = err instanceof PushError ? err : null;
      const kind: PushFailureKind = pushErr?.kind ?? 'unknown';
      if (kind === 'config') {
        setDevice({ status: 'unavailable' });
      } else {
        setDevice({ status: 'error', kind });
        setError(pushErr?.message ?? 'تعذّر تحميل إعدادات الإشعارات.');
      }
    }
  }, [token, emailVerified]);

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setDevice({ status: 'ready' });
      return;
    }
    (async () => {
      await refreshPermission();
      await loadPrefs();
    })();
  }, [authLoading, token, loadPrefs, refreshPermission]);

  const persist = async (next: {
    enabled?: boolean;
    mode?: PushMode;
    digestEnabled?: boolean;
  }) => {
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updatePrefs(token, next);
      setEnabled(saved.enabled);
      setMode(saved.mode);
      setDigestEnabled(saved.digestEnabled !== false);
      setDevice({ status: 'ready' });
    } catch (err) {
      const pushErr = err instanceof PushError ? err : null;
      const kind: PushFailureKind = pushErr?.kind ?? 'unknown';
      if (kind === 'config') {
        setDevice({ status: 'unavailable' });
      } else {
        setDevice({ status: 'error', kind });
        setError(pushErr?.message ?? 'تعذّر حفظ التفضيلات.');
      }
    } finally {
      setSaving(false);
    }
  };

  const onToggleEnabled = async (value: boolean) => {
    if (value) {
      // Turning on requires OS permission; reflect a denial immediately.
      const granted = await requestPermissions();
      await refreshPermission();
      if (!granted) {
        setEnabled(false);
        setError('إذن الإشعارات مرفوض. فعّله من إعدادات النظام.');
        return;
      }
    }
    await persist({ enabled: value });
  };

  const onSelectMode = async (next: PushMode) => {
    if (next === mode) return;
    await persist({ mode: next });
  };

  const unavailable = device.status === 'unavailable';
  const loadingPrefs = device.status === 'loading';

  if (!authLoading && !user) {
    return (
      <LinearGradient
        colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]}
        style={styles.root}
      >
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={[styles.circleBtn, { backgroundColor: t.surface }]}
              accessibilityRole="button"
              accessibilityLabel="رجوع"
            >
              <Ionicons name="arrow-forward" size={18} color={t.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: t.textPrimary }]}>الإشعارات</Text>
            <View style={styles.circleSpacer} />
          </View>

          <View style={styles.center}>
            <Text style={[styles.muted, { color: t.textMuted }]}>
              سجّل الدخول لإدارة إعدادات الإشعارات
            </Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: t.accent }]}
              onPress={() => router.push('/login')}
              accessibilityRole="button"
            >
              <Text style={styles.primaryBtnText}>تسجيل الدخول</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]}
      style={styles.root}
    >
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.circleBtn, { backgroundColor: t.surface }]}
            accessibilityRole="button"
            accessibilityLabel="رجوع"
          >
            <Ionicons name="arrow-forward" size={18} color={t.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: t.textPrimary }]}>الإشعارات</Text>
          <View style={styles.circleSpacer} />
        </View>

        <VerifyBanner t={t} />

        {!emailVerified ? (
          <View style={styles.content}>
            <View style={[styles.card, { backgroundColor: t.surface }]}>
              <View style={styles.row}>
                <Ionicons name="lock-closed-outline" size={22} color={t.textMuted} />
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, { color: t.textPrimary }]}>
                    الإشعارات متاحة بعد توثيق بريدك
                  </Text>
                  <Text style={[styles.rowSub, { color: t.textMuted }]}>
                    وثّق بريدك من الأعلى، ثم ستُفعَّل الإشعارات تلقائيًا.
                  </Text>
                </View>
              </View>
            </View>
          </View>
        ) : loadingPrefs && !unavailable ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={t.accent} />
          </View>
        ) : (
          <View style={styles.content}>
            {unavailable ? (
              <View style={[styles.card, { backgroundColor: t.surface }]}>
                <View style={styles.row}>
                  <Ionicons name="notifications-off-outline" size={22} color={t.textMuted} />
                  <View style={styles.rowText}>
                    <Text style={[styles.rowTitle, { color: t.textPrimary }]}>
                      تعذّر تفعيل الإشعارات
                    </Text>
                    <Text style={[styles.rowSub, { color: t.textMuted }]}>
                      الخطوة التي فشلت: الحصول على رمز Firebase للجهاز.
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.settingsBtn, { borderColor: t.borderLight }]}
                  onPress={() => loadPrefs()}
                  accessibilityRole="button"
                >
                  <Ionicons name="refresh-outline" size={16} color={t.accent} />
                  <Text style={[styles.settingsBtnText, { color: t.accent }]}>إعادة المحاولة</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={[styles.card, { backgroundColor: t.surface }]}>
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <Text style={[styles.rowTitle, { color: t.textPrimary }]}>
                        تفعيل الإشعارات
                      </Text>
                      <Text style={[styles.rowSub, { color: t.textMuted }]}>
                        {permission?.granted
                          ? 'الإشعارات مسموح بها من النظام'
                          : 'الإشعارات غير مسموح بها من النظام'}
                      </Text>
                    </View>
                    <Switch
                      value={enabled}
                      onValueChange={onToggleEnabled}
                      disabled={saving}
                      trackColor={{ false: t.borderLight, true: t.accent }}
                      thumbColor={enabled ? '#FFFFFF' : undefined}
                      accessibilityLabel="تفعيل الإشعارات"
                    />
                  </View>

                  {permission?.denied ? (
                    <TouchableOpacity
                      style={[styles.settingsBtn, { borderColor: t.borderLight }]}
                      onPress={() => Linking.openSettings()}
                      accessibilityRole="button"
                    >
                      <Ionicons name="settings-outline" size={16} color={t.accent} />
                      <Text style={[styles.settingsBtnText, { color: t.accent }]}>
                        فتح إعدادات النظام
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <Text style={[styles.sectionLabel, { color: t.textMuted }]}>
                  ما الذي تصلك إشعاراته؟
                </Text>

                <View style={[styles.card, { backgroundColor: t.surface }]}>
                  <TouchableOpacity
                    style={styles.optionRow}
                    onPress={() => onSelectMode('urgent')}
                    disabled={saving || !enabled}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: mode === 'urgent' }}
                  >
                    <Ionicons
                      name={mode === 'urgent' ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={mode === 'urgent' ? t.accent : t.textMuted}
                    />
                    <View style={styles.rowText}>
                      <Text style={[styles.rowTitle, { color: t.textPrimary }]}>العاجل فقط</Text>
                      <Text style={[styles.rowSub, { color: t.textMuted }]}>
                        إشعار عند نشر خبر عاجل
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <View style={[styles.divider, { backgroundColor: t.borderLight }]} />

                  <TouchableOpacity
                    style={styles.optionRow}
                    onPress={() => onSelectMode('all')}
                    disabled={saving || !enabled}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: mode === 'all' }}
                  >
                    <Ionicons
                      name={mode === 'all' ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={mode === 'all' ? t.accent : t.textMuted}
                    />
                    <View style={styles.rowText}>
                      <Text style={[styles.rowTitle, { color: t.textPrimary }]}>كل الأخبار</Text>
                      <Text style={[styles.rowSub, { color: t.textMuted }]}>
                        إشعار مع كل خبر جديد
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.sectionLabel, { color: t.textMuted }]}>
                  الخلاصة اليومية
                </Text>

                {/* Its own switch: a reader can mute breaking news and still want
                    the digest, or the reverse. It does not touch `mode`. */}
                <View style={[styles.card, { backgroundColor: t.surface }]}>
                  <View style={styles.optionRow}>
                    <Ionicons name="newspaper-outline" size={20} color={t.accent} />
                    <View style={styles.rowText}>
                      <Text style={[styles.rowTitle, { color: t.textPrimary }]}>
                        إشعار الخلاصة
                      </Text>
                      <Text style={[styles.rowSub, { color: t.textMuted }]}>
                        خلاصة مختارة مرتين يوميًا: ٩ صباحًا و٦ مساءً
                      </Text>
                    </View>
                    <Switch
                      value={digestEnabled}
                      onValueChange={(value) => persist({ digestEnabled: value })}
                      disabled={saving}
                      trackColor={{ true: t.accent, false: t.borderLight }}
                      accessibilityLabel="إشعار الخلاصة"
                    />
                  </View>
                </View>
              </>
            )}

            {saving ? (
              <ActivityIndicator style={styles.saving} color={t.accent} />
            ) : null}

            {error && (
              <View style={[styles.errorToast, { backgroundColor: t.breaking }]}>
                <Text style={styles.errorToastText}>{error}</Text>
              </View>
            )}

            {device.status === 'error' ? (
              <TouchableOpacity
                style={[styles.settingsBtn, { borderColor: t.borderLight, marginTop: 12 }]}
                onPress={() => loadPrefs()}
                accessibilityRole="button"
              >
                <Ionicons name="refresh-outline" size={16} color={t.accent} />
                <Text style={[styles.settingsBtnText, { color: t.accent }]}>إعادة المحاولة</Text>
              </TouchableOpacity>
            ) : null}
          </View>
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
    paddingVertical: 10,
  },
  headerTitle: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 18,
    textAlign: 'center',
  },
  circleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  circleSpacer: { width: 38 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 16,
  },
  muted: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  card: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 4,
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    gap: 12,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  rowText: { flex: 1 },
  rowTitle: {
    fontFamily: 'Cairo_600SemiBold',
    fontSize: 15,
    marginBottom: 2,
  },
  rowSub: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  sectionLabel: {
    fontFamily: 'Cairo_600SemiBold',
    fontSize: 13,
    marginTop: 20,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  divider: { height: StyleSheet.hairlineWidth },
  settingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    marginBottom: 14,
  },
  settingsBtnText: { fontFamily: 'Cairo_600SemiBold', fontSize: 13 },
  saving: { marginTop: 16 },
  primaryBtn: {
    minWidth: 200,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: 'Cairo_700Bold',
    color: '#FFFFFF',
    fontSize: 15,
  },
  errorToast: {
    marginTop: 16,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  errorToastText: {
    fontFamily: 'Cairo_600SemiBold',
    color: '#FFFFFF',
    fontSize: 12,
  },
});
