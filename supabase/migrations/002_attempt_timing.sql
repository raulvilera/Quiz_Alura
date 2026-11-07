-- Horários do quiz para o relatório por trilha
-- Execute no SQL Editor do mesmo projeto Supabase.

alter table public.quiz_attempts
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz;

create index if not exists quiz_attempts_started_at_idx
  on public.quiz_attempts (started_at desc);
