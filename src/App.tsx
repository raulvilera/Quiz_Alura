import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { questions, type Question } from "./data/questions";
import { supabase } from "./supabase";
import { isRussianStudent, localizeQuestion, ui, type Lang } from "./i18n";
import "./styles.css";

type Phase = "home" | "playing" | "result";
type Category = "Tudo" | Question["category"];
type AnswerRecord = { question: Question; correct: boolean; timedOut?: boolean };
type RosterStatus = "idle" | "loading" | "ready" | "error";

function getRosterName(entry: unknown): string {
  if (typeof entry === "string") return entry.trim();
  if (!entry || typeof entry !== "object") return "";
  const name = (entry as Record<string, unknown>).nome;
  return typeof name === "string" ? name.trim() : "";
}

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
  const questionTitleRef = useRef<HTMLHeadingElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const [phase, setPhase] = useState<Phase>("home");
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
  const [manualLang, setManualLang] = useState<Lang>("pt");

  // A aluna Zlata faz o quiz inteiro em russo; os demais usam o idioma escolhido (padrão: português).
  const russianOnly = isRussianStudent(selectedStudent);
  const lang: Lang = russianOnly ? "ru" : manualLang;
  const t = ui[lang];

  const canStart = Boolean(selectedClass && selectedStudent && rosterStatus === "ready");
  const baseCurrent = round[index];
  const current = baseCurrent ? localizeQuestion(baseCurrent, lang) : undefined;
  const total = round.length;
  const progress = total ? ((index + (revealed ? 1 : 0)) / total) * 100 : 0;
  const correctCount = records.filter((record) => record.correct).length;
  const percent = total ? Math.round((correctCount / total) * 100) : 0;
  const level: "high" | "mid" | "low" = percent >= 80 ? "high" : percent >= 50 ? "mid" : "low";
  const isCorrect = current?.type === "open" ? null : selected === current?.answer;
  const currentRecord = current ? records.find((record) => record.question.id === current.id) : undefined;

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
    document.documentElement.lang = t.htmlLang;
    document.title = t.documentTitle;
  }, [t]);

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
    if (musicEnabled && musicRef.current) {
      musicRef.current.volume = 0.18;
      void musicRef.current.play().catch(() => {});
    }
    setPhase("playing");
  }, [musicEnabled, selectedClass, selectedStudent]);

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

  return (
    <main className="app-shell" data-topic={phase === "playing" && current ? topicByCategory[current.category] : undefined}>
      <audio ref={musicRef} src="/quiz-loop.mp3" loop preload="none" aria-hidden="true" />
      <div className="noise" aria-hidden="true" />
      <header className="topbar">
        <button className="brand" onClick={() => setPhase("home")} aria-label={t.brandAria}>
          <span className="brand-mark"><span>dd</span><i /></span>
          <span className="brand-text">{t.brandA}<span>{t.brandB}</span></span>
        </button>
        <div className={`topbar-right ${phase === "playing" ? "game-topbar-right" : ""}`}>
          <span className="grade-pill"><span className="live-dot" /> {t.gradePill}</span>
          {phase === "playing" && <button className="music-toggle" onClick={toggleMusic} aria-pressed={musicEnabled} aria-label={musicEnabled ? t.muteAria : t.unmuteAria}><span aria-hidden="true">{musicEnabled ? "♫" : "♪"}</span><span>{musicEnabled ? t.soundOn : t.soundOff}</span></button>}
          {phase === "playing" && <span className="top-score"><span className="star">✳</span> {score.toLocaleString(lang === "ru" ? "ru-RU" : "pt-BR")}</span>}
        </div>
      </header>

      {phase === "home" && (
        <section className="home-page simple-home">
          <div className="simple-card">
            {!russianOnly && <button type="button" className="lang-switch" onClick={() => setManualLang(lang === "pt" ? "ru" : "pt")} aria-label={t.langSwitchAria} lang={lang === "pt" ? "ru" : "pt"}>🌐 {t.langSwitchLabel}</button>}
            <p className="kicker"><span className="kicker-line" /> {t.homeKicker}</p>
            <h1>{t.homeTitlePre}<span className="highlight">{t.homeTitleHl}</span></h1>
            <p className="simple-sub">{t.homeSub}</p>

            <div className="simple-fields">
              <div className="student-field">
                <label htmlFor="student-class">{t.classLabel}</label>
                <select id="student-class" value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)}>
                  <option value="">{t.classPlaceholder}</option>
                  {t.classOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>
              <div className="student-field">
                <label htmlFor="student-name">{t.nameLabel}</label>
                <select id="student-name" value={selectedStudent} onChange={(event) => setSelectedStudent(event.target.value)} disabled={!selectedClass || rosterStatus !== "ready" || rosterNames.length === 0}>
                  <option value="">{!selectedClass ? t.nameChooseClass : rosterStatus === "loading" ? t.nameLoading : rosterStatus === "error" ? t.nameError : rosterNames.length ? t.namePick : t.nameNone}</option>
                  {rosterNames.map((name, nameIndex) => <option key={`${name}-${nameIndex}`} value={name}>{name}</option>)}
                </select>
              </div>
            </div>

            <div className="roster-status" role="status" aria-live="polite">
              {rosterStatus === "loading" && <span>{t.statusLoading}</span>}
              {rosterStatus === "error" && <><span>{t.statusError}</span><button type="button" onClick={() => setRosterReload((value) => value + 1)}>{t.retry}</button></>}
            </div>

            <button className="start-button" onClick={() => startQuiz("Tudo")} disabled={!canStart} aria-disabled={!canStart}>
              <span>{canStart ? t.start(questions.length) : t.startDisabled}</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      )}

      {phase === "playing" && current && (
        <section className="game-page">
          <div className="game-toolbar">
            <button className="back-button" onClick={() => setPhase("home")} aria-label={t.exitAria}>← <span>{t.exit}</span></button>
            <div className="game-context"><span>{t.category[current.category]}</span><i>·</i><span>{t.question} {String(index + 1).padStart(2, "0")} <em>/ {String(total).padStart(2, "0")}</em></span></div>
            <div className={`timer ${remaining <= 10 ? "timer-urgent" : ""}`} role="timer" aria-live="off" aria-label={t.timerAria(remaining)}><span className="timer-icon">◷</span><strong>00:{String(remaining).padStart(2, "0")}</strong></div>
            <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{currentRecord?.timedOut ? t.srTimeUp : !revealed && [30, 20, 10, 5].includes(remaining) ? t.srRemaining(remaining) : ""}</span>
          </div>
          <div className="progress-track" role="progressbar" aria-label={t.progressAria} aria-valuenow={index + (revealed ? 1 : 0)} aria-valuemin={0} aria-valuemax={total}><span style={{ width: `${progress}%` }} /></div>
          <div className="game-layout">
            <aside className="game-rail"><span className="rail-number">{String(index + 1).padStart(2, "0")}</span><span className="rail-divider" /><span className="rail-total">{String(total).padStart(2, "0")}</span><span className="rail-caption">{t.question}</span></aside>
            <article className="question-column">
              <div className="question-meta"><span className="question-tag">{current.type === "open" ? t.tagOpen : current.type === "boolean" ? t.tagBoolean : t.category[current.category].toUpperCase()}</span><span className="keyboard-hint">{current.type !== "open" && <><kbd>1</kbd>–<kbd>{current.options?.length}</kbd> {t.keyHint}</>}</span></div>
              <h1 ref={questionTitleRef} tabIndex={-1} className="question-title">{current.prompt}</h1>

              {current.type === "open" ? (
                <div className="open-answer-area">
                  {!revealed ? (
                    <>
                      <label htmlFor="open-answer">{t.yourAnswer}</label>
                      <textarea id="open-answer" value={typedAnswer} onChange={(event) => setTypedAnswer(event.target.value)} maxLength={600} placeholder={t.placeholder} />
                      <div className="input-footer"><span>{typedAnswer.length}/600</span><button className="submit-answer" onClick={submitOpenAnswer} disabled={!typedAnswer.trim()}>{t.check} <span>→</span></button></div>
                    </>
                  ) : (
                    <div className="expected-answer">
                      <span className="expected-label">{t.expectedLabel}</span>
                      <p>{current.expected}</p>
                      {openNeedsSelfReview ? (
                        <>
                          <span className="self-check-label">{t.compare}</span>
                          <div className="self-check-actions"><button onClick={() => selfReviewOpen(true)}>{t.selfYes}</button><button onClick={() => selfReviewOpen(false)}>{t.selfNo}</button></div>
                        </>
                      ) : <span className="self-check-label">{currentRecord?.timedOut ? t.timeUpBeforeSend : t.selfRecorded}</span>}
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
                      <span className="answer-letter">{current.options?.length === 2 ? t.booleanLetters[optionIndex] : LETTERS[optionIndex]}</span><span className="answer-text">{option}</span><span className="answer-check">{isRight ? "✓" : isWrongSelected ? "×" : ""}</span>
                    </button>;
                  })}
                </div>
              )}

              {revealed && current.type !== "open" && <div className={`feedback-panel ${isCorrect ? "feedback-good" : "feedback-try"}`} role="status"><span className="feedback-symbol">{isCorrect ? "✓" : records[records.length - 1]?.timedOut ? "◷" : "↻"}</span><div className="feedback-copy"><strong>{records[records.length - 1]?.timedOut ? t.fbTimeUp : isCorrect ? t.fbGood : t.fbTry}</strong><p>{current.explanation}</p></div><button className="next-button" onClick={nextQuestion}>{index + 1 === total ? t.seeResult : t.next}<span>→</span></button></div>}
              {revealed && current.type === "open" && !openNeedsSelfReview && <div className={`feedback-panel ${currentRecord?.timedOut ? "feedback-try" : "feedback-good"}`} role="status"><span className="feedback-symbol">{currentRecord?.timedOut ? "◷" : "✓"}</span><div className="feedback-copy"><strong>{currentRecord?.timedOut ? t.openTimeUp : t.openRecorded}</strong><p>{currentRecord?.timedOut ? t.openTimeUpHint : t.openRecordedHint}</p></div><button className="next-button" onClick={nextQuestion}>{index + 1 === total ? t.seeResult : t.next}<span>→</span></button></div>}
            </article>
            <aside className="score-rail"><span className="score-star">✳</span><span className="score-value">{score.toLocaleString(lang === "ru" ? "ru-RU" : "pt-BR")}</span><span className="score-caption">{t.points}</span><span className="score-line" /><span className="streak-icon">⚡</span><span className="streak-value">{streak}</span><span className="score-caption">{t.streak}</span></aside>
          </div>
          <div className="game-bottom"><span><span className="live-dot" /> {t.bottomLeft}</span><span>{t.bottomRight}</span></div>
        </section>
      )}

      {phase === "result" && (
        <section className="result-page">
          <p className="kicker"><span className="kicker-line" /> {t.resultKicker}</p>
          <div className="result-grid">
            <div className="result-main">
              <div className="result-badge">{percent >= 80 ? "✦" : percent >= 50 ? "✳" : "↗"}</div>
              <p className="result-label">{t.resultLabel[level]}</p>
              <h1>{t.resultTitle[level].pre}<span className="highlight">{t.resultTitle[level].hl}</span></h1>
              <p className="result-copy">{percent >= 80 ? t.resultCopyHigh : t.resultCopyLow}</p>
              <div className="result-actions"><button className="primary-button" onClick={() => startQuiz(category)}>{t.playAgain} <span>↻</span></button><button className="text-button" onClick={() => setPhase("home")}>{t.backHome} <span>→</span></button></div>
            </div>
            <div className="result-card">
              <span className="result-card-label">{t.scoreLabel}</span><div className="big-score">{score.toLocaleString(lang === "ru" ? "ru-RU" : "pt-BR")}<span>{t.pts}</span></div><div className="result-rule" />
              <div className="stat-row"><span>{t.correctAnswers}</span><strong>{correctCount}<small> / {total}</small></strong></div>
              <div className="stat-row"><span>{t.percentLabel}</span><strong>{percent}<small>%</small></strong></div>
              <div className="mini-progress"><span style={{ width: `${percent}%` }} /></div>
              <div className="result-rule" /><span className="review-label">{t.review}</span>
              {groupedMisses.length ? groupedMisses.map(([name, missed]) => <div className="review-row" key={name}><span>{t.category[name as keyof typeof t.category]}</span><strong>{missed}</strong></div>) : <p className="perfect-note">{t.perfect}</p>}
            </div>
          </div>
          <footer className="home-footer"><span>{t.footerA}</span><span>{t.footerB}</span></footer>
        </section>
      )}
    </main>
  );
}

export default App;
