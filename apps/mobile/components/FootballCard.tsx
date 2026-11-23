import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Theme } from '../constants/colors';
import { TeamCrest } from './TeamCrest';
import type { FootballMatch } from '../lib/api';

/**
 * The football screen pieces shared by matches, competition and team pages, drawn
 * to the approved design file.
 *
 * Two rules they all keep, because the data demands it:
 *
 *   1. A live match shows the score and the half. It shows a minute ONLY when the
 *      source published one (European fixtures). Egyptian coverage has none, and
 *      a made-up minute is worse than no minute.
 *   2. Anything the source did not send is omitted, not blanked: no stadium line,
 *      no channel chip, no crest ring. An empty slot reads as a bug; a shorter
 *      card reads as a match with less published about it.
 */

/** Arabic plural for a count of matches. */
export function matchCountLabel(n: number): string {
  if (n === 1) return 'مباراة';
  if (n === 2) return 'مباراتان';
  if (n >= 3 && n <= 10) return `${n} مباريات`;
  return `${n} مباراة`;
}

/** Emoji flag for the group badge, from the competition's country code. */
const COUNTRY_FLAG: Record<string, string> = {
  EG: '🇪🇬',
  GB: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  ES: '🇪🇸',
  IT: '🇮🇹',
  DE: '🇩🇪',
  FR: '🇫🇷',
  SA: '🇸🇦',
  AF: '🌍',
  EU: '🏆',
};

/**
 * A competition group header: the design's league strip.
 *
 * Flag, name, and a sub-line that is a real fact about these rows (the round, when
 * the source names one) rather than a decorative «الأولوية الأولى». The count is
 * the number of fixtures actually under it, and the star is the league follow —
 * additive to the team follows.
 */
export function LeagueStrip({
  t,
  name,
  country,
  rows,
  followed,
  collapsed,
  onToggleCollapse,
  onToggleFollow,
  onOpen,
}: {
  t: Theme;
  name: string;
  country?: string;
  rows: FootballMatch[];
  followed: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onToggleFollow: () => void;
  /** Open the competition page. Omitted for a competition `other` rows belong to. */
  onOpen?: () => void;
}) {
  const round = rows.find((m) => m.round)?.round ?? null;
  const flag = country ? COUNTRY_FLAG[country] ?? '⚽' : '⚽';
  return (
    <View style={[styles.strip, { borderColor: t.borderLight, borderRightColor: t.accent }]}>
      <TouchableOpacity
        style={styles.stripTap}
        onPress={onToggleCollapse}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={`${name} — ${collapsed ? 'توسيع' : 'طي'}`}
      >
        <View style={[styles.flagBadge, { backgroundColor: t.badgePlate }]}>
          <Text style={styles.flagText}>{flag}</Text>
        </View>
        <View style={styles.stripText}>
          <Text style={[styles.stripName, { color: t.textPrimary }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.stripSub, { color: t.accent }]} numberOfLines={1}>
            {round ? round : matchCountLabel(rows.length)}
          </Text>
        </View>
      </TouchableOpacity>
      <View style={styles.stripRight}>
        <View style={[styles.countPill, { backgroundColor: t.badgePlate }]}>
          <Text style={[styles.countText, { color: t.textMuted }]} numberOfLines={1}>
            {rows.length === 0 ? 'لا مباريات' : matchCountLabel(rows.length)}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onToggleFollow}
          style={styles.stripIconBtn}
          accessibilityRole="button"
          accessibilityLabel={followed ? `إلغاء متابعة ${name}` : `متابعة ${name}`}
        >
          <Ionicons
            name={followed ? 'star' : 'star-outline'}
            size={16}
            color={followed ? t.accent : t.textMuted}
          />
        </TouchableOpacity>
        {onOpen ? (
          <TouchableOpacity
            onPress={onOpen}
            style={styles.stripIconBtn}
            accessibilityRole="button"
            accessibilityLabel={`${name} — صفحة البطولة`}
          >
            <Ionicons name="chevron-back" size={15} color={t.textMuted} />
          </TouchableOpacity>
        ) : (
          <Ionicons
            name={collapsed ? 'chevron-back' : 'chevron-down'}
            size={15}
            color={t.textMuted}
          />
        )}
      </View>
    </View>
  );
}

/**
 * One fixture.
 *
 * A live match is the design's live card: a tinted plate, the live pill with the
 * half, and the score as the loudest element. Everything else is the upcoming
 * card: crests, the kickoff in a time badge, and the channel under it.
 */
