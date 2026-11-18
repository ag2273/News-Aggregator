/**
 * Story cluster card + source comparison sheet, per the batch-2 design.
 *
 * A cluster is several outlets reporting one event. The card shows the lead
 * article with overlapping source avatars and a "من N مصادر" badge; tapping the
 * badge opens a sheet listing each outlet's version.
 *
 * It reuses FeedCard's content by rendering the lead article inside the same
 * visual shell, so a clustered card looks like a normal card plus a badge.
 */

import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Theme } from '../constants/colors';
import { relativeTime, type Article } from '../lib/api';
import { FeedCard } from './FeedCard';
import { PublisherAvatar } from './Publisher';

export function ClusterBadge({
  t,
  count,
  onPress,
}: {
  t: Theme;
  count: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.badge, { backgroundColor: 'rgba(52, 211, 153, 0.15)', borderColor: 'rgba(52, 211, 153, 0.35)' }]}
      accessibilityRole="button"
      accessibilityLabel={`تغطية من ${count} مصادر`}
    >
      <Ionicons name="layers-outline" size={13} color={t.accent} />
      <Text style={[styles.badgeText, { color: t.accent }]}>{`من ${count} مصادر`}</Text>
      <Ionicons name="chevron-back" size={12} color={t.accent} />
    </TouchableOpacity>
  );
}

export function ClusterCard({
  t,
  lead,
  members,
  sourceCount,
  onPress,
  onPressSource,
  onNeedVerification,
}: {
  t: Theme;
  lead: Article;
  members: Article[];
  sourceCount: number;
  onPress: () => void;
  onPressSource?: () => void;
  onNeedVerification: () => void;
}) {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  // Up to three source avatars, overlapping, per the spec.
  const avatars = React.useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of members) {
      if (seen.has(m.sourceId)) continue;
      seen.add(m.sourceId);
      out.push(m.sourceName);
      if (out.length === 3) break;
    }
    return out;
  }, [members]);

  return (
    <View>
      <View style={styles.clusterHeader}>
        <View style={styles.avatarRow}>
          {avatars.map((name, i) => (
            <View
              key={name}
              style={[
                styles.avatarWrap,
                { borderColor: t.surface, marginStart: i === 0 ? 0 : -10 },
              ]}
            >
              <PublisherAvatar name={name} size={28} t={t} />
            </View>
          ))}
        </View>
        <ClusterBadge t={t} count={sourceCount} onPress={() => setSheetOpen(true)} />
      </View>

      <FeedCard article={lead} t={t} onPress={onPress} onPressSource={onPressSource} />

      <Modal
        visible={sheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: t.surface }]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: t.textPrimary }]}>
                تغطية القصة من عدة مصادر
              </Text>
              <TouchableOpacity
                onPress={() => setSheetOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="إغلاق"
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={20} color={t.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.sheetList}>
              {members.map((m) => (
                <View key={m.id} style={[styles.member, { borderColor: t.borderLight }]}>
                  <PublisherAvatar name={m.sourceName} size={32} t={t} />
                  <View style={styles.memberText}>
                    <Text style={[styles.memberSource, { color: t.textSecondary }]}>
                      {m.sourceName}
                    </Text>
                    <Text style={[styles.memberTitle, { color: t.textPrimary }]} numberOfLines={2}>
                      {m.title}
                    </Text>
                    <Text style={[styles.memberTime, { color: t.textMuted }]}>
                      {relativeTime(m.publishedAt)}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  clusterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  avatarRow: { flexDirection: 'row', alignItems: 'center' },
  avatarWrap: { borderWidth: 2, borderRadius: 14 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgeText: { fontFamily: 'Cairo_700Bold', fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '75%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 18,
    paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    marginBottom: 12,
  },
  sheetTitle: { fontFamily: 'Cairo_700Bold', fontSize: 18 },
  closeBtn: { padding: 8 },
  sheetList: { paddingHorizontal: 18, paddingBottom: 16, gap: 14 },
  member: {
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberText: { flex: 1 },
  memberSource: { fontFamily: 'Cairo_600SemiBold', fontSize: 12, marginBottom: 2 },
  memberTitle: { fontFamily: 'Cairo_400Regular', fontSize: 13, lineHeight: 21 },
  memberTime: { fontFamily: 'Cairo_400Regular', fontSize: 11, marginTop: 4 },
});


/**
 * The comparison sheet on its own, for callers that already render the article
 * somewhere else (the swipe deck). Renders nothing when `article` is null.
 */
export function ClusterSheetHost({
  t,
  article,
  members,
  onClose,
}: {
  t: Theme;
  article: Article | null;
  members: Article[] | undefined;
  onClose: () => void;
}) {
  if (!article || !members || members.length < 2) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: t.surface }]}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: t.textPrimary }]}>
              تغطية القصة من عدة مصادر
            </Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="إغلاق"
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={20} color={t.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.sheetList}>
            {members.map((m) => (
              <View key={m.id} style={[styles.member, { borderColor: t.borderLight }]}>
                <PublisherAvatar name={m.sourceName} size={32} t={t} />
                <View style={styles.memberText}>
                  <Text style={[styles.memberSource, { color: t.textSecondary }]}>
                    {m.sourceName}
                  </Text>
                  <Text style={[styles.memberTitle, { color: t.textPrimary }]} numberOfLines={2}>
                    {m.title}
                  </Text>
                  <Text style={[styles.memberTime, { color: t.textMuted }]}>
                    {relativeTime(m.publishedAt)}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
