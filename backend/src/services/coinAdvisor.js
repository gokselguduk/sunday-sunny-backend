/**
 * Sunday Advisor — isteğe bağlı soru-cevap / tam analiz modülü.
 * Tarama / sinyal üretimi / işlem mantığına karışmaz; yalnızca API üzerinden tetiklenir.
 * Bağlam: sinyal kartı (varsa), Binance 24s ticker, haber özeti, Redis geçmişi, tier performansı.
 */

const axios = require('axios');
const memory = require('./memory');
const scanner = require('./scanner');
const binance = require('./binance');
const cryptoNews = require('./cryptoNews');
const firsatTiers = require('./firsatTiers');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const PLACEHOLDER_KEY = 'buraya_claude_api_key_gelecek';
const MAX_QUESTION = 2500;

const DEFAULT_FULL_PROMPT = `Bu coin için kapsamlı bir özet ver (Türkçe, madde madde):
1) Güncel fiyat ve 24 saatlik piyasa davranışı (yüksek/düşük, hacim, değişim).
2) Sistem sinyal kartı varsa teknik özeti kullan; yoksa yalnızca ticker ile sınırlı olduğunu açıkça belirt.
3) Verilen haber başlıklarından çıkarılabilecek genel duygu ve olası riskler (spekülasyon değil, özet).
4) Redis geçmişi ve tier istatistikleri ne ima ediyor.
5) Kullanıcının dikkat etmesi gereken en az 3 nokta.
Yatırım tavsiyesi verme; sonunda kısa bir risk uyarısı ekle.`;

function anthropicKeyRaw() {
  return String(process.env.ANTHROPIC_API_KEY || '').trim();
}

function hasAnthropicKey() {
  const k = anthropicKeyRaw();
  return !!(k && k !== PLACEHOLDER_KEY);
}

function getAdvisorStatus() {
  const k = anthropicKeyRaw();
  let keyHint = 'missing';
  if (!k) keyHint = 'missing';
  else if (k === PLACEHOLDER_KEY) keyHint = 'placeholder';
  else keyHint = 'set';
  return {
    enabled: !!(k && k !== PLACEHOLDER_KEY),
    model: MODEL,
    keyHint
  };
}

function normalizeSymbol(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;
  if (s.endsWith('USDT')) return s;
  return `${s}USDT`;
}

function symbolToBaseAsset(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (s.endsWith('USDT')) return s.slice(0, -4);
  return s;
}

function findSignal(symbol) {
  for (const s of scanner.getLatestSignals()) {
    if (s?.symbol === symbol) return s;
  }
  for (const s of scanner.getLastSignals()) {
    if (s?.symbol === symbol) return s;
  }
  return null;
}

function formatLearningHistory(learning) {
  const { history, successRate, total, success, fail } = learning;
  if (!total) {
    return 'Bu coin için sistemde henüz sonuçlanmış sinyal yok (veya veri yetersiz).';
  }
  const lines = [
    `Özet: ${total} sonuçlanmış sinyal — başarılı (TP): ${success}, stop (SL): ${fail}.`,
    successRate != null ? `Başarı oranı (TP vs SL): %${successRate}.` : ''
  ].filter(Boolean);
  const recent = (history || []).slice(0, 6).map((h) => {
    const r = h.result || '?';
    const ep = h.entryPrice != null ? Number(h.entryPrice).toFixed(6) : '—';
    return `  • ${h.timestamp || ''} | giriş ~${ep} | sonuç: ${r}`;
  });
  return lines.join('\n') + (recent.length ? `\nSon kayıtlar:\n${recent.join('\n')}` : '');
}

function formatTierPerf(tp) {
  const t = tp?.tiers;
  if (!t) return 'Tier istatistiği alınamadı.';
  const row = (name, b) =>
    `${name}: çözümlü ${b.resolved}, bekleyen ${b.pending}, ` +
    `TP1+ %${b.tp1Rate}, TP2+ %${b.tp2Rate}, TP3 %${b.tp3Rate}, SL %${b.slRate}`;
  const nMin = firsatTiers.NADIR_MIN_SCORE;
  const gMin = firsatTiers.GUCLU_MIN_SCORE;
  const iMin = firsatTiers.IYI_MIN_SCORE;
  return [
    'Bu platformda kayıtlı sinyallerden türetilen tier özetleri (geçmiş performans, geleceği garanti etmez):',
    row(`Nadir (${nMin}+)`, t.nadir),
    row(`Güçlü (${gMin}–${nMin - 1})`, t.guclu),
    row(`İyi (${iMin}–${gMin - 1})`, t.iyi),
    `(Örneklem: ~${tp.sampleSize || 0} kayıt anahtarı tarandı.)`
  ].join('\n');
}

