export interface InferenceJobData {
  prompt: string;
}

export interface InferenceJobResult {
  text: string;
  latencyMs: number;
}
