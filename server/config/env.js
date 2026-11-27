import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverEnvPath = path.resolve(__dirname, "../.env");

// Explicitly load server/.env regardless of process.cwd()
dotenv.config({ path: serverEnvPath });
dotenv.config();

export const env = {
  PORT: parseInt(process.env.PORT || "3000", 10),
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
  GOOGLE_GENERATIVE_AI_API_KEY: (
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    ""
  ).trim(),
  GEMINI_MODEL: (process.env.GEMINI_MODEL || "gemini-3.1-flash-lite").trim(),
};

// Alias for convenience
export const geminiModel = env.GEMINI_MODEL;

export function isAiConfigured() {
  return Boolean(
    env.GOOGLE_GENERATIVE_AI_API_KEY &&
    env.GOOGLE_GENERATIVE_AI_API_KEY.length > 0,
  );
}
