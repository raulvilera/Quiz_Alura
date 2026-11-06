import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { questions, type Question } from "./data/questions";
import "./styles.css";

type Phase = "home" | "playing" | "result";
type Category = "Tudo" | Question["category"];
type AnswerRecord = { question: Question; correct: boolean; timedOut?: boolean };

const categories: { name: Category; eyebrow: string; description: string; count: number; mark: string }[] = [
  { name: "Tudo", eyebrow: "DESAFIO COMPLETO", description: "Uma jornada por todos os assuntos do caderno.", count: questions.length, mark: "✳" },
  { name: "Organização digital", eyebrow: "ARQUIVOS & CRIAÇÃO", description: "Pastas, tabelas, planejamento e autoria.", count: 4, mark: "▦" },
  { name: "Programação e algoritmos", eyebrow: "LÓGICA & CÓDIGO", description: "Comandos, variáveis, laços e listas.", count: 16, mark: "{ }" },
  { name: "Redes sociais e cultura digital", eyebrow: "VIDA CONECTADA", description: "Informação, privacidade e algoritmos.", count: 15, mark: "◎" },
];
const LETTERS = ["A", "B", "C", "D"];
const ROUND_SECONDS = 45;

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

  const current = round[index];
  const total = round.length;
  const progress = total ? ((index + (revealed ? 1 : 0)) / total) * 100 : 0;
  const correctCount = records.filter((record) => record.correct).length;
  const percent = total ? Math.round((correctCount / total) * 100) : 0;
  const isCorrect = current?.type === "open" ? null : selected === current?.answer;
  const currentRecord = current ? records.find((record) => record.question.id === current.id) : undefined;

  useEffect(() => {
    if (phase === "playing") questionTitleRef.current?.focus();
  }, [phase, index]);

  useEffect(() => {
    if (phase !== "playing") musicRef.current?.pause();
  }, [phase]);

  const startQuiz = useCallback((chosen: Category) => {
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
  }, [musicEnabled]);

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
    <main className="app-shell">
      <audio ref={musicRef} src="/quiz-loop.mp3" loop preload="none" aria-hidden="true" />
      <div className="noise" aria-hidden="true" />
      <header className="topbar">
        <button className="brand" onClick={() => setPhase("home")} aria-label="Ir para o início">
          <span className="brand-mark"><span>dd</span><i /></span>
          <span className="brand-text">DESAFIO<span>DIGITAL</span></span>
        </button>
        <div className={`topbar-right ${phase === "playing" ? "game-topbar-right" : ""}`}>
          <span className="grade-pill"><span className="live-dot" /> TECNOLOGIA · 8º ANO</span>
          {phase === "playing" && <button className="music-toggle" onClick={toggleMusic} aria-pressed={musicEnabled} aria-label={musicEnabled ? "Silenciar trilha sonora" : "Ativar trilha sonora"}><span aria-hidden="true">{musicEnabled ? "♫" : "♪"}</span><span>{musicEnabled ? "Som ligado" : "Som desligado"}</span></button>}
          {phase === "playing" && <span className="top-score"><span className="star">✳</span> {score.toLocaleString("pt-BR")}</span>}
        </div>
      </header>

      {phase === "home" && (
        <section className="home-page">
          <div className="hero-grid">
            <div className="hero-copy">
              <p className="kicker"><span className="kicker-line" /> APRENDER É JOGAR</p>
              <h1>Seu próximo<br />nível começa <span className="highlight">aqui.</span></h1>
              <p className="hero-sub">Tecnologia, lógica e cultura digital — um desafio de cada vez. Escolha sua trilha e mostre o que sabe.</p>
              <div className="hero-stats">
                <div><strong>35</strong><span>questões</span></div><b className="stat-divider" /><div><strong>03</strong><span>trilhas</span></div><b className="stat-divider" /><div><strong>∞</strong><span>tentativas</span></div>
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
            <div><p className="section-eyebrow">ESCOLHA SUA JORNADA</p><h2>Por onde vamos começar?</h2></div>
            <p className="selection-note">Sem pressão. Você pode tentar<br />quantas vezes quiser.</p>
          </div>
          <div className="category-list">
            {categories.map((item, itemIndex) => (
              <button key={item.name} className={`category-card cat-${itemIndex}${itemIndex === 0 ? " featured" : ""}`} onClick={() => startQuiz(item.name)}>
                <span className="category-icon">{item.mark}</span>
                <span className="category-main"><span className="category-eyebrow">{item.eyebrow}</span><strong>{item.name === "Tudo" ? "Desafio completo" : item.name}</strong><span className="category-description">{item.description}</span></span>
                <span className="category-meta"><strong>{item.count.toString().padStart(2, "0")}</strong><span>questões</span></span>
                <span className="category-arrow" aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
          <footer className="home-footer"><span>FEITO PARA CURIOSOS DE TODAS AS IDEIAS</span><span>QUESTÕES DO CADERNO · 8º ANO</span></footer>
        </section>
      )}

      {phase === "playing" && current && (
        <section className="game-page">
          <div className="game-toolbar">
            <button className="back-button" onClick={() => setPhase("home")} aria-label="Voltar à seleção de categorias">← <span>Sair do desafio</span></button>
            <div className="game-context"><span>{current.category}</span><i>·</i><span>QUESTÃO {String(index + 1).padStart(2, "0")} <em>/ {String(total).padStart(2, "0")}</em></span></div>
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
              <div className="result-actions"><button className="primary-button" onClick={() => startQuiz(category)}>Jogar esta trilha de novo <span>↻</span></button><button className="text-button" onClick={() => setPhase("home")}>Escolher outra trilha <span>→</span></button></div>
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
