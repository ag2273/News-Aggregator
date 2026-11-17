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

console.log('— HeroDeck simple deck structural verification —');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const heroDeckSource = fs.readFileSync(path.resolve(__dirname, '../components/HeroDeck.tsx'), 'utf-8');

check('full-card neighbor component is gone', heroDeckSource.includes('DeckCard'), false);
check('HeroDeck renders publisher avatar and meta', heroDeckSource.includes('PublisherAvatar') && heroDeckSource.includes('PublisherMeta'), true);
check('HeroDeck renders the card title', heroDeckSource.includes('article.title'), true);
check('HeroDeck renders the cover Image', heroDeckSource.includes('<Image') && heroDeckSource.includes('source={coverSource}'), true);
check('cover Image has no opacity toggle', heroDeckSource.includes('opacity: loaded'), false);
check('cover container keeps a solid background color', heroDeckSource.includes('backgroundColor: t.pillInactiveBg'), true);
check('neighbours are real, keyed, inert cards sharing the front body', [
  heroDeckSource.includes('styles.layer'),
  heroDeckSource.includes("isFront ? 'auto' : 'none'"),
  heroDeckSource.includes('key={a.id}'),
  (heroDeckSource.match(/<HeroCard\b/g) || []).length >= 1,
].every(Boolean), true);
check('strip offsets use (DEPTH - 1 - slot) * PEEK', heroDeckSource.includes('(DEPTH - 1 - slot) * PEEK'), true);
check('strip widths use 94 - slot * 6 percent', heroDeckSource.includes('${94 - slot * 6}%'), true);
check('no off-screen pre-render block', heroDeckSource.includes('offscreenPreload') || heroDeckSource.includes('preloadNeighbors'), false);
check('no coverDimensions state or onCoverLayout plumbing', heroDeckSource.includes('coverDimensions') || heroDeckSource.includes('onCoverLayout'), false);
check('prefetch window still runs through Image.prefetch', heroDeckSource.includes('prefetchWindowCovers(articles, index, PRELOAD_RADIUS, Image.prefetch)'), true);
check('hint text has no explicit direction words', heroDeckSource.includes('اسحب للتالي') && !heroDeckSource.includes('اسحب شمال'), true);

console.log('— gesture stability & animation safety (no back-swipe freeze) —');
check('HeroDeck synchronizes indexSV and totalSV shared values', heroDeckSource.includes('indexSV = useSharedValue') && heroDeckSource.includes('totalSV = useSharedValue'), true);
check('HeroDeck guards gestures with isAnimating shared value', heroDeckSource.includes('isAnimating = useSharedValue'), true);
const panHasIndexDep = /useMemo\s*\(\s*\(\)\s*=>\s*Gesture\.Pan\(\)[\s\S]*?,\s*\[[^\]]*\bindex\b[^\]]*\]\s*\)/.test(heroDeckSource);
check('pan gesture avoids index in useMemo deps (stable gesture instance)', panHasIndexDep, false);
check('pan onEnd worklet reads indexSV.value snapshot', heroDeckSource.includes('deckStep(indexSV.value, dir, totalSV.value)'), true);
check('withTiming interruption safely cancels and resets tx to 0', heroDeckSource.includes('cancelAnimation(tx)') && heroDeckSource.includes('tx.value = 0'), true);
check('front cover source is memoized so a re-render does not re-source it', heroDeckSource.includes('coverSource = useMemo') && heroDeckSource.includes('source={coverSource}'), true);

console.log('— single deck-root GestureDetector (no handlerTag mutation / freeze) —');
const gestureDetectorMatches = heroDeckSource.match(/<GestureDetector\b/g) || [];
check('HeroDeck has exactly ONE GestureDetector at container root', gestureDetectorMatches.length, 1);
check('publisher row source tap is wired only on the front card', heroDeckSource.includes('<Pressable') && heroDeckSource.includes('onPressSource={isFront ? handleSourcePress : undefined}'), true);
check('HeroDeck wraps root in GestureDetector with composed gesture', heroDeckSource.includes('<GestureDetector gesture={composed}>'), true);
check('HeroDeck includes isAnimating safety timeout', heroDeckSource.includes('animTimeoutRef') && heroDeckSource.includes('clearAnimTimeout') && heroDeckSource.includes('startAnimTimeout'), true);

console.log('— no opacity-toggling image patterns anywhere in the deck —');
check('no "opacity: loaded" toggle in HeroDeck', heroDeckSource.includes('opacity: loaded'), false);
check('no loaded-cover cache helpers remain in HeroDeck', !heroDeckSource.includes('markCoverLoaded') && !heroDeckSource.includes('markCoverError') && !heroDeckSource.includes('isCoverLoaded'), true);
check('no index-keyed opacity reset effect', /useEffect\(\s*\(\)\s*=>\s*\{\s*imageOpacity\.value\s*=\s*0;\s*\}\s*,\s*\[\s*index/.test(heroDeckSource), false);
check('buggy shared imageOpacity value is gone', !heroDeckSource.includes('imageOpacity =') && !heroDeckSource.includes('imageOpacity.value'), true);

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
