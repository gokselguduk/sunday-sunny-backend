/**
 * Üçüncü parti kripto haber özeti (CryptoCompare public API, anahtar gerekmez).
 * Yatırım tavsiyesi değildir; yalnızca model bağlamı için.
 */

const axios = require('axios');

async function fetchNewsForAsset(baseAsset, limit = 8) {
  const cat = String(baseAsset || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!cat) return { items: [], source: null };
  try {
    const url =
      'https://min-api.cryptocompare.com/data/v2/news/?categories=' +
      encodeURIComponent(cat) +
      '&excludeCategories=Sponsored&lang=EN';
    const res = await axios.get(url, { timeout: 10000 });
    const data = res.data?.Data || [];
    const items = data.slice(0, limit).map((x) => ({
      title: x.title || '',
      source: x.source || x.source_info?.name || '',
      published: x.published_on,
      excerpt: String(x.body || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220)
    }));
    return { items, source: 'CryptoCompare' };
  } catch (e) {
    console.warn('cryptoNews:', e.message);
    return { items: [], source: null };
  }
}

function formatNewsForPrompt(items) {
  if (!items.length) {
    return 'SON HABERLER: Haber akışı boş veya alınamadı; haber temelli yorum yapma, bunu kullanıcıya kısaca belirt.';
  }
  const lines = items.map((it, i) => {
    const ex = it.excerpt ? ` — ${it.excerpt}` : '';
    return `${i + 1}. [${it.source || '?'}] ${it.title}${ex}`;
  });
  return ['SON HABERLER (özet ve duygu için; doğruluk garantisi yok):', ...lines].join('\n');
}

module.exports = { fetchNewsForAsset, formatNewsForPrompt };
