export interface InferenceJobData {
  prompt: string;
  estimatedCost?: number;
}

export interface InferenceJobResult {
  text: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  estimatedCost?: number;
  actualTokens?: number;
  drift?: number;
  bucketStatus?: {
    tokens: number;
    maxTokens: number;
    refillRatePerMinute: number;
  };
}
