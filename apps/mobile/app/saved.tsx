import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { palette } from '../constants/colors';
import { VerificationGate } from '../components/VerificationGate';
import type { Theme } from '../constants/colors';
import { fetchSavedArticles, isEmailNotVerified, isNetworkFailure, type Article } from '../lib/api';
import { useAuth } from '../lib/auth';
import { FeedCard } from '../components/FeedCard';
import { FloatingDock } from '../components/FloatingDock';
import { useArticleSheet } from '../components/ArticleSheet';

export default function SavedScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { user, token, loading: authLoading, emailVerified } = useAuth();
  const { open: openSheet } = useArticleSheet();

  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSaved = useCallback(async () => {
    if (!token) return;
    // Never call a gated endpoint for an unverified account: the 403 would be
    // rendered as a connection error the user cannot act on.
    if (!emailVerified) {
      setArticles([]);
      setError(null);
      return;
    }
    try {
      setError(null);
      const saved = await fetchSavedArticles(token, 50, 0);
      setArticles(saved);
    } catch (err) {
      if (isEmailNotVerified(err)) {
        // Gate, not network: the screen shows the locked state instead.
        setArticles([]);
        setError(null);
        return;
      }
      setError(
        isNetworkFailure(err)
          ? 'تعذّر الاتصال بالخادم. تحقّق من الإنترنت.'
          : 'تعذّر تحميل المقالات المحفوظة. حاول مرة أخرى.',
      );
    }
  }, [token, emailVerified]);

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setLoading(false);
      return;
    }
    if (!emailVerified) {
      setLoading(false);
      return;
    }
    setLoading(true);
    loadSaved().finally(() => setLoading(false));
  }, [authLoading, token, emailVerified, loadSaved]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadSaved();
    setRefreshing(false);
  };

  // --- Logged-out state ---
  if (!authLoading && !user) {
    return (
      <LinearGradient
        colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]}
        style={styles.root}
      >
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={[styles.circleBtn, { backgroundColor: t.surface }]}
              accessibilityRole="button"
              accessibilityLabel="رجوع"
            >
              <Ionicons name="arrow-forward" size={18} color={t.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: t.textPrimary }]}>المحفوظات</Text>
            <View style={styles.circleSpacer} />
          </View>

          <View style={styles.loggedOutCenter}>
            <View style={[styles.card, { backgroundColor: t.surface }]}>
              <View style={[styles.avatarIconWrap, { backgroundColor: t.pillInactiveBg }]}>
                <Ionicons name="bookmark-outline" size={40} color={t.accent} />
              </View>

              <Text style={[styles.cardTitle, { color: t.textPrimary }]}>
                سجّل الدخول لعرض مقالاتك المحفوظة
              </Text>
              <Text style={[styles.cardSub, { color: t.textMuted }]}>
                احفظ المقالات المهمة للرجوع إليها وقراءتها في أي وقت
              </Text>

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: t.accent }]}
                onPress={() => router.push('/login')}
                accessibilityRole="button"
              >
                <Text style={styles.primaryBtnText}>تسجيل الدخول</Text>
              </TouchableOpacity>
            </View>
          </View>

          <FloatingDock t={t} active="saved" />
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]}
      style={styles.root}
    >
      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.circleBtn, { backgroundColor: t.surface }]}
            accessibilityRole="button"
            accessibilityLabel="رجوع"
          >
            <Ionicons name="arrow-forward" size={18} color={t.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={[styles.headerTitle, { color: t.textPrimary }]}>المحفوظات</Text>
            <Text style={[styles.headerSub, { color: t.accent }]}>
              {articles.length > 0 ? `${articles.length} مقال` : 'علامات مرجعية'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/account')}
            style={[styles.circleBtn, { backgroundColor: t.surface }]}
            accessibilityRole="button"
            accessibilityLabel="حسابي"
          >
            <Ionicons name="person-outline" size={18} color={t.textPrimary} />
          </TouchableOpacity>
        </View>

        {!emailVerified ? (
          // Only one surface: the locked state carries both actions, so no banner.
          <VerificationGate
            t={t}
            icon="bookmark-outline"
            title="وثّق بريدك أولاً"
            subtitle="المحفوظات متاحة بعد توثيق بريدك. افتح الرابط اللي وصلك على الإيميل."
          />
        ) : loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={t.accent} />
          </View>
        ) : (
          <FlatList
            data={articles}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <FeedCard article={item} t={t} onPress={() => openSheet(item)} />
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={t.accent}
                colors={[t.accent]}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <View style={[styles.emptyIconWrap, { backgroundColor: t.surface }]}>
                  <Ionicons name="bookmark-outline" size={36} color={t.textMuted} />
                </View>
                <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>
                  لا توجد مقالات محفوظة بعد
                </Text>
                <Text style={[styles.emptySub, { color: t.textMuted }]}>
                  اضغط على أيقونة الحفظ في أي مقال لإضافته إلى قائمة محفوظاتك هنا
                </Text>
                <TouchableOpacity
                  style={[styles.browseBtn, { backgroundColor: t.surface, borderColor: t.borderLight }]}
                  onPress={() => router.replace('/')}
                  accessibilityRole="button"
                >
                  <Text style={[styles.browseBtnText, { color: t.accent }]}>تصفح الأخبار</Text>
                </TouchableOpacity>
              </View>
            }
          />
        )}

        {error && (
          <View style={[styles.errorToast, { backgroundColor: t.breaking }]}>
            <Text style={styles.errorToastText}>{error}</Text>
          </View>
        )}

        <FloatingDock t={t} active="saved" />
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitleWrap: { alignItems: 'center' },
  headerTitle: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 18,
    textAlign: 'center',
  },
  headerSub: {
    fontFamily: 'Cairo_600SemiBold',
    fontSize: 12,
  },
  circleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  circleSpacer: { width: 38 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 110,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 60,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  emptyTitle: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 17,
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySub: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  browseBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  browseBtnText: {
    fontFamily: 'Cairo_600SemiBold',
    fontSize: 14,
  },
  loggedOutCenter: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 60,
  },
  card: {
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  avatarIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 8,
  },
  cardSub: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  primaryBtn: {
    width: '100%',
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: 'Cairo_700Bold',
    color: '#FFFFFF',
    fontSize: 15,
  },
  errorToast: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  errorToastText: {
    fontFamily: 'Cairo_600SemiBold',
    color: '#FFFFFF',
    fontSize: 12,
  },
});
