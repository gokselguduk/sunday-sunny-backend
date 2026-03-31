const axios = require('axios');

let cache = { at: 0, data: null };
const TTL_MS = 3 * 60 * 60 * 1000;

const GN = 'https://api.glassnode.com/v1/metrics';

/**
 * Glassnode: BTC MVRV Z, NUPL, SOPR (PPT slaytlarıyla uyumlu başlıklar).
 * https://docs.glassnode.com/basic-api/api — GLASSNODE_API_KEY
 */
async function fetchBtcOnChainSnapshot() {
  const key = String(process.env.GLASSNODE_API_KEY || '').trim();
  if (!key) {
    return { entegre: false, reason: 'GLASSNODE_API_KEY tanımlı değil', parite: 'BTC' };
  }

  const now = Date.now();
  if (cache.data && now - cache.at < TTL_MS) {
    return { ...cache.data, cached: true };
  }

  async function one(path, params = {}) {
    try {
      const res = await axios.get(`${GN}/${path}`, {
        params: { a: 'BTC', api_key: key, ...params },
        timeout: 15000
      });
      const arr = Array.isArray(res.data) ? res.data : [];
      const last = arr[arr.length - 1];
      return last?.v != null ? Number(last.v) : last?.value != null ? Number(last.value) : null;
    } catch (e) {
      return { error: e.response?.status || e.message };
    }
  }

  const mvrvRaw = await one('market/mvrv_z_score');
  const nuplRaw = await one('indicators/nupl');
  const soprRaw = await one('indicators/sopr');

  const mvrvZ = typeof mvrvRaw === 'number' ? mvrvRaw : null;
  const nupl = typeof nuplRaw === 'number' ? nuplRaw : null;
  const sopr = typeof soprRaw === 'number' ? soprRaw : null;

  const metrikler = [
    {
      kod: 'MVRV_Z',
      label: 'MVRV Z-Score',
      deger: mvrvZ,
      not: typeof mvrvRaw === 'object' ? String(mvrvRaw.error) : null
    },
    {
      kod: 'NUPL',
      label: 'NUPL',
      deger: nupl,
      not: typeof nuplRaw === 'object' ? String(nuplRaw.error) : null
    },
    {
      kod: 'SOPR',
      label: 'SOPR',
      deger: sopr,
      not: typeof soprRaw === 'object' ? String(soprRaw.error) : null
    }
  ];

  const hasAny = metrikler.some((m) => m.deger != null && Number.isFinite(m.deger));
  if (!hasAny) {
    return {
      entegre: false,
      reason: 'Glassnode yanıt vermedi veya anahtar yetkisiz',
      parite: 'BTC',
      metrikler
    };
  }

  const out = {
    entegre: true,
    kaynak: 'Glassnode',
    parite: 'BTC',
    fetchedAt: new Date().toISOString(),
    metrikler,
    btcEcho: true,
    altNot: 'Altcoinler için BTC metrikleri bağlam olarak kullanılır.',
    cached: false
  };
  cache = { at: now, data: out };
  return out;
}

module.exports = { fetchBtcOnChainSnapshot };
