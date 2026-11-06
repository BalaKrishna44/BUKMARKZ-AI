// Shared by lib/url.ts. Identical to importexport/lib/import/types.ts's ParsedBookmark: keep the two in sync.
export interface ParsedBookmark {
  url: string;              // validated http(s) URL, as the user saved it
  urlKey: string;           // normalised key used for de-duplication
  title: string;
  note: string | null;
  tags: string[];           // normalised: lowercase, no '#', no spaces
  folder: string[];         // path from the root, e.g. ['Dev', 'React']
  createdAt: string | null; // ISO-8601 or null
}
