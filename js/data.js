// Доступ к Songsterr (через свой прокси-воркер) и локальное хранилище
const LS = {
  get(key, def) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {}
  },
};
export const store = LS;

export const getApiBase = () => (LS.get('apiBase', '') || window.DEFAULT_API_BASE || '').replace(/\/+$/, '');
export const setApiBase = (v) => LS.set('apiBase', (v || '').trim());

async function apiFetch(path) {
  const base = getApiBase();
  if (!base) throw new Error('NO_API');
  const res = await fetch(base + path);
  if (!res.ok) {
    let msg = '';
    try {
      msg = (await res.json()).error || '';
    } catch {}
    throw new Error(msg || 'HTTP ' + res.status);
  }
  return res;
}

export async function searchSongs(q, size = 20) {
  const res = await apiFetch(`/search?q=${encodeURIComponent(q)}&size=${size}`);
  return res.json();
}

export async function fetchTab(id) {
  const res = await apiFetch(`/gp?id=${encodeURIComponent(id)}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Избранное и история
export const favorites = {
  list: () => LS.get('favs', []),
  has: (id) => LS.get('favs', []).some((s) => s.id === id),
  toggle(song) {
    const list = LS.get('favs', []);
    const i = list.findIndex((s) => s.id === song.id);
    if (i >= 0) list.splice(i, 1);
    else list.unshift({ id: song.id, title: song.title, artist: song.artist });
    LS.set('favs', list);
    return i < 0;
  },
};

export const history = {
  list: () => LS.get('hist', []),
  add(song) {
    if (!song.id) return;
    const list = LS.get('hist', []).filter((s) => s.id !== song.id);
    list.unshift({ id: song.id, title: song.title, artist: song.artist });
    LS.set('hist', list.slice(0, 30));
  },
  clear: () => LS.set('hist', []),
};
