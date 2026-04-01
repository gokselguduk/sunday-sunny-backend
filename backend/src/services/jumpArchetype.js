/**
 * Tüm TR USDT-M paritelerinde, seçilen günlük sıçrama eşiğini geçen günlerin
 * hemen öncesindeki 5 işlem günü profillerinden küresel arketip çıkarır;
 * şu anki son 5 günü bu arketipe yakın olanları sıralar.
 * Geçmişteki benzer profillerde görülen sıçrama büyüklüğünün medyanı "vaat" metriği olarak verilir (garanti değildir).
 */
const binance = require('./binance');

const CACHE_MS = Number(process.env.JUMP_ARCHETYPE_CACHE_MS) || 3 * 60 * 60 * 1000;
const BETWEEN_MS = Number(process.env.WINNER_PATTERN_DELAY_MS) || 380;
const LOOKBACK_DAYS = Math.min(
  1500,
  Math.max(180, Math.floor(Number(process.env.JUMP_ARCHETYPE_LOOKBACK_DAYS || process.env.WINNER_PATTERN_LOOKBACK_DAYS) || 730))
);
/** Tek günlük kapanış hareketi bu oranın üstündeyse "sıçrama" sayılır (varsayılan %40 büyük günlük sıçramalar). */
const SPIKE_MIN_DAY_PCT = Math.min(95, Math.max(5, Number(process.env.JUMP_ARCHETYPE_MIN_DAY_PCT) || 40));
const SIM_DIST_SCALE = Math.max(3.2, Math.min(6, Number(process.env.JUMP_ARCHETYPE_SIM_DIST_SCALE) || 4.2));
const MIN_SIMILARITY = Math.min(95, Math.max(52, Number(process.env.JUMP_ARCHETYPE_MIN_SIMILARITY) || 62));
const MIN_STRUCTURAL_HITS = Math.min(5, Math.max(1, Number(process.env.JUMP_ARCHETYPE_MIN_HITS) || 2));
const HIGH_SIM_ESCAPE = Math.min(92, Math.max(70, Number(process.env.JUMP_ARCHETYPE_HIGH_SIM_ESCAPE) || 72));
const MAX_LISTED = Math.min(60, Math.max(6, Number(process.env.JUMP_ARCHETYPE_MAX_MATCHES) || 22));
/** Canlı sıralama için havuz çarpanı (önce benzerlikle alınır, sonra 24s veriyle sıralanır). */
const LIVE_POOL_MULT = Math.min(5, Math.max(1, Math.floor(Number(process.env.JUMP_ARCHETYPE_LIVE_POOL_MULT) || 3)));
const MIN_TRAINING_SAMPLES = Math.max(12, Math.floor(Number(process.env.JUMP_ARCHETYPE_MIN_SAMPLES) || 24));
const PROMISE_PEER_SIM_GAP = Math.min(25, Math.max(5, Number(process.env.JUMP_ARCHETYPE_PROMISE_GAP) || 14));

const caches = {
  default: { at: 0, payload: null },
  bigspike: { at: 0, payload: null }
};

function median(arr) {
  const a = [...arr].filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function percentile(arr, p) {
  const a = [...arr].filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const idx = Math.min(a.length - 1, Math.max(0, Math.floor((p / 100) * (a.length - 1))));
  return a[idx];
}

function stdDev(arr) {
  const a = arr.filter((x) => Number.isFinite(x));
  if (a.length < 2) return 1;
  const mu = a.reduce((s, x) => s + x, 0) / a.length;
  const v = a.reduce((s, x) => s + (x - mu) ** 2, 0) / a.length;
  return Math.sqrt(v) || 1;
}

function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gains += ch;
    else losses -= ch;
  }
  let avgG = gains / period;
  let avgL = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function windowMetrics(candles, endIdx, winLen) {
  const startIdx = endIdx - winLen + 1;
  if (startIdx < 1 || endIdx >= candles.length) return null;
  let sumR = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const prev = candles[i - 1].close;
    if (!prev) return null;
    sumR += (candles[i].close - prev) / prev;
  }
  const meanRet = sumR / winLen;
  const base = candles[startIdx - 1].close;
  const cumRet = base > 0 ? (candles[endIdx].close - base) / base : 0;
  let sumRg = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const c = candles[i].close;
    if (!c) return null;
    sumRg += (candles[i].high - candles[i].low) / c;
  }
  const rangeAvg = sumRg / winLen;
  const volSlice = [];
  for (let j = Math.max(1, endIdx - 19); j <= endIdx; j++) {
    volSlice.push(candles[j].volume);
  }
  const medV = median(volSlice);
  const volRatio = medV > 0 ? candles[endIdx].volume / medV : 1;
  const closes = candles.slice(0, endIdx + 1).map((c) => c.close);
  const rsiEnd = calcRSI(closes, 14);
  return { meanRet, cumRet, rangeAvg, volRatio, rsiEnd };
}

