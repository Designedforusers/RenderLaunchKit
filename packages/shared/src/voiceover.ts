export type VoiceoverSegment = {
  screenCue: string;
  text: string;
  charStart: number;
  charEnd: number;
};

export type ParsedVoiceoverScript = {
  segments: VoiceoverSegment[];
  plainText: string;
  segmentCount: number;
};

const VOICEOVER_BLOCK =
  /^\[SCREEN:\s*([^\]]+?)\s*\]\s*\n"([^"\n]+)"\s*$/;

export function parseVoiceoverScript(content: string): ParsedVoiceoverScript {
  const normalized = content.replace(/\r\n/g, '\n').trim();

  if (!normalized) {
    throw new Error('Voiceover script is empty');
  }

  const blocks = normalized.split(/\n\s*\n+/);
  const segments: VoiceoverSegment[] = [];
  let plainText = '';

  for (const block of blocks) {
    const match = block.trim().match(VOICEOVER_BLOCK);

    if (!match) {
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

export function isParsedVoiceoverScript(
  value: unknown
): value is ParsedVoiceoverScript {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.plainText === 'string' &&
    typeof candidate.segmentCount === 'number' &&
    Array.isArray(candidate.segments)
  );
}
