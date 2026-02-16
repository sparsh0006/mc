// lib/jury.ts
import { prisma } from "./prisma";
import { postFightVerdict } from "./onchain";
import { onTournamentFightComplete } from "./tournaments";

const JURY_SYSTEM_PROMPT = `You are a debate judge on MoltCourt, an arena for AI agent debates.

Score two arguments on four criteria (0.0–10.0 each):
1. LOGIC & REASONING: Sound argument structure? Fallacies?
2. EVIDENCE & SPECIFICITY: Concrete examples, data, real projects? Vague = low score.
3. REBUTTAL QUALITY: How well does agent counter opponent? (Score 5.0 for Round 1)
4. CLARITY & PERSUASION: Well-structured and compelling?

RULES:
- Score independently. Don't let one inflate/deflate the other.
- Reward intellectual honesty. Conceding a weak point > dodging.
- Penalize repetition from previous rounds.
- Be precise: 7.0 vs 7.5 matters.

Respond ONLY with JSON (no markdown, no backticks):
{"agentA":{"logic":0.0,"evidence":0.0,"rebuttal":0.0,"clarity":0.0},"agentB":{"logic":0.0,"evidence":0.0,"rebuttal":0.0,"clarity":0.0},"reasoning":"Brief explanation"}`;

interface JuryResult {
  scoreA: number;
  scoreB: number;
  details: {
    logicA: number; logicB: number;
    evidenceA: number; evidenceB: number;
    rebuttalA: number; rebuttalB: number;
    clarityA: number; clarityB: number;
  };
  reasoning: string;
}

export async function evaluateRound(
  fightId: string,
  roundId: string,
  roundNumber: number,
  args: Array<{ agentId: string; content: string }>
): Promise<JuryResult> {
  const fight = await prisma.fight.findUnique({
    where: { id: fightId },
    include: {
      agentA: true,
      agentB: true,
      rounds: { include: { arguments: true }, orderBy: { roundNumber: "asc" } },
    },
  });

  if (!fight || !fight.agentB) throw new Error("Fight not found or incomplete");

  const argA = args.find((a) => a.agentId === fight.agentAId);
  const argB = args.find((a) => a.agentId === fight.agentBId);
  if (!argA || !argB) throw new Error("Missing arguments");

  const prevContext = fight.rounds
    .filter((r) => r.roundNumber < roundNumber && r.completedAt)
    .map((r) => {
      const rArgA = r.arguments.find((a) => a.agentId === fight.agentAId);
      const rArgB = r.arguments.find((a) => a.agentId === fight.agentBId);
      return `Round ${r.roundNumber}: A=${r.scoreA?.toFixed(1)}, B=${r.scoreB?.toFixed(1)}\nA: ${rArgA?.content.substring(0, 200)}...\nB: ${rArgB?.content.substring(0, 200)}...`;
    })
    .join("\n\n");

  const prompt = `TOPIC: ${fight.topic}\n\n${prevContext ? `PREVIOUS:\n${prevContext}\n\n` : ""}ROUND ${roundNumber}:\n\nAgent A (${fight.agentA.name}):\n${argA.content}\n\nAgent B (${fight.agentB.name}):\n${argB.content}\n\nScore both.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: JURY_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 1000,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Jury API failed: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const text = data.choices[0].message.content.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(text);

  const totalA = parsed.agentA.logic + parsed.agentA.evidence + parsed.agentA.rebuttal + parsed.agentA.clarity;
  const totalB = parsed.agentB.logic + parsed.agentB.evidence + parsed.agentB.rebuttal + parsed.agentB.clarity;

  return {
    scoreA: totalA,
    scoreB: totalB,
    details: {
      logicA: parsed.agentA.logic, logicB: parsed.agentB.logic,
      evidenceA: parsed.agentA.evidence, evidenceB: parsed.agentB.evidence,
      rebuttalA: parsed.agentA.rebuttal, rebuttalB: parsed.agentB.rebuttal,
      clarityA: parsed.agentA.clarity, clarityB: parsed.agentB.clarity,
    },
    reasoning: parsed.reasoning,
  };
}

export async function completeFight(fightId: string) {
  const fight = await prisma.fight.findUnique({
    where: { id: fightId },
    include: { rounds: true, agentA: true, agentB: true },
  });
  if (!fight || !fight.agentBId) return;

  const totalA = fight.rounds.reduce((s, r) => s + (r.scoreA || 0), 0);
  const totalB = fight.rounds.reduce((s, r) => s + (r.scoreB || 0), 0);
  const winnerId = totalA >= totalB ? fight.agentAId : fight.agentBId;
  const loserId = winnerId === fight.agentAId ? fight.agentBId : fight.agentAId;

  await prisma.fight.update({
    where: { id: fightId },
    data: { status: "COMPLETED", winnerId },
  });

  await prisma.agent.update({
    where: { id: winnerId },
    data: { wins: { increment: 1 }, reputation: { increment: 50 }, currentStreak: { increment: 1 } },
  });

  await prisma.agent.update({
    where: { id: loserId },
    data: { losses: { increment: 1 }, reputation: { decrement: 20 }, currentStreak: 0 },
  });

  const txHash = await postFightVerdict({
    fightId: fight.id,
    topic: fight.topic,
    agentA: fight.agentA.name,
    agentB: fight.agentB?.name || "Unknown",
    winnerId,
    totalScoreA: totalA,
    totalScoreB: totalB,
    rounds: fight.rounds.length,
  });

  if (txHash) {
    await prisma.fight.update({ where: { id: fightId }, data: { txHash } });
  }

  if (fight.tournamentId) {
    await onTournamentFightComplete(fightId, winnerId);
  }
}
