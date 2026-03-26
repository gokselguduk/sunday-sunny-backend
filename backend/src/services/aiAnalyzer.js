// Claude AI Sinyal Yorumlayıcı
// Her sinyali analiz eder, manipülasyon tespit eder
// Geçmiş başarı verilerinden öğrenir

const axios  = require('axios');
const memory = require('./memory');

function formatTryApprox(signal) {
  const rate = Number(signal.usdTryRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return 'TL karşılığı: kur bilgisi yok (yalnızca USDT fiyatları geçerlidir).';
  }
  const usdt = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return `${(n * rate).toFixed(2)} TL (yaklaşık)`;
  };
  return [
    `USDT/TRY referans: ~${rate.toFixed(4)} (yaklaşık).`,
    `Son fiyat TL karşılığı: ~${usdt(signal.lastClose)}`,
    `SL TL: ~${usdt(signal.atr?.stopLoss)} | TP1 TL: ~${usdt(signal.atr?.takeProfit1)} | TP2 TL: ~${usdt(signal.atr?.takeProfit2)} | TP3 TL: ~${usdt(signal.atr?.takeProfit3)}`
  ].join('\n');
}

async function analyzeSignal(signal, learningData) {
  try {
    if (!process.env.ANTHROPIC_API_KEY ||
        process.env.ANTHROPIC_API_KEY === 'buraya_claude_api_key_gelecek') {
      return fallbackAnalysis(signal);
    }

    // Öğrenme verisini hazırla
    const pastPerformance = learningData?.successRate !== null
      ? `Bu coin için geçmiş ${learningData.total} sinyalden %${learningData.successRate} başarı oranı.`
      : 'Bu coin için henüz geçmiş veri yok.';

    const prompt = `Sen bir kripto para analisti yapay zekasısın. Aşağıdaki teknik analiz verisini değerlendirip sinyal kalitesi ve manipülasyon riski hakkında yorum yap.

PARİTE: ${signal.symbol} — Binance USDT-M (linear) perpetual; tüm fiyat seviyeleri USDT cinsindendir (TRY değildir).
SON FİYAT (USDT): ${signal.lastClose}
NET SKOR (sistem): ${signal.score}

${formatTryApprox(signal)}

TEKNİK VERİ (USDT):
- RSI: ${signal.rsi}
- MACD Histogram: ${signal.macd?.histogram?.toFixed(4)}
- Trend: ${signal.trend?.trend}
- Bollinger: Fiyat ${signal.bollinger ? (signal.lastClose < signal.bollinger.lower ? 'ALT bantta' : signal.lastClose > signal.bollinger.upper ? 'ÜST bantta' : 'ORTA bantta') : 'bilinmiyor'}
- VWAP: Fiyat VWAP'ın ${signal.vwap?.priceVsVWAP === 'ABOVE' ? 'üstünde' : 'altında'} (%${signal.vwap?.distancePct})
- Hacim Profili POC: ${signal.volumeProfile?.poc} USDT (${signal.volumeProfile?.pocDistance}% uzakta)

MUM FORMASYONLARI:
${signal.candlePatterns?.patterns?.map(p => `- ${p.name}: ${p.desc}`).join('\n') || 'Belirgin formasyon yok'}

DIVERGENCE:
- Bullish: ${signal.divergence?.bullish ? 'VAR' : 'YOK'}
- Bearish: ${signal.divergence?.bearish ? 'VAR' : 'YOK'}
- Hidden Bullish: ${signal.divergence?.hidden_bullish ? 'VAR' : 'YOK'}

MTF CONFLUENCE:
- 4 TF Hizalı: ${signal.mtfDetay?.allAligned ? 'EVET' : 'HAYIR'}
- 15m: ${signal.mtfDetay?.dir15m > 0 ? 'AL' : signal.mtfDetay?.dir15m < 0 ? 'SAT' : 'NÖTR'}
- 1h: ${signal.mtfDetay?.dir1h > 0 ? 'AL' : signal.mtfDetay?.dir1h < 0 ? 'SAT' : 'NÖTR'}
- 4h: ${signal.mtfDetay?.dir4h > 0 ? 'AL' : signal.mtfDetay?.dir4h < 0 ? 'SAT' : 'NÖTR'}
- 1d: ${signal.mtfDetay?.dir1d > 0 ? 'AL' : signal.mtfDetay?.dir1d < 0 ? 'SAT' : 'NÖTR'}

PİYASA REJİMİ: ${signal.regime?.type}
DUYARLILIK: Fear&Greed ${signal.sentiment?.value} (${signal.sentiment?.label})

GEÇMİŞ PERFORMANS: ${pastPerformance}

TP/SL SEVİYELERİ (USDT):
- Stop Loss: ${signal.atr?.stopLoss} (-%${signal.atr?.stopLossPct})
- TP1: ${signal.atr?.takeProfit1} (+%${signal.atr?.tp1Pct})
- TP2: ${signal.atr?.takeProfit2} (+%${signal.atr?.tp2Pct})
- TP3: ${signal.atr?.takeProfit3} (+%${signal.atr?.tp3Pct})

Lütfen şunları değerlendir:
1. Bu sinyal gerçek mi yoksa manipülasyon mu? (0-10 arası manipülasyon riski)
2. En güçlü 3 AL sebebi nedir?
3. En büyük 2 risk faktörü nedir?
4. Genel değerlendirme: GÜÇLÜ AL / AL / BEKLE / RİSKLİ

JSON formatında yanıt ver:
{
  "manipulationRisk": 0-10,
  "reasons": ["sebep1", "sebep2", "sebep3"],
  "risks": ["risk1", "risk2"],
  "verdict": "GÜÇLÜ AL|AL|BEKLE|RİSKLİ",
  "summary": "kısa özet"
}`;

    const res = await axios.post('https://api.anthropic.com/v1/messages', {
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages:   [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      timeout: 15000
    });

    const text = res.data.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return fallbackAnalysis(signal);

  } catch (err) {
    console.log(`AI analiz hatasi ${signal.symbol}: ${err.message}`);
    return fallbackAnalysis(signal);
  }
}

// AI yokken kural tabanlı yedek analiz
function fallbackAnalysis(signal) {
  const reasons = [];
  const risks   = [];

  if (signal.divergence?.bullish)        reasons.push('Bullish divergence tespit edildi');
  if (signal.mtfDetay?.allAligned)       reasons.push('4 timeframe hizali');
  if (signal.candlePatterns?.hasBullish) reasons.push(signal.candlePatterns.patterns[0]?.name + ' formasyonu');
  if (signal.vwap?.bullish)              reasons.push('VWAP ustunde - kurumsal destek');
  if (signal.rsi < 35)                   reasons.push('RSI asiri satim bölgesinde');

  if (signal.divergence?.bearish)        risks.push('Bearish divergence mevcut');
  if (!signal.mtfKonfirm)                risks.push('MTF konfirmasyonu zayif');
  if (signal.volume?.isLow)              risks.push('Dusuk hacim - hareket gucsuz olabilir');

  const verdict = signal.score >= 8 ? 'GÜÇLÜ AL' :
                  signal.score >= 5 ? 'AL' :
                  signal.score >= 3 ? 'BEKLE' : 'RİSKLİ';

  return {
    manipulationRisk: signal.score < 2 ? 7 : 3,
    reasons:          reasons.slice(0, 3),
    risks:            risks.slice(0, 2),
    verdict,
    summary:          `Skor: ${signal.score} | ${signal.signalStrength}`
  };
}

module.exports = { analyzeSignal };