import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { questions, type Question } from "./data/questions";
import { russianQuestionText } from "./data/russian";
import { supabase } from "./supabase";
import "./styles.css";

type Phase = "home" | "playing" | "result" | "teacher";
type Category = "Tudo" | Question["category"];
type AnswerRecord = { question: Question; correct: boolean; timedOut?: boolean; answeredAt: string };
type RosterStatus = "idle" | "loading" | "ready" | "error";
type TeacherMode = "login" | "signup";
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type ReportRow = {
  id: string;
  student_name: string;
  class_name: string;
  score: number;
  total_questions: number;
  correct_answers: number;
  percentage: number;
  answers: { category?: string; correct?: boolean; answered_at?: string }[];
  started_at?: string;
  finished_at?: string;
  created_at: string;
};

const classOptions = [
  { label: "8º Ano A · Tarde", value: "8º ANO A TARDE" },
  { label: "8º Ano B · Tarde", value: "8º ANO B TARDE" },
];

function getRosterName(entry: unknown): string {
  if (typeof entry === "string") return entry.trim();
  if (!entry || typeof entry !== "object") return "";
  const name = (entry as Record<string, unknown>).nome;
  return typeof name === "string" ? name.trim() : "";
}

const categories: { name: Category; eyebrow: string; description: string; count: number; mark: string }[] = [
  { name: "Tudo", eyebrow: "QUIZ COMPLETO", description: "Todas as questões, com a trilha identificada em cada pergunta.", count: questions.length, mark: "✳" },
];
const LETTERS = ["A", "B", "C", "D"];
const ROUND_SECONDS = 45;
const topicByCategory: Record<Question["category"], string> = {
  "Organização digital": "organization",
  "Programação e algoritmos": "programming",
  "Redes sociais e cultura digital": "social",
};

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function App() {
  const studentMode = new URLSearchParams(window.location.search).get("modo") === "aluno";
  const questionTitleRef = useRef<HTMLHeadingElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const studentPickerRef = useRef<HTMLElement>(null);
  const studentClassRef = useRef<HTMLSelectElement>(null);
  const studentNameRef = useRef<HTMLSelectElement>(null);
  const [phase, setPhase] = useState<Phase>(studentMode ? "home" : "teacher");
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedStudent, setSelectedStudent] = useState("");
  const [rosterNames, setRosterNames] = useState<string[]>([]);
  const [rosterStatus, setRosterStatus] = useState<RosterStatus>("idle");
  const [rosterReload, setRosterReload] = useState(0);
  const [category, setCategory] = useState<Category>("Tudo");
  const [round, setRound] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [openNeedsSelfReview, setOpenNeedsSelfReview] = useState(false);
  const [remaining, setRemaining] = useState(ROUND_SECONDS);
  const [score, setScore] = useState(0);
  const [records, setRecords] = useState<AnswerRecord[]>([]);
  const [streak, setStreak] = useState(0);
  const [teacherMode, setTeacherMode] = useState<TeacherMode>("login");
  const [teacherUser, setTeacherUser] = useState<User | null>(null);
  const [teacherEmail, setTeacherEmail] = useState("");
  const [teacherPassword, setTeacherPassword] = useState("");
  const [teacherLoading, setTeacherLoading] = useState(false);
  const [teacherError, setTeacherError] = useState("");
  const [teacherNotice, setTeacherNotice] = useState("");
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState("");
  const [expandedReportStudent, setExpandedReportStudent] = useState<string | null>(null);
  const [reportClassFilter, setReportClassFilter] = useState("TODAS");
  const [studentLinkCopied, setStudentLinkCopied] = useState(false);
  const [studentLinkCopyError, setStudentLinkCopyError] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [quizStartedAt, setQuizStartedAt] = useState<string | null>(null);
  const studentLinkInputRef = useRef<HTMLInputElement>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const savedAttemptRef = useRef<string | null>(null);

  const current = round[index];
  const isZlata = selectedStudent.trim().toLocaleUpperCase("pt-BR").includes("ZLATA");
  const localizedCurrent = current && isZlata ? { ...current, ...russianQuestionText[current.id] } : current;
  const russianCategory: Record<Question["category"], string> = { "Organização digital": "Цифровая организация", "Programação e algoritmos": "Программирование и алгоритмы", "Redes sociais e cultura digital": "Социальные сети и цифровая культура" };
  const visibleCategory = current && isZlata ? russianCategory[current.category] : current?.category;
  const t = (portuguese: string, russian: string) => isZlata ? russian : portuguese;
  const total = round.length;
  const progress = total ? ((index + (revealed ? 1 : 0)) / total) * 100 : 0;
  const correctCount = records.filter((record) => record.correct).length;
  const percent = total ? Math.round((correctCount / total) * 100) : 0;
  const grade = (percent / 10).toFixed(1).replace(".", ",");
  const isCorrect = current?.type === "open" ? null : selected === current?.answer;
  const currentRecord = current ? records.find((record) => record.question.id === current.id) : undefined;

  useEffect(() => {
    void supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user ?? null;
      if (user && !user.email_confirmed_at) {
        await supabase.auth.signOut();
        setTeacherUser(null);
        setTeacherError("Confirme seu e-mail antes de acessar o painel do professor.");
        return;
      }
      setTeacherUser(user);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setTeacherUser(session?.user?.email_confirmed_at ? session.user : null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const handleInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const loadReports = useCallback(async () => {
    if (!teacherUser) return;
    setReportsLoading(true);
    setReportsError("");
    const { data, error } = await supabase
      .from("quiz_attempts")
      .select("id, student_name, class_name, score, total_questions, correct_answers, percentage, answers, created_at")
      .order("created_at", { ascending: false });
    if (error) setReportsError("Não foi possível carregar os relatórios. Verifique se a migração do Supabase foi executada.");
    else setReports((data ?? []) as ReportRow[]);
    setReportsLoading(false);
  }, [teacherUser]);

  useEffect(() => {
    if (phase === "teacher" && teacherUser) void loadReports();
  }, [phase, teacherUser, loadReports]);

  const teacherSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTeacherLoading(true);
    setTeacherError("");
    setTeacherNotice("");
    const action = teacherMode === "login" ? supabase.auth.signInWithPassword({ email: teacherEmail.trim(), password: teacherPassword }) : supabase.auth.signUp({ email: teacherEmail.trim(), password: teacherPassword });
    const { data, error } = await action;
    if (error) setTeacherError(error.message.includes("Invalid login") ? "E-mail ou senha incorretos." : error.message);
    else if (teacherMode === "signup") {
      if (data.user && !data.user.email_confirmed_at) {
        if (data.session) await supabase.auth.signOut();
        setTeacherNotice("Cadastro realizado. Enviamos um link de confirmação para seu e-mail. Confirme a mensagem antes de entrar no painel.");
      } else {
        setPhase("teacher");
      }
    } else if (!data.user?.email_confirmed_at) {
      await supabase.auth.signOut();
      setTeacherError("Este e-mail ainda não foi confirmado. Verifique sua caixa de entrada e clique no link recebido.");
    } else {
      setPhase("teacher");
    }
    setTeacherLoading(false);
  }, [teacherEmail, teacherMode, teacherPassword]);

  const teacherSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    setReports([]);
    setPhase("teacher");
  }, []);

  const studentLink = `${window.location.origin}${window.location.pathname}?modo=aluno`;
  const copyStudentLink = useCallback(async () => {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(studentLink);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) {
      const fallback = document.createElement("textarea");
      fallback.value = studentLink;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.appendChild(fallback);
      fallback.focus();
      fallback.select();
      fallback.setSelectionRange(0, fallback.value.length);
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      document.body.removeChild(fallback);
    }
    setStudentLinkCopied(copied);
    setStudentLinkCopyError(!copied);
    if (!copied) {
      studentLinkInputRef.current?.focus();
      studentLinkInputRef.current?.select();
    }
    if (copied) window.setTimeout(() => setStudentLinkCopied(false), 2200);
  }, [studentLink]);

  const installApp = useCallback(async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === "dismissed") return;
    } catch {
      setInstallPrompt(null);
    }
  }, [installPrompt]);

  useEffect(() => {
    let cancelled = false;
    setRosterNames([]);
    setSelectedStudent("");
    if (!selectedClass) {
      setRosterStatus("idle");
      return () => { cancelled = true; };
    }

    setRosterStatus("loading");
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("turmas_alunos")
          .select("alunos")
          .eq("turma", selectedClass)
          .maybeSingle();
        if (cancelled) return;
        if (error) throw error;
        const entries = (data as { alunos?: unknown } | null)?.alunos;
        const names = Array.isArray(entries)
          ? [...new Set(entries.map(getRosterName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"))
          : [];
        setRosterNames(names);
        setRosterStatus("ready");
      } catch {
        if (!cancelled) setRosterStatus("error");
      }
    })();

    return () => { cancelled = true; };
  }, [selectedClass, rosterReload]);

  useEffect(() => {
    if (phase === "playing") questionTitleRef.current?.focus();
  }, [phase, index]);

  useEffect(() => {
    if (phase !== "playing") musicRef.current?.pause();
  }, [phase]);

  const startQuiz = useCallback((chosen: Category) => {
    if (!selectedClass || !selectedStudent) return;
    const chosenQuestions = chosen === "Tudo" ? questions : questions.filter((question) => question.category === chosen);
    setCategory(chosen);
    setRound(shuffle(chosenQuestions));
    setIndex(0);
    setSelected(null);
    setTypedAnswer("");
    setRevealed(false);
    setOpenNeedsSelfReview(false);
    setRemaining(ROUND_SECONDS);
    setScore(0);
    setRecords([]);
    setStreak(0);
    setSaveStatus("idle");
    setQuizStartedAt(new Date().toISOString());
    savedAttemptRef.current = null;
    if (musicEnabled && musicRef.current) {
      musicRef.current.volume = 0.18;
      void musicRef.current.play().catch(() => {});
    }
    setPhase("playing");
  }, [musicEnabled, selectedClass, selectedStudent]);

  useEffect(() => {
    if (phase !== "result" || !total || records.length !== total || savedAttemptRef.current) return;
    const attemptKey = `${selectedClass}:${selectedStudent}:${round.map((question) => question.id).join(",")}:${records.length}`;
    savedAttemptRef.current = attemptKey;
    setSaveStatus("saving");
    const attemptPayload = {
      student_name: selectedStudent,
      class_name: selectedClass,
      score,
      total_questions: total,
      correct_answers: correctCount,
      percentage: percent,
      started_at: quizStartedAt,
      finished_at: new Date().toISOString(),
      answers: records.map(({ question, correct, timedOut, answeredAt }) => ({ question_id: question.id, category: question.category, correct, timed_out: Boolean(timedOut), answered_at: answeredAt })),
    };
    void supabase.from("quiz_attempts").insert(attemptPayload).then(async ({ error }) => {
      if (!error) {
        setSaveStatus("saved");
        return;
      }
      const legacyPayload = { ...attemptPayload };
      delete (legacyPayload as Partial<typeof attemptPayload>).started_at;
      delete (legacyPayload as Partial<typeof attemptPayload>).finished_at;
      const retry = await supabase.from("quiz_attempts").insert(legacyPayload);
      setSaveStatus(retry.error ? "error" : "saved");
    });
  }, [correctCount, percent, phase, quizStartedAt, records, round, score, selectedClass, selectedStudent, total]);

  const toggleMusic = useCallback(() => {
    const audio = musicRef.current;
    if (!audio) return;
    if (musicEnabled) {
      audio.pause();
      setMusicEnabled(false);
    } else {
      audio.volume = 0.18;
      void audio.play().catch(() => {});
      setMusicEnabled(true);
    }
  }, [musicEnabled]);

  const nextQuestion = useCallback(() => {
    if (index + 1 >= total) {
      setPhase("result");
      return;
    }
    setIndex((value) => value + 1);
    setSelected(null);
    setTypedAnswer("");
    setRevealed(false);
    setOpenNeedsSelfReview(false);
    setRemaining(ROUND_SECONDS);
  }, [index, total]);

  const submitChoice = useCallback((option: number) => {
    if (revealed || !current || current.type === "open") return;
    setSelected(option);
    setRevealed(true);
    const correct = option === current.answer;
    setRecords((previous) => [...previous, { question: current, correct, answeredAt: new Date().toISOString() }]);
    if (correct) {
      setScore((previous) => previous + 1000 + remaining * 10);
      setStreak((previous) => previous + 1);
    } else {
      setStreak(0);
    }
  }, [current, remaining, revealed]);

  const submitOpenAnswer = useCallback(() => {
    if (!current || current.type !== "open" || !typedAnswer.trim() || revealed) return;
    setRevealed(true);
    setOpenNeedsSelfReview(true);
  }, [current, revealed, typedAnswer]);

  const selfReviewOpen = useCallback((correct: boolean) => {
    if (!current || !openNeedsSelfReview) return;
    setRecords((previous) => [...previous, { question: current, correct, answeredAt: new Date().toISOString() }]);
    if (correct) {
      setScore((previous) => previous + 1000 + remaining * 10);
      setStreak((previous) => previous + 1);
    } else {
      setStreak(0);
    }
    setOpenNeedsSelfReview(false);
  }, [current, openNeedsSelfReview, remaining]);

  const timeOut = useCallback(() => {
    if (!current || revealed) return;
    setRemaining(0);
    setRevealed(true);
    setOpenNeedsSelfReview(false);
    setStreak(0);
    setRecords((previous) => [...previous, { question: current, correct: false, timedOut: true, answeredAt: new Date().toISOString() }]);
  }, [current, revealed]);

  useEffect(() => {
    if (phase !== "playing" || revealed) return;
    const timer = window.setTimeout(() => {
      if (remaining <= 1) timeOut();
      else setRemaining((seconds) => seconds - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [phase, revealed, remaining, timeOut]);

  useEffect(() => {
    if (phase !== "playing" || revealed || current?.type === "open") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const digit = Number(event.key);
      if (digit >= 1 && digit <= (current?.options?.length ?? 0)) submitChoice(digit - 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, revealed, current, submitChoice]);

  const groupedMisses = useMemo(() => {
    const map = new Map<string, number>();
    records.filter((record) => !record.correct).forEach(({ question }) => map.set(question.category, (map.get(question.category) ?? 0) + 1));
    return [...map.entries()];
  }, [records]);

  const classSummary = useMemo(() => classOptions.map((item) => {
    const classReports = reports.filter((report) => report.class_name === item.value);
    const average = classReports.length ? Math.round(classReports.reduce((sum, report) => sum + report.percentage, 0) / classReports.length) : 0;
    return { ...item, attempts: classReports.length, average, students: new Set(classReports.map((report) => report.student_name)).size };
  }), [reports]);

  const trackSummary = useCallback((answers: ReportRow["answers"]) => {
    const summary = new Map<string, { correct: number; total: number; startedAt?: string; finishedAt?: string }>();
    (answers ?? []).forEach((answer) => {
      const categoryName = answer.category || "Trilha não identificada";
      const currentSummary = summary.get(categoryName) ?? { correct: 0, total: 0 };
      summary.set(categoryName, { correct: currentSummary.correct + (answer.correct ? 1 : 0), total: currentSummary.total + 1, startedAt: currentSummary.startedAt ?? answer.answered_at, finishedAt: answer.answered_at ?? currentSummary.finishedAt });
    });
    return [...summary.entries()];
  }, []);

  const filteredReports = useMemo(() => reportClassFilter === "TODAS" ? reports : reports.filter((report) => report.class_name === reportClassFilter), [reportClassFilter, reports]);

  const studentReportGroups = useMemo(() => {
    const groups = new Map<string, { studentName: string; className: string; reports: ReportRow[] }>();
    filteredReports.forEach((report) => {
      const key = `${report.class_name}:${report.student_name}`;
      const group = groups.get(key) ?? { studentName: report.student_name, className: report.class_name, reports: [] };
      group.reports.push(report);
      groups.set(key, group);
    });
    return [...groups.values()];
  }, [filteredReports]);

  const focusStudentStep = useCallback(() => {
    studentPickerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      (selectedClass ? studentNameRef.current : studentClassRef.current)?.focus();
    }, 250);
  }, [selectedClass]);

  const accessCategory = useCallback((chosen: Category) => {
    if (!selectedClass || !selectedStudent || rosterStatus !== "ready") {
      focusStudentStep();
      return;
    }
    startQuiz(chosen);
  }, [focusStudentStep, rosterStatus, selectedClass, selectedStudent, startQuiz]);

  return (
    <main className="app-shell" data-topic={phase === "playing" && current ? topicByCategory[current.category] : undefined}>
      <audio ref={musicRef} src="/quiz-loop.mp3" loop preload="none" aria-hidden="true" />
      <div className="noise" aria-hidden="true" />
      <header className="topbar">
          <button className="brand" onClick={() => setPhase(studentMode ? "home" : "teacher")} aria-label={studentMode ? "Ir para o início" : "Abrir login do professor"}>
          <span className="brand-mark"><span>dd</span><i /></span>
          <span className="brand-text">DESAFIO<span>DIGITAL</span></span>
        </button>
        <div className={`topbar-right ${phase === "playing" ? "game-topbar-right" : ""}`}>
          <span className="grade-pill"><span className="live-dot" /> {t("TECNOLOGIA · 8º ANO", "ТЕХНОЛОГИИ · 8-Й КЛАСС")}</span>
          {phase !== "playing" && <button className="teacher-access-button" onClick={() => setPhase("teacher")}>{teacherUser ? t("Painel do professor", "Панель учителя") : t("Área do professor", "Раздел учителя")}<span>↗</span></button>}
          {phase !== "playing" && installPrompt && <button className="install-app-button" onClick={() => void installApp}>Instalar aplicativo<span>↓</span></button>}
          {phase === "playing" && <button className="music-toggle" onClick={toggleMusic} aria-pressed={musicEnabled} aria-label={musicEnabled ? t("Silenciar trilha sonora", "Выключить музыку") : t("Ativar trilha sonora", "Включить музыку")}><span aria-hidden="true">{musicEnabled ? "♫" : "♪"}</span><span>{musicEnabled ? t("Som ligado", "Звук включён") : t("Som desligado", "Звук выключен")}</span></button>}
          {phase === "playing" && <span className="top-score"><span className="star">✳</span> {score.toLocaleString("pt-BR")}</span>}
        </div>
      </header>

      {phase === "teacher" && (
        <section className="teacher-page">
          {!teacherUser ? (
            <div className="teacher-auth-card">
              <p className="kicker"><span className="kicker-line" /> ÁREA RESTRITA</p>
              <h1>{teacherMode === "login" ? <>Entrar no <span className="highlight">painel.</span></> : <>Criar acesso de <span className="highlight">professor.</span></>}</h1>
              <p className="teacher-copy">Acompanhe o desempenho dos alunos por tentativa, estudante e turma. O painel só será liberado depois da confirmação do seu e-mail.</p>
              <form className="teacher-form" onSubmit={teacherSubmit}>
                <label htmlFor="teacher-email">E-mail</label><input id="teacher-email" type="email" value={teacherEmail} onChange={(event) => setTeacherEmail(event.target.value)} placeholder="professor@escola.com" required autoComplete="email" />
                <label htmlFor="teacher-password">Senha</label><input id="teacher-password" type="password" value={teacherPassword} onChange={(event) => setTeacherPassword(event.target.value)} placeholder="Mínimo de 6 caracteres" minLength={6} required autoComplete={teacherMode === "login" ? "current-password" : "new-password"} />
                {teacherError && <p className="teacher-message teacher-error" role="alert">{teacherError}</p>}
                {teacherNotice && <p className="teacher-message teacher-success" role="status">{teacherNotice}</p>}
                <button className="primary-button teacher-submit" type="submit" disabled={teacherLoading}>{teacherLoading ? "Aguarde…" : teacherMode === "login" ? "Entrar no painel" : "Criar cadastro"}<span>→</span></button>
              </form>
              <button className="text-button teacher-switch" onClick={() => { setTeacherMode(teacherMode === "login" ? "signup" : "login"); setTeacherError(""); setTeacherNotice(""); }}>{teacherMode === "login" ? "Ainda não tenho cadastro" : "Já tenho cadastro"}<span>↗</span></button>
            </div>
          ) : (
            <>
              <div className="teacher-heading"><div><p className="kicker"><span className="kicker-line" /> PAINEL DO PROFESSOR</p><h1>Desempenho da <span className="highlight">turma.</span></h1><p>Resultados registrados pelos alunos no quiz completo.</p></div><div className="teacher-actions"><span>{teacherUser.email}</span><button className="text-button" onClick={teacherSignOut}>Sair <span>↗</span></button></div></div>
              <div className="student-link-card"><div><p className="section-eyebrow">ACESSO DOS ALUNOS</p><h2>Compartilhe o link do quiz</h2><p>Envie este endereço para os alunos. Eles entrarão diretamente na identificação da turma e do nome.</p></div><div className="student-link-actions"><input ref={studentLinkInputRef} aria-label="Link de acesso dos alunos" value={studentLink} readOnly onFocus={(event) => event.currentTarget.select()} /><button type="button" className={`primary-button copy-link-button${studentLinkCopied ? " copy-link-button-copied" : ""}`} onClick={() => void copyStudentLink} aria-live="polite">{studentLinkCopied ? "Link copiado" : studentLinkCopyError ? "Link selecionado" : "Copiar link"}<span>{studentLinkCopied ? "✓" : "↗"}</span></button><a className="text-button" href={studentLink} target="_blank" rel="noreferrer">Abrir área dos alunos <span>↗</span></a>{studentLinkCopied && <span className="copy-link-notification" role="status">✓ Link copiado para a área de transferência.</span>}{studentLinkCopyError && <span className="student-link-error" role="alert">O navegador bloqueou a cópia automática. O link foi selecionado; pressione Ctrl+C para copiar.</span>}</div></div>
              <div className="teacher-summary">{classSummary.map((item) => <article className="teacher-summary-card" key={item.value}><span>{item.label}</span><strong>{item.average}%</strong><small>{item.attempts} tentativas · {item.students} alunos</small></article>)}</div>
              <div className="report-card"><div className="report-card-heading"><div><p className="section-eyebrow">VISÃO INDIVIDUAL</p><h2>Desempenho por aluno</h2><p className="report-helper">Clique na seta ao lado do nome para ver todas as tentativas, notas e acertos por trilha.</p></div><button className="text-button" onClick={() => void loadReports()}>Atualizar <span>↻</span></button></div><div className="report-class-filters" role="group" aria-label="Filtrar relatórios por turma"><button type="button" className={reportClassFilter === "TODAS" ? "is-active" : ""} onClick={() => { setReportClassFilter("TODAS"); setExpandedReportStudent(null); }}>Todas as turmas</button><button type="button" className={`class-filter-a${reportClassFilter === "8º ANO A TARDE" ? " is-active" : ""}`} onClick={() => { setReportClassFilter("8º ANO A TARDE"); setExpandedReportStudent(null); }}>8º Ano A</button><button type="button" className={`class-filter-b${reportClassFilter === "8º ANO B TARDE" ? " is-active" : ""}`} onClick={() => { setReportClassFilter("8º ANO B TARDE"); setExpandedReportStudent(null); }}>8º Ano B</button></div>{reportsLoading ? <p className="report-empty">Carregando resultados…</p> : reportsError ? <p className="teacher-message teacher-error">{reportsError}</p> : filteredReports.length === 0 ? <p className="report-empty">Ainda não há tentativas registradas para esta turma.</p> : <div className="student-report-list">{studentReportGroups.map((group) => { const groupKey = `${group.className}:${group.studentName}`; const expanded = expandedReportStudent === groupKey; return <div className={`student-report-group${expanded ? " is-expanded" : ""}`} key={groupKey}><button type="button" className="student-report-toggle" onClick={() => setExpandedReportStudent(expanded ? null : groupKey)} aria-expanded={expanded}><span className="student-report-arrow">›</span><span className="student-report-name"><strong>{group.studentName}</strong><small>{group.className.replace("8º ANO ", "")}</small></span><span className="student-attempt-count"><strong>{group.reports.length}</strong><small>{group.reports.length === 1 ? "tentativa" : "tentativas"}</small></span></button>{expanded && <div className="student-report-details">{group.reports.map((report, reportIndex) => <article className="attempt-detail" key={report.id}><div className="attempt-heading"><div><span className="section-eyebrow">TENTATIVA {group.reports.length - reportIndex}</span><strong>{new Date(report.created_at).toLocaleDateString("pt-BR")}</strong></div><div className="attempt-result"><span className="report-grade">{(report.percentage / 10).toFixed(1).replace(".", ",")}</span><small>nota final · {report.percentage}%</small></div></div><div className="attempt-tracks">{trackSummary(report.answers).map(([categoryName, summary]) => <div className="attempt-track" key={categoryName}><span><b>{categoryName}</b><em>{summary.correct}/{summary.total}</em></span><small>{summary.correct} acerto{summary.correct === 1 ? "" : "s"} · {summary.total - summary.correct} erro{summary.total - summary.correct === 1 ? "" : "s"}</small><time className="track-time">{summary.startedAt ? <>Início: {new Date(summary.startedAt).toLocaleString("pt-BR")}<br />Término: {summary.finishedAt ? new Date(summary.finishedAt).toLocaleString("pt-BR") : "não disponível"}</> : "Horários não disponíveis para esta tentativa"}</time><div className="mini-progress"><span style={{ width: `${summary.total ? (summary.correct / summary.total) * 100 : 0}%` }} /></div></div>)}</div></article>)}</div>}</div>; })}</div>}</div>
            </>
          )}
        </section>
      )}

      {phase === "home" && (
        <section className="home-page">
          <div className="hero-grid">
            <div className="hero-copy">
              <p className="kicker"><span className="kicker-line" /> {t("APRENDER É JOGAR", "УЧИТЬСЯ — ЭТО ИГРАТЬ")}</p>
              <h1>{t("Ваш следующий уровень начинается", "Твой следующий уровень начинается")} <span className="highlight">{t("здесь.", "здесь.")}</span></h1>
              <p className="hero-sub">{t("Tecnologia, lógica e cultura digital — um desafio de cada vez. Escolha sua trilha e mostre o que sabe.", "Технологии, логика и цифровая культура — одно задание за раз. Выбери тему и покажи свои знания.")}</p>
              <div className="hero-stats">
                <div><strong>35</strong><span>{t("questões", "вопросов")}</span></div><b className="stat-divider" /><div><strong>01</strong><span>{t("acesso", "доступ")}</span></div><b className="stat-divider" /><div><strong>∞</strong><span>{t("tentativas", "попыток")}</span></div>
              </div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="orbit orbit-one" /><div className="orbit orbit-two" />
              <div className="orb-core"><div className="orb-inner"><span>?</span><i>★</i></div></div>
              <span className="float-chip chip-code">{"{ }"}</span><span className="float-chip chip-bolt">✦</span><span className="float-chip chip-asterisk">✳</span>
              <span className="float-chip chip-label">QUIZ ON</span>
            </div>
          </div>

          <div className="selection-heading">
              <div><p className="section-eyebrow">{t("ACESSO AO QUIZ", "ДОСТУП К ВИКТОРИНЕ")}</p><h2>{t("Comece por aqui.", "Начни здесь.")}</h2></div>
              <p className="selection-note">{t("Um único acesso para todas as questões.", "Один доступ ко всем вопросам.")}<br />{t("Você pode tentar quantas vezes quiser.", "Можно пробовать столько раз, сколько захочешь.")}</p>
          </div>
          <div className="category-list" aria-label="Trilhas de aprendizagem">
            {categories.map((item, itemIndex) => (
              <button key={item.name} className={`category-card cat-${itemIndex}${itemIndex === 0 ? " featured" : ""}`} onClick={() => accessCategory(item.name)} aria-describedby="track-access-help">
                <span className="category-icon">{item.mark}</span>
                <span className="category-main"><span className="category-eyebrow">{t(item.eyebrow, "ПОЛНАЯ ВИКТОРИНА")}</span><strong>{t("Iniciar quiz completo", "Начать полную викторину")}</strong><span className="category-description">{t(item.description, "Все вопросы, с указанием темы в каждом вопросе.")}</span></span>
                <span className="category-meta"><strong>{item.count.toString().padStart(2, "0")}</strong><span>{t("questões", "вопросов")}</span></span>
                <span className="category-arrow" aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
          <p className="track-access-help" id="track-access-help">{selectedClass && selectedStudent && rosterStatus === "ready" ? t("Pronto! Todas as questões estão liberadas.", "Готово! Все вопросы доступны.") : t("Clique no acesso e nós levaremos você direto ao passo que falta.", "Нажми на доступ — мы перейдём к нужному шагу.")}</p>
          <section className="student-picker" ref={studentPickerRef} aria-labelledby="student-picker-title">
            <div className="student-picker-heading"><p className="section-eyebrow">{t("PARA LIBERAR A TRILHA", "ДЛЯ ДОСТУПА К ТЕМЕ")}</p><h2 id="student-picker-title">{t("Só falta identificar você.", "Нужно только представиться.")}</h2><p>{t("Escolha a turma e depois o seu nome. É rápido e feito uma única vez antes de jogar.", "Выбери класс, затем своё имя. Это быстро и нужно сделать один раз перед игрой.")}</p></div>
            <div className="student-picker-fields">
              <div className="student-field"><label htmlFor="student-class">1. {t("Sua turma", "Твой класс")}</label><select ref={studentClassRef} id="student-class" value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)} required><option value="">{t("Selecione a turma", "Выбери класс")}</option>{classOptions.map((item) => <option key={item.value} value={item.value}>{t(item.label, item.value.includes("A") ? "8-й класс A · День" : "8-й класс B · День")}</option>)}</select></div>
              <div className="student-field"><label htmlFor="student-name">2. {t("Seu nome", "Твоё имя")}</label><select ref={studentNameRef} id="student-name" value={selectedStudent} onChange={(event) => setSelectedStudent(event.target.value)} disabled={!selectedClass || rosterStatus !== "ready" || rosterNames.length === 0} required><option value="">{!selectedClass ? t("Escolha primeiro a turma", "Сначала выбери класс") : rosterStatus === "loading" ? t("Carregando alunos…", "Загрузка учеников…") : rosterStatus === "error" ? t("Não foi possível carregar", "Не удалось загрузить") : rosterNames.length ? t("Selecione seu nome", "Выбери своё имя") : t("Nenhum aluno encontrado", "Ученики не найдены")}</option>{rosterNames.map((name, nameIndex) => <option key={`${name}-${nameIndex}`} value={name}>{name}</option>)}</select></div>
            </div>
            <div className="roster-status" role="status" aria-live="polite">{rosterStatus === "loading" && <span>{t("Buscando a lista da turma selecionada…", "Загружаем список выбранного класса…")}</span>}{rosterStatus === "error" && <><span>{t("Não foi possível carregar os nomes. Verifique a conexão e tente novamente.", "Не удалось загрузить имена. Проверь соединение и попробуй снова.")}</span><button type="button" onClick={() => setRosterReload((value) => value + 1)}>{t("Tentar novamente", "Попробовать снова")}</button></>}{rosterStatus === "ready" && <span>{rosterNames.length} {t("estudantes encontrados. Agora é só tocar em uma trilha.", "учеников найдено. Теперь выбери тему.")}</span>}</div>
          </section>
          <footer className="home-footer"><span>{t("FEITO PARA CURIOSOS DE TODAS AS IDEIAS", "СОЗДАНО ДЛЯ ЛЮБОПЫТНЫХ")}</span><span>{t("QUESTÕES DO CADERNO · 8º ANO", "ВОПРОСЫ · 8-Й КЛАСС")}</span></footer>
        </section>
      )}

      {phase === "playing" && current && (
        <section className="game-page">
          <div className="game-toolbar">
            <button className="back-button" onClick={() => setPhase("home")} aria-label={t("Voltar à seleção de categorias", "Вернуться к выбору категорий")}>← <span>{t("Sair do desafio", "Выйти из задания")}</span></button>
            <div className="game-context"><span>{t("TRILHA", "ТЕМА")} · {visibleCategory}</span><i>·</i><span>{t("QUESTÃO", "ВОПРОС")} {String(index + 1).padStart(2, "0")} <em>/ {String(total).padStart(2, "0")}</em></span></div>
            <div className={`timer ${remaining <= 10 ? "timer-urgent" : ""}`} role="timer" aria-live="off" aria-label={t(`${remaining} segundos restantes`, `Осталось ${remaining} секунд`)}><span className="timer-icon">◷</span><strong>00:{String(remaining).padStart(2, "0")}</strong></div>
            <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{currentRecord?.timedOut ? t("O tempo desta questão acabou.", "Время этого вопроса истекло.") : !revealed && [30, 20, 10, 5].includes(remaining) ? t(`Restam ${remaining} segundos para responder.`, `Осталось ${remaining} секунд для ответа.`) : ""}</span>
          </div>
          <div className="progress-track" role="progressbar" aria-label="Progresso do quiz" aria-valuenow={index + (revealed ? 1 : 0)} aria-valuemin={0} aria-valuemax={total}><span style={{ width: `${progress}%` }} /></div>
          <div className="game-layout">
            <aside className="game-rail"><span className="rail-number">{String(index + 1).padStart(2, "0")}</span><span className="rail-divider" /><span className="rail-total">{String(total).padStart(2, "0")}</span><span className="rail-caption">{t("QUESTÃO", "ВОПРОС")}</span></aside>
            <article className="question-column">
              <div className="question-meta"><span className="question-tag">{current.type === "open" ? t("RESPOSTA ABERTA", "ОТКРЫТЫЙ ОТВЕТ") : current.type === "boolean" ? t("VERDADEIRO OU FALSO", "ВЕРНО ИЛИ НЕВЕРНО") : visibleCategory?.toUpperCase()}</span><span className="keyboard-hint">{current.type !== "open" && <><kbd>1</kbd>–<kbd>{current.options?.length}</kbd> {t("para responder", "для ответа")}</>}</span></div>
              <h1 ref={questionTitleRef} tabIndex={-1} className="question-title">{localizedCurrent?.prompt}</h1>

              {current.type === "open" ? (
                <div className="open-answer-area">
                  {!revealed ? (
                    <>
                      <label htmlFor="open-answer">{t("Sua resposta", "Ваш ответ")}</label>
                      <textarea id="open-answer" value={typedAnswer} onChange={(event) => setTypedAnswer(event.target.value)} maxLength={600} placeholder={t("Escreva sua ideia com suas palavras…", "Напишите свою мысль своими словами…")} />
                      <div className="input-footer"><span>{typedAnswer.length}/600</span><button className="submit-answer" onClick={submitOpenAnswer} disabled={!typedAnswer.trim()}>{t("Conferir resposta", "Проверить ответ")} <span>→</span></button></div>
                    </>
                  ) : (
                    <div className="expected-answer">
                      <span className="expected-label">{t("RESPOSTA ESPERADA", "ОЖИДАЕМЫЙ ОТВЕТ")}</span>
                      <p>{localizedCurrent?.expected}</p>
                      {openNeedsSelfReview ? (
                        <>
                          <span className="self-check-label">{t("Compare com o que você escreveu:", "Сравните со своим ответом:")}</span>
                          <div className="self-check-actions"><button onClick={() => selfReviewOpen(true)}>{t("Minha resposta contemplou esses pontos", "Мой ответ содержит эти пункты")}</button><button onClick={() => selfReviewOpen(false)}>{t("Vou revisar esse conteúdo", "Я повторю этот материал")}</button></div>
                        </>
                      ) : <span className="self-check-label">{currentRecord?.timedOut ? t("O tempo acabou antes do envio.", "Время ответа истекло.") : t("Autoavaliação registrada.", "Самооценка сохранена.")}</span>}
                    </div>
                  )}
                </div>
              ) : (
                <div className={`answer-list ${current.options?.length === 2 ? "two-options" : ""}`}>
                  {localizedCurrent?.options?.map((option, optionIndex) => {
                    const isSelected = selected === optionIndex;
                    const isRight = revealed && current.answer === optionIndex;
                    const isWrongSelected = revealed && isSelected && !isRight;
                    const stateClass = isRight ? "answer-correct" : isWrongSelected ? "answer-wrong" : revealed ? "answer-muted" : "";
                    return <button key={optionIndex} className={`answer-option ${stateClass}`} onClick={() => submitChoice(optionIndex)} disabled={revealed} aria-pressed={isSelected}>
                      <span className="answer-letter">{current.options?.length === 2 ? (optionIndex === 0 ? "V" : "F") : LETTERS[optionIndex]}</span><span className="answer-text">{option}</span><span className="answer-check">{isRight ? "✓" : isWrongSelected ? "×" : ""}</span>
                    </button>;
                  })}
                </div>
              )}

              {revealed && current.type !== "open" && <div className={`feedback-panel ${isCorrect ? "feedback-good" : "feedback-try"}`} role="status"><span className="feedback-symbol">{isCorrect ? "✓" : records[records.length - 1]?.timedOut ? "◷" : "↻"}</span><div className="feedback-copy"><strong>{records[records.length - 1]?.timedOut ? t("O tempo acabou", "Время истекло") : isCorrect ? t("Boa! Você acertou.", "Отлично! Правильный ответ.") : t("Quase! Vale aprender com essa.", "Почти! Стоит повторить этот материал.")}</strong><p>{localizedCurrent?.explanation}</p></div><button className="next-button" onClick={nextQuestion}>{index + 1 === total ? t("Ver resultado", "Посмотреть результат") : t("Próxima", "Далее")}<span>→</span></button></div>}
              {revealed && current.type === "open" && !openNeedsSelfReview && <div className={`feedback-panel ${currentRecord?.timedOut ? "feedback-try" : "feedback-good"}`} role="status"><span className="feedback-symbol">{currentRecord?.timedOut ? "◷" : "✓"}</span><div className="feedback-copy"><strong>{currentRecord?.timedOut ? t("O tempo acabou.", "Время истекло.") : t("Resposta registrada.", "Ответ сохранён.")}</strong><p>{currentRecord?.timedOut ? t("Confira os pontos esperados e use-os para revisar o tema.", "Сравните с ожидаемыми пунктами и повторите тему.") : t("Sua autoavaliação foi incluída no placar.", "Ваша самооценка добавлена в результат.")}</p></div><button className="next-button" onClick={nextQuestion}>{index + 1 === total ? t("Ver resultado", "Посмотреть результат") : t("Próxima", "Далее")}<span>→</span></button></div>}
            </article>
            <aside className="score-rail"><span className="score-star">✳</span><span className="score-value">{score.toLocaleString("pt-BR")}</span><span className="score-caption">PONTOS</span><span className="score-line" /><span className="streak-icon">⚡</span><span className="streak-value">{streak}</span><span className="score-caption">SEGUIDAS</span></aside>
          </div>
          <div className="game-bottom"><span><span className="live-dot" /> {t("RITMO DE JOGO", "ТЕМП ИГРЫ")}</span><span>{t("+ PONTOS POR ACERTO · BÔNUS DE VELOCIDADE", "+ ОЧКОВ ЗА ПРАВИЛЬНЫЙ ОТВЕТ · БОНУС ЗА СКОРОСТЬ")}</span></div>
        </section>
      )}

      {phase === "result" && (
        <section className="result-page">
          <p className="kicker"><span className="kicker-line" /> {t("FIM DE JOGO", "ИГРА ОКОНЧЕНА")}</p>
          <div className="result-grid">
            <div className="result-main">
              <div className="result-badge">{percent >= 80 ? "✦" : percent >= 50 ? "✳" : "↗"}</div>
              <p className="result-label">{percent >= 80 ? t("VOCÊ MANDOU MUITO", "ОТЛИЧНЫЙ РЕЗУЛЬТАТ") : percent >= 50 ? t("BOM CAMINHO", "ХОРОШЕЕ НАЧАЛО") : t("CADA TENTATIVA ENSINA", "КАЖДАЯ ПОПЫТКА УЧИТ")}</p>
              <h1>{percent >= 80 ? <>Que <span className="highlight">jogada!</span></> : percent >= 50 ? <>Tá no <span className="highlight">caminho.</span></> : <>Vamos de <span className="highlight">novo?</span></>}</h1>
              <p className="result-copy">{percent >= 80 ? t("Seu conhecimento digital está afiado. Compartilhe essa conquista consigo mesmo e siga curioso.", "Ваши цифровые знания на высоте. Продолжайте исследовать и учиться.") : t("Revisar também faz parte do jogo. Veja onde pode fortalecer o que aprendeu e tente novamente.", "Повторение — часть игры. Посмотрите, что можно улучшить, и попробуйте снова.")}</p>
              <div className="result-actions"><button className="primary-button" onClick={() => startQuiz(category)}>{t("Jogar novamente", "Играть снова")} <span>↻</span></button><button className="text-button" onClick={() => setPhase("home")}>{t("Voltar ao início", "Вернуться в начало")} <span>→</span></button></div>
              <p className={`result-save-status result-save-${saveStatus}`} role="status">{saveStatus === "saving" ? t("Salvando seu resultado…", "Сохраняем результат…") : saveStatus === "saved" ? t("Resultado enviado para o relatório do professor.", "Результат отправлен учителю.") : saveStatus === "error" ? t("Não foi possível enviar este resultado agora.", "Не удалось отправить результат.") : ""}</p>
            </div>
              <div className="result-card">
              <span className="result-card-label">{t("SEU RESULTADO", "ВАШ РЕЗУЛЬТАТ")}</span><div className="grade-score">{grade}<span>/ 10</span></div><div className="score-subtitle">{t("Nota final", "Итоговая оценка")}</div><div className="result-rule" /><div className="big-score">{score.toLocaleString("pt-BR")}<span>{t("pts", "очк.")}</span></div><div className="result-rule" />
              <div className="stat-row"><span>{t("Respostas certas", "Правильные ответы")}</span><strong>{correctCount}<small> / {total}</small></strong></div>
              <div className="stat-row"><span>{t("Aproveitamento", "Результат")}</span><strong>{percent}<small>%</small></strong></div>
              <div className="mini-progress"><span style={{ width: `${percent}%` }} /></div>
              <div className="result-rule" /><span className="review-label">{t("PARA REVISAR", "ДЛЯ ПОВТОРЕНИЯ")}</span>
              {groupedMisses.length ? groupedMisses.map(([name, missed]) => <div className="review-row" key={name}><span>{isZlata ? russianCategory[name as Question["category"]] : name}</span><strong>{missed}</strong></div>) : <p className="perfect-note">{t("Tudo certo por aqui. Que tal outra trilha?", "Всё отлично. Попробуете другую тему?")}</p>}
            </div>
          </div>
          <footer className="home-footer"><span>{t("DESAFIO DIGITAL · TECNOLOGIA E INOVAÇÃO", "ЦИФРОВОЕ ЗАДАНИЕ · ТЕХНОЛОГИИ И ИННОВАЦИИ")}</span><span>{t("APRENDER É JOGAR", "УЧИТЬСЯ — ЭТО ИГРАТЬ")}</span></footer>
        </section>
      )}
    </main>
  );
}

export default App;
