/**
 * Verification checks for the HeroDeck preload window and image pre-warming.
 * Run: node --experimental-strip-types scripts/check-preload.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getPreloadWindow,
  getPreloadNeighbors,
  getPreloadCoverUrls,
  prefetchWindowCovers,
  _resetPrefetchCache,
  getOffscreenCoverStyle,
  getDeckAdjacentCards,
  getActiveDeckCards,
  isCoverLoaded,
  markCoverLoaded,
  markCoverError,
  shouldResetCoverOpacity,
  _resetLoadedCovers,
  DEFAULT_COVER_DIMENSIONS,
  PRELOAD_RADIUS,
} from '../lib/preload.ts';

let failed = 0;

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
  );
}

// Generate test articles
const makeArticle = (i, imageUrl = `https://img.test/${i}.jpg`) => ({
  id: `art-${i}`,
  title: `Title ${i}`,
  summary: `Summary ${i}`,
  imageUrl,
  url: `https://test.com/${i}`,
  sourceId: 'youm7',
  sourceName: 'اليوم السابع',
  category: 'egypt',
  country: 'EG',
  publishedAt: 1000 + i,
  isBreaking: false,
});

const sampleArticles = Array.from({ length: 10 }, (_, i) => makeArticle(i));

console.log('— preload window boundaries —');
check('empty list returns empty window', getPreloadWindow([], 0), []);
check('negative index returns empty window', getPreloadWindow(sampleArticles, -1), []);
check('out of bounds index returns empty window', getPreloadWindow(sampleArticles, 15), []);

// Window at index 0: should be [0, 1, 2, 3] (current + 3 ahead)
const win0 = getPreloadWindow(sampleArticles, 0);
check('window at index 0 has 4 cards (current + 3 ahead)', win0.map((a) => a.id), [
  'art-0',
  'art-1',
  'art-2',
  'art-3',
]);

// Window at index 5: should be [2, 3, 4, 5, 6, 7, 8] (3 behind + current + 3 ahead)
const win5 = getPreloadWindow(sampleArticles, 5);
check('window at index 5 has 7 cards (3 behind, current, 3 ahead)', win5.map((a) => a.id), [
  'art-2',
  'art-3',
  'art-4',
  'art-5',
  'art-6',
  'art-7',
  'art-8',
]);

// Window at last index (9): should be [6, 7, 8, 9] (3 behind + current)
const win9 = getPreloadWindow(sampleArticles, 9);
check('window at last index has 4 cards (3 behind + current)', win9.map((a) => a.id), [
  'art-6',
  'art-7',
  'art-8',
  'art-9',
]);

console.log('— preload neighbors (excluding current card) —');
const neigh0 = getPreloadNeighbors(sampleArticles, 0);
check('neighbors at index 0 are exactly the 3 ahead', neigh0.map((a) => a.id), [
  'art-1',
  'art-2',
  'art-3',
]);

const neigh5 = getPreloadNeighbors(sampleArticles, 5);
check('neighbors at index 5 are the 3 behind and 3 ahead', neigh5.map((a) => a.id), [
  'art-2',
  'art-3',
  'art-4',
  'art-6',
  'art-7',
  'art-8',
]);

console.log('— cover image URL extraction & deduplication —');
const mixedArticles = [
  makeArticle(0, 'https://img.test/same.jpg'),
  makeArticle(1, null), // no image
  makeArticle(2, 'https://img.test/same.jpg'), // duplicate image
  makeArticle(3, 'https://img.test/other.jpg'),
];
const urls = getPreloadCoverUrls(mixedArticles, 0);
check('omits null images and dedupes URLs in window', urls, [
  'https://img.test/same.jpg',
  'https://img.test/other.jpg',
]);

console.log('— prefetchWindowCovers execution & caching —');
_resetPrefetchCache();
const prefetched = [];
const mockPrefetch = async (url) => {
  prefetched.push(url);
  return true;
};

// First pass at index 0: prefetches 0, 1, 2, 3
const fetched1 = await prefetchWindowCovers(sampleArticles, 0, PRELOAD_RADIUS, mockPrefetch);
check('initial prefetch fetches all covers in window (0..3)', fetched1, [
  'https://img.test/0.jpg',
  'https://img.test/1.jpg',
  'https://img.test/2.jpg',
  'https://img.test/3.jpg',
]);

// Same index again: should fetch 0 new covers (all cached)
const fetchedSame = await prefetchWindowCovers(sampleArticles, 0, PRELOAD_RADIUS, mockPrefetch);
check('repeated prefetch for same window fetches 0 new', fetchedSame, []);

// Advance to index 1: window is 0..4, so only art-4 needs to be fetched
const fetchedAdvance = await prefetchWindowCovers(sampleArticles, 1, PRELOAD_RADIUS, mockPrefetch);
check('advancing index fetches newly revealed cover', fetchedAdvance, ['https://img.test/4.jpg']);

console.log('— off-screen cover dimensions for native decode warming —');
// Unmeasured / null dimensions: must return real non-1px fallback dimensions
const fallbackStyle = getOffscreenCoverStyle(null);
check('unmeasured dimensions return real non-1px width (>1)', fallbackStyle.width > 1, true);
check('unmeasured dimensions return real non-1px height (>1)', fallbackStyle.height > 1, true);
check('fallback width matches DEFAULT_COVER_DIMENSIONS', fallbackStyle.width, DEFAULT_COVER_DIMENSIONS.width);
check('fallback height matches DEFAULT_COVER_DIMENSIONS', fallbackStyle.height, DEFAULT_COVER_DIMENSIONS.height);

// Window width fallback (e.g. iPhone width 390 -> 390 - 64 = 326)
const windowFallbackStyle = getOffscreenCoverStyle(null, 390);
check('window width fallback calculates real width (390 - 64 = 326)', windowFallbackStyle.width, 326);
check('window width fallback has real height (>1)', windowFallbackStyle.height > 1, true);

// Measured dimensions from onLayout
const measuredStyle = getOffscreenCoverStyle({ width: 358, height: 215 });
check('measured dimensions apply exact real width', measuredStyle.width, 358);
check('measured dimensions apply exact real height', measuredStyle.height, 215);

// Degenerate 1x1 dimensions must be rejected in favor of real dimensions
const degenerateStyle = getOffscreenCoverStyle({ width: 1, height: 1 });
check('degenerate 1x1 width is rejected for real dimension (>1)', degenerateStyle.width > 1, true);
check('degenerate 1x1 height is rejected for real dimension (>1)', degenerateStyle.height > 1, true);

console.log('— deck adjacent cards: full content for index+1 & index-1 (no blank strips) —');
// Test adjacent cards partitioning at index 0
const adj0 = getDeckAdjacentCards(sampleArticles, 0);
check('adj0 prevArticle is null at start of feed', adj0.prevArticle, null);
check('adj0 nextArticle has id art-1', adj0.nextArticle?.id, 'art-1');
check('adj0 nextArticle has full non-empty title', Boolean(adj0.nextArticle?.title), true);
check('adj0 nextArticle has full cover imageUrl', Boolean(adj0.nextArticle?.imageUrl), true);
check('adj0 nextArticle has publisher sourceName', Boolean(adj0.nextArticle?.sourceName), true);
check('adj0 farStrips contains index+2 and index+3', adj0.farStrips.map((a) => a.id), ['art-2', 'art-3']);
check('adj0 farStrips does NOT include nextArticle art-1', adj0.farStrips.some((a) => a.id === 'art-1'), false);

// Test adjacent cards partitioning at index 5
const adj5 = getDeckAdjacentCards(sampleArticles, 5);
check('adj5 prevArticle has id art-4', adj5.prevArticle?.id, 'art-4');
check('adj5 prevArticle has full non-empty title', Boolean(adj5.prevArticle?.title), true);
check('adj5 prevArticle has full cover imageUrl', Boolean(adj5.prevArticle?.imageUrl), true);
check('adj5 nextArticle has id art-6', adj5.nextArticle?.id, 'art-6');
check('adj5 nextArticle has full non-empty title', Boolean(adj5.nextArticle?.title), true);
check('adj5 nextArticle has full cover imageUrl', Boolean(adj5.nextArticle?.imageUrl), true);
check('adj5 farStrips contains far hint cards only (art-7, art-8)', adj5.farStrips.map((a) => a.id), ['art-7', 'art-8']);

// Test adjacent cards partitioning at last index (9)
const adj9 = getDeckAdjacentCards(sampleArticles, 9);
check('adj9 nextArticle is null at end of feed', adj9.nextArticle, null);
check('adj9 prevArticle has id art-8', adj9.prevArticle?.id, 'art-8');
check('adj9 farStrips is empty at end of feed', adj9.farStrips, []);

console.log('— active deck cards & key stability across role changes —');
// At index 0: [next: art-1, front: art-0]
const active0 = getActiveDeckCards(sampleArticles, 0);
check('active0 returns exactly 2 cards [next, front]', active0.length, 2);
check('active0 roles are [next, front]', active0.map((c) => c.role), ['next', 'front']);
check('active0 keys are strictly article.id', active0.map((c) => c.key), ['art-1', 'art-0']);

// At index 1: [prev: art-0, next: art-2, front: art-1]
const active1 = getActiveDeckCards(sampleArticles, 1);
check('active1 returns 3 cards [prev, next, front]', active1.length, 3);
check('active1 roles are [prev, next, front]', active1.map((c) => c.role), ['prev', 'next', 'front']);
check('active1 keys are strictly article.id', active1.map((c) => c.key), ['art-0', 'art-2', 'art-1']);

// Key stability across advance 0 -> 1:
// art-1 was in active0 (role: next) with key 'art-1'.
// art-1 is in active1 (role: front) with key 'art-1'.
const nextCardAt0 = active0.find((c) => c.article.id === 'art-1');
const frontCardAt1 = active1.find((c) => c.article.id === 'art-1');
check('art-1 key at index 0 (as next) is strictly art-1', nextCardAt0?.key, 'art-1');
check('art-1 key at index 1 (as front) is strictly art-1', frontCardAt1?.key, 'art-1');
check('art-1 key matches identically across next -> front advance (stable fiber reuse)', nextCardAt0?.key === frontCardAt1?.key, true);

// Key stability across reverse 1 -> 0:
// art-0 was in active1 (role: prev) with key 'art-0'.
// art-0 is in active0 (role: front) with key 'art-0'.
const prevCardAt1 = active1.find((c) => c.article.id === 'art-0');
const frontCardAt0 = active0.find((c) => c.article.id === 'art-0');
check('art-0 key matches identically across prev -> front reverse', prevCardAt1?.key === frontCardAt0?.key, true);

// Boundary checks:
const activeEnd = getActiveDeckCards(sampleArticles, 9);
check('activeEnd has 2 cards [prev, front]', activeEnd.map((c) => c.role), ['prev', 'front']);
check('activeEnd keys are strictly article.id', activeEnd.map((c) => c.key), ['art-8', 'art-9']);
check('empty articles returns empty active cards', getActiveDeckCards([], 0), []);

console.log('— HeroDeck component structural verification —');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const heroDeckSource = fs.readFileSync(path.resolve(__dirname, '../components/HeroDeck.tsx'), 'utf-8');

check('HeroDeck imports getActiveDeckCards', heroDeckSource.includes('getActiveDeckCards'), true);
check('HeroDeck renders DeckCard component', heroDeckSource.includes('<DeckCard'), true);
check('HeroDeck maps activeCards keyed strictly by article.id', heroDeckSource.includes('key={card.article.id}'), true);
check('HeroDeck rejects role-prefixed keys (next-, prev-)', !heroDeckSource.includes('key={`next-') && !heroDeckSource.includes('key={`prev-'), true);
check('DeckCard renders publisher avatar and meta', heroDeckSource.includes('PublisherAvatar') && heroDeckSource.includes('PublisherMeta'), true);
check('DeckCard renders title', heroDeckSource.includes('article.title'), true);
check('DeckCard renders cover image', heroDeckSource.includes('article.imageUrl'), true);
check('DeckCard seeds loaded state from isCoverLoaded', heroDeckSource.includes('isCoverLoaded(article.imageUrl)'), true);
check('DeckCard root uses cardBox styling with absolute positioning', heroDeckSource.includes('cardBox:') && heroDeckSource.includes("position: 'absolute'"), true);
check('styles.layer is restricted to farStrips (not adjacent cards)', heroDeckSource.includes('farStrips') && heroDeckSource.includes('styles.layer'), true);
check('Shared imageOpacity shared value is deleted', !heroDeckSource.includes('imageOpacity =') && !heroDeckSource.includes('imageOpacity.value'), true);
check('Shared imageFadeStyle is deleted', !heroDeckSource.includes('imageFadeStyle'), true);
check('Component-level lastLoadedUrlRef is deleted', !heroDeckSource.includes('lastLoadedUrlRef'), true);
check('StaticDeckCard is exported for backwards compatibility', heroDeckSource.includes('export const StaticDeckCard = DeckCard'), true);

console.log('— gesture stability & animation safety (no back-swipe freeze) —');
check('HeroDeck synchronizes indexSV and totalSV shared values', heroDeckSource.includes('indexSV = useSharedValue') && heroDeckSource.includes('totalSV = useSharedValue'), true);
check('HeroDeck guards gestures with isAnimating shared value', heroDeckSource.includes('isAnimating = useSharedValue'), true);
const panHasIndexDep = /useMemo\s*\(\s*\(\)\s*=>\s*Gesture\.Pan\(\)[\s\S]*?,\s*\[[^\]]*\bindex\b[^\]]*\]\s*\)/.test(heroDeckSource);
check('pan gesture avoids index in useMemo deps (stable gesture instance)', panHasIndexDep, false);
check('pan onEnd worklet reads indexSV.value snapshot', heroDeckSource.includes('deckStep(indexSV.value, dir, totalSV.value)'), true);
check('withTiming interruption safely cancels and resets tx to 0', heroDeckSource.includes('cancelAnimation(tx)') && heroDeckSource.includes('tx.value = 0'), true);
check('DeckCard memoizes cover Image source to prevent re-sourcing flicker', heroDeckSource.includes('imageSource = useMemo') && heroDeckSource.includes('source={imageSource}'), true);

console.log('— post-swipe opacity persistence (no reload flicker) —');
_resetLoadedCovers();
const url0 = 'https://img.test/0.jpg';
const url1 = 'https://img.test/1.jpg';
const coldUrl = 'https://img.test/cold.jpg';

// Initial cold image: should reset opacity to 0
check('cold image initially resets opacity', shouldResetCoverOpacity(url0, null), true);

// Mark url0 loaded (as front card does on onLoad)
markCoverLoaded(url0);
check('url0 is now marked loaded', isCoverLoaded(url0), true);

// While viewing url0, adjacent DeckCard pre-loads url1
markCoverLoaded(url1);
check('url1 pre-marked loaded by adjacent card', isCoverLoaded(url1), true);

// Now user finishes swipe: advance index from url0 to url1
// Opacity must NOT reset for url1 because it was already loaded!
check('advancing to pre-loaded url1 does NOT reset opacity', shouldResetCoverOpacity(url1, url0), false);

// Staying on same URL does NOT reset opacity
check('staying on same URL does NOT reset opacity', shouldResetCoverOpacity(url1, url1), false);

// Jumping to a genuinely cold URL resets opacity to 0
check('jumping to cold URL resets opacity', shouldResetCoverOpacity(coldUrl, url1), true);

// Error removes URL from loaded cache and forces reset
markCoverError(url1);
check('error removes url1 from loaded cache', isCoverLoaded(url1), false);
check('errored url1 now resets opacity', shouldResetCoverOpacity(url1, url0), true);

// HeroDeck source check: verify buggy index-keyed opacity reset effect is gone
const hasBuggyIndexReset = /useEffect\(\s*\(\)\s*=>\s*\{\s*imageOpacity\.value\s*=\s*0;\s*\}\s*,\s*\[\s*index/.test(heroDeckSource);
check('buggy index-keyed opacity reset is completely eliminated', hasBuggyIndexReset, false);

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
