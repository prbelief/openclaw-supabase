/**
 * supabase-vector-memory — OpenClaw Plugin (v2)
 * ================================================
 * ใช้ Supabase REST API + RPC ตรง — ไม่ผ่าน Composio MCP
 *
 * แก้ปัญหา:
 *   - SQL query size limit (embedding 768 dims ~17KB)
 *   - ไม่ต้องพึ่ง Composio MCP
 *
 * การเชื่อมต่อ:
 *   - INSERT/UPDATE/DELETE → Supabase REST API (PostgREST)
 *   - Vector search        → Supabase RPC (rpc() via fetch)
 *   - Embedding            → Ollama local (nomic-embed-text)
 *
 * Tables:
 *   - longterm_memory (v2) — ข้อมูลส่วนตัว, tasks, finance, facts
 *   - knowledge_base       — ความรู้, docs, references
 *
 * Plugin Tools (prefix supa_):
 *   supa_store, supa_store_knowledge, supa_query, supa_query_all,
 *   supa_save_fact, supa_save_knowledge, supa_finance_summary,
 *   supa_task_update, supa_delete, supa_stats
 *
 * Hook:
 *   before_prompt_build → autoRecall ค้นทั้ง 2 table
 */

// ═════════════════════════════════════════════════════════════════════════════
// Types
// ═════════════════════════════════════════════════════════════════════════════

interface PluginConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;

  ollamaUrl: string;
  embeddingModel: string;

  tables: { longterm: string; knowledge: string };

  autoRecall: boolean;
  autoRecallResults: number;
  minSimilarity: number;
  saveConversations: boolean;
  userId: string;
}

interface MemoryRecord {
  id: number;
  source_table?: string;
  collection: string;
  content: string;
  topic?: string;
  metadata?: Record<string, any>;
  similarity?: number;
}

// ═════════════════════════════════════════════════════════════════════════════
// Ollama Embedding (local)
// ═════════════════════════════════════════════════════════════════════════════

