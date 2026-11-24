import React, { useCallback, useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import type { Theme } from '../constants/colors';
import { privacyUrl } from '../lib/privacyLink';
import { API_BASE } from '../lib/api';

/**
 * The first-run privacy notice.
 *
 * Google Play requires an in-app disclosure before an app handles personal data, and
 * a policy page you have to go looking for does not satisfy that. This shows once,
 * on first launch, and never again.
 *
 * Every line here is a true statement about what this app actually does — the same
 * table the policy page renders. It names the four things a reader would be
 * surprised by: the account data, the aggregate counters, that crash reports go to
 * Firebase, and that article text (never their data) goes to an AI service to build
 * the digest.
 *
 * It does not ask for consent to cookies, trackers or anything it can switch off:
 * there is nothing optional here to consent to, and a fake "Accept" button would be
 * worse than none. "Continue" acknowledges that the reader has seen it.
 */

const SEEN_KEY = 'privacyNoticeSeen.v1';

export function FirstRunPrivacyNotice({ t }: { t: Theme }) {
  const [visible, setVisible] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    SecureStore.getItemAsync(SEEN_KEY)
      .then((v) => {
        if (!alive) return;
        setVisible(v !== '1');
      })
      .catch(() => {
        // If secure storage is unreadable the notice must still appear once per
        // process rather than be skipped silently.
        if (alive) setVisible(true);
      })
      .finally(() => {
        if (alive) setChecked(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    SecureStore.setItemAsync(SEEN_KEY, '1').catch(() => {});
  }, []);

  if (!checked || !visible) return null;

  const url = privacyUrl('ar');
  // Shown as plain text, not opened: the reader is mid-acknowledgement, and pushing
  // a webview over the notice would hide what they are agreeing to.
  const host = API_BASE.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.borderLight }]}>
          <View style={styles.head}>
            <View style={[styles.iconWrap, { backgroundColor: t.accentSoft }]}>
              <Ionicons name="shield-checkmark" size={20} color={t.accent} />
            </View>
            <Text style={[styles.title, { color: t.textPrimary }]}>الخصوصية في تطبيقنا</Text>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Text style={[styles.line, { color: t.textSecondary }]}>
              {'بنشرح باختصار إيه اللي بنجمعه، والتفاصيل كاملة في '}
              <Text style={{ color: t.accent }}>{`${host}/privacy`}</Text>
            </Text>

            {[
              ['حسابك', 'البريد وهاش كلمة المرور وحالة التوثيق — على سيرفرنا، وبيتمسح لما تحذف حسابك.'],
              ['استخدامك', 'أعداد مجمّعة (فتح مقال، مشاركة، بحث) من غير ربط بأي شخص، ٩٠ يوم.'],
              ['الأعطال', 'تقارير الأعطال بتروح Firebase عشان نصلّح الأخطاء.'],
              ['الخلاصة', 'نص المقالات المنشورة بس بيتبعت لخدمة الذكاء الاصطناعي، بطلب عدم احتفاظ — مش بياناتك.'],
            ].map(([label, text]) => (
              <View key={label} style={styles.row}>
                <View style={[styles.bullet, { backgroundColor: t.accent }]} />
                <Text style={[styles.rowText, { color: t.textSecondary }]}>
                  <Text style={{ color: t.textPrimary, fontFamily: 'Cairo_700Bold' }}>{label}: </Text>
                  {text}
                </Text>
              </View>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={[styles.primary, { backgroundColor: t.accent }]}
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel="متابعة"
          >
            <Text style={[styles.primaryText, { color: t.accentInk }]}>متابعة</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  card: { width: '100%', maxWidth: 400, borderRadius: 20, borderWidth: 1, padding: 18, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Cairo_700Bold', fontSize: 16, flexShrink: 1 },
  body: { maxHeight: 300 },
  bodyContent: { gap: 10 },
  line: { fontFamily: 'Cairo_400Regular', fontSize: 12, lineHeight: 20 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bullet: { width: 5, height: 5, borderRadius: 3, marginTop: 7 },
  rowText: { flex: 1, fontFamily: 'Cairo_400Regular', fontSize: 12, lineHeight: 20 },
  primary: { borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  primaryText: { fontFamily: 'Cairo_700Bold', fontSize: 14 },
});
