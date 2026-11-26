// One background thread for reader extraction (see readerWorker.ts).
//
// Falls back to extracting inline when the worker cannot run: in tests and under
// tsx, where only the .ts source exists, and if the worker dies or stops answering.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { readerFromHtml } from './reader.js';
import type { ReaderArticle } from './reader.js';

type Result = ReaderArticle;

const WORKER_URL = new URL('./readerWorker.js', import.meta.url);
const TIMEOUT_MS = 15_000;

let worker: Worker | null = null;
let disabled = process.env['NODE_ENV'] === 'test' || process.env['READER_WORKER'] === '0';
let nextId = 1;
const pending = new Map<number, { resolve: (r: Result) => void; reject: (e: unknown) => void }>();

function failAll(err: unknown): void {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function getWorker(): Worker | null {
  if (disabled) return null;
  if (worker) return worker;
  try {
    if (!fs.existsSync(fileURLToPath(WORKER_URL))) {
      disabled = true;
      return null;
    }
    const w = new Worker(WORKER_URL);
    w.unref();
    w.on('message', (msg: { id: number; ok: boolean; result?: Result; error?: string }) => {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok && msg.result) p.resolve(msg.result);
      else p.reject(new Error(msg.error ?? 'reader worker failed'));
    });
    const drop = (err: unknown): void => {
      if (worker === w) worker = null;
      failAll(err);
    };
    w.on('error', drop);
    w.on('exit', (code) => drop(new Error(`reader worker exited (${code})`)));
    worker = w;
    return w;
  } catch (err) {
    console.error('[reader] worker unavailable, extracting inline:', err);
    disabled = true;
    return null;
  }
}

/** `readerFromHtml`, on the background thread when it is available. */
export async function readerFromHtmlOffThread(html: string, title: string | null): Promise<Result> {
  const w = getWorker();
  if (!w) return readerFromHtml(html, title);
  const id = nextId++;
  try {
    return await new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        // A worker that stopped answering is replaced on the next call.
        void w.terminate();
        reject(new Error('reader worker timed out'));
      }, TIMEOUT_MS);
      timer.unref();
      pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      w.postMessage({ id, html, title });
    });
  } catch (err) {
    console.error('[reader] worker failed, extracting inline:', err);
    return readerFromHtml(html, title);
  }
}

/** Start the thread now, so the first article opened does not pay for its boot. */
export function startReaderWorker(): void {
  getWorker();
}
