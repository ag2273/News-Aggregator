import React, { useCallback, useRef } from 'react';
import {
  ActivityIndicator,
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
import { palette } from '../constants/colors';
import type { Theme } from '../constants/colors';
import { useAuth } from '../lib/auth';
import { crashNow } from '../lib/crash';
import appConfig from '../app.json';

/** Amber for "waiting on you" states; the palette has no warning token. */
const AMBER = '#F59E0B';
import { useVerificationActions } from '../components/VerificationGate';

export default function AccountScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { user, loading, signOut, emailVerified } = useAuth();
  const verify = useVerificationActions();

  /**
   * Hidden crash trigger for verifying Crashlytics on a real device: seven taps
   * on the version string within four seconds. Deliberately awkward so it cannot
   * happen by accident while scrolling or tapping around.
   */
  const taps = useRef<number[]>([]);
  const onVersionTap = useCallback(() => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 4000), now];
    if (taps.current.length >= 7) {
      taps.current = [];
      crashNow();
    }
  }, []);

  return (
    <LinearGradient
      colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]}
      style={styles.root}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: t.surface }]}
            accessibilityRole="button"
            accessibilityLabel="رجوع"
          >
            <Ionicons name="chevron-forward" size={22} color={t.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: t.textPrimary }]}>حسابي</Text>
          <View style={styles.headerSpacer} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={t.accent} />
          </View>
        ) : user ? (
          /* Logged In View */
          <View style={styles.content}>
            <View style={[styles.card, { backgroundColor: t.surface }]}>
              <View style={[styles.avatarWrap, { backgroundColor: t.pillInactiveBg }]}>
                <Text style={[styles.avatarInitial, { color: t.accent }]}>
                  {(user.name || user.email)[0]?.toUpperCase() ?? 'U'}
                </Text>
              </View>

              <Text style={[styles.userName, { color: t.textPrimary }]}>
                {user.name || 'مستخدم جديد'}
              </Text>
              <Text style={[styles.userEmail, { color: t.textMuted }]}>{user.email}</Text>

              {emailVerified ? (
                <View style={[styles.badgeRow, { backgroundColor: t.followedBg }]}>
                  <Ionicons name="checkmark-circle" size={16} color={t.followedText} />
                  <Text style={[styles.badgeText, { color: t.followedText }]}>موثّق ✓</Text>
                </View>
              ) : (
                <View style={[styles.pendingCard, { backgroundColor: t.breakingBg }]}>
                  <View style={styles.pendingHeader}>
                    <Ionicons name="alert-circle" size={16} color={AMBER} />
                    <Text style={[styles.pendingTitle, { color: AMBER }]}>في انتظار التوثيق</Text>
                  </View>
                  <Text style={[styles.pendingSub, { color: t.textSecondary }]}>
                    افتح الرابط اللي بعتناه على {user.email}
                  </Text>

                  <View style={styles.pendingActions}>
                    <TouchableOpacity
                      style={[
                        styles.pendingBtn,
                        { borderColor: AMBER },
                        (verify.sending || verify.secondsLeft > 0) && styles.pendingBtnDisabled,
                      ]}
                      onPress={verify.resend}
                      disabled={verify.sending || verify.secondsLeft > 0}
                      accessibilityRole="button"
                      accessibilityLabel="إعادة إرسال الرابط"
                    >
                      {verify.sending ? (
                        <ActivityIndicator size="small" color={AMBER} />
                      ) : (
                        <Text style={[styles.pendingBtnText, { color: AMBER }]}>
                          {verify.secondsLeft > 0
                            ? `إعادة الإرسال بعد ${verify.secondsLeft}ث`
                            : 'إعادة إرسال الرابط'}
                        </Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.pendingBtn,
                        { borderColor: t.borderLight },
                        verify.checking && styles.pendingBtnDisabled,
                      ]}
                      onPress={verify.check}
                      disabled={verify.checking}
                      accessibilityRole="button"
                      accessibilityLabel="تحققت"
                    >
                      {verify.checking ? (
                        <ActivityIndicator size="small" color={t.textSecondary} />
                      ) : (
                        <Text style={[styles.pendingBtnText, { color: t.textSecondary }]}>
                          تحققت
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  {verify.notice ? (
                    <Text style={[styles.pendingNotice, { color: t.textMuted }]}>
                      {verify.notice}
                    </Text>
                  ) : null}
                </View>
              )}

              <View style={[styles.divider, { backgroundColor: t.borderLight }]} />

              <TouchableOpacity
                style={styles.settingsRow}
                onPress={() => router.push('/settings')}
                accessibilityRole="button"
                accessibilityLabel="الإشعارات"
              >
                <Ionicons name="notifications-outline" size={18} color={t.textPrimary} />
                <Text style={[styles.settingsRowText, { color: t.textPrimary }]}>
                  الإشعارات
                </Text>
                <Ionicons name="chevron-back" size={16} color={t.textMuted} />
              </TouchableOpacity>

              <View style={[styles.divider, { backgroundColor: t.borderLight }]} />

              <TouchableOpacity
                style={styles.settingsRow}
                onPress={() => router.push('/delete-account')}
                accessibilityRole="button"
                accessibilityLabel="حذف الحساب"
              >
                <Ionicons name="trash-outline" size={18} color={t.breaking} />
                <Text style={[styles.settingsRowText, { color: t.breaking }]}>حذف الحساب</Text>
                <Ionicons name="chevron-back" size={16} color={t.textMuted} />
              </TouchableOpacity>

              <View style={[styles.divider, { backgroundColor: t.borderLight }]} />

              <TouchableOpacity
                style={[styles.signOutBtn, { borderColor: t.breaking }]}
                onPress={async () => {
                  await signOut();
                }}
                accessibilityRole="button"
                accessibilityLabel="تسجيل الخروج"
              >
                <Ionicons name="log-out-outline" size={18} color={t.breaking} />
                <Text
                  style={[styles.signOutText, { color: t.breaking }]}
                  numberOfLines={1}
                >
                  تسجيل الخروج
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={onVersionTap}
                activeOpacity={1}
                accessibilityRole="button"
                accessibilityLabel={`إصدار التطبيق ${appConfig.expo.version}`}
              >
                <Text style={[styles.versionText, { color: t.textMuted }]}>
                  {`رئيس التحرير ${appConfig.expo.version}`}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* Not Logged In View */
          <View style={styles.content}>
            <View style={[styles.card, { backgroundColor: t.surface }]}>
              <View style={[styles.avatarWrap, { backgroundColor: t.pillInactiveBg }]}>
                <Ionicons name="person-outline" size={36} color={t.textMuted} />
              </View>

              <Text style={[styles.cardTitle, { color: t.textPrimary }]}>
                مركز الأخبار - الحساب الشخصي
              </Text>
              <Text style={[styles.cardSub, { color: t.textMuted }]}>
                سجّل الدخول للوصول إلى تفضيلاتك وحسابك الشخصي
              </Text>

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: t.accent }]}
                onPress={() => router.push('/login')}
                accessibilityRole="button"
              >
                <Text style={styles.primaryBtnText}>تسجيل الدخول</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.secondaryBtn,
                  { backgroundColor: t.surfaceSubtle, borderColor: t.borderLight },
                ]}
                onPress={() => router.push('/register')}
                accessibilityRole="button"
              >
                <Text style={[styles.secondaryBtnText, { color: t.textPrimary }]}>
                  إنشاء حساب جديد
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  headerTitle: { fontFamily: 'Cairo_700Bold', fontSize: 18 },
  headerSpacer: { width: 40 },
  content: { paddingHorizontal: 20 },
  card: {
    borderRadius: 28,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  avatarWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarInitial: { fontFamily: 'Cairo_700Bold', fontSize: 28 },
  userName: { fontFamily: 'Cairo_700Bold', fontSize: 20, marginBottom: 4 },
  userEmail: { fontFamily: 'Cairo_400Regular', fontSize: 13, marginBottom: 16 },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginBottom: 20,
  },
  badgeText: { fontFamily: 'Cairo_600SemiBold', fontSize: 12 },
  pendingCard: {
    width: '100%',
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
    gap: 8,
  },
  pendingHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pendingTitle: { fontFamily: 'Cairo_700Bold', fontSize: 13 },
  pendingSub: { fontFamily: 'Cairo_400Regular', fontSize: 12, lineHeight: 20 },
  pendingActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  pendingBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  pendingBtnText: { fontFamily: 'Cairo_600SemiBold', fontSize: 12 },
  pendingBtnDisabled: { opacity: 0.55 },
  pendingNotice: { fontFamily: 'Cairo_400Regular', fontSize: 11, lineHeight: 18 },
  divider: { height: StyleSheet.hairlineWidth, width: '100%', marginBottom: 20 },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    // Was a fixed 48: the Arabic label wraps at large font scales and the second
    // line was clipped away, leaving only "تسجيل". Grow with the content instead.
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    paddingVertical: 12,
  },
  settingsRowText: {
    flex: 1,
    fontFamily: 'Cairo_600SemiBold',
    fontSize: 15,
  },
  versionText: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 10,
    marginTop: 14,
    opacity: 0.7,
  },
  signOutText: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 14,
    // Never let the label shrink or wrap inside the row.
    flexShrink: 0,
    textAlign: 'center',
  },
  cardTitle: { fontFamily: 'Cairo_700Bold', fontSize: 20, marginBottom: 8, textAlign: 'center' },
  cardSub: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 13,
    lineHeight: 22,
    marginBottom: 24,
    textAlign: 'center',
  },
  primaryBtn: {
    width: '100%',
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },
  primaryBtnText: { color: '#FFFFFF', fontFamily: 'Cairo_700Bold', fontSize: 15 },
  secondaryBtn: {
    width: '100%',
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { fontFamily: 'Cairo_600SemiBold', fontSize: 14 },
});
