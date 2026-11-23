import { openDB } from 'idb';
const dbPromise = openDB('krushinath-sugar-house', 1, { upgrade(db) { db.createObjectStore('drafts', { keyPath: 'localId' }); db.createObjectStore('cache'); } });
export async function putDraft(draft: any) { const db = await dbPromise; await db.put('drafts', draft); }
export async function getDrafts() { return (await (await dbPromise).getAll('drafts')) as any[]; }
export async function deleteDraft(id: string) { await (await dbPromise).delete('drafts', id); }
export async function cache(key: string, value: any) { await (await dbPromise).put('cache', value, key); }
export async function readCache(key: string) { return await (await dbPromise).get('cache', key); }
