import React, { useCallback, useState, useRef } from 'react';
import {
  FlatList,
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchFeed, relativeTime } from '../lib/api';
import type { Article } from '../lib/api';

const PAGE_SIZE = 30;

export default function FeedScreen() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);

  const load = useCallback(async (replace: boolean) => {
    try {
      const offset = replace ? 0 : offsetRef.current;
      const data = await fetchFeed(PAGE_SIZE, offset);
      if (replace) {
        setArticles(data);
        offsetRef.current = data.length;
      } else {
        setArticles((prev) => [...prev, ...data]);
        offsetRef.current += data.length;
      }
      hasMoreRef.current = data.length === PAGE_SIZE;
      setError(null);
    } catch (e) {
      setError('تعذّر تحميل الأخبار. تحقق من الاتصال.');
    }
  }, []);

  React.useEffect(() => {
    load(true).finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const onEndReached = useCallback(async () => {
    if (!hasMoreRef.current || loadingMore) return;
    setLoadingMore(true);
    await load(false);
    setLoadingMore(false);
  }, [load, loadingMore]);

  const openArticle = useCallback((url: string) => {
    Linking.openURL(url);
  }, []);

  const renderItem = ({ item }: { item: Article }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => openArticle(item.url)}
      activeOpacity={0.8}
      accessibilityLabel={item.title}
      accessibilityRole="button"
    >
      {item.imageUrl ? (
        <Image
          source={{ uri: item.imageUrl }}
          style={styles.thumb}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <Text style={styles.thumbPlaceholderText}>📰</Text>
        </View>
      )}
      <View style={styles.cardBody}>
        <Text style={styles.sourceName}>{item.sourceName}</Text>
        <Text style={styles.headline} numberOfLines={3}>
          {item.title}
        </Text>
        <Text style={styles.time}>{relativeTime(item.publishedAt)}</Text>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#2D6A4F" />
      </SafeAreaView>
    );
  }

  if (error && articles.length === 0) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => load(true)}>
          <Text style={styles.retryText}>إعادة المحاولة</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>الأخبار</Text>
      </View>
      <FlatList
        data={articles}
        keyExtractor={(a) => a.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#2D6A4F"
          />
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator style={styles.footerSpinner} color="#2D6A4F" />
          ) : null
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FAFAFA',
    // RTL direction
    direction: 'rtl' as any,
  },
  header: {
    backgroundColor: '#1B4332',
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'flex-end', // RTL: title on right
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    writingDirection: 'rtl',
    textAlign: 'right',
  },
  list: {
    paddingVertical: 8,
  },
  card: {
    flexDirection: 'row-reverse', // RTL: image on the left in LTR = right in RTL
    backgroundColor: '#FFFFFF',
    marginHorizontal: 12,
    borderRadius: 10,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  thumb: {
    width: 100,
    height: 90,
  },
  thumbPlaceholder: {
    backgroundColor: '#E8F5E9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbPlaceholderText: {
    fontSize: 28,
  },
  cardBody: {
    flex: 1,
    padding: 10,
    justifyContent: 'space-between',
    alignItems: 'flex-end', // RTL
  },
  sourceName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2D6A4F',
    textAlign: 'right',
    marginBottom: 4,
  },
  headline: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1A1A2E',
    lineHeight: 20,
    textAlign: 'right',
    writingDirection: 'rtl',
    flex: 1,
  },
  time: {
    fontSize: 11,
    color: '#888',
    textAlign: 'right',
    marginTop: 4,
  },
  separator: {
    height: 8,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    color: '#C62828',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: '#2D6A4F',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#FFF',
    fontWeight: '600',
  },
  footerSpinner: {
    marginVertical: 16,
  },
});
