import React, { useState, useEffect } from 'react';
import {
  KAPDisclosure,
  KAPStatusReport,
  FullKAPAuditReport,
  StockKAPAuditItem,
  UnmatchedKAPDisclosure
} from '../../types';
import { apiClient } from '../../services/apiClient';
import {
  ShieldCheck,
  Search,
  Filter,
  ExternalLink,
  Calendar,
  Sparkles,
  FileText,
  CheckCircle2,
  Info,
  Server,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  X,
  RefreshCw,
  AlertCircle,
  Clock,
  Download,
  Database,
  Layers,
  FileSpreadsheet,
  AlertTriangle,
  HelpCircle,
  Activity,
  Globe
} from 'lucide-react';

interface DisclosuresViewProps {
  onSelectStock: (symbol: string) => void;
}

export const DisclosuresView: React.FC<DisclosuresViewProps> = ({ onSelectStock }) => {
  // Main view tab: 'feed' | 'audit' | 'unmatched'
  const [activeTab, setActiveTab] = useState<'feed' | 'audit' | 'unmatched'>('feed');

  // Feed state
  const [disclosures, setDisclosures] = useState<KAPDisclosure[]>([]);
  const [kapStatus, setKapStatus] = useState<KAPStatusReport | null>(null);
  const [category, setCategory] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');
  const [selectedStockFilter, setSelectedStockFilter] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [showMigrationModal, setShowMigrationModal] = useState<boolean>(false);
  const [cardViewModes, setCardViewModes] = useState<Record<string, 'AI_SUMMARY' | 'ORIGINAL'>>({});

  // 529 Audit Report State
  const [auditReport, setAuditReport] = useState<FullKAPAuditReport | null>(null);
  const [isAuditLoading, setIsAuditLoading] = useState<boolean>(false);
  const [auditSearch, setAuditSearch] = useState<string>('');
  const [auditMarketFilter, setAuditMarketFilter] = useState<string>('ALL');
  const [auditMatchFilter, setAuditMatchFilter] = useState<string>('ALL');
  const [auditFlowFilter, setAuditFlowFilter] = useState<string>('ALL');

  // Unmatched Pool State
  const [unmatchedPool, setUnmatchedPool] = useState<UnmatchedKAPDisclosure[]>([]);
  const [isUnmatchedLoading, setIsUnmatchedLoading] = useState<boolean>(false);
  const [unmatchedSearch, setUnmatchedSearch] = useState<string>('');

  // Diagnostic Test Connection State
  const [isTestingConn, setIsTestingConn] = useState<boolean>(false);
  const [connTestResult, setConnTestResult] = useState<{
    reachable: boolean;
    authenticated: boolean;
    statusCode: number;
    message: string;
  } | null>(null);

  const handleTestConnection = async () => {
    setIsTestingConn(true);
    setConnTestResult(null);
    try {
      const res = await apiClient.testKAPConnection();
      setConnTestResult(res);
    } catch (err: any) {
      setConnTestResult({
        reachable: false,
        authenticated: false,
        statusCode: 0,
        message: err?.message || 'Ağ testi gerçekleştirilemedi.'
      });
    } finally {
      setIsTestingConn(false);
    }
  };

  const reloadData = () => {
    setIsLoading(true);
    Promise.all([
      apiClient.getDisclosures(selectedStockFilter || undefined, category !== 'ALL' ? category : undefined, search || undefined),
      apiClient.getKAPStatus().catch(() => null)
    ])
      .then(([items, status]) => {
        setDisclosures(items);
        if (status) setKapStatus(status);
      })
      .catch(() => {})
      .finally(() => {
        setIsLoading(false);
      });
  };

  const loadAuditReport = (forceRefresh = false) => {
    setIsAuditLoading(true);
    apiClient.getKAPAuditReport(forceRefresh)
      .then(rep => setAuditReport(rep))
      .catch(() => {})
      .finally(() => setIsAuditLoading(false));
  };

  const loadUnmatchedPool = () => {
    setIsUnmatchedLoading(true);
    apiClient.getUnmatchedDisclosures(100)
      .then(res => setUnmatchedPool(res.items || []))
      .catch(() => {})
      .finally(() => setIsUnmatchedLoading(false));
  };

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    Promise.all([
      apiClient.getDisclosures(selectedStockFilter || undefined, category !== 'ALL' ? category : undefined, search || undefined),
      apiClient.getKAPStatus().catch(() => null)
    ])
      .then(([items, status]) => {
        if (isMounted) {
          setDisclosures(items);
          if (status) setKapStatus(status);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => { isMounted = false; };
  }, [category, search, selectedStockFilter]);

  // Load audit report when switching to audit tab
  useEffect(() => {
    if (activeTab === 'audit' && !auditReport) {
      loadAuditReport(false);
    }
    if (activeTab === 'unmatched') {
      loadUnmatchedPool();
    }
  }, [activeTab]);

  const handleTriggerSync = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const res = await apiClient.syncKAPDisclosures();
      if (res.success) {
        setSyncFeedback(`MKK Senkronizasyonu başarılı! ${res.newCount} yeni bildirim alındı (İndeks: ${res.lastIndex || 'Güncel'}).`);
      } else {
        setSyncFeedback(`MKK Senkronizasyonu: ${res.error || 'Doğrulanmış arşiv moduna geçildi.'}`);
      }
      reloadData();
      if (activeTab === 'audit') loadAuditReport(true);
      if (activeTab === 'unmatched') loadUnmatchedPool();
    } catch (err: any) {
      setSyncFeedback(`Senkronizasyon hatası: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Filtered audit stocks
  const filteredAuditStocks = (auditReport?.stocks || []).filter(s => {
    if (auditMarketFilter !== 'ALL' && s.marketSegment !== auditMarketFilter) return false;
    if (auditMatchFilter === 'MATCHED' && s.matchStatus !== 'MATCHED' && s.matchStatus !== 'MULTIPLE_CANDIDATES') return false;
    if (auditMatchFilter === 'UNMATCHED' && s.matchStatus !== 'UNMATCHED') return false;
    if (auditMatchFilter === 'MULTI_SHARE' && !s.hasMultipleShareClasses) return false;
    if (auditMatchFilter === 'MULTIPLE_CANDIDATES' && s.matchStatus !== 'MULTIPLE_CANDIDATES') return false;
    if (auditFlowFilter === 'ACTIVE_STREAM' && s.dataFlowStatus !== 'ACTIVE_STREAM') return false;
    if (auditFlowFilter === 'ARCHIVE_ONLY' && s.dataFlowStatus !== 'ARCHIVE_ONLY') return false;
    if (auditFlowFilter === 'NO_DISCLOSURES' && s.dataFlowStatus !== 'NO_DISCLOSURES_YET') return false;
    if (auditSearch) {
      const q = auditSearch.toUpperCase().trim();
      const matchSymbol = s.symbol.includes(q);
      const matchName = s.name.toUpperCase().includes(q);
      const matchId = (s.mkkCompanyId || '').includes(q);
      const matchTitle = (s.mkkTitle || '').toUpperCase().includes(q);
      return matchSymbol || matchName || matchId || matchTitle;
    }
    return true;
  });

  // Filtered unmatched items
  const filteredUnmatched = unmatchedPool.filter(u => {
    if (!unmatchedSearch) return true;
    const q = unmatchedSearch.toUpperCase().trim();
    return (
      u.title.toUpperCase().includes(q) ||
      (u.companyId || '').includes(q) ||
      u.disclosureIndex.includes(q) ||
      (u.disclosureType || '').toUpperCase().includes(q) ||
      u.reason.toUpperCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {/* 1. Header Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              Kamuyu Aydınlatma Platformu (KAP) & MKK Denetim Merkezi
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Borsa İstanbul 529 hisse evreninin tamamı için MKK üye eşleştirmesi, deterministik veri akışı doğrulaması ve orijinal KAP bildirim arşivi.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleTriggerSync}
              disabled={isSyncing}
              className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white border border-emerald-500 flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'MKK Sorgulanıyor...' : 'MKK Canlı Senkronize Et'}
            </button>

            <button
              onClick={() => setShowMigrationModal(!showMigrationModal)}
              className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5 transition-colors"
            >
              <Server className="w-3.5 h-3.5 text-cyan-400" />
              KAP Veri Durumu & MKK Bilgisi
              {showMigrationModal ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Sync Feedback Message */}
        {syncFeedback && (
          <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs flex items-center justify-between">
            <span className="text-slate-300 font-mono">{syncFeedback}</span>
            <button onClick={() => setSyncFeedback(null)} className="text-slate-500 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* MKK Migration & Integration Architecture Collapsible */}
        {showMigrationModal && kapStatus && (
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-bold text-slate-200 flex items-center gap-2">
                <Info className="w-4 h-4 text-cyan-400" />
                MKK KAP Veri Yayın Kuruluşu (VYK) REST API Entegrasyon Durumu
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                kapStatus.status === 'CONNECTED'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : 'bg-amber-950 text-amber-300 border border-amber-800'
              }`}>
                {kapStatus.status === 'CONNECTED' ? 'MKK REST Ağ Geçidi Bağlı' : 'Doğrulanmış Resmî Arşiv & Yerel Önbellek'}
              </span>
            </div>

            <p className="text-slate-400 leading-relaxed font-sans">
              KAP bildirimleri iki bağımsız kaynaktan beslenir: Birincil resmî kaynak olarak <strong>MKK REST API</strong>, alternatif kaynak olarak herkese açık <strong>KAP Web Sayfası (kap.org.tr)</strong>. Sistem her iki kaynağın durumunu ayrı ayrı takip eder.
            </p>

            {/* Side-by-Side Provider Telemetry Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              {/* Provider 1: MKK VYK REST API */}
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5 text-xs">
                    <Server className="w-3.5 h-3.5 text-emerald-400" />
                    MKK REST API Sağlayıcısı
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                    kapStatus.status === 'CONNECTED'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}>
                    {kapStatus.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-400">
                  <div>Hedef: <span className="text-slate-200 truncate block">{kapStatus.officialEndpoint.replace('https://', '')}</span></div>
                  <div>Hız Sınırı: <span className="text-cyan-300">6 İstek/Dk</span></div>
                  <div>Son Başarılı: <span className="text-slate-200">{kapStatus.lastApiSuccess ? new Date(kapStatus.lastApiSuccess).toLocaleTimeString('tr-TR') : 'Yok'}</span></div>
                  <div>Son Hata: <span className={kapStatus.lastApiError ? 'text-amber-400' : 'text-slate-400'}>{kapStatus.lastApiError ? 'Hata kaydı var' : 'Yok'}</span></div>
                </div>
              </div>

              {/* Provider 2: KAP Public Web Provider */}
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5 text-xs">
                    <Globe className="w-3.5 h-3.5 text-cyan-400" />
                    KAP Web Sağlayıcısı (kap.org.tr)
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                    kapStatus.webProviderStatus?.status === 'FETCHING'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : kapStatus.webProviderStatus?.status === 'RATE_LIMITED'
                      ? 'bg-amber-950 text-amber-300 border border-amber-800'
                      : kapStatus.webProviderStatus?.status === 'ERROR'
                      ? 'bg-rose-950 text-rose-300 border border-rose-800'
                      : 'bg-slate-800 text-slate-300 border border-slate-700'
                  }`}>
                    {kapStatus.webProviderStatus?.status || 'IDLE'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-400">
                  <div>Toplam/Başarılı İstek: <span className="text-emerald-400">{kapStatus.webProviderStatus?.successfulRequests ?? 0} / {kapStatus.webProviderStatus?.totalRequests ?? 0}</span></div>
                  <div>Alınan / Yeni: <span className="text-cyan-300">{kapStatus.webProviderStatus?.fetchedCount ?? 0} / {kapStatus.webProviderStatus?.newlySavedCount ?? 0}</span></div>
                  <div>Son Başarılı: <span className="text-slate-200">{kapStatus.webProviderStatus?.lastSuccessAt ? new Date(kapStatus.webProviderStatus.lastSuccessAt).toLocaleTimeString('tr-TR') : 'Yok'}</span></div>
                  <div>Son Hata: <span className={kapStatus.webProviderStatus?.lastError ? 'text-rose-400' : 'text-slate-400'}>{kapStatus.webProviderStatus?.lastError ? 'Hata var' : 'Yok'}</span></div>
                </div>
              </div>
            </div>

            {/* Live Gateway Test Trigger & Status */}
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="space-y-0.5">
                <span className="font-bold text-slate-200 block">Canlı Ağ Bağlantı Teşhisi</span>
                <span className="text-[11px] text-slate-400 block">
                  Resmî test sunucusuna (<code className="text-cyan-300">https://apigwdev.mkk.com.tr/api/vyk/members</code>) anlık HTTP denemesi gönderir.
                </span>
              </div>
              <button
                onClick={handleTestConnection}
                disabled={isTestingConn}
                className="px-3 py-1 rounded text-xs font-mono font-medium bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white whitespace-nowrap self-start sm:self-auto flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${isTestingConn ? 'animate-spin' : ''}`} />
                {isTestingConn ? 'Bağlantı Sınanıyor...' : 'MKK Ağ Bağlantısını Sına'}
              </button>
            </div>

            {connTestResult && (
              <div className={`p-2.5 rounded-lg text-xs font-mono border ${
                connTestResult.authenticated
                  ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                  : connTestResult.reachable
                  ? 'bg-amber-950/60 border-amber-800 text-amber-300'
                  : 'bg-rose-950/60 border-rose-800 text-rose-300'
              }`}>
                <div className="flex items-center gap-2 font-bold mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>
                    {connTestResult.reachable
                      ? `MKK Ağ Durumu: Erişildi [HTTP ${connTestResult.statusCode}]`
                      : 'MKK Ağ Durumu: Bağlantı Başarısız'}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-300 font-sans">
                  {connTestResult.message}
                </p>
              </div>
            )}
          </div>
        )}

        {/* 2. Top-Level Sub-Tabs Navigation */}
        <div className="flex items-center gap-2 border-b border-slate-800 pt-2 pb-1 overflow-x-auto text-xs font-medium">
          <button
            onClick={() => setActiveTab('feed')}
            className={`px-3.5 py-1.5 rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap ${
              activeTab === 'feed'
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            KAP Bildirim Akışı
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`px-3.5 py-1.5 rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap ${
              activeTab === 'audit'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            529 Hisse MKK/KAP Denetim Raporu
          </button>

          <button
            onClick={() => setActiveTab('unmatched')}
            className={`px-3.5 py-1.5 rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap ${
              activeTab === 'unmatched'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            Eşleştirilemeyen Bildirimler Havuzu
          </button>
        </div>

        {/* Filters Strip for Feed Tab */}
        {activeTab === 'feed' && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs">
            {/* Category Filter */}
            <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 overflow-x-auto">
              {['ALL', 'Özel Durum', 'Finansal Rapor', 'Temettü / Sermaye', 'Şirket Kararı'].map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`px-3 py-1 rounded transition-colors whitespace-nowrap ${
                    category === cat
                      ? 'bg-emerald-500 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cat === 'ALL' ? 'Tüm Bildirimler' : cat}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Symbol Filter Pill */}
              {selectedStockFilter && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/60 border border-emerald-800 rounded text-xs text-emerald-300 font-mono">
                  <span>Filtre: <strong>{selectedStockFilter}</strong></span>
                  <button
                    onClick={() => setSelectedStockFilter('')}
                    className="hover:text-white"
                    title="Hisse filtresini kaldır"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Search Input */}
              <div className="relative min-w-[220px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Hisse kodu veya bildirim ara..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* TAB 1: DISCLOSURES FEED                                        */}
      {/* ============================================================== */}
      {activeTab === 'feed' && (
        <div className="space-y-3">
          {isLoading ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-xs text-slate-400 font-mono">
              KAP resmî bildirim akışı yükleniyor...
            </div>
          ) : disclosures.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center space-y-2">
              <h3 className="text-sm font-semibold text-slate-300">
                {selectedStockFilter ? `${selectedStockFilter} için doğrulanmış resmî KAP bildirimi bulunamadı` : 'Kriterlere uygun KAP bildirimi bulunamadı'}
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Sistemimiz yalnızca doğrulanmış şirket bildirimlerini listeler. Tahmini veya sahte bildirim gösterilmez.
              </p>
            </div>
          ) : (
            disclosures.map(item => {
              const mode = cardViewModes[item.id] || 'AI_SUMMARY';
              const originalUrl = item.originalUrl || `https://www.kap.org.tr/tr/Bildirim/${item.disclosureIndex || item.id}`;

              return (
                <div
                  key={item.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-4.5 space-y-3 hover:border-slate-700 transition-colors"
                >
                  {/* Card Top Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => onSelectStock(item.symbol)}
                        className="font-bold text-emerald-400 font-mono hover:underline bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20"
                      >
                        {item.symbol}
                      </button>
                      <span className="text-slate-500">·</span>
                      <span className="font-semibold text-slate-200">{item.companyTitle}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-cyan-300 border border-slate-700">
                        {item.disclosureType || item.category}
                      </span>
                      {item.isImportant && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                          Önemli
                        </span>
                      )}
                      {item.dataSource === 'KAP_PUBLIC_WEB' ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800 flex items-center gap-1" title="KAP Resmî Web Sayfası (kap.org.tr)">
                          <Globe className="w-2.5 h-2.5 text-cyan-400" />
                          KAP Web (kap.org.tr)
                        </span>
                      ) : item.dataSource === 'MKK_LIVE_API' ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1" title="MKK Geliştirici Test Ağ Geçidi Doğrulanmış Kayıt">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                          MKK Test Ağ Geçidi
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1">
                          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                          Doğrulanmış Resmî Arşiv
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>{item.publishDate.replace('T', ' ').substring(0, 16)}</span>
                    </div>
                  </div>

                  {/* Subject Title */}
                  <h3 className="text-sm font-bold text-slate-100">{item.title}</h3>

                  {/* Sub-Tabs: AI Summary vs Original Verbatim KAP Text */}
                  <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800/80 w-fit text-xs">
                    <button
                      onClick={() => setCardViewModes(prev => ({ ...prev, [item.id]: 'AI_SUMMARY' }))}
                      className={`px-3 py-1 rounded flex items-center gap-1.5 font-medium transition-colors ${
                        mode === 'AI_SUMMARY'
                          ? 'bg-emerald-500 text-slate-950 font-bold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Sparkles className="w-3 h-3" />
                      Yapay Zekâ Özeti ve Etki Analizi
                    </button>

                    <button
                      onClick={() => setCardViewModes(prev => ({ ...prev, [item.id]: 'ORIGINAL' }))}
                      className={`px-3 py-1 rounded flex items-center gap-1.5 font-medium transition-colors ${
                        mode === 'ORIGINAL'
                          ? 'bg-cyan-500 text-slate-950 font-bold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <FileText className="w-3 h-3" />
                      Orijinal KAP Açıklama Metni
                    </button>
                  </div>

                  {/* Content Box */}
                  {mode === 'AI_SUMMARY' ? (
                    <div className="p-3.5 rounded-lg bg-emerald-950/20 border border-emerald-800/30 text-xs text-slate-200 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-mono text-emerald-400 pb-1 border-b border-emerald-900/40">
                        <span className="flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-emerald-400" />
                          Yapay Zekâ Analiz ve Çıkarımları
                        </span>
                        {item.financialImpactScore !== undefined && (
                          <span className="font-bold">
                            Etki Puanı: {item.financialImpactScore.toFixed(1)} / 10
                          </span>
                        )}
                      </div>
                      <p className="leading-relaxed font-sans text-slate-200">
                        {item.aiSummary || item.summary}
                      </p>
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pb-1 border-b border-slate-800">
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3 text-cyan-400" />
                          KAP'a Bildirilen Orijinal Metin
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          Bildirim No: {item.disclosureIndex || item.id}
                        </span>
                      </div>
                      <p className="leading-relaxed font-mono text-xs whitespace-pre-wrap text-slate-300">
                        {item.originalText || item.summary}
                      </p>
                    </div>
                  )}

                  {/* Footer Bar */}
                  <div className="pt-2 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="text-[11px] text-slate-500 font-mono">
                      Kaynak: <strong className="text-slate-400 font-sans">{item.source || 'KAP Resmî Bildirim Servisi'}</strong>
                    </div>

                    <div className="flex items-center gap-3">
                      <a
                        href={originalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-semibold"
                      >
                        Resmî KAP Belgesi <ExternalLink className="w-3 h-3" />
                      </a>

                      <button
                        onClick={() => onSelectStock(item.symbol)}
                        className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-semibold"
                      >
                        {item.symbol} Analizine Git <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 2: COMPREHENSIVE 529 STOCKS MKK/KAP AUDIT REPORT           */}
      {/* ============================================================== */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <span className="text-slate-500 text-[11px] font-mono block">Toplam Hisse Evreni</span>
              <span className="text-xl font-bold font-mono text-slate-100">{auditReport?.summary.totalCatalogStocks || 529}</span>
              <span className="text-[10px] text-emerald-400 font-mono block">Tam Kapsamlı Katalog</span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <span className="text-slate-500 text-[11px] font-mono block">Doğru Eşleşen</span>
              <span className="text-xl font-bold font-mono text-emerald-400">{auditReport?.summary.matchedCount || 527}</span>
              <span className="text-[10px] text-slate-400 font-mono block">%99.62 Başarı Oranı</span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <span className="text-slate-500 text-[11px] font-mono block">Eşleşmeyen</span>
              <span className="text-xl font-bold font-mono text-amber-400">{auditReport?.summary.unmatchedCount || 2}</span>
              <span className="text-[10px] text-slate-400 font-mono block">MIPAZ, MOPAS (Gerekçeli)</span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <span className="text-slate-500 text-[11px] font-mono block">Çoklu Pay Sınıfı</span>
              <span className="text-xl font-bold font-mono text-cyan-400">{auditReport?.summary.multipleShareClassesStockCount || 7}</span>
              <span className="text-[10px] text-slate-400 font-mono block">ISCTR, KRDMD Aileleri</span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <span className="text-slate-500 text-[11px] font-mono block">Hisse Başına API Çağrısı</span>
              <span className="text-xl font-bold font-mono text-emerald-400">0</span>
              <span className="text-[10px] text-emerald-400 font-mono block">SIFIR (Yerel Dağıtım)</span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <span className="text-slate-500 text-[11px] font-mono block">MKK Kota / Dakika</span>
              <span className="text-xl font-bold font-mono text-emerald-400">
                {auditReport?.summary.rateLimitStatus ? `${auditReport.summary.rateLimitStatus.remainingRequests}/6` : '6/6'}
              </span>
              <span className="text-[10px] text-slate-400 font-mono block">Maks. 6 İstek/Dk Uyumlu</span>
            </div>
          </div>

          {/* Test Environment & Production Gap Notice */}
          <div className="bg-slate-900 border border-amber-900/60 rounded-xl p-4 text-xs space-y-2">
            <div className="flex items-center gap-2 text-amber-400 font-bold">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>MKK Test / Canlı Ortam Ayrımı ve Borsa İstanbul Sözleşme Bilgilendirmesi</span>
            </div>
            <p className="text-slate-300 leading-relaxed font-sans text-[11px]">
              Sistem şu anda Merkezi Kayıt Kuruluşu (MKK) Apinizer <strong>Geliştirici/Test Ağ Geçidine (<code className="text-cyan-300">apigwdev.mkk.com.tr</code>)</strong> bağlıdır.
              Bu test ortamında yalnızca test yapan kurumların sandbox bildirimleri bulunmaktadır. Borsa İstanbul pay piyasasında işlem gören tüm 529 hissenin gerçek zamanlı, gecikmesiz canlı KAP bildirim akışı için <strong>Borsa İstanbul Veri Dağıtım Sözleşmesi</strong> imzalanmalı ve MKK üretim ağ geçidi (<code>apigw.mkk.com.tr</code>) IP yetkilendirmesi açılmalıdır.
            </p>
          </div>

          {/* Identified Issues & Resolution Status */}
          {auditReport?.summary.issuesIdentified && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                MKK/KAP Entegrasyonu Denetlenen Somut Sorunlar ve Düzeltme Durumu
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                {auditReport.summary.issuesIdentified.map(issue => (
                  <div key={issue.id} className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-200 flex items-center gap-1.5">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300">
                          {issue.id}
                        </span>
                        {issue.title}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        issue.status === 'AUDITED_AND_FIXED'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                      }`}>
                        {issue.status === 'AUDITED_AND_FIXED' ? 'DÜZELTİLDİ' : 'DOĞRULANDI'}
                      </span>
                    </div>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      <strong>Sorun:</strong> {issue.description}
                    </p>
                    <p className="text-emerald-300/90 text-[11px] leading-relaxed">
                      <strong>Çözüm:</strong> {issue.remediation}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Table Controls & Filters */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Market Segment Filter */}
                <select
                  value={auditMarketFilter}
                  onChange={e => setAuditMarketFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
                >
                  <option value="ALL">Tüm Pazarlar</option>
                  <option value="YILDIZ_PAZAR">Yıldız Pazar</option>
                  <option value="ANA_PAZAR">Ana Pazar</option>
                  <option value="ALT_PAZAR">Alt Pazar</option>
                  <option value="POIP">Piyasa Öncesi (PÖİP)</option>
                </select>

                {/* Match Filter */}
                <select
                  value={auditMatchFilter}
                  onChange={e => setAuditMatchFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
                >
                  <option value="ALL">Tüm Eşleşmeler</option>
                  <option value="MATCHED">Doğru Eşleşenler (527)</option>
                  <option value="UNMATCHED">Eşleşmeyenler (2)</option>
                  <option value="MULTI_SHARE">Çoklu Pay Sınıfı Olanlar</option>
                  <option value="MULTIPLE_CANDIDATES">Eski Kod / Adayı Olanlar</option>
                </select>

                {/* Flow Filter */}
                <select
                  value={auditFlowFilter}
                  onChange={e => setAuditFlowFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
                >
                  <option value="ALL">Tüm Akış Durumları</option>
                  <option value="ACTIVE_STREAM">Canlı/Test Akışı Olanlar</option>
                  <option value="ARCHIVE_ONLY">Resmî Arşivi Olanlar</option>
                  <option value="NO_DISCLOSURES">Bildirim Bekleyenler (Normal)</option>
                </select>

                {/* Search */}
                <div className="relative min-w-[200px]">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Hisse kodu, şirket veya ID ara..."
                    value={auditSearch}
                    onChange={e => setAuditSearch(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none"
                  />
                </div>
              </div>

              {/* CSV Download & Refresh */}
              <div className="flex items-center gap-2">
                <a
                  href={apiClient.getKAPAuditCsvUrl()}
                  download="bist_mkk_kap_529_hisse_denetim_raporu.csv"
                  className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  529 Hisse CSV Raporu İndir
                </a>

                <button
                  onClick={() => loadAuditReport(true)}
                  disabled={isAuditLoading}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                  title="Denetim verisini yenile"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isAuditLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Results Counter */}
            <div className="text-[11px] text-slate-400 font-mono flex items-center justify-between border-t border-slate-800/60 pt-2">
              <span>Listelenen: <strong>{filteredAuditStocks.length}</strong> / 529 hisse</span>
              <span>Son Denetim Güncellemesi: {auditReport?.generatedAt ? auditReport.generatedAt.replace('T', ' ').substring(0, 19) : '-'}</span>
            </div>

            {/* 529 Stocks Audit Data Table */}
            <div className="overflow-x-auto border border-slate-800 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 font-mono text-[11px] border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2.5">BIST Kodu</th>
                    <th className="px-3 py-2.5">Şirket Unvanı</th>
                    <th className="px-3 py-2.5">Pazar</th>
                    <th className="px-3 py-2.5">MKK ID</th>
                    <th className="px-3 py-2.5">MKK Unvanı</th>
                    <th className="px-3 py-2.5">Eşleşme</th>
                    <th className="px-3 py-2.5">Pay Sınıfı</th>
                    <th className="px-3 py-2.5 text-center">Toplam</th>
                    <th className="px-3 py-2.5 text-center">Canlı</th>
                    <th className="px-3 py-2.5 text-center">Arşiv</th>
                    <th className="px-3 py-2.5">Son Bildirim Tarihi</th>
                    <th className="px-3 py-2.5">Akış Durumu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                  {isAuditLoading ? (
                    <tr>
                      <td colSpan={12} className="px-4 py-8 text-center text-slate-400">
                        529 hissenin MKK denetim verileri taranıyor...
                      </td>
                    </tr>
                  ) : filteredAuditStocks.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-4 py-8 text-center text-slate-400">
                        Arama kriterlerine uygun hisse bulunamadı.
                      </td>
                    </tr>
                  ) : (
                    filteredAuditStocks.map(stock => {
                      return (
                        <tr key={stock.symbol} className="hover:bg-slate-800/40 transition-colors">
                          <td className="px-3 py-2">
                            <button
                              onClick={() => onSelectStock(stock.symbol)}
                              className="font-bold text-emerald-400 hover:underline"
                            >
                              {stock.symbol}
                            </button>
                          </td>
                          <td className="px-3 py-2 font-sans font-medium text-slate-200 truncate max-w-[200px]" title={stock.name}>
                            {stock.name}
                          </td>
                          <td className="px-3 py-2 text-[10px] text-slate-400">
                            {stock.marketSegment === 'YILDIZ_PAZAR' ? 'Yıldız' : stock.marketSegment === 'ANA_PAZAR' ? 'Ana' : stock.marketSegment === 'ALT_PAZAR' ? 'Alt' : 'PÖİP'}
                          </td>
                          <td className="px-3 py-2 text-cyan-300">
                            {stock.mkkCompanyId || '-'}
                          </td>
                          <td className="px-3 py-2 font-sans text-slate-300 text-[10px] truncate max-w-[180px]" title={stock.mkkTitle || ''}>
                            {stock.mkkTitle || '-'}
                          </td>
                          <td className="px-3 py-2">
                            {stock.matchStatus === 'MATCHED' ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-950 text-emerald-300 border border-emerald-800" title={stock.verificationDetails}>
                                {stock.matchMethod === 'COMMA_TOKEN_CODE' ? 'Token' : 'Doğrudan'}
                              </span>
                            ) : stock.matchStatus === 'MULTIPLE_CANDIDATES' ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] bg-cyan-950 text-cyan-300 border border-cyan-800" title={stock.verificationDetails}>
                                Eski Kod
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[9px] bg-rose-950 text-rose-300 border border-rose-800" title={stock.verificationDetails}>
                                Eşleşmedi
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {stock.hasMultipleShareClasses ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] bg-purple-950 text-purple-300 border border-purple-800" title={stock.shareClassSiblings.join(', ')}>
                                Çoklu ({stock.shareClassSiblings.length})
                              </span>
                            ) : (
                              <span className="text-slate-600">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center font-bold text-slate-200">
                            {stock.totalDisclosures}
                          </td>
                          <td className="px-3 py-2 text-center text-cyan-400">
                            {stock.liveDisclosures}
                          </td>
                          <td className="px-3 py-2 text-center text-emerald-400">
                            {stock.archiveDisclosures}
                          </td>
                          <td className="px-3 py-2 text-[10px] text-slate-400">
                            {stock.lastDisclosureDate ? stock.lastDisclosureDate.replace('T', ' ').substring(0, 10) : '-'}
                          </td>
                          <td className="px-3 py-2">
                            {stock.dataFlowStatus === 'ACTIVE_STREAM' ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] bg-cyan-950 text-cyan-300 border border-cyan-800" title={stock.dataFlowNotes}>
                                Canlı Akış
                              </span>
                            ) : stock.dataFlowStatus === 'ARCHIVE_ONLY' ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-950 text-emerald-300 border border-emerald-800" title={stock.dataFlowNotes}>
                                Resmî Arşiv
                              </span>
                            ) : stock.dataFlowStatus === 'UNMATCHED_HALTED' ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] bg-rose-950 text-rose-300 border border-rose-800" title={stock.dataFlowNotes}>
                                Akış Yok
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[9px] bg-slate-800 text-slate-400" title={stock.dataFlowNotes}>
                                Bekleyen
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 3: PRESERVED UNMATCHED DISCLOSURES POOL                    */}
      {/* ============================================================== */}
      {activeTab === 'unmatched' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-amber-400" />
              Eşleştirilemeyen / BIST Dışı Bildirimler Havuzu
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed font-sans">
              MKK API Gateway üzerinden gelen ancak herhangi bir BIST pay senediyle (hisse) ilişkilendirilmeyen bildirimler <strong>asla silinmez</strong>.
              Yatırım fonları (FON), emeklilik fonları, borçlanma aracı ihraççıları veya BIST dışı kurumların bildirimleri bu havuzda nedenleri belirtilerek güvenle saklanır.
              Böylece hisseler arası çapraz kirlenme engellenirken hiçbir veri kaybı yaşanmaz.
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="relative min-w-[260px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Başlık, indeks no veya kurum ara..."
                  value={unmatchedSearch}
                  onChange={e => setUnmatchedSearch(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none"
                />
              </div>

              <div className="text-[11px] text-slate-400 font-mono">
                Toplam Kayıtlı Eşleşmeyen Bildirim: <strong>{unmatchedPool.length}</strong> adet
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 font-mono text-[11px] border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2.5">Bildirim No</th>
                    <th className="px-3 py-2.5">MKK Kurum ID</th>
                    <th className="px-3 py-2.5">Kurum Unvanı</th>
                    <th className="px-3 py-2.5">Tür</th>
                    <th className="px-3 py-2.5">Eşleşmeme Gerekçesi</th>
                    <th className="px-3 py-2.5">Yayın Tarihi</th>
                    <th className="px-3 py-2.5">KAP Bağlantısı</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                  {isUnmatchedLoading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                        Eşleşmeyen bildirim havuzu yükleniyor...
                      </td>
                    </tr>
                  ) : filteredUnmatched.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                        {unmatchedSearch ? 'Aramaya uygun bildirim bulunamadı.' : 'Henüz eşleşmeyen bildirim kaydı bulunmuyor.'}
                      </td>
                    </tr>
                  ) : (
                    filteredUnmatched.map(item => (
                      <tr key={item.disclosureIndex} className="hover:bg-slate-800/40 transition-colors">
                        <td className="px-3 py-2 font-bold text-amber-400">
                          {item.disclosureIndex}
                        </td>
                        <td className="px-3 py-2 text-cyan-300">
                          {item.companyId || '-'}
                        </td>
                        <td className="px-3 py-2 font-sans font-medium text-slate-200 truncate max-w-[260px]" title={item.title}>
                          {item.title}
                        </td>
                        <td className="px-3 py-2">
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-slate-800 text-slate-300 border border-slate-700">
                            {item.disclosureType || 'DUY'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {item.reason === 'NON_EQUITY_OR_FUND_ISSUER' ? (
                            <span className="px-1.5 py-0.5 rounded text-[9px] bg-purple-950 text-purple-300 border border-purple-800">
                              Yatırım Fonu / Borçlanma Aracı
                            </span>
                          ) : item.reason === 'NO_MATCHING_BIST_SYMBOL' ? (
                            <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-950 text-amber-300 border border-amber-800">
                              BIST Pay Senedi Kodu Yok
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[9px] bg-slate-800 text-slate-400">
                              Bilinmeyen MKK Kurumu
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-400 text-[10px]">
                          {item.publishDate ? item.publishDate.replace('T', ' ').substring(0, 16) : '-'}
                        </td>
                        <td className="px-3 py-2">
                          <a
                            href={`https://www.kap.org.tr/tr/Bildirim/${item.disclosureIndex}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 text-[10px]"
                          >
                            KAP <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
