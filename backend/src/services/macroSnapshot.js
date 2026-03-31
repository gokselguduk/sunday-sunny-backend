const axios = require('axios');

let cache = { at: 0, data: null };
const TTL_MS = 4 * 60 * 60 * 1000;

/**
 * FRED: Fed fonlama, M2, USD endeksi (DTWEXBGS), 10Y tahvil.
 * Railway: FRED_API_KEY=https://fred.stlouisfed.org/docs/api/api_key.html
 */
async function fetchMacroSnapshot() {
  const key = String(process.env.FRED_API_KEY || '').trim();
  if (!key) {
    return { entegre: false, reason: 'FRED_API_KEY tanımlı değil' };
  }

  const now = Date.now();
  if (cache.data && now - cache.at < TTL_MS) {
    return { ...cache.data, cached: true };
  }

  const base = 'https://api.stlouisfed.org/fred/series/observations';
  const series = [
    { id: 'DFF', kod: 'FED', label: 'Fed fonlama oranı (DFF)', birim: '%' },
    { id: 'M2SL', kod: 'M2', label: 'ABD M2 para arzı (M2SL)', birim: 'milyar USD' },
    { id: 'DTWEXBGS', kod: 'DXY_PROXY', label: 'USD ticaret ağırlıklı endeks (FRED DTWEXBGS)', birim: 'endeks' },
    { id: 'DGS10', kod: 'US10Y', label: '10 yıllık tahvil (DGS10)', birim: '%' }
  ];

  const maddeler = [];
  let dxy0 = null;
  let dxy1 = null;

  for (const s of series) {
    try {
      const res = await axios.get(base, {
        params: {
          series_id: s.id,
          api_key: key,
          file_type: 'json',
          sort_order: 'desc',
          limit: 2
        },
        timeout: 12000
      });
      const obs = res.data?.observations || [];
      const o0 = obs[0];
      const o1 = obs[1];
      const v0 = o0?.value === '.' ? NaN : parseFloat(o0?.value);
      const v1 = o1?.value === '.' ? NaN : parseFloat(o1?.value);
      if (s.id === 'DTWEXBGS') {
        dxy0 = Number.isFinite(v0) ? v0 : null;
        dxy1 = Number.isFinite(v1) ? v1 : null;
      }
      maddeler.push({
        kod: s.kod,
        label: s.label,
        son: Number.isFinite(v0) ? v0 : null,
        onceki: Number.isFinite(v1) ? v1 : null,
        tarih: o0?.date || null,
        birim: s.birim
      });
    } catch (e) {
      maddeler.push({ kod: s.kod, label: s.label, son: null, hata: e.message });
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  let uyumlulukLong = 'NOTR';
  if (dxy0 != null && dxy1 != null) {
    if (dxy0 < dxy1) uyumlulukLong = 'DESTEK';
    else if (dxy0 > dxy1) uyumlulukLong = 'BASKI';
  }

  const out = {
    entegre: true,
    kaynak: 'FRED',
    fetchedAt: new Date().toISOString(),
    maddeler,
    uyumlulukLong,
    etfNot:
      process.env.BTC_ETF_FLOW_NOT ||
      'BTC spot ETF günlük net akış: Farside/SoSo vb. harici tablo veya özel API ile eklenebilir (PPT Slayt 8).',
    cached: false
  };
  cache = { at: now, data: out };
  return out;
}

module.exports = { fetchMacroSnapshot };
