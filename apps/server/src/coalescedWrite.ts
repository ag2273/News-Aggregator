// Small JSON stores written off the request path.
//
// analytics.json was re-serialised and written with writeFileSync on EVERY article
// open, share, search, source view and app-start ping, and reactions.json (pretty-
// printed) on every reaction. Each write blocks the event loop for as long as the
// whole file takes to stringify and land, and the files only grow.
//
// `coalescedWriter` batches those: many changes within `delayMs` produce one async
// write of the latest state. In a test (or with DB_SYNC_SAVE=1) the write is
// synchronous, so a test that writes and then reads the file still sees it.
// `flushAllWrites` lands everything pending, for a graceful shutdown.

import fs from 'node:fs';
import path from 'node:path';

const SYNC = process.env['NODE_ENV'] === 'test' || process.env['DB_SYNC_SAVE'] === '1';

const pending = new Set<() => Promise<void>>();

export function coalescedWriter(file: string, serialize: () => string, delayMs = 1000): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let dirty = false;

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    while (running) await running;
    if (!dirty) return;
    dirty = false;
    // Serialise now, so the snapshot is the latest state when the write starts.
    const body = serialize();
    running = (async () => {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, body);
    })()
      .catch((err) => console.error(`[store] write failed for ${path.basename(file)}:`, err))
      .finally(() => {
        running = null;
        if (!dirty) pending.delete(flush);
      });
    await running;
  };

  return () => {
    if (SYNC) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, serialize());
      return;
    }
    dirty = true;
    pending.add(flush);
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        void flush();
      }, delayMs);
    }
  };
}

/** Land every pending coalesced write. */
export async function flushAllWrites(): Promise<void> {
  await Promise.all([...pending].map((f) => f()));
}
