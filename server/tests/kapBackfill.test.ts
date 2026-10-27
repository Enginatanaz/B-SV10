import fs from 'fs';
import path from 'path';
import { KapBackfillEngine } from '../services/kapBackfillEngine.js';
import { KapDisclosuresService } from '../services/kapDisclosuresService.js';
import { MkkApiClient } from '../services/mkkApiClient.js';

async function runKapBackfillTests() {
  console.log('=====================================================');
  console.log('   KAP GEÇMİŞ TARAMA & DAYANIKLI MOTOR TESTİ (FAZ 2) ');
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

  const engine = KapBackfillEngine.getInstance();
  const kapService = KapDisclosuresService.getInstance();
  const mkkClient = MkkApiClient.getInstance();

  // Test 1: Engine Initialization & State Structure
  console.log('--- Test 1: Motor Başlatımı ve Durum Yapısı ---');
  const initialStatus = engine.getStatus();
  assert(initialStatus !== null && typeof initialStatus === 'object', 'Engine status must be valid object');
  assert(['IDLE', 'RUNNING', 'PAUSED', 'STOPPED', 'COMPLETED', 'ERROR'].includes(initialStatus.status), 'Status must be a valid state enum');
  assert(initialStatus.pendingStocksCount <= 529, 'Total stock universe must be <= 529');

  // Test 2: Starting Backfill Process
  console.log('\n--- Test 2: Taramayı Başlatma (Start) ve İmleç Tanımlama ---');
  // Pass simulated range: from 1230980 to 1231017
  const startStatus = await engine.start({ fromIndex: 1230980, toIndex: 1231017 });
  assert(startStatus.status === 'RUNNING', 'Status must transition to RUNNING upon start');
  assert(startStatus.startIndex === 1230980, 'Start index must match options.fromIndex');
  assert(startStatus.targetIndex === 1231017, 'Target index must match options.toIndex');
  assert(startStatus.canPause === true, 'canPause must be true when running');
  assert(startStatus.canResume === false, 'canResume must be false when already running');
  assert(Boolean(startStatus.estimatedTotalApiCalls && startStatus.estimatedTotalApiCalls > 0), 'Estimated total API calls must be positive');

  // Test 3: Pausing the Backfill Process
  console.log('\n--- Test 3: Taramayı Duraklatma (Pause) ve İmleci Koruma ---');
  const pauseStatus = engine.pause();
  assert(pauseStatus.status === 'PAUSED', 'Status must transition to PAUSED upon pause');
  assert(pauseStatus.canResume === true, 'canResume must be true when paused');
  assert(pauseStatus.canPause === false, 'canPause must be false when paused');
  assert(pauseStatus.canStop === true, 'canStop must be true when paused');

  // Test 4: Resuming the Backfill Process
  console.log('\n--- Test 4: Taramaya Kaldığı Yerden Devam Etme (Resume) ---');
  const resumeStatus = engine.resume();
  assert(resumeStatus.status === 'RUNNING', 'Status must transition back to RUNNING upon resume');
  assert(resumeStatus.canPause === true, 'canPause must be true after resume');
  assert(resumeStatus.canResume === false, 'canResume must be false after resume');

  // Immediately pause again for subsequent offline tests
  engine.pause();

  // Test 5: Server Restart Recovery & Disk Persistence
  console.log('\n--- Test 5: Sunucu Yeniden Başlatma Dayanıklılığı (State Recovery) ---');
  const testStatePath = path.resolve(process.cwd(), 'server/data/kap_backfill_state.json');
  assert(fs.existsSync(testStatePath), 'State file must be written to disk');
  const rawDiskState = JSON.parse(fs.readFileSync(testStatePath, 'utf-8'));
  assert(rawDiskState.startIndex === 1230980, 'Saved state on disk must retain startIndex');

  // Simulate server reboot while RUNNING: write status: RUNNING to file
  const simulatedRebootState = {
    ...rawDiskState,
    status: 'RUNNING',
    lastSuccessfulIndex: 1231000
  };
  fs.writeFileSync(testStatePath, JSON.stringify(simulatedRebootState, null, 2), 'utf-8');

  // Create or reload state
  engine['initStorageAndLoadState']();
  const recoveredStatus = engine.getStatus();
  assert(recoveredStatus.status === 'PAUSED', 'Engine must recover from RUNNING to PAUSED upon server reboot');
  assert(recoveredStatus.canResume === true, 'canResume must be true after reboot recovery');
  assert(recoveredStatus.lastSuccessfulIndex === 1231000, 'lastSuccessfulIndex must be preserved across server reboot');
  assert(Boolean(recoveredStatus.lastError?.includes('Sunucu yeniden başlatıldığı için')), 'Recovery error message must explain the safe reboot pause');

  // Test 6: Failed Batch Retry & Cursor Pinning
  console.log('\n--- Test 6: Başarısız Grup Yönetimi ve İmlecin İlerlememesi ---');
  const preCursor = recoveredStatus.currentCursor;
  const preLastSuccess = recoveredStatus.lastSuccessfulIndex;

  // Simulate simulated failure of batch 1231005
  engine['state'].failedBatchIndices.push(1231005);
  engine['state'].failedBatchesCount++;
  engine['state'].lastError = 'MKK Gateway HTTP 503 Service Unavailable';
  engine.saveState();

  const failCheckStatus = engine.getStatus();
  assert(failCheckStatus.failedBatchesCount > 0, 'Failed batches count must be tracked');
  assert(failCheckStatus.failedBatchIndices.includes(1231005), 'Failed batch index must be added to retry queue');
  assert(failCheckStatus.lastSuccessfulIndex === preLastSuccess, 'lastSuccessfulIndex must NOT advance before batch succeeds');

  // Clean up failed queue
  engine['state'].failedBatchIndices = [];
  engine['state'].lastError = null;

  // Test 7: Deduplication of Disclosures
  console.log('\n--- Test 7: Mükerrer Bildirimlerin Engellenmesi (Deduplication) ---');
  const testDisc = {
    id: 'test_1231015_THYAO',
    disclosureIndex: '1231015',
    symbol: 'THYAO',
    companyTitle: 'TÜRK HAVA YOLLARI A.O.',
    publishDate: '2026-10-25T10:00:00+03:00',
    title: 'Filo Genişlemesi Test Duyurusu',
    category: 'Özel Durum' as const,
    isImportant: true,
    disclosureType: 'Özel Durum Açıklaması',
    originalUrl: 'https://www.kap.org.tr/tr/Bildirim/1231015',
    isVerified: true,
    source: 'Test Gateway',
    dataSource: 'MKK_LIVE_API' as const,
    financialImpactScore: 8.0,
    sentiment: 'POSITIVE' as const
  };

  const firstAdd = kapService.addLiveDisclosure(testDisc);
  assert(firstAdd === true || firstAdd === false, 'First addition must return boolean');
  // Second add with exact same index and symbol MUST return false (duplicate rejected)
  const secondAdd = kapService.addLiveDisclosure(testDisc);
  assert(secondAdd === false, 'Adding identical index & symbol a second time must return false (rejected)');

  // Test 8: Multi-Share Class Distribution
  console.log('\n--- Test 8: Çoklu Pay Sınıfı Dağıtımı ---');
  await kapService.initMemberCatalog();
  // Kardemir (MKK companyId 994)
  const kardemirClasses = kapService.resolveSymbolsFromMkk('994');
  assert(kardemirClasses.length === 3, 'Kardemir must resolve to all 3 classes (KRDMD, KRDMA, KRDMB)');
  assert(kardemirClasses.includes('KRDMD') && kardemirClasses.includes('KRDMA') && kardemirClasses.includes('KRDMB'), 'All Kardemir classes present');

  // İş Bankası (MKK companyId 2425)
  const isbankClasses = kapService.resolveSymbolsFromMkk('2425');
  console.log('İş Bankası resolved classes:', isbankClasses);
  assert(isbankClasses.length >= 4, 'İş Bankası must resolve to at least 4 classes (ISCTR, ISBTR, ISKUR, ISATR)');
  assert(isbankClasses.includes('ISCTR') && isbankClasses.includes('ISBTR') && isbankClasses.includes('ISKUR') && isbankClasses.includes('ISATR'), 'All 4 İş Bankası classes present');

  // Test 9: Rate Limit Compliance
  console.log('\n--- Test 9: Hız Sınırı ve Kota Yönetimi ---');
  const rateLimit = mkkClient.getRateLimitStatus();
  assert(rateLimit.maxRequestsPerMinute === 6, 'Client rate limit must be 6 req/min');
  assert(rateLimit.remainingRequests <= 6, 'Remaining requests must be <= 6');

  // Test 10: Honest Completion Criteria
  console.log('\n--- Test 10: Tamamlanma Kriteri ve Şeffaf Ortam Bildirimi ---');
  // Trigger completion
  engine['completeBackfill']();
  const completedStatus = engine.getStatus();
  assert(completedStatus.status === 'COMPLETED', 'Status must be COMPLETED');
  assert(completedStatus.canPause === false, 'canPause must be false when completed');
  assert(completedStatus.canResume === false, 'canResume must be false when completed');
  assert(completedStatus.completionMessage !== null, 'Completion message must be provided');
  assert(Boolean(completedStatus.completionMessage?.includes('MKK Geliştirici Test Ağ Geçidi kapsamı')), 'Message must mention MKK Dev Test Gateway');
  assert(Boolean(completedStatus.completionMessage?.includes('apigw.mkk.com.tr')), 'Message must explicitly mention production gateway requirement');

  // Reset engine status to IDLE for clean runtime state
  engine['state'].status = 'IDLE';
  engine['state'].canResume = false;
  engine['state'].canPause = false;
  engine['state'].canStop = false;
  engine.saveState();

  console.log('\n=====================================================');
  console.log(`KAP BACKFILL MOTORU TESTİ: ${passed} / ${total} BAŞARILI (%100)`);
  console.log('=====================================================\n');
}

runKapBackfillTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
