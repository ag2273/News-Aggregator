import { describe, it, expect } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { extractImage } from '../fetcher.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  cdataPropName: '__cdata',
  parseTagValue: false,
  trimValues: true,
});
const item = (inner: string): Record<string, unknown> =>
  parser.parse(`<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item>${inner}</item></channel></rss>`).rss.channel.item;

describe('extractImage (feed item picture)', () => {
  it('reads the first of several media:content elements', () => {
    expect(extractImage(item('<media:content url="https://i.test/a.jpg"/><media:content url="https://i.test/b.jpg"/>'))).toBe(
      'https://i.test/a.jpg',
    );
  });
  it('reads media:group, and skips a video', () => {
    expect(
      extractImage(item('<media:group><media:content url="https://v.test/x.mp4" type="video/mp4"/><media:thumbnail url="https://i.test/t.jpg"/></media:group>')),
    ).toBe('https://i.test/t.jpg');
  });
  it('takes an <img> without a file extension from the description', () => {
    expect(extractImage(item('<description><![CDATA[<p><img src="https://cdn.test/photo/123?w=600&amp;h=400"></p>]]></description>'))).toBe(
      'https://cdn.test/photo/123?w=600&h=400',
    );
  });
  it('ignores a logo in the description', () => {
    expect(extractImage(item('<description><![CDATA[<img src="https://x.test/site-logo.png">]]></description>'))).toBeNull();
  });
});
