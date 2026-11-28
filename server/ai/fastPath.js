/**
 * ZAZA (ظاظا) Wake-Word Normalization & Zero-Token Local Fast Path
 * Handles all Egyptian Arabic & English phonetic variations of ZAZA
 * and executes instant local commands (< 10ms, 0 LLM tokens).
 */

export const WAKE_WORD_DETECT_REGEX =
  /(?:^|\s)(?:(?:إيه|ايه|ألو|الو|يا|ازيك|إزيك|هاي|هالو|hey|hi|ok|okay|yo)\s+)*(?:ظاظا|ظاظه|ظاظة|زازا|زازه|زازة|زوزو|زوزه|زوزة|ذاذا|سازه|زاقا|زاكا|زكا|زكى|زكي|زادكا|zaza|zozo|zaka|zaqa)(?=$|\s|[،,!\.\?])/i;

export const WAKE_WORD_STRIP_REGEX =
  /^(?:(?:إيه|ايه|ألو|الو|يا|ازيك|إزيك|هاي|هالو|hey|hi|ok|okay|yo)\s+)*(?:ظاظا|ظاظه|ظاظة|زازا|زازه|زازة|زوزو|زوزه|زوزة|ذاذا|سازه|زاقا|زاكا|زكا|زكى|زكي|زادكا|zaza|zozo|zaka|zaqa)[،,!\.\?\s]*/i;

/**
 * Spatial & Visual Screen Intent Detector:
 * Returns true if the user refers to visual/spatial elements currently visible on screen
 * (e.g. "من ناحية اليمين", "على الشمال", "أول فيديو قدامك", "التاني", "اضغط على", "دوس على",
 *  "إنت شايف إيه", "بص على الشاشة", "اقرأ الشاشة").
 * Must be routed to Vision + Screen interaction — NEVER to YouTube search!
 */
