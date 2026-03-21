-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-db-admin: Migration (Updated for Security)
-- ═══════════════════════════════════════════════════════════════════════════

-- exec_sql: รัน SQL ผ่าน RPC แล้ว return ผลลัพธ์เป็น JSON
-- มีการตั้งค่า search_path เพื่อความปลอดภัยตามมาตรฐาน Supabase

CREATE OR REPLACE FUNCTION public.exec_sql(query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
-- 🛑 สำคัญมาก: ล็อคเส้นทางการค้นหาเพื่อป้องกัน Search Path Hijacking และแก้ Warning สีเหลือง
SET search_path = public, extensions
AS $$
DECLARE
  result JSONB;
BEGIN
  -- พยายามรันในรูปแบบ Query (SELECT) เพื่อเอาผลลัพธ์กลับมาเป็น JSON
  BEGIN
    EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (' || query || ') t'
      INTO result;
    RETURN result;
  EXCEPTION
    WHEN OTHERS THEN
      -- หากรันแบบแรกไม่ได้ (เช่น เป็นคำสั่ง DDL: CREATE, DROP, ALTER)
      -- ให้รันคำสั่งตรงๆ แล้วส่งสถานะ OK กลับไป
      BEGIN
        EXECUTE query;
        RETURN jsonb_build_object(
          'status', 'ok', 
          'message', 'Query executed successfully'
        );
      EXCEPTION
        WHEN OTHERS THEN
          -- หากผิดพลาดจริงๆ ให้ส่ง Error Message กลับมาเป็น JSON
          RETURN jsonb_build_object(
            'status', 'error', 
            'message', SQLERRM
          );
      END;
  END;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ✅ อัปเดตเสร็จสมบูรณ์! (Security Path Locked)
-- ═══════════════════════════════════════════════════════════════════════════