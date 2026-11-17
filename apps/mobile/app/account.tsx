import React from 'react';
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

export default function AccountScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { user, loading, signOut } = useAuth();

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

              <View style={[styles.badgeRow, { backgroundColor: t.surfaceSubtle }]}>
                <Ionicons name="checkmark-circle" size={16} color={t.accent} />
                <Text style={[styles.badgeText, { color: t.textSecondary }]}>حساب موثّق محليًا</Text>
              </View>

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
                style={[styles.signOutBtn, { borderColor: t.breaking }]}
                onPress={async () => {
                  await signOut();
                }}
                accessibilityRole="button"
              >
                <Ionicons name="log-out-outline" size={18} color={t.breaking} />
                <Text style={[styles.signOutText, { color: t.breaking }]}>تسجيل الخروج</Text>
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
  divider: { height: StyleSheet.hairlineWidth, width: '100%', marginBottom: 20 },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    height: 48,
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
  signOutText: { fontFamily: 'Cairo_700Bold', fontSize: 14 },
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
