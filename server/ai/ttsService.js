import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

const VOICE_NAME = "ar-EG-ShakirNeural";
const MAX_CACHE_SIZE = 50;
const ttsCache = new Map();

/**
 * Cleans text from URLs, emojis, and Markdown formatting before TTS synthesis.
 */
export function cleanTextForTts(rawText) {
  if (!rawText || typeof rawText !== "string") return "";
  return rawText
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~#>|[\]()]/g, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Synthesizes Egyptian Arabic male speech (ar-EG-ShakirNeural) as an MP3 Buffer.
 * Uses an in-memory LRU-like cache for the last 50 sentences.
 */
export async function synthesizeEgyptianSpeech(rawText) {
  const cleaned = cleanTextForTts(rawText);
  if (!cleaned) {
    throw new Error("Empty text after cleaning");
  }

  if (ttsCache.has(cleaned)) {
    const cached = ttsCache.get(cleaned);
    // Refresh insertion order
    ttsCache.delete(cleaned);
    ttsCache.set(cleaned, cached);
    return cached;
  }

  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE_NAME, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const { audioStream } = tts.toStream(cleaned);
  const chunks = [];
  for await (const chunk of audioStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);

  if (ttsCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = ttsCache.keys().next().value;
    ttsCache.delete(oldestKey);
  }
  ttsCache.set(cleaned, buffer);

  return buffer;
}
