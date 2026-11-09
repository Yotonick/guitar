// Cloudflare Worker: прокси к Songsterr (бесплатный тариф)
// Эндпоинты:
//   GET /search?q=metallica+sandman&size=20  -> [{id,title,artist}]
//   GET /gp?id=SONG_ID                       -> файл Guitar Pro (бинарный)
// Songsterr не имеет официального API, эндпоинты могут измениться.

const SONGSTERR = 'https://www.songsterr.com';
const UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'X-Song-Title, X-Song-Artist, X-File-Ext',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Referer: SONGSTERR + '/' },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Songsterr ${res.status} (${new URL(url).pathname})`);
  return res.json();
}

// Ищем ссылку на GP-файл самой свежей ревизии
async function findSource(id) {
  const revs = await getJson(`${SONGSTERR}/api/meta/${id}/revisions`);
  const list = Array.isArray(revs) ? revs : revs.revisions || [];
  if (!list.length) throw new Error('У песни нет ревизий');
  // первая — самая свежая, но берём первую, у которой есть исходник
  for (const rev of list) {
    if (rev.source) return { url: rev.source, rev };
  }
  const revId = list[0].revisionId || list[0].id;
  const detail = await getJson(`${SONGSTERR}/api/revision/${revId}`);
  if (!detail.source) throw new Error('Не нашли файл табулатуры');
  return { url: detail.source, rev: list[0] };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);

    try {
      if (url.pathname === '/search') {
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) return json([]);
        const size = Math.min(parseInt(url.searchParams.get('size') || '20', 10) || 20, 50);
        const data = await getJson(`${SONGSTERR}/api/songs?pattern=${encodeURIComponent(q)}&size=${size}`);
        const items = (Array.isArray(data) ? data : data.songs || []).map((s) => ({
          id: s.songId ?? s.id,
          title: s.title,
          artist: s.artist,
          tracks: (s.tracks || []).map((t) => t.instrument || t.name).filter(Boolean).slice(0, 6),
        }));
        return json(items);
      }

      if (url.pathname === '/gp') {
        const id = (url.searchParams.get('id') || '').replace(/[^0-9]/g, '');
        if (!id) return json({ error: 'Нужен id песни' }, 400);
        const { url: source } = await findSource(id);
        const file = await fetch(source, { headers: { 'User-Agent': UA, Referer: SONGSTERR + '/' } });
        if (!file.ok) throw new Error(`Файл недоступен (${file.status})`);
        const ext = (source.split('?')[0].match(/\.(gp\d?|gpx|gp5|gp4|gp3)$/i) || [, 'gp'])[1];
        return new Response(file.body, {
          headers: {
            ...CORS,
            'Content-Type': 'application/octet-stream',
            'X-File-Ext': ext,
            'Cache-Control': 'public, max-age=86400',
          },
        });
      }

      return json({ ok: true, usage: ['/search?q=...', '/gp?id=...'] });
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  },
};
