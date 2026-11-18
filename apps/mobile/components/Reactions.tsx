/**
 * Article reactions UI.
 *
 * Two shapes, per the batch-2 design spec:
 *  - <ReactionsBar>    full five-button bar under the reader body,
 *  - <ReactionsCapsule> the compact two-emoji capsule on feed cards.
 *
 * Rules shared by both:
 *  - one reaction per user per article; tapping a different one replaces it,
 *    tapping the active one removes it;
 *  - counts are hidden below 3 (the API always sends real numbers);
 *  - a guest or unverified account sends NO request and gets the verification
 *    gate instead;
 *  - optimistic update, rolled back with a toast if the call fails.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAccountGate } from './AccountGate';
import type { Theme } from '../constants/colors';
import { useAuth } from '../lib/auth';
import {
  deleteReaction,
  fetchReactions,
  putReaction,
  isEmailNotVerified,
  REACTION_EMOJI,
  REACTION_LABEL,
  REACTION_ORDER,
  REACTION_DISPLAY_THRESHOLD,
  formatReactionCount,
  type Article,
  type ReactionCounts,
  type ReactionType,
} from '../lib/api';

const EMPTY: ReactionCounts = { like: 0, love: 0, wow: 0, sad: 0, angry: 0, total: 0 };

export interface ReactionState {
  counts: ReactionCounts;
  myReaction: ReactionType | null;
}

/**
 * Shared state + submit logic for both shapes.
 * `onNeedVerification` lets the caller open the gate sheet.
 */
export function useArticleReactions(
  article: Article,
  onNeedVerification: () => void,
  onNeedSignIn?: () => void,
): {
  state: ReactionState;
  pending: boolean;
  toast: string | null;
  toggle: (type: ReactionType) => void;
} {
  const { token, user, emailVerified } = useAuth();
  const [state, setState] = useState<ReactionState>({
    counts: article.reactions ?? EMPTY,
    myReaction: article.myReaction ?? null,
  });
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const toggle = useCallback(
    (type: ReactionType) => {
      // Three states, and no request in either of the first two: a guest has no
      // account to verify, so the verification sheet (with its resend button)
      // would be nonsense for them.
      if (!token || !user) {
        (onNeedSignIn ?? onNeedVerification)();
        return;
      }
      if (!emailVerified) {
        onNeedVerification();
        return;
      }
      if (pending) return;

      const previous = state;
      const removing = state.myReaction === type;

      // Optimistic.
      setState(() => {
        const counts = { ...previous.counts };
        if (previous.myReaction) counts[previous.myReaction] -= 1;
        if (!removing) counts[type] += 1;
        counts.total = REACTION_ORDER.reduce((sum, t) => sum + counts[t], 0);
        return { counts, myReaction: removing ? null : type };
      });
      setPending(true);
      setToast(null);

      const call = removing ? deleteReaction(article.id, token) : putReaction(article.id, type, token);
      call
        // Always trust the server's numbers over the optimistic guess: another
        // user may have reacted in between, and a stale feed payload must never
        // become the displayed count.
        .then((result) => setState({ counts: result.counts, myReaction: result.myReaction }))
        .catch((err) => {
          setState(previous); // roll back
          setToast(
            isEmailNotVerified(err)
              ? 'التفاعل مع الأخبار متاح بعد توثيق بريدك.'
              : 'تعذّر تسجيل التفاعل. تحقّق من الإنترنت.',
          );
        })
        .finally(() => setPending(false));
    },
    [article.id, emailVerified, onNeedVerification, pending, state, token, user],
  );

  return { state, pending, toast, toggle };
}

