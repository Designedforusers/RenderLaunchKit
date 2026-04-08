import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

/**
 * Bridge a Node `ReadableStream<Uint8Array>` (from `node:stream/web`)
 * to the WHATWG `ReadableStream<Uint8Array>` (from `lib.dom.d.ts`)
 * that the platform `Response` constructor expects.
 *
 * The two streams are structurally identical and the runtime accepts
 * either, but TypeScript treats them as nominally distinct under
 * strict mode. This helper centralises the `as unknown as` bridge so
 * the route handlers (`/video.mp4`, `/audio.mp3`, and any future
 * file-streaming endpoint) share one cast instead of repeating it.
 *
 * Counted as one of the documented `as unknown as` casts in
 * `CLAUDE.md` § "Zod at every runtime boundary".
 */
export function fileToWebStream(filePath: string): ReadableStream<Uint8Array> {
  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as NodeReadableStream<Uint8Array>;
  return webStream as unknown as ReadableStream<Uint8Array>;
}
