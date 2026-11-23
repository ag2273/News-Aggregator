import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import type { Theme } from '../constants/colors';

/**
 * The tactical pitch (#28), drawn to the approved preview file.
 *
 * Geometry is the file's own: a 340×405 viewBox with the outer boundary at 10px, the
 * halfway line at 202.5, a 40px centre circle, penalty boxes 190×65 and goal areas
 * 110×24, penalty spots at y=48 and y=357, and 10px corner arcs. The away half is on
 * TOP and home on the BOTTOM — the file states that (`TOP HALF: PYRAMIDS (away)`),
 * and the direction tags say which way each side attacks.
 *
 * The file's jersey colours are used literally: the home side takes the club's own
 * colours so a reader recognises their team, and a keeper gets its own variant so
 * the goalkeeper is not lost among ten outfield shirts.
 *
 * A formation the source did not publish is never invented: a half with no players
 * draws the file's honest-state card instead.
 */

export interface PitchPlayer {
  /** Shirt number as the source published it. */
  shirtNumber: number | null;
  name: string;
  /** «حارس مرمى» etc., when the source names a position. */
  position: string | null;
  isCaptain?: boolean;
  /** Goals scored, for the goal badge. */
  goals?: number;
  /** Booked, for the card badge. */
  booked?: boolean;
  /** Substituted off, for the arrow badge. */
  subbedOff?: boolean;
}

export interface PitchTeam {
  name: string;
  /** «4-3-3» when announced; null otherwise. */
  formation: string | null;
  players: PitchPlayer[];
  /** Home is the BOTTOM half, attacking up. Away is the TOP half, attacking down. */
  side: 'home' | 'away';
}

/** The file's jersey themes, per side and for the keeper. */
const JERSEY = {
  home: { bg: '#DC2626', border: '#FEF08A', text: '#FFFFFF' },
  homeGk: { bg: '#FBBF24', border: '#FFFFFF', text: '#000000' },
  away: { bg: '#0284C7', border: '#BAE6FD', text: '#FFFFFF' },
  awayGk: { bg: '#475569', border: '#94A3B8', text: '#FFFFFF' },
} as const;

const isKeeper = (p: PitchPlayer): boolean => /حارس|goalkeeper|GK/i.test(p.position ?? '');

/**
 * Split players into formation rows.
 *
 * The preview file draws a keeper on his own, then the defensive/midfield/attacking
 * lines from the formation string («4-2-3-1» → 4, 2, 3, 1). The source does not send
 * row membership, so the split is derived from the formation itself and the keeper is
 * taken out first — the one ordering every published line-up agrees on.
 */
export function formationRows(players: PitchPlayer[], formation: string | null): PitchPlayer[][] {
  const keeper = players.filter(isKeeper);
  const outfield = players.filter((p) => !isKeeper(p));
  const shape = (formation ?? '')
    .split('-')
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  // No usable formation: one grid, so every player still gets drawn.
  const total = shape.reduce((a, b) => a + b, 0);
  if (!shape.length || total !== outfield.length) {
    const rows: PitchPlayer[][] = [];
    if (keeper.length) rows.push(keeper.slice(0, 1));
    if (outfield.length) rows.push(outfield);
    return rows;
  }

  const rows: PitchPlayer[][] = [];
  if (keeper.length) rows.push(keeper.slice(0, 1));
  let i = 0;
  for (const n of shape) {
    rows.push(outfield.slice(i, i + n));
    i += n;
  }
  return rows;
}

function PlayerNode({ player, side, t }: { player: PitchPlayer; side: 'home' | 'away'; t: Theme }) {
  const keeper = isKeeper(player);
  const jersey =
    side === 'home' ? (keeper ? JERSEY.homeGk : JERSEY.home) : keeper ? JERSEY.awayGk : JERSEY.away;

  return (
    <View style={styles.node}>
      <View
        style={[
          styles.jersey,
          { backgroundColor: jersey.bg, borderColor: jersey.border },
        ]}
        accessibilityLabel={`${player.name}${player.shirtNumber === null ? '' : ` رقم ${player.shirtNumber}`}`}
      >
        <Text style={[styles.jerseyNum, { color: jersey.text }]}>
          {player.shirtNumber === null ? '' : player.shirtNumber}
        </Text>
      </View>
      {/* The file's captain band, goal and card badges. */}
      {player.isCaptain ? (
        <View style={styles.captainBadge}>
          <Text style={styles.captainText}>C</Text>
        </View>
      ) : null}
      {player.goals ? (
        <Text style={styles.eventBadge}>{player.goals > 1 ? `⚽${player.goals}` : '⚽'}</Text>
      ) : player.booked ? (
        <Text style={styles.eventBadge}>🟨</Text>
      ) : null}
      <Text style={styles.name} numberOfLines={1}>
        {player.name}
      </Text>
    </View>
  );
}

/** One half of the pitch: a direction tag and the formation rows. */
function PitchHalf({
  team,
  t,
  honestText,
}: {
  team: PitchTeam;
  t: Theme;
  honestText: string;
}) {
  const rows = formationRows(team.players, team.formation);
  const empty = team.players.length === 0;

  return (
    <View style={[styles.half, team.side === 'away' && styles.awayHalf]}>
      <View style={styles.directionTag}>
        <Text style={styles.directionText} numberOfLines={1}>
          {`${team.name}${team.formation ? ` (${team.formation})` : ''}`}
        </Text>
        <Text style={styles.directionArrow}>{team.side === 'away' ? '↓' : '↑'}</Text>
      </View>

      {empty ? (
        <View style={styles.honestCard}>
          <Text style={styles.honestTitle}>التشكيل غير معلن</Text>
          <Text style={styles.honestBody}>{honestText}</Text>
        </View>
      ) : (
        rows.map((row, i) => (
          <View key={`${team.side}-row-${i}`} style={styles.formationRow}>
            {row.map((p, k) => (
              <PlayerNode key={`${p.name}-${k}`} player={p} side={team.side} t={t} />
            ))}
          </View>
        ))
      )}
    </View>
  );
}

