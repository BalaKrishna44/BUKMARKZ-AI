import { createRoot } from 'react-dom/client';
import BookmarkFeedView from '../app/dashboard/BookmarkFeedView';
import { toBookmark, type Category, type ItemRow } from '../lib/bookmarks';
import { state } from './supa';
const cats: Category[] = [{ id: 'c1', name: 'Development', position: 0 }, { id: 'c2', name: 'AI & ML', position: 1 }];
const mk = (i: number, o: Partial<ItemRow> = {}): ItemRow => ({ id: 'id' + i, title: `Article ${i}`, url: `https://example${i}.com/p`, note: null, tags: i === 1 ? ['mine'] : [], ai_tags: i === 1 ? ['react', 'rag'] : ['misc'], summary: `Summary ${i}`, meta_description: null, favicon_url: null, category_id: i % 2 ? 'c1' : 'c2', created_at: new Date(Date.now() - i * 3600e3).toISOString(), item_type: 'link', completed_at: null, ...o });
const rows = [mk(1), mk(2), mk(3, { item_type: 'oneclist_task', title: 'Try the Pinecone quickstart' }), mk(4, { item_type: 'oneclist_task', title: 'Read the Postgres RLS guide', completed_at: new Date().toISOString() })];
state.serverItems = [mk(1), mk(2), mk(3, { item_type: 'oneclist_task' }), mk(9, { title: 'Appeared during the outage' })];
createRoot(document.getElementById('r')!).render(<BookmarkFeedView initialBookmarks={rows.map(toBookmark).filter((b) => b !== null)} initialCategories={cats} userId="u1" userEmail="krishna@example.com" />);
