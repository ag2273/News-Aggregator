import React from 'react';
import {
  Image,
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
        <TouchableOpacity style={styles.shareBtn} accessibilityLabel="مشاركة">
          <Ionicons name="share-outline" size={16} color={t.textMuted} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
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