/**
 * Sıçrama günü (indeks i): hacim / işlem / USDT hacmi — önceki 20 güne göre oranlar;
 * taker buy / volume = agresif alım payı (para girişi vekili, order flow değil).
 */
function spikeDayFlowMetrics(candles, spikeIdx) {
  if (spikeIdx < 21 || spikeIdx >= candles.length) return null;
  const c = candles[spikeIdx];
  if (!c || !Number.isFinite(c.volume) || c.volume <= 0) return null;

  const slice = [];
  for (let j = spikeIdx - 20; j < spikeIdx; j++) {
    const x = candles[j];
    if (x && Number.isFinite(x.volume) && x.volume > 0) {
      slice.push({
        vol: x.volume,
        trades: Number.isFinite(x.trades) ? x.trades : null,
        quote: Number.isFinite(x.quoteVolume) ? x.quoteVolume : null
      });
    }
  }
  if (slice.length < 10) return null;

  const medVol = median(slice.map((s) => s.vol));
  if (!(medVol > 0)) return null;

  const tradesArr = slice.map((s) => s.trades).filter((t) => Number.isFinite(t) && t > 0);
  const quoteArr = slice.map((s) => s.quote).filter((q) => Number.isFinite(q) && q > 0);
  const medTrades = tradesArr.length >= 10 ? median(tradesArr) : null;
  const medQuote = quoteArr.length >= 10 ? median(quoteArr) : null;

  const volRatioSpike = c.volume / medVol;
  const takerBuyRatioSpike =
    Number.isFinite(c.takerBuyBase) && c.volume > 0 ? c.takerBuyBase / c.volume : null;

  let tradesRatioSpike = null;
  if (medTrades > 0 && Number.isFinite(c.trades) && c.trades > 0) {
    tradesRatioSpike = c.trades / medTrades;
  }

  let quoteRatioSpike = null;
  if (medQuote > 0 && Number.isFinite(c.quoteVolume) && c.quoteVolume > 0) {
    quoteRatioSpike = c.quoteVolume / medQuote;
  }

  let sumTb = 0;
  let nTb = 0;
  for (let j = spikeIdx - 5; j < spikeIdx; j++) {
    const x = candles[j];
    if (x && Number.isFinite(x.volume) && x.volume > 0 && Number.isFinite(x.takerBuyBase)) {
      sumTb += x.takerBuyBase / x.volume;
      nTb++;
    }
  }
  const takerBuyRatioPre5dAvg = nTb > 0 ? sumTb / nTb : null;

  if (!Number.isFinite(volRatioSpike) || !Number.isFinite(takerBuyRatioSpike)) return null;

  return {
    volRatioSpike,
    takerBuyRatioSpike,
    tradesRatioSpike,
    quoteRatioSpike,
    takerBuyRatioPre5dAvg
  };
}

function statsFromProfiles(profiles) {
  const keys = ['meanRet', 'cumRet', 'rangeAvg', 'volRatio', 'rsiEnd'];
  const med = {};
  const sig = {};
  for (const k of keys) {
    med[k] = median(profiles.map((p) => p[k]));
    sig[k] = stdDev(profiles.map((p) => p[k]));
  }
  return { med, sig };
}

function similarityScore(vec, med, sig) {
  const keys = ['meanRet', 'cumRet', 'rangeAvg', 'volRatio', 'rsiEnd'];
  let sumSq = 0;
  let n = 0;
  for (const k of keys) {
    const sigma = sig[k] > 1e-12 ? sig[k] : 1;
    const z = (vec[k] - med[k]) / sigma;
    sumSq += z * z;
    n++;
  }
  const dist = Math.sqrt(sumSq / n);
  return Math.max(0, Math.min(100, Math.round(100 * (1 - Math.min(1, dist / SIM_DIST_SCALE)))));
}

