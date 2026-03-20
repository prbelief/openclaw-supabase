# @prbelief/db-admin

> 🦞 OpenClaw Plugin — จัดการ Supabase database (CRUD + DDL + Raw SQL)

ส่วนหนึ่งของ [openclaw-supabase](../../README.md) monorepo

## Features

- **Structured tools**: list, describe, select, insert, update, delete, create, drop, alter
- **Raw SQL**: read-only + write (สำหรับกรณีพิเศษ)
- **protectedTables**: config table ที่ห้าม write/drop/alter (read ยังได้)
- **Safety guards**: DELETE/UPDATE ต้องมี filter, DROP ต้อง confirm

## Install

```bash
# จาก repo
openclaw plugins install ./packages/db-admin

# จาก npm (หลัง publish)
openclaw plugins install @prbelief/db-admin
```

## Setup

### 1. รัน Migration

paste `migration.sql` ใน **Supabase SQL Editor** — สร้าง `exec_sql` RPC function

### 2. Config ใน openclaw.json

```jsonc
{
  "allow": ["supabase-db-admin"],
  "plugins": {
    "entries": {
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

## protectedTables

| Operation                     | Protected table | Unprotected table |
| ----------------------------- | :-------------: | :---------------: |
| SELECT / describe             |       ✅        |        ✅         |
| INSERT / UPDATE / DELETE      |   ❌ blocked    |        ✅         |
| DROP / ALTER / TRUNCATE       |   ❌ blocked    |        ✅         |
| Raw SQL write ที่มีชื่อ table |   ❌ blocked    |        ✅         |

## Tools

### Structured (9 tools)

| Tool                | หน้าที่                    | Guard                     |
| ------------------- | -------------------------- | ------------------------- |
| `db_list_tables`    | ดู table ทั้งหมด           | —                         |
| `db_describe_table` | ดู columns, types, indexes | —                         |
| `db_select`         | SELECT ข้อมูล              | —                         |
| `db_insert`         | INSERT rows                | protectedTables           |
| `db_update`         | UPDATE rows                | protectedTables + filter  |
| `db_delete_rows`    | DELETE rows                | protectedTables + filter  |
| `db_create_table`   | CREATE TABLE               | —                         |
| `db_drop_table`     | DROP TABLE                 | protectedTables + confirm |
| `db_alter_table`    | ALTER TABLE                | protectedTables           |

### Raw SQL (2 tools)

| Tool           | หน้าที่                 | Guard                              |
| -------------- | ----------------------- | ---------------------------------- |
| `db_raw_read`  | SELECT / SHOW / EXPLAIN | —                                  |
| `db_raw_write` | Any SQL                 | protectedTables + confirm for DROP |

## License

[MIT](../../LICENSE)
