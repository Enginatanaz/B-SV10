import fs from 'fs';
import path from 'path';
import { KAPBackfillStatus, KAPDisclosure, UnmatchedKAPDisclosure } from '../types.js';
import { MkkApiClient } from './mkkApiClient.js';
import { KapDisclosuresService } from './kapDisclosuresService.js';
import { InstrumentUniverseService } from './instrumentUniverseService.js';

export class KapBackfillEngine {
  private static instance: KapBackfillEngine;

  private mkkClient: MkkApiClient;
  private kapService: KapDisclosuresService;
  private universeService: InstrumentUniverseService;

  private stateFilePath: string;
  private activeTimer: NodeJS.Timeout | null = null;
  private isTickInProgress = false;

  // Track distinct stocks that received at least one disclosure
  private touchedStocks: Set<string> = new Set();

  private state: KAPBackfillStatus = {
    status: 'IDLE',
    mode: 'HISTORICAL_DEEP_SCAN',
    startIndex: 0,
    targetIndex: 0,
    currentCursor: 0,
    lastSuccessfulIndex: null,
    processedBatchesCount: 0,
    pendingBatchesCount: 0,
    failedBatchesCount: 0,
    failedBatchIndices: [],
    totalDisclosuresFetched: 0,
    newDisclosuresSaved: 0,
    duplicateDisclosuresSkipped: 0,
    unmatchedDisclosuresCount: 0,
    processedStocksCount: 0,
    stocksWithDisclosuresCount: 0,
    pendingStocksCount: 529,
    totalApiCallsCount: 0,
    lastApiCallTimestamp: null,
    lastSuccessfulApiCallTimestamp: null,
    lastError: null,
    retryCount: 0,
    estimatedTotalApiCalls: null,
    estimatedApiNotice: 'MKK dakikada 6 çağrı sınırına uygun olarak her 10 saniyede bir toplu indeks grubu taranır (0 hisse başı API çağrısı).',
    startedAt: null,
    completedAt: null,
    dataSource: 'MKK_DEV_TEST_GATEWAY',
    completionMessage: null,
    canResume: false,
    canPause: false,
    canStop: false
  };

  constructor() {
    this.mkkClient = MkkApiClient.getInstance();
    this.kapService = KapDisclosuresService.getInstance();
    this.universeService = InstrumentUniverseService.getInstance();

    this.stateFilePath = path.resolve(process.cwd(), 'server/data/kap_backfill_state.json');
    this.initStorageAndLoadState();
  }

  public static getInstance(): KapBackfillEngine {
    if (!KapBackfillEngine.instance) {
      KapBackfillEngine.instance = new KapBackfillEngine();
    }
    return KapBackfillEngine.instance;
  }

