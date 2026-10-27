import { KapDisclosuresService } from '../services/kapDisclosuresService.js';
import { InstrumentUniverseService } from '../services/instrumentUniverseService.js';
import { MkkApiClient } from '../services/mkkApiClient.js';

async function runKap529AuditTests() {
  console.log('=====================================================');
  console.log('   BIST 529 HİSSE MKK/KAP ENTEGRASYON VE AKIŞ DENETİM TESTİ');
  console.log('=====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, details?: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${details ? ` -> ${details}` : ''}`);
      throw new Error(`Test Failed: ${testName} -> ${details || ''}`);
    }
  }

  const kapService = KapDisclosuresService.getInstance();
  const universeService = InstrumentUniverseService.getInstance();
  const mkkClient = MkkApiClient.getInstance();

  // Test 1: Full 529 Stocks Universe Completeness
  console.log('--- Test 1: BIST 529 Hisse Evreni Kapsamı ---');
  const allInstruments = universeService.getAllInstruments();
  assert(allInstruments.length === 529, 'Total universe instruments must be exactly 529', `Found: ${allInstruments.length}`);

  // Test 2: Full Audit Report Generation
  console.log('\n--- Test 2: Kapsamlı 529 Hisse Denetim Raporu Üretimi ---');
  const report = await kapService.generateFullUniverseAuditReport();
  assert(report.stocks.length === 529, 'Audit report must contain exactly 529 stock entries', `Found: ${report.stocks.length}`);
  assert(report.summary.totalCatalogStocks === 529, 'Summary totalCatalogStocks must equal 529');
  assert(report.summary.matchedCount === 527, 'Summary matchedCount must equal 527', `Was: ${report.summary.matchedCount}`);
  assert(report.summary.unmatchedCount === 2, 'Summary unmatchedCount must equal 2', `Was: ${report.summary.unmatchedCount}`);
  assert(report.summary.conflictingStocksCount === 0, 'Summary conflictingStocksCount must equal 0');
  assert(report.summary.perStockApiCallsMade === 0, 'Must require ZERO API calls per stock');

  // Test 3: Unmatched Stocks Verification
  console.log('\n--- Test 3: Eşleşmeyen Hisseler ve Gerekçeleri ---');
  const unmatched = report.stocks.filter(s => s.matchStatus === 'UNMATCHED');
  assert(unmatched.length === 2, 'Exactly 2 stocks must be UNMATCHED', `Found: ${unmatched.length}`);
  const mipaz = unmatched.find(s => s.symbol === 'MIPAZ');
  assert(Boolean(mipaz && mipaz.missingOrSuspiciousStatus === 'DELISTED_HALTED'), 'MIPAZ must be classified as DELISTED_HALTED');
  const mopas = unmatched.find(s => s.symbol === 'MOPAS');
  assert(Boolean(mopas && mopas.missingOrSuspiciousStatus === 'SUSPICIOUS_UNMATCHED'), 'MOPAS must be classified as SUSPICIOUS_UNMATCHED');

  // Test 4: Multi-Share Class Distribution (ISCTR and KRDMD Families)
  console.log('\n--- Test 4: Çoklu Pay Sınıfı Dağıtımı ve Teyidi ---');
  const isctr = report.stocks.find(s => s.symbol === 'ISCTR');
  assert(Boolean(isctr && isctr.hasMultipleShareClasses), 'ISCTR must report multiple share classes');
  assert(Boolean(isctr?.shareClassSiblings?.includes('ISBTR')), 'ISCTR siblings must include ISBTR');
  assert(Boolean(isctr?.shareClassSiblings?.includes('ISKUR')), 'ISCTR siblings must include ISKUR');
  assert(Boolean(isctr?.shareClassSiblings?.includes('ISATR')), 'ISCTR siblings must include ISATR');

  const krdmd = report.stocks.find(s => s.symbol === 'KRDMD');
  assert(Boolean(krdmd && krdmd.hasMultipleShareClasses), 'KRDMD must report multiple share classes');
  assert(Boolean(krdmd?.shareClassSiblings?.includes('KRDMA')), 'KRDMD siblings must include KRDMA');
  assert(Boolean(krdmd?.shareClassSiblings?.includes('KRDMB')), 'KRDMD siblings must include KRDMB');

  // Test 5: Multi-Symbol Resolution Functionality
  console.log('\n--- Test 5: resolveSymbolsFromMkk Çoklu Dağıtım Mantığı ---');
  // General company announcement for Kardemir (companyId 994) without memberCode -> maps to all classes
  const kardemirClasses = kapService.resolveSymbolsFromMkk('994');
  assert(kardemirClasses.length === 3, 'Kardemir without specific class must resolve to all 3 classes', `Got: ${kardemirClasses.join(', ')}`);
  assert(kardemirClasses.includes('KRDMD') && kardemirClasses.includes('KRDMA') && kardemirClasses.includes('KRDMB'), 'All 3 Kardemir classes must be present');

  // Class-specific announcement for KRDMA
  const krdmaSpecific = kapService.resolveSymbolsFromMkk('994', 'KRDMA');
  assert(krdmaSpecific.length === 1 && krdmaSpecific[0] === 'KRDMA', 'KRDMA specific code must resolve only to KRDMA');

  // Multi-symbol comma list in relatedStocks
  const multiRelated = kapService.resolveSymbolsFromMkk('994', undefined, undefined, ['KRDMA', 'KRDMD']);
  assert(multiRelated.length === 2 && multiRelated.includes('KRDMA') && multiRelated.includes('KRDMD'), 'relatedStocks with 2 classes must resolve to both');

  // Test 6: CSV Export Validation
  console.log('\n--- Test 6: İndirilebilir UTF-8 CSV Raporu Doğrulaması ---');
  const csv = kapService.generateAuditCsv(report);
  assert(csv.startsWith('\uFEFF'), 'CSV must start with UTF-8 BOM (\uFEFF) for Excel compatibility');
  const lines = csv.split('\r\n').filter(Boolean);
  assert(lines.length === 530, `CSV must have exactly 530 lines (1 header + 529 stocks), found ${lines.length}`);
  assert(lines[0].includes('BIST Hisse Kodu'), 'CSV header must include BIST Hisse Kodu');
  assert(lines[0].includes('MKK Şirket ID'), 'CSV header must include MKK Şirket ID');
  assert(lines[0].includes('Çoklu Pay Sınıfı Var mı'), 'CSV header must include Çoklu Pay Sınıfı Var mı');

  // Test 7: Unmatched Disclosures Pool Preservation
  console.log('\n--- Test 7: Eşleştirilemeyen Bildirimlerin Korunması ---');
  const unmatchedPool = kapService.getUnmatchedDisclosures();
  assert(Array.isArray(unmatchedPool), 'Unmatched pool must return an array');

  // Test 8: Rate Limiting & API Quota Protection
  console.log('\n--- Test 8: Hız Sınırı (Rate Limit) ve Kota Koruma ---');
  const rateLimit = mkkClient.getRateLimitStatus();
  assert(rateLimit.maxRequestsPerMinute === 6, 'Rate limiter must enforce 6 req/min');
  assert(report.summary.perStockApiCallsMade === 0, 'Per-stock API calls must be 0');

  // Test 9: Environment Distinction
  console.log('\n--- Test 9: Test vs Canlı Ortam Ayrımı ---');
  assert(report.summary.environment === 'MKK_DEV_TEST_GATEWAY', 'Environment must be correctly identified as MKK_DEV_TEST_GATEWAY');
  assert(report.summary.isProductionEnvironment === false, 'isProductionEnvironment must be false');
  assert(report.summary.environmentNotice.includes('apigwdev.mkk.com.tr'), 'Environment notice must mention apigwdev.mkk.com.tr');

  console.log('\n=====================================================');
  console.log(`BIST 529 HİSSE DENETİM TESTİ: ${passed} / ${total} BAŞARILI (%100)`);
  console.log('=====================================================\n');
}

runKap529AuditTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
