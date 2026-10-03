/**
 * SMMplan Memory Client SDK v3.0 (Temporal GraphRAG & Evidence Pack Edition)
 * Унифицированный клиент многоуровневой памяти автономных AI-агентов (4-Tier Memory):
 * 1. Working Memory (Active task context)
 * 2. Episodic Memory (Action -> Result -> Reflection log)
 * 3. Semantic Memory (ADR, Business Invariants, Temporal GraphRAG Decay)
 * 4. Procedural Memory (HELP scripts, AST validators, Evidence Packs)
 */

import fs from 'fs';
import path from 'path';
import {
  AtomicInvariant,
  AtomicInvariantSchema,
  ScenarioRecipe,
  ScenarioRecipeSchema,
  UniversalMemoryItem,
  computeRrfScore,
} from '../src/lib/memory/agent-memory-schema';

export type {
  AtomicInvariant,
  ScenarioRecipe,
  InvariantSeverity,
  InvariantCategory,
} from '../src/lib/memory/agent-memory-schema';

export interface OfflineMemoryCache {
  decisions?: ArchitecturalDecisionEntry[];
  l1_atomic_invariants?: AtomicInvariant[];
  l2_scenario_recipes?: ScenarioRecipe[];
}

export interface MemorySearchResult {
  title: string;
  content: string;
  collection: string;
  score: number;
  metadata?: Record<string, unknown>;
  graph_relations?: Array<{ from: string; rel: string; to: string }>;
}

export interface EpisodicEntry {
  sessionId: string;
  agentRole: 'Curator' | 'Generator' | 'Reflector' | 'Auditor' | 'ScrumMaster' | 'LegalSpecialist';
  task: string;
  action: string;
  observation: string;
  reflection: string;
  success: boolean;
  affectedFiles?: string[];
  tags?: string[];
}

export interface ArchitecturalDecisionEntry {
  title: string;
  context: string;
  decision: string;
  rationale: string;
  tags: string[];
  supersedesId?: string;
  importance?: number;
  decayRate?: number;
}

export interface TemporalDecayEntry {
  title: string;
  deprecatedNorm: string;
  activeReplacement: string;
  decayFactor: number; // 0.0 - 1.0 (1.0 = fully obsolete)
  reason: string;
  tags: string[];
}

export interface EvidencePackEntry {
  orderId?: string;
  incidentId: string;
  clientIdentifier: string;
  termsVersion: string;
  termsAcceptedAt: string;
  ipAddress: string;
  userAgent: string;
  apiDispatchedAtUtc: string;
  apiProviderResponseHash: string;
  fiscalReceiptFpd: string;
  fiscalReceiptFn: string;
  totalPaidRub: number;
  fprCalculatedRub: number;
  refundRub: number;
  statutoryNorms: string[];
  courtPrecedents: string[];
  winProbabilityScore: number;
}

export class SmmplanMemoryClient {
  private baseUrl: string;
  private offlineCacheFile: string;
  private offlineDecayFile: string;
  private offlineEvidenceDir: string;

  constructor(baseUrl?: string, offlineCacheFile?: string) {
    this.baseUrl = baseUrl || process.env.GRAPHRAG_API_URL || 'http://localhost:8100';
    this.offlineCacheFile = offlineCacheFile || path.resolve(process.cwd(), '.planning/memory_cache.json');
    this.offlineDecayFile = path.resolve(process.cwd(), '.planning/decay_registry.json');
    this.offlineEvidenceDir = path.resolve(process.cwd(), '.planning/evidence_packs');
  }

