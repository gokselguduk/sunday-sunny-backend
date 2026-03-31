const binance        = require('./binance');
const indicators     = require('../indicators');
const memory         = require('./memory');
const autoResolver   = require('./autoResolver');
const { getFootprintDelta } = require('../indicators/footprint');
const { calcArbitraj }      = require('../indicators/arbitraj');
const { CONFIG } = require('./scanner/config');
const { analyzeOrderBook } = require('./scanner/orderBook');
const {
  getMultiTimeframe,
  getTimeframeDirections,
  hasDirectionConflict
} = require('./scanner/timeframes');
const { resolveRegime, applyAnomalyPenalty } = require('./scanner/scoring');
const { buildDiagnostics } = require('./scanner/diagnostics');
const { estimateTargetHorizon } = require('../indicators/targetHorizon');
const {
  buildKriptoAnaliz,
  deriveFirsatFromKriptoAnaliz,
  runnerFromKripto,
  aiOzetiFromKripto
} = require('./kriptoAnalizSistemi');
const { fetchMacroSnapshot } = require('./macroSnapshot');
const { fetchBtcOnChainSnapshot } = require('./onChainSnapshot');

/** Parite → son tam tarama sinyali (taramalar arası birleşik tahta) */
const signalRegistry = new Map();
/** Her USDT paritesi için son analiz özeti (eşik altı dahil); tarama turu arasında silinmez */
const listRegistry = new Map();

let lastSignals = [];
let liveSignals = [];
let subscribers = [];
let isScanning  = false;
let allCoins    = [];
let priceRefreshTimer = null;
let qualifiedThisScanRun = 0;
let lastPendingResolveAt = 0;

let scanState = {
  isScanning: false,
  totalCoins: 0,
  scannedCoins: 0,
  signalCount: 0,
  qualifiedThisScan: 0,
  boardFresh: 0,
  boardStale: 0,
  startedAt: null,
  updatedAt: null,
  etaSeconds: 0
};

function computeVsPreviousScan(prev, curr) {
  if (!prev) {
    return {
      isFirst: true,
      scoreDelta: null,
      firsatDelta: null,
      pricePctSinceLastScan: null,
      previousScannedAt: null
    };
  }
  const pf = prev.firsatSkoru?.skor;
  const cf = curr.firsatSkoru?.skor;
  return {
    isFirst: false,
    scoreDelta: curr.score - prev.score,
    firsatDelta:
      Number.isFinite(pf) && Number.isFinite(cf) ? Math.round(cf - pf) : null,
    pricePctSinceLastScan:
      prev.lastClose > 0
        ? parseFloat((((curr.lastClose - prev.lastClose) / prev.lastClose) * 100).toFixed(3))
        : null,
    previousScannedAt: prev.scannedAt || null
  };
}

function sortBoard(list) {
  return [...list].sort((a, b) => {
    const aFresh = !a.absentThisScan;
    const bFresh = !b.absentThisScan;
    if (aFresh !== bFresh) return aFresh ? -1 : 1;
    return (b.firsatSkoru?.skor || 0) - (a.firsatSkoru?.skor || 0);
  });
}

function buildSortedBoard() {
  return sortBoard([...signalRegistry.values()]);
}

function markEntireBoardAbsentThisScan() {
  for (const s of signalRegistry.values()) {
    s.absentThisScan = true;
  }
}

function purgeAbsentFromSignalRegistry() {
  for (const [pair, s] of [...signalRegistry.entries()]) {
    if (s.absentThisScan) signalRegistry.delete(pair);
  }
}

function buildCoinListSlim() {
  if (!allCoins.length) return [];
  return allCoins.map((c) => {
    const pair = c.pair;
    const row = listRegistry.get(pair);
    const onBoard = signalRegistry.has(pair);
    const base = c.symbol;
    if (!row || row.empty) {
      return {
        symbol: pair,
        base,
        onBoard,
        empty: true,
        lastClose: null,
        score: null,
        firsatSkor: null,
        overallSignal: null,
        priceChange24h: null,
        scannedAt: null,
        listReason: row?.listReason || null
      };
    }
    const detail = row.listDetail || row;
    return {
      symbol: pair,
      base,
      onBoard,
      empty: false,
      lastClose: detail.lastClose ?? null,
      score: detail.score ?? null,
      firsatSkor: detail.firsatSkoru?.skor ?? null,
      overallSignal: detail.overallSignal ?? null,
      signalStrength: detail.signalStrength ?? null,
      priceChange24h: detail.priceChange24h ?? null,
      scannedAt: detail.scannedAt || row.scannedAt || null,
      listReason: row.listReason || null,
      aiVerdict: detail.ai?.verdict ?? null,
      hasListDetail: !!(row.listDetail && !onBoard)
    };
  });
}

