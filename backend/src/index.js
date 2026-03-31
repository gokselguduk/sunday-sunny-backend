const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const PUBLIC_DIR = path.join(__dirname, 'public');

/** index+sw içeriğinin hash’i; Docker’da mtime hep aynı kalabildiği için dosya içeriği şart */
let _shellHashCache = { sig: '', hash: null };
function getClientShellContentHash() {
  const names = ['index.html', 'sw.js'];
  let sig = '';
  const bufs = [];
  try {
    for (const name of names) {
      const p = path.join(PUBLIC_DIR, name);
      const st = fs.statSync(p);
      sig += `${name}:${st.mtimeMs}:${st.size};`;
      bufs.push(fs.readFileSync(p));
    }
  } catch (_) {
    return null;
  }
  if (_shellHashCache.sig === sig) return _shellHashCache.hash;
  const h = crypto.createHash('sha256').update(Buffer.concat(bufs)).digest('hex').slice(0, 24);
  _shellHashCache = { sig, hash: h };
  return h;
}

const express  = require('express');
const http     = require('http');
const socketio = require('socket.io');
const cors     = require('cors');
const scanner  = require('./services/scanner');
const memory   = require('./services/memory');
const notifier = require('./services/notifier');
const nadirAlert = require('./services/nadirAlert');
const binance = require('./services/binance');
const btcPulse = require('./services/btcPulse');
const marketContext = require('./services/marketContext');
const pushAlerts = require('./services/pushAlerts');
const coinUnified = require('./services/coinUnified');
const winnerPattern = require('./services/winnerPattern');
const jumpArchetype = require('./services/jumpArchetype');

async function buildUnifiedPayloadWithStats(snap, board, ctx, btc) {
  const body = coinUnified.buildUnifiedFromSnapshot(snap, {
    boardSignal: board,
    marketBrief: coinUnified.slimMarketContext(ctx),
    btcBrief: coinUnified.slimBtc(btc)
  });
  if (body.ok) {
    const det = coinUnified.pickDetail(snap);
    if (det) {
      try {
        body.situationStats = await memory.getSituationOutcomeStats(det);
      } catch (e) {
        body.situationStats = { ok: false, reason: 'STATS_ERROR', error: e.message };
      }
    }
  }
  return body;
}

const app    = express();
const server = http.createServer(app);
const io     = new socketio.Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

/** Kök sayfa: statik zincirden önce — ara CDN/tarayıcı HTML saklamasını zorla kır */
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res, filePath) {
      const b = path.basename(filePath);
      if (/\.html$/i.test(b) || b === 'sw.js' || /\.webmanifest$/i.test(b)) {
        res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
      }
    }
  })
);
app.get('/bitcoin.html', (req, res) => res.redirect(301, '/'));
notifier.configurePush();

// ── SAĞLIK ──────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/** Canlı sürüm doğrulama (Railway otomatik env); önbellek yok — CDN/proxy kaçırmasın */
app.get('/api/build', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  const commit =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.RAILWAY_GIT_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    null;
  const contentHash = getClientShellContentHash();
  const shortCommit = commit && String(commit).length >= 7 ? String(commit).slice(0, 12) : null;
  const envShell = process.env.APP_SHELL_VERSION ? String(process.env.APP_SHELL_VERSION).trim() : null;
  /** Her zaman içerik hash’i dâhil: aynı commit’te index değişince de client güncellenir */
  const shellVersion = [envShell, shortCommit, contentHash].filter(Boolean).join(':') || contentHash || null;
  res.json({
    commit,
    shellVersion,
    shellContentHash: contentHash,
    service: process.env.RAILWAY_SERVICE_NAME || null,
    time: new Date().toISOString()
  });
});

// ── BITCOIN PİYASA NABZI (7/24 arka plan) ───
app.get('/api/market/bitcoin', (req, res) => {
  res.json(btcPulse.getBtcSnapshot());
});

app.post('/api/market/bitcoin/refresh', async (req, res) => {
  const r = await btcPulse.refreshBtcPulse();
  if (!r.ok) {
    return res.status(502).json({ ok: false, error: r.error, data: btcPulse.getBtcSnapshot() });
  }
  res.json({ ok: true, data: btcPulse.getBtcSnapshot() });
});

