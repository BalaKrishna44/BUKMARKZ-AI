export interface SessionUser { id: number; email: string; username?: string }

export interface Session {
  token: string;
  /** ISO string from the server, or null if it does not expire. */
  expiry: string | null;
  user: SessionUser;
  syncedAt: number;
}

export interface SaveInput {
  url: string;
  title: string;
  note: string;
  tags: string[];
  /** Epoch ms, or null for no reminder. */
  remindAt: number | null;
  /** True when saved from an incognito window. Private saves never leave this device. */
  private: boolean;
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
  serverId?: number;
}

export interface Reminder { id: string; url: string; title: string; at: number; private: boolean; fired: boolean }
