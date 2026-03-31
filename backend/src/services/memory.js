// Redis Hafıza Katmanı
// Sinyal geçmişi + öğrenme verisi

const Redis = require('ioredis');

let redis = null;

function createInMemoryRedis() {
  const cache = new Map();
  return {
    get: async (k) => cache.get(k) || null,
    set: async (k, v) => {
      cache.set(k, v);
      return 'OK';
    },
    lpush: async (k, v) => {
      const arr = cache.get(k) || [];
      arr.unshift(v);
      cache.set(k, arr);
      return arr.length;
    },
    lrange: async (k, start, stop) => {
      const arr = cache.get(k) || [];
      const s = Number.isFinite(start) ? start : 0;
      const e = Number.isFinite(stop) ? stop : arr.length - 1;
      return arr.slice(s, e + 1);
    },
    llen: async (k) => {
      const arr = cache.get(k) || [];
      return arr.length;
    },
    incr: async (k) => {
      const v = (parseInt(cache.get(k), 10) || 0) + 1;
      cache.set(k, String(v));
      return v;
    },
    sadd: async (k, v) => {
      const set = cache.get(k) || new Set();
      set.add(v);
      cache.set(k, set);
      return set.size;
    },
    srem: async (k, v) => {
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

function getRedis() {
  if (!redis) {
    redis = process.env.REDIS_URL
      ? new Redis(process.env.REDIS_URL)
      : createInMemoryRedis();
  }
  return redis;
}

// ── SİNYAL KAYDET ───────────────────────────
async function saveSignal(signal) {
  try {
    const r   = getRedis();
    const key = `signal:${signal.symbol}:${Date.now()}`;
    const sitParts = partsFromSignalDetail({
      firsatSkoru: signal.firsatSkoru,
      firsatSkor: signal.firsatSkor,
      regime: signal.regime,
      divergence: signal.divergence,
      score: signal.score
    });
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
      tp1Pct:        signal.atr?.tp1Pct ?? null,
      tp2Pct:        signal.atr?.tp2Pct ?? null,
      tp3Pct:        signal.atr?.tp3Pct ?? null,
      stopLossPct:   signal.atr?.stopLossPct ?? null,
      quality:       signal.quality?.grade,
      patterns:      signal.candlePatterns?.patterns?.map(p => p.name),
      divergence:    signal.divergence,
      regime:        signal.regime?.type,
      situationKeyExact: sitParts ? keyExact(sitParts) : null,
      situationKeyRelaxed: sitParts ? keyRelaxed(sitParts) : null,
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

/** Rapor / API: genel sayaçlar + kuyruk boyu (hafif; tam tarama yanıtına eklenebilir). */
async function getPerformanceSnapshot() {
  let historyListLength = 0;
  try {
    const r = getRedis();
    historyListLength = await r.llen('signals:history');
  } catch (_) {
    historyListLength = 0;
  }
  const stats = await getStats();
  return {
    stats,
    historyListLength: Number.isFinite(historyListLength) ? historyListLength : 0,
    noteTr:
      'Tahtaya giren her sinyal tam taramada Redis’e yazılır (BEKLIYOR). Canlı fiyat TP1/TP2/TP3 veya SL’yi kestiğinde kayıt kapanır; sayaçlar ve dilim tabloları buna göre güncellenir. Motor çoğunlukla long yapı arar; ekrandaki yükseliş özetleri “otomatik yön” değil — gerçek başarı oranı aşağıdaki kapanmış kayıtlardan türetilir.'
  };
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

// ── DURUM PROFİLİ → GEÇMİŞ BAŞARI (Redis signals:history) ─────────────

function firsatBand(fs) {
  const n = Number(fs);
  if (!Number.isFinite(n)) return 'FX';
  if (n >= 80) return 'F80';
  if (n >= 65) return 'F65';
  if (n >= 50) return 'F50';
  if (n >= 35) return 'F35';
  return 'FLO';
}

function scoreTier(sc) {
  const n = Number(sc);
  if (!Number.isFinite(n)) return 'SX';
  if (n >= 14) return 'S3';
  if (n >= 9) return 'S2';
  if (n >= 5) return 'S1';
  return 'S0';
}

function divClass(d) {
  if (!d || typeof d !== 'object') return 'DN';
  if (d.bullish) return 'DB';
  if (d.hidden_bullish) return 'DH';
  if (d.bearish) return 'RB';
  if (d.hidden_bearish) return 'RH';
  return 'DN';
}

function regimeNorm(r) {
  const s = String(r == null ? 'UNK' : r).replace(/\|/g, '').trim().slice(0, 24);
  return s || 'UNK';
}

function partsFromSignalDetail(s) {
  if (!s || typeof s !== 'object') return null;
  const fs = s.firsatSkoru?.skor ?? s.firsatSkor;
  const reg = s.regime?.type ?? s.regime;
  return {
    band: firsatBand(fs),
    regime: regimeNorm(reg),
    div: divClass(s.divergence),
    stk: scoreTier(s.score)
  };
}

function partsFromHistoryRow(h) {
  if (!h || typeof h !== 'object') return null;
  return {
    band: firsatBand(h.firsatSkor),
    regime: regimeNorm(h.regime),
    div: divClass(h.divergence),
    stk: scoreTier(h.score)
  };
}

function keyExact(p) {
  if (!p) return '';
  return `${p.band}|${p.regime}|${p.div}|${p.stk}`;
}

function keyRelaxed(p) {
  if (!p) return '';
  return `${p.band}|${p.regime}|${p.div}`;
}

function parseSymbolFromHistoryKey(key) {
  const m = String(key || '').match(/^signal:([^:]+):/);
  return m ? m[1].toUpperCase() : null;
}

function emptyBucket() {
  return {
    matched: 0,
    pending: 0,
    resolved: 0,
    success: 0,
    fail: 0,
    manuel: 0
  };
}

function bumpBucket(bucket, h) {
  bucket.matched += 1;
  const res = h.result;
  if (res === 'BEKLIYOR') {
    bucket.pending += 1;
    return;
  }
  if (res === 'MANUEL') {
    bucket.manuel += 1;
    return;
  }
  if (!['TP1', 'TP2', 'TP3', 'SL'].includes(res)) return;
  bucket.resolved += 1;
  if (res === 'SL') bucket.fail += 1;
  else bucket.success += 1;
}

function finalizeBucket(b) {
  const rate =
    b.resolved > 0 ? parseFloat(((b.success / b.resolved) * 100).toFixed(1)) : null;
  return {
    ...b,
    successRatePct: rate
  };
}

function describeSituationTr(p) {
  if (!p) return '';
  const bandL = {
    F80: 'Fırsat 80+',
    F65: 'Fırsat 65–79',
    F50: 'Fırsat 50–64',
    F35: 'Fırsat 35–49',
    FLO: 'Fırsat 35 altı',
    FX: 'Fırsat bilinmiyor'
  };
  const divL = {
    DB: 'Bullish uyumsuzluk',
    DH: 'Gizli bullish uyumsuzluk',
    RB: 'Bearish uyumsuzluk',
    RH: 'Gizli bearish uyumsuzluk',
    DN: 'Belirgin uyumsuzluk yok'
  };
  const stkL = {
    S3: 'Net skor 14+',
    S2: 'Net skor 9–13',
    S1: 'Net skor 5–8',
    S0: 'Net skor 5 altı',
    SX: 'Skor bilinmiyor'
  };
  return [
    bandL[p.band] || p.band,
    `rejim: ${p.regime}`,
    divL[p.div] || p.div,
    stkL[p.stk] || p.stk
  ].join(' · ');
}

/**
 * Kayıtlı sinyal geçmişinde (tüm pariteler) aynı “durum profili”ne yakın kayıtları sayar.
 * Eski kayıtlarda MTF / birleşik senaryo tutulmadığı için eşleşme: fırsat bandı + rejim + uyumsuzluk sınıfı + skor kademesi.
 */
async function getSituationOutcomeStats(signalDetail, opts = {}) {
  const maxItems = Number.isFinite(opts.historyLimit)
    ? Math.max(100, Math.min(opts.historyLimit, 8000))
    : Math.max(200, Math.min(parseInt(process.env.SITUATION_STATS_HISTORY_LIMIT, 10) || 3500, 8000));

  const parts = partsFromSignalDetail(signalDetail);
  if (!parts) {
    return {
      ok: false,
      reason: 'NO_SIGNAL_DETAIL',
      note: 'Analiz gövdesi yok; durum istatistiği hesaplanamadı.'
    };
  }

  const kEx = keyExact(parts);
  const kRel = keyRelaxed(parts);
  const sym = String(signalDetail.symbol || '')
    .toUpperCase()
    .replace(/\s+/g, '');
  const symNorm = sym.endsWith('USDT') ? sym : sym ? `${sym}USDT` : '';

  const gEx = emptyBucket();
  const gRel = emptyBucket();
  const sEx = emptyBucket();
  const sRel = emptyBucket();

  try {
    const r = getRedis();
    const keys = await r.lrange('signals:history', 0, maxItems);

    for (const redisKey of keys) {
      const raw = await r.get(redisKey);
      if (!raw) continue;
      let h;
      try {
        h = JSON.parse(raw);
      } catch (_) {
        continue;
      }
      const hp = partsFromHistoryRow(h);
      if (!hp) continue;

      const exHist = h.situationKeyExact || keyExact(hp);
      const relHist = h.situationKeyRelaxed || keyRelaxed(hp);

      const rowSym = parseSymbolFromHistoryKey(redisKey);
      const sameCoin = symNorm && rowSym === symNorm;

      if (exHist === kEx) {
        bumpBucket(gEx, h);
        if (sameCoin) bumpBucket(sEx, h);
      }
      if (relHist === kRel) {
        bumpBucket(gRel, h);
        if (sameCoin) bumpBucket(sRel, h);
      }
    }

    const useExactPrimary = gEx.resolved >= 5;
    const primaryBucket = finalizeBucket(useExactPrimary ? gEx : gRel);
    const primaryLabel = useExactPrimary
      ? 'Tam profil (fırsat bandı + rejim + uyumsuzluk + net skor kademesi)'
      : 'Genişletilmiş profil (aynı fırsat bandı, rejim ve uyumsuzluk; skor kademesi dahil değil)';

    let primarySummaryTr;
    if (primaryBucket.resolved > 0) {
      primarySummaryTr = `Bu profile yakın ${primaryBucket.resolved} kapanmış sinyal: ${primaryBucket.success} başarılı (TP1–3), ${primaryBucket.fail} stop — başarı oranı %${primaryBucket.successRatePct}.`;
    } else if (primaryBucket.matched > 0) {
      primarySummaryTr = `Eşleşen ${primaryBucket.matched} kayıt var; henüz yeterli TP/SL kapanışı yok (${primaryBucket.pending} bekliyor${primaryBucket.manuel ? `, ${primaryBucket.manuel} manuel` : ''}).`;
    } else {
      primarySummaryTr = 'Geçmiş listede bu profile yakın kayıt bulunamadı (örneklem yok).';
    }

    return {
      ok: true,
      historyScanned: keys.length,
      profile: {
        keyExact: kEx,
        keyRelaxed: kRel,
        parts,
        descriptionTr: describeSituationTr(parts)
      },
      note:
        'Geçmiş kayıtlar yalnızca tahtaya düşen sinyallerden oluşur; BEKLIYOR ve MANUEL sonuçlar başarı oranına dahil edilmez. Küçük örneklemde oran anlamlı olmayabilir; geleceği garanti etmez.',
      global: {
        exact: finalizeBucket(gEx),
        relaxed: finalizeBucket(gRel)
      },
      sameSymbol: symNorm
        ? {
            symbol: symNorm,
            exact: finalizeBucket(sEx),
            relaxed: finalizeBucket(sRel)
          }
        : null,
      primary: {
        mode: useExactPrimary ? 'exact' : 'relaxed',
        label: primaryLabel,
        stats: primaryBucket,
        summaryTr: primarySummaryTr
      }
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'READ_ERROR',
      error: err.message,
      note: 'Geçmiş okunamadı.'
    };
  }
}

module.exports = {
  saveSignal,
  updateSignalResult,
  getLearningData,
  getStats,
  getPerformanceSnapshot,
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
  setAlertMeta,
  getSituationOutcomeStats
};