/** Funding, OI, spot–perp baz, seans UTC profili, DXY karşılaştırması, BTC ağ ücreti; isteğe bağlı Coinglass */
app.get('/api/market/context', async (req, res) => {
  try {
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await marketContext.getMarketContext(force);
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

const FUTURES24H_CACHE_MS = 40000;
let futures24hCache = { tickers: null, at: 0 };

/** Binance USDT-M tüm pariteler 24s ticker (önbellekli); ısı haritası piyasa modu */
app.get('/api/market/futures-24h', async (req, res) => {
  try {
    const now = Date.now();
    if (!futures24hCache.tickers || now - futures24hCache.at > FUTURES24H_CACHE_MS) {
      futures24hCache.tickers = await binance.getAllFutures24hTickers();
      futures24hCache.at = now;
    }
    res.setHeader('Cache-Control', 'private, max-age=25');
    res.json({
      ok: true,
      source: 'binance_futures_usdm',
      updatedAt: new Date(futures24hCache.at).toISOString(),
      count: Object.keys(futures24hCache.tickers).length,
      tickers: futures24hCache.tickers
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || 'Binance ticker alınamadı' });
  }
});

/**
 * Binance TR (BINANCE_TR_COINS ∩ USDT-M) pariteleri; 24s ticker’a göre sıralı.
 * sort=gainers|losers|abs — geriye dönük “o an listede miydi?” için uygulama geçmiş kaydı tutmaz; bu endpoint anlık snapshot’tır.
 */
app.get('/api/market/tr-24h-movers', async (req, res) => {
  try {
    const now = Date.now();
    if (!futures24hCache.tickers || now - futures24hCache.at > FUTURES24H_CACHE_MS) {
      futures24hCache.tickers = await binance.getAllFutures24hTickers();
      futures24hCache.at = now;
    }
    const tickMap = futures24hCache.tickers || {};
    const coins = await binance.getTRYCoins();
    const sort = String(req.query.sort || 'gainers').toLowerCase();
    const limit = Math.min(50, Math.max(5, parseInt(req.query.limit, 10) || 15));

    const rows = [];
    for (const c of coins) {
      const sym = c.pair;
      const t = tickMap[sym];
      if (!t) continue;
      const ch = t.priceChangePercent;
      const pct = Number.isFinite(Number(ch)) ? Number(ch) : null;
      rows.push({
        symbol: sym,
        base: c.symbol,
        lastPrice: t.lastPrice,
        change24hPct: pct,
        quoteVolume: t.quoteVolume,
        highPrice: t.highPrice,
        lowPrice: t.lowPrice
      });
    }

    if (sort === 'losers') {
      rows.sort((a, b) => (a.change24hPct ?? -999) - (b.change24hPct ?? -999));
    } else if (sort === 'abs') {
      rows.sort((a, b) => Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0));
    } else {
      rows.sort((a, b) => (b.change24hPct ?? -999) - (a.change24hPct ?? -999));
    }

    res.setHeader('Cache-Control', 'private, max-age=25');
    res.json({
      ok: true,
      source: 'binance_futures_usdm_tr_subset',
      sort: sort === 'losers' ? 'losers' : sort === 'abs' ? 'abs' : 'gainers',
      updatedAt: new Date(futures24hCache.at).toISOString(),
      pairCount: rows.length,
      limit,
      movers: rows.slice(0, limit),
      retroNoteTr:
        'Bu yanıt anlık Binance verisidir; geçmiş tarih/saat için sunucuda arşiv tutulmaz. DAR vb. bir coinin Gelir+/Sıcrama/Sinyal listesinde o an görünüp görünmediğini geriye dönük doğrulamak için o güne ait ekran görüntüsü veya kaydettiğiniz API çıktısı gerekir.'
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || 'TR 24s movers alınamadı' });
  }
});

// ── TARAMA ──────────────────────────────────
app.get('/api/scan/latest', async (req, res) => {
  const lastNadirPushAt = await memory.getNadirPushLastAt();
  const nadirTrail = await memory.getNadirTrail();
  const performance = await memory.getPerformanceSnapshot();
  res.json({
    signals: scanner.getLatestSignals(),
    coinList: scanner.getCoinList(),
    scan: scanner.getScanState(),
    scannerConfig: scanner.getScannerConfig(),
    lastNadirPushAt,
    nadirTrail,
    storage: memory.getStorageInfo(),
    performance
  });
});

/** Liste sekmesi / eşik altı detay: sunucudaki son analiz özeti (listDetail varsa tam gövde) */
app.get('/api/coin/snapshot/:symbol', (req, res) => {
  const snap = scanner.getListSnapshot(req.params.symbol);
  if (!snap) return res.status(404).json({ ok: false, error: 'Bu parite için henüz tarama özeti yok' });
  res.json({ ok: true, snapshot: snap });
});

/**
 * Tek parite: lifecycle durumu, tazelik, çelişkiler, motor hizası, BTC/piyasa arka planı,
 * diagnostics / formasyon / arbitraj / SR-Fib / öğrenme verisi dahil birleşik özet.
 */
app.get('/api/coin/unified/:symbol', async (req, res) => {
  const snap = scanner.getListSnapshot(req.params.symbol);
  if (!snap) return res.status(404).json({ ok: false, error: 'Bu parite için henüz tarama özeti yok' });
  try {
    const board = scanner.getBoardSignal(req.params.symbol);
    const ctx = await marketContext.getMarketContext(false);
    const btc = btcPulse.getBtcSnapshot();
    res.json(await buildUnifiedPayloadWithStats(snap, board, ctx, btc));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'unified hatası' });
  }
});

