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

  /** PPT motoru: TF yönü — EMA gücü + RSI; eski çoklu gösterge skoru kaldırıldı. */
  const signals = [];
  let score = (trend.strength - 2) * 2;
  if (lastRSI < 35) score += 2;
  if (lastRSI > 65) score -= 2;
  if (anomaly.isAnomaly && anomaly.signal === 'MANIPULASYON') {
    score = Math.round(score * 0.3);
    signals.push({ type: 'WARN', src: 'ANOMALY', reason: '⚠ Manipülasyon: ' + anomaly.reason });
  } else if (anomaly.isAnomaly && anomaly.signal === 'ASIRI_VOLATILITE') {
    score = Math.round(score * 0.6);
    signals.push({ type: 'WARN', src: 'ANOMALY', reason: '⚠ Aşırı volatilite: ' + anomaly.reason });
  }
  score = Math.max(-8, Math.min(8, score));
  signals.push({
    type: 'INFO',
    src: 'PPT',
    reason: 'TF yön skoru (EMA/RSI); fırsat skoru kriptoAnalizSistemi ile hesaplanır.'
  });

  // ── SİNYAL KUVVETİ (sadece yön skoruna göre) ──
  let overallSignal  = 'NEUTRAL';
  let signalStrength = 'NOTR';
  if      (score >= 5)  { overallSignal='STRONG_BUY';  signalStrength='COK_GUCLU_AL';  }
  else if (score >= 3)  { overallSignal='STRONG_BUY';  signalStrength='GUCLU_AL';      }
  else if (score >= 2)  { overallSignal='BUY';         signalStrength='ORTA_AL';       }
  else if (score >= 1)  { overallSignal='BUY';         signalStrength='ZAYIF_AL';      }
  else if (score <= -5) { overallSignal='STRONG_SELL'; signalStrength='COK_GUCLU_SAT'; }
  else if (score <= -3) { overallSignal='STRONG_SELL'; signalStrength='GUCLU_SAT';     }
  else if (score <= -2) { overallSignal='SELL';        signalStrength='ORTA_SAT';      }
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

module.exports = { analyzeCandles };