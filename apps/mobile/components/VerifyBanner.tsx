/**
 * Email-verification banner + resend logic.
 *
 * The server is the authority (403 EMAIL_NOT_VERIFIED on account-bound routes);
 * this is the friendly surface for it: a persistent strip with a resend button
 * that respects the server's cooldown, and a "تحققت" check that re-reads the
 * session after the user taps the link in their mail.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
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

export function VerifyBanner({ t }: { t: Theme }) {
  const { token, emailVerified, refreshSession } = useAuth();
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const secondsLeft = useCountdown(cooldown);

  const onResend = useCallback(async () => {
    if (!token || sending || secondsLeft > 0) return;
    setSending(true);
    setNotice(null);
    try {
      const result = await resendVerification(token);
      if (!mounted.current) return;
      if (result.sent) {
        setNotice('أرسلنا رابطًا جديدًا إلى بريدك');
        setCooldown(60);
      } else {
        // Accepted but Resend could not deliver (or no key): say so honestly.
        setNotice('تعذّر إرسال الرسالة الآن. حاول بعد قليل.');
      }
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof ResendRateLimited) {
        setCooldown(Math.max(1, err.retryAfterSeconds));
        setNotice(`انتظر ${err.retryAfterSeconds} ثانية قبل إعادة الإرسال`);
      } else {
        setNotice('تعذّر إرسال الرابط. تحقّق من الإنترنت.');
      }
    } finally {
      if (mounted.current) setSending(false);
    }
  }, [token, sending, secondsLeft]);

  const onChecked = useCallback(async () => {
    setChecking(true);
    setNotice(null);
    try {
      await refreshSession();
      if (mounted.current) setNotice('لم يتم التوثيق بعد. اضغط الرابط في بريدك ثم أعد المحاولة.');
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, [refreshSession]);

  // Not signed in, or already verified: nothing to show.
  if (!token || emailVerified) return null;

  return (
    <View style={[styles.wrap, { backgroundColor: t.surface, borderColor: t.borderLight }]}>
      <View style={styles.row}>
        <Ionicons name="mail-unread-outline" size={18} color={t.accent} />
        <Text style={[styles.title, { color: t.textPrimary }]}>
          وثّق بريدك لتفعيل كل المميزات
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[
            styles.actionBtn,
            { borderColor: t.borderLight },
            (sending || secondsLeft > 0) && styles.disabled,
          ]}
          onPress={onResend}
          disabled={sending || secondsLeft > 0}
          accessibilityRole="button"
          accessibilityLabel="إعادة إرسال الرابط"
        >
          {sending ? (
            <ActivityIndicator size="small" color={t.accent} />
          ) : (
            <Text style={[styles.actionText, { color: t.accent }]}>
              {secondsLeft > 0 ? `إعادة الإرسال بعد ${secondsLeft}ث` : 'إعادة إرسال الرابط'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: t.borderLight }, checking && styles.disabled]}
          onPress={onChecked}
          disabled={checking}
          accessibilityRole="button"
          accessibilityLabel="تحققت"
        >
          {checking ? (
            <ActivityIndicator size="small" color={t.textSecondary} />
          ) : (
            <Text style={[styles.actionText, { color: t.textSecondary }]}>تحققت</Text>
          )}
        </TouchableOpacity>
      </View>

      {notice ? (
        <Text style={[styles.notice, { color: t.textMuted }]}>{notice}</Text>
      ) : null}
    </View>
  );
}

/** Shown instead of a locked feature's controls. */
export function VerificationRequired({ t, feature }: { t: Theme; feature: string }) {
  return (
    <View style={[styles.locked, { backgroundColor: t.surface, borderColor: t.borderLight }]}>
      <Ionicons name="lock-closed-outline" size={20} color={t.textMuted} />
      <Text style={[styles.lockedText, { color: t.textSecondary }]}>
        {feature} متاحة بعد توثيق بريدك. وثّق بريدك من الشاشة الرئيسية.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontFamily: 'Cairo_600SemiBold', fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  actionText: { fontFamily: 'Cairo_600SemiBold', fontSize: 12 },
  disabled: { opacity: 0.55 },
  notice: { fontFamily: 'Cairo_400Regular', fontSize: 11, lineHeight: 18 },
  locked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  lockedText: { flex: 1, fontFamily: 'Cairo_400Regular', fontSize: 13, lineHeight: 21 },
});