  /**
   * Initializes data directory and restores saved progress if available.
   * If server previously restarted mid-run, sets status to PAUSED with canResume: true.
   */
  private initStorageAndLoadState(): void {
    try {
      const dir = path.dirname(this.stateFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.stateFilePath)) {
        const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.state = {
            ...this.state,
            ...parsed
          };

          // If was running before server rebooted, recover safely into PAUSED
          if (this.state.status === 'RUNNING') {
            this.state.status = 'PAUSED';
            this.state.canResume = true;
            this.state.canPause = false;
            this.state.canStop = true;
            this.state.lastError = 'Sunucu yeniden başlatıldığı için işlem güvenli şekilde duraklatıldı. Kaldığı yerden devam edebilirsiniz.';
            this.saveState();
          }
        }
      }
    } catch (err: any) {
      console.warn('[KAP Backfill] Durum yükleme uyarısı:', err.message);
    }
  }

  /**
   * Persists current engine state to disk safely.
   */
  public saveState(): void {
    try {
      const dir = path.dirname(this.stateFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[KAP Backfill] Durum kaydedilemedi:', err.message);
    }
  }

  /**
   * Returns current engine status snapshot with computed remaining batches.
   */
  public getStatus(): KAPBackfillStatus {
    const totalEquities = this.universeService.getAllInstruments().length || 529;
    
    // Recalculate pending batches dynamically
    let pendingBatches = 0;
    if (this.state.targetIndex > 0 && this.state.currentCursor <= this.state.targetIndex) {
      pendingBatches = Math.max(0, Math.ceil((this.state.targetIndex - this.state.currentCursor + 1) / 50));
    }
    this.state.pendingBatchesCount = pendingBatches;
    this.state.pendingStocksCount = Math.max(0, totalEquities - this.state.stocksWithDisclosuresCount);

    return { ...this.state };
  }

  /**
   * Starts a full BIST universe KAP historical backfill.
   */
  public async start(options?: {
    fromIndex?: number;
    toIndex?: number;
    mode?: 'FORWARD_CATCHUP' | 'HISTORICAL_DEEP_SCAN';
  }): Promise<KAPBackfillStatus> {
    if (this.state.status === 'RUNNING') {
      return this.getStatus();
    }

    try {
      await this.kapService.initMemberCatalog();
      let latestIndexStr = '1231017';
      try {
        latestIndexStr = await this.mkkClient.fetchLastDisclosureIndex();
      } catch {
        latestIndexStr = '1231017';
      }
      const latestIndexNum = parseInt(latestIndexStr, 10);
      const target = options?.toIndex ?? (isNaN(latestIndexNum) ? 1231017 : latestIndexNum);

      let start = 0;
      if (options?.fromIndex !== undefined && options?.fromIndex !== null) {
        start = Number(options.fromIndex);
      } else if (this.state.lastSuccessfulIndex != null) {
        // Resume from next item after last committed index
        start = this.state.lastSuccessfulIndex + 1;
      } else {
        // Deep historical scan on test gateway: look back ~1000 indices from latest (covers test notices)
        start = Math.max(1, target - 1000);
      }

      const totalBatches = Math.max(1, Math.ceil((target - start + 1) / 50));

      this.state.status = 'RUNNING';
      this.state.mode = options?.mode || 'HISTORICAL_DEEP_SCAN';
      this.state.startIndex = start;
      this.state.targetIndex = target;
      this.state.currentCursor = start;
      this.state.pendingBatchesCount = totalBatches;
      this.state.estimatedTotalApiCalls = totalBatches;
      this.state.startedAt = this.state.startedAt || new Date().toISOString();
      this.state.completedAt = null;
      this.state.completionMessage = null;
      this.state.lastError = null;
      this.state.canResume = false;
      this.state.canPause = true;
      this.state.canStop = true;

      this.saveState();
      this.scheduleNextTick(100);

      return this.getStatus();
    } catch (err: any) {
      this.state.status = 'ERROR';
      this.state.lastError = this.mkkClient.sanitizeErrorMessage(err.message || 'Backfill başlatılamadı.');
      this.state.canResume = true;
      this.state.canPause = false;
      this.state.canStop = true;
      this.saveState();
      return this.getStatus();
    }
  }

  /**
   * Pauses the background crawler gracefully after current active batch.
   */
  public pause(): KAPBackfillStatus {
    if (this.state.status === 'RUNNING') {
      this.state.status = 'PAUSED';
      this.state.canResume = true;
      this.state.canPause = false;
      this.state.canStop = true;
      if (this.activeTimer) {
        clearTimeout(this.activeTimer);
        this.activeTimer = null;
      }
      this.saveState();
    }
    return this.getStatus();
  }

  /**
   * Resumes the paused or stopped crawler from the exact last successful checkpoint.
   */
  public resume(): KAPBackfillStatus {
    if (this.state.status === 'PAUSED' || this.state.status === 'STOPPED' || this.state.status === 'ERROR') {
      this.state.status = 'RUNNING';
      this.state.canResume = false;
      this.state.canPause = true;
      this.state.canStop = true;
      this.state.lastError = null;
      this.saveState();
      this.scheduleNextTick(500);
    }
    return this.getStatus();
  }

  /**
   * Stops the crawler while preserving all gathered disclosures and last cursor.
   */
  public stop(): KAPBackfillStatus {
    this.state.status = 'STOPPED';
    this.state.canResume = true;
    this.state.canPause = false;
    this.state.canStop = false;
    if (this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
    this.saveState();
    return this.getStatus();
  }

  /**
   * Schedules next execution tick respecting the 10,000 ms rate limit pacing.
   */
  private scheduleNextTick(delayMs = 10000): void {
    if (this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
    if (this.state.status !== 'RUNNING') return;

    this.activeTimer = setTimeout(() => {
      this.processTick().catch((err) => {
        console.error('[KAP Backfill] Beklenmeyen tick hatası:', err);
      });
    }, delayMs);
  }

  /**
   * Executes a single batch tick:
   * - Obeys 6 requests/minute rate limit (checks sliding window)
   * - Retries failed batches first before advancing
   * - Commits items to memory & disk
   * - Advances lastSuccessfulIndex ONLY upon success
   */
  private async processTick(): Promise<void> {
    if (this.state.status !== 'RUNNING' || this.isTickInProgress) {
      return;
    }

    this.isTickInProgress = true;

    try {
      // 1. Check rate limit
      const rateLimit = this.mkkClient.getRateLimitStatus();
      if (rateLimit.remainingRequests <= 0) {
        const waitMs = Math.max(10000, rateLimit.resetInMs + 500);
        this.scheduleNextTick(waitMs);
        return;
      }

      // 2. Determine batch index to process: retry failed batch first or next cursor
      let batchIndexToQuery: number;
      let isRetry = false;

      if (this.state.failedBatchIndices.length > 0) {
        batchIndexToQuery = this.state.failedBatchIndices[0];
        isRetry = true;
      } else {
        batchIndexToQuery = this.state.currentCursor;
      }

      // Check if finished
      if (!isRetry && batchIndexToQuery > this.state.targetIndex) {
        this.completeBackfill();
        return;
      }

      // 3. Perform network call to MKK VYK API
      this.state.totalApiCallsCount++;
      this.state.lastApiCallTimestamp = new Date().toISOString();

      let rawDisclosures: any[] = [];
      try {
        rawDisclosures = await this.mkkClient.fetchDisclosures({ disclosureIndex: batchIndexToQuery });
      } catch (err: any) {
        const msg = String(err.message || '');
        this.state.lastError = this.mkkClient.sanitizeErrorMessage(msg);
        this.state.failedBatchesCount++;
        this.state.retryCount++;

        if (!this.state.failedBatchIndices.includes(batchIndexToQuery)) {
          this.state.failedBatchIndices.push(batchIndexToQuery);
        }

        this.saveState();

        // If 429 Too Many Requests, wait 60s
        const waitMs = msg.includes('429') ? 60000 : 15000;
        this.scheduleNextTick(waitMs);
        return;
      }

      // If this was a retry and succeeded, remove from failedBatchIndices
      if (isRetry) {
        this.state.failedBatchIndices.shift();
      }

      // 4. Process disclosures in batch
      let highestBatchIndex = batchIndexToQuery;
      this.state.totalDisclosuresFetched += rawDisclosures.length;

      for (const item of rawDisclosures) {
        const indexStr = String(item.disclosureIndex);
        const indexNum = parseInt(indexStr, 10);
        if (!isNaN(indexNum) && indexNum > highestBatchIndex) {
          highestBatchIndex = indexNum;
        }

        const rawCompanyId = item.companyId ?? item.memberOid ?? item.senderId;
        const memberCode = item.memberCode ?? (Array.isArray(item.senderExchCodes) ? item.senderExchCodes[0] : undefined);
        const companyTitle = item.title ?? item.companyTitle ?? item.senderTitle;

        // Resolve symbols for BIST equities (handles multiple share classes)
        const resolvedSymbols = this.kapService.resolveSymbolsFromMkk(
          rawCompanyId,
          memberCode,
          companyTitle,
          item.relatedStocks
        );

        if (resolvedSymbols.length === 0) {
          // Unmatched non-equity or fund notice -> preserve in pool
          const titleUpper = (companyTitle || '').toUpperCase();
          let reason: UnmatchedKAPDisclosure['reason'] = 'NO_MATCHING_BIST_SYMBOL';
          if (titleUpper.includes('PORTFÖY') || titleUpper.includes('FON') || titleUpper.includes('VARLIK KİRALAMA') || item.disclosureType === 'FON') {
            reason = 'NON_EQUITY_OR_FUND_ISSUER';
          } else if (rawCompanyId && !this.kapService['memberCatalog']?.has(String(rawCompanyId))) {
            reason = 'UNKNOWN_MKK_COMPANY_ID';
          }

          const added = this.kapService.addUnmatchedDisclosure({
            disclosureIndex: indexStr,
            companyId: rawCompanyId ? String(rawCompanyId) : undefined,
            title: companyTitle || 'Bilinmeyen MKK Kurumu',
            disclosureType: item.disclosureType,
            publishDate: item.publishDate || new Date().toISOString(),
            reason,
            senderExchCodes: item.senderExchCodes,
            relatedStocks: item.relatedStocks,
            subReportIds: item.subReportIds,
            receivedAt: new Date().toISOString()
          });

          if (added) {
            this.state.unmatchedDisclosuresCount++;
          }
          continue;
        }

        // Map and distribute to all verified BIST symbols
        const displayTitle = item.subject || item.title || `${companyTitle || resolvedSymbols.join('/')} Resmî KAP Bildirimi`;

        for (const sym of resolvedSymbols) {
          const stockRec = this.universeService.getStock(sym);
          const resolvedCompanyName = stockRec?.name || companyTitle || sym;

          const disclosure: KAPDisclosure = {
            id: `mkk_${indexStr}_${sym}`,
            disclosureIndex: indexStr,
            symbol: sym,
            companyTitle: resolvedCompanyName,
            publishDate: item.publishDate || new Date().toISOString(),
            title: displayTitle,
            summary: item.summary,
            category: this.categorizeDisclosure(item.disclosureType, item.title || item.subject),
            isImportant: Boolean(item.isImportant || item.disclosureType === 'ODA' || item.disclosureType === 'FR'),
            disclosureType: item.disclosureType || 'Özel Durum Açıklaması',
            originalUrl: `https://www.kap.org.tr/tr/Bildirim/${indexStr}`,
            isVerified: true,
            source: 'MKK KAP Veri Yayın Servisi (Geliştirici Ağ Geçidi)',
            dataSource: 'MKK_LIVE_API',
            financialImpactScore: item.financialImpactScore ?? 7.5,
            sentiment: item.sentiment ?? 'NEUTRAL',
            originalText: item.text || item.content || item.summary || item.title || displayTitle,
            aiSummary: item.aiSummary || item.summary || displayTitle
          };

          const isNew = this.kapService.addLiveDisclosure(disclosure);
          if (isNew) {
            this.state.newDisclosuresSaved++;
            this.touchedStocks.add(sym);
          } else {
            this.state.duplicateDisclosuresSkipped++;
          }
        }
      }

      // 5. Commit batch progress: advance lastSuccessfulIndex ONLY upon successful completion
      this.state.processedBatchesCount++;
      this.state.lastSuccessfulIndex = highestBatchIndex;
      this.state.lastSuccessfulApiCallTimestamp = new Date().toISOString();
      this.state.lastError = null;

      // Update sync bookmark in main service
      this.kapService.setLastSyncedIndex(String(highestBatchIndex));

      // Calculate stock coverage
      this.state.processedStocksCount = this.touchedStocks.size;
      this.state.stocksWithDisclosuresCount = this.touchedStocks.size;
      const allInstruments = this.universeService.getAllInstruments();
      this.state.pendingStocksCount = Math.max(0, allInstruments.length - this.touchedStocks.size);

      // Check if end of stream reached (fewer than 50 items or reached target)
      if (rawDisclosures.length < 50 || highestBatchIndex >= this.state.targetIndex) {
        this.completeBackfill();
        return;
      }

      // Advance cursor to next index
      this.state.currentCursor = highestBatchIndex + 1;
      this.saveState();

      // Schedule next tick (10 seconds for 6 req/min quota)
      this.scheduleNextTick(10000);
    } catch (err: any) {
      console.error('[KAP Backfill] Tick hatası:', err.message);
      this.state.lastError = this.mkkClient.sanitizeErrorMessage(err.message);
      this.saveState();
      this.scheduleNextTick(15000);
    } finally {
      this.isTickInProgress = false;
    }
  }

  /**
   * Categorizes disclosure type into standard categories.
   */
  private categorizeDisclosure(disclosureType?: string, title?: string): KAPDisclosure['category'] {
    const text = `${disclosureType || ''} ${title || ''}`.toUpperCase();
    if (text.includes('FINANSAL') || text.includes('BILANCO') || text.includes('FAALIYET') || disclosureType === 'FR') {
      return 'Finansal Rapor';
    }
    if (text.includes('TEMETTU') || text.includes('SERMAYE') || text.includes('KAR PAYI') || text.includes('BEDELLI')) {
      return 'Temettü / Sermaye';
    }
    if (text.includes('HALKA ARZ')) {
      return 'Halka Arz';
    }
    if (text.includes('GENEL KURUL') || text.includes('YONETIM KURULU')) {
      return 'Şirket Kararı';
    }
    return 'Özel Durum';
  }

  /**
   * Finalizes backfill process with honest environment notice per Section 8.
   */
  private completeBackfill(): void {
    this.state.status = 'COMPLETED';
    this.state.completedAt = new Date().toISOString();
    this.state.pendingBatchesCount = 0;
    this.state.canPause = false;
    this.state.canResume = false;
    this.state.canStop = false;

    // Section 8 rule: Never claim "All KAP history is complete" on dev test gateway
    this.state.completionMessage = 'Erişilebilir arşiv taraması tamamlandı (MKK Geliştirici Test Ağ Geçidi kapsamı). Test ortamı sınırlı geçmiş veri sunmaktadır; tam BIST canlı KAP geçmişi için üretim ağ geçidi (apigw.mkk.com.tr) erişimi gereklidir.';

    if (this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }

    this.saveState();
    this.kapService.invalidateAuditCache();
    console.log('[KAP Backfill] Tarama başarıyla tamamlandı:', this.state.completionMessage);
  }
}
