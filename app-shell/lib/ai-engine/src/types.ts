export const PLATFORMS = ['instagram', 'linkedin', 'x', 'youtube', 'tiktok', 'reddit', 'web', 'screenshot'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** The only part of the Anthropic SDK this project needs. The real `new Anthropic()` satisfies it, and tests pass a fake. */
export interface LlmClient {
  messages: { create: (params: any, options?: any) => Promise<any> };
}

/** A database handle: plain queries plus a transaction helper. `dbFromPool` (worker.ts) adapts node-postgres. */
export interface Queryable {
  query<R = any>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}
export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}
