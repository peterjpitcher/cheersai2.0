import OpenAI from "openai";
import { withRetry, getRetryOptions } from "@/lib/reliability/retry";
import { getCircuitBreaker } from "@/lib/reliability/circuit-breaker";
import { getTimeout } from "@/lib/reliability/timeout";

let openaiClient: OpenAI | null = null;

export function getOpenAIClient() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: getTimeout('openai'), // Add timeout
    });
  }
  
  return openaiClient;
}

// Wrapper for reliable OpenAI chat completions
export async function createChatCompletion(
  params: OpenAI.Chat.Completions.ChatCompletionCreateParams,
  options?: { skipReliability?: boolean }
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const client = getOpenAIClient();
  
  if (options?.skipReliability) {
    return client.chat.completions.create(params);
  }
  
  const circuitBreaker = getCircuitBreaker('openai');
  const retryOptions = getRetryOptions('openai');
  
  const operation = async () => {
    return await withRetry(
      async () => client.chat.completions.create(params),
      retryOptions,
      'OpenAI chat completion'
    );
  };
  
  // Fallback to a generic error message if OpenAI is down
  const fallback = async () => {
    throw new Error('AI content generation is temporarily unavailable. Please try again later.');
  };
  
  return circuitBreaker.execute('openai-chat', operation, fallback);
}

// Wrapper for reliable OpenAI embeddings
export async function createEmbedding(
  params: OpenAI.Embeddings.EmbeddingCreateParams,
  options?: { skipReliability?: boolean }
): Promise<OpenAI.Embeddings.CreateEmbeddingResponse> {
  const client = getOpenAIClient();
  
  if (options?.skipReliability) {
    return client.embeddings.create(params);
  }
  
  const circuitBreaker = getCircuitBreaker('openai');
  const retryOptions = getRetryOptions('openai');
  
  const operation = async () => {
    return await withRetry(
      async () => client.embeddings.create(params),
      retryOptions,
      'OpenAI embedding'
    );
  };
  
  return circuitBreaker.execute('openai-embedding', operation);
}