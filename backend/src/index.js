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
const coinAdvisor = require('./services/coinAdvisor');
const binance = require('./services/binance');
const btcPulse = require('./services/btcPulse');

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
notifier.configurePush();

// ── SAĞLIK ──────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
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

// ── TARAMA ──────────────────────────────────
app.get('/api/scan/latest', async (req, res) => {
  const lastNadirPushAt = await memory.getNadirPushLastAt();
  const nadirTrail = await memory.getNadirTrail();
  res.json({
    signals: scanner.getLatestSignals(),
    scan: scanner.getScanState(),
    lastNadirPushAt,
    nadirTrail,
    storage: memory.getStorageInfo()
  });
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

// ── AI DANIŞMAN (yalnızca soru-cevap; tarama akışına karışmaz) ──
app.get('/api/ai/advisor-status', (req, res) => {
  res.json(coinAdvisor.getAdvisorStatus());
});

app.post('/api/ai/coin-ask', async (req, res) => {
  const result = await coinAdvisor.ask(req.body || {});
  if (!result.ok) {
    let status = 400;
    if (String(result.error || '').includes('ANTHROPIC_API_KEY')) status = 503;
    else if (String(result.error || '').includes('alınamadı') || String(result.error || '').includes('Danışman yanıtı')) status = 502;
    return res.status(status).json(result);
  }
  res.json(result);
});

/** Tam analiz: 24s ticker + isteğe bağlı haber + genişletilmiş yanıt */
app.post('/api/ai/coin-analyze', async (req, res) => {
  const body = req.body || {};
  const result = await coinAdvisor.ask({
    ...body,
    fullAnalysis: true,
    includeNews: body.includeNews !== false
  });
  if (!result.ok) {
    let status = 400;
    if (String(result.error || '').includes('ANTHROPIC_API_KEY')) status = 503;
    else if (String(result.error || '').includes('alınamadı') || String(result.error || '').includes('Danışman yanıtı')) status = 502;
    return res.status(status).json(result);
  }
  res.json(result);
});

// ── PORTFÖY DAĞITIM TAVSİYESİ ───────────────
app.post('/api/portfolio/distribute', function(req, res) {
  const { butce } = req.body;
  const sinyaller = scanner.getLastSignals();
  const sentiment = sinyaller[0]?.sentiment;
  const fg = sentiment?.value || 50;

  if (!sinyaller.length) {
    return res.json({ error: 'Henüz sinyal yok, tarama bekleniyor.' });
  }

  // Piyasa koşulu
  let strateji, maxPozisyon, nakitOran;
  if (fg <= 20) {
    strateji = 'AGRESİF'; maxPozisyon = 4; nakitOran = 0.10;
  } else if (fg <= 40) {
    strateji = 'DENGELİ'; maxPozisyon = 5; nakitOran = 0.15;
  } else if (fg <= 60) {
    strateji = 'TEMKİNLİ'; maxPozisyon = 5; nakitOran = 0.25;
  } else if (fg <= 80) {
    strateji = 'SAVUNMACI'; maxPozisyon = 3; nakitOran = 0.40;
  } else {
    strateji = 'NAKİT_TUT'; maxPozisyon = 1; nakitOran = 0.70;
  }

  // Anomali varsa uyar
  const anomaliVar = sinyaller.some(s => s.anomaly?.isAnomaly);
  if (anomaliVar) nakitOran = Math.min(nakitOran + 0.10, 0.80);

  // En iyi sinyalleri seç (son turda eşik geçenler; tahtada kalan “eski” satırlar hariç)
  const adaylar = sinyaller
    .filter(s => !s.absentThisScan)
    .filter(s => (s.firsatSkoru?.skor || 0) >= 50)
    .filter(s => !s.anomaly?.isAnomaly || s.anomaly.signal === 'DIKKAT')
    .slice(0, maxPozisyon);

  if (!adaylar.length) {
    return res.json({
      strateji, fg,
      mesaj: 'Şu an yeterli kalitede sinyal yok. Nakit beklet.',
      nakitTut: butce,
      dagitim: []
    });
  }

  // Kelly Criterion ile ağırlık hesapla
  const toplamSkor = adaylar.reduce((t, s) => t + (s.firsatSkoru?.skor || 50), 0);
  const yatirimButce = butce * (1 - nakitOran);

  const dagitim = adaylar.map(s => {
    const fs = s.firsatSkoru?.skor || 50;
    const agirlik = fs / toplamSkor;
    const tutar = Math.round(yatirimButce * agirlik / 100) * 100;
    const oran = parseFloat((agirlik * 100).toFixed(1));
    const usdTutar = tutar / (s.usdTryRate || 38);
    const miktar = usdTutar / s.lastClose;

    return {
      symbol:      s.symbol,
      firsatSkor:  fs,
      seviye:      s.firsatSkoru?.seviye || '',
      emoji:       s.firsatSkoru?.emoji || '',
      tutar:       tutar,
      oran:        oran,
      girisFiyati: s.lastClose,
      girisTRY:    parseFloat((s.lastClose * (s.usdTryRate || 38)).toFixed(2)),
      miktar:      parseFloat(miktar.toFixed(6)),
      sl:          s.atr?.stopLoss,
      slTRY:       parseFloat((s.atr?.stopLoss * (s.usdTryRate || 38)).toFixed(2)),
      slPct:       s.atr?.stopLossPct,
      tp1:         s.atr?.takeProfit1,
      tp1TRY:      parseFloat((s.atr?.takeProfit1 * (s.usdTryRate || 38)).toFixed(2)),
      tp1Pct:      s.atr?.tp1Pct,
      maxRisk:     parseFloat((tutar * (s.atr?.stopLossPct || 3) / 100).toFixed(0)),
      divergence:  s.divergence?.bullish || s.divergence?.hidden_bullish,
      allAligned:  s.mtfDetay?.allAligned,
      aiVerdict:   s.ai?.verdict
    };
  });

  const toplamYatirim = dagitim.reduce((t, d) => t + d.tutar, 0);
  const nakitMiktar   = butce - toplamYatirim;
  const toplamRisk    = dagitim.reduce((t, d) => t + d.maxRisk, 0);

  res.json({
    strateji,
    fg,
    fgLabel:       sentiment?.label || '',
    butce,
    yatirim:       toplamYatirim,
    nakit:         nakitMiktar,
    nakitOran:     parseFloat((nakitOran * 100).toFixed(0)),
    toplamRisk,
    riskOrani:     parseFloat((toplamRisk / butce * 100).toFixed(1)),
    pozisyonSayisi: dagitim.length,
    anomaliUyari:  anomaliVar,
    dagitim
  });
});
// ── SOCKET.IO ───────────────────────────────
io.on('connection', async (socket) => {
  const initialSignals = scanner.getLatestSignals();
  const scanState = scanner.getScanState();
  const nadirTrail = await memory.getNadirTrail();
  socket.emit('scan_update', {
    type: scanState.isScanning ? 'scan_progress' : 'scan_complete',
    data: initialSignals,
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
  if (!signals.length || !nadirSigs.length) return;

  const gate = await nadirAlert.shouldSendNadirPush();
  if (!gate.ok) {
    if (gate.reason === 'silent') console.log('Nadir push: gece sessiz modu (TR saati)');
    else if (gate.reason === 'cooldown') console.log('Nadir push: 45 dk cooldown');
    return;
  }

  const msg = nadirAlert.buildNadirPushMessage(nadirSigs);
  await notifier.sendPushToAll({
    title: msg.title,
    body: msg.body,
    url: '/',
    vibrate: [300, 150, 300, 150, 500]
  });
  await nadirAlert.markNadirPushSent();
});

// ── BAŞLAT ──────────────────────────────────
scanner.startAutoScan();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu calisiyor: http://localhost:${PORT}`);
  btcPulse.startBtcPulse(io);
});