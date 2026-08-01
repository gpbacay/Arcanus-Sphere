import { KNOWLEDGE_BASE, type KnowledgeChunk } from "./knowledge";
import { cosineSimilarity, hashEmbed } from "./embeddings";

export interface RetrievedChunk extends KnowledgeChunk {
  score: number;
}

let cached: { id: string; vector: number[] }[] | null = null;

function ensureIndex() {
  if (cached) return cached;
  cached = KNOWLEDGE_BASE.map((chunk) => ({
    id: chunk.id,
    vector: hashEmbed(`${chunk.title}\n${chunk.content}\n${chunk.tags.join(" ")}`),
  }));
  return cached;
}

export function retrieveKnowledgeSync(query: string, topK = 3): RetrievedChunk[] {
  const qVec = hashEmbed(query);
  const index = ensureIndex();
  return KNOWLEDGE_BASE.map((chunk) => {
    const entry = index.find((i) => i.id === chunk.id);
    const score = entry ? cosineSimilarity(qVec, entry.vector) : 0;
    return { ...chunk, score };
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export async function retrieveKnowledge(query: string, topK = 3) {
  return retrieveKnowledgeSync(query, topK);
}

export function formatRetrievedContext(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return "No relevant knowledge found.";
  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] ${c.title} (score=${c.score.toFixed(3)})\n${c.content}`
    )
    .join("\n\n");
}
