import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities } from '../text.js';

describe('decodeHtmlEntities', () => {
  it('decodes named entities', () => {
    expect(decodeHtmlEntities('أ&amp;ب&nbsp;&quot;ج&quot;')).toBe('أ&ب "ج"');
  });

  it('decodes decimal and hex numeric references', () => {
    expect(decodeHtmlEntities('&#8230; &#x1F525;')).toBe('… 🔥');
  });

  it('collapses the double spaces left behind by &nbsp;', () => {
    expect(decodeHtmlEntities('صفقة&nbsp;&nbsp;قطار')).toBe('صفقة قطار');
  });

  it('leaves unknown entities untouched', () => {
    expect(decodeHtmlEntities('a&notreal;b')).toBe('a&notreal;b');
  });

  it('handles null and empty input', () => {
    expect(decodeHtmlEntities(null)).toBe('');
    expect(decodeHtmlEntities(undefined)).toBe('');
    expect(decodeHtmlEntities('')).toBe('');
  });
});
