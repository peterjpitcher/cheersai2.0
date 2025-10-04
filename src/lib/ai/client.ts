import OpenAI from "openai";

import { env } from "@/env";

let client: OpenAI | null = null;

export function getOpenAIClient() {
  if (!env.server.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing");
  }
  if (!client) {
    client = new OpenAI({ apiKey: env.server.OPENAI_API_KEY });
  }
  return client;
}
