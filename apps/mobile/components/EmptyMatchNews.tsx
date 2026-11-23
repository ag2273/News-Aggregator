import React, { useMemo, useRef, useEffect } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Theme } from '../constants/colors';

/**
 * The match-news tab when our corpus holds nothing (#41), to the approved preview.
 *
 * The approval made two things mandatory, and they are the whole design:
 *
 *   1. **Honest copy.** The preview's headline said «29 صحيفة». It is 29 — verified
 *      against `apps/server/src/types.ts` and the live `/api/sources` — but naming a
 *      count of *Egyptian* outlets would be wrong, since several are Gulf, UK or
 *      tech feeds. So the sentence says «مصادرنا المعتمدة» with no number at all:
 *      true, and impossible to drift out of date.
 *   2. **No dead end, no false promise.** It offers only routes that exist for THIS
 *      match: the events tab and the club pages always; the tactical pitch only when
 *      real line-up data arrived (European fixtures only, per the measured sources).
 *
 * The radar badge is the preview's emerald "we are watching" mark — it spins slowly
 * once, which reads as "still looking" without promising that anything will arrive.
 */
export function EmptyMatchNews({
  t,
  home,
  away,
  hasEvents,
  hasLineups,
  onOpenEvents,
  onOpenLineups,
  onOpenHome,
  onOpenAway,
}: {
  t: Theme;
  home: string;
  away: string;
  /** The events tab has something to show. */
  hasEvents: boolean;
  /** A real line-up arrived for this match — the pitch button is hidden otherwise. */
  hasLineups: boolean;
  onOpenEvents: () => void;
  onOpenLineups: () => void;
  onOpenHome: () => void;
  onOpenAway: () => void;
}) {
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 2200, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 2200, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow]);

  const ringStyle = useMemo(
    () => ({
      opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.7] }),
      transform: [
        { scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) },
      ],
    }),
    [glow],
  );

  return (
    <View style={[styles.card, { borderColor: t.accentBorder }]}>
      {/* The radar mark: a still glyph with a softly breathing ring behind it. */}
      <View style={styles.badgeWrap}>
        <Animated.View
          style={[styles.badgeRing, { borderColor: t.accent }, ringStyle]}
          pointerEvents="none"
        />
        <View style={[styles.badgeCore, { backgroundColor: t.accentSoft, borderColor: t.accentBorder }]}>
          <Ionicons name="newspaper-outline" size={30} color={t.accent} />
        </View>
      </View>

      <Text style={[styles.headline, { color: t.textPrimary }]}>
        لا توجد تغطية صحفية منشورة لهذه المباراة في مصادرنا حتى الآن
      </Text>
      <Text style={[styles.explainer, { color: t.textSecondary }]}>
        {'نرصد باستمرار '}
        <Text style={{ color: t.accent, fontFamily: 'Cairo_700Bold' }}>مصادرنا المعتمدة</Text>
        {' ولم تُفرد غرفة الأخبار تقريراً خاصاً بهذه المواجهة بعد.'}
      </Text>

      {/* Only routes that actually work for this match. */}
      <View style={styles.pathways}>
        {hasEvents ? (
          <TouchableOpacity
            style={[styles.pathRow, { backgroundColor: t.surface, borderColor: t.borderLight }]}
            onPress={onOpenEvents}
            accessibilityRole="button"
            accessibilityLabel="متابعة أحداث وسير اللقاء"
          >
            <View style={[styles.pathIcon, { backgroundColor: t.accentSoft }]}>
              <Text style={styles.pathGlyph}>⚡</Text>
            </View>
            <View style={styles.pathText}>
              <Text style={[styles.pathTitle, { color: t.textPrimary }]}>
                متابعة أحداث وسير اللقاء
              </Text>
              <Text style={[styles.pathSub, { color: t.textMuted }]}>
                الأهداف والإنذارات والتبديلات كما ينشرها المصدر
              </Text>
            </View>
            <Ionicons name="chevron-back" size={15} color={t.textDim} />
          </TouchableOpacity>
        ) : null}

        {/* The pitch exists only where a line-up does — European fixtures today. */}
        {hasLineups ? (
          <TouchableOpacity
            style={[styles.pathRow, { backgroundColor: t.surface, borderColor: t.borderLight }]}
            onPress={onOpenLineups}
            accessibilityRole="button"
            accessibilityLabel="عرض التشكيل التكتيكي"
          >
            <View style={[styles.pathIcon, { backgroundColor: t.accentSoft }]}>
              <Text style={styles.pathGlyph}>🏟️</Text>
            </View>
            <View style={styles.pathText}>
              <Text style={[styles.pathTitle, { color: t.textPrimary }]}>
                عرض التشكيل التكتيكي
              </Text>
              <Text style={[styles.pathSub, { color: t.textMuted }]}>
                رسم الملعب وخطة الفريقين
              </Text>
            </View>
            <Ionicons name="chevron-back" size={15} color={t.textDim} />
          </TouchableOpacity>
        ) : null}

        <Text style={[styles.orLabel, { color: t.textDim }]}>أو تصفّح أخبار الناديين:</Text>
        <View style={styles.clubChips}>
          {[home, away].map((club, i) => (
            <TouchableOpacity
              key={club}
              style={[styles.clubChip, { backgroundColor: t.badgePlate, borderColor: t.borderLight }]}
              onPress={i === 0 ? onOpenHome : onOpenAway}
              accessibilityRole="button"
              accessibilityLabel={`أخبار ${club}`}
            >
              <Text style={[styles.clubChipText, { color: t.textSecondary }]} numberOfLines={1}>
                {`📰 ${club}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 18,
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(18,34,27,0.92)',
  },
  badgeWrap: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  badgeRing: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1.5,
  },
  badgeCore: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    maxWidth: 300,
  },
  explainer: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 11.5,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 315,
  },
  pathways: { width: '100%', gap: 8, marginTop: 6 },
  pathRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 52,
  },
  pathIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  pathGlyph: { fontSize: 16 },
  pathText: { flex: 1, gap: 1 },
  pathTitle: { fontFamily: 'Cairo_700Bold', fontSize: 12.5 },
  pathSub: { fontFamily: 'Cairo_400Regular', fontSize: 10 },
  orLabel: { fontFamily: 'Cairo_400Regular', fontSize: 10.5, marginTop: 2 },
  clubChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  clubChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, maxWidth: '48%' },
  clubChipText: { fontFamily: 'Cairo_600SemiBold', fontSize: 11 },
});
