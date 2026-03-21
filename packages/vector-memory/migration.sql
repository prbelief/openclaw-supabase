-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-vector-memory: Migration (Updated for Security & Performance)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. ตั้งค่า Extension และ Search Path พื้นฐาน
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
ALTER DATABASE postgres SET search_path TO "$user", public, extensions;

-- ═══════════════════════════════════════════════════════════════════════════
-- Table: longterm_memory
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.longterm_memory (
  id          SERIAL PRIMARY KEY,
  collection  TEXT NOT NULL DEFAULT 'memory',
  user_id     TEXT NOT NULL DEFAULT 'default',
  content     TEXT NOT NULL,
  source      TEXT DEFAULT 'chat',
  topic       TEXT,
  importance  TEXT DEFAULT 'medium',
  metadata    JSONB NOT NULL DEFAULT '{}',
  embedding   extensions.vector(768), -- ระบุ schema extensions ชัดเจน
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- แนะนำ: ใช้ HNSW index แทน IVFFLAT เพื่อความเร็วที่เสถียรกว่าในระยะยาว
CREATE INDEX IF NOT EXISTS idx_ltm_embedding
  ON public.longterm_memory USING hnsw (embedding extensions.vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_ltm_collection_user
  ON public.longterm_memory (collection, user_id);

CREATE INDEX IF NOT EXISTS idx_ltm_metadata
  ON public.longterm_memory USING gin (metadata);


-- ═══════════════════════════════════════════════════════════════════════════
-- Table: knowledge_base
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.knowledge_base (
  id          SERIAL PRIMARY KEY,
  collection  TEXT NOT NULL DEFAULT 'general',
  user_id     TEXT NOT NULL DEFAULT 'default',
  content     TEXT NOT NULL,
  source      TEXT,
  tags        TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  embedding   extensions.vector(768),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_embedding
  ON public.knowledge_base USING hnsw (embedding extensions.vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_kb_metadata
  ON public.knowledge_base USING gin (metadata);


-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: match_longterm (Updated with Search Path Security)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.match_longterm(
  query_embedding  extensions.vector(768),
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
SET search_path = public, extensions -- แก้ปัญหา Function Search Path Mutable
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ltm.id, ltm.collection, ltm.content, ltm.source, ltm.topic,
    ltm.importance, ltm.metadata,
    (1 - (ltm.embedding <=> query_embedding))::FLOAT AS similarity
  FROM public.longterm_memory ltm
  WHERE ltm.user_id = p_user_id
    AND ltm.embedding IS NOT NULL
    AND (p_collection IS NULL OR ltm.collection = p_collection)
    AND 1 - (ltm.embedding <=> query_embedding) > match_threshold
  ORDER BY ltm.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: match_knowledge (Updated with Search Path Security)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.match_knowledge(
  query_embedding  extensions.vector(768),
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
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kb.id, kb.collection, kb.content, kb.source, kb.tags,
    kb.metadata,
    (1 - (kb.embedding <=> query_embedding))::FLOAT AS similarity
  FROM public.knowledge_base kb
  WHERE kb.user_id = p_user_id
    AND kb.embedding IS NOT NULL
    AND (p_collection IS NULL OR kb.collection = p_collection)
    AND 1 - (kb.embedding <=> query_embedding) > match_threshold
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: match_all (Updated with Search Path Security)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.match_all(
  query_embedding  extensions.vector(768),
  match_threshold  FLOAT DEFAULT 0.5,
  match_count      INT DEFAULT 6,
  p_user_id        TEXT DEFAULT 'default'
)
RETURNS TABLE (
  id INT, source_table TEXT, collection TEXT, content TEXT,
  topic TEXT, metadata JSONB, similarity FLOAT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT ltm.id, 'longterm_memory'::TEXT as source_table, ltm.collection, ltm.content,
           ltm.topic, ltm.metadata,
           (1 - (ltm.embedding <=> query_embedding))::FLOAT AS similarity
    FROM public.longterm_memory ltm
    WHERE ltm.user_id = p_user_id AND ltm.embedding IS NOT NULL

    UNION ALL

    SELECT kb.id, 'knowledge_base'::TEXT as source_table, kb.collection, kb.content,
           NULL::TEXT as topic, kb.metadata,
           (1 - (kb.embedding <=> query_embedding))::FLOAT AS similarity
    FROM public.knowledge_base kb
    WHERE kb.user_id = p_user_id AND kb.embedding IS NOT NULL
  ) AS combined
  WHERE combined.similarity > match_threshold
  ORDER BY combined.similarity DESC
  LIMIT match_count;
END;
$$;