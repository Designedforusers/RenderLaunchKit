import {
  ParsedVoiceoverScriptSchema,
  type ParsedVoiceoverScript,
  type VoiceoverSegment,
} from './schemas/voiceover.js';

/**
 * Voiceover script parser.
 *
 * The type definitions live in `./schemas/voiceover.ts` (Zod schemas
 * with inferred types) so consumers can validate runtime input via
 * `ParsedVoiceoverScriptSchema.safeParse(value)`. This file exposes
 * the parser itself plus a thin re-export of the types so existing
 * import sites do not break.
 *
 * Format
 * ------
 *
 * The voiceover script the writer agent emits is a sequence of blocks
 * separated by blank lines. Each block looks like:
 *
 *     [SCREEN: cue text]
 *     "spoken line"
 *
 * The parser walks every block, extracts the screen cue and the
 * spoken text, computes the cumulative character offsets so the
 * narration helper can map ElevenLabs alignment timestamps back to
 * segments, and rejects any block that does not match the strict
 * shape. Strictness here is intentional — a partially-parsed script
 * would silently produce captions that do not align with the audio.
 */

const VOICEOVER_BLOCK = /^\[SCREEN:\s*([^\]]+?)\s*\]\s*\n"([^"\n]+)"\s*$/;

export { ParsedVoiceoverScriptSchema };
export type { ParsedVoiceoverScript, VoiceoverSegment };

export function parseVoiceoverScript(content: string): ParsedVoiceoverScript {
  const normalized = content.replace(/\r\n/g, '\n').trim();

  if (!normalized) {
    throw new Error('Voiceover script is empty');
  }

  const blocks = normalized.split(/\n\s*\n+/);
  const segments: VoiceoverSegment[] = [];
  let plainText = '';

  for (const block of blocks) {
    const match = VOICEOVER_BLOCK.exec(block.trim());

    if (!match || !match[1] || !match[2]) {
      throw new Error(
        'Voiceover script must use repeated [SCREEN: ...] lines followed by one quoted spoken line'
      );
    }

    const screenCue = match[1].trim();
    const text = match[2].trim();

    if (!screenCue || !text) {
      throw new Error('Voiceover script contains an empty screen cue or spoken line');
    }

    if (plainText.length > 0) {
      plainText += ' ';
    }

    const charStart = plainText.length;
    plainText += text;

    segments.push({
      screenCue,
      text,
      charStart,
      charEnd: plainText.length,
    });
  }

  return {
    segments,
    plainText,
    segmentCount: segments.length,
  };
}

/**
 * Type guard for `ParsedVoiceoverScript`.
 *
 * Backed by the Zod schema rather than a hand-rolled `value && typeof
 * candidate.x === 'string'` check. Returns `true` if the value parses
 * as a valid `ParsedVoiceoverScript`, `false` otherwise. Used by
 * `apps/web/src/routes/asset-api-routes.ts` to validate the cached
 * parser output stored in `assets.metadata.parsedVoiceover`.
 */
export function isParsedVoiceoverScript(
  value: unknown
): value is ParsedVoiceoverScript {
  return ParsedVoiceoverScriptSchema.safeParse(value).success;
}
