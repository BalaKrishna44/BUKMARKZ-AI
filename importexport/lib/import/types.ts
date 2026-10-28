export type ImportFormat = 'netscape-html' | 'csv' | 'json' | 'unknown';

export interface ParsedBookmark {
  url: string;          // validated http(s) URL, as the user saved it
  urlKey: string;       // normalised key used for de-duplication
  title: string;
  note: string | null;
  tags: string[];       // normalised: lowercase, no '#', no spaces
  folder: string[];     // path from the root, e.g. ['Dev', 'React']
  createdAt: string | null; // ISO-8601 or null
}

export interface ParseResult {
  format: ImportFormat;
  sourceGuess: string | null;
  items: ParsedBookmark[];
  /** Why rows were dropped, e.g. { reason: 'unsupported-scheme', count: 3 } */
  skipped: { reason: string; count: number }[];
  warnings: string[];
}

export interface ParseOptions {
  maxItems?: number; // hard cap, default 50_000
}