function countStructuralHits(vec, med) {
  if (!vec || !med) return 0;
  let n = 0;
  const vC = vec.cumRet;
  const mC = med.cumRet;
  if (Number.isFinite(vC) && Number.isFinite(mC) && Math.abs(vC - mC) < Math.max(0.025, Math.abs(mC) * 0.5 + 0.012)) {
    n++;
  }
  if (vec.volRatio >= med.volRatio * 0.8) n++;
  if (vec.rsiEnd >= med.rsiEnd - 18 && vec.rsiEnd <= med.rsiEnd + 25) n++;
  if (vec.rangeAvg >= med.rangeAvg * 0.85) n++;
  if (vec.meanRet >= med.meanRet - 0.0025) n++;
  return n;
}

function hasMeaningfulRecentStructure(vec, med) {
  if (!vec || !med) return true;
  const flat =
    Math.abs(vec.cumRet) < 0.0025 &&
    vec.volRatio < 0.9 &&
    vec.rangeAvg < med.rangeAvg * 0.65 &&
    Math.abs(vec.meanRet) < 0.0009;
  return !flat;
}

function spikePromiseFromTraining(enriched, candidateSim) {
  const floor = candidateSim - PROMISE_PEER_SIM_GAP;
  const peers = enriched.filter((t) => t.simToArchetype >= floor);
  const returnsPct = peers.length >= 8 ? peers.map((t) => t.spikeReturn * 100) : enriched.map((t) => t.spikeReturn * 100);
  const m = median(returnsPct);
  const p75 = percentile(returnsPct, 75);
  const n = peers.length >= 8 ? peers.length : enriched.length;
  return {
    medianSpikePct: Math.round(m * 100) / 100,
    p75SpikePct: Math.round(p75 * 100) / 100,
    basedOnSamples: n
  };
}

function buildJumpRoleModelTr({ lookbackDays, spikePct, trainingN, flowN, pre5d, spikeDay }) {
  const a = pre5d;
  const s = spikeDay || {};
  const f2 = (x) => (x == null || !Number.isFinite(x) ? '—' : String(Math.round(x * 100) / 100));
  const f1 = (x) => (x == null || !Number.isFinite(x) ? '—' : String(Math.round(x * 10) / 10));
  const r4 = (x) => (x == null || !Number.isFinite(x) ? '—' : String(Math.round(x * 10000) / 10000));

  let txt = `ROL MODELİ — ≥%${spikePct} tek günlük sıçrama, ~${lookbackDays} gün gerçek veri\n\n`;
  txt += `A) Sıçramadan ÖNCE (son 5 işlem günü, ${trainingN} olayın teknik medyanı)\n`;
  txt += `• Günlük ort. getiri meanRet ${r4(a.meanRet)} · Kümülatif cumRet ${r4(a.cumRet)} · Mum genişliği rangeAvg ${r4(a.rangeAvg)}\n`;
  txt += `• Ön-gün hacim oranı (son gün / ~20g medyan) vol× ${f2(a.volRatio)} · RSI ${f1(a.rsiEnd)}\n\n`;

  if (!flowN || flowN < 8) {
    txt += `B) Sıçrama günü — hacim / agresif alım / USDT hacmi: yeterli tam kline örneği yok (${flowN || 0}/${trainingN}).\n`;
    txt += `C) Zincir üstü para akışı yok; vekil: taker buy + quote volume (Binance USDT-M günlük mum).`;
    return txt;
  }

  txt += `B) Sıçrama GÜNÜ (${flowN} olay medyanı; kıyas: sıçramadan önceki 20 işlem günü)\n`;
  txt += `• Baz hacim ≈ ${f2(s.volRatioVs20d)}× medyan — ilgi patlaması\n`;
  txt += `• USDT hacmi (quote) ≈ ${f2(s.quoteVolRatioVs20d)}× medyan\n`;
  txt += `• İşlem adedi ≈ ${f2(s.tradesRatioVs20d)}× medyan\n`;
  const tb = s.takerBuyRatio == null ? '—' : `${Math.round(s.takerBuyRatio * 1000) / 10}%`;
  const tb5 = s.pre5dTakerBuyRatioAvg == null ? '—' : `${Math.round(s.pre5dTakerBuyRatioAvg * 1000) / 10}%`;
  txt += `• Agresif alım payı (taker buy ÷ volume) sıçrama günü ≈ ${tb}; önceki 5 gün ort. ≈ ${tb5}\n`;
  if (s.takerBuyLiftVsPre5d != null && Number.isFinite(s.takerBuyLiftVsPre5d)) {
    const liftPct = Math.round(s.takerBuyLiftVsPre5d * 1000) / 10;
    txt += `• Sıçrama günü agresif alım, önceki 5 güne göre ortanca +${liftPct} puan (yüzde birimi)\n`;
  }
  txt += `\nC) Bu özet “rol model”dir; gelecek aynısı değildir. Delist/manipülasyon/haber fiyatı değiştirir.`;

  return txt;
}