/**
 * ~2 yıl günlük mum: üst getirilerden “ralli öncesi 5g” medyan profili; yalnızca şu an buna benzeyen pariteler döner (kazanan listesi istemciye gönderilmez).
 * ?refresh=1 önbellek yenileme (TR listesi; süre birkaç dk).
 */
app.get('/api/analytics/winner-pattern', async (req, res) => {
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  try {
    if (refresh) {
      const data = await winnerPattern.computeWinnerPatternAnalysis(true);
      return res.json(data);
    }
    const cached = winnerPattern.getCachedWinnerPattern();
    if (cached) return res.json(cached);
    return res.json({
      ok: false,
      needsRefresh: true,
      message:
        'Henüz önbellek yok. Aşağıdan “Hesapla” ile başlatın; ilk çalıştırma tüm pariteler için günlük mum çeker (liste büyükse 1–2 dk sürebilir).'
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'winner-pattern hatası' });
  }
});

/**
 * 2y günlük: tüm paritelerde ≥eşik günlük sıçramaların öncesi 5g profillerinden küresel arketip;
 * şu an bu profile yakın pariteler + geçmiş benzer profillerde görülen sıçrama büyüklüğü (medyan).
 */
app.get('/api/analytics/jump-candidates', async (req, res) => {
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  try {
    if (refresh) {
      const data = await jumpArchetype.computeJumpArchetypeAnalysis(true);
      return res.json(data);
    }
    const cached = jumpArchetype.getCachedJumpArchetype();
    if (cached) return res.json(cached);
    return res.json({
      ok: false,
      needsRefresh: true,
      message:
        'Önbellek boş. Rapor sekmesinde “Sıcrama havuzunu hesapla” ile başlatın; tüm pariteler için günlük mum çekilir (birkaç dakika sürebilir).'
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'jump-candidates hatası' });
  }
});

