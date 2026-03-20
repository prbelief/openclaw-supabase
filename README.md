# openclaw-supabase

> 🦞 OpenClaw Plugins สำหรับ Supabase — Vector Memory + Database Admin

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Monorepo ที่รวม 2 plugins สำหรับ [OpenClaw](https://github.com/openclaw/openclaw) ที่เชื่อมต่อกับ [Supabase](https://supabase.com):

| Plugin                                                  | ทำอะไร                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| **[supabase-vector-memory](./packages/vector-memory/)** | Long-term memory + Knowledge base ด้วย pgvector — autoRecall ก่อน agent ตอบ |
| **[supabase-db-admin](./packages/db-admin/)**           | จัดการ database — CRUD, CREATE/DROP/ALTER table, Raw SQL                    |

## Requirements

- [OpenClaw](https://github.com/openclaw/openclaw) (ดู [Install](https://docs.openclaw.ai/install))
- [Supabase](https://supabase.com) project (free tier ใช้ได้)
- [Ollama](https://ollama.ai) + `nomic-embed-text` (สำหรับ vector-memory)

## Quick Install

### ทั้ง 2 plugin

```bash
# Clone repo
git clone https://github.com/prbelief/openclaw-supabase.git
cd openclaw-supabase

# Install ทีละตัว
openclaw plugins install ./packages/vector-memory
openclaw plugins install ./packages/db-admin

# Restart gateway
openclaw gateway restart
```

### เฉพาะตัวเดียว

```bash
# เฉพาะ vector memory
openclaw plugins install ./packages/vector-memory

# เฉพาะ db admin
openclaw plugins install ./packages/db-admin
```

### จาก npm (หลัง publish)

```bash
openclaw plugins install @prbelief/supabase-vector-memory
openclaw plugins install @prbelief/supabase-db-admin
```

## Supabase Setup

### 1. หา Credentials

ไปที่ **[Supabase Dashboard](https://supabase.com/dashboard)** → เลือก Project → **Settings** → **API Keys**

คุณต้องการ 2 ค่า:

- **Project URL** — `https://xxx.supabase.co`
- **Service Role Key** — `eyJhbGci...` (หรือ `sb_secret_...` สำหรับ project ใหม่)

> ⚠️ **Service Role Key bypass RLS ทั้งหมด** — อย่า commit ลง git, เก็บไว้ใน config เท่านั้น

### 2. รัน Migration

เปิด **Supabase Dashboard → SQL Editor** แล้วรัน SQL จาก:

- `packages/vector-memory/migration.sql` — สร้าง `longterm_memory`, `knowledge_base` tables + RPC functions
- `packages/db-admin/migration.sql` — สร้าง `exec_sql` RPC function

### 3. Ollama (สำหรับ vector-memory)

```bash
# ติดตั้ง embedding model
ollama pull nomic-embed-text
```

## Configuration

เพิ่มใน `openclaw.json` (หรือ config file ของ OpenClaw):

```jsonc
{
  "plugins": {
    "entries": {
      // ── Vector Memory ──────────────────────────
      "supabase-vector-memory": {
        "enabled": true,
        "config": {
          "supabaseUrl": "https://YOUR_PROJECT.supabase.co",
          "supabaseServiceKey": "eyJhbGci...",
          "ollamaUrl": "http://localhost:11434",
          "embeddingModel": "nomic-embed-text",
          "autoRecall": true,
          "autoRecallResults": 3,
          "minSimilarity": 0.5,
          "userId": "default",
        },
      },

      // ── DB Admin ───────────────────────────────
      "supabase-db-admin": {
        "enabled": true,
        "config": {
          "supabaseUrl": "https://YOUR_PROJECT.supabase.co",
          "supabaseServiceKey": "eyJhbGci...",
          "protectedTables": ["longterm_memory", "knowledge_base"],
        },
      },
    },
  },
}
```

### Config อธิบาย

#### supabase-vector-memory

| Key                  | Type    | Default                  | คำอธิบาย                     |
| -------------------- | ------- | ------------------------ | ---------------------------- |
| `supabaseUrl`        | string  | **(required)**           | Supabase Project URL         |
| `supabaseServiceKey` | string  | **(required)**           | Service Role Key             |
| `ollamaUrl`          | string  | `http://localhost:11434` | Ollama server                |
| `embeddingModel`     | string  | `nomic-embed-text`       | Embedding model              |
| `tables.longterm`    | string  | `longterm_memory`        | ชื่อ table memory            |
| `tables.knowledge`   | string  | `knowledge_base`         | ชื่อ table knowledge         |
| `autoRecall`         | boolean | `true`                   | auto-recall ก่อน agent ตอบ   |
| `autoRecallResults`  | number  | `3`                      | จำนวนผลลัพธ์ต่อ table        |
| `minSimilarity`      | number  | `0.5`                    | ค่า similarity ขั้นต่ำ (0-1) |
| `userId`             | string  | `default`                | User ID แยกข้อมูลรายคน       |

#### supabase-db-admin

| Key                  | Type     | Default        | คำอธิบาย                                     |
| -------------------- | -------- | -------------- | -------------------------------------------- |
| `supabaseUrl`        | string   | **(required)** | Supabase Project URL                         |
| `supabaseServiceKey` | string   | **(required)** | Service Role Key                             |
| `protectedTables`    | string[] | `[]`           | Table ที่ห้าม write/drop/alter (read ยังได้) |

## Tools Overview

### supabase-vector-memory (10 tools)

| Tool                   | หน้าที่                             |
| ---------------------- | ----------------------------------- |
| `supa_store`           | เก็บข้อมูล → longterm_memory        |
| `supa_store_knowledge` | เก็บความรู้ → knowledge_base        |
| `supa_query`           | ค้นหา table เดียว (semantic search) |
| `supa_query_all`       | ค้นทั้ง 2 table                     |
| `supa_save_fact`       | บันทึก fact + ตรวจซ้ำ               |
| `supa_save_knowledge`  | บันทึกความรู้ + ตรวจซ้ำ             |
| `supa_finance_summary` | สรุปการเงินรายเดือน                 |
| `supa_task_update`     | อัปเดต task metadata                |
| `supa_delete`          | ลบ record                           |
| `supa_stats`           | นับจำนวน records                    |

### supabase-db-admin (11 tools)

| Tool                | หน้าที่                    | Guard                              |
| ------------------- | -------------------------- | ---------------------------------- |
| `db_list_tables`    | ดู table ทั้งหมด           | —                                  |
| `db_describe_table` | ดู columns, types, indexes | —                                  |
| `db_select`         | SELECT ข้อมูล              | —                                  |
| `db_insert`         | INSERT rows                | protectedTables                    |
| `db_update`         | UPDATE rows                | protectedTables + filter required  |
| `db_delete_rows`    | DELETE rows                | protectedTables + filter required  |
| `db_create_table`   | CREATE TABLE               | —                                  |
| `db_drop_table`     | DROP TABLE                 | protectedTables + confirm required |
| `db_alter_table`    | ALTER TABLE                | protectedTables                    |
| `db_raw_read`       | Raw SQL (SELECT only)      | —                                  |
| `db_raw_write`      | Raw SQL (any)              | protectedTables + confirm for DROP |

## Development

```bash
git clone https://github.com/prbelief/openclaw-supabase.git
cd openclaw-supabase

# Build ทั้ง 2 plugin
npm run build

# Build เฉพาะตัว
npm run build:vector-memory
npm run build:db-admin

# Dev mode (watch)
npm run dev:vector-memory
npm run dev:db-admin

# Link สำหรับ dev (ไม่ต้อง copy)
openclaw plugins install -l ./packages/vector-memory
openclaw plugins install -l ./packages/db-admin
```

## Architecture

```
User Message
     │
     ├─── supabase-vector-memory ──────────────────┐
     │    before_prompt_build (autoRecall)          │
     │    ① Ollama embed (local)                    │
     │    ② Supabase RPC: match_all()              │  Supabase
     │    ③ Inject recalled context                 │  REST API
     │    └─ supa_* tools → POST /rest/v1/...      │  (direct)
     │                                              │
     ├─── supabase-db-admin ───────────────────────┤
     │    db_* tools                                │
     │    ├─ Structured → POST/PATCH/DELETE /rest/v1│
     │    └─ Raw SQL → POST /rest/v1/rpc/exec_sql  │
     └─────────────────────────────────────────────┘
```

## License

[MIT](LICENSE)
