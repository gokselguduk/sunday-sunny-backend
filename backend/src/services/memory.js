// Redis Hafıza Katmanı
// Sinyal geçmişi + öğrenme verisi

const Redis = require('ioredis');

let redis = null;

function getRedis() {
  if (!redis) {
    if (process.env.REDIS_URL) {
      redis = new Redis(process.env.REDIS_URL);
    } else {
      // Redis yoksa hafıza içi basit cache
      const cache = new Map();
      return {
        get:    async (k)    => cache.get(k) || null,
        set:    async (k, v) => { cache.set(k, v); return 'OK'; },
        lpush:  async (k, v) => { const arr = cache.get(k) || []; arr.unshift(v); cache.set(k, arr); return arr.length; },
        lrange: async (k, start, stop) => {
          const arr = cache.get(k) || [];
          const s = Number.isFinite(start) ? start : 0;
          const e = Number.isFinite(stop) ? stop : arr.length - 1;
          return arr.slice(s, e + 1);
        },
        incr:   async (k)    => { const v = (parseInt(cache.get(k)) || 0) + 1; cache.set(k, v); return v; },
        sadd:   async (k, v) => {
          const set = cache.get(k) || new Set();
          set.add(v);
          cache.set(k, set);
          return set.size;
        },
        srem:   async (k, v) => {
          const set = cache.get(k) || new Set();
          set.delete(v);
          cache.set(k, set);
          return 1;
        },
        smembers: async (k) => {
          const set = cache.get(k) || new Set();
          return [...set];
        }
      };
    }
  }
  return redis;
}

// ── SİNYAL KAYDET ───────────────────────────
async function saveSignal(signal) {
  try {
    const r   = getRedis();
    const key = `signal:${signal.symbol}:${Date.now()}`;
    const data = JSON.stringify({
      symbol:        signal.symbol,
      score:         signal.score,
      firsatSkor:    signal.firsatSkoru?.skor ?? null,
      firsatSeviye:  signal.firsatSkoru?.seviye ?? null,
      entryPrice:    signal.lastClose,
      tp1:           signal.atr?.takeProfit1,
      tp2:           signal.atr?.takeProfit2,
      tp3:           signal.atr?.takeProfit3,
      sl:            signal.atr?.stopLoss,
      quality:       signal.quality?.grade,
      patterns:      signal.candlePatterns?.patterns?.map(p => p.name),
      divergence:    signal.divergence,
      regime:        signal.regime?.type,
      timestamp:     new Date().toISOString(),
      result:        'BEKLIYOR'
    });
    await r.set(key, data);
    await r.lpush('signals:history', key);
    return key;
  } catch (err) {
    console.error('Sinyal kaydedilemedi:', err.message);
    return null;
  }
}

function createTierBucket(label, min, max) {
  return {
    label,
    min,
    max,
    resolved: 0,
    pending: 0,
    tp1: 0,
    tp2: 0,
    tp3: 0,
    sl: 0
  };
}

function classifyTier(firsatSkor) {
  if (typeof firsatSkor !== 'number') return null;
  if (firsatSkor >= 80) return 'nadir';
  if (firsatSkor >= 65) return 'guclu';
  if (firsatSkor >= 50) return 'iyi';
  return null;
}

function percent(value, total) {
  if (!total) return 0;
  return parseFloat(((value / total) * 100).toFixed(1));
}

function summarizeTier(bucket) {
  const tp1Hit = bucket.tp1 + bucket.tp2 + bucket.tp3;
  const tp2Hit = bucket.tp2 + bucket.tp3;
  const tp3Hit = bucket.tp3;
  return {
    ...bucket,
    tp1Hit,
    tp2Hit,
    tp3Hit,
    tp1Rate: percent(tp1Hit, bucket.resolved),
    tp2Rate: percent(tp2Hit, bucket.resolved),
    tp3Rate: percent(tp3Hit, bucket.resolved),
    slRate: percent(bucket.sl, bucket.resolved)
  };
}

// ── SINYAL SONUCU GÜNCELLE ───────────────────
async function updateSignalResult(key, result, exitPrice) {
  try {
    const r    = getRedis();
    const data = await r.get(key);
    if (!data) return;
    const signal = JSON.parse(data);
    signal.result    = result;    // 'TP1', 'TP2', 'TP3', 'SL', 'MANUEL'
    signal.exitPrice = exitPrice;
    signal.exitTime  = new Date().toISOString();
    signal.profitPct = signal.entryPrice > 0
      ? parseFloat(((exitPrice - signal.entryPrice) / signal.entryPrice * 100).toFixed(2))
      : 0;
    await r.set(key, JSON.stringify(signal));

    // Başarı istatistiği güncelle
    if (result === 'TP1' || result === 'TP2' || result === 'TP3') {
      await r.incr('stats:success');
    } else if (result === 'SL') {
      await r.incr('stats:fail');
    }

    // Pattern başarı takibi
    if (signal.patterns) {
      for (const pattern of signal.patterns) {
        const pKey = `pattern:${pattern}:${result === 'SL' ? 'fail' : 'success'}`;
        await r.incr(pKey);
      }
    }
  } catch (err) {
    console.error('Sinyal guncellenemedi:', err.message);
  }
}