/**
 * The full pitch: away on top, home on the bottom, the file's markings between them.
 */
export function TacticalPitch({
  t,
  home,
  away,
  honestText = 'المصدر مش ناشر التشكيل لسه.',
}: {
  t: Theme;
  home: PitchTeam;
  away: PitchTeam;
  /** Shown in a half whose line-up the source has not published. */
  honestText?: string;
}) {
  return (
    <View style={styles.pitch}>
      {/* Alternating lawn stripes, as the file draws them. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {Array.from({ length: 6 }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.stripe,
              i % 2 === 1 && { backgroundColor: 'rgba(255,255,255,0.04)' },
            ]}
          />
        ))}
      </View>

      {/* The file's own line geometry, reused verbatim. */}
      <Svg
        viewBox="0 0 340 405"
        preserveAspectRatio="none"
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      >
        <Rect x={10} y={10} width={320} height={385} fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth={1.8} />
        <Line x1={10} y1={202.5} x2={330} y2={202.5} stroke="rgba(255,255,255,0.65)" strokeWidth={1.8} />
        <Circle cx={170} cy={202.5} r={40} fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth={1.8} />
        <Circle cx={170} cy={202.5} r={2.5} fill="rgba(255,255,255,0.7)" />

        {/* Away goal, top. */}
        <Rect x={75} y={10} width={190} height={65} fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth={1.5} />
        <Rect x={115} y={10} width={110} height={24} fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth={1.5} />
        <Circle cx={170} cy={48} r={2} fill="rgba(255,255,255,0.7)" />
        <Path d="M 135 75 A 35 35 0 0 0 205 75" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={1.5} />

        {/* Home goal, bottom. */}
        <Rect x={75} y={330} width={190} height={65} fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth={1.5} />
        <Rect x={115} y={371} width={110} height={24} fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth={1.5} />
        <Circle cx={170} cy={357} r={2} fill="rgba(255,255,255,0.7)" />
        <Path d="M 135 330 A 35 35 0 0 1 205 330" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={1.5} />

        {/* Corner arcs. */}
        <Path d="M 10 20 A 10 10 0 0 0 20 10" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={1.2} />
        <Path d="M 320 10 A 10 10 0 0 0 330 20" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={1.2} />
        <Path d="M 10 385 A 10 10 0 0 1 20 395" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={1.2} />
        <Path d="M 320 395 A 10 10 0 0 1 330 385" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={1.2} />
      </Svg>

      <View style={styles.halves}>
        <PitchHalf team={away} t={t} honestText={honestText} />
        <PitchHalf team={home} t={t} honestText={honestText} />
      </View>
    </View>
  );
}

/** The file's quick-stats strip under the pitch. */
export function PitchStats({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  if (!items.length) return null;
  return (
    <View style={styles.statsBar}>
      {items.map((x) => (
        <View key={x.label} style={styles.statItem}>
          <Text style={styles.statLabel}>{x.label}</Text>
          <Text style={styles.statValue}>{x.value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // The file: pitch-green gradient, 1px accent border, 16px radius.
  pitch: {
    backgroundColor: '#0F4228',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.3)',
    borderRadius: 16,
    overflow: 'hidden',
    // 340:405 is the file's own aspect; it keeps the markings from stretching.
    aspectRatio: 340 / 405,
    position: 'relative',
  },
  stripe: { flex: 1 },
  halves: { flex: 1, flexDirection: 'column' },
  half: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
    justifyContent: 'space-between',
    zIndex: 10,
  },
  awayHalf: { borderBottomWidth: 1, borderStyle: 'dashed', borderBottomColor: 'rgba(255,255,255,0.25)' },
  directionTag: {
    position: 'absolute',
    top: 6,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    zIndex: 30,
    maxWidth: '70%',
  },
  directionText: { fontFamily: 'Cairo_700Bold', fontSize: 9, color: '#CBD5E1' },
  directionArrow: { fontSize: 9, color: '#CBD5E1' },
  formationRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    zIndex: 20,
  },
  node: { alignItems: 'center', gap: 2, position: 'relative' },
  jersey: {
    width: 27,
    height: 27,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  jerseyNum: { fontFamily: 'Cairo_700Bold', fontSize: 11 },
  captainBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  captainText: { fontFamily: 'Cairo_700Bold', fontSize: 8, color: '#000000' },
  eventBadge: { position: 'absolute', bottom: 8, right: -3, fontSize: 9 },
  name: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 9,
    color: '#FFFFFF',
    backgroundColor: 'rgba(6,11,8,0.85)',
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 3,
    maxWidth: 74,
  },
  honestCard: {
    alignSelf: 'center',
    marginVertical: 'auto',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(24,39,33,0.8)',
    alignItems: 'center',
    gap: 2,
  },
  honestTitle: { fontFamily: 'Cairo_700Bold', fontSize: 11, color: '#FFFFFF' },
  honestBody: { fontFamily: 'Cairo_400Regular', fontSize: 10, color: '#94A3B8', textAlign: 'center' },
  statsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(18,34,27,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  statItem: { alignItems: 'center' },
  statLabel: { fontFamily: 'Cairo_400Regular', fontSize: 9.5, color: '#64748B', marginBottom: 1 },
  statValue: { fontFamily: 'Cairo_700Bold', fontSize: 11, color: '#FFFFFF' },
});
