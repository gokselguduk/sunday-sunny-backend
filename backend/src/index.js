const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

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

const app    = express();
const server = http.createServer(app);
const io     = new socketio.Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      const b = path.basename(filePath);
      if (/\.html$/i.test(b) || b === 'sw.js') {
        res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
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

/** Canlı sürüm doğrulama (Railway otomatik env); önbellek yok */
app.get('/api/build', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.json({
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
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

// ── TARAMA ──────────────────────────────────
app.get('/api/scan/latest', async (req, res) => {
  const lastNadirPushAt = await memory.getNadirPushLastAt();
  const nadirTrail = await memory.getNadirTrail();
  res.json({
    signals: scanner.getLatestSignals(),
    coinList: scanner.getCoinList(),
    scan: scanner.getScanState(),
    lastNadirPushAt,
    nadirTrail,
    storage: memory.getStorageInfo()
  });
});

/** Liste sekmesi / eşik altı detay: sunucudaki son analiz özeti (listDetail varsa tam gövde) */
app.get('/api/coin/snapshot/:symbol', (req, res) => {
  const snap = scanner.getListSnapshot(req.params.symbol);
  if (!snap) return res.status(404).json({ ok: false, error: 'Bu parite için henüz tarama özeti yok' });
  res.json({ ok: true, snapshot: snap });
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
  let payload = data;
  if (data?.type === 'scan_complete') {
    const fresh = (data.data || []).filter((s) => !s.absentThisScan);
    await memory.recordNadirFromScan(fresh);
    const nadirTrail = await memory.getNadirTrail();
    payload = {
      ...data,
      nadirTrail,
      storage: memory.getStorageInfo()
    };
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
scanner.startAutoScan();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu calisiyor: http://localhost:${PORT}`);
  btcPulse.startBtcPulse(io);
});