function computeSpikeFollowThrough(candles, spikeIdx) {
  const out = { next1dUp: null, fwd5Pos: null };
  const cSpike = candles[spikeIdx]?.close;
  if (!Number.isFinite(cSpike) || cSpike <= 0) return out;
  if (spikeIdx + 1 < candles.length) {
    const c1 = candles[spikeIdx + 1].close;
    if (Number.isFinite(c1)) {
      out.next1dUp = (c1 - cSpike) / cSpike > 0;
    }
  }
  if (spikeIdx + 5 < candles.length) {
    const c5 = candles[spikeIdx + 5].close;
    if (Number.isFinite(c5)) {
      out.fwd5Pos = (c5 - cSpike) / cSpike > 0;
    }
  }
  return out;
}

function summarizeFollowThrough(stats) {
  const pct = (pos, n) => (n > 0 ? Math.round((pos / n) * 1000) / 10 : null);
  return {
    pctCloseHigherNextDay: pct(stats.next1d.pos, stats.next1d.n),
    sampleNextDay: stats.next1d.n,
    pctPositiveCum5dAfterSpike: pct(stats.fwd5.pos, stats.fwd5.n),
    sampleFwd5d: stats.fwd5.n
  };
}

function buildFollowThroughTr(ft, spikePct) {
  const a = ft.pctCloseHigherNextDay;
  const b = ft.pctPositiveCum5dAfterSpike;
  if (ft.sampleNextDay === 0 && ft.sampleFwd5d === 0) return '';
  return (
    `GEÇMİŞTE DEVAM (≥%${spikePct} sıçrama kapanışından sonra, aynı 2y veri — işlem başarısı değil)\n` +
    `• Ertesi işlem günü kapanışı, sıçrama günü kapanışının ÜSTÜNDE: %${a != null ? a : '—'} (örnek n=${ft.sampleNextDay})\n` +
    `• +5 işlem günü sonunda kümülatif getiri (sıçrama kapanışından) POZİTİF: %${b != null ? b : '—'} (örnek n=${ft.sampleFwd5d})\n` +
    `• Platformdaki TP1/2/3 “başarı oranı” bununla aynı değil; o oran yalnızca tahta sinyalleri Redis kayıtlarından üretilir.`
  );
}

function resolveJumpOpts(opts = {}) {
  const key = opts.cacheKey === 'bigspike' ? 'bigspike' : 'default';
  return {
    cacheKey: key,
    spikeMinDayPct: Math.min(
      95,
      Math.max(5, Number(opts.spikeMinDayPct) || SPIKE_MIN_DAY_PCT)
    ),
    minSimilarity: Math.min(95, Math.max(52, Number(opts.minSimilarity) || MIN_SIMILARITY)),
    minStructuralHits: Math.min(5, Math.max(1, Number(opts.minStructuralHits) || MIN_STRUCTURAL_HITS)),
    highSimEscape: Math.min(92, Math.max(70, Number(opts.highSimEscape) || HIGH_SIM_ESCAPE)),
    maxListed: Math.min(60, Math.max(3, Number(opts.maxListed) || MAX_LISTED)),
    livePoolMult: Math.min(5, Math.max(1, Math.floor(Number(opts.livePoolMult) || LIVE_POOL_MULT))),
    minTrainingSamples: Math.max(8, Math.floor(Number(opts.minTrainingSamples) || MIN_TRAINING_SAMPLES)),
    variant: opts.variant || (key === 'bigspike' ? 'bigspike' : 'default')
  };
}

