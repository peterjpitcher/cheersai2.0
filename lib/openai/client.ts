import OpenAI from "openai";

let openaiClient: OpenAI | null = null;

export function getOpenAIClient() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  
  return openaiClient;
}