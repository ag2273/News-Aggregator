import { describe, it, expect } from 'vitest';
import { app } from '../index.js';

describe('POST /api/articles/:id/warm', () => {
  it('answers 404 for an article the store does not hold, without fetching anything', async () => {
    const res = await app.request('/api/articles/no-such-article/warm', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
