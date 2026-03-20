# @prbelief/vector-memory

> 🦞 OpenClaw Plugin — Long-term memory + Knowledge base ด้วย Supabase pgvector

ส่วนหนึ่งของ [openclaw-supabase](../../README.md) monorepo

## Features

- **2 Tables**: `longterm_memory` (ข้อมูลส่วนตัว, tasks, finance) + `knowledge_base` (ความรู้, docs)
- **Auto-recall**: ค้นทั้ง 2 table ก่อน agent ตอบทุกครั้ง (hook `before_prompt_build`)
- **Semantic search**: pgvector cosine similarity ผ่าน RPC
- **Local embedding**: Ollama + nomic-embed-text (ข้อมูลไม่ออกนอก server)
- **Dedup**: ตรวจซ้ำอัตโนมัติก่อนบันทึก
- **Supabase REST API ตรง**: ไม่มีปัญหา query size limit

## Install

```bash
# จาก repo
openclaw plugins install ./packages/vector-memory

# จาก npm (หลัง publish)
openclaw plugins install @prbelief/vector-memory
```

## Setup

### 1. รัน Migration

paste `migration.sql` ใน **Supabase SQL Editor**

### 2. Pull embedding model

```bash
ollama pull nomic-embed-text
```

### 3. Config ใน openclaw.json

```jsonc
{
  "allow": ["supabase-vector-memory"],
  "plugins": {
    "entries": {
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
    },
  },
}
```

> หา credentials จาก **Supabase Dashboard → Settings → API Keys**

## Tools

| Tool                   | Table           | หน้าที่                 |
| ---------------------- | --------------- | ----------------------- |
| `supa_store`           | longterm_memory | เก็บข้อมูลส่วนตัว       |
| `supa_store_knowledge` | knowledge_base  | เก็บความรู้             |
| `supa_query`           | เลือกได้        | ค้นหา table เดียว       |
| `supa_query_all`       | ทั้ง 2 table    | ค้นรวม                  |
| `supa_save_fact`       | longterm_memory | บันทึก fact + ตรวจซ้ำ   |
| `supa_save_knowledge`  | knowledge_base  | บันทึกความรู้ + ตรวจซ้ำ |
| `supa_finance_summary` | longterm_memory | สรุปการเงินรายเดือน     |
| `supa_task_update`     | longterm_memory | อัปเดต task             |
| `supa_delete`          | เลือกได้        | ลบ record               |
| `supa_stats`           | ทั้ง 2 table    | นับจำนวน records        |

## License

[MIT](../../LICENSE)
