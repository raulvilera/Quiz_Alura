/* Mesmo projeto Supabase usado pelo painel-prova-paulista-2026 (jogos dos alunos).
   A chave "publishable" é pública por desenho: quem protege os dados é o RLS e a função RPC abaixo.
   Pode ser trocada por variáveis de ambiente (VITE_SUPABASE_URL / VITE_SUPABASE_KEY). */
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "https://oxohpnappygkmwjyowvq.supabase.co";
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY as string | undefined) ?? "sb_publishable_EjJenZkxMWv_I6vXWTz6aQ_iz9XEU4N";

/* Mesmo formato de turma gravado pelo painel (missao_resultado, orbit_placar). */
export const TURMAS = ["8º Ano A", "8º Ano B"] as const;
export type Turma = (typeof TURMAS)[number];

export type ResultadoDesafio = {
  id: string;
  turma: Turma;
  nome: string;
  trilha: string;
  pontos: number;
  acertos: number;
  total: number;
};

export function novoId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}

/* Grava o resultado pela função desafio_registrar (idempotente: reenviar o mesmo id não duplica). */
export async function registrarResultado(r: ResultadoDesafio): Promise<void> {
  const resposta = await fetch(`${SUPABASE_URL}/rest/v1/rpc/desafio_registrar`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_id: r.id, p_turma: r.turma, p_nome: r.nome.trim(), p_trilha: r.trilha, p_pontos: r.pontos, p_acertos: r.acertos, p_total: r.total }),
  });
  if (!resposta.ok) throw new Error(`Não foi possível salvar (${resposta.status})`);
}