export function isSpatialOrVisualScreenIntent(rawText) {
  if (!rawText || typeof rawText !== "string") return false;
  const normalized = rawText
    .replace(/[\u064B-\u065F\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[ة]/g, "ه")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return false;

  const spatialVisualRegex =
    /(?:من\s+ناحي[هة]\s+(?:اليمين|الشمال|اليسار)|(?:على|عال)\s*(?:اليمين|الشمال|اليسار)|ناحي[هة]\s+(?:اليمين|الشمال|اليسار)|(?:اول|تاني|ثاني|تالت|ثالث)\s+(?:فيديو|واحد|نتيج[هة]|اختيار|زر|زرار)\s*(?:قدامك|على\s+الشاش[هة]|من\s+ناحي[هة]|على\s+(?:اليمين|الشمال|اليسار)|فوق|تحت)?|(?:ال)?(?:تاني|ثاني|تالت|ثالث)\s+(?:من\s+)?(?:اليمين|الشمال|اليسار|فوق|تحت|قدامك)|(?:اضغط|دوس|كليك|انقر)\s+على|(?:انت\s+)?شايف\s+ايه|بص\s+على\s+الشاش[هة]|اقر[اأ]\s+الشاش[هة]|ايه\s+(?:اللي\s+)?(?:على\s+الشاش[هة]|قدامك|قدامي|مفتوح\s+قدامي)|what\s+(?:do\s+you\s+see|is\s+on\s+(?:the\s+)?screen)|click\s+on\s+(?:the\s+)?(?:first|second|right|left))/i;

  return spatialVisualRegex.test(normalized);
}

/**
 * Detects whether the transcript contains any ZAZA wake-word variant.
 */
export function hasWakeWord(text) {
  if (!text || typeof text !== "string") return false;
  return WAKE_WORD_DETECT_REGEX.test(text.trim());
}

/**
 * Strips leading greeting + ZAZA wake-word prefix from a transcript.
 * Returns empty string if the user only called the wake word with no trailing command.
 */
export function stripWakeWord(text) {
  if (!text || typeof text !== "string") return "";
  const trimmed = text.trim();
  if (!trimmed) return "";

  if (WAKE_WORD_STRIP_REGEX.test(trimmed)) {
    return trimmed.replace(WAKE_WORD_STRIP_REGEX, "").trim();
  }

  const match = trimmed.match(WAKE_WORD_DETECT_REGEX);
  if (match && typeof match.index === "number") {
    const fromWake = trimmed.slice(match.index).trim();
    return fromWake.replace(WAKE_WORD_STRIP_REGEX, "").trim();
  }

  return trimmed;
}

/**
 * Zero-Token Local Fast Path Matcher:
 * Matches direct single-intent media, volume & scroll commands in Egyptian Arabic / English
 * without consuming any Gemini or Groq API quota (< 10ms, 0 tokens).
 */
export function matchZeroTokenFastPath(rawPrompt) {
  if (!rawPrompt || typeof rawPrompt !== "string") return null;

  // Strip optional ZAZA wake word first before diacritic/alef normalization
  let cleaned = stripWakeWord(rawPrompt)
    .replace(/[\u064B-\u065F\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[ة]/g, "ه")
    .replace(/[؟?!.,،]+/g, " ")
    .replace(/\b(?:لو\s*سمحت|بعد\s*اذنك|من\s*فضلك|يا\s*باشا|يا\s*برنس|يا\s*كبير|يا\s*صاحبي|دلوقتي|حالا)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;

  // Do NOT hijack compound multi-step commands (e.g. "شغل ملخص ماتش وعلي الصوت")
  if (/\s+و(?:شغل|افتح|اقفل|اعمل|جيب|هات|بص)\b/i.test(cleaned)) {
    return null;
  }

  // 1. Volume Up: علي شوية / علي الصوت / زود الصوت / ارفع الصوت (7 consecutive pulses = ~14%)
  if (
    /^(?:علي|عالي|زود|ارفع)(?:\s+(?:لي|لنا))?(?:\s+الصوت)?(?:\s+(?:شويه|كمان|اكتر|سنه|قوي|حبه|بسيطه))*$/i.test(
      cleaned,
    ) &&
    (/(?:الصوت|شويه|كمان|اكتر|سنه|قوي|حبه|بسيطه)/i.test(cleaned) ||
      /^(?:علي|ارفع|زود)$/i.test(cleaned))
  ) {
    const isStrong = /كمان|اكتر|قوي/.test(cleaned);
    return {
      type: "media",
      action: "volume_up",
      repeat: isStrong ? 10 : 7,
      tokensUsed: 0,
      reply: "🔊 علّيتلك الصوت فوراً يا باشا (+14% مسار محلي مجاني).",
    };
  }

  // 2. Volume Down: وطي شوية / وطي الصوت / قلل الصوت / نزل الصوت / اخفض الصوت / هدي الصوت
  if (
    /^(?:وطي|واطي|قلل|نزل|اخفض|هدي)(?:\s+(?:لي|لنا))?(?:\s+الصوت)?(?:\s+(?:شويه|كمان|سنه|خالص|حبه|بسيطه))*$/i.test(
      cleaned,
    ) &&
    (/(?:الصوت|شويه|كمان|سنه|خالص|حبه|بسيطه)/i.test(cleaned) ||
      /^(?:وطي|قلل|اخفض|هدي)$/i.test(cleaned))
  ) {
    const isStrong = /كمان|خالص/.test(cleaned);
    return {
      type: "media",
      action: "volume_down",
      repeat: isStrong ? 10 : 7,
      tokensUsed: 0,
      reply: "🔉 وطّيتلك الصوت فوراً يا باشا (-14% مسار محلي مجاني).",
    };
  }

  // 3. Mute / Unmute: اعمل ميوت / اكتم الصوت / ميوت
  if (/^(?:(?:اعمل\s+)?ميوت|اكتم(?:\s+الصوت)?|كتم\s+الصوت|mute)$/i.test(cleaned)) {
    return {
      type: "media",
      action: "mute",
      repeat: 1,
      tokensUsed: 0,
      reply: "🔇 تم كتم/إلغاء كتم الصوت فوراً (مسار محلي مجاني).",
    };
  }

  // 4. Play / Pause: وقف الفيديو / شغل الفيديو / بوز / كمل الفيديو
  if (
    /^(?:وقف(?:\s+(?:الفيديو|الميديا|التشغيل|الصوت))?|شغل\s+الفيديو|كمل(?:\s+(?:الفيديو|التشغيل))?|استمر|بوز|ستوب|pause|resume)$/i.test(
      cleaned,
    )
  ) {
    return {
      type: "media",
      action: "play_pause",
      repeat: 1,
      tokensUsed: 0,
      reply: "⏯️ تم إيقاف/تشغيل الفيديو فوراً (مسار محلي مجاني).",
    };
  }

  // 5. Scroll Down: انزل تحت / انزل تحت شوية / سكرول لتحت / نزل الصفحة / scroll down
  if (
    /^(?:انزل(?:\s+(?:تحت|لتحت))?|سكرول\s+(?:تحت|لتحت)|نزل\s+الصفحه|scroll\s+down)(?:\s+(?:شويه|كمان|اكتر|سنه))*$/i.test(
      cleaned,
    )
  ) {
    return {
      type: "scroll",
      action: "scroll_down",
      direction: "down",
      amount: 5,
      tokensUsed: 0,
      reply: "⬇️ تم التمرير لأسفل فوراً (مسار محلي مجاني).",
    };
  }

  // 6. Scroll Up: اطلع فوق / اطلع فوق شوية / سكرول لفوق / طلع الصفحة / scroll up
  if (
    /^(?:اطلع(?:\s+(?:فوق|لفوق))?|سكرول\s+(?:فوق|لفوق)|طلع\s+الصفحه|scroll\s+up)(?:\s+(?:شويه|كمان|اكتر|سنه))*$/i.test(
      cleaned,
    )
  ) {
    return {
      type: "scroll",
      action: "scroll_up",
      direction: "up",
      amount: 5,
      tokensUsed: 0,
      reply: "⬆️ تم التمرير لأعلى فوراً (مسار محلي مجاني).",
    };
  }

  return null;
}
