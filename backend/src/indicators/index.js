const rsiModule     = require('./rsi');
const macdModule    = require('./macd');
const bollModule    = require('./bollinger');
const emaModule     = require('./ema');
const stochModule   = require('./stochRSI');
const atrModule     = require('./atr');
const srModule      = require('./supportResistance');
const volModule     = require('./volume');
const fibModule     = require('./fibonacci');
const divModule     = require('./divergence');
const candleModule  = require('./candlePatterns');
const vwapModule    = require('./vwap');
const anomalyModule = require('./anomaly');
const fvgModule     = require('./fvg');

function analyzeCandles(candles) {
  if (!candles || candles.length < 50) return null;

  const closes = candles.map(c => c.close);

  const rsi     = rsiModule.calculateRSI(closes, 14);
  const macd    = macdModule.calculateMACD(closes);
  const boll    = bollModule.calculateBollinger(closes, 20);
  const trend   = emaModule.detectTrend(closes);
  const stoch   = stochModule.calculateStochRSI(closes);
  const atr     = atrModule.calculateATR(candles);
  const sr      = srModule.findSupportResistance(candles);
  const vol     = volModule.analyzeVolume(candles);
  const fib     = fibModule.calculateFibonacci(candles);
  const div     = divModule.detectDivergence(candles, rsi);
  const candle  = candleModule.detectCandlePatterns(candles);
  const vwap    = vwapModule.calculateVWAP(candles);
  const volProf = vwapModule.calculateVolumeProfile(candles);
  const anomaly = anomalyModule.detectAnomaly(candles);
  const fvg     = fvgModule.detectFVG(candles);

  const lastRSI  = rsi[rsi.length-1];
  const lastMACD = {
    macd:      macd.macd[macd.macd.length-1],
    signal:    macd.signal[macd.signal.length-1],
    histogram: macd.histogram[macd.histogram.length-1]
  };
  const lastBoll  = boll[boll.length-1] || { upper:0, lower:0, middle:0 };
  const lastClose = closes[closes.length-1];

  const signals = [];
  let score     = 0;

  // ── RSI ──────────────────────────────────
  if (lastRSI < 30) { signals.push({ type:'BUY',  src:'RSI', reason:'RSI aşırı satım: '+lastRSI.toFixed(1) }); score += 2; }
  if (lastRSI > 70) { signals.push({ type:'SELL', src:'RSI', reason:'RSI aşırı alım: '+lastRSI.toFixed(1)  }); score -= 2; }

  // ── STOCH RSI ────────────────────────────
  if (stoch.lastK < 20 && stoch.lastK > stoch.prevK) { signals.push({ type:'BUY',  src:'STOCH', reason:'Stoch RSI döndü: '+stoch.lastK.toFixed(1) }); score += 2; }
  if (stoch.lastK > 80 && stoch.lastK < stoch.prevK) { signals.push({ type:'SELL', src:'STOCH', reason:'Stoch RSI döndü: '+stoch.lastK.toFixed(1) }); score -= 2; }

  // ── MACD ─────────────────────────────────
  if (lastMACD.histogram > 0 && macd.histogram[macd.histogram.length-2] < 0) { signals.push({ type:'BUY',  src:'MACD', reason:'MACD pozitife döndü' }); score += 1; }
  if (lastMACD.histogram < 0 && macd.histogram[macd.histogram.length-2] > 0) { signals.push({ type:'SELL', src:'MACD', reason:'MACD negatife döndü' }); score -= 1; }

  // ── BOLLINGER ────────────────────────────
  if (lastClose < lastBoll.lower) { signals.push({ type:'BUY',  src:'BB', reason:'BB alt bandı kırıldı' }); score += 1; }
  if (lastClose > lastBoll.upper) { signals.push({ type:'SELL', src:'BB', reason:'BB üst bandı kırıldı' }); score -= 1; }

  // ── EMA TREND ────────────────────────────
  if (trend.goldenCross) { signals.push({ type:'BUY',  src:'EMA', reason:'Golden Cross oluştu' }); score += 3; }
  if (trend.deathCross)  { signals.push({ type:'SELL', src:'EMA', reason:'Death Cross oluştu'  }); score -= 3; }
  if (trend.strength >= 4) { signals.push({ type:'BUY',  src:'EMA', reason:'Güçlü yükseliş trendi' }); score += 1; }
  if (trend.strength <= 1) { signals.push({ type:'SELL', src:'EMA', reason:'Güçlü düşüş trendi'   }); score -= 1; }

  // ── FİBONACCİ ────────────────────────────
  if (fib.atSupport)    { signals.push({ type:'BUY',  src:'FIB', reason:'Fibonacci destek: '+fib.nearestSupport    }); score += 2; }
  if (fib.atResistance) { signals.push({ type:'SELL', src:'FIB', reason:'Fibonacci direnç: '+fib.nearestResistance }); score -= 2; }

  // ── DESTEK/DİRENÇ ────────────────────────
  if (sr.nearestSupport    && sr.supportDistance    < 1) { signals.push({ type:'BUY',  src:'SR', reason:'Destek seviyesinde' }); score += 1; }
  if (sr.nearestResistance && sr.resistanceDistance < 1) { signals.push({ type:'SELL', src:'SR', reason:'Direnç seviyesinde' }); score -= 1; }

  // ── DIVERGENCE ───────────────────────────
  if (div.bullish)        { signals.push({ type:'BUY',  src:'DIV', reason:'Bullish divergence — gizli güç' }); score += 4; }
  if (div.hidden_bullish) { signals.push({ type:'BUY',  src:'DIV', reason:'Hidden bullish divergence'      }); score += 3; }
  if (div.bearish)        { signals.push({ type:'SELL', src:'DIV', reason:'Bearish divergence'             }); score -= 4; }
  if (div.hidden_bearish) { signals.push({ type:'SELL', src:'DIV', reason:'Hidden bearish divergence'      }); score -= 3; }

  // ── MUM FORMASYONU ───────────────────────
  score += candle.score;
  candle.patterns.forEach(p => signals.push({ type:p.type, src:'CANDLE', reason:p.name+': '+p.desc }));

  // ── VWAP ─────────────────────────────────
  if (vwap.vwap && lastClose > vwap.vwap && vwap.distancePct < 1) {
    signals.push({ type:'BUY', src:'VWAP', reason:'VWAP üstünde — kurumsal destek' }); score += 2;
  }
  if (vwap.vwap && lastClose < vwap.vwap) {
    signals.push({ type:'SELL', src:'VWAP', reason:'VWAP altında — satış baskısı' }); score -= 1;
  }

  // ── POC ──────────────────────────────────
  if (volProf.poc && Math.abs(volProf.pocDistance) < 1) {
    signals.push({ type:'BUY', src:'POC', reason:'POC seviyesinde — en güçlü destek' }); score += 2;
  }

  // ── FVG (YENİ) ───────────────────────────
  if (fvg.inBullishFVG) {
    signals.push({ type:'BUY', src:'FVG', reason:'Bullish FVG içinde — doldurma bölgesi' }); score += 3;
  }
  if (fvg.nearestBullish && fvg.bullishDist < 0.5) {
    signals.push({ type:'BUY', src:'FVG', reason:'Bullish FVG yakın: '+fvg.nearestBullish.bottom?.toFixed(4) }); score += 1;
  }
  if (fvg.inBearishFVG) {
    signals.push({ type:'SELL', src:'FVG', reason:'Bearish FVG içinde — satış bölgesi' }); score -= 2;
  }

  // ── ANOMALİ (YENİ) ───────────────────────
  if (anomaly.isAnomaly && anomaly.signal === 'MANIPULASYON') {
    score = Math.round(score * 0.3);
    signals.push({ type:'WARN', src:'ANOMALY', reason:'⚠ Manipülasyon tespiti: '+anomaly.reason });
  } else if (anomaly.isAnomaly && anomaly.signal === 'ASIRI_VOLATILITE') {
    score = Math.round(score * 0.6);
    signals.push({ type:'WARN', src:'ANOMALY', reason:'⚠ Aşırı volatilite: '+anomaly.reason });
  }

  // ── HACİM ONAYI ──────────────────────────
  if (vol.isHigh && score > 0) { signals.push({ type:'BUY',  src:'VOL', reason:'Yüksek hacim onay: '+vol.ratio+'x' }); score += 1; }
  if (vol.isHigh && score < 0) { signals.push({ type:'SELL', src:'VOL', reason:'Yüksek hacim onay: '+vol.ratio+'x' }); score -= 1; }
  if (vol.isLow  && Math.abs(score) > 0) score = Math.round(score * 0.7);

  // ── ÇELİŞKİ FİLTRESİ ────────────────────
  const buyCount  = signals.filter(s => s.type==='BUY').length;
  const sellCount = signals.filter(s => s.type==='SELL').length;
  if (buyCount > 0 && sellCount >= buyCount) score = 0;

  // ── SİNYAL KUVVETİ ───────────────────────
  let overallSignal  = 'NEUTRAL';
  let signalStrength = 'NOTR';
  if      (score >= 8)  { overallSignal='STRONG_BUY';  signalStrength='COK_GUCLU_AL';  }
  else if (score >= 5)  { overallSignal='STRONG_BUY';  signalStrength='GUCLU_AL';      }
  else if (score >= 3)  { overallSignal='BUY';         signalStrength='ORTA_AL';       }
  else if (score >= 1)  { overallSignal='BUY';         signalStrength='ZAYIF_AL';      }
  else if (score <= -8) { overallSignal='STRONG_SELL'; signalStrength='COK_GUCLU_SAT'; }
  else if (score <= -5) { overallSignal='STRONG_SELL'; signalStrength='GUCLU_SAT';     }
  else if (score <= -3) { overallSignal='SELL';        signalStrength='ORTA_SAT';      }
  else if (score <= -1) { overallSignal='SELL';        signalStrength='ZAYIF_SAT';     }

  // ── TP/SL ─────────────────────────────────
  const tp1 = atr ? parseFloat((lastClose + atr.lastATR * 2  ).toFixed(4)) : null;
  const tp2 = atr ? parseFloat((lastClose + atr.lastATR * 3  ).toFixed(4)) : null;
  const tp3 = atr ? parseFloat((lastClose + atr.lastATR * 5  ).toFixed(4)) : null;
  const sl  = atr ? parseFloat((lastClose - atr.lastATR * 1.5).toFixed(4)) : null;

  const tp1Pct = atr ? parseFloat((atr.lastATR*2   /lastClose*100).toFixed(2)) : 0;
  const tp2Pct = atr ? parseFloat((atr.lastATR*3   /lastClose*100).toFixed(2)) : 0;
  const tp3Pct = atr ? parseFloat((atr.lastATR*5   /lastClose*100).toFixed(2)) : 0;
  const slPct  = atr ? parseFloat((atr.lastATR*1.5 /lastClose*100).toFixed(2)) : 0;
  const rr     = slPct > 0 ? parseFloat((tp1Pct/slPct).toFixed(2)) : 0;

  return {
    lastClose,
    rsi:              parseFloat(lastRSI.toFixed(2)),
    macd:             lastMACD,
    bollinger:        lastBoll,
    trend,
    stochRSI:         { k:stoch.lastK, d:stoch.lastD },
    atr:              { ...atr, takeProfit1:tp1, takeProfit2:tp2, takeProfit3:tp3,
                        stopLoss:sl, tp1Pct, tp2Pct, tp3Pct, stopLossPct:slPct, riskReward:rr },
    supportResistance: sr,
    fibonacci:        fib,
    volume:           vol,
    divergence:       div,
    candlePatterns:   candle,
    vwap,
    volumeProfile:    volProf,
    anomaly,
    fvg,
    signals,
    score,
    overallSignal,
    signalStrength
  };
}

