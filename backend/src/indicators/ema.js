function ema(data, period) {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i-1] * (1-k));
  }
  return result;
}

function detectTrend(closes) {
  const ema20  = ema(closes, 20);
  const ema50  = ema(closes, 50);
  const ema200 = ema(closes, 200);

  const last    = closes.length - 1;
  const e20     = ema20[ema20.length-1];
  const e50     = ema50[ema50.length-1];
  const e200    = ema200[ema200.length-1];
  const price   = closes[last];

  const goldenCross = ema50[ema50.length-1] > ema200[ema200.length-1] &&
                      ema50[ema50.length-2] <= ema200[ema200.length-2];
  const deathCross  = ema50[ema50.length-1] < ema200[ema200.length-1] &&
                      ema50[ema50.length-2] >= ema200[ema200.length-2];

  let strength = 0;
  if (price > e20)  strength++;
  if (price > e50)  strength++;
  if (price > e200) strength++;
  if (e20 > e50)    strength++;
  if (e50 > e200)   strength++;

  let trend = 'YATAY';
  if      (strength >= 4) trend = 'GUCLU_YUKSELIS';
  else if (strength >= 3) trend = 'YUKSELIS';
  else if (strength <= 1) trend = 'DUSUS';
  else if (strength <= 0) trend = 'GUCLU_DUSUS';

  return {
    trend, strength,
    goldenCross, deathCross,
    ema20: parseFloat(e20.toFixed(4)),
    ema50: parseFloat(e50.toFixed(4)),
    ema200: parseFloat(e200.toFixed(4))
  };
}

module.exports = { ema, detectTrend };