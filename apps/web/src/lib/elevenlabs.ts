import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ElevenLabsCharacterAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

type ElevenLabsResponse = {
  audio_base64?: string;
  alignment?: ElevenLabsCharacterAlignment;
  normalized_alignment?: ElevenLabsCharacterAlignment;
};

const ELEVENLABS_CACHE_DIR = path.resolve(process.cwd(), '.cache/elevenlabs');
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

export function getElevenLabsConfig(): {
  apiKey: string;
  voiceId: string;
  modelId: string | null;
} | null {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    return null;
  }

  return {
    apiKey,
    voiceId,
    modelId: process.env.ELEVENLABS_MODEL_ID || null,
  };
}

function getAudioPath(cacheKey: string): string {
  return path.join(ELEVENLABS_CACHE_DIR, `${cacheKey}.mp3`);
}

function getAlignmentPath(cacheKey: string): string {
  return path.join(ELEVENLABS_CACHE_DIR, `${cacheKey}.json`);
}

export function buildElevenLabsCacheKey(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

export async function synthesizeSpeechWithTimestamps(input: {
  cacheKey: string;
  text: string;
}): Promise<{
  audioBuffer: Buffer;
  alignment: ElevenLabsCharacterAlignment;
  cached: boolean;
}> {
  const config = getElevenLabsConfig();

  if (!config) {
    throw new Error(
      'Narrated video requires ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID'
    );
  }

  const audioPath = getAudioPath(input.cacheKey);
  const alignmentPath = getAlignmentPath(input.cacheKey);

  if (existsSync(audioPath) && existsSync(alignmentPath)) {
    const [audioBuffer, alignmentJson] = await Promise.all([
      readFile(audioPath),
      readFile(alignmentPath, 'utf8'),
    ]);

    return {
      audioBuffer,
      alignment: JSON.parse(alignmentJson) as ElevenLabsCharacterAlignment,
      cached: true,
    };
  }

  await mkdir(ELEVENLABS_CACHE_DIR, { recursive: true });

  const response = await fetch(
    `${ELEVENLABS_API_BASE}/text-to-speech/${config.voiceId}/with-timestamps`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': config.apiKey,
      },
      body: JSON.stringify({
        text: input.text,
        ...(config.modelId ? { model_id: config.modelId } : {}),
        output_format: 'mp3_44100_128',
      }),
    }
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `ElevenLabs synthesis failed (${response.status}): ${message.slice(0, 200)}`
    );
  }

  const payload = (await response.json()) as ElevenLabsResponse;
  const audioBase64 = payload.audio_base64;
  const alignment = payload.alignment;

  if (!audioBase64 || !alignment) {
    throw new Error('ElevenLabs did not return audio and timestamp alignment');
  }

  const audioBuffer = Buffer.from(audioBase64, 'base64');

  await Promise.all([
    writeFile(audioPath, audioBuffer),
    writeFile(alignmentPath, JSON.stringify(alignment)),
  ]);

  return {
    audioBuffer,
    alignment,
    cached: false,
  };
}
