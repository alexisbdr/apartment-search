import { createClient } from '@supabase/supabase-js';
import { conflictError, duplicateError } from './listings.js';

export const storageKey = 'brooklyn-apartment-search:listings:v1';
const columns = 'id,source,source_key,url,title,neighborhood,monthly_rent,bedrooms,bathrooms,square_feet,image_url,notes,status,trashed_at,street_address,latitude,longitude,created_at,updated_at';
const searchColumns = 'enabled,neighborhoods,max_rent,min_bedrooms';

function browserStorageError() {
  return new Error('The browser could not save or read listings. Check that site storage is enabled.');
}

export function browserStore(storage) {
  function read() {
    try {
      const rows = JSON.parse(storage.getItem(storageKey) ?? '[]');
      if (!Array.isArray(rows)) throw browserStorageError();
      return rows;
    } catch {
      throw browserStorageError();
    }
  }

  function write(operation) {
    const transaction = () => {
      const rows = read();
      const result = operation(rows);
      try {
        storage.setItem(storageKey, JSON.stringify(rows));
      } catch {
        throw browserStorageError();
      }
      return result;
    };

    const locks = globalThis.window?.navigator.locks;
    return locks
      ? locks.request(storageKey, transaction)
      : Promise.resolve().then(transaction);
  }

  function requireCurrent(rows, listing) {
    const index = rows.findIndex(row => row.id === listing.id);
    if (index === -1 || rows[index].updated_at !== listing.updated_at) throw conflictError();
    return index;
  }

  function requireUnique(rows, payload, except) {
    if (rows.some(row => row.id !== except && row.source === payload.source && row.source_key === payload.source_key)) {
      throw duplicateError();
    }
  }

  return {
    subscribe(notify) {
      const changed = event => {
        if (event.key === storageKey || event.key === null) notify();
      };
      window.addEventListener('storage', changed);
      return () => window.removeEventListener('storage', changed);
    },
    async list() {
      return read().sort((first, second) => second.created_at.localeCompare(first.created_at));
    },
    add(draft) {
      return write(rows => {
        requireUnique(rows, draft);
        const now = new Date().toISOString();
        const listing = { ...draft, id: crypto.randomUUID(), status: 'interested', created_at: now, updated_at: now };
        rows.push(listing);
        return listing;
      });
    },
    update(listing, changes) {
      return write(rows => {
        const index = requireCurrent(rows, listing);
        if (changes.source_key) requireUnique(rows, changes, listing.id);
        const next = new Date(Math.max(Date.now(), Date.parse(listing.updated_at) + 1)).toISOString();
        rows[index] = { ...rows[index], ...changes, updated_at: next };
        return rows[index];
      });
    },
    remove(listing) {
      return write(rows => {
        const index = requireCurrent(rows, listing);
        rows.splice(index, 1);
      });
    },
  };
}

function databaseResult({ data, error }) {
  if (error?.code === '23505') throw duplicateError();
  if (error) throw new Error('The shared board could not be updated or loaded. Check your connection and try again.');
  return data;
}

export function sharedStore(client) {
  return {
    subscribe(notify) {
      const channel = client.channel('listing-board')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, notify)
        .subscribe(status => { if (status === 'SUBSCRIBED') notify(); });
      return () => { void client.removeChannel(channel); };
    },
    async list() {
      const rows = [];
      const pageSize = 200;
      for (let start = 0; ; start += pageSize) {
        const page = databaseResult(await client.from('listings').select(columns)
          .order('created_at', { ascending: false }).order('id').range(start, start + pageSize - 1));
        rows.push(...page);
        if (page.length < pageSize) return rows;
      }
    },
    async add(draft) {
      return databaseResult(await client.from('listings').insert(draft).select(columns).single());
    },
    async getSearch() {
      return databaseResult(await client.from('board_search').select(searchColumns).single());
    },
    async saveSearch(settings) {
      return databaseResult(await client.from('board_search').update(settings).eq('id', 1)
        .select(searchColumns).single());
    },
    async update(listing, changes) {
      const row = databaseResult(await client.from('listings').update(changes)
        .eq('id', listing.id).eq('updated_at', listing.updated_at).select(columns).maybeSingle());
      if (!row) throw conflictError();
      return row;
    },
    async remove(listing) {
      const row = databaseResult(await client.from('listings').delete()
        .eq('id', listing.id).eq('updated_at', listing.updated_at).select('id').maybeSingle());
      if (!row) throw conflictError();
    },
  };
}

export function boardBackend(env) {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url && !key) {
    try {
      return { mode: 'local', store: browserStore(window.localStorage) };
    } catch {
      return { mode: 'unavailable', message: browserStorageError().message };
    }
  }
  if (!url || !key || !key.startsWith('sb_publishable_')) {
    return { mode: 'unavailable', message: 'Shared board setup is incomplete. Set the Supabase URL and publishable key.' };
  }

  try {
    const client = createClient(url, key);
    return { mode: 'shared', client, store: sharedStore(client) };
  } catch {
    return { mode: 'unavailable', message: 'Shared board setup is incomplete. Check the Supabase project URL.' };
  }
}
