/* Lista de alunos da turma, vinda da mesma planilha (Apps Script) que o painel usa no Simulado e no Orbit.
   Os nomes NÃO ficam no código deste repositório: são buscados ao vivo quando o aluno escolhe a turma. */
import type { Turma } from "./supabase";

const API = "https://script.google.com/macros/s/AKfycbwUe0WBN_I1u6wDN4OoYJdKuycu_dupRvY-GzoHPNZhL2ft3KpSK7odGF0amqn7Yc7P/exec";
const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RespostaApi = { ok?: boolean; erro?: string; alunos?: { nome?: string }[] };

async function chamar(params: Record<string, string>): Promise<RespostaApi> {
  let ultimo: unknown;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const controle = new AbortController();
    const tempo = window.setTimeout(() => controle.abort(), 25000);
    try {
      const resposta = await fetch(`${API}?${new URLSearchParams({ nc: String(Date.now()), ...params })}`, { redirect: "follow", cache: "no-store", credentials: "omit", signal: controle.signal });
      const json = (await resposta.json()) as RespostaApi;
      if (!json.ok) throw Object.assign(new Error(json.erro || "erro"), { servidor: true });
      return json;
    } catch (erro) {
      ultimo = erro;
      if ((erro as { servidor?: boolean }).servidor) throw erro;
      await esperar(1500 * (tentativa + 1));
    } finally {
      window.clearTimeout(tempo);
    }
  }
  throw ultimo;
}

/* Acorda o servidor da planilha (a primeira chamada costuma ser lenta). */
export function aquecerRoster(): void {
  void chamar({ api: "turmas" }).catch(() => {});
}

export async function carregarAlunos(turma: Turma): Promise<string[]> {
  const dados = await chamar({ api: "alunos", id: turma }).catch((erro: Error) =>
    /api desconhecida/.test(erro.message) ? chamar({ api: "turma", id: turma }) : Promise.reject(erro),
  );
  const nomes = (dados.alunos ?? []).map((aluno) => (aluno.nome ?? "").trim()).filter(Boolean);
  return [...new Set(nomes)].sort((a, b) => a.localeCompare(b, "pt"));
}
