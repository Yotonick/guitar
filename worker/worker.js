// Cloudflare Worker: прокси к Songsterr (бесплатный тариф)
// Эндпоинты:
//   GET /search?q=metallica+sandman&size=20  -> [{id,title,artist,tracks}]
//   GET /tab?id=SONG_ID                      -> {title,artist,parts:[{index,name,instrument,kind,data}]}
//   GET /debug?id=SONG_ID                    -> сырые ответы Songsterr для диагностики
// У Songsterr нет официального API: используются те же адреса, что и на их сайте.

const SONGSTERR = 'https://www.songsterr.com';
const CDN_DEFAULT = 'dqsljvtekg760.cloudfront.net';
const UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const MAX_PARTS = 6;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });

const HEADERS = { 'User-Agent': UA, Accept: 'application/json, text/html, */*', Referer: SONGSTERR + '/' };

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${new URL(url).host}${new URL(url).pathname}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const keys = (o) => Object.keys(o || {}).join(',');

// Тип дорожки: guitar / bass / drums / vocals / other
function kindOf(t) {
  const hash = String(t.hash || t.image || '').toLowerCase();
  const pref = hash.split('_')[0];
  if (['guitar', 'bass', 'drums', 'vocals'].includes(pref)) return pref;
  const s = `${t.instrument || ''} ${t.name || ''}`.toLowerCase();
  if (t.isDrums || /drum|percussion/.test(s)) return 'drums';
  if (t.isVocalTrack || /vocal|voice|choir/.test(s)) return 'vocals';
  if (t.isBassTrack || /bass/.test(s)) return 'bass';
  if (t.isGuitarTrack || /guitar/.test(s)) return 'guitar';
  return 'other';
}

// Метаданные песни: сначала API, потом JSON на странице
async function loadMeta(id, diag) {
  try {
    const m = await getJson(`${SONGSTERR}/api/meta/${id}`);
    diag.push(`meta: поля [${keys(m)}]`);
    if (m && m.revisionId && Array.isArray(m.tracks)) return m;
  } catch (e) {
    diag.push('meta: ' + e.message);
  }
  try {
    const html = await getText(`${SONGSTERR}/a/wsa/tab-s${id}`);
    const m = html.match(/<script[^>]*id="state"[^>]*>([\s\S]*?)<\/script>/);
    if (m) {
      const cur = JSON.parse(m[1])?.meta?.current;
      diag.push(`page: current [${keys(cur)}]`);
      if (cur && cur.revisionId && Array.isArray(cur.tracks)) return cur;
    }
  } catch (e) {
    diag.push('page: ' + e.message);
  }
  throw new Error('Не получили описание песни');
}

// Хосты CDN: известный и те, что указаны на главной странице
async function cdnHosts() {
  const hosts = [CDN_DEFAULT];
  try {
    const html = await getText(SONGSTERR + '/');
    const re = /<link[^>]+(?:dns-prefetch|preconnect)[^>]*href="(?:https?:)?\/\/([^"/]+)"/g;
    let m;
    while ((m = re.exec(html))) if (/cloudfront\.net$/.test(m[1]) && !hosts.includes(m[1])) hosts.push(m[1]);
  } catch {}
  return hosts;
}

async function tryPart(host, id, rev, image, idx) {
  const res = await fetch(`https://${host}/${id}/${rev}/${image}/${idx}.json`, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadTab(id) {
  const diag = [];
  const meta = await loadMeta(id, diag);
  const tracks = meta.tracks
    .map((t, i) => ({ t, index: t.partId ?? i, kind: kindOf(t) }))
    .filter((x) => ['guitar', 'bass', 'drums'].includes(x.kind))
    .slice(0, MAX_PARTS);
  if (!tracks.length) throw new Error('Нет гитарных дорожек. ' + diag.join(' | '));

  const images = [...new Set([meta.image, ...tracks.map((x) => x.t.image || x.t.hash)].filter(Boolean))];
  if (!images.length) throw new Error('Нет ключа данных (image). ' + diag.join(' | '));

  // первая дорожка определяет рабочий хост и ключ
  let hosts = [CDN_DEFAULT];
  let host = null;
  let image = null;
  let firstData = null;
  const first = tracks[0];
  for (let pass = 0; pass < 2 && !firstData; pass++) {
    if (pass === 1) hosts = await cdnHosts();
    for (const h of hosts) {
      for (const img of images) {
        try {
          firstData = await tryPart(h, id, meta.revisionId, img, first.index);
          host = h;
          image = img;
          break;
        } catch (e) {
          diag.push(`part ${h}/${img}: ${e.message}`);
        }
      }
      if (firstData) break;
    }
  }
  if (!firstData) throw new Error('Не загрузили ноты. ' + diag.slice(-4).join(' | '));

  const parts = [{ index: first.index, name: first.t.name, instrument: first.t.instrument, kind: first.kind, data: firstData }];
  const rest = await Promise.all(
    tracks.slice(1).map(async (x) => {
      try {
        const data = await tryPart(host, id, meta.revisionId, image, x.index);
        return { index: x.index, name: x.t.name, instrument: x.t.instrument, kind: x.kind, data };
      } catch {
        return null;
      }
    })
  );
  parts.push(...rest.filter(Boolean));
  return { id, title: meta.title, artist: meta.artist, revisionId: meta.revisionId, parts };
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

      if (url.pathname === '/tab') {
        const id = (url.searchParams.get('id') || '').replace(/[^0-9]/g, '');
        if (!id) return json({ error: 'Нужен id песни' }, 400);
        const tab = await loadTab(id);
        return json(tab, 200, { 'Cache-Control': 'public, max-age=3600' });
      }

      if (url.pathname === '/debug') {
        const id = (url.searchParams.get('id') || '').replace(/[^0-9]/g, '');
        const diag = [];
        const out = { id };
        try {
          const meta = await loadMeta(id, diag);
          out.metaKeys = keys(meta);
          out.revisionId = meta.revisionId;
          out.image = meta.image;
          out.tracks = (meta.tracks || []).map((t) => ({ ...t, _kind: kindOf(t) }));
        } catch (e) {
          out.error = e.message;
        }
        out.diag = diag;
        return json(out);
      }

      return json({ ok: true, usage: ['/search?q=...', '/tab?id=...', '/debug?id=...'] });
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  },
};