function buildSignalBlock(signal) {
  if (!signal) return 'SON TARAMA VERİSİ: Bu coin için şu an önbellekte tam sinyal kartı yok (liste dışı veya henüz taranmadı).';

  const fs = signal.firsatSkoru;
  const ai = signal.ai || {};
  return [
    'SON TARAMA / SİNYAL KARTI (sistem verisi):',
    `Parite: ${signal.symbol} | Son fiyat (USDT): ${signal.lastClose}`,
    `Fırsat skoru: ${fs?.skor ?? '—'}/100 (${fs?.seviye || '—'})`,
    `RSI: ${signal.rsi ?? '—'} | Trend: ${signal.trend?.trend ?? '—'} (güç ${signal.trend?.strength ?? '—'})`,
    `MTF: 15m=${signal.mtfDetay?.dir15m} 1h=${signal.mtfDetay?.dir1h} 4h=${signal.mtfDetay?.dir4h} 1d=${signal.mtfDetay?.dir1d} | 4TF hizalı=${!!signal.mtfDetay?.allAligned}`,
    `Divergence: bull=${!!signal.divergence?.bullish} hidden=${!!signal.divergence?.hidden_bullish} bear=${!!signal.divergence?.bearish}`,
    `Rejim: ${signal.regime?.type || '—'} | Fear&Greed: ${signal.sentiment?.value ?? '—'} (${signal.sentiment?.label || '—'})`,
    `AI özet (sinyal tarayıcısı): ${ai.verdict || '—'} | manipülasyon riski: ${ai.manipulationRisk ?? '—'}/10`,
    `SL: ${signal.atr?.stopLoss} | TP1 ${signal.atr?.takeProfit1} | TP2 ${signal.atr?.takeProfit2} | TP3 ${signal.atr?.takeProfit3}`,
    `Tarama zamanı: ${signal.scannedAt || '—'}`
  ].join('\n');
}

function formatTicker24h(t) {
  if (!t) {
    return 'BINANCE USDT-M 24S: Veri alınamadı (parite kapalı veya ağ hatası).';
  }
  const last = t.lastPrice ?? t.close ?? t.prevClosePrice;
  const pct = t.priceChangePercent;
  const high = t.highPrice;
  const low = t.lowPrice;
  const vol = t.volume;
  const qv = t.quoteVolume;
  const open = t.openPrice;
  return [
    'BINANCE USDT-M 24S ÖZET (anlık API):',
    `Son: ${last ?? '—'} | Açılış: ${open ?? '—'} | Değişim: %${pct ?? '—'}`,
    `Yüksek: ${high ?? '—'} | Düşük: ${low ?? '—'}`,
    `Hacim (baz): ${vol ?? '—'} | İşlem hacmi (USDT): ${qv ?? '—'}`,
    `İşlem sayısı: ${t.count ?? '—'}`
  ].join('\n');
}

