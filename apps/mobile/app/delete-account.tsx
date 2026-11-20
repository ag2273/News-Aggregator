import React, { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
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
import { openPrivacy } from '../lib/privacyLink';

/**
 * Account deletion, per Play policy: a destructive action behind an explicit
 * confirmation that re-enters the password and states exactly what is removed.
 */
export default function DeleteAccountScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { user, deleteAccount } = useAuth();

  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = password.length > 0 && !working;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setWorking(true);
    setError(null);
    try {
      await deleteAccount(password);
      // The session is gone; leave the now-unreachable stack.
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر حذف الحساب.');
    } finally {
      setWorking(false);
    }
  };

  const deletions = [
    'حسابك نفسه (البريد وكلمة المرور)',
    'المصادر اللي بتتابعها',
    'المقالات المحفوظة',
    'تفضيلات الإشعارات وتوكن الجهاز',
    'حالة توثيق البريد',
  ];

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
          <Text style={[styles.headerTitle, { color: t.textPrimary }]}>حذف الحساب</Text>
          <View style={styles.circleSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.card, { backgroundColor: t.surface }]}>
            <View style={[styles.warnIcon, { backgroundColor: t.breakingBg }]}>
              <Ionicons name="warning-outline" size={28} color={t.breaking} />
            </View>

            <Text style={[styles.title, { color: t.textPrimary }]}>
              الحذف نهائي ولا رجعة فيه
            </Text>
            <Text style={[styles.sub, { color: t.textMuted }]}>
              لو حذفت حسابك، البيانات دي هتتمسح كلها ومش هتقدر ترجعها:
            </Text>

            <View style={styles.list}>
              {deletions.map((line) => (
                <View key={line} style={styles.listRow}>
                  <Ionicons name="close-circle" size={16} color={t.breaking} />
                  <Text style={[styles.listText, { color: t.textSecondary }]}>{line}</Text>
                </View>
              ))}
            </View>

            {user?.email ? (
              <Text style={[styles.email, { color: t.textMuted }]}>{user.email}</Text>
            ) : null}

            <Text style={[styles.label, { color: t.textSecondary }]}>
              اكتب كلمة المرور للتأكيد
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: t.surfaceSubtle,
                  borderColor: error ? t.breaking : t.borderLight,
                  color: t.textPrimary,
                },
              ]}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setError(null);
              }}
              placeholder="••••••••"
              placeholderTextColor={t.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textAlign="right"
              accessibilityLabel="كلمة المرور للتأكيد"
            />

            {error ? (
              <View style={[styles.errorBanner, { backgroundColor: t.breakingBg }]}>
                <Ionicons name="alert-circle" size={16} color={t.breaking} />
                <Text style={[styles.errorText, { color: t.breaking }]}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[
                styles.deleteBtn,
                { backgroundColor: t.breaking },
                !canSubmit && styles.disabled,
              ]}
              onPress={onSubmit}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="تأكيد حذف الحساب نهائيًا"
            >
              {working ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.deleteText}>حذف الحساب نهائيًا</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => router.back()}
              accessibilityRole="button"
            >
              <Text style={[styles.cancelText, { color: t.textMuted }]}>إلغاء</Text>
            </TouchableOpacity>

            {/* What deletion removes is explained in the policy; link it here so
                the user can read it before confirming. */}
            <TouchableOpacity
              style={styles.privacyRow}
              onPress={() => openPrivacy('ar')}
              accessibilityRole="button"
              accessibilityLabel="سياسة الخصوصية"
            >
              <Ionicons name="shield-checkmark-outline" size={15} color={t.textMuted} />
              <Text style={[styles.privacyText, { color: t.textMuted }]}>
                اقرأ سياسة الخصوصية قبل الحذف
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
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
  headerTitle: { fontFamily: 'Cairo_700Bold', fontSize: 18 },
  circleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleSpacer: { width: 38 },
  content: { padding: 16, paddingBottom: 40 },
  card: { borderRadius: 24, padding: 20 },
  warnIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: { fontFamily: 'Cairo_700Bold', fontSize: 18, textAlign: 'center', marginBottom: 8 },
  sub: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 13,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 16,
  },
  list: { gap: 8, marginBottom: 16 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listText: { flex: 1, fontFamily: 'Cairo_400Regular', fontSize: 13, lineHeight: 21 },
  email: {
    fontFamily: 'Cairo_600SemiBold',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 16,
  },
  label: { fontFamily: 'Cairo_600SemiBold', fontSize: 13, marginBottom: 8 },
  input: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontFamily: 'Cairo_400Regular',
    fontSize: 14,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginTop: 12,
  },
  errorText: { fontFamily: 'Cairo_600SemiBold', fontSize: 12, flexShrink: 1 },
  deleteBtn: {
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  deleteText: { color: '#FFFFFF', fontFamily: 'Cairo_700Bold', fontSize: 15 },
  disabled: { opacity: 0.5 },
  cancelBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  cancelText: { fontFamily: 'Cairo_600SemiBold', fontSize: 13 },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
  },
  privacyText: { fontSize: 13 },
});