function historyKeyPrefixForSymbol(symbol) {
  const u = String(symbol || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!u) return '';
  const pair = u.endsWith('USDT') ? u : `${u}USDT`;
  return `signal:${pair}:`;
}

// ── ÖĞRENME VERİSİ ÇEK ──────────────────────
async function getLearningData(symbol) {
  try {
    const r       = getRedis();
    const keys    = await r.lrange('signals:history', 0, 200);
    const history = [];
    const prefix  = historyKeyPrefixForSymbol(symbol);
    if (!prefix) return { history: [], successRate: null, total: 0, success: 0, fail: 0 };

    for (const key of keys) {
      if (!key.startsWith(prefix)) continue;
      const data = await r.get(key);
      if (data) history.push(JSON.parse(data));
    }

    const success = history.filter(h => h.result && h.result !== 'BEKLIYOR' && h.result !== 'SL').length;
    const fail    = history.filter(h => h.result === 'SL').length;
    const total   = success + fail;
    const rate    = total > 0 ? parseFloat((success / total * 100).toFixed(1)) : null;

    return { history: history.slice(0, 10), successRate: rate, total, success, fail };
  } catch (err) {
    return { history: [], successRate: null, total: 0, success: 0, fail: 0 };
  }
}

// ── GENEL İSTATİSTİK ─────────────────────────
async function getStats() {
  try {
    const r       = getRedis();
    const success = parseInt(await r.get('stats:success')) || 0;
    const fail    = parseInt(await r.get('stats:fail'))    || 0;
    const total   = success + fail;
    const rate    = total > 0 ? parseFloat((success / total * 100).toFixed(1)) : null;
    return { success, fail, total, successRate: rate };
  } catch (err) {
    return { success: 0, fail: 0, total: 0, successRate: null };
  }
}

async function getTierPerformance(limit) {
  const maxItems = Number.isFinite(limit) ? Math.max(50, Math.min(limit, 5000)) : 1500;
  try {
    const r = getRedis();
    const keys = await r.lrange('signals:history', 0, maxItems);
    const tiers = {
      nadir: createTierBucket('NADIR (80+)', 80, 100),
      guclu: createTierBucket('GUCLU (65-79)', 65, 79),
      iyi: createTierBucket('IYI (50-64)', 50, 64)
    };

    let unknownTier = 0;
    for (const key of keys) {
      const raw = await r.get(key);
      if (!raw) continue;
      const signal = JSON.parse(raw);
      const tierKey = classifyTier(signal.firsatSkor);
      if (!tierKey) {
        unknownTier += 1;
        continue;
      }

      if (signal.result === 'BEKLIYOR') {
        tiers[tierKey].pending += 1;
        continue;
      }

      if (!['TP1', 'TP2', 'TP3', 'SL'].includes(signal.result)) continue;
      tiers[tierKey].resolved += 1;
      if (signal.result === 'TP1') tiers[tierKey].tp1 += 1;
      if (signal.result === 'TP2') tiers[tierKey].tp2 += 1;
      if (signal.result === 'TP3') tiers[tierKey].tp3 += 1;
      if (signal.result === 'SL') tiers[tierKey].sl += 1;
    }

    return {
      tiers: {
        nadir: summarizeTier(tiers.nadir),
        guclu: summarizeTier(tiers.guclu),
        iyi: summarizeTier(tiers.iyi)
      },
      unknownTier,
      sampleSize: keys.length
    };
  } catch (err) {
    return {
      tiers: {
        nadir: summarizeTier(createTierBucket('NADIR (80+)', 80, 100)),
        guclu: summarizeTier(createTierBucket('GUCLU (65-79)', 65, 79)),
        iyi: summarizeTier(createTierBucket('IYI (50-64)', 50, 64))
      },
      unknownTier: 0,
      sampleSize: 0
    };
  }
}

async function listPendingSignals(limit) {
  const maxItems = Number.isFinite(limit) ? Math.max(50, Math.min(limit, 5000)) : 1000;
  try {
    const r = getRedis();
    const keys = await r.lrange('signals:history', 0, maxItems);
    const pending = [];
    for (const key of keys) {
      const raw = await r.get(key);
      if (!raw) continue;
      const signal = JSON.parse(raw);
      if (signal.result === 'BEKLIYOR') pending.push({ key, ...signal });
    }
    return pending;
  } catch (err) {
    return [];
  }
}