function boardStats(board) {
  let fresh = 0;
  let stale = 0;
  for (const s of board) {
    if (s.absentThisScan) stale += 1;
    else fresh += 1;
  }
  return { fresh, stale };
}

function normalizeScanPair(raw) {
  const x = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!x) return null;
  return x.endsWith('USDT') ? x : `${x}USDT`;
}

function baseSnapshot(coin, partial = {}) {
  return {
    symbol: coin.pair,
    base: coin.symbol,
    scannedAt: new Date().toISOString(),
    ...partial
  };
}

async function scanSingle(coin, sentiment, analizCtx = {}, opts = {}) {
  const saveHistory = opts.saveHistory !== false;
  try {
    const tf = await getMultiTimeframe(coin.pair, { binance, indicators });
    if (!tf.h1 || !tf.h4) {
      return {
        qualified: false,
        snapshot: baseSnapshot(coin, { listReason: 'MUM_VERI', lastClose: tf?.h1?.lastClose ?? null })
      };
    }

    const dirs = getTimeframeDirections(tf);
    if (hasDirectionConflict(dirs)) {
      return {
        qualified: false,
        snapshot: baseSnapshot(coin, {
          listReason: 'MTF_CELISKI',
          lastClose: tf.h1.lastClose,
          score1h: tf.h1.score,
          overallSignal: tf.h1.overallSignal,
          signalStrength: tf.h1.signalStrength,
          priceChange24h: 0
        })
      };
    }

    const [depth, ticker, footprint] = await Promise.all([
      binance.getOrderBook(coin.pair),
      binance.get24hTicker(coin.pair),
      getFootprintDelta(coin.pair)
    ]);

    const orderBookRaw = analyzeOrderBook(depth);
    const priceChange24h = ticker ? parseFloat(ticker.priceChangePercent) : 0;
    const usdTryRate = await binance.getUSDTRY();
    const tryBook = opts.tryBookMap?.[coin.symbol];
    const last = tf.h1.lastClose;
    let tryFactor = usdTryRate;
    let tryFrame = {
      factor: tryFactor,
      source: 'USDTTRY',
      spotPair: null,
      spotBidTry: null,
      spotAskTry: null,
      spotMidTry: null,
      noteTr:
        'Futures USDT seviyeleri USDT/TRY kuru ile TL’ye çevrildi. Bu parite için spot BASETRY kitabı yoksa kur kullanılır; kitap varsa orta fiyat (bid+ask)/2 ile ölçeklenir.',
      usdtTryRate: usdTryRate
    };
    if (tryBook?.mid > 0 && last > 0) {
      tryFactor = tryBook.mid / last;
      tryFrame = {
        factor: tryFactor,
        source: 'BINANCE_TRY',
        spotPair: tryBook.symbolTry || `${coin.symbol}TRY`,
        spotBidTry: tryBook.bid,
        spotAskTry: tryBook.ask,
        spotMidTry: tryBook.mid,
        noteTr:
          'Futures USDT fiyatları, Binance spot ' +
          (tryBook.symbolTry || `${coin.symbol}TRY`) +
          ' orta fiyatına göre TL’ye ölçeklendi. USDT-M derinlik bid/ask aynı çarpanla TL gösterilir.',
        usdtTryRate: usdTryRate
      };
    }
    const orderBook = { ...orderBookRaw };
    if (Number.isFinite(orderBook.buyWallPrice)) {
      orderBook.buyWallTry = orderBook.buyWallPrice * tryFactor;
    }
    if (Number.isFinite(orderBook.sellWallPrice)) {
      orderBook.sellWallTry = orderBook.sellWallPrice * tryFactor;
    }
    const bid0 = depth.bids?.[0] ? parseFloat(depth.bids[0][0]) : NaN;
    const ask0 = depth.asks?.[0] ? parseFloat(depth.asks[0][0]) : NaN;
    const spotLiquidityTry = {};
    if (Number.isFinite(bid0) && bid0 > 0) spotLiquidityTry.bidTry = bid0 * tryFactor;
    if (Number.isFinite(ask0) && ask0 > 0) spotLiquidityTry.askTry = ask0 * tryFactor;

    const diagnostics = buildDiagnostics({ tf, orderBook });

    const majorCoins = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX', 'DOT'];
    let arbitraj = null;
    const trPxForArb = tryBook?.mid > 0 ? tryBook.mid : last * usdTryRate;
    if (majorCoins.includes(coin.symbol)) {
      arbitraj = await calcArbitraj(coin.pair, trPxForArb, usdTryRate);
    }

    const { regime, regimeScore } = resolveRegime(tf, priceChange24h);

    const anomalyAdjusted = applyAnomalyPenalty(tf, 0);
    if (anomalyAdjusted.reject) {
      console.log(`ANOMALİ [MANIP] ${coin.pair}: Z=${tf.h1.anomaly.zScore}`);
      return {
        qualified: false,
        snapshot: baseSnapshot(coin, {
          listReason: 'MANIP_REDDI',
          lastClose: tf.h1.lastClose,
          score1h: tf.h1.score,
          overallSignal: tf.h1.overallSignal,
          signalStrength: tf.h1.signalStrength,
          priceChange24h
        })
      };
    }

    const learningData = await memory.getLearningData(coin.symbol);

    const dirScore = (tf.h1.score || 0) + dirs.mtfScore + dirs.momentumBoost;

    const signal = {
      symbol:         coin.pair,
      currency:       'USDT',
      lastClose:      tf.h1.lastClose,
      score:          dirScore,
      score1h:        tf.h1.score,
      score4h:        tf.h4?.score,
      score15m:       tf.m15?.score,
      score1d:        tf.d1?.score,
      score1w:        tf.w1?.score,
      mtfKonfirm: dirs.mtfKonfirm,
      mtfDetay: {
        dir15m: dirs.dir15m,
        dir1h: dirs.dir1h,
        dir4h: dirs.dir4h,
        dir1d: dirs.dir1d,
        dir1w: dirs.dir1w,
        hasWeekly: dirs.hasWeekly,
        allAligned: dirs.allAligned,
        momentumBoost: dirs.momentumBoost
      },
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
      usdTryRate,
      tryFrame,
      spotLiquidityTry,
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

    if (CONFIG.MIN_TP1_PCT > 0) {
      const tp1Pct = Number(signal.atr?.tp1Pct);
      if (!Number.isFinite(tp1Pct) || tp1Pct < CONFIG.MIN_TP1_PCT) {
        return {
          qualified: false,
          snapshot: {
            ...baseSnapshot(coin, { listReason: 'DUSUK_TP1' }),
            listDetail: signal
          }
        };
      }
    }

    signal.kriptoAnaliz = buildKriptoAnaliz(signal, analizCtx);
    signal.firsatSkoru = deriveFirsatFromKriptoAnaliz(signal.kriptoAnaliz, signal);
    signal.runnerPotential = runnerFromKripto(signal.kriptoAnaliz);
    signal.ai = aiOzetiFromKripto(signal.kriptoAnaliz, signal);

    if (signal.ai.manipulationRisk >= 8) {
      console.log(`MANİP [${coin.pair}]: ${signal.ai.manipulationRisk}/10`);
      return {
        qualified: false,
        snapshot: {
          ...baseSnapshot(coin, { listReason: 'AI_MANIP' }),
          listDetail: signal
        }
      };
    }

    const firsatSkoru = signal.firsatSkoru;

    if (firsatSkoru.skor < CONFIG.MIN_FIRSAT) {
      return {
        qualified: false,
        snapshot: {
          ...baseSnapshot(coin, { listReason: 'FIRSAT_ESIK' }),
          listDetail: signal
        }
      };
    }

    if (saveHistory) {
      const signalKey = await memory.saveSignal(signal);
      signal.memoryKey = signalKey;
    } else {
      const prev = signalRegistry.get(signal.symbol);
      signal.memoryKey = prev?.memoryKey || null;
    }

    console.log(`✅ ${coin.pair}: Skor=${dirScore} Fırsat=${firsatSkoru.skor} ${firsatSkoru.emoji} ${firsatSkoru.seviye}${saveHistory ? '' : ' (tahta güncelleme)'}`);
    return { qualified: true, signal };

  } catch (err) {
    console.log(`HATA ${coin.pair}: ${err.message}`);
    return {
      qualified: false,
      snapshot: baseSnapshot(coin, { listReason: 'HATA', listNote: err.message })
    };
  }
}

function mergeQualifiedSignal(result) {
  const prev = signalRegistry.get(result.symbol);
  result.vsPreviousScan = computeVsPreviousScan(prev, result);
  result.absentThisScan = false;
  result.fullScanCount = (prev?.fullScanCount || 0) + 1;
  result.firstSeenAt = prev?.firstSeenAt || result.scannedAt;
  result.anchorCloseLastFullScan = result.lastClose;
  delete result.vsLastFullScanPricePct;
  delete result.lastPriceTickAt;
  signalRegistry.set(result.symbol, result);
}

async function scanMarket() {
  if (isScanning) { console.log('Tarama devam ediyor...'); return getLatestSignals(); }
  isScanning = true;
  const start = Date.now();
  qualifiedThisScanRun = 0;
  console.log(`Tarama basladi — ${allCoins.length} coin`);
  scanState = {
    isScanning: true,
    totalCoins: allCoins.length,
    scannedCoins: 0,
    signalCount: 0,
    qualifiedThisScan: 0,
    boardFresh: 0,
    boardStale: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    etaSeconds: 0,
    phase: 'starting'
  };

  const preResolve = await autoResolver.resolvePendingSignals();
  if (preResolve.resolved > 0) {
    console.log(`AutoResolver (baslangic): ${preResolve.resolved}/${preResolve.checked} sinyal kapatildi`);
  }

  let tryBookMap = {};
  try {
    tryBookMap = await binance.getTryPairBookMap();
    console.log(`Spot TRY çiftleri: ${Object.keys(tryBookMap).length} (futures TL ölçeklemesi)`);
  } catch (e) {
    console.error('TRY spot kitap haritası:', e.message);
  }

  markEntireBoardAbsentThisScan();
  const preBoard = buildSortedBoard();
  liveSignals = preBoard;
  const bs = boardStats(preBoard);
  scanState.signalCount = preBoard.length;
  scanState.boardFresh = bs.fresh;
  scanState.boardStale = bs.stale;
  broadcast({
    type: 'scan_progress',
    data: preBoard,
    scan: { ...scanState },
    time: new Date().toISOString()
  });

  const sentiment = await binance.getFearGreed();
  console.log(`Fear&Greed: ${sentiment.value} (${sentiment.label})`);
  scanState.phase = 'scanning';
  scanState.updatedAt = new Date().toISOString();

  let analizCtx = {};
  try {
    const [makro, onChain] = await Promise.all([fetchMacroSnapshot(), fetchBtcOnChainSnapshot()]);
    analizCtx = { makro, onChain };
    if (makro.entegre) console.log(`Makro (FRED): ${makro.uyumlulukLong || '—'} · ${makro.maddeler?.length || 0} seri`);
    if (onChain.entegre) console.log('On-chain (Glassnode): BTC metrikleri alındı');
  } catch (e) {
    console.error('Makro/on-chain ön yüklemesi:', e.message);
  }

  for (let i = 0; i < allCoins.length; i++) {
    const coin = allCoins[i];
    const result = await scanSingle(coin, sentiment, analizCtx, { tryBookMap });
    if (result?.snapshot) listRegistry.set(coin.pair, result.snapshot);
    if (result?.qualified) {
      qualifiedThisScanRun += 1;
      mergeQualifiedSignal(result.signal);
      listRegistry.set(coin.pair, signalRegistry.get(coin.pair));
    }

    scanState.scannedCoins = i + 1;
    const board = buildSortedBoard();
    const st = boardStats(board);
    scanState.signalCount = board.length;
    scanState.qualifiedThisScan = qualifiedThisScanRun;
    scanState.boardFresh = st.fresh;
    scanState.boardStale = st.stale;
    scanState.updatedAt = new Date().toISOString();

    const progressEvery = (i + 1) % 2 === 0 || i === 0 || i + 1 === allCoins.length;
    if (progressEvery) {
      const e = Math.round((Date.now() - start) / 1000);
      const eta = i + 1 < allCoins.length ? Math.round((e / (i + 1)) * (allCoins.length - i - 1)) : 0;
      scanState.etaSeconds = eta;
      liveSignals = board;
      console.log(
        `Tarandi: ${i+1}/${allCoins.length} — Tahtada: ${board.length} (bu tur uygun: ${qualifiedThisScanRun}) — ${e}s${eta > 0 ? ' — Kalan: ~' + eta + 's' : ''}`
      );
      broadcast({
        type: 'scan_progress',
        data: board,
        scan: { ...scanState },
        time: new Date().toISOString()
      });
    }
    await binance.bekle(CONFIG.SCAN_DELAY_MS);
  }

  purgeAbsentFromSignalRegistry();
  const board = buildSortedBoard();
  lastSignals = board;
  liveSignals = board;

  const totalTime = Math.round((Date.now() - start) / 1000);
  isScanning = false;
  const stEnd = boardStats(board);
  scanState = {
    ...scanState,
    isScanning: false,
    phase: 'done',
    scannedCoins: allCoins.length,
    signalCount: board.length,
    qualifiedThisScan: qualifiedThisScanRun,
    boardFresh: stEnd.fresh,
    boardStale: stEnd.stale,
    etaSeconds: 0,
    updatedAt: new Date().toISOString()
  };

  broadcast({ type:'scan_complete', data: board, scan:{ ...scanState }, time:new Date().toISOString() });

  const nadir  = board.filter(r => !r.absentThisScan && r.firsatSkoru?.skor >= 80).length;
  const guclu  = board.filter(r => !r.absentThisScan && r.firsatSkoru?.skor >= 65).length;
  const div    = board.filter(r => r.divergence?.bullish||r.divergence?.hidden_bullish).length;
  const fvg    = board.filter(r => r.fvg?.inBullishFVG).length;
  const arb    = board.filter(r => r.arbitraj?.isOpportunity).length;

  console.log(`Tarama tamamlandi — tahta: ${board.length} sinyal (bu tur uygun: ${qualifiedThisScanRun}) — ${totalTime}s`);
  console.log(`🔥 Nadir(yeni tur)=${nadir} ✅ Güçlü(yeni tur)=${guclu} | Divergence=${div} FVG=${fvg} Arbitraj=${arb}`);
  const afterResolve = await autoResolver.resolvePendingSignals();
  if (afterResolve.resolved > 0) {
    console.log(`AutoResolver (bitis): ${afterResolve.resolved}/${afterResolve.checked} sinyal kapatildi`);
  }
  return board;
}

async function tickRegistryPrices() {
  if (isScanning || signalRegistry.size === 0) return;
  const syms = [...signalRegistry.keys()];
  for (const sym of syms) {
    const s = signalRegistry.get(sym);
    if (!s) continue;
    try {
      const ticker = await binance.get24hTicker(sym);
      const price = parseFloat(ticker?.lastPrice);
      if (!Number.isFinite(price)) {
        await binance.bekle(120);
        continue;
      }
      const anchor = s.anchorCloseLastFullScan != null ? s.anchorCloseLastFullScan : s.lastClose;
      s.lastClose = price;
      s.priceChange24h = parseFloat(ticker?.priceChangePercent) || s.priceChange24h;
      s.lastPriceTickAt = new Date().toISOString();
      if (anchor > 0) {
        s.vsLastFullScanPricePct = parseFloat((((price - anchor) / anchor) * 100).toFixed(3));
      }
    } catch (_) {
      /* atla */
    }
    await binance.bekle(120);
  }
  lastSignals = buildSortedBoard();
  liveSignals = lastSignals;
  const st = boardStats(lastSignals);
  scanState.signalCount = lastSignals.length;
  scanState.boardFresh = st.fresh;
  scanState.boardStale = st.stale;
  scanState.updatedAt = new Date().toISOString();
  broadcast({
    type: 'signal_board_tick',
    data: lastSignals,
    scan: { ...scanState },
    time: new Date().toISOString()
  });

  const resolveMinMsEnv = parseInt(process.env.PENDING_RESOLVE_MIN_MS, 10);
  const resolveMinMs = Number.isFinite(resolveMinMsEnv)
    ? Math.max(45000, Math.min(resolveMinMsEnv, 900000))
    : 120000;
  const now = Date.now();
  if (now - lastPendingResolveAt >= resolveMinMs) {
    lastPendingResolveAt = now;
    try {
      const pr = await autoResolver.resolvePendingSignals();
      if (pr.resolved > 0) {
        console.log(`AutoResolver (tarama arasi ~${Math.round(resolveMinMs / 1000)}s): ${pr.resolved}/${pr.checked} kapatildi`);
      }
    } catch (e) {
      console.error('AutoResolver (tick):', e.message);
    }
  }
}

/**
 * Tek parite tam analiz + tahtaya yazma. Redis geçmişine yeni kayıt açmaz (saveHistory: false).
 */
async function refreshSymbol(rawSymbol) {
  const pair = normalizeScanPair(rawSymbol);
  if (!pair) return { ok: false, error: 'Geçersiz sembol (örn. BTC veya BTCUSDT)' };

  const base = pair.endsWith('USDT') ? pair.slice(0, -4) : pair;
  let coin = allCoins.find((c) => c.pair === pair);
  if (!coin) coin = { id: base.toLowerCase(), symbol: base, pair };

  if (isScanning) {
    return { ok: false, error: 'Tam tarama sürüyor; bitince tekrar deneyin.' };
  }

  const [sentiment, makro, onChain, tryRow] = await Promise.all([
    binance.getFearGreed(),
    fetchMacroSnapshot(),
    fetchBtcOnChainSnapshot(),
    binance.getTryBookForBase(base)
  ]);
  const tryBookMap = tryRow ? { [base]: tryRow } : {};
  const out = await scanSingle(coin, sentiment, { makro, onChain }, { saveHistory: false, tryBookMap });
  if (out?.snapshot) listRegistry.set(pair, out.snapshot);
  if (out?.qualified) {
    mergeQualifiedSignal(out.signal);
    listRegistry.set(pair, signalRegistry.get(pair));
    lastSignals = buildSortedBoard();
    liveSignals = lastSignals;
    broadcast({
      type: 'symbol_refreshed',
      data: lastSignals,
      scan: { ...getScanState() },
      refreshed: pair,
      time: new Date().toISOString()
    });
    return { ok: true, symbol: pair, signal: out.signal, board: lastSignals };
  }

  if (signalRegistry.has(pair)) signalRegistry.delete(pair);
  lastSignals = buildSortedBoard();
  liveSignals = lastSignals;
  broadcast({
    type: 'symbol_refreshed',
    data: lastSignals,
    scan: { ...getScanState() },
    refreshed: pair,
    time: new Date().toISOString()
  });
  return { ok: false, error: 'Bu tur eşiklerden geçmedi veya veri yok', symbol: pair, board: lastSignals };
}

function startRegistryPriceRefresh() {
  if (priceRefreshTimer || CONFIG.REGISTRY_PRICE_REFRESH_MS <= 0) return;
  priceRefreshTimer = setInterval(tickRegistryPrices, CONFIG.REGISTRY_PRICE_REFRESH_MS);
  console.log(`Tahta fiyat yenilemesi: her ${CONFIG.REGISTRY_PRICE_REFRESH_MS / 1000}s`);
}

async function preloadCoins() {
  if (allCoins.length) return allCoins.length;
  allCoins = await binance.getTRYCoins();
  console.log(`Coin evreni: ${allCoins.length} parite (ön yükleme)`);
  return allCoins.length;
}

async function startAutoScan() {
  if (!allCoins.length) {
    await preloadCoins();
  }
  console.log(`Otomatik tarama — her ${CONFIG.SCAN_INTERVAL_MS / 60000} dk`);
  startRegistryPriceRefresh();
  setTimeout(() => {
    scanMarket();
    setInterval(scanMarket, CONFIG.SCAN_INTERVAL_MS);
  }, 10000);
}

function subscribe(cb)    { subscribers.push(cb); }
function broadcast(data) {
  const payload = { ...data, coinList: buildCoinListSlim() };
  subscribers.forEach((cb) => cb(payload));
}
function getLastSignals() { return lastSignals; }
function getLatestSignals() { return isScanning ? liveSignals : lastSignals; }
function getScanState() { return { ...scanState }; }
function getScannerConfig() {
  return { minFirsat: CONFIG.MIN_FIRSAT, minTp1Pct: CONFIG.MIN_TP1_PCT };
}
function getCoinList() { return buildCoinListSlim(); }

function getListSnapshot(rawSymbol) {
  const pair = normalizeScanPair(rawSymbol);
  if (!pair) return null;
  return listRegistry.get(pair) || null;
}

/** Tahtadaki tam sinyal satırı (yoksa null); absentThisScan / scannedAt için birleşik özet kullanır */
function getBoardSignal(rawSymbol) {
  const pair = normalizeScanPair(rawSymbol);
  if (!pair) return null;
  return signalRegistry.get(pair) || null;
}

module.exports = {
  scanMarket,
  refreshSymbol,
  getLastSignals,
  getLatestSignals,
  getScanState,
  getScannerConfig,
  getCoinList,
  getListSnapshot,
  getBoardSignal,
  startAutoScan,
  preloadCoins,
  subscribe
};
