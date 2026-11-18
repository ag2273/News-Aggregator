/**
 * The calm "verify your email first" state for gated screens.
 *
 * While an account is unverified, its gated screens must not call gated
 * endpoints at all: a 403 answered with "تحقق من الاتصال" blamed the user's
 * connection for something the app already knew. This shows the reason instead,
 * with the same two actions as the banner.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Theme } from '../constants/colors';
import { resendVerification, ResendRateLimited } from '../lib/api';
import { useAuth } from '../lib/auth';

/** Seconds left on the resend cooldown, counted down locally. */
function useCountdown(seconds: number): number {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (seconds <= 0) {
      setLeft(0);
      return;
    }
    setLeft(seconds);
    const id = setInterval(() => {
      setLeft((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [seconds]);
  return left;
}

/**
 * Shared resend + re-check pair, used by the banner and the locked state so the
 * cooldown behaves the same in both places.
 */
export function useVerificationActions() {
  const { token, refreshSession } = useAuth();
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const secondsLeft = useCountdown(cooldown);

  const resend = useCallback(async () => {
    if (!token || sending || secondsLeft > 0) return;
    setSending(true);
    setNotice(null);
    try {
      const result = await resendVerification(token);
      if (result.sent) {
        setNotice('أرسلنا رابطًا جديدًا إلى بريدك');
        setCooldown(60);
      } else {
        setNotice('تعذّر إرسال الرسالة الآن. حاول بعد قليل.');
      }
    } catch (err) {
      if (err instanceof ResendRateLimited) {
        setCooldown(Math.max(1, err.retryAfterSeconds));
        setNotice(`انتظر ${err.retryAfterSeconds} ثانية قبل إعادة الإرسال`);
      } else {
        setNotice('تعذّر إرسال الرابط. تحقّق من الإنترنت.');
      }
    } finally {
      setSending(false);
    }
  }, [token, sending, secondsLeft]);

  const check = useCallback(async () => {
    setChecking(true);
    setNotice(null);
    try {
      await refreshSession();
      setNotice('لم يتم التوثيق بعد. اضغط الرابط في بريدك ثم أعد المحاولة.');
    } finally {
      setChecking(false);
    }
  }, [refreshSession]);

  return { resend, check, sending, checking, secondsLeft, notice };
}

export function VerificationGate({
  t,
  icon,
  title,
  subtitle,
}: {
  t: Theme;
  icon?: keyof typeof Ionicons.glyphMap;
  title?: string;
  subtitle?: string;
}) {
  const { user } = useAuth();
  const { resend, check, sending, checking, secondsLeft, notice } = useVerificationActions();

  return (
    <View style={styles.wrap}>
      <View style={[styles.iconWrap, { backgroundColor: t.pillInactiveBg }]}>
        <Ionicons name={icon ?? 'mail-unread-outline'} size={36} color={t.textMuted} />
      </View>

      <Text style={[styles.title, { color: t.textPrimary }]}>
        {title ?? 'وثّق بريدك أولاً'}
      </Text>
      <Text style={[styles.subtitle, { color: t.textMuted }]}>
        {subtitle ?? 'الميزة دي متاحة بعد توثيق بريدك. افتح الرابط اللي وصلك على الإيميل.'}
      </Text>
      {user?.email ? (
        <Text style={[styles.email, { color: t.textSecondary }]}>{user.email}</Text>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity
          style={[
            styles.resendBtn,
            { borderColor: t.accent },
            (sending || secondsLeft > 0) && styles.disabled,
          ]}
          onPress={resend}
          disabled={sending || secondsLeft > 0}
          accessibilityRole="button"
          accessibilityLabel="إعادة إرسال الرابط"
        >
          {sending ? (
            <ActivityIndicator size="small" color={t.accent} />
          ) : (
            <Text style={[styles.resendText, { color: t.accent }]}>
              {secondsLeft > 0 ? `إعادة الإرسال بعد ${secondsLeft}ث` : 'إعادة إرسال الرابط'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.checkBtn, { borderColor: t.borderLight }, checking && styles.disabled]}
          onPress={check}
          disabled={checking}
          accessibilityRole="button"
          accessibilityLabel="تحققت"
        >
          {checking ? (
            <ActivityIndicator size="small" color={t.textSecondary} />
          ) : (
            <Text style={[styles.checkText, { color: t.textSecondary }]}>تحققت</Text>
          )}
        </TouchableOpacity>
      </View>

      {notice ? <Text style={[styles.notice, { color: t.textMuted }]}>{notice}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 0 },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: { fontFamily: 'Cairo_700Bold', fontSize: 18, textAlign: 'center', marginBottom: 8 },
  subtitle: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 13,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 8,
  },
  email: { fontFamily: 'Cairo_600SemiBold', fontSize: 12, marginBottom: 20 },
  actions: { flexDirection: 'row', gap: 10, width: '100%', maxWidth: 340 },
  resendBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  resendText: { fontFamily: 'Cairo_600SemiBold', fontSize: 13 },
  checkBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  checkText: { fontFamily: 'Cairo_600SemiBold', fontSize: 13 },
  disabled: { opacity: 0.55 },
  notice: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 12,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 12,
  },
});
