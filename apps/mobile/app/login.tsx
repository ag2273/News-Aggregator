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
import { useFormKeyboardAwareness } from '../lib/keyboard';

export default function LoginScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { signIn } = useAuth();
  const kb = useFormKeyboardAwareness(20);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      setError('يرجى ملء جميع الحقول المطلوبة');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      router.back();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'فشل تسجيل الدخول';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]}
      style={styles.root}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          ref={kb.scrollRef}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: kb.contentPaddingBottom }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
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
            <Text style={[styles.headerTitle, { color: t.textPrimary }]}>تسجيل الدخول</Text>
            <View style={styles.headerSpacer} />
          </View>

          {/* Auth Card */}
          <View style={[styles.card, { backgroundColor: t.surface }]}>
            <Text style={[styles.cardTitle, { color: t.textPrimary }]}>مرحبًا بك من جديد 👋</Text>
            <Text style={[styles.cardSub, { color: t.textMuted }]}>
              سجّل الدخول لمتابعة الأخبار وإدارة حسابك
            </Text>

            {error ? (
              <View style={[styles.errorBanner, { backgroundColor: t.breakingBg }]}>
                <Ionicons name="alert-circle" size={16} color={t.breaking} />
                <Text style={[styles.errorText, { color: t.breaking }]}>{error}</Text>
              </View>
            ) : null}

            {/* Email field */}
            <View
              style={styles.field}
              onLayout={kb.onFieldLayout('email')}
            >
              <Text style={[styles.label, { color: t.textSecondary }]}>البريد الإلكتروني</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: t.surfaceSubtle,
                    borderColor: t.borderLight,
                    color: t.textPrimary,
                  },
                ]}
                placeholder="name@example.com"
                placeholderTextColor={t.textMuted}
                value={email}
                onChangeText={(val) => {
                  setEmail(val);
                  setError(null);
                }}
                onFocus={kb.onFieldFocus('email')}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                textAlign="right"
              />
            </View>

            {/* Password field */}
            <View
              style={styles.field}
              onLayout={kb.onFieldLayout('password')}
            >
              <Text style={[styles.label, { color: t.textSecondary }]}>كلمة المرور</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: t.surfaceSubtle,
                    borderColor: t.borderLight,
                    color: t.textPrimary,
                  },
                ]}
                placeholder="••••••••"
                placeholderTextColor={t.textMuted}
                value={password}
                onChangeText={(val) => {
                  setPassword(val);
                  setError(null);
                }}
                onFocus={kb.onFieldFocus('password')}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textAlign="right"
              />
            </View>

            {/* Submit button */}
            <TouchableOpacity
              style={[
                styles.submitBtn,
                { backgroundColor: t.accent },
                loading && styles.btnDisabled,
              ]}
              onPress={handleSubmit}
              disabled={loading}
              accessibilityRole="button"
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.submitText}>دخول</Text>
              )}
            </TouchableOpacity>

            {/* Switch to Register */}
            <View style={styles.switchRow}>
              <Text style={[styles.switchPrompt, { color: t.textMuted }]}>
                ليس لديك حساب بعد؟
              </Text>
              <TouchableOpacity
                onPress={() => router.replace('/register')}
                accessibilityRole="button"
              >
                <Text style={[styles.switchLink, { color: t.accent }]}>إنشاء حساب جديد</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scrollContent: { padding: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
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
  card: {
    borderRadius: 28,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  cardTitle: { fontFamily: 'Cairo_700Bold', fontSize: 22, marginBottom: 6 },
  cardSub: { fontFamily: 'Cairo_400Regular', fontSize: 13, lineHeight: 22, marginBottom: 20 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  errorText: { fontFamily: 'Cairo_600SemiBold', fontSize: 13, flexShrink: 1 },
  field: { marginBottom: 18 },
  label: { fontFamily: 'Cairo_600SemiBold', fontSize: 13, marginBottom: 8 },
  input: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontFamily: 'Cairo_400Regular',
    fontSize: 14,
  },
  submitBtn: {
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  btnDisabled: { opacity: 0.6 },
  submitText: { color: '#FFFFFF', fontFamily: 'Cairo_700Bold', fontSize: 16 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 20,
  },
  switchPrompt: { fontFamily: 'Cairo_400Regular', fontSize: 13 },
  switchLink: { fontFamily: 'Cairo_700Bold', fontSize: 13 },
});
