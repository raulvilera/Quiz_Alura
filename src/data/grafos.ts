// Quiz de Tecnologia · Grafos (4º bimestre), com simulador de grafos.
// O quiz roda no painel (painel-prova-paulista-2026) e grava a tentativa em quiz_attempts com estes ids,
// para aparecer neste relatório na trilha "Grafos".
export const GRAFOS_URL = "https://painel-prova-paulista-2026.vercel.app/quiz-tecnologia-8ano/";
export const GRAFOS_TRILHA = "Grafos (simulador)";

export const grafosQuestions: { id: number; prompt: string }[] = [
  "Com quem Joana trocou mensagens diretamente? (vizinhos de um vértice)",
  "Não há aresta entre Sofia e Gabriel. O que essa ausência indica? (intermediários)",
  "Como representar no grafo as conexões diretas entre terminais de ônibus?",
  "V ou F: cada espaço da mostra é um vértice e as passagens diretas são arestas.",
  "Qual percurso Mateus pode fazer do Palco Sol ao Palco Terra?",
  "Grafo direcionado: o que representa a seta da Praça para a Escola com peso 6?",
  "Comparando grau dos vértices e peso das arestas, qual conclusão é correta?",
  "V ou F: cada perfil está conectado diretamente a todos os outros (grafo completo).",
  "V ou F: um vértice por oficina e arestas entre as de mesmo tema.",
  "Qual caminho o vídeo de Camila pode ter percorrido até Ravi?",
  "V ou F: Maya está diretamente conectada a Lucas e Pedro.",
  "V ou F: Bianca é um vértice e a ligação Bianca – Otávio é uma aresta.",
  "V ou F: Rafaela e Diego têm conexão direta porque há caminho passando por Bruno.",
  "Discursiva: compare as arestas da Praça e do Parque e explique os deslocamentos diretos.",
].map((prompt, i) => ({ id: 1001 + i, prompt }));
