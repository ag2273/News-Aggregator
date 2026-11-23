import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Theme } from '../constants/colors';
import type { MatchEvent, MatchGoal } from '../lib/api';

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
  goals: goalList,
  home,
  away,
  status,
}: {
  t: Theme;
  events: MatchEvent[];
  /**
   * Scorers with minutes, from a source that publishes them.
   *
   * Shown as its own summary above the timeline: Yallakora carries this for
   * Egyptian fixtures, where the goal list is what a reader looks for first.
   */
  goals?: MatchGoal[];
  home: string;
  away: string;
  /** `upcoming` hides the empty-timeline line behind the "not started" copy. */
  status: 'live' | 'upcoming' | 'finished' | 'unknown';
}) {
  const goals = goalList ?? [];
  // Two guards, because a timeline row without a minute is not an event.
  //   1. `isStatus` rows are the page's own state markers, not things that
  //      happened — the server filters them, and so does this screen, so an older
  //      cached payload cannot put them back.
  //   2. A row with a null minute has nothing to place on a timeline. Rendering it
  //      is what printed the literal «null'» in the user's screenshot (issue #30).
  const rows = events.filter(
    (e) => !(e as { isStatus?: boolean }).isStatus && e.minute !== null && e.minute !== undefined,
  );

  if (rows.length === 0 && goals.length === 0) {
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
      {/* Scorers first: «مين سجل ومتى» is the question a reader opens this tab for,
          and a source that publishes it deserves to be shown before the detail. */}
      {goals.length ? (
        <View style={[styles.goalsBox, { borderBottomColor: t.borderLight }]}>
          <Text style={[styles.goalsTitle, { color: t.accent }]}>⚽ الهدافون</Text>
          {goals.map((g, i) => (
            <View key={`${g.player}-${g.minute}-${i}`} style={styles.goalRow}>
              <Text style={[styles.goalSide, { color: t.textMuted }]} numberOfLines={1}>
                {g.side === 'A' ? home : away}
              </Text>
              <Text style={[styles.goalPlayer, { color: t.textPrimary }]} numberOfLines={1}>
                {`${g.player}${g.ownGoal ? ' (هدف ذاتي)' : ''}`}
              </Text>
              <Text style={[styles.goalMinute, { color: t.accent }]}>
                {g.minute === null ? '—' : `${g.minute}'`}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {rows.length === 0 ? null : (
      <>
      <View style={[styles.head, { borderBottomColor: t.borderLight }]}>
        <Text style={[styles.headTeam, { color: t.textPrimary }]} numberOfLines={1}>
          {home}
        </Text>
        <Text style={[styles.headLabel, { color: t.textMuted }]}>الأحداث</Text>
        <Text style={[styles.headTeam, { color: t.textPrimary }]} numberOfLines={1}>
          {away}
        </Text>
      </View>
      {rows.map((e, i) => {
        const isGoal = /هدف|ركلة جزاء/.test(e.type);
        // `r` is the page's right-hand column, which is the home side.
        // A row the page did not attribute belongs to NEITHER column: putting it
        // in the away cell (what `side === 'r'` being false used to do) invented a
        // team for it, which is the same class of error as #33.
        const isHome = e.side === 'r';
        const isAway = e.side === 'l';
        const neutral = !isHome && !isAway;

        // A row the source did not attribute still happened, so it is shown — in a
        // full-width row with no team column, rather than being forced into one or
        // silently dropped.
        if (neutral) {
          return (
            <View
              key={`${e.minute}-${i}-${e.type}`}
              style={[styles.neutralRow, { borderBottomColor: t.borderLight }]}
            >
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
              <EventBit t={t} e={e} goal={isGoal} align="flex-start" />
            </View>
          );
        }

        return (
          <View
            key={`${e.minute}-${i}-${e.type}`}
            style={[styles.row, { borderBottomColor: t.borderLight }]}
          >
            {/* The header prints home first, so in this RTL row home is the RIGHT
                column. The body must put home first too: it previously put away
                first, which drew every الزمالك goal under الجونة — the swap the
                user photographed (#33). First child = rightmost in RTL, always. */}
            <View style={styles.sideHome}>
              {isHome ? <EventBit t={t} e={e} goal={isGoal} align="flex-start" /> : null}
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
              {/* `rows` guarantees a number here; the guard is belt and braces so
                  a future caller cannot reintroduce a «null'» badge. */}
              <Text style={[styles.minute, { color: isGoal ? t.accent : t.textMuted }]}>
                {e.minute === null || e.minute === undefined ? '—' : `${e.minute}'`}
              </Text>
            </View>
            <View style={styles.sideAway}>
              {isAway ? <EventBit t={t} e={e} goal={isGoal} align="flex-end" /> : null}
            </View>
          </View>
        );
      })}
      </>
      )}
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
  goalsBox: { paddingHorizontal: 12, paddingVertical: 10, gap: 6, borderBottomWidth: 1 },
  goalsTitle: { fontFamily: 'Cairo_700Bold', fontSize: 12, marginBottom: 2 },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  goalSide: { fontFamily: 'Cairo_400Regular', fontSize: 10, flex: 1.1 },
  goalPlayer: { fontFamily: 'Cairo_600SemiBold', fontSize: 12, flex: 1.4 },
  goalMinute: { fontFamily: 'Cairo_700Bold', fontSize: 11, fontVariant: ['tabular-nums'] },
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
  // RTL: the first child of a row sits on the right. Home is first, so home is
  // the right column and aligns to the start of the writing direction.
  neutralRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sideHome: { flex: 1, alignItems: 'flex-start' },
  sideAway: { flex: 1, alignItems: 'flex-end' },
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
