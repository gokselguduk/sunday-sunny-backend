const { SYSTEM_ID, SYSTEM_VERSION, KAYNAK_DOKUMAN, EVRENSEL_KURALLAR, PSIKOLOJI_UYARILARI } = require('./constants');
const { detectSeason } = require('./seasonDetector');
const { buildMtfUyumu } = require('./mtfUyumu');
const { buildHacimFiyat } = require('./hacimFiyat');
const { buildMakroKatman } = require('./makroKatman');
const { buildOnChainKatman } = require('./onChainKatman');
const { buildRiskOzet } = require('./riskOzet');
const { buildChecklist20 } = require('./checklist20');
const { buildPptAsamalari } = require('./pptAsamalar');
const { deriveFirsatFromKriptoAnaliz, runnerFromKripto, aiOzetiFromKripto } = require('./firsatSkoru');

/**
 * PPT ile hizalı birleşik analiz çıktısı (tahta sinyal objesine eklenir).
 * @param {object} signal — scanner’dan tam nitelikli sinyal
 * @param {object} [ctx] — { makro, onChain } isteğe bağlı dış veri
 */
function buildKriptoAnaliz(signal, ctx = {}) {
  if (!signal || typeof signal !== 'object') return null;

  const sezon = detectSeason(signal);
  const mtfUyumu = buildMtfUyumu(signal);
  const hacimFiyat = buildHacimFiyat(signal);
  const makroKatman = buildMakroKatman(signal, ctx);
  const onChainKatman = buildOnChainKatman(signal, ctx);
  const riskOzet = buildRiskOzet(signal);
  const checklist = buildChecklist20(signal, mtfUyumu, makroKatman, onChainKatman);

  const core = {
    systemId: SYSTEM_ID,
    systemVersion: SYSTEM_VERSION,
    kaynakDokuman: KAYNAK_DOKUMAN,
    ozetCumle:
      'Garantiye en yakın analiz = çoklu katman uyumu (PPT Slayt 18). Bu nesne katmanları tek çatıda toplar.',
    sezon,
    mtfUyumu,
    hacimFiyat,
    makroKatman,
    onChainKatman,
    riskOzet,
    checklist20: checklist,
    evrenselKurallar: EVRENSEL_KURALLAR,
    psikolojiUyarilari: PSIKOLOJI_UYARILARI,
    emirVeOlcekNot:
      'Market/limit/OCO/trailing/TWAP — PPT Slayt 13; kademeli giriş-çıkış kullanıcı disiplinine bağlı.'
  };
  return {
    ...core,
    pptAsamalari: buildPptAsamalari(core)
  };
}

module.exports = {
  buildKriptoAnaliz,
  deriveFirsatFromKriptoAnaliz,
  runnerFromKripto,
  aiOzetiFromKripto
};
