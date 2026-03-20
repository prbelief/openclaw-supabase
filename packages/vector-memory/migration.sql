-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-vector-memory: Migration
-- ═══════════════════════════════════════════════════════════════════════════
-- รันใน Supabase SQL Editor
--
-- สิ่งที่ทำ:
--   1. สร้าง longterm_memory + knowledge_base (สดใหม่)
--   2. สร้าง RPC functions สำหรับ vector search
--   3. สร้าง indexes
--
-- หลังสร้างเสร็จ → ใช้ plugin เพื่อ import ข้อมูลจาก ChromaDB เข้ามาทีหลัง
--
-- Embedding: nomic-embed-text = 768 dimensions
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;


-- ═══════════════════════════════════════════════════════════════════════════
-- Table: longterm_memory
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS longterm_memory (
  id          SERIAL PRIMARY KEY,
  collection  TEXT NOT NULL DEFAULT 'memory',    -- memory | tasks | finance | general
  user_id     TEXT NOT NULL DEFAULT 'default',
  content     TEXT NOT NULL,
  source      TEXT DEFAULT 'chat',
  topic       TEXT,
  importance  TEXT DEFAULT 'medium',
  metadata    JSONB NOT NULL DEFAULT '{}',
  embedding   vector(768),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ltm_embedding
  ON longterm_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_ltm_collection_user
  ON longterm_memory (collection, user_id);

CREATE INDEX IF NOT EXISTS idx_ltm_topic
  ON longterm_memory (topic) WHERE topic IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ltm_metadata
  ON longterm_memory USING gin (metadata);


-- ═══════════════════════════════════════════════════════════════════════════
-- Table: knowledge_base
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS knowledge_base (
  id          SERIAL PRIMARY KEY,
  collection  TEXT NOT NULL DEFAULT 'general',   -- docs | references | howto | general
  user_id     TEXT NOT NULL DEFAULT 'default',
  content     TEXT NOT NULL,
  source      TEXT,
  tags        TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  embedding   vector(768),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_embedding
  ON knowledge_base USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_kb_collection_user
  ON knowledge_base (collection, user_id);

CREATE INDEX IF NOT EXISTS idx_kb_metadata
  ON knowledge_base USING gin (metadata);


-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: match_longterm — vector search ใน longterm_memory
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION match_longterm(
  query_embedding  vector(768),
  match_threshold  FLOAT DEFAULT 0.5,
  match_count      INT DEFAULT 5,
  p_user_id        TEXT DEFAULT 'default',
  p_collection     TEXT DEFAULT NULL
)
RETURNS TABLE (
  id INT, collection TEXT, content TEXT, source TEXT, topic TEXT,
  importance TEXT, metadata JSONB, similarity FLOAT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ltm.id, ltm.collection, ltm.content, ltm.source, ltm.topic,
    ltm.importance, ltm.metadata,
    (1 - (ltm.embedding <=> query_embedding))::FLOAT AS similarity
  FROM longterm_memory ltm
  WHERE ltm.user_id = p_user_id
    AND ltm.embedding IS NOT NULL
    AND (p_collection IS NULL OR ltm.collection = p_collection)
    AND 1 - (ltm.embedding <=> query_embedding) > match_threshold
  ORDER BY ltm.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: match_knowledge — vector search ใน knowledge_base
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding  vector(768),
  match_threshold  FLOAT DEFAULT 0.5,
  match_count      INT DEFAULT 5,
  p_user_id        TEXT DEFAULT 'default',
  p_collection     TEXT DEFAULT NULL
)
RETURNS TABLE (
  id INT, collection TEXT, content TEXT, source TEXT, tags TEXT,
  metadata JSONB, similarity FLOAT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kb.id, kb.collection, kb.content, kb.source, kb.tags,
    kb.metadata,
    (1 - (kb.embedding <=> query_embedding))::FLOAT AS similarity
  FROM knowledge_base kb
  WHERE kb.user_id = p_user_id
    AND kb.embedding IS NOT NULL
    AND (p_collection IS NULL OR kb.collection = p_collection)
    AND 1 - (kb.embedding <=> query_embedding) > match_threshold
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: match_all — ค้นทั้ง 2 table (สำหรับ autoRecall)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION match_all(
  query_embedding  vector(768),
  match_threshold  FLOAT DEFAULT 0.5,
  match_count      INT DEFAULT 6,
  p_user_id        TEXT DEFAULT 'default'
)
RETURNS TABLE (
  id INT, source_table TEXT, collection TEXT, content TEXT,
  topic TEXT, metadata JSONB, similarity FLOAT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  (
    SELECT ltm.id, 'longterm_memory'::TEXT, ltm.collection, ltm.content,
           ltm.topic, ltm.metadata,
           (1 - (ltm.embedding <=> query_embedding))::FLOAT
    FROM longterm_memory ltm
    WHERE ltm.user_id = p_user_id AND ltm.embedding IS NOT NULL
      AND 1 - (ltm.embedding <=> query_embedding) > match_threshold
    UNION ALL
    SELECT kb.id, 'knowledge_base'::TEXT, kb.collection, kb.content,
           NULL::TEXT, kb.metadata,
           (1 - (kb.embedding <=> query_embedding))::FLOAT
    FROM knowledge_base kb
    WHERE kb.user_id = p_user_id AND kb.embedding IS NOT NULL
      AND 1 - (kb.embedding <=> query_embedding) > match_threshold
  )
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- ✅ Done! พร้อมใช้งาน — ข้อมูลจาก ChromaDB ค่อย import ทีหลังผ่าน plugin
-- ═══════════════════════════════════════════════════════════════════════════