async function ask(body) {
  const fullAnalysis = !!(body?.fullAnalysis || body?.mode === 'full');
  const includeNews =
    body?.includeNews === true || (body?.includeNews !== false && fullAnalysis);

  let question = String(body?.question || '').trim();
  if (!question && fullAnalysis) {
    question = DEFAULT_FULL_PROMPT;
  }

  if (!question || question.length > MAX_QUESTION) {
    return {
      ok: false,
      error: fullAnalysis
        ? `İstek geçersiz (en fazla ${MAX_QUESTION} karakter).`
        : `Soru boş veya çok uzun (en fazla ${MAX_QUESTION} karakter).`
    };
  }

  const symbolRaw = body?.symbol;
  const symbol = normalizeSymbol(symbolRaw);
  if (!symbol) {
    return { ok: false, error: 'Geçerli bir coin sembolü gerekli (ör. BTC veya BTCUSDT).' };
  }

  if (!hasAnthropicKey()) {
    return {
      ok: false,
      error: 'Danışman modülü için sunucuda geçerli ANTHROPIC_API_KEY tanımlı değil.'
    };
  }

  const baseAsset = symbolToBaseAsset(symbol);

  const [learning, stats, tierPerf, signal, scanState, ticker, newsPack] = await Promise.all([
    memory.getLearningData(symbol),
    memory.getStats(),
    memory.getTierPerformance(800),
    Promise.resolve(findSignal(symbol)),
    Promise.resolve(scanner.getScanState()),
    binance.get24hTicker(symbol),
    includeNews ? cryptoNews.fetchNewsForAsset(baseAsset) : Promise.resolve({ items: [] })
  ]);

  const tickerBlock = formatTicker24h(ticker);
  const newsBlock = includeNews ? cryptoNews.formatNewsForPrompt(newsPack.items) : '';

  const systemBase = `Sen "Sunday Advisor" adlı isteğe bağlı danışman modülüsün. Bu platformun otomatik tarama, sinyal üretimi veya işlem kararlarına müdahale etmezsin; kullanıcı isteğiyle yanıt verirsin.

Kurallar:
- Yatırım tavsiyesi değildir; genel bilgi ve sistem / piyasa / haber özetine dayalı yorum.
- Geçmiş performans geleceği garanti etmez; bunu gerektiğinde hatırlat.
- Türkçe, net, yapılandırılmış (madde veya kısa paragraflar).
- Verilen bağlam dışına çıkma; eksik veriyi varsayma, eksikse belirt.
- Haberler üçüncü parti özetidir; doğruluğu garanti etme, spekülasyon üretme.
- Sistem tier istatistiklerini ve coin geçmişini "öğrenilmiş özet" olarak kullan.`;

  const system = fullAnalysis
    ? `${systemBase}\n\nTam analiz modu: hem piyasa özetini hem haber duygusunu hem teknik kartı (varsa) birleştir; net başlıklar kullan.`
    : systemBase;

  const userContent = [
    `SORULAN COİN: ${symbol} (baz varlık: ${baseAsset})`,
    '',
    `TARAMA DURUMU: ${scanState?.isScanning ? 'Şu an tarama çalışıyor olabilir' : 'Tarama bekleniyor / tamamlandı'} (ilerleme: ${scanState?.scannedCoins || 0}/${scanState?.totalCoins || 0}).`,
    '',
    'GENEL SİSTEM İSTATİSTİĞİ (tüm coinler, kabaca):',
    `Sonuçlanmış işlemler: toplam ${stats.total}, başarılı (TP) ${stats.success}, SL ${stats.fail}${stats.successRate != null ? `, genel başarı %${stats.successRate}` : ''}.`,
    '',
    formatTierPerf(tierPerf),
    '',
    `BU COİN İÇİN GEÇMİŞ (Redis):`,
    formatLearningHistory(learning),
    '',
    buildSignalBlock(signal),
    '',
    tickerBlock,
    '',
    newsBlock,
    '',
    fullAnalysis ? `GÖREV / İSTEK:\n${question}` : `KULLANICI SORUSU:\n${question}`,
    '',
    fullAnalysis
      ? 'Yanıtta önce kısa bir yönetici özeti, sonra maddeler halinde detay ver.'
      : 'Yanıtında önce bağlamı kısaca öz (veri varsa), sonra soruya odaklan. Gerekirse risk uyarısı ekle.'
  ].join('\n');

  const maxTokens = fullAnalysis ? 2800 : 1200;
  const apiKey = anthropicKeyRaw();

  try {
    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userContent }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        timeout: fullAnalysis ? 90000 : 45000
      }
    );

    const text = res.data?.content?.[0]?.text?.trim();
    if (!text) {
      return { ok: false, error: 'Model boş yanıt döndü.' };
    }

    return {
      ok: true,
      answer: text,
      meta: {
        symbol,
        baseAsset,
        hasSignal: !!signal,
        model: MODEL,
        scanPhase: scanState?.phase || null,
        fullAnalysis,
        includeNews: !!includeNews,
        newsCount: newsPack.items?.length || 0,
        hasTicker24h: !!ticker
      }
    };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('coinAdvisor ask:', msg);
    return { ok: false, error: `Danışman yanıtı alınamadı: ${msg}` };
  }
}

module.exports = { ask, normalizeSymbol, hasAnthropicKey, getAdvisorStatus };