export function MatchCard({
  t,
  m,
  favourite,
  onPress,
  onPressTeam,
  showCompetition = false,
  channelFallback,
}: {
  t: Theme;
  m: FootballMatch;
  favourite?: boolean;
  onPress: () => void;
  onPressTeam: (name: string) => void;
  /**
   * Print the competition on the card.
   *
   * Off under a league strip, where the heading already says it — the group
   * header IS the competition, and repeating it on every card under it is the
   * duplication the design's hierarchy removes. On for a page that mixes
   * competitions (a team page, the followed strip).
   */
  showCompetition?: boolean;
  /**
   * What to print when the source named no broadcaster.
   *
   * Only the agenda passes one: a list whose whole point is «what channel is it
   * on» must say the channel is not announced rather than leave the slot empty.
   * The day list omits it, because there the channel is a bonus, not the subject.
   */
  channelFallback?: string;
}) {
  const isLive = m.status === 'live';
  const hasScore = m.homeScore !== null && m.awayScore !== null;
  const half = m.statusText?.trim() || (isLive ? 'مباشر' : '');
  // The agreed ceiling: score + half for Egyptian coverage, and a minute only
  // where the provider actually published one.
  const liveLabel = isLive ? (m.minute ? `الدقيقة ${m.minute}' • ${half}` : half) : '';

  const team = (name: string, logo?: string | null) => (
    <TouchableOpacity
      style={styles.teamCol}
      onPress={() => onPressTeam(name)}
      accessibilityRole="button"
      accessibilityLabel={`${name} — صفحة الفريق`}
    >
      <TeamCrest logo={logo ?? null} name={name} size={36} t={t} />
      <Text style={[styles.teamName, { color: t.textPrimary }]} numberOfLines={2}>
        {name}
      </Text>
    </TouchableOpacity>
  );

  return (
    <TouchableOpacity
      style={[
        isLive ? styles.liveCard : styles.card,
        {
          borderColor: isLive ? t.accentBorder : t.borderLight,
          backgroundColor: isLive ? t.cardGradientStart : t.surface,
        },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${m.home} ضد ${m.away}`}
    >
      {isLive ? <View style={[styles.liveRail, { backgroundColor: t.accent }]} /> : null}

      {/* Meta bar: the live pill on one side, venue/competition on the other. */}
      <View style={styles.metaBar}>
        {isLive ? (
          <View
            style={[
              styles.livePill,
              { backgroundColor: t.liveRedBg, borderColor: t.liveRedBorder },
            ]}
          >
            <View style={[styles.liveDot, { backgroundColor: t.liveRed }]} />
            <Text style={[styles.livePillText, { color: t.liveRed }]} numberOfLines={1}>
              {liveLabel}
            </Text>
          </View>
        ) : (
          <Text style={[styles.metaText, { color: t.textDim }]} numberOfLines={1}>
            {[showCompetition ? m.competitionName : null, m.round, m.stadium]
              .filter(Boolean)
              .join(' • ')}
          </Text>
        )}
        {isLive ? (
          <Text style={[styles.metaText, { color: t.textDim }]} numberOfLines={1}>
            {[showCompetition ? m.competitionName : null, m.stadium]
              .filter(Boolean)
              .join(' • ')}
          </Text>
        ) : null}
        {favourite ? <Ionicons name="star" size={12} color={t.accent} /> : null}
      </View>

      <View style={styles.scoreRow}>
        {team(m.home, m.homeLogo)}
        <View style={styles.scoreCenter}>
          {hasScore ? (
            <Text style={[styles.score, { color: isLive ? t.textPrimary : t.textPrimary }]}>
              {`${m.homeScore} - ${m.awayScore}`}
            </Text>
          ) : (
            <View style={[styles.timeBadge, { backgroundColor: t.badgePlate }]}>
              <Text style={[styles.timeDigits, { color: t.accent }]}>{m.kickoff ?? '—'}</Text>
              {m.channel ? (
                <Text style={[styles.channel, { color: t.textDim }]} numberOfLines={1}>
                  {m.channel}
                </Text>
              ) : channelFallback ? (
                <Text style={[styles.channel, { color: t.textMuted }]} numberOfLines={1}>
                  {channelFallback}
                </Text>
              ) : null}
            </View>
          )}
          {hasScore && m.channel ? (
            <Text style={[styles.channelUnder, { color: t.textDim }]} numberOfLines={1}>
              {m.channel}
            </Text>
          ) : null}
          {!hasScore && isLive ? (
            <Text style={[styles.channelUnder, { color: t.textMuted }]}>النتيجة لم تصل بعد</Text>
          ) : null}
        </View>
        {team(m.away, m.awayLogo)}
      </View>

      {/* Nothing else to print: the venue and round are both in the meta bar above,
          and the channel sits under the kickoff. A second stadium line was the
          duplication in the user's screenshot (#34), so this block is deliberately
          gone rather than guarded. */}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
    marginBottom: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderRightWidth: 3,
    gap: 8,
  },
  stripTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  flagBadge: { width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  flagText: { fontSize: 13 },
  stripText: { flexShrink: 1 },
  stripName: { fontFamily: 'Cairo_700Bold', fontSize: 13 },
  stripSub: { fontFamily: 'Cairo_700Bold', fontSize: 10, marginTop: 1 },
  stripRight: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  countPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  countText: { fontFamily: 'Cairo_600SemiBold', fontSize: 10 },
  stripIconBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 10 },
  liveCard: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 12, overflow: 'hidden' },
  liveRail: { position: 'absolute', top: 0, right: 0, left: 0, height: 1 },
  metaBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  metaText: { fontFamily: 'Cairo_600SemiBold', fontSize: 10, flexShrink: 1 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 1,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  livePillText: { fontFamily: 'Cairo_700Bold', fontSize: 11, flexShrink: 1 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamCol: { flex: 1, alignItems: 'center', gap: 6 },
  teamName: { fontFamily: 'Cairo_700Bold', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  scoreCenter: { alignItems: 'center', gap: 2, minWidth: 86 },
  score: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 28,
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  timeBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, alignItems: 'center' },
  timeDigits: { fontFamily: 'Cairo_700Bold', fontSize: 15, fontVariant: ['tabular-nums'] },
  channel: { fontFamily: 'Cairo_400Regular', fontSize: 9, marginTop: 1 },
  channelUnder: { fontFamily: 'Cairo_400Regular', fontSize: 9, textAlign: 'center' },
  roundLine: { fontFamily: 'Cairo_400Regular', fontSize: 10, textAlign: 'center' },
});
