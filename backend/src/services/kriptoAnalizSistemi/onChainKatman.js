/**
 * PPT Slayt 3–7, 17 — On-chain (Glassnode ile BTC; altlar için BTC yankısı).
 */
function buildOnChainKatman(signal, ctx = {}) {
  const base = signal.base || signal.symbol?.replace(/USDT$/i, '') || '';
  const btcOdak = base === 'BTC';
  const oc = ctx.onChain;

  if (oc && typeof oc === 'object' && oc.entegre) {
    if (btcOdak) {
      return {
        entegre: true,
        kaynak: oc.kaynak,
        fetchedAt: oc.fetchedAt,
        metrikler: oc.metrikler,
        parite: 'BTC',
        cached: oc.cached
      };
    }
    return {
      entegre: true,
      btcEcho: true,
      kaynak: oc.kaynak,
      fetchedAt: oc.fetchedAt,
      metrikler: oc.metrikler,
      parite: base,
      pariteNot:
        'BTC on-chain metrikleri (MVRV, NUPL, SOPR) bu parite için bağlam olarak kullanılır; PPT altcoin notu.',
      cached: oc.cached
    };
  }

  return {
    entegre: false,
    reason: oc?.reason || 'GLASSNODE_API_KEY yok veya veri alınamadı',
    slaytlar: '3–7, 17',
    pariteNot: btcOdak
      ? 'BTC: GLASSNODE_API_KEY ile MVRV / NUPL / SOPR dolar.'
      : 'Altcoin: BTC metrikleri bağlanınca yankı olarak gösterilir.',
    beklenenMetrikler: [
      'MVRV Z-Score',
      'NUPL',
      'SOPR',
      'Exchange flows / LTH (ileride genişletilebilir)'
    ]
  };
}

module.exports = { buildOnChainKatman };