async function embed(text: string, ollamaUrl: string, model: string): Promise<number[]> {
  const resp = await fetch(`${ollamaUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: text }),
  });
  if (!resp.ok) throw new Error(`Ollama embed failed: ${resp.status}`);
  const data = await resp.json();
  return data.embeddings[0];
}

// ═════════════════════════════════════════════════════════════════════════════
// Supabase Client — REST API + RPC via fetch
// ═════════════════════════════════════════════════════════════════════════════

function createSupabaseClient(cfg: PluginConfig) {
  const headers = {
    apikey: cfg.supabaseServiceKey,
    Authorization: `Bearer ${cfg.supabaseServiceKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  const baseUrl = cfg.supabaseUrl.replace(/\/$/, "");

  return {
    /**
     * INSERT row ผ่าน PostgREST
     * ไม่มีปัญหา query size limit เพราะส่งเป็น JSON body
     */
    async insert(table: string, data: Record<string, any>): Promise<any> {
      const resp = await fetch(`${baseUrl}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation,resolution=merge-duplicates" },
        body: JSON.stringify(data),
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Supabase INSERT ${table}: ${resp.status} — ${err}`);
      }
      return resp.json();
    },

    /**
     * UPSERT row (insert or update on conflict)
     */
    async upsert(table: string, data: Record<string, any>, onConflict?: string): Promise<any> {
      const prefer = onConflict
        ? `return=representation,resolution=merge-duplicates`
        : `return=representation`;
      const url = onConflict
        ? `${baseUrl}/rest/v1/${table}?on_conflict=${onConflict}`
        : `${baseUrl}/rest/v1/${table}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { ...headers, Prefer: prefer },
        body: JSON.stringify(data),
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Supabase UPSERT ${table}: ${resp.status} — ${err}`);
      }
      return resp.json();
    },

    /**
     * UPDATE row by id
     */
    async update(table: string, id: number, data: Record<string, any>): Promise<any> {
      const resp = await fetch(`${baseUrl}/rest/v1/${table}?id=eq.${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(data),
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Supabase UPDATE ${table}: ${resp.status} — ${err}`);
      }
      return resp.json();
    },

    /**
     * DELETE row by id
     */
    async delete(table: string, id: number, userId: string): Promise<any> {
      const resp = await fetch(
        `${baseUrl}/rest/v1/${table}?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}`,
        { method: "DELETE", headers },
      );
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Supabase DELETE ${table}: ${resp.status} — ${err}`);
      }
      return resp.json();
    },

    /**
     * SELECT with filters
     */
    async select(table: string, query: string = ""): Promise<any[]> {
      const resp = await fetch(`${baseUrl}/rest/v1/${table}?${query}`, {
        method: "GET",
        headers: { ...headers, Prefer: "" },
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Supabase SELECT ${table}: ${resp.status} — ${err}`);
      }
      return resp.json();
    },

    /**
     * RPC — เรียก Postgres function (vector search)
     * embedding ส่งเป็น JSON body → ไม่มี query size limit
     */
    async rpc(fnName: string, params: Record<string, any>): Promise<any> {
      const resp = await fetch(`${baseUrl}/rest/v1/rpc/${fnName}`, {
        method: "POST",
        headers: { ...headers, Prefer: "" },
        body: JSON.stringify(params),
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Supabase RPC ${fnName}: ${resp.status} — ${err}`);
      }
      return resp.json();
    },
  };
}

type SupaClient = ReturnType<typeof createSupabaseClient>;

// ═════════════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════════════

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ═════════════════════════════════════════════════════════════════════════════
// Auto-recall — ค้นทั้ง 2 table ผ่าน RPC match_all
// ═════════════════════════════════════════════════════════════════════════════

async function autoRecall(
  client: SupaClient, cfg: PluginConfig, userMessage: string,
): Promise<string> {
  const queryEmbedding = await embed(userMessage, cfg.ollamaUrl, cfg.embeddingModel);

  const results = await client.rpc("match_all", {
    query_embedding: queryEmbedding,
    match_threshold: cfg.minSimilarity,
    match_count: cfg.autoRecallResults * 2,
    p_user_id: cfg.userId,
  });

  if (!Array.isArray(results) || results.length === 0) return "";

  // จัดกลุ่มตาม source_table/collection
  const grouped: Record<string, any[]> = {};
  for (const r of results) {
    const key = `${r.source_table}/${r.collection}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }

  const parts: string[] = [];
  for (const [key, records] of Object.entries(grouped)) {
    parts.push(`[${key}]`);
    for (const r of records) {
      const sim = ((r.similarity ?? 0) * 100).toFixed(0);
      const extra = r.topic ? ` (topic: ${r.topic})` : "";
      parts.push(`  - (${sim}%) ${r.content}${extra}`);
    }
  }

  return `=== Recalled context (Supabase Vector Memory) ===\n${parts.join("\n")}\n=== End recalled context ===`;
}

// ═════════════════════════════════════════════════════════════════════════════
// Plugin Register
// ═════════════════════════════════════════════════════════════════════════════

export default function register(api: any) {
  const cfg: PluginConfig = {
    supabaseUrl: "",
    supabaseServiceKey: "",

    ollamaUrl: "http://localhost:11434",
    embeddingModel: "nomic-embed-text",

    tables: {
      longterm: "longterm_memory",
      knowledge: "knowledge_base",
    },

    autoRecall: true,
    autoRecallResults: 3,
    minSimilarity: 0.5,
    saveConversations: true,
    userId: "default",

    // merge user config
    ...api.pluginConfig,
  };

  // ── Validate ──────────────────────────────────────────────────────────

  if (!cfg.supabaseUrl || !cfg.supabaseServiceKey) {
    api.logger?.error?.(
      "supabase-vector-memory: ต้องตั้ง supabaseUrl และ supabaseServiceKey ใน config!"
    );
    return;
  }

  const client = createSupabaseClient(cfg);

  api.logger?.info?.("supabase-vector-memory: registered (REST API direct)");
  api.logger?.info?.(`  supabase: ${cfg.supabaseUrl}`);
  api.logger?.info?.(`  tables: ${cfg.tables.longterm}, ${cfg.tables.knowledge}`);

  // ── Hook: autoRecall ──────────────────────────────────────────────────

  if (cfg.autoRecall) {
    api.on(
      "before_prompt_build",
      async (event: any, ctx: any) => {
        try {
          const lastMsg = ctx.messages?.[ctx.messages.length - 1];
          if (!lastMsg || lastMsg.role !== "user") return {};
          const userText =
            typeof lastMsg.content === "string"
              ? lastMsg.content
              : lastMsg.content?.map?.((c: any) => c.text ?? "").join(" ") ?? "";
          if (!userText.trim()) return {};

          const context = await autoRecall(client, cfg, userText);
          if (context) return { prependSystemContext: context };
        } catch (err) {
          api.logger?.warn?.(`supabase-vector-memory: auto-recall error: ${err}`);
        }
        return {};
      },
      { priority: 5 },
    );
  }

  // ── Tool: supa_store → longterm_memory ─────────────────────────────────

  api.registerTool(
    {
      name: "supa_store",
      label: "Store → Long-term Memory",
      description:
        "เก็บข้อมูลลง longterm_memory (collection: tasks | finance | memory | general)",
      parameters: {
        type: "object",
        required: ["collection", "content"],
        properties: {
          collection: { type: "string", enum: ["tasks", "finance", "memory", "general"] },
          content: { type: "string", description: "เนื้อหา" },
          topic: { type: "string" },
          importance: { type: "string", enum: ["high", "medium", "low"], default: "medium" },
          source: { type: "string", default: "chat" },
          metadata: { type: "object", default: {} },
        },
      },
    },
    async ({ input }: any) => {
      const embedding = await embed(input.content, cfg.ollamaUrl, cfg.embeddingModel);
      const row = {
        collection: input.collection,
        user_id: cfg.userId,
        content: input.content,
        source: input.source ?? "chat",
        topic: input.topic ?? null,
        importance: input.importance ?? "medium",
        metadata: input.metadata ?? {},
        embedding: embedding,
      };
      const result = await client.insert(cfg.tables.longterm, row);
      const id = Array.isArray(result) ? result[0]?.id : result?.id;
      return { text: JSON.stringify({ status: "ok", id, table: cfg.tables.longterm }) };
    },
  );

  // ── Tool: supa_store_knowledge → knowledge_base ───────────────────────

  api.registerTool(
    {
      name: "supa_store_knowledge",
      label: "Store → Knowledge Base",
      description:
        "เก็บความรู้ลง knowledge_base (collection: docs | references | howto | general)",
      parameters: {
        type: "object",
        required: ["collection", "content"],
        properties: {
          collection: { type: "string", enum: ["docs", "references", "howto", "general"] },
          content: { type: "string" },
          source: { type: "string" },
          tags: { type: "string", description: "tags คั่นด้วย comma" },
          metadata: { type: "object", default: {} },
        },
      },
    },
    async ({ input }: any) => {
      const embedding = await embed(input.content, cfg.ollamaUrl, cfg.embeddingModel);
      const row = {
        collection: input.collection,
        user_id: cfg.userId,
        content: input.content,
        source: input.source ?? null,
        tags: input.tags ?? null,
        metadata: input.metadata ?? {},
        embedding: embedding,
      };
      const result = await client.insert(cfg.tables.knowledge, row);
      const id = Array.isArray(result) ? result[0]?.id : result?.id;
      return { text: JSON.stringify({ status: "ok", id, table: cfg.tables.knowledge }) };
    },
  );

  // ── Tool: supa_query (เลือก table) ────────────────────────────────────

  api.registerTool(
    {
      name: "supa_query",
      label: "Query Memory",
      description: "ค้นหาจาก table ที่เลือก ด้วย semantic search",
      parameters: {
        type: "object",
        required: ["table", "query"],
        properties: {
          table: { type: "string", enum: ["longterm_memory", "knowledge_base"] },
          query: { type: "string" },
          collection: { type: "string", description: "sub-collection (optional)" },
          n_results: { type: "number", default: 5 },
        },
      },
    },
    async ({ input }: any) => {
      const queryEmbedding = await embed(input.query, cfg.ollamaUrl, cfg.embeddingModel);
      const rpcName = input.table === "knowledge_base" ? "match_knowledge" : "match_longterm";
      const results = await client.rpc(rpcName, {
        query_embedding: queryEmbedding,
        match_threshold: cfg.minSimilarity,
        match_count: input.n_results ?? 5,
        p_user_id: cfg.userId,
        p_collection: input.collection ?? null,
      });
      return { text: JSON.stringify(results) };
    },
  );

  // ── Tool: supa_query_all (ทั้ง 2 table) ──────────────────────────────

  api.registerTool(
    {
      name: "supa_query_all",
      label: "Query All Tables",
      description: "ค้นทั้ง longterm_memory + knowledge_base พร้อมกัน",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
          n_results: { type: "number", default: 6 },
        },
      },
    },
    async ({ input }: any) => {
      const queryEmbedding = await embed(input.query, cfg.ollamaUrl, cfg.embeddingModel);
      const results = await client.rpc("match_all", {
        query_embedding: queryEmbedding,
        match_threshold: cfg.minSimilarity,
        match_count: input.n_results ?? 6,
        p_user_id: cfg.userId,
      });
      return { text: JSON.stringify(results) };
    },
  );

  // ── Tool: supa_save_fact → longterm_memory (ตรวจซ้ำ) ──────────────────

  api.registerTool(
    {
      name: "supa_save_fact",
      label: "Save Fact",
      description:
        "สกัดข้อมูลสำคัญ → longterm_memory (ตรวจซ้ำอัตโนมัติ). " +
        "topic: preference | person | goal | decision | context",
      parameters: {
        type: "object",
        required: ["fact"],
        properties: {
          fact: { type: "string" },
          topic: { type: "string" },
          importance: { type: "string", enum: ["high", "medium", "low"], default: "medium" },
          source: { type: "string", default: "chat" },
        },
      },
    },
    async ({ input }: any) => {
      const factEmbedding = await embed(input.fact, cfg.ollamaUrl, cfg.embeddingModel);

      // ตรวจซ้ำ — similarity > 0.85 → ลบเก่า
      try {
        const existing = await client.rpc("match_longterm", {
          query_embedding: factEmbedding,
          match_threshold: 0.85,
          match_count: 1,
          p_user_id: cfg.userId,
          p_collection: "memory",
        });
        if (Array.isArray(existing) && existing.length > 0) {
          await client.delete(cfg.tables.longterm, existing[0].id, cfg.userId);
        }
      } catch { /* ไม่มีเก่า */ }

      const row = {
        collection: "memory",
        user_id: cfg.userId,
        content: input.fact,
        source: input.source ?? "chat",
        topic: input.topic ?? null,
        importance: input.importance ?? "medium",
        metadata: {},
        embedding: factEmbedding,
      };
      const result = await client.insert(cfg.tables.longterm, row);
      const id = Array.isArray(result) ? result[0]?.id : result?.id;
      return { text: JSON.stringify({ status: "ok", id, fact: input.fact }) };
    },
  );

  // ── Tool: supa_save_knowledge → knowledge_base (ตรวจซ้ำ) ─────────────

  api.registerTool(
    {
      name: "supa_save_knowledge",
      label: "Save Knowledge",
      description: "บันทึกความรู้ → knowledge_base (ตรวจซ้ำ)",
      parameters: {
        type: "object",
        required: ["knowledge"],
        properties: {
          knowledge: { type: "string" },
          collection: { type: "string", enum: ["docs", "references", "howto", "general"], default: "general" },
          source: { type: "string" },
          tags: { type: "string" },
        },
      },
    },
    async ({ input }: any) => {
      const kbEmbedding = await embed(input.knowledge, cfg.ollamaUrl, cfg.embeddingModel);
      const collection = input.collection ?? "general";

      // ตรวจซ้ำ
      try {
        const existing = await client.rpc("match_knowledge", {
          query_embedding: kbEmbedding,
          match_threshold: 0.85,
          match_count: 1,
          p_user_id: cfg.userId,
          p_collection: collection,
        });
        if (Array.isArray(existing) && existing.length > 0) {
          await client.delete(cfg.tables.knowledge, existing[0].id, cfg.userId);
        }
      } catch { /* ไม่มีเก่า */ }

      const row = {
        collection,
        user_id: cfg.userId,
        content: input.knowledge,
        source: input.source ?? null,
        tags: input.tags ?? null,
        metadata: {},
        embedding: kbEmbedding,
      };
      const result = await client.insert(cfg.tables.knowledge, row);
      const id = Array.isArray(result) ? result[0]?.id : result?.id;
      return { text: JSON.stringify({ status: "ok", id, collection }) };
    },
  );

  // ── Tool: supa_finance_summary ────────────────────────────────────────

  api.registerTool(
    {
      name: "supa_finance_summary",
      label: "Finance Summary",
      description: 'สรุปรายรับ-รายจ่ายรายเดือน เช่น "2026-03"',
      parameters: {
        type: "object",
        required: ["year_month"],
        properties: { year_month: { type: "string", description: "YYYY-MM" } },
      },
    },
    async ({ input }: any) => {
      const start = `${input.year_month}-01`;
      const end = `${input.year_month}-31`;
      // ใช้ PostgREST filter — metadata เก็บแบบ JSONB
      // finance records อาจเก็บ date ใน metadata หรือ created_at
      const rows = await client.select(
        cfg.tables.longterm,
        `collection=eq.finance&user_id=eq.${encodeURIComponent(cfg.userId)}` +
        `&created_at=gte.${start}T00:00:00&created_at=lte.${end}T23:59:59` +
        `&select=id,content,metadata,importance,created_at`,
      );

      let totalIncome = 0, totalExpense = 0;
      const byCategory: Record<string, number> = {};

      for (const row of rows) {
        const meta = row.metadata ?? {};
        const amount = parseFloat(meta.amount ?? 0);
        if (meta.type === "income") {
          totalIncome += amount;
        } else {
          totalExpense += amount;
          const cat = meta.category ?? "other";
          byCategory[cat] = (byCategory[cat] ?? 0) + amount;
        }
      }

      return {
        text: JSON.stringify({
          month: input.year_month,
          total_income: totalIncome,
          total_expense: totalExpense,
          balance: totalIncome - totalExpense,
          expense_by_category: byCategory,
          records: rows.length,
        }),
      };
    },
  );

  // ── Tool: supa_task_update ────────────────────────────────────────────

  api.registerTool(
    {
      name: "supa_task_update",
      label: "Task Update",
      description: "อัปเดต metadata/importance/topic ของ task",
      parameters: {
        type: "object",
        required: ["doc_id", "updates"],
        properties: {
          doc_id: { type: "number", description: "id ของ record" },
          updates: { type: "object", description: "fields ที่ต้องการแก้ (importance, topic, metadata)" },
        },
      },
    },
    async ({ input }: any) => {
      const data: Record<string, any> = { updated_at: new Date().toISOString() };
      if (input.updates.importance) data.importance = input.updates.importance;
      if (input.updates.topic) data.topic = input.updates.topic;
      if (input.updates.metadata) data.metadata = input.updates.metadata;
      if (input.updates.content) data.content = input.updates.content;

      await client.update(cfg.tables.longterm, input.doc_id, data);
      return { text: JSON.stringify({ status: "ok", id: input.doc_id, updates: input.updates }) };
    },
  );

  // ── Tool: supa_delete ─────────────────────────────────────────────────

  api.registerTool(
    {
      name: "supa_delete",
      label: "Delete Record",
      description: "ลบ record จาก table ที่ระบุ",
      parameters: {
        type: "object",
        required: ["table", "doc_id"],
        properties: {
          table: { type: "string", enum: ["longterm_memory", "knowledge_base"] },
          doc_id: { type: "number" },
        },
      },
    },
    async ({ input }: any) => {
      const table = input.table === "knowledge_base" ? cfg.tables.knowledge : cfg.tables.longterm;
      await client.delete(table, input.doc_id, cfg.userId);
      return { text: JSON.stringify({ status: "ok", deleted: input.doc_id, table }) };
    },
  );

  // ── Tool: supa_stats ──────────────────────────────────────────────────

  api.registerTool(
    {
      name: "supa_stats",
      label: "Memory Stats",
      description: "ดูจำนวน records ทั้ง 2 table",
      parameters: { type: "object", properties: {} },
    },
    async () => {
      try {
        // PostgREST ใช้ HEAD request + Prefer: count=exact
        const countTable = async (table: string) => {
          const baseUrl = cfg.supabaseUrl.replace(/\/$/, "");
          const resp = await fetch(
            `${baseUrl}/rest/v1/${table}?user_id=eq.${encodeURIComponent(cfg.userId)}&select=collection`,
            {
              method: "GET",
              headers: {
                apikey: cfg.supabaseServiceKey,
                Authorization: `Bearer ${cfg.supabaseServiceKey}`,
                Prefer: "count=exact",
              },
            },
          );
          const rows = await resp.json();
          // group by collection
          const counts: Record<string, number> = {};
          for (const r of (Array.isArray(rows) ? rows : [])) {
            counts[r.collection] = (counts[r.collection] ?? 0) + 1;
          }
          return counts;
        };

        const ltm = await countTable(cfg.tables.longterm);
        const kb = await countTable(cfg.tables.knowledge);
        return { text: JSON.stringify({ longterm_memory: ltm, knowledge_base: kb }) };
      } catch (err) {
        return { text: JSON.stringify({ error: String(err) }) };
      }
    },
  );
}
