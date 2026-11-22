import dotenv from "dotenv";
dotenv.config();

export const env = {
  PORT: parseInt(process.env.PORT || "3000", 10),
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
  GOOGLE_GENERATIVE_AI_API_KEY: (
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    ""
  ).trim(),
  GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-3.8-flash",
};

export function isAiConfigured() {
  return Boolean(
    env.GOOGLE_GENERATIVE_AI_API_KEY &&
    env.GOOGLE_GENERATIVE_AI_API_KEY.length > 0,
  );
}