// ── FIRSAT SKORU ─────────────────────────────────
function calcFirsatSkoru(signal) {
  let skor = 0;
  const s = signal;

  // Teknik Analiz (max 20)
  const teknik = Math.min(Math.max((s.score1h || 0) * 3, 0), 20);
  skor += teknik;

  // MTF Confluence (max 20)
  if (s.mtfDetay?.allAligned)   skor += 20;
  else if (s.mtfKonfirm)        skor += 12;
  else if (s.score4h > 0)       skor += 6;

  // Divergence (max 15)
  if (s.divergence?.bullish)        skor += 15;
  else if (s.divergence?.hidden_bullish) skor += 10;

  // Mum Formasyonu (max 10)
  if (s.candlePatterns?.hasBullish) {
    skor += Math.min((s.candlePatterns.score || 0) * 2, 10);
  }

  // VWAP + POC (max 10)
  if (s.vwap?.bullish && s.volumeProfile?.poc) skor += 10;
  else if (s.vwap?.bullish)                    skor += 6;
  else if (s.volumeProfile?.poc && Math.abs(s.volumeProfile.pocDistance) < 1) skor += 4;

  // FVG (max 8)
  if (s.fvg?.inBullishFVG)  skor += 8;
  else if (s.fvg?.hasBullishFVG && s.fvg.bullishDist < 1) skor += 4;

  // AI Verdict (max 15)
  if (s.ai?.verdict === 'GÜÇLÜ AL') skor += 15;
  else if (s.ai?.verdict === 'AL')   skor += 10;
  else if (s.ai?.verdict === 'BEKLE') skor += 3;
  else if (s.ai?.verdict === 'RİSKLİ') skor -= 5;

  // F&G Contrarian (max 10)
  const fg = s.sentiment?.value || 50;
  if (fg <= 20) skor += 10;
  else if (fg <= 35) skor += 6;
  else if (fg >= 80) skor -= 5;

  // Arbitraj fırsatı (max 8)
  if (s.arbitraj?.signal === 'GUCLU_FIRSAT') skor += 8;
  else if (s.arbitraj?.signal === 'FIRSAT')  skor += 4;
  else if (s.arbitraj?.isOverpriced)         skor -= 3;

  // Footprint delta (max 8)
  if (s.footprint?.strongBull)   skor += 8;
  else if (s.footprint?.bullishDelta) skor += 4;
  else if (s.footprint?.strongBear)  skor -= 5;

  // Anomali cezası
  if (s.anomaly?.signal === 'MANIPULASYON')    skor -= 20;
  else if (s.anomaly?.signal === 'ASIRI_VOLATILITE') skor -= 10;
  else if (s.anomaly?.signal === 'ANI_HAREKET') skor -= 5;

  // Z-Score düzeltmesi
  if (s.anomaly?.isAnomaly) skor = Math.round(skor * 0.5);

  const final = Math.min(Math.max(Math.round(skor), 0), 100);

  let seviye = 'BEKLE';
  let emoji  = '⏳';
  if      (final >= 80) { seviye = 'NADİR FIRSAT';  emoji = '🔥'; }
  else if (final >= 65) { seviye = 'GÜÇLÜ FIRSAT';  emoji = '✅'; }
  else if (final >= 50) { seviye = 'İYİ FIRSAT';    emoji = '👍'; }
  else if (final >= 35) { seviye = 'ORTA';           emoji = '⏳'; }
  else                  { seviye = 'HENÜZ DEĞİL';   emoji = '❌'; }

  return { skor: final, seviye, emoji };
}

module.exports = { analyzeCandles, calcFirsatSkoru };