function buildBigSpikeCard(c, archetype) {
  const f = c.features || {};
  const cum = Number.isFinite(f.cumRet5d) ? Math.round(f.cumRet5d * 10000) / 100 : null;
  const vr = f.volRatio != null ? Number(f.volRatio) : null;
  const ra = f.rangeAvg != null ? Number(f.rangeAvg) : null;
  let riseStyleTr =
    'Geçmiş büyük sıçramalarda bu profile yakın kurulumlar; tek günlük hamle veya birkaç gün süren trend birlikte görülebilir.';
  if (vr != null && ra != null && vr >= 1.35 && ra >= 0.1) {
    riseStyleTr =
      'Yüksek ön-gün hacim ve geniş günlük aralık — geçmişte sık: sert / patlamalı günlük hareket profiline yakın.';
  } else if (vr != null && vr >= 1.15) {
    riseStyleTr = 'Hacim tarafı güçlü — ilgi artışı ile uyumlu; yükseliş şekli yine de habere bağlıdır.';
  }
  const medSp = archetype?.historicalMedianSpikePct;
  const p75Sp = archetype?.historicalP75SpikePct;
  return {
    targetHorizonTr:
      'Kurulum günlük mumdadır; tipik yoğunluk çoğu zaman 24–72 saat bandında (kesin süre yok; borsa saatleri ve likiditeye bağlı).',
    targetMoveTr:
      medSp != null && p75Sp != null
        ? `Geçmiş benzer ön-profil olaylarında tek günlük sıçrama: medyan ~%${medSp}, üst çeyrek ~%${p75Sp} (vaat değil, dağılım özeti).`
        : 'Geçmiş benzer profillerdeki sıçrama büyüklüğü üstteki “vaat” sütunlarından okunur.',
    riseStyleTr,
    bulletsTr: [
      cum != null ? `Son 5 işlem günü kümülatif (yaklaşık): %${cum}` : null,
      c.spikePromisePct != null ? `Benzer geçmişte medyan sıçrama: ~%${c.spikePromisePct}` : null,
      c.live24hPct != null ? `Şu an 24s: %${c.live24hPct}` : null
    ].filter(Boolean)
  };
}

async function computeJumpArchetypeAnalysis(forceRefresh, opts = {}) {
  const cfg = resolveJumpOpts(opts);
  const cache = caches[cfg.cacheKey];
  const now = Date.now();
  if (!forceRefresh && cache.payload && now - cache.at < CACHE_MS) {
    return { ...cache.payload, cached: true };
  }

  const started = Date.now();
  const coins = await binance.getTRYCoins();
  const winLen = 5;
  const limit = Math.min(1500, LOOKBACK_DAYS + 40);
  const spikeTh = cfg.spikeMinDayPct / 100;

  /** @type {{symbol:string,profile:object,spikeReturn:number,simToArchetype?:number}[]} */
  const training = [];
  const bySymbol = new Map();
  const followStats = {
    next1d: { pos: 0, n: 0 },
    fwd5: { pos: 0, n: 0 }
  };

  for (const c of coins) {
    try {
      const candles = await binance.getOHLCV(c.pair, '1d', limit);
      if (!candles || candles.length < winLen + 8) {
        await binance.bekle(BETWEEN_MS);
        continue;
      }
      const endNow = candles.length - 1;
      const currentProfile = endNow >= winLen ? windowMetrics(candles, endNow, winLen) : null;
      bySymbol.set(c.pair, { candles, currentProfile });

      for (let i = 6; i < candles.length; i++) {
        const prev = candles[i - 1].close;
        if (!prev) continue;
        const r = (candles[i].close - prev) / prev;
        if (r < spikeTh) continue;
        const pre = windowMetrics(candles, i - 1, winLen);
        if (!pre) continue;
        const spikeFlow = spikeDayFlowMetrics(candles, i);
        const ft = computeSpikeFollowThrough(candles, i);
        if (ft.next1dUp !== null) {
          followStats.next1d.n++;
          if (ft.next1dUp) followStats.next1d.pos++;
        }
        if (ft.fwd5Pos !== null) {
          followStats.fwd5.n++;
          if (ft.fwd5Pos) followStats.fwd5.pos++;
        }
        training.push({ symbol: c.pair, profile: pre, spikeReturn: r, spikeFlow });
      }
    } catch (e) {
      /* atla */
    }
    await binance.bekle(BETWEEN_MS);
  }

  if (training.length < cfg.minTrainingSamples) {
    return {
      ok: false,
      error: 'Yetersiz örnek',
      detailTr: `Seçilen pencerede ve ≥%${cfg.spikeMinDayPct} günlük sıçrama eşiğinde yalnızca ${training.length} olay bulundu (minimum ${cfg.minTrainingSamples}). Eşiği veya BIG_SPIKE_* / JUMP_ARCHETYPE_MIN_DAY_PCT ile ayarlayın.`,
      trainingSamples: training.length,
      lookbackDays: LOOKBACK_DAYS,
      spikeMinDayPct: cfg.spikeMinDayPct
    };
  }

  const profiles = training.map((t) => t.profile);
  const { med, sig } = statsFromProfiles(profiles);
  const enriched = training.map((t) => ({
    ...t,
    simToArchetype: similarityScore(t.profile, med, sig)
  }));

  const allSpikePcts = enriched.map((t) => t.spikeReturn * 100);
  const globalMedianSpike = median(allSpikePcts);
  const globalP75Spike = percentile(allSpikePcts, 75);
  const uniqueSyms = new Set(enriched.map((t) => t.symbol)).size;

  const flowRows = training.map((t) => t.spikeFlow).filter(Boolean);
  const flowN = flowRows.length;
  const mFlow = (pick) => {
    const arr = flowRows.map(pick).filter((x) => Number.isFinite(x));
    return arr.length ? median(arr) : null;
  };
  const takerLifts = [];
  for (const t of training) {
    const f = t.spikeFlow;
    if (!f || !Number.isFinite(f.takerBuyRatioSpike) || !Number.isFinite(f.takerBuyRatioPre5dAvg)) continue;
    takerLifts.push(f.takerBuyRatioSpike - f.takerBuyRatioPre5dAvg);
  }
  const takerBuyLiftMedian = takerLifts.length ? median(takerLifts) : null;

  const mv = mFlow((f) => f.volRatioSpike);
  const mtb = mFlow((f) => f.takerBuyRatioSpike);
  const mtr = mFlow((f) => f.tradesRatioSpike);
  const mqt = mFlow((f) => f.quoteRatioSpike);
  const mpre = mFlow((f) => f.takerBuyRatioPre5dAvg);
  const spikeDayMedian = {
    volRatioVs20d: mv != null ? Math.round(mv * 100) / 100 : null,
    takerBuyRatio: mtb != null ? Math.round(mtb * 1000) / 1000 : null,
    tradesRatioVs20d: mtr != null ? Math.round(mtr * 100) / 100 : null,
    quoteVolRatioVs20d: mqt != null ? Math.round(mqt * 100) / 100 : null,
    pre5dTakerBuyRatioAvg: mpre != null ? Math.round(mpre * 1000) / 1000 : null,
    takerBuyLiftVsPre5d: takerBuyLiftMedian != null ? Math.round(takerBuyLiftMedian * 1000) / 1000 : null,
    sampleSize: flowN
  };

  const archetype = {
    median: {
      meanRet: Math.round(med.meanRet * 10000) / 10000,
      cumRet: Math.round(med.cumRet * 10000) / 10000,
      rangeAvg: Math.round(med.rangeAvg * 10000) / 10000,
      volRatio: Math.round(med.volRatio * 100) / 100,
      rsiEnd: Math.round(med.rsiEnd * 10) / 10
    },
    spikeDayMedian,
    trainingEvents: enriched.length,
    distinctPairs: uniqueSyms,
    spikeMinDayPct: cfg.spikeMinDayPct,
    historicalMedianSpikePct: Math.round(globalMedianSpike * 100) / 100,
    historicalP75SpikePct: Math.round(globalP75Spike * 100) / 100
  };

  const followThrough = summarizeFollowThrough(followStats);
  archetype.spikeFollowThrough = followThrough;
  const followThroughTr = buildFollowThroughTr(followThrough, cfg.spikeMinDayPct);

  const roleModelTr = buildJumpRoleModelTr({
    lookbackDays: LOOKBACK_DAYS,
    spikePct: cfg.spikeMinDayPct,
    trainingN: enriched.length,
    flowN,
    pre5d: archetype.median,
    spikeDay: spikeDayMedian
  });

  const roleModelFullTr = [roleModelTr, followThroughTr].filter(Boolean).join('\n\n');

  const narrativeTr =
    `Son **${LOOKBACK_DAYS} gün** ve **${uniqueSyms}** paritede toplam **${enriched.length}** adet günlük sıçrama (≥**%${cfg.spikeMinDayPct}** tek gün kapanış hareketi) tarandı. ` +
    `Her sıçramadan hemen önceki **5 işlem gününün** ortak özeti aşağıdaki teknik medyandır. ` +
    `Geçmişte bu havuzdaki sıçramaların tipik büyüklüğü: medyan **%${archetype.historicalMedianSpikePct}**, üst çeyrek **%${archetype.historicalP75SpikePct}**. ` +
    `Liste: şu anki son 5 günü bu küresel profile yakın olan pariteler; “vaat” sütunu, geçmişte benzer profile sahip olaylarda görülen sıçrama büyüklüğünün medyanıdır (gelecek garantisi değildir). Zaman: **günlük mum** — tanım gereği sıçrama, 5 günlük pencerenin **ertesi işlem gününde** ölçüldü.`;

  const horizonNoteTr =
    'Kurulum günlük mumdadır. Kartlardaki 24s % ve fiyat Binance USDT-M anlık ticker’dır; “potansiyel” skoru bu veri + profil benzerliğinin birleşimidir. Yatırım tavsiyesi değildir.';

  const peers = [];
  for (const [sym, row] of bySymbol.entries()) {
    const cp = row.currentProfile;
    if (!cp) continue;
    const sim = similarityScore(cp, med, sig);
    const hits = countStructuralHits(cp, med);
    const prom = spikePromiseFromTraining(enriched, sim);
    peers.push({
      symbol: sym,
      similarity: sim,
      structuralHits: hits,
      spikePromisePct: prom.medianSpikePct,
      spikePromiseP75Pct: prom.p75SpikePct,
      promiseSampleSize: prom.basedOnSamples,
      features: {
        meanRet5d: Math.round(cp.meanRet * 10000) / 10000,
        cumRet5d: Math.round(cp.cumRet * 10000) / 10000,
        rangeAvg: Math.round(cp.rangeAvg * 10000) / 10000,
        volRatio: Math.round(cp.volRatio * 100) / 100,
        rsi: Math.round(cp.rsiEnd * 10) / 10
      }
    });
  }

  peers.sort((a, b) => b.similarity - a.similarity);

  const poolLimit = Math.min(peers.length, Math.ceil(cfg.maxListed * cfg.livePoolMult));
  const pool = peers
    .filter((p) => p.similarity >= cfg.minSimilarity)
    .filter((p) => p.structuralHits >= cfg.minStructuralHits || p.similarity >= cfg.highSimEscape)
    .filter((p) => {
      const row = bySymbol.get(p.symbol);
      return hasMeaningfulRecentStructure(row?.currentProfile, med);
    })
    .slice(0, poolLimit);

  let tick24 = {};
  try {
    tick24 = await binance.getAllFutures24hTickers();
  } catch (e) {
    tick24 = {};
  }

  const withLive = pool.map((c) => {
    const t = tick24[c.symbol];
    const rawPct = t?.priceChangePercent;
    const p = Number(rawPct);
    const live24hPct = Number.isFinite(p) ? Math.round(p * 100) / 100 : null;
    const liveLastPrice = t?.lastPrice != null && Number.isFinite(Number(t.lastPrice)) ? Number(t.lastPrice) : null;
    const liveQuoteVol =
      t?.quoteVolume != null && Number.isFinite(Number(t.quoteVolume)) ? Number(t.quoteVolume) : null;
    const mom = live24hPct != null && Number.isFinite(live24hPct) ? Math.min(22, Math.max(0, live24hPct) * 0.22) : 0;
    const hits = Math.min(5, c.structuralHits || 0);
    const potentialBlend = Math.round(c.similarity * 0.58 + mom + hits * 1.35);
    return {
      ...c,
      live24hPct,
      liveLastPrice,
      liveQuoteVol,
      potentialBlend
    };
  });

  withLive.sort((a, b) => b.potentialBlend - a.potentialBlend);
  const candidates = withLive.slice(0, cfg.maxListed);

  const candidatesWithCards =
    cfg.variant === 'bigspike'
      ? candidates.map((c) => ({ ...c, card: buildBigSpikeCard(c, archetype) }))
      : candidates;

  const methodNoteTr =
    `Tüm TR USDT-M perpetual pariteleri taranır; tek gün kapanış getirisi ≥%${cfg.spikeMinDayPct} olan her gün “sıçrama” sayılır ve önceki 5 gün profili havuza eklenir. ` +
    'Günlük mumdan ayrıca quote volume, işlem sayısı ve taker buy (agresif alım) okunur; rol modeli bunların sıçrama günü medyanlarını özetler. ' +
    'Arketip medyan + sapmadır. Vaat: benzer geçmiş profillerdeki sıçrama büyüklüğünün medyanı. ' +
    'Liste sırası: Binance **24 saatlik** ticker + profil benzerliği (anlık; günlük modelle birlikte okunmalı).';

  const filterSummaryTr =
    `Ön süzgeç: benzerlik ≥%${cfg.minSimilarity}, yapı taşı ≥${cfg.minStructuralHits} (veya ≥%${cfg.highSimEscape}), yatay 5g elendi. ` +
    `Canlı sıralama: ${cfg.livePoolMult}× havuzdan en iyi ${cfg.maxListed} satır. Ortam: JUMP_ARCHETYPE_* / BIG_SPIKE_* .`;

  const alertBannerTr =
    cfg.variant === 'bigspike'
      ? candidatesWithCards.length > 0
        ? `${candidatesWithCards.length} parite ≥%${cfg.spikeMinDayPct} büyük sıçrama ön-profil arketipine yakın — kartlarda hedef süre / yükseliş özeti.`
        : `Şu an ≥%${cfg.spikeMinDayPct} modeline uygun aday yok veya filtreler sıkı.`
      : null;

  const payload = {
    ok: true,
    cached: false,
    updatedAt: new Date().toISOString(),
    lookbackDays: LOOKBACK_DAYS,
    symbolCount: bySymbol.size,
    durationMs: Date.now() - started,
    variant: cfg.variant,
    narrativeTr: narrativeTr.replace(/\*\*/g, ''),
    roleModelTr: roleModelFullTr,
    followThrough,
    followThroughTr,
    methodNoteTr,
    filterSummaryTr,
    horizonNoteTr,
    listFilters: {
      minSimilarity: cfg.minSimilarity,
      minStructuralHits: cfg.minStructuralHits,
      highSimilarityEscape: cfg.highSimEscape,
      maxMatches: cfg.maxListed,
      spikeMinDayPct: cfg.spikeMinDayPct
    },
    archetype,
    candidates: candidatesWithCards,
    alertActive: cfg.variant === 'bigspike' && candidatesWithCards.length > 0,
    alertBannerTr,
    note: 'Yatırım tavsiyesi değildir. Geçmiş dağılım geleceği göstermez; likidite ve haber fiyatı değiştirir.'
  };

  caches[cfg.cacheKey] = { at: Date.now(), payload };
  return payload;
}

async function computeBigSpikeWatchAnalysis(forceRefresh) {
  return computeJumpArchetypeAnalysis(forceRefresh, {
    cacheKey: 'bigspike',
    spikeMinDayPct: Math.min(90, Math.max(35, Number(process.env.BIG_SPIKE_MIN_DAY_PCT) || 50)),
    minSimilarity: Math.min(92, Math.max(50, Number(process.env.BIG_SPIKE_MIN_SIMILARITY) || 58)),
    minStructuralHits: Math.min(5, Math.max(1, Number(process.env.BIG_SPIKE_MIN_HITS) || 2)),
    highSimEscape: Math.min(92, Math.max(68, Number(process.env.BIG_SPIKE_HIGH_SIM_ESCAPE) || 72)),
    maxListed: Math.min(12, Math.max(3, Number(process.env.BIG_SPIKE_MAX_MATCHES) || 6)),
    livePoolMult: Math.min(4, Math.max(1, Math.floor(Number(process.env.BIG_SPIKE_LIVE_POOL_MULT) || 2))),
    minTrainingSamples: Math.max(10, Math.floor(Number(process.env.BIG_SPIKE_MIN_SAMPLES) || 18)),
    variant: 'bigspike'
  });
}

function getCachedBigSpikeWatch() {
  if (caches.bigspike.payload) return { ...caches.bigspike.payload, cached: true };
  return null;
}

function getCachedJumpArchetype() {
  if (caches.default.payload) return { ...caches.default.payload, cached: true };
  return null;
}

module.exports = {
  computeJumpArchetypeAnalysis,
  getCachedJumpArchetype,
  computeBigSpikeWatchAnalysis,
  getCachedBigSpikeWatch
};
