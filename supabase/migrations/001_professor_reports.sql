-- Área do professor e relatórios de desempenho
-- Execute no SQL Editor do projeto Supabase antes de publicar a aplicação.

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  student_name text not null,
  class_name text not null,
  score integer not null default 0,
  total_questions integer not null,
  correct_answers integer not null default 0,
  percentage integer not null default 0,
  answers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.quiz_attempts enable row level security;

-- Apenas professores autenticados podem consultar os relatórios.
drop policy if exists "Authenticated teachers can read quiz attempts" on public.quiz_attempts;
create policy "Authenticated teachers can read quiz attempts"
  on public.quiz_attempts for select
  to authenticated
  using (true);

-- O aluno joga sem conta; a aplicação grava o resultado anonimamente para o relatório.
drop policy if exists "Anyone can save quiz attempts" on public.quiz_attempts;
create policy "Anyone can save quiz attempts"
  on public.quiz_attempts for insert
  to anon, authenticated
  with check (
    length(trim(student_name)) > 0
    and length(trim(class_name)) > 0
    and total_questions > 0
    and correct_answers >= 0
    and correct_answers <= total_questions
    and percentage between 0 and 100
  );

create index if not exists quiz_attempts_class_name_idx on public.quiz_attempts (class_name);
create index if not exists quiz_attempts_student_name_idx on public.quiz_attempts (student_name);
create index if not exists quiz_attempts_created_at_idx on public.quiz_attempts (created_at desc);
