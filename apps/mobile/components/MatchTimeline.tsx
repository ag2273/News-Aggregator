import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Theme } from '../constants/colors';
import type { MatchEvent } from '../lib/api';

/**
 * The match timeline.
 *
 * Real data, measured on finished Egyptian league fixtures: the box publishes the
 * minute, the event and the player. The earlier screen said a timeline was
 * impossible; that verdict came from looking only at the page's JSON payload, and
 * it was wrong — the events are in the page's markup. See `matchEvents.ts`.
 *
 * Two honest rules survive:
 *   - A row appears only because the source published it. Nothing is inferred.
 *   - With no rows, the screen says the source has no timeline for THIS match,
 *     which is true of unplayed matches and of competitions the box skips.
 */
export function MatchTimeline({
  t,
  events,
  home,
  away,
  status,
}: {
  t: Theme;
  events: MatchEvent[];
  home: string;
  away: string;
  /** `upcoming` hides the empty-timeline line behind the "not started" copy. */
  status: 'live' | 'upcoming' | 'finished' | 'unknown';
}) {
  if (events.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="time-outline" size={24} color={t.textMuted} />
        <Text style={[styles.emptyText, { color: t.textMuted }]}>
          {status === 'upcoming'
            ? 'لم تبدأ المباراة بعد، فمفيش أحداث لسه. هتظهر هنا مع انطلاقها.'
            : 'المصدر مش ناشر أحداث لهذه المباراة. مش بنضيف دقائق من عندنا.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.borderLight }]}>
      <View style={[styles.head, { borderBottomColor: t.borderLight }]}>
        <Text style={[styles.headTeam, { color: t.textPrimary }]} numberOfLines={1}>
          {home}
        </Text>
        <Text style={[styles.headLabel, { color: t.textMuted }]}>الأحداث</Text>
        <Text style={[styles.headTeam, { color: t.textPrimary }]} numberOfLines={1}>
          {away}
        </Text>
      </View>
      {events.map((e, i) => {
        const isGoal = /هدف|ركلة جزاء/.test(e.type);
        // `r` is the right-hand column, which in this RTL layout is the home side.
        const isHome = e.side === 'r';
        return (
          <View
            key={`${e.minute}-${i}-${e.type}`}
            style={[styles.row, { borderBottomColor: t.borderLight }]}
          >
            {/* left column = away, right column = home, matching the header */}
            <View style={styles.sideAway}>
              {!isHome ? (
                <EventBit t={t} e={e} goal={isGoal} align="flex-start" />
              ) : null}
            </View>
            <View
              style={[
                styles.minuteChip,
                {
                  backgroundColor: isGoal ? t.accentSoft : t.badgePlate,
                  borderColor: isGoal ? t.accentBorder : t.borderLight,
                },
              ]}
            >
              <Text style={[styles.minute, { color: isGoal ? t.accent : t.textMuted }]}>
                {`${e.minute}'`}
              </Text>
            </View>
            <View style={styles.sideHome}>
              {isHome ? <EventBit t={t} e={e} goal={isGoal} align="flex-end" /> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function EventBit({
  t,
  e,
  goal,
  align,
}: {
  t: Theme;
  e: MatchEvent;
  goal: boolean;
  align: 'flex-start' | 'flex-end';
}) {
  return (
    <View style={{ alignItems: align, flexShrink: 1 }}>
      <Text
        style={[styles.eventType, { color: goal ? t.textPrimary : t.textSecondary }]}
        numberOfLines={1}
      >
        {`${goal ? '⚽ ' : ''}${e.type}`}
      </Text>
      {e.player ? (
        <Text style={[styles.player, { color: t.textMuted }]} numberOfLines={2}>
          {e.player}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 6,
  },
  headTeam: { fontFamily: 'Cairo_700Bold', fontSize: 12, flex: 1, textAlign: 'center' },
  headLabel: { fontFamily: 'Cairo_700Bold', fontSize: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  sideAway: { flex: 1, alignItems: 'flex-start' },
  sideHome: { flex: 1, alignItems: 'flex-end' },
  minuteChip: {
    minWidth: 38,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  minute: { fontFamily: 'Cairo_700Bold', fontSize: 11, fontVariant: ['tabular-nums'] },
  eventType: { fontFamily: 'Cairo_600SemiBold', fontSize: 11 },
  player: { fontFamily: 'Cairo_400Regular', fontSize: 11, lineHeight: 16 },
  empty: { alignItems: 'center', gap: 8, padding: 24 },
  emptyText: { fontFamily: 'Cairo_400Regular', fontSize: 12, lineHeight: 20, textAlign: 'center' },
});
