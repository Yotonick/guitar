// Починка alphaTex перед загрузкой в плеер.
// Иногда в табах Songsterr попадаются невидимые управляющие символы в названиях, нечисловые темпы
// или странные такты, и alphaTab отказывается открыть всю песню («Error parsing alphaTex…»).
// Здесь: 1) чистим известные проблемы; 2) пробно разбираем; битые такты меняем на паузы
// (служебные строки — на безопасные), повторяем, пока не разберётся. Песня открывается почти целиком.

const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function sanitizeTex(tex) {
  return String(tex)
    .replace(CTRL, ' ')
    .replace(/\{tempo ([^}\s]*)\}/g, (m, v) => { const n = Math.round(Number(v)); return n > 0 && n < 1000 ? `{tempo ${n}}` : ''; })
    .replace(/^\\tempo (\S+)/m, (m, v) => { const n = Math.round(Number(v)); return `\\tempo ${n > 0 && n < 1000 ? n : 120}`; })
    .replace(/\{tu ([^}]*)\}/g, (m, v) => (/^\d+(?: \d+)?$/.test(v.trim()) ? m : ''));
}

// все сообщения разбора (ошибка может быть завёрнута в другую)
function diagnostics(err) {
  const out = [];
  const seen = new Set();
  const walk = (e, depth) => {
    if (!e || depth > 4 || seen.has(e)) return;
    seen.add(e);
    for (const k of ['lexerDiagnostics', 'parserDiagnostics', 'semanticDiagnostics']) {
      const items = e[k] && e[k].items;
      if (items) for (const d of items) if (d && d.severity !== 1 && d.start) out.push(d);
    }
    walk(e.inner, depth + 1);
    walk(e.innerError, depth + 1);
    walk(e.cause, depth + 1);
  };
  walk(err, 0);
  return out;
}

function tryParse(at, tex) {
  const imp = new at.importer.AlphaTexImporter();
  imp.logErrors = false;
  const settings = new at.Settings();
  imp.initFromString(tex, settings);
  imp.readScore();
}

const HEADER = /^\\(title|subtitle|artist|album|words|music|copyright|tab|instructions|notices|tempo|instrument|tuning|capo|track|staff|lyrics|chord|clef|ks|ts)\b/;

function restBar(line) {
  const lead = (line.match(/^((?:\\(?:ts \d+ \d+|ro|section "[^"]*"|ks \S+)\s*)*)/) || ['', ''])[1];
  const tail = (line.match(/(\s*\\rc \d+)?(\s*\|)?\s*$/) || [''])[0];
  return `${lead}:1 r${tail}`;
}

// at — пространство имён alphaTab (window.alphaTab). Возвращает { tex, fixedBars, notes: [сообщения] }
export function repairTex(tex, at) {
  let cur = sanitizeTex(tex);
  const res = { tex: cur, fixedBars: 0, notes: [], cleaned: cur !== String(tex) };
  if (!at || !at.importer || !at.importer.AlphaTexImporter) return res;
  for (let pass = 0; pass < 8; pass++) {
    let diags;
    try { tryParse(at, cur); res.tex = cur; return res; } catch (e) { diags = diagnostics(e); if (!diags.length) res.notes.push(String(e && e.message || e)); }
    if (!diags.length) break;
    const lines = cur.split('\n');
    let changed = false;
    const done = new Set();
    for (const d of diags) {
      const i = d.start.line - 1;
      if (i < 0 || i >= lines.length || done.has(i)) continue;
      done.add(i);
      if (res.notes.length < 6) res.notes.push(`строка ${i + 1}: ${d.message}`);
      const line = lines[i];
      let next;
      if (/^\\(title|subtitle|artist|album)\b/.test(line)) next = line.replace(/".*$/, '"?"');
      else if (HEADER.test(line) && !line.includes(':')) next = ''; // битая служебная строка — убираем
      else { next = restBar(line); res.fixedBars++; }
      if (next !== line) { lines[i] = next; changed = true; }
    }
    if (!changed) break;
    cur = lines.join('\n');
  }
  res.tex = cur;
  res.failed = true;
  return res;
}
