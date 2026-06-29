import { Groq } from 'groq-sdk';

/*
 * Why is the LLMClient interface provider-agnostic?
 * An interface decouples the core business logic (like queuing, routing, and processing) 
 * from the specific implementation details of any given LLM provider. This allows us to 
 * swap out providers (e.g., Groq vs Ollama vs OpenAI) or add new ones without changing 
 * the rest of the application code. It ensures a consistent input/output contract.
 */
export interface LLMClient {
  complete(prompt: string): Promise<{ text: string; latencyMs: number }>;
}

export class GroqClient implements LLMClient {
  private groq: Groq;
  
  constructor() {
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }

  async complete(prompt: string): Promise<{ text: string; latencyMs: number }> {
    const start = Date.now();
    const chatCompletion = await this.groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-8b-instant',
    });
    const latencyMs = Date.now() - start;
    
    return {
      text: chatCompletion.choices[0]?.message?.content || '',
      latencyMs
    };
  }
}

export class OllamaClient implements LLMClient {
  async complete(prompt: string): Promise<{ text: string; latencyMs: number }> {
    const start = Date.now();
    
    // Using native fetch to hit local Ollama
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5-coder',
        prompt,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }
    
    const data = await response.json() as { response: string };
    const latencyMs = Date.now() - start;
    
    return {
      text: data.response,
      latencyMs
    };
  }
}

export function getLLMClient(provider?: string): LLMClient {
  if (provider === 'groq') {
    return new GroqClient();
  } else if (provider === 'ollama') {
    return new OllamaClient();
  }
  return new OllamaClient(); // default
}
