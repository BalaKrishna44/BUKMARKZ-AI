/** The Supabase user the extension is signed in as. */
export interface SessionUser { id: string; email: string }

/**
 * A Supabase ACCESS token only. The refresh token is deliberately never shared with the extension: Supabase rotates
 * refresh tokens, so two clients holding the same one would sign each other out. The web app re-sends a fresh access
 * token every time it refreshes (see web/syncLoginToExtension.ts).
 */
export interface Session {
  accessToken: string;
  /** Epoch SECONDS, read from the JWT's own `exp` claim (never from the page). */
  expiresAt: number;
  user: SessionUser;
  syncedAt: number;
}

export type SaveKind = 'page' | 'selection' | 'image';

export interface SaveInput {
  url: string;
  title: string;
  /** Markdown. For kind "selection" this is the quoted text plus a source link. */
  note: string;
  tags: string[];
  /** Epoch ms, or null for no reminder. */
  remindAt: number | null;
  /** True when saved from an incognito window. Private saves never leave this device. */
  private: boolean;
  /** Defaults to "page". */
  kind?: SaveKind;
  /** http(s) address of the image, for kind "image". */
  imageUrl?: string;
  /** The tab's favicon address (http/https only) and its meta description, captured by the popup. */
  favicon?: string;
  description?: string;
}

export type SaveStatus = 'synced' | 'queued' | 'local-private';

export interface SavedItem {
  id: string;
  url: string;
  title: string;
  note: string;
  tags: string[];
  remindAt: number | null;
  private: boolean;
  status: SaveStatus;
  savedAt: number;
  kind: SaveKind;
  imageUrl?: string;
  favicon?: string;
  description?: string;
  serverId?: string;
}

export interface Reminder { id: string; url: string; title: string; at: number; private: boolean; fired: boolean }
