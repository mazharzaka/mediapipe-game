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

  // Normalize extra "الـ" on known site names
  const siteAlMap = {
    "اليوتيوب": "يوتيوب",
    "الفيسبوك": "فيسبوك",
    "الفيس بوك": "فيسبوك",
    "الجوجل": "جوجل",
    "الواتساب": "واتساب",
    "الانستجرام": "انستجرام",
    "التويتر": "تويتر",
    "اللينكد ان": "لينكد ان",
    "الجيت هاب": "جيت هاب",
    "النتفليكس": "نتفليكس",
  };
  for (const [k, v] of Object.entries(siteAlMap)) {
    if (cleaned.includes(k)) {
      cleaned = cleaned.replaceAll(k, v);
    }
  }

  // Do NOT hijack compound multi-step commands (e.g. "شغل ملخص ماتش وعلي الصوت")
  if (/\s+و(?:شغل|افتح|اقفل|اعمل|جيب|هات|بص)\b/i.test(cleaned)) {
    return null;
  }

  const lower = cleaned.toLowerCase();

  // 1. Volume Up
  if (["علي الصوت", "علي", "زود الصوت", "ارفع الصوت", "علي شويه", "علي الصوت شويه"].includes(lower)) {
    return {
      type: "media",
      action: "volume_up",
      repeat: 7,
      tokensUsed: 0,
      reply: "علّيتلك الصوت يا باشا.",
    };
  }

  // 2. Volume Down
  if (["وطي الصوت", "وطي", "قلل الصوت", "نزل الصوت", "وطي شويه", "وطي الصوت شويه"].includes(lower)) {
    return {
      type: "media",
      action: "volume_down",
      repeat: 7,
      tokensUsed: 0,
      reply: "وطّيتلك الصوت يا باشا.",
    };
  }

  // 3. Mute / Unmute
  if (["ميوت", "اعمل ميوت", "اكتم الصوت", "اكتم", "mute"].includes(lower)) {
    return {
      type: "media",
      action: "mute",
      repeat: 1,
      tokensUsed: 0,
      reply: "كتمتلك الصوت يا باشا.",
    };
  }

  // 4. Play / Pause
  if (["وقف الفيديو", "وقف", "شغل الفيديو", "كمل الفيديو", "كمل", "بوز", "ستوب", "pause", "resume"].includes(lower)) {
    return {
      type: "media",
      action: "play_pause",
      repeat: 1,
      tokensUsed: 0,
      reply: "تم يا باشا.",
    };
  }

  // 5. Next video
  if (["التالي", "الفيديو اللي بعده", "اللي بعده", "next"].includes(lower)) {
    return {
      type: "media",
      action: "next",
      repeat: 1,
      tokensUsed: 0,
      reply: "جبتلك الفيديو اللي بعده يا باشا.",
    };
  }

  // 6. Scroll Down / Up
  if (["انزل تحت", "انزل", "سكرول تحت", "نزل الصفحه", "scroll down"].includes(lower)) {
    return {
      type: "scroll",
      action: "scroll_down",
      direction: "down",
      amount: 5,
      tokensUsed: 0,
      reply: "نزلتلك الصفحة لتحت.",
    };
  }
  if (["اطلع فوق", "اطلع", "سكرول فوق", "طلع الصفحه", "scroll up"].includes(lower)) {
    return {
      type: "scroll",
      action: "scroll_up",
      direction: "up",
      amount: 5,
      tokensUsed: 0,
      reply: "طلعتلك الصفحة لفوق.",
    };
  }

  // 7. Lock Screen
  if (["اقفل الشاشه", "اعمل لوك", "لوك", "lock", "lock screen"].includes(lower)) {
    return {
      type: "power",
      action: "lock",
      tokensUsed: 0,
      reply: "قفلتلك الشاشة يا باشا.",
    };
  }

  // 8. Simple Browser Tab Commands (requires browser foreground check in socketHandler)
  if (["اقفل التاب", "قفل التاب", "close tab"].includes(lower)) {
    return {
      type: "tab",
      action: "close_current_tab",
      requiresBrowserForeground: true,
      tokensUsed: 0,
      reply: "قفلتلك التاب يا باشا.",
    };
  }
  if (["تاب جديد", "افتح تاب جديد", "new tab"].includes(lower)) {
    return {
      type: "tab",
      action: "new_tab",
      requiresBrowserForeground: true,
      tokensUsed: 0,
      reply: "فتحتلك تاب جديد.",
    };
  }

  // 9. Explicit Port Commands (e.g. "port 3000" or "بورت 3000")
  if (lower.startsWith("port ") || lower.startsWith("بورت ")) {
    const portNum = parseInt(lower.split(/\s+/)[1], 10);
    if (Number.isInteger(portNum) && portNum > 0 && portNum <= 65535) {
      return {
        type: "port",
        port: portNum,
        tokensUsed: 0,
        reply: `بشوفلك بورت ${portNum} شغال عليه ايه.`,
      };
    }
  }

  // 10. Open 7 Closed Apps & Known Websites
  if (lower.startsWith("افتح ") || lower.startsWith("open ")) {
    const target = lower.replace(/^(?:افتح|open)\s+/, "").trim();
    const appMap = {
      "في اس كود": "VS Code",
      "vs code": "VS Code",
      "vscode": "VS Code",
      "انتيجرافيتي": "Antigravity",
      "انتي جرافيتي": "Antigravity",
      "antigravity": "Antigravity",
      "كروم": "Chrome",
      "جوجل كروم": "Chrome",
      "chrome": "Chrome",
      "تيرمينال": "Terminal",
      "التيرمينال": "Terminal",
      "terminal": "Terminal",
      "حاسبه": "Calculator",
      "الحاسبه": "Calculator",
      "calculator": "Calculator",
      "ملفات": "Explorer",
      "الملفات": "Explorer",
      "explorer": "Explorer",
      "نوتباد": "Notepad",
      "النوتباد": "Notepad",
      "notepad": "Notepad",
    };
    if (appMap[target]) {
      return {
        type: "app",
        appName: appMap[target],
        tokensUsed: 0,
        reply: `فتحتلك ${appMap[target]} يا باشا.`,
      };
    }

    const urlMap = {
      "يوتيوب": "https://www.youtube.com",
      "youtube": "https://www.youtube.com",
      "جوجل": "https://www.google.com",
      "google": "https://www.google.com",
      "فيسبوك": "https://www.facebook.com",
      "facebook": "https://www.facebook.com",
      "لينكد ان": "https://www.linkedin.com",
      "linkedin": "https://www.linkedin.com",
      "جيت هاب": "https://github.com",
      "github": "https://github.com",
      "شات جي بي تي": "https://chatgpt.com",
      "chatgpt": "https://chatgpt.com",
      "واتساب": "https://web.whatsapp.com",
      "whatsapp": "https://web.whatsapp.com",
    };
    if (urlMap[target]) {
      return {
        type: "url",
        url: urlMap[target],
        tokensUsed: 0,
        reply: `فتحتلك ${target} يا باشا.`,
      };
    }
  }

  return null;
}
