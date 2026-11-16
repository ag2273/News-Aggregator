/**
 * Verification checks for the HeroDeck preload window and image pre-warming.
 * Run: node --experimental-strip-types scripts/check-preload.mjs
 */
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

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
