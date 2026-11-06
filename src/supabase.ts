import { createClient } from "@supabase/supabase-js";

// Chave sb_publishable: destinada ao navegador; a autorização das leituras é controlada por RLS.
export const supabase = createClient(
  "https://ykrjfjepnqeoqlgupsbe.supabase.co",
  "sb_publishable_FbMU5x7WBpxzHmmVzOfh2g_0M1xxAh5",
  { auth: { persistSession: false, autoRefreshToken: false } },
);
