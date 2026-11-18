/**
 * The one gate sheet for account-bound actions, with THREE states.
 *
 * A guest (never signed in) has no account to verify, so showing the email
 * verification sheet — with its "resend the link" button — makes no sense. The
 * guest needs a sign-in prompt instead. Signed-in-but-unverified needs the
 * verification sheet. Verified users never see either.
 *
 * Use `useAccountGate()` to decide, and render <AccountGateSheet> with the result.
 */

import React, { useCallback, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { Theme } from '../constants/colors';
import { useAuth } from '../lib/auth';
import { VerificationGate } from './VerificationGate';

export type GateMode = 'signin' | 'verify';

export interface AccountGate {
  /** True when the action may proceed. */
  allowed: boolean;
  /** Which sheet to show when it may not. Null when allowed. */
  mode: GateMode | null;
  /** Open the right sheet (call from an action that was refused). */
  open: () => void;
  /** Open a specific mode (mostly for tests and for follow/save paths). */
  openWith: (mode: GateMode) => void;
  visible: boolean;
  dismiss: () => void;
  currentMode: GateMode;
}

/**
 * Three-state account gate.
 * Callers should check `allowed` first; when false, call `open()`.
 */
export function useAccountGate(): AccountGate {
  const { user, token, emailVerified } = useAuth();
  const [visible, setVisible] = useState(false);
  const [currentMode, setCurrentMode] = useState<GateMode>('signin');

  // ONE place decides the state. `open()` uses this same value: computing it
  // twice was a real flaw — the sheet and the guard could disagree, showing a
  // guest the verification sheet while the guard believed "not allowed".
  const requiredMode: GateMode | null =
    !token || !user ? 'signin' : !emailVerified ? 'verify' : null;
  const mode = requiredMode;

  const openWith = useCallback((m: GateMode) => {
    setCurrentMode(m);
    setVisible(true);
  }, []);

  const open = useCallback(() => {
    // Nothing to show when the account is allowed.
    if (!requiredMode) return;
    openWith(requiredMode);
  }, [openWith, requiredMode]);

  const dismiss = useCallback(() => setVisible(false), []);

  return {
    allowed: mode === null,
    mode,
    open,
    openWith,
    visible,
    dismiss,
    currentMode,
  };
}

/**
 * The sheet itself. `signin` offers تسجيل الدخول / إنشاء حساب; `verify` is the
 * existing verification gate (resend + تحققت).
 */
export function AccountGateSheet({
  t,
  gate,
  message,
}: {
  t: Theme;
  gate: AccountGate;
  /** What the user tried to do, e.g. "عشان تتفاعل". */
  message?: string;
}) {
  const isSignIn = gate.currentMode === 'signin';

  return (
    <Modal
      visible={gate.visible}
      transparent
      animationType="fade"
      onRequestClose={gate.dismiss}
    >
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: t.surface }]}>
          <TouchableOpacity
            onPress={gate.dismiss}
            style={styles.close}
            accessibilityRole="button"
            accessibilityLabel="إغلاق"
          >
            <Ionicons name="close" size={20} color={t.textMuted} />
          </TouchableOpacity>

          {isSignIn ? (
            <View style={styles.signInBody}>
              <View style={[styles.iconWrap, { backgroundColor: t.pillInactiveBg }]}>
                <Ionicons name="person-circle-outline" size={40} color={t.accent} />
              </View>
              <Text style={[styles.title, { color: t.textPrimary }]}>
                سجّل دخولك عشان تتفاعل
              </Text>
              <Text style={[styles.sub, { color: t.textMuted }]}>
                {message ??
                  'التفاعل مع الأخبار وحفظها محتاج حساب. سجّل دخولك أو اعمل حساب جديد في ثواني.'}
              </Text>

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: t.accent }]}
                onPress={() => {
                  gate.dismiss();
                  router.push('/login');
                }}
                accessibilityRole="button"
                accessibilityLabel="تسجيل الدخول"
              >
                <Text style={styles.primaryText}>تسجيل الدخول</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: t.borderLight }]}
                onPress={() => {
                  gate.dismiss();
                  router.push('/register');
                }}
                accessibilityRole="button"
                accessibilityLabel="إنشاء حساب"
              >
                <Text style={[styles.secondaryText, { color: t.textPrimary }]}>
                  إنشاء حساب
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <VerificationGate
              t={t}
              icon="mail-unread-outline"
              title="وثّق بريدك أولاً"
              subtitle="التفاعل مع الأخبار متاح بعد توثيق بريدك الإلكتروني. افتح الرابط الذي وصلك على بريدك."
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    minHeight: 340,
    paddingTop: 8,
    paddingBottom: 28,
  },
  close: { alignSelf: 'flex-start', padding: 12 },
  signInBody: { paddingHorizontal: 24, alignItems: 'center', paddingBottom: 8 },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: { fontFamily: 'Cairo_700Bold', fontSize: 18, textAlign: 'center', marginBottom: 8 },
  sub: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 13,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  primaryBtn: {
    width: '100%',
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#FFFFFF', fontFamily: 'Cairo_700Bold', fontSize: 15 },
  secondaryBtn: {
    width: '100%',
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  secondaryText: { fontFamily: 'Cairo_600SemiBold', fontSize: 14 },
});