  /**
   * Curator: Семантический поиск по долговременной памяти перед генерацией
   */
  async searchContext(
    query: string,
    collections: string[] = ['architecture_decisions', 'business_rules', 'coding_conventions', 'tech_debt', 'legal_precedents'],
    topK = 5
  ): Promise<MemorySearchResult[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3000),
        body: JSON.stringify({
          query,
          collections,
          top_k: topK,
        }),
      });

      if (!res.ok) {
        throw new Error(`GraphRAG HTTP error ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as {
        results?: MemorySearchResult[];
        assembled_context?: string;
      };

      if (data.results && Array.isArray(data.results)) {
        return data.results;
      }

      if (data.assembled_context) {
        return [
          {
            title: 'GraphRAG Assembled Context',
            content: data.assembled_context,
            collection: 'assembled',
            score: 1.0,
          },
        ];
      }

      return [];
    } catch {
      return this.searchOfflineCache(query);
    }
  }

  /**
   * Reflector: Логирование эпизода действий, ошибки или успешного шага
   */
  async logEpisode(entry: EpisodicEntry): Promise<void> {
    const payload = {
      session_id: entry.sessionId,
      agent_role: entry.agentRole,
      task: entry.task,
      action: entry.action,
      observation: entry.observation,
      reflection: entry.reflection,
      success: entry.success,
      affected_files: entry.affectedFiles || [],
      tags: entry.tags || [],
      timestamp: new Date().toISOString(),
    };

    try {
      const res = await fetch(`${this.baseUrl}/api/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3000),
        body: JSON.stringify({
          title: `[Episodic:${entry.agentRole}] ${entry.task.slice(0, 60)}`,
          content: JSON.stringify(payload, null, 2),
          category: entry.success ? 'decisions_log' : 'incidents',
        }),
      });
      if (res.ok) {
        console.log(`🧠 [MemoryClient] Episodic memory logged successfully to GraphRAG.`);
      }
    } catch {
      // Игнорируем сетевые сбои
    }

    this.appendLocalEpisode(payload);
  }

  /**
   * Сохранение архитектурного или правового решения (ADR / Legal Decision)
   */
  async recordDecision(entry: ArchitecturalDecisionEntry): Promise<void> {
    const payload = {
      title: entry.title,
      context: entry.context,
      decision: entry.decision,
      rationale: entry.rationale,
      tags: entry.tags,
      supersedes_id: entry.supersedesId || null,
      importance: entry.importance ?? 1.0,
      decay_rate: entry.decayRate ?? 0.0,
    };

    try {
      const res = await fetch(`${this.baseUrl}/api/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3000),
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        console.log(`✅ [MemoryClient] Architectural Decision recorded: "${entry.title}"`);
      }
    } catch {
      console.warn(`⚠️ [MemoryClient] Could not send decision to remote API. Saving locally.`);
    }

    this.saveOfflineDecision(entry);
  }

  /**
   * Temporal Decay: Пометка устаревших законов и архитектурных норм с фактором затухания
   */
  async recordDecayedKnowledge(entry: TemporalDecayEntry): Promise<void> {
    const payload = {
      title: `[DEPRECATED_NORM] ${entry.title}`,
      content: `Устаревшая норма: ${entry.deprecatedNorm}\nАктуальная норма 2026: ${entry.activeReplacement}\nПричина: ${entry.reason}\nDecay Factor: ${entry.decayFactor}`,
      category: 'decayed_knowledge',
      decay_factor: entry.decayFactor,
      is_deprecated: true,
      tags: [...entry.tags, 'temporal_decay', 'deprecated'],
    };

    try {
      const res = await fetch(`${this.baseUrl}/api/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        console.log(`⏳ [MemoryClient] Temporal Decay registered in GraphRAG: "${entry.title}" (decay: ${entry.decayFactor})`);
      }
    } catch {
      console.warn(`⚠️ [MemoryClient] GraphRAG offline — saved decay to local registry.`);
    }

    this.saveOfflineDecay(entry);
  }

  /**
   * Evidence Pack Storage: Сохранение судебного досье и доказательного пакета
   */
  async recordEvidencePack(pack: EvidencePackEntry): Promise<string> {
    const packJson = JSON.stringify(pack, null, 2);
    const fileName = `evidence-pack-${pack.incidentId || Date.now()}.json`;

    try {
      const res = await fetch(`${this.baseUrl}/api/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `[EVIDENCE_PACK] Incident ${pack.incidentId} (Win Rate: ${pack.winProbabilityScore}%)`,
          content: packJson,
          category: 'legal_evidence_packs',
          tags: ['evidence_pack', 'court_dossier', '54_fz', 'zozpp'],
        }),
      });
      if (res.ok) {
        console.log(`📦 [MemoryClient] Evidence Pack stored in GraphRAG for incident ${pack.incidentId}`);
      }
    } catch {
      console.warn(`⚠️ [MemoryClient] GraphRAG offline — saving evidence pack locally.`);
    }

    if (!fs.existsSync(this.offlineEvidenceDir)) {
      fs.mkdirSync(this.offlineEvidenceDir, { recursive: true });
    }
    const filePath = path.join(this.offlineEvidenceDir, fileName);
    fs.writeFileSync(filePath, packJson, 'utf-8');
    return filePath;
  }

  private appendLocalEpisode(data: Record<string, unknown>): void {
    const logDir = path.resolve(process.cwd(), '.planning/episodes');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(logDir, `episodes-${today}.jsonl`);
    fs.appendFileSync(logFile, JSON.stringify(data) + '\n', 'utf-8');
  }

  /**
   * Загрузка офлайн кэша памяти
   */
  private loadOfflineCache(): OfflineMemoryCache {
    if (!fs.existsSync(this.offlineCacheFile)) {
      return { decisions: [], l1_atomic_invariants: [], l2_scenario_recipes: [] };
    }
    try {
      const raw = fs.readFileSync(this.offlineCacheFile, 'utf-8').trim();
      if (!raw) return { decisions: [], l1_atomic_invariants: [], l2_scenario_recipes: [] };
      return JSON.parse(raw);
    } catch {
      return { decisions: [], l1_atomic_invariants: [], l2_scenario_recipes: [] };
    }
  }

  /**
   * Сохранение офлайн кэша памяти (с защитой от Windows File Lock / Antivirus)
   */
  private saveOfflineCache(cache: OfflineMemoryCache): void {
    const dir = path.dirname(this.offlineCacheFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const content = JSON.stringify(cache, null, 2);
    let retries = 5;
    while (retries > 0) {
      try {
        fs.writeFileSync(this.offlineCacheFile, content, 'utf-8');
        break;
      } catch (err) {
        retries--;
        if (retries === 0) throw err;
        const waitTill = Date.now() + 50;
        while (Date.now() < waitTill) {}
      }
    }
  }

  private saveOfflineDecision(decision: ArchitecturalDecisionEntry): void {
    try {
      const cache = this.loadOfflineCache();
      cache.decisions = cache.decisions || [];
      cache.decisions.push(decision);
      this.saveOfflineCache(cache);
      console.log(`💾 [MemoryClient] Decision saved to offline cache: "${decision.title}"`);
    } catch (e) {
      console.error('Failed to save offline decision:', e);
    }
  }

  /**
   * L1: Регистрация атомарного архитектурного инварианта (Atomic Invariant)
   */
  async recordAtomicInvariant(entry: AtomicInvariant): Promise<void> {
    const validated = AtomicInvariantSchema.parse(entry);
    const cache = this.loadOfflineCache();
    cache.l1_atomic_invariants = cache.l1_atomic_invariants || [];

    const idx = cache.l1_atomic_invariants.findIndex((inv) => inv.id === validated.id);
    if (idx >= 0) {
      cache.l1_atomic_invariants[idx] = validated;
    } else {
      cache.l1_atomic_invariants.push(validated);
    }
    this.saveOfflineCache(cache);

    try {
      await fetch(`${this.baseUrl}/api/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(1000),
        body: JSON.stringify({
          title: `[L1_INVARIANT] ${validated.id}: ${validated.rule.slice(0, 80)}`,
          content: `Rule: ${validated.rule}\nRationale: ${validated.rationale}\nSeverity: ${validated.severity}`,
          category: 'atomic_invariants',
          tags: [...validated.tags, 'l1_invariant', validated.category],
        }),
      });
    } catch {
      // Offline fallback
    }
    console.log(`🛡️ [MemoryClient] L1 Atomic Invariant saved: "${validated.id}"`);
  }

  /**
   * L2: Регистрация воспроизводимого сценария/процедуры (Scenario Recipe)
   */
  async recordScenarioRecipe(entry: ScenarioRecipe): Promise<void> {
    const validated = ScenarioRecipeSchema.parse(entry);
    const cache = this.loadOfflineCache();
    cache.l2_scenario_recipes = cache.l2_scenario_recipes || [];

    const idx = cache.l2_scenario_recipes.findIndex((scen) => scen.id === validated.id);
    if (idx >= 0) {
      cache.l2_scenario_recipes[idx] = validated;
    } else {
      cache.l2_scenario_recipes.push(validated);
    }
    this.saveOfflineCache(cache);

    try {
      await fetch(`${this.baseUrl}/api/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(1000),
        body: JSON.stringify({
          title: `[L2_SCENARIO] ${validated.id}: ${validated.title}`,
          content: `Trigger: ${validated.triggerContext}\nSteps: ${validated.actionSteps.join(' -> ')}`,
          category: 'scenario_recipes',
          tags: [...validated.tags, 'l2_scenario'],
        }),
      });
    } catch {
      // Offline fallback
    }
    console.log(`📋 [MemoryClient] L2 Scenario Recipe saved: "${validated.id}"`);
  }

  /**
   * Пакетная регистрация L1 инвариантов и L2 сценариев (атомарное сохранение без блокировок ФС)
   */
  async recordPyramidBatch(
    l1List: AtomicInvariant[] = [],
    l2List: ScenarioRecipe[] = []
  ): Promise<void> {
    const validatedL1 = l1List.map((inv) => AtomicInvariantSchema.parse(inv));
    const validatedL2 = l2List.map((scen) => ScenarioRecipeSchema.parse(scen));

    const cache = this.loadOfflineCache();
    cache.l1_atomic_invariants = cache.l1_atomic_invariants || [];
    cache.l2_scenario_recipes = cache.l2_scenario_recipes || [];

    for (const inv of validatedL1) {
      const idx = cache.l1_atomic_invariants.findIndex((item) => item.id === inv.id);
      if (idx >= 0) cache.l1_atomic_invariants[idx] = inv;
      else cache.l1_atomic_invariants.push(inv);
    }

    for (const scen of validatedL2) {
      const idx = cache.l2_scenario_recipes.findIndex((item) => item.id === scen.id);
      if (idx >= 0) cache.l2_scenario_recipes[idx] = scen;
      else cache.l2_scenario_recipes.push(scen);
    }

    this.saveOfflineCache(cache);
    console.log(`📦 [MemoryClient] Pyramid Batch saved: ${validatedL1.length} L1, ${validatedL2.length} L2`);
  }

  /**
   * Получение всех активных L1 атомарных инвариантов
   */
  getAtomicInvariants(): AtomicInvariant[] {
    return this.loadOfflineCache().l1_atomic_invariants || [];
  }

  /**
   * Получение всех зарегистрированных L2 рецептов сценариев
   */
  getScenarioRecipes(): ScenarioRecipe[] {
    return this.loadOfflineCache().l2_scenario_recipes || [];
  }

  /**
   * Сбор элементов памяти в унифицированный список для RRF ранжирования
   */
  private collectUniversalItems(filterLayer: 'L1' | 'L2' | 'ADR' | 'ALL'): UniversalMemoryItem[] {
    const cache = this.loadOfflineCache();
    const items: UniversalMemoryItem[] = [];

    if (filterLayer === 'ALL' || filterLayer === 'L1') {
      for (const inv of cache.l1_atomic_invariants || []) {
        items.push({
          id: inv.id,
          layer: 'L1',
          title: `[${inv.id}] ${inv.rule}`,
          content: `Invariant: ${inv.rule}\nRationale: ${inv.rationale}\nSeverity: ${inv.severity}`,
          tags: inv.tags || [],
          severityWeight: inv.severity === 'CRITICAL_BLOCKING' ? 1.6 : 1.2,
          rawItem: inv,
        });
      }
    }

    if (filterLayer === 'ALL' || filterLayer === 'L2') {
      for (const scen of cache.l2_scenario_recipes || []) {
        items.push({
          id: scen.id,
          layer: 'L2',
          title: `[${scen.id}] ${scen.title}`,
          content: `Trigger: ${scen.triggerContext}\nSteps:\n${scen.actionSteps.map((s) => `  - ${s}`).join('\n')}\nVerification:\n${scen.verification.map((v) => `  - ${v}`).join('\n')}`,
          tags: scen.tags || [],
          severityWeight: 1.2,
          rawItem: scen,
        });
      }
    }

    if (filterLayer === 'ALL' || filterLayer === 'ADR') {
      for (const d of cache.decisions || []) {
        items.push({
          id: d.title,
          layer: 'ADR',
          title: d.title,
          content: `${d.context}\n\nDecision: ${d.decision}\nRationale: ${d.rationale || ''}`,
          tags: d.tags || [],
          severityWeight: (d.importance ?? 1.0) >= 1.5 ? 1.4 : 1.0,
          rawItem: d,
        });
      }
    }

    return items;
  }

  /**
   * Ранжирование кандидатов с помощью Reciprocal Rank Fusion (RRF)
   */
  private rankItemsWithRrf(
    query: string,
    items: UniversalMemoryItem[]
  ): Array<{ item: UniversalMemoryItem; score: number }> {
    const q = query.toLowerCase().trim();
    const queryTokens = q.split(/\s+/).filter((t) => t.length >= 2);

    const lexicalScores: Array<{ item: UniversalMemoryItem; rawScore: number }> = [];
    const tagScores: Array<{ item: UniversalMemoryItem; rawScore: number }> = [];
    const severityScores: Array<{ item: UniversalMemoryItem; rawScore: number }> = [];

    for (const item of items) {
      const titleLower = item.title.toLowerCase();
      const contentLower = item.content.toLowerCase();
      const tagsLower = item.tags.map((t) => t.toLowerCase()).join(' ');

      let lexScore = 0;
      let tagScore = 0;

      if (titleLower.includes(q)) lexScore += 3.0;
      if (contentLower.includes(q)) lexScore += 1.5;

      for (const token of queryTokens) {
        if (titleLower.includes(token)) lexScore += 1.0;
        if (contentLower.includes(token)) lexScore += 0.5;
        if (tagsLower.includes(token)) tagScore += 1.5;
      }

      for (const tag of item.tags) {
        if (q.includes(tag.toLowerCase())) tagScore += 2.0;
      }

      if (lexScore > 0) lexicalScores.push({ item, rawScore: lexScore });
      if (tagScore > 0) tagScores.push({ item, rawScore: tagScore });
      severityScores.push({ item, rawScore: item.severityWeight });
    }

    lexicalScores.sort((a, b) => b.rawScore - a.rawScore);
    tagScores.sort((a, b) => b.rawScore - a.rawScore);
    severityScores.sort((a, b) => b.rawScore - a.rawScore);

    const lexicalRankMap = new Map<string, number>();
    lexicalScores.forEach((entry, rank) => lexicalRankMap.set(entry.item.id, rank));

    const tagRankMap = new Map<string, number>();
    tagScores.forEach((entry, rank) => tagRankMap.set(entry.item.id, rank));

    const severityRankMap = new Map<string, number>();
    severityScores.forEach((entry, rank) => severityRankMap.set(entry.item.id, rank));

    const scored: Array<{ item: UniversalMemoryItem; score: number }> = [];

    for (const item of items) {
      const lexRank = lexicalRankMap.has(item.id) ? lexicalRankMap.get(item.id)! : -1;
      const tagRank = tagRankMap.has(item.id) ? tagRankMap.get(item.id)! : -1;
      const sevRank = severityRankMap.has(item.id) ? severityRankMap.get(item.id)! : -1;

      if (lexRank >= 0 || tagRank >= 0) {
        const rrfScore = computeRrfScore(item, lexRank, tagRank, sevRank);
        scored.push({ item, score: rrfScore });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  async mapIntentToInvariants(intent: string): Promise<string[]> {
    const q = intent.toLowerCase();
    const matched: Set<string> = new Set();

    // Эвристический маппинг
    if (
      q.includes('оплата') || q.includes('баланс') || q.includes('копейк') || 
      q.includes('wallet') || q.includes('fintech') || q.includes('транзакци') ||
      q.includes('billing') || q.includes('payment') || q.includes('money')
    ) {
      matched.add('WalletOps');
      matched.add('concurrency-acid-guard');
      matched.add('ddd-aggregate-invariants');
    }

    if (
      q.includes('concurrent') || q.includes('параллельн') || q.includes('race') || 
      q.includes('блокиров') || q.includes('lock') || q.includes('thread')
    ) {
      matched.add('concurrency-acid-guard');
    }

    if (
      q.includes('multi-tenant') || q.includes('smmflux') || q.includes('smmplan') || 
      q.includes('изоляци') || q.includes('tenant') || q.includes('brand') || q.includes('isolate')
    ) {
      matched.add('multi-tenant-isolation-arch');
    }

    if (
      q.includes('cache') || q.includes('кэш') || q.includes('redis') || 
      q.includes('shadow') || q.includes('buffer') || q.includes('redis')
    ) {
      matched.add('ddd-aggregate-invariants');
      matched.add('resilience-bulkhead-circuit');
    }

    if (
      q.includes('security') || q.includes('секрет') || q.includes('безопасно') || 
      q.includes('auth') || q.includes('webhook') || q.includes('rbac') || q.includes('protect')
    ) {
      matched.add('arch-boundary-guard');
      matched.add('owasp-security-auditor');
    }

    // Поиск по векторной памяти / RRF для доп. инвариантов
    const searchResults = await this.searchPyramid(intent, { layer: 'L1', topK: 3 });
    for (const res of searchResults) {
      // RRF scores are typically small (< 1.0). If there's a relevant score > 0.01, include it.
      if (res.score > 0.01) {
        matched.add(res.id);
      }
    }

    return Array.from(matched);
  }

  /**
   * Универсальный поиск по Пирамиде Памяти (L1, L2, ADR)
   */
  async searchPyramid(
    query: string,
    options?: { layer?: 'L1' | 'L2' | 'ADR' | 'ALL'; topK?: number }
  ): Promise<Array<{ id: string; layer: string; title: string; content: string; score: number; tags: string[] }>> {
    const layer = options?.layer || 'ALL';
    const topK = options?.topK || 5;
    const universalItems = this.collectUniversalItems(layer);

    if (universalItems.length === 0) return [];

    const ranked = this.rankItemsWithRrf(query, universalItems);

    return ranked.slice(0, topK).map(({ item, score }) => ({
      id: item.id,
      layer: item.layer,
      title: item.title,
      content: item.content,
      score: Math.round(score * 1000) / 1000,
      tags: item.tags,
    }));
  }

  private saveOfflineDecay(decay: TemporalDecayEntry): void {
    try {
      let registry: { decays: TemporalDecayEntry[] } = { decays: [] };
      if (fs.existsSync(this.offlineDecayFile)) {
        const raw = fs.readFileSync(this.offlineDecayFile, 'utf-8').trim();
        if (raw) {
          registry = JSON.parse(raw);
        }
      }
      registry.decays = registry.decays || [];
      registry.decays.push(decay);
      fs.writeFileSync(this.offlineDecayFile, JSON.stringify(registry, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save offline decay:', e);
    }
  }

  private searchOfflineCache(query: string): MemorySearchResult[] {
    const universalItems = this.collectUniversalItems('ALL');
    if (universalItems.length === 0) return [];

    const ranked = this.rankItemsWithRrf(query, universalItems);

    return ranked.slice(0, 5).map(({ item, score }) => ({
      title: item.title,
      content: item.content,
      collection:
        item.layer === 'ADR'
          ? 'architecture_decisions'
          : item.layer === 'L1'
            ? 'atomic_invariants'
            : 'scenario_recipes',
      score: Math.round(score * 1000) / 1000,
      metadata: { tags: item.tags, layer: item.layer, id: item.id },
    }));
  }
}

// CLI Interface
if (process.argv[1]?.includes('memory-client.ts')) {
  async function cli() {
    const client = new SmmplanMemoryClient();
    const command = process.argv[2];
    const arg = process.argv[3];
    const extra = process.argv[4];

    if (command === 'searchContext' || command === 'search') {
      const query = arg || 'баланс пользователя WalletOps';
      console.log(`🔍 [MemoryClient] Searching context for: "${query}"...`);
      const results = await client.searchContext(query);
      console.log(`Found ${results.length} results:`);
      results.forEach((r, i) => {
        console.log(`\n[${i + 1}] ${r.title} (score: ${r.score})`);
        console.log(`    ${r.content.replace(/\n/g, '\n    ')}`);
      });
      return;
    }

    if (command === 'searchPyramid' || command === 'pyramid') {
      const query = arg || 'database lock cache';
      const layer = (extra as 'L1' | 'L2' | 'ADR' | 'ALL') || 'ALL';
      console.log(`🔺 [MemoryClient] Searching Pyramid (${layer}) for: "${query}"...`);
      const results = await client.searchPyramid(query, { layer });
      console.log(`Found ${results.length} pyramid results:`);
      results.forEach((r, i) => {
        console.log(`\n[${i + 1}] [${r.layer}] ${r.title} (score: ${r.score})`);
        console.log(`    ${r.content.replace(/\n/g, '\n    ')}`);
      });
      return;
    }

    if (command === 'listInvariants' || command === 'invariants') {
      const invariants = client.getAtomicInvariants();
      console.log(`🛡️ [MemoryClient] ${invariants.length} L1 Atomic Invariants registered:`);
      invariants.forEach((inv) => {
        console.log(`\n• [${inv.id}] (${inv.category.toUpperCase()} | ${inv.severity})`);
        console.log(`  Rule: ${inv.rule}`);
        console.log(`  Rationale: ${inv.rationale}`);
        console.log(`  Tags: ${inv.tags.join(', ')}`);
      });
      return;
    }

    if (command === 'listRecipes' || command === 'recipes') {
      const recipes = client.getScenarioRecipes();
      console.log(`📋 [MemoryClient] ${recipes.length} L2 Scenario Recipes registered:`);
      recipes.forEach((rec) => {
        console.log(`\n• [${rec.id}] ${rec.title}`);
        console.log(`  Trigger: ${rec.triggerContext}`);
        console.log(`  Steps: ${rec.actionSteps.length} | Verification: ${rec.verification.join(', ')}`);
      });
      return;
    }

    if (command === 'mapIntent' || command === 'map') {
      const query = arg || '';
      console.log(`🧠 [MemoryClient] Mapping intent: "${query}"...`);
      const invariants = await client.mapIntentToInvariants(query);
      if (invariants.length > 0) {
        console.log(`🎯 Matched Invariants:`);
        invariants.forEach((inv) => console.log(`   - ${inv}`));
      } else {
        console.log(`⚠️ No specific invariants matched for this intent.`);
      }
      return;
    }

    console.log('🧪 Testing Memory Client v4.0 (Pyramid & RRF Edition)...');
    const results = await client.searchContext(arg || 'баланс пользователя WalletOps');
    console.log(`Found ${results.length} results.`);
    results.forEach((r, i) => {
      console.log(`[${i + 1}] ${r.title} (score: ${r.score})`);
    });
  }
  cli().catch(console.error);
}

