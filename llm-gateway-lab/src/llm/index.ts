import { InferJobResult } from '../types';

/**
 * LLM Client abstraction.
 * This is a provider-agnostic interface for interacting with LLM APIs.
 */
export async function generateText(prompt: string): Promise<InferJobResult> {
  // Stub implementation
  // Wait for 2 seconds to simulate network call
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return {
    text: "stub response"
  };
}