app.post('/api/prices/bulk', async (req, res) => {
  const symbols = Array.isArray(req.body?.symbols) ? req.body.symbols : [];
  if (!symbols.length) {
    return res.status(400).json({ error: 'symbols[] gerekli' });
  }
  try {
    const prices = await binance.getMarkPricesBulk(symbols);
    res.json({ prices, time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scan/now', async (req, res) => {
  try {
    const results = await scanner.scanMarket();
    res.json({ count: results.length, signals: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Tek coin tam analiz; tahtayı günceller, Redis’e yeni BEKLIYOR kaydı açmaz */
app.post('/api/scan/symbol', async (req, res) => {
  const r = await scanner.refreshSymbol(req.body?.symbol);
  if (!r.ok) {
    const status = r.error?.includes('sürüyor') ? 409 : 400;
    return res.status(status).json(r);
  }
  res.json(r);
});

app.get('/api/performance/tiers', async (req, res) => {
  const limit = parseInt(req.query.limit, 10);
  const data = await memory.getTierPerformance(limit);
  res.json(data);
});

/** Sinyal geçmişi özeti: kuyruk boyu + TP/SL sayaçları (Redis; kalıcılık için REDIS_URL). */
app.get('/api/performance/summary', async (req, res) => {
  try {
    const performance = await memory.getPerformanceSnapshot();
    res.json({ ok: true, storage: memory.getStorageInfo(), ...performance });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'summary hatası' });
  }
});

app.post('/api/signal/resolve', async (req, res) => {
  const { key, result, exitPrice } = req.body || {};
  const allowed = ['TP1', 'TP2', 'TP3', 'SL', 'MANUEL'];
  if (!key || !allowed.includes(result)) {
    return res.status(400).json({ error: 'Gecersiz key/result. Result: TP1|TP2|TP3|SL|MANUEL' });
  }
  await memory.updateSignalResult(key, result, Number(exitPrice) || 0);
  res.json({ ok: true });
});

app.get('/api/push/config', (req, res) => {
  res.json(notifier.getPushConfig());
});

app.post('/api/push/subscribe', async (req, res) => {
  const { subscription } = req.body || {};
  if (!subscription?.endpoint) {
    return res.status(400).json({ error: 'Gecersiz subscription' });
  }
  const ok = await memory.savePushSubscription(subscription);
  res.json({ ok });
});

app.post('/api/push/unsubscribe', async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) {
    return res.status(400).json({ error: 'Endpoint gerekli' });
  }
  const ok = await memory.removePushSubscription(endpoint);
  res.json({ ok });
});

// ── SOCKET.IO ───────────────────────────────
io.on('connection', async (socket) => {
  const initialSignals = scanner.getLatestSignals();
  const scanState = scanner.getScanState();
  const nadirTrail = await memory.getNadirTrail();
  socket.emit('scan_update', {
    type: scanState.isScanning ? 'scan_progress' : 'scan_complete',
    data: initialSignals,
    coinList: scanner.getCoinList(),
    scan: scanState,
    time: new Date().toISOString(),
    nadirTrail,
    storage: memory.getStorageInfo()
  });
  socket.emit('btc_pulse', {
    type: 'btc_pulse',
    data: btcPulse.getBtcSnapshot(),
    time: new Date().toISOString()
  });
  socket.on('disconnect', () => {});
});

scanner.subscribe(async (data) => {
  let payload = { ...data };
  if (data?.type === 'scan_complete') {
    const fresh = (data.data || []).filter((s) => !s.absentThisScan);
    await memory.recordNadirFromScan(fresh);
    const nadirTrail = await memory.getNadirTrail();
    payload = {
      ...payload,
      nadirTrail,
      storage: memory.getStorageInfo()
    };
    try {
      const ctx = await marketContext.getMarketContext(false);
      const btc = btcPulse.getBtcSnapshot();
      payload.scanBackdrop = {
        market: coinUnified.slimMarketContext(ctx),
        btc: coinUnified.slimBtc(btc)
      };
    } catch (_) {
      /* isteğe bağlı; tarama tamamını geciktirmesin */
    }
  }
  if (data?.type === 'symbol_refreshed' && data.refreshed) {
    try {
      const snap = scanner.getListSnapshot(data.refreshed);
      const board = scanner.getBoardSignal(data.refreshed);
      const ctx = await marketContext.getMarketContext(false);
      const btc = btcPulse.getBtcSnapshot();
      payload.coinUnified = snap ? await buildUnifiedPayloadWithStats(snap, board, ctx, btc) : null;
    } catch (e) {
      payload.coinUnified = null;
      payload.coinUnifiedError = e.message;
    }
  }
  io.emit('scan_update', payload);
  if (data?.type !== 'scan_complete') return;

  const signals = (data.data || []).filter((s) => !s.absentThisScan);
  const nadirSigs = nadirAlert.pickNadirSignals(signals);
  if (signals.length && nadirSigs.length) {
    const gate = await nadirAlert.shouldSendNadirPush();
    if (!gate.ok) {
      if (gate.reason === 'silent') console.log('Nadir push: gece sessiz modu (TR saati)');
      else if (gate.reason === 'cooldown') console.log('Nadir push: 45 dk cooldown');
    } else {
      const msg = nadirAlert.buildNadirPushMessage(nadirSigs);
      await notifier.sendPushToAll({
        title: msg.title,
        body: msg.body,
        url: '/',
        tag: 'ss-nadir',
        vibrate: [300, 150, 300, 150, 500]
      });
      await nadirAlert.markNadirPushSent();
    }
  }

  try {
    await pushAlerts.processScanComplete(data.data || []);
  } catch (e) {
    console.error('pushAlerts:', e.message);
  }
});

// ── BAŞLAT ──────────────────────────────────
// Railway /health hemen 200 dönsün diye önce dinle; Binance ön yüklemesi arka planda (preload bitmeden listen gecikirse sağlık kontrolü düşer).
const PORT = Number(process.env.PORT) || 3000;
const LISTEN_HOST = process.env.BIND_HOST || '0.0.0.0';

server.listen(PORT, LISTEN_HOST, () => {
  console.log(`Sunucu calisiyor: ${LISTEN_HOST}:${PORT}`);
  btcPulse.startBtcPulse(io);
  scanner
    .preloadCoins()
    .catch((e) => console.error('Coin evreni ön yüklenemedi:', e.message))
    .finally(() => {
      scanner.startAutoScan();
    });
});