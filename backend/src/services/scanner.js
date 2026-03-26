const binance        = require('./binance');
const indicators     = require('../indicators');
const memory         = require('./memory');
const aiAnalyzer     = require('./aiAnalyzer');
const autoResolver   = require('./autoResolver');
const { getFootprintDelta } = require('../indicators/footprint');
const { calcArbitraj }      = require('../indicators/arbitraj');
const { calcFirsatSkoru }   = require('../indicators');
const { CONFIG } = require('./scanner/config');
const { analyzeOrderBook } = require('./scanner/orderBook');
const {
  getMultiTimeframe,
  getTimeframeDirections,
  hasDirectionConflict
} = require('./scanner/timeframes');
const {
  resolveRegime,
  calculateExtraScore,
  applyAnomalyPenalty
} = require('./scanner/scoring');
const { buildDiagnostics } = require('./scanner/diagnostics');
const { estimateTargetHorizon } = require('../indicators/targetHorizon');

let lastSignals = [];
let liveSignals = [];
let subscribers = [];
let isScanning  = false;
let allCoins    = [];
let scanState = {
  isScanning: false,
  totalCoins: 0,
  scannedCoins: 0,
  signalCount: 0,
  startedAt: null,
  updatedAt: null,
  etaSeconds: 0
};

async function scanSingle(coin, sentiment) {
  try {
    const tf = await getMultiTimeframe(coin.pair, { binance, indicators });
    if (!tf.h1 || !tf.h4) return null;

    const dirs = getTimeframeDirections(tf);
    if (hasDirectionConflict(dirs)) return null;

    // Order book + ticker + footprint + arbitraj paralel
    const [depth, ticker, footprint] = await Promise.all([
      binance.getOrderBook(coin.pair),
      binance.get24hTicker(coin.pair),
      getFootprintDelta(coin.pair)
    ]);

    const orderBook      = analyzeOrderBook(depth);
    const priceChange24h = ticker ? parseFloat(ticker.priceChangePercent) : 0;
    const diagnostics    = buildDiagnostics({ tf, orderBook });

    // Arbitraj (sadece BTC, ETH, BNB, SOL için — rate limit koruması)
    const majorCoins = ['BTC','ETH','BNB','SOL','XRP','ADA','AVAX','DOT'];
    let arbitraj = null;
    if (majorCoins.includes(coin.symbol)) {
      arbitraj = await calcArbitraj(coin.pair, tf.h1.lastClose, await binance.getUSDTRY());
    }

    // Rejim
    const { regime, regimeScore } = resolveRegime(tf, priceChange24h);
    let extraScore = calculateExtraScore({ sentiment, dirs, tf, footprint, arbitraj, orderBook, regimeScore });

    // Anomali cezası
    const anomalyAdjusted = applyAnomalyPenalty(tf, extraScore);
    if (anomalyAdjusted.reject) {
      console.log(`ANOMALİ [MANIP] ${coin.pair}: Z=${tf.h1.anomaly.zScore}`);
      return null;
    }
    extraScore = anomalyAdjusted.extraScore;

    const netScore = (tf.h1.score||0) + dirs.mtfScore + extraScore + dirs.momentumBoost;
    if (netScore < CONFIG.MIN_SCORE) return null;

    const learningData = await memory.getLearningData(coin.symbol);

    const signal = {
      symbol:         coin.pair,
      currency:       'USDT',
      lastClose:      tf.h1.lastClose,
      score:          netScore,
      score1h:        tf.h1.score,
      score4h:        tf.h4?.score,
      score15m:       tf.m15?.score,
      score1d:        tf.d1?.score,
      mtfKonfirm: dirs.mtfKonfirm, mtfDetay:{ dir15m:dirs.dir15m,dir1h:dirs.dir1h,dir4h:dirs.dir4h,dir1d:dirs.dir1d,allAligned:dirs.allAligned,momentumBoost:dirs.momentumBoost },
      regime:         { type:regime, regimeScore },
      overallSignal:  tf.h1.overallSignal,
      signalStrength: tf.h1.signalStrength,
      signals:        tf.h1.signals,
      atr:            tf.h1.atr,
      supportResistance: tf.h1.supportResistance,
      fibonacci:      tf.h1.fibonacci,
      volume:         tf.h1.volume,
      divergence:     tf.h1.divergence,
      candlePatterns: tf.h1.candlePatterns,
      vwap:           tf.h1.vwap,
      volumeProfile:  tf.h1.volumeProfile,
      anomaly:        tf.h1.anomaly,
      fvg:            tf.h1.fvg,
      footprint,
      arbitraj,
      orderBook,
      rsi:            tf.h1.rsi,
      trend:          tf.h1.trend,
      stochRSI:       tf.h1.stochRSI,
      macd:           tf.h1.macd,
      bollinger:      tf.h1.bollinger,
      sentiment, priceChange24h,
      diagnostics,
      isHighPotential: (tf.h1.atr?.tp3Pct||0) >= 5,
      learningData,
      scannedAt: new Date().toISOString()
    };

    signal.horizon = estimateTargetHorizon({
      tp1Pct: signal.atr?.tp1Pct,
      tp2Pct: signal.atr?.tp2Pct,
      tp3Pct: signal.atr?.tp3Pct,
      atrPercent: signal.atr?.atrPercent,
      allAligned: signal.mtfDetay?.allAligned,
      regimeType: signal.regime?.type,
      priceChange24h: signal.priceChange24h
    });

    const aiResult = await aiAnalyzer.analyzeSignal(signal, learningData);
    signal.ai = aiResult;

    if (aiResult.manipulationRisk >= 8) {
      console.log(`AI MANİP [${coin.pair}]: ${aiResult.manipulationRisk}/10`);
      return null;
    }

    // Fırsat Skoru hesapla
    const firsatSkoru = calcFirsatSkoru(signal);
    signal.firsatSkoru = firsatSkoru;
    signal.usdTryRate  = await binance.getUSDTRY();

    if (firsatSkoru.skor < CONFIG.MIN_FIRSAT) return null;

    const signalKey = await memory.saveSignal(signal);
    signal.memoryKey = signalKey;

    console.log(`✅ ${coin.pair}: Skor=${netScore} Fırsat=${firsatSkoru.skor} ${firsatSkoru.emoji} ${firsatSkoru.seviye}`);
    return signal;

  } catch (err) {
    console.log(`HATA ${coin.pair}: ${err.message}`);
    return null;
  }
}