const PUSH_SUBS_KEY = 'push:subscriptions';

async function savePushSubscription(subscription) {
  if (!subscription?.endpoint) return false;
  try {
    const r = getRedis();
    await r.sadd(PUSH_SUBS_KEY, JSON.stringify(subscription));
    return true;
  } catch (err) {
    return false;
  }
}

async function removePushSubscription(endpoint) {
  if (!endpoint) return false;
  try {
    const all = await getPushSubscriptions();
    const target = all.find((sub) => sub.endpoint === endpoint);
    if (!target) return true;
    const r = getRedis();
    await r.srem(PUSH_SUBS_KEY, JSON.stringify(target));
    return true;
  } catch (err) {
    return false;
  }
}

async function getPushSubscriptions() {
  try {
    const r = getRedis();
    const rows = await r.smembers(PUSH_SUBS_KEY);
    return rows
      .map((row) => {
        try { return JSON.parse(row); } catch (e) { return null; }
      })
      .filter(Boolean);
  } catch (err) {
    return [];
  }
}

const NADIR_PUSH_LAST_KEY = 'nadir_push:last_at';

async function getNadirPushLastAt() {
  try {
    const r = getRedis();
    return await r.get(NADIR_PUSH_LAST_KEY);
  } catch (err) {
    return null;
  }
}

async function setNadirPushLastAt(iso) {
  try {
    const r = getRedis();
    await r.set(NADIR_PUSH_LAST_KEY, iso);
  } catch (err) {
    // ignore
  }
}

const NADIR_TRAIL_KEY = 'nadir:trail_json';
const NADIR_TRAIL_MAX_MS = 14 * 24 * 60 * 60 * 1000;

async function recordNadirFromScan(signals) {
  if (!Array.isArray(signals) || !signals.length) return;
  try {
    const r = getRedis();
    let trail = {};
    const raw = await r.get(NADIR_TRAIL_KEY);
    if (raw) trail = JSON.parse(raw);
    const nowIso = new Date().toISOString();
    for (const s of signals) {
      const sc = s.firsatSkoru?.skor;
      if (sc == null || sc < 80 || !s.symbol) continue;
      const prev = trail[s.symbol] || {};
      trail[s.symbol] = {
        maxSkor: Math.max(prev.maxSkor || 0, sc),
        lastSkor: sc,
        lastSeen: nowIso,
        hits: (prev.hits || 0) + 1,
        firstSeen: prev.firstSeen || nowIso
      };
    }
    await r.set(NADIR_TRAIL_KEY, JSON.stringify(trail));
  } catch (err) {
    console.error('recordNadirFromScan:', err.message);
  }
}

async function getNadirTrail() {
  try {
    const r = getRedis();
    const raw = await r.get(NADIR_TRAIL_KEY);
    let trail = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    const pruned = {};
    for (const [sym, v] of Object.entries(trail)) {
      const t = new Date(v.lastSeen).getTime();
      if (!Number.isFinite(t) || now - t > NADIR_TRAIL_MAX_MS) continue;
      pruned[sym] = v;
    }
    if (Object.keys(pruned).length !== Object.keys(trail).length) {
      await r.set(NADIR_TRAIL_KEY, JSON.stringify(pruned));
    }
    return pruned;
  } catch (err) {
    return {};
  }
}

function getStorageInfo() {
  const redis = !!process.env.REDIS_URL;
  return {
    persistent: redis,
    backend: redis ? 'redis' : 'memory',
    hint: redis
      ? 'Başarı istatistikleri Redis üzerinde kalıcıdır.'
      : 'Redis yok — başarı sayaçları sunucu RAM’inde; deploy veya restart sonrası sıfırlanır. Railway’e Redis eklersen kalıcı olur.'
  };
}

/** Genel push/alert meta (F&G snapshot, alış bandı cooldown vb.) */
async function getAlertMeta(key) {
  try {
    const r = getRedis();
    return await r.get(`alert:meta:${key}`);
  } catch (err) {
    return null;
  }
}

async function setAlertMeta(key, value) {
  try {
    const r = getRedis();
    await r.set(`alert:meta:${key}`, String(value));
  } catch (err) {
    /* ignore */
  }
}

module.exports = {
  saveSignal,
  updateSignalResult,
  getLearningData,
  getStats,
  getTierPerformance,
  listPendingSignals,
  savePushSubscription,
  removePushSubscription,
  getPushSubscriptions,
  getNadirPushLastAt,
  setNadirPushLastAt,
  recordNadirFromScan,
  getNadirTrail,
  getStorageInfo,
  getAlertMeta,
  setAlertMeta
};