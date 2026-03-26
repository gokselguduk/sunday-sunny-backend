function calculateFibonacci(candles) {
  const slice  = candles.slice(-50);
  const highs  = slice.map(c => c.high);
  const lows   = slice.map(c => c.low);
  const high   = Math.max(...highs);
  const low    = Math.min(...lows);
  const diff   = high - low;
  const last   = candles[candles.length-1].close;

  const levels = {
    fib0:    parseFloat(low.toFixed(4)),
    fib236:  parseFloat((low + diff * 0.236).toFixed(4)),
    fib382:  parseFloat((low + diff * 0.382).toFixed(4)),
    fib500:  parseFloat((low + diff * 0.500).toFixed(4)),
    fib618:  parseFloat((low + diff * 0.618).toFixed(4)),
    fib786:  parseFloat((low + diff * 0.786).toFixed(4)),
    fib1:    parseFloat(high.toFixed(4))
  };

  const tolerance = diff * 0.02;
  let nearestSupport    = null;
  let nearestResistance = null;
  let atSupport         = false;
  let atResistance      = false;

  Object.values(levels).forEach(lvl => {
    if (lvl < last) {
      if (!nearestSupport || lvl > nearestSupport) nearestSupport = lvl;
    } else {
      if (!nearestResistance || lvl < nearestResistance) nearestResistance = lvl;
    }
    if (Math.abs(last - lvl) <= tolerance) {
      if (lvl <= last) atSupport    = true;
      else             atResistance = true;
    }
  });

  return { ...levels, nearestSupport, nearestResistance, atSupport, atResistance };
}

module.exports = { calculateFibonacci };
