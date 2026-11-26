// Runs the reader extraction (linkedom + Readability) off the main thread.
//
// Measured on real publisher pages under the e2-micro's sustained CPU: 0.2-0.3s of
// synchronous parsing per article opened. On the main thread that froze every other
// request for as long; here the main thread keeps answering while this one parses.

import { parentPort } from 'node:worker_threads';
import { readerFromHtml } from './reader.js';

parentPort?.on('message', (msg: { id: number; html: string; title: string | null }) => {
  try {
    parentPort!.postMessage({ id: msg.id, ok: true, result: readerFromHtml(msg.html, msg.title) });
  } catch (err) {
    parentPort!.postMessage({ id: msg.id, ok: false, error: String(err) });
  }
});
