import React, { useState } from 'react';
import {
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { relativeTime } from '../lib/api';
import type { Article } from '../lib/api';
import type { Theme } from '../constants/colors';
import { PublisherAvatar, PublisherMeta } from './Publisher';
import { ReactionsCapsule, ReactionPicker } from './Reactions';
import { VerificationGate } from './VerificationGate';

/** Full-width vertical feed card: publisher header → headline → cover image → footer. */
export function FeedCard({
  article,
  t,
  onPress,
  onPressSource,
  rank,
}: {
  article: Article;
  t: Theme;
  onPress: () => void;
  onPressSource?: () => void;
  rank?: number;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={[styles.card, { backgroundColor: t.surface }]}
      accessibilityRole="button"
      accessibilityLabel={article.title}
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.publisherRow}
          onPress={onPressSource}
          disabled={!onPressSource}
          activeOpacity={0.7}
        >
          <PublisherAvatar name={article.sourceName} t={t} />
          <PublisherMeta name={article.sourceName} relative={relativeTime(article.publishedAt)} t={t} />
        </TouchableOpacity>
        <View style={styles.headerTrailing}>
          {article.isBreaking ? (
            <View style={[styles.breakingBadge, { backgroundColor: t.breaking }]}>
              <Text style={styles.breakingText}>عاجل</Text>
            </View>
          ) : null}
          {typeof rank === 'number' ? (
            <Text style={[styles.rank, { color: t.breaking }]}>{`#${rank}`}</Text>
          ) : null}
          <View style={[styles.moreBtn, { backgroundColor: t.surfaceSubtle }]}>
            <Ionicons name="ellipsis-vertical" size={16} color={t.textMuted} />
          </View>
        </View>
      </View>

      <Text style={[styles.title, { color: t.textPrimary }]} numberOfLines={3}>
        {article.title}
      </Text>

      {article.imageUrl ? (
        <Image source={{ uri: article.imageUrl }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.image, styles.imagePlaceholder, { backgroundColor: t.pillInactiveBg }]}>
          <Ionicons name="newspaper-outline" size={30} color={t.textMuted} />
        </View>
      )}

      <View style={[styles.footer, { borderColor: t.borderLight }]}>
        <Text style={[styles.footerText, { color: t.textMuted }]}>
          {relativeTime(article.publishedAt)}
        </Text>

        <ReactionsCapsule
          t={t}
          article={article}
          onPress={() => setPickerOpen(true)}
          onNeedVerification={() => setGateOpen(true)}
        />

        <TouchableOpacity
          style={styles.shareBtn}
          accessibilityLabel="مشاركة"
          onPress={(e) => {
            // Do not open the article when sharing.
            e.stopPropagation?.();
          }}
        >
          <Ionicons name="share-outline" size={16} color={t.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Quick reaction picker for this card */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity
          style={styles.pickerBackdrop}
          activeOpacity={1}
          onPress={() => setPickerOpen(false)}
        >
          <View style={[styles.pickerSheet, { backgroundColor: t.surface }]}>
            <Text style={[styles.pickerTitle, { color: t.textPrimary }]}>تفاعل مع الخبر</Text>
            <ReactionPicker
              t={t}
              article={article}
              onNeedVerification={() => {
                setPickerOpen(false);
                setGateOpen(true);
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={gateOpen} transparent animationType="fade" onRequestClose={() => setGateOpen(false)}>
        <View style={styles.pickerBackdrop}>
          <View style={[styles.pickerSheet, { backgroundColor: t.surface }]}>
            <VerificationGate
              t={t}
              icon="chatbubble-ellipses-outline"
              title="وثّق بريدك أولاً"
              subtitle="التفاعل مع الأخبار متاح بعد توثيق بريدك الإلكتروني. افتح الرابط الذي وصلك على بريدك."
            />
          </View>
        </View>
      </Modal>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 20,
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  pickerTitle: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 16,
  },
  card: {
    borderRadius: 26,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTrailing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breakingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breakingText: {
    color: '#FFFFFF',
    fontFamily: 'Cairo_700Bold',
    fontSize: 11,
    lineHeight: 16,
  },
  rank: { fontFamily: 'Cairo_700Bold', fontSize: 15 },
  publisherRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  moreBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: 'Cairo_700Bold', fontSize: 16, lineHeight: 25, marginBottom: 12 },
  image: { width: '100%', height: 180, borderRadius: 20 },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerText: { fontFamily: 'Cairo_400Regular', fontSize: 12 },
  shareBtn: { padding: 4 },
});
