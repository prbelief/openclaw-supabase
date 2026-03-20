-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-db-admin: Migration
-- ═══════════════════════════════════════════════════════════════════════════
-- รันใน Supabase SQL Editor ครั้งเดียว
-- สร้าง RPC function สำหรับรัน raw SQL ผ่าน REST API
-- ═══════════════════════════════════════════════════════════════════════════

-- exec_sql: รัน SQL ผ่าน RPC แล้ว return ผลลัพธ์เป็น JSON
-- ใช้ SECURITY DEFINER เพื่อให้ bypass RLS ได้

CREATE OR REPLACE FUNCTION exec_sql(query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (' || query || ') t'
    INTO result;
  RETURN result;
EXCEPTION
  WHEN OTHERS THEN
    -- สำหรับ DDL (CREATE/DROP/ALTER) ที่ไม่ return rows
    BEGIN
      EXECUTE query;
      RETURN jsonb_build_object('status', 'ok', 'message', 'Query executed successfully');
    EXCEPTION
      WHEN OTHERS THEN
        RETURN jsonb_build_object('status', 'error', 'message', SQLERRM);
    END;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- ✅ Done!
-- ═══════════════════════════════════════════════════════════════════════════
