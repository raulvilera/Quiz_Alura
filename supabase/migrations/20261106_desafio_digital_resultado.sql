-- Já aplicada no projeto Supabase compartilhado com o painel-prova-paulista-2026 (oxohpnappygkmwjyowvq).
-- Tabela só do Quiz; alunos gravam pela função (security definer), o professor lê com login (sou_professor()).
create table public.desafio_resultado (
  id uuid primary key, criado timestamptz not null default now(),
  turma text not null check (turma in ('8º Ano A','8º Ano B')),
  nome text not null check (char_length(nome) between 3 and 120),
  trilha text not null check (char_length(trilha) between 1 and 60),
  pontos integer not null check (pontos between 0 and 100000),
  acertos integer not null check (acertos >= 0),
  total integer not null check (total between 1 and 50),
  percentual integer not null check (percentual between 0 and 100),
  check (acertos <= total)
);
alter table public.desafio_resultado enable row level security;
create policy "professor le desafio" on public.desafio_resultado for select to authenticated using (public.sou_professor());
create policy "professor apaga desafio" on public.desafio_resultado for delete to authenticated using (public.sou_professor());
-- função public.desafio_registrar(p_id, p_turma, p_nome, p_trilha, p_pontos, p_acertos, p_total): valida e insere (on conflict do nothing)
-- revoke all ... from public; grant execute ... to anon, authenticated;
