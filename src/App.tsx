import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { questions, type Question } from "./data/questions";
import { supabase } from "./supabase";
import "./styles.css";

type Phase = "home" | "playing" | "result" | "teacher";
type Category = "Tudo" | Question["category"];
type AnswerRecord = { question: Question; correct: boolean; timedOut?: boolean };
type RosterStatus = "idle" | "loading" | "ready" | "error";
type TeacherMode = "login" | "signup";
type ReportRow = {
  id: string;
  student_name: string;
  class_name: string;
  score: number;
  total_questions: number;
  correct_answers: number;
  percentage: number;
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
  const [studentLinkCopied, setStudentLinkCopied] = useState(false);
  const [studentLinkCopyError, setStudentLinkCopyError] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const savedAttemptRef = useRef<string | null>(null);

  const current = round[index];
  const total = round.length;
  const progress = total ? ((index + (revealed ? 1 : 0)) / total) * 100 : 0;
  const correctCount = records.filter((record) => record.correct).length;
  const percent = total ? Math.round((correctCount / total) * 100) : 0;
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

  const loadReports = useCallback(async () => {
    if (!teacherUser) return;
    setReportsLoading(true);
    setReportsError("");
    const { data, error } = await supabase
      .from("quiz_attempts")
      .select("id, student_name, class_name, score, total_questions, correct_answers, percentage, created_at")
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
    if (copied) window.setTimeout(() => setStudentLinkCopied(false), 2200);
  }, [studentLink]);

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
    void supabase.from("quiz_attempts").insert({
      student_name: selectedStudent,
      class_name: selectedClass,
      score,
      total_questions: total,
      correct_answers: correctCount,
      percentage: percent,
      answers: records.map(({ question, correct, timedOut }) => ({ question_id: question.id, category: question.category, correct, timed_out: Boolean(timedOut) })),
    }).then(({ error }) => setSaveStatus(error ? "error" : "saved"));
  }, [correctCount, percent, phase, records, round, score, selectedClass, selectedStudent, total]);

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
    setRecords((previous) => [...previous, { question: current, correct }]);
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
    setRecords((previous) => [...previous, { question: current, correct }]);
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
    setRecords((previous) => [...previous, { question: current, correct: false, timedOut: true }]);
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
          <span className="grade-pill"><span className="live-dot" /> TECNOLOGIA · 8º ANO</span>
          {phase !== "playing" && <button className="teacher-access-button" onClick={() => setPhase("teacher")}>{teacherUser ? "Painel do professor" : "Área do professor"}<span>↗</span></button>}
          {phase === "playing" && <button className="music-toggle" onClick={toggleMusic} aria-pressed={musicEnabled} aria-label={musicEnabled ? "Silenciar trilha sonora" : "Ativar trilha sonora"}><span aria-hidden="true">{musicEnabled ? "♫" : "♪"}</span><span>{musicEnabled ? "Som ligado" : "Som desligado"}</span></button>}
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
              <div className="student-link-card"><div><p className="section-eyebrow">ACESSO DOS ALUNOS</p><h2>Compartilhe o link do quiz</h2><p>Envie este endereço para os alunos. Eles entrarão diretamente na identificação da turma e do nome.</p></div><div className="student-link-actions"><input aria-label="Link de acesso dos alunos" value={studentLink} readOnly onFocus={(event) => event.currentTarget.select()} /><button className={`primary-button copy-link-button${studentLinkCopied ? " copy-link-button-copied" : ""}`} onClick={() => void copyStudentLink} aria-live="polite">{studentLinkCopied ? "Link copiado" : "Copiar link"}<span>{studentLinkCopied ? "✓" : "↗"}</span></button><a className="text-button" href={studentLink} target="_blank" rel="noreferrer">Abrir área dos alunos <span>↗</span></a>{studentLinkCopied && <span className="copy-link-notification" role="status">✓ Link copiado para a área de transferência.</span>}{studentLinkCopyError && <span className="student-link-error" role="alert">Não foi possível copiar automaticamente. Selecione o endereço acima e use Ctrl+C.</span>}</div></div>
              <div className="teacher-summary">{classSummary.map((item) => <article className="teacher-summary-card" key={item.value}><span>{item.label}</span><strong>{item.average}%</strong><small>{item.attempts} tentativas · {item.students} alunos</small></article>)}</div>
              <div className="report-card"><div className="report-card-heading"><div><p className="section-eyebrow">VISÃO INDIVIDUAL</p><h2>Últimas tentativas</h2></div><button className="text-button" onClick={() => void loadReports()}>Atualizar <span>↻</span></button></div>{reportsLoading ? <p className="report-empty">Carregando resultados…</p> : reportsError ? <p className="teacher-message teacher-error">{reportsError}</p> : reports.length === 0 ? <p className="report-empty">Ainda não há tentativas registradas.</p> : <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Aluno</th><th>Turma</th><th>Acertos</th><th>Aproveitamento</th><th>Data</th></tr></thead><tbody>{reports.map((report) => <tr key={report.id}><td><strong>{report.student_name}</strong></td><td>{report.class_name.replace("8º ANO ", "")}</td><td>{report.correct_answers} / {report.total_questions}</td><td><span className="report-percent">{report.percentage}%</span><div className="mini-progress"><span style={{ width: `${report.percentage}%` }} /></div></td><td>{new Date(report.created_at).toLocaleDateString("pt-BR")}</td></tr>)}</tbody></table></div>}</div>
            </>
          )}
        </section>
      )}

      {phase === "home" && (
        <section className="home-page">
          <div className="hero-grid">
            <div className="hero-copy">
              <p className="kicker"><span className="kicker-line" /> APRENDER É JOGAR</p>
              <h1>Seu próximo<br />nível começa <span className="highlight">aqui.</span></h1>
              <p className="hero-sub">Tecnologia, lógica e cultura digital — um desafio de cada vez. Escolha sua trilha e mostre o que sabe.</p>
              <div className="hero-stats">
                <div><strong>35</strong><span>questões</span></div><b className="stat-divider" /><div><strong>01</strong><span>acesso</span></div><b className="stat-divider" /><div><strong>∞</strong><span>tentativas</span></div>
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
              <div><p className="section-eyebrow">ACESSO AO QUIZ</p><h2>Comece por aqui.</h2></div>
              <p className="selection-note">Um único acesso para todas as questões.<br />Você pode tentar quantas vezes quiser.</p>
          </div>
          <div className="category-list" aria-label="Trilhas de aprendizagem">
            {categories.map((item, itemIndex) => (
              <button key={item.name} className={`category-card cat-${itemIndex}${itemIndex === 0 ? " featured" : ""}`} onClick={() => accessCategory(item.name)} aria-describedby="track-access-help">
                <span className="category-icon">{item.mark}</span>
                <span className="category-main"><span className="category-eyebrow">{item.eyebrow}</span><strong>Iniciar quiz completo</strong><span className="category-description">{item.description}</span></span>
                <span className="category-meta"><strong>{item.count.toString().padStart(2, "0")}</strong><span>questões</span></span>
                <span className="category-arrow" aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
          <p className="track-access-help" id="track-access-help">{selectedClass && selectedStudent && rosterStatus === "ready" ? "Pronto! Todas as questões estão liberadas." : "Clique no acesso e nós levaremos você direto ao passo que falta."}</p>
          <section className="student-picker" ref={studentPickerRef} aria-labelledby="student-picker-title">
            <div className="student-picker-heading"><p className="section-eyebrow">PARA LIBERAR A TRILHA</p><h2 id="student-picker-title">Só falta identificar você.</h2><p>Escolha a turma e depois o seu nome. É rápido e feito uma única vez antes de jogar.</p></div>
            <div className="student-picker-fields">
              <div className="student-field"><label htmlFor="student-class">1. Sua turma</label><select ref={studentClassRef} id="student-class" value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)} required><option value="">Selecione a turma</option>{classOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
              <div className="student-field"><label htmlFor="student-name">2. Seu nome</label><select ref={studentNameRef} id="student-name" value={selectedStudent} onChange={(event) => setSelectedStudent(event.target.value)} disabled={!selectedClass || rosterStatus !== "ready" || rosterNames.length === 0} required><option value="">{!selectedClass ? "Escolha primeiro a turma" : rosterStatus === "loading" ? "Carregando alunos…" : rosterStatus === "error" ? "Não foi possível carregar" : rosterNames.length ? "Selecione seu nome" : "Nenhum aluno encontrado"}</option>{rosterNames.map((name, nameIndex) => <option key={`${name}-${nameIndex}`} value={name}>{name}</option>)}</select></div>
            </div>
            <div className="roster-status" role="status" aria-live="polite">{rosterStatus === "loading" && <span>Buscando a lista da turma selecionada…</span>}{rosterStatus === "error" && <><span>Não foi possível carregar os nomes. Verifique a conexão e tente novamente.</span><button type="button" onClick={() => setRosterReload((value) => value + 1)}>Tentar novamente</button></>}{rosterStatus === "ready" && <span>{rosterNames.length} estudantes encontrados. Agora é só tocar em uma trilha.</span>}</div>
          </section>
          <footer className="home-footer"><span>FEITO PARA CURIOSOS DE TODAS AS IDEIAS</span><span>QUESTÕES DO CADERNO · 8º ANO</span></footer>
        </section>
      )}

      {phase === "playing" && current && (
        <section className="game-page">
          <div className="game-toolbar">
            <button className="back-button" onClick={() => setPhase("home")} aria-label="Voltar à seleção de categorias">← <span>Sair do desafio</span></button>
            <div className="game-context"><span>TRILHA · {current.category}</span><i>·</i><span>QUESTÃO {String(index + 1).padStart(2, "0")} <em>/ {String(total).padStart(2, "0")}</em></span></div>
            <div className={`timer ${remaining <= 10 ? "timer-urgent" : ""}`} role="timer" aria-live="off" aria-label={`${remaining} segundos restantes`}><span className="timer-icon">◷</span><strong>00:{String(remaining).padStart(2, "0")}</strong></div>
            <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{currentRecord?.timedOut ? "O tempo desta questão acabou." : !revealed && [30, 20, 10, 5].includes(remaining) ? `Restam ${remaining} segundos para responder.` : ""}</span>
          </div>
          <div className="progress-track" role="progressbar" aria-label="Progresso do quiz" aria-valuenow={index + (revealed ? 1 : 0)} aria-valuemin={0} aria-valuemax={total}><span style={{ width: `${progress}%` }} /></div>
          <div className="game-layout">
            <aside className="game-rail"><span className="rail-number">{String(index + 1).padStart(2, "0")}</span><span className="rail-divider" /><span className="rail-total">{String(total).padStart(2, "0")}</span><span className="rail-caption">QUESTÃO</span></aside>
            <article className="question-column">
              <div className="question-meta"><span className="question-tag">{current.type === "open" ? "RESPOSTA ABERTA" : current.type === "boolean" ? "VERDADEIRO OU FALSO" : current.category.toUpperCase()}</span><span className="keyboard-hint">{current.type !== "open" && <><kbd>1</kbd>–<kbd>{current.options?.length}</kbd> para responder</>}</span></div>
              <h1 ref={questionTitleRef} tabIndex={-1} className="question-title">{current.prompt}</h1>

              {current.type === "open" ? (
                <div className="open-answer-area">
                  {!revealed ? (
                    <>
                      <label htmlFor="open-answer">Sua resposta</label>
                      <textarea id="open-answer" value={typedAnswer} onChange={(event) => setTypedAnswer(event.target.value)} maxLength={600} placeholder="Escreva sua ideia com suas palavras…" />
                      <div className="input-footer"><span>{typedAnswer.length}/600</span><button className="submit-answer" onClick={submitOpenAnswer} disabled={!typedAnswer.trim()}>Conferir resposta <span>→</span></button></div>
                    </>
                  ) : (
                    <div className="expected-answer">
                      <span className="expected-label">RESPOSTA ESPERADA</span>
                      <p>{current.expected}</p>
                      {openNeedsSelfReview ? (
                        <>
                          <span className="self-check-label">Compare com o que você escreveu:</span>
                          <div className="self-check-actions"><button onClick={() => selfReviewOpen(true)}>Minha resposta contemplou esses pontos</button><button onClick={() => selfReviewOpen(false)}>Vou revisar esse conteúdo</button></div>
                        </>
                      ) : <span className="self-check-label">{currentRecord?.timedOut ? "O tempo acabou antes do envio." : "Autoavaliação registrada."}</span>}
                    </div>
                  )}
                </div>
              ) : (
                <div className={`answer-list ${current.options?.length === 2 ? "two-options" : ""}`}>
                  {current.options?.map((option, optionIndex) => {
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

              {revealed && current.type !== "open" && <div className={`feedback-panel ${isCorrect ? "feedback-good" : "feedback-try"}`} role="status"><span className="feedback-symbol">{isCorrect ? "✓" : records[records.length - 1]?.timedOut ? "◷" : "↻"}</span><div className="feedback-copy"><strong>{records[records.length - 1]?.timedOut ? "O tempo acabou" : isCorrect ? "Boa! Você acertou." : "Quase! Vale aprender com essa."}</strong><p>{current.explanation}</p></div><button className="next-button" onClick={nextQuestion}>{index + 1 === total ? "Ver resultado" : "Próxima"}<span>→</span></button></div>}
              {revealed && current.type === "open" && !openNeedsSelfReview && <div className={`feedback-panel ${currentRecord?.timedOut ? "feedback-try" : "feedback-good"}`} role="status"><span className="feedback-symbol">{currentRecord?.timedOut ? "◷" : "✓"}</span><div className="feedback-copy"><strong>{currentRecord?.timedOut ? "O tempo acabou." : "Resposta registrada."}</strong><p>{currentRecord?.timedOut ? "Confira os pontos esperados e use-os para revisar o tema." : "Sua autoavaliação foi incluída no placar. Compare sua ideia com os pontos esperados."}</p></div><button className="next-button" onClick={nextQuestion}>{index + 1 === total ? "Ver resultado" : "Próxima"}<span>→</span></button></div>}
            </article>
            <aside className="score-rail"><span className="score-star">✳</span><span className="score-value">{score.toLocaleString("pt-BR")}</span><span className="score-caption">PONTOS</span><span className="score-line" /><span className="streak-icon">⚡</span><span className="streak-value">{streak}</span><span className="score-caption">SEGUIDAS</span></aside>
          </div>
          <div className="game-bottom"><span><span className="live-dot" /> RITMO DE JOGO</span><span>+ PONTOS POR ACERTO · BÔNUS DE VELOCIDADE</span></div>
        </section>
      )}

      {phase === "result" && (
        <section className="result-page">
          <p className="kicker"><span className="kicker-line" /> FIM DE JOGO</p>
          <div className="result-grid">
            <div className="result-main">
              <div className="result-badge">{percent >= 80 ? "✦" : percent >= 50 ? "✳" : "↗"}</div>
              <p className="result-label">{percent >= 80 ? "VOCÊ MANDOU MUITO" : percent >= 50 ? "BOM CAMINHO" : "CADA TENTATIVA ENSINA"}</p>
              <h1>{percent >= 80 ? <>Que <span className="highlight">jogada!</span></> : percent >= 50 ? <>Tá no <span className="highlight">caminho.</span></> : <>Vamos de <span className="highlight">novo?</span></>}</h1>
              <p className="result-copy">{percent >= 80 ? "Seu conhecimento digital está afiado. Compartilhe essa conquista consigo mesmo e siga curioso." : "Revisar também faz parte do jogo. Veja onde pode fortalecer o que aprendeu e tente novamente."}</p>
              <div className="result-actions"><button className="primary-button" onClick={() => startQuiz(category)}>Jogar novamente <span>↻</span></button><button className="text-button" onClick={() => setPhase("home")}>Voltar ao início <span>→</span></button></div>
              <p className={`result-save-status result-save-${saveStatus}`} role="status">{saveStatus === "saving" ? "Salvando seu resultado…" : saveStatus === "saved" ? "Resultado enviado para o relatório do professor." : saveStatus === "error" ? "Não foi possível enviar este resultado agora." : ""}</p>
            </div>
            <div className="result-card">
              <span className="result-card-label">SEU PLACAR</span><div className="big-score">{score.toLocaleString("pt-BR")}<span>pts</span></div><div className="result-rule" />
              <div className="stat-row"><span>Respostas certas</span><strong>{correctCount}<small> / {total}</small></strong></div>
              <div className="stat-row"><span>Aproveitamento</span><strong>{percent}<small>%</small></strong></div>
              <div className="mini-progress"><span style={{ width: `${percent}%` }} /></div>
              <div className="result-rule" /><span className="review-label">PARA REVISAR</span>
              {groupedMisses.length ? groupedMisses.map(([name, missed]) => <div className="review-row" key={name}><span>{name}</span><strong>{missed}</strong></div>) : <p className="perfect-note">Tudo certo por aqui. Que tal outra trilha?</p>}
            </div>
          </div>
          <footer className="home-footer"><span>DESAFIO DIGITAL · TECNOLOGIA E INOVAÇÃO</span><span>APRENDER É JOGAR</span></footer>
        </section>
      )}
    </main>
  );
}

export default App;