/** Full bar for the reader. */
export function ReactionsBar({
  t,
  article,
  onNeedVerification,
  onNeedSignIn,
}: {
  t: Theme;
  article: Article;
  onNeedVerification: () => void;
  onNeedSignIn?: () => void;
}) {
  const { state, toast, toggle } = useArticleReactions(article, onNeedVerification, onNeedSignIn);

  return (
    <View style={[styles.bar, { borderColor: t.borderLight }]}>
      <View style={styles.barHeader}>
        <Text style={[styles.barTitle, { color: t.textSecondary }]}>تفاعلات القراء</Text>
        {state.counts.total > 0 ? (
          <Text style={[styles.barTotal, { color: t.textMuted }]}>
            {`${formatReactionCount(state.counts.total)} تفاعل`}
          </Text>
        ) : null}
      </View>

      <View style={styles.barRow}>
        {REACTION_ORDER.map((type) => {
          const active = state.myReaction === type;
          const count = state.counts[type];
          const showCount = count >= REACTION_DISPLAY_THRESHOLD;
          return (
            <TouchableOpacity
              key={type}
              onPress={() => toggle(type)}
              style={[
                styles.reactBtn,
                {
                  backgroundColor: active ? 'rgba(52, 211, 153, 0.20)' : t.pillInactiveBg,
                  borderColor: active ? t.accent : t.borderLight,
                  borderWidth: active ? 1.5 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${REACTION_LABEL[type]}${showCount ? `، ${count}` : ''}`}
            >
              <Text style={styles.emoji}>{REACTION_EMOJI[type]}</Text>
              {showCount ? (
                <Text style={[styles.count, { color: active ? t.accent : t.textSecondary }]}>
                  {formatReactionCount(count)}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {toast ? <Text style={[styles.toast, { color: t.breaking }]}>{toast}</Text> : null}
    </View>
  );
}

/**
 * Compact capsule for feed cards: the top two reactions (or the caller's own
 * first), plus a hint that tapping opens the picker.
 */
export function ReactionsCapsule({
  t,
  article,
  onPress,
  onNeedVerification,
  onNeedSignIn,
}: {
  t: Theme;
  article: Article;
  onPress: () => void;
  onNeedVerification: () => void;
  onNeedSignIn?: () => void;
}) {
  const counts = article.reactions ?? EMPTY;
  const mine = article.myReaction ?? null;

  const top = useMemo(() => {
    const ranked = REACTION_ORDER.filter((type) => counts[type] > 0).sort(
      (a, b) => counts[b] - counts[a],
    );
    if (mine && !ranked.includes(mine)) ranked.unshift(mine);
    return ranked.slice(0, 2);
  }, [counts, mine]);

  const total = counts.total;

  return (
    <TouchableOpacity
      onPress={article.myReaction || total > 0 ? onPress : (onNeedSignIn ?? onNeedVerification)}
      style={[
        styles.capsule,
        {
          backgroundColor: mine ? 'rgba(52, 211, 153, 0.15)' : t.pillInactiveBg,
          borderColor: mine ? t.accent : 'transparent',
          borderWidth: mine ? 1 : 0,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        total > 0 ? `تفاعلات القراء، ${total}` : 'أضف تفاعلًا'
      }
    >
      {top.length > 0 ? (
        <Text style={styles.capsuleEmoji}>
          {top.map((type) => REACTION_EMOJI[type]).join(' ')}
        </Text>
      ) : (
        <Text style={[styles.capsuleEmoji, { color: t.textMuted }]}>＋</Text>
      )}
      {total >= REACTION_DISPLAY_THRESHOLD ? (
        <Text style={[styles.capsuleCount, { color: t.textSecondary }]}>
          {formatReactionCount(total)}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

/** Five large buttons, for the quick picker sheet. */
export function ReactionPicker({
  t,
  article,
  onNeedVerification,
  onNeedSignIn,
}: {
  t: Theme;
  article: Article;
  onNeedVerification: () => void;
  onNeedSignIn?: () => void;
}) {
  const { state, toast, toggle } = useArticleReactions(article, onNeedVerification, onNeedSignIn);

  return (
    <View>
      <View style={styles.pickerRow}>
        {REACTION_ORDER.map((type) => {
          const active = state.myReaction === type;
          const count = state.counts[type];
          return (
            <TouchableOpacity
              key={type}
              onPress={() => toggle(type)}
              style={[
                styles.pickerBtn,
                {
                  backgroundColor: active ? 'rgba(52, 211, 153, 0.20)' : t.pillInactiveBg,
                  borderColor: active ? t.accent : t.borderLight,
                  borderWidth: active ? 1.5 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={REACTION_LABEL[type]}
            >
              <Text style={styles.pickerEmoji}>{REACTION_EMOJI[type]}</Text>
              <Text style={[styles.pickerLabel, { color: active ? t.accent : t.textMuted }]}>
                {count >= REACTION_DISPLAY_THRESHOLD ? formatReactionCount(count) : REACTION_LABEL[type]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {toast ? <Text style={[styles.toast, { color: t.breaking }]}>{toast}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pickerRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  pickerBtn: {
    flex: 1,
    minHeight: 72,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  pickerEmoji: { fontSize: 26 },
  pickerLabel: { fontFamily: 'Cairo_600SemiBold', fontSize: 10 },
  bar: {
    marginTop: 20,
    marginBottom: 24,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  barTitle: { fontFamily: 'Cairo_600SemiBold', fontSize: 13 },
  barTotal: { fontFamily: 'Cairo_400Regular', fontSize: 11 },
  barRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  reactBtn: {
    minHeight: 44,
    minWidth: 54,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexShrink: 1,
  },
  emoji: { fontSize: 20 },
  count: { fontFamily: 'Cairo_600SemiBold', fontSize: 13 },
  toast: { fontFamily: 'Cairo_400Regular', fontSize: 12, marginTop: 10, lineHeight: 20 },
  capsule: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  capsuleEmoji: { fontSize: 14 },
  capsuleCount: { fontFamily: 'Cairo_600SemiBold', fontSize: 12 },
});
