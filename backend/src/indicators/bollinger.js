function calculateBollinger(closes, period) {
  if (!period) period = 20;
  const result = [];
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mid   = slice.reduce((a,b) => a+b, 0) / period;
    const std   = Math.sqrt(slice.map(c => Math.pow(c-mid,2)).reduce((a,b)=>a+b,0) / period);
    result.push({
      upper:  parseFloat((mid + std*2).toFixed(4)),
      middle: parseFloat(mid.toFixed(4)),
      lower:  parseFloat((mid - std*2).toFixed(4))
    });
  }
  return result;
}

module.exports = { calculateBollinger };