async function scanMarket() {
  if (isScanning) { console.log('Tarama devam ediyor...'); return getLatestSignals(); }
  isScanning = true;
  const start = Date.now();
  console.log(`Tarama basladi — ${allCoins.length} coin`);
  scanState = {
    isScanning: true,
    totalCoins: allCoins.length,
    scannedCoins: 0,
    signalCount: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    etaSeconds: 0,
    phase: 'starting'
  };
  liveSignals = [];
  broadcast({
    type: 'scan_progress',
    data: [],
    scan: { ...scanState },
    time: new Date().toISOString()
  });

  const sentiment = await binance.getFearGreed();
  console.log(`Fear&Greed: ${sentiment.value} (${sentiment.label})`);
  scanState.phase = 'scanning';
  scanState.updatedAt = new Date().toISOString();

  const results = [];
  for (let i = 0; i < allCoins.length; i++) {
    const result = await scanSingle(allCoins[i], sentiment);
    if (result) results.push({ ...result, _idx: results.length });
    scanState.scannedCoins = i + 1;
    scanState.signalCount = results.length;
    scanState.updatedAt = new Date().toISOString();
    const progressEvery = (i + 1) % 2 === 0 || i === 0 || i + 1 === allCoins.length;
    if (progressEvery) {
      const e=Math.round((Date.now()-start)/1000);
      const eta=i+1<allCoins.length?Math.round((e/(i+1))*(allCoins.length-i-1)):0;
      scanState.etaSeconds = eta;
      const partial = [...results].sort((a,b) => (b.firsatSkoru?.skor||0) - (a.firsatSkoru?.skor||0));
      liveSignals = partial;
      console.log(`Tarandi: ${i+1}/${allCoins.length} — Sinyal: ${results.length} — ${e}s${eta>0?' — Kalan: ~'+eta+'s':''}`);
      broadcast({
        type: 'scan_progress',
        data: partial.slice(0, 100),
        scan: { ...scanState },
        time: new Date().toISOString()
      });
    }
    await binance.bekle(CONFIG.SCAN_DELAY_MS);
  }

  // Fırsat skoruna göre sırala
  results.sort((a,b) => (b.firsatSkoru?.skor||0) - (a.firsatSkoru?.skor||0));

  const totalTime = Math.round((Date.now()-start)/1000);
  lastSignals = results;
  liveSignals = results;
  isScanning  = false;
  scanState = {
    ...scanState,
    isScanning: false,
    phase: 'done',
    scannedCoins: allCoins.length,
    signalCount: results.length,
    etaSeconds: 0,
    updatedAt: new Date().toISOString()
  };
  broadcast({ type:'scan_complete', data:results, scan:{ ...scanState }, time:new Date().toISOString() });

  const nadir  = results.filter(r=>r.firsatSkoru?.skor>=80).length;
  const guclu  = results.filter(r=>r.firsatSkoru?.skor>=65).length;
  const div    = results.filter(r=>r.divergence?.bullish||r.divergence?.hidden_bullish).length;
  const fvg    = results.filter(r=>r.fvg?.inBullishFVG).length;
  const arb    = results.filter(r=>r.arbitraj?.isOpportunity).length;

  console.log(`Tarama tamamlandi — ${results.length} sinyal — ${totalTime}s`);
  console.log(`🔥 Nadir=${nadir} ✅ Güçlü=${guclu} | Divergence=${div} FVG=${fvg} Arbitraj=${arb}`);
  const afterResolve = await autoResolver.resolvePendingSignals();
  if (afterResolve.resolved > 0) {
    console.log(`AutoResolver (bitis): ${afterResolve.resolved}/${afterResolve.checked} sinyal kapatildi`);
  }
  return results;
}

async function startAutoScan() {
  allCoins = await binance.getTRYCoins();
  console.log(`Otomatik tarama — her ${CONFIG.SCAN_INTERVAL_MS/60000} dk`);
  setTimeout(() => {
    scanMarket();
    setInterval(scanMarket, CONFIG.SCAN_INTERVAL_MS);
  }, 10000);
}

function subscribe(cb)    { subscribers.push(cb); }
function broadcast(data)  { subscribers.forEach(cb => cb(data)); }
function getLastSignals() { return lastSignals; }
function getLatestSignals() { return isScanning ? liveSignals : lastSignals; }
function getScanState() { return { ...scanState }; }

module.exports = { scanMarket, getLastSignals, getLatestSignals, getScanState, startAutoScan, subscribe };