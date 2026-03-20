/**
 * supabase-db-admin — OpenClaw Plugin
 * ======================================
 * จัดการ Supabase database ผ่าน REST API + RPC ตรง
 *
 * 2 ระดับ:
 *   A) Tool สำเร็จรูป (ปลอดภัย, มี guard)
 *      - db_list_tables       ดู table ทั้งหมด
 *      - db_describe_table    ดู columns, types
 *      - db_select            SELECT ข้อมูล
 *      - db_insert            INSERT rows
 *      - db_update            UPDATE rows (ต้องมี where)
 *      - db_delete_rows       DELETE rows (ต้องมี where)
 *      - db_create_table      สร้าง table ใหม่
 *      - db_drop_table        DROP table (ต้อง confirm)
 *      - db_alter_table       เพิ่ม/ลบ/แก้ column
 *
 *   B) Raw SQL (สำหรับกรณีพิเศษ)
 *      - db_raw_read          SELECT / SHOW / EXPLAIN
 *      - db_raw_write         INSERT / UPDATE / DELETE / CREATE / ALTER / DROP
 *
 * Safety:
 *   - protectedTables — list ของ table ที่ห้าม write/drop/alter
 *   - DROP ต้องส่ง confirm: true
 *   - DELETE/UPDATE ต้องมี where clause
 *   - raw_write เช็ค protectedTables ก่อนรัน
 */

// ═════════════════════════════════════════════════════════════════════════════
// Types
// ═════════════════════════════════════════════════════════════════════════════

interface PluginConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;

  // table ที่ห้ามแตะ (write/drop/alter) — read ยังได้
  protectedTables: string[];
}

// ═════════════════════════════════════════════════════════════════════════════
// Supabase Client
// ═════════════════════════════════════════════════════════════════════════════

function createClient(cfg: PluginConfig) {
  const baseUrl = cfg.supabaseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    apikey: cfg.supabaseServiceKey,
    Authorization: `Bearer ${cfg.supabaseServiceKey}`,
    "Content-Type": "application/json",
  };

  return {
    async restGet(table: string, query: string = ""): Promise<any> {
      const resp = await fetch(`${baseUrl}/rest/v1/${table}?${query}`, {
        method: "GET",
        headers: { ...headers, Prefer: "" },
      });
      if (!resp.ok) throw new Error(`GET ${table}: ${resp.status} — ${await resp.text()}`);
      return resp.json();
    },

    async restPost(table: string, data: any): Promise<any> {
      const resp = await fetch(`${baseUrl}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(data),
      });
      if (!resp.ok) throw new Error(`POST ${table}: ${resp.status} — ${await resp.text()}`);
      return resp.json();
    },

    async restPatch(table: string, filter: string, data: any): Promise<any> {
      const resp = await fetch(`${baseUrl}/rest/v1/${table}?${filter}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(data),
      });
      if (!resp.ok) throw new Error(`PATCH ${table}: ${resp.status} — ${await resp.text()}`);
      return resp.json();
    },

    async restDelete(table: string, filter: string): Promise<any> {
      const resp = await fetch(`${baseUrl}/rest/v1/${table}?${filter}`, {
        method: "DELETE",
        headers: { ...headers, Prefer: "return=representation" },
      });
      if (!resp.ok) throw new Error(`DELETE ${table}: ${resp.status} — ${await resp.text()}`);
      return resp.json();
    },

    async rpc(fnName: string, params: Record<string, any> = {}): Promise<any> {
      const resp = await fetch(`${baseUrl}/rest/v1/rpc/${fnName}`, {
        method: "POST",
        headers: { ...headers, Prefer: "" },
        body: JSON.stringify(params),
      });
      if (!resp.ok) throw new Error(`RPC ${fnName}: ${resp.status} — ${await resp.text()}`);
      return resp.json();
    },
  };
}

type DB = ReturnType<typeof createClient>;

// ═════════════════════════════════════════════════════════════════════════════
// SQL Execution via RPC
// ═════════════════════════════════════════════════════════════════════════════
// ใช้ Postgres function exec_sql เพื่อรัน raw SQL
// ต้อง create function นี้ใน migration.sql ก่อน

async function execSQL(db: DB, sql: string): Promise<any> {
  return db.rpc("exec_sql", { query: sql });
}

// ═════════════════════════════════════════════════════════════════════════════
// Guards
// ═════════════════════════════════════════════════════════════════════════════

function isProtected(table: string, protectedTables: string[]): boolean {
  const t = table.toLowerCase().trim();
  return protectedTables.some((p) => t === p.toLowerCase().trim());
}

function guardWrite(table: string, cfg: PluginConfig): void {
  if (isProtected(table, cfg.protectedTables)) {
    throw new Error(`❌ Table "${table}" อยู่ใน protectedTables — ห้าม write/drop/alter`);
  }
}

/** เช็ค raw SQL ว่าแตะ protectedTables หรือเปล่า */
function guardRawSQL(sql: string, cfg: PluginConfig): void {
  const sqlLower = sql.toLowerCase();
  for (const table of cfg.protectedTables) {
    const tLower = table.toLowerCase().trim();
    // เช็คว่า SQL มีชื่อ table อยู่ + เป็น write operation
    if (
      sqlLower.includes(tLower) &&
      (sqlLower.match(/^\s*(insert|update|delete|drop|alter|truncate)/i))
    ) {
      throw new Error(
        `❌ SQL มี write operation ที่แตะ protected table "${table}" — ยกเลิก`
      );
    }
  }
}

function esc(val: string): string {
  return val.replace(/'/g, "''");
}

// ═════════════════════════════════════════════════════════════════════════════
// Plugin Register
// ═════════════════════════════════════════════════════════════════════════════

export default function register(api: any) {
  const cfg: PluginConfig = {
    supabaseUrl: "",
    supabaseServiceKey: "",
    protectedTables: [],
    ...api.pluginConfig,
  };

  if (!cfg.supabaseUrl || !cfg.supabaseServiceKey) {
    api.logger?.error?.("supabase-db-admin: ต้องตั้ง supabaseUrl + supabaseServiceKey!");
    return;
  }

  const db = createClient(cfg);

  api.logger?.info?.("supabase-db-admin: registered");
  api.logger?.info?.(`  protected tables: [${cfg.protectedTables.join(", ")}]`);

  // ═════════════════════════════════════════════════════════════════════════
  // A) Tool สำเร็จรูป
  // ═════════════════════════════════════════════════════════════════════════

  // ── db_list_tables ────────────────────────────────────────────────────

  api.registerTool(
    {
      name: "db_list_tables",
      label: "List Tables",
      description: "ดู table ทั้งหมดใน public schema",
      parameters: { type: "object", properties: {} },
    },
    async () => {
      const sql = `
        SELECT table_name, 
               pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS size,
               (SELECT count(*)::INT FROM information_schema.columns c 
                WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS columns
        FROM information_schema.tables t
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `;
      const result = await execSQL(db, sql);
      return { text: JSON.stringify(result) };
    },
  );

  // ── db_describe_table ─────────────────────────────────────────────────

  api.registerTool(
    {
      name: "db_describe_table",
      label: "Describe Table",
      description: "ดู columns, types, defaults, nullable ของ table",
      parameters: {
        type: "object",
        required: ["table"],
        properties: {
          table: { type: "string", description: "ชื่อ table" },
        },
      },
    },
    async ({ input }: any) => {
      const sql = `
        SELECT column_name, data_type, column_default, is_nullable,
               character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '${esc(input.table)}'
        ORDER BY ordinal_position
      `;
      const columns = await execSQL(db, sql);

      const idxSql = `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = '${esc(input.table)}'
      `;
      const indexes = await execSQL(db, idxSql);

      // count rows
      const countSql = `SELECT count(*)::INT AS total FROM "${esc(input.table)}"`;
      let rowCount = 0;
      try {
        const countResult = await execSQL(db, countSql);
        rowCount = Array.isArray(countResult) ? countResult[0]?.total : 0;
      } catch { /* table อาจว่าง */ }

      return {
        text: JSON.stringify({
          table: input.table,
          row_count: rowCount,
          columns,
          indexes,
        }),
      };
    },
  );

  // ── db_select ─────────────────────────────────────────────────────────

  api.registerTool(
    {
      name: "db_select",
      label: "SELECT",
      description: "อ่านข้อมูลจาก table (ใช้ PostgREST filter syntax)",
      parameters: {
        type: "object",
        required: ["table"],
        properties: {
          table: { type: "string" },
          select: { type: "string", default: "*", description: "columns เช่น 'id,name,email'" },
          filter: { type: "string", description: "PostgREST filter เช่น 'status=eq.active&age=gt.18'" },
          order: { type: "string", description: "เช่น 'created_at.desc'" },
          limit: { type: "number", default: 50 },
        },
      },
    },
    async ({ input }: any) => {
      let query = `select=${encodeURIComponent(input.select ?? "*")}`;
      if (input.filter) query += `&${input.filter}`;
      if (input.order) query += `&order=${encodeURIComponent(input.order)}`;
      query += `&limit=${input.limit ?? 50}`;
      const rows = await db.restGet(input.table, query);
      return { text: JSON.stringify({ table: input.table, count: rows.length, rows }) };
    },
  );

  // ── db_insert ─────────────────────────────────────────────────────────

  api.registerTool(
    {
      name: "db_insert",
      label: "INSERT",
      description: "เพิ่ม row(s) ลง table — ส่งเป็น object หรือ array of objects",
      parameters: {
        type: "object",
        required: ["table", "data"],
        properties: {
          table: { type: "string" },
          data: { description: "object หรือ array of objects ที่จะ insert" },
        },
      },
    },
    async ({ input }: any) => {
      guardWrite(input.table, cfg);
      const result = await db.restPost(input.table, input.data);
      const count = Array.isArray(result) ? result.length : 1;
      return { text: JSON.stringify({ status: "ok", table: input.table, inserted: count }) };
    },
  );

  // ── db_update ─────────────────────────────────────────────────────────

  api.registerTool(
    {
      name: "db_update",
      label: "UPDATE",
      description: "แก้ไข row(s) — ต้องมี filter (ห้าม update ทั้ง table)",
      parameters: {
        type: "object",
        required: ["table", "filter", "data"],
        properties: {
          table: { type: "string" },
          filter: { type: "string", description: "PostgREST filter เช่น 'id=eq.5'" },
          data: { type: "object", description: "fields ที่จะ update" },
        },
      },
    },
    async ({ input }: any) => {
      guardWrite(input.table, cfg);
      if (!input.filter || !input.filter.trim()) {
        throw new Error("❌ ต้องระบุ filter — ไม่อนุญาตให้ UPDATE ทั้ง table");
      }
      const result = await db.restPatch(input.table, input.filter, input.data);
      const count = Array.isArray(result) ? result.length : 0;
      return { text: JSON.stringify({ status: "ok", table: input.table, updated: count }) };
    },
  );

  // ── db_delete_rows ────────────────────────────────────────────────────

  api.registerTool(
    {
      name: "db_delete_rows",
      label: "DELETE Rows",
      description: "ลบ row(s) — ต้องมี filter (ห้าม delete ทั้ง table)",
      parameters: {
        type: "object",
        required: ["table", "filter"],
        properties: {
          table: { type: "string" },
          filter: { type: "string", description: "PostgREST filter เช่น 'id=eq.5' หรือ 'status=eq.archived'" },
        },
      },
    },
    async ({ input }: any) => {
      guardWrite(input.table, cfg);
      if (!input.filter || !input.filter.trim()) {
        throw new Error("❌ ต้องระบุ filter — ไม่อนุญาตให้ DELETE ทั้ง table");
      }
      const result = await db.restDelete(input.table, input.filter);
      const count = Array.isArray(result) ? result.length : 0;
      return { text: JSON.stringify({ status: "ok", table: input.table, deleted: count }) };
    },
  );

  // ── db_create_table ───────────────────────────────────────────────────

  api.registerTool(
    {
      name: "db_create_table",
      label: "CREATE TABLE",
      description: "สร้าง table ใหม่ — ระบุ columns เป็น array",
      parameters: {
        type: "object",
        required: ["table", "columns"],
        properties: {
          table: { type: "string", description: "ชื่อ table ใหม่" },
          columns: {
            type: "array",
            description: "array ของ column definitions",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string", description: "เช่น TEXT, INT, SERIAL, JSONB, TIMESTAMPTZ, vector(768)" },
                nullable: { type: "boolean", default: true },
                default: { type: "string", description: "default value เช่น 'now()'" },
                primary_key: { type: "boolean", default: false },
              },
            },
          },
        },
      },
    },
    async ({ input }: any) => {
      const colDefs = input.columns.map((c: any) => {
        let def = `"${esc(c.name)}" ${c.type}`;
        if (c.primary_key) def += " PRIMARY KEY";
        if (c.nullable === false) def += " NOT NULL";
        if (c.default) def += ` DEFAULT ${c.default}`;
        return def;
      });
      const sql = `CREATE TABLE IF NOT EXISTS "${esc(input.table)}" (\n  ${colDefs.join(",\n  ")}\n)`;
      await execSQL(db, sql);
      return { text: JSON.stringify({ status: "ok", created: input.table, sql }) };
    },
  );

  // ── db_drop_table ─────────────────────────────────────────────────────

  api.registerTool(
    {
      name: "db_drop_table",
      label: "DROP TABLE",
      description: "⚠️ ลบ table ถาวร — ต้องส่ง confirm: true",
      parameters: {
        type: "object",
        required: ["table", "confirm"],
        properties: {
          table: { type: "string" },
          confirm: { type: "boolean", description: "ต้องเป็น true เท่านั้น" },
        },
      },
    },
    async ({ input }: any) => {
      guardWrite(input.table, cfg);
      if (input.confirm !== true) {
        return { text: JSON.stringify({ status: "cancelled", message: "ต้องส่ง confirm: true เพื่อยืนยัน DROP" }) };
      }
      const sql = `DROP TABLE IF EXISTS "${esc(input.table)}" CASCADE`;
      await execSQL(db, sql);
      return { text: JSON.stringify({ status: "ok", dropped: input.table }) };
    },
  );

  // ── db_alter_table ────────────────────────────────────────────────────

  api.registerTool(
    {
      name: "db_alter_table",
      label: "ALTER TABLE",
      description: "เพิ่ม/ลบ/แก้ column หรือ rename table",
      parameters: {
        type: "object",
        required: ["table", "action"],
        properties: {
          table: { type: "string" },
          action: {
            type: "string",
            enum: ["add_column", "drop_column", "rename_column", "rename_table", "change_type"],
            description: "ประเภทการแก้ไข",
          },
          column: { type: "string", description: "ชื่อ column (สำหรับ add/drop/rename/change)" },
          column_type: { type: "string", description: "type ใหม่ (สำหรับ add_column / change_type)" },
          new_name: { type: "string", description: "ชื่อใหม่ (สำหรับ rename_column / rename_table)" },
          nullable: { type: "boolean", default: true },
          default_value: { type: "string" },
        },
      },
    },
    async ({ input }: any) => {
      guardWrite(input.table, cfg);
      let sql = "";

      switch (input.action) {
        case "add_column": {
          let colDef = `"${esc(input.column)}" ${input.column_type}`;
          if (input.nullable === false) colDef += " NOT NULL";
          if (input.default_value) colDef += ` DEFAULT ${input.default_value}`;
          sql = `ALTER TABLE "${esc(input.table)}" ADD COLUMN ${colDef}`;
          break;
        }
        case "drop_column":
          sql = `ALTER TABLE "${esc(input.table)}" DROP COLUMN IF EXISTS "${esc(input.column)}"`;
          break;
        case "rename_column":
          sql = `ALTER TABLE "${esc(input.table)}" RENAME COLUMN "${esc(input.column)}" TO "${esc(input.new_name)}"`;
          break;
        case "rename_table":
          sql = `ALTER TABLE "${esc(input.table)}" RENAME TO "${esc(input.new_name)}"`;
          break;
        case "change_type":
          sql = `ALTER TABLE "${esc(input.table)}" ALTER COLUMN "${esc(input.column)}" TYPE ${input.column_type}`;
          break;
        default:
          throw new Error(`Unknown action: ${input.action}`);
      }

      await execSQL(db, sql);
      return { text: JSON.stringify({ status: "ok", table: input.table, action: input.action, sql }) };
    },
  );

  // ═════════════════════════════════════════════════════════════════════════
  // B) Raw SQL
  // ═════════════════════════════════════════════════════════════════════════

  // ── db_raw_read (SELECT only) ─────────────────────────────────────────

  api.registerTool(
    {
      name: "db_raw_read",
      label: "Raw SQL (Read)",
      description: "รัน SELECT / SHOW / EXPLAIN query ตรงๆ (read-only)",
      parameters: {
        type: "object",
        required: ["sql"],
        properties: {
          sql: { type: "string", description: "SQL query (SELECT, SHOW, EXPLAIN เท่านั้น)" },
        },
      },
    },
    async ({ input }: any) => {
      const sqlTrimmed = input.sql.trim().toLowerCase();
      if (!sqlTrimmed.startsWith("select") && !sqlTrimmed.startsWith("show") &&
          !sqlTrimmed.startsWith("explain") && !sqlTrimmed.startsWith("with")) {
        throw new Error("❌ db_raw_read รองรับแค่ SELECT / SHOW / EXPLAIN / WITH — ใช้ db_raw_write สำหรับอื่นๆ");
      }
      const result = await execSQL(db, input.sql);
      return { text: JSON.stringify(result) };
    },
  );

  // ── db_raw_write (any SQL) ────────────────────────────────────────────

  api.registerTool(
    {
      name: "db_raw_write",
      label: "Raw SQL (Write)",
      description: "⚠️ รัน SQL อะไรก็ได้ (INSERT/UPDATE/DELETE/CREATE/ALTER/DROP) — เช็ค protectedTables",
      parameters: {
        type: "object",
        required: ["sql"],
        properties: {
          sql: { type: "string", description: "SQL query" },
          confirm: { type: "boolean", description: "ต้องเป็น true สำหรับ DROP/TRUNCATE" },
        },
      },
    },
    async ({ input }: any) => {
      const sqlLower = input.sql.trim().toLowerCase();

      // เช็ค protectedTables
      guardRawSQL(input.sql, cfg);

      // DROP/TRUNCATE ต้อง confirm
      if ((sqlLower.startsWith("drop") || sqlLower.startsWith("truncate")) && input.confirm !== true) {
        return {
          text: JSON.stringify({
            status: "cancelled",
            message: "⚠️ DROP/TRUNCATE ต้องส่ง confirm: true เพื่อยืนยัน",
          }),
        };
      }

      const result = await execSQL(db, input.sql);
      return { text: JSON.stringify({ status: "ok", result }) };
    },
  );
}
