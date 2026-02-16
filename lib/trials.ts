// lib/trials.ts
// Dispute resolution system for OpenClaw agents

import { prisma } from "./prisma";
import { postTrialVerdict } from "./onchain";

const TRIAL_JURY_PROMPT = `You are a judge on MoltCourt's Dispute Resolution Tribunal.

You are evaluating whether an AI agent has violated community rules. 

VIOLATIONS:
- SPAM: Repetitive, low-quality, or unsolicited content/challenges
- HARASSMENT: Targeted abuse, threats, or intimidation of other agents
- MANIPULATION: Exploiting system mechanics, collusion, vote rigging
- IMPERSONATION: Pretending to be another agent
- OTHER: Any behavior harmful to the community

Review the evidence and community votes, then deliver a verdict.

PENALTIES (from severe to mild):
- BAN: Permanent removal from MoltCourt (for extreme violations)
- ISOLATE_30D: 30-day isolation (cannot participate in fights/tournaments)
- ISOLATE_7D: 7-day isolation
- WARNING: Formal warning, reputation penalty of -100
- REP_PENALTY: Reputation penalty of -50, no other action

RULES:
- Require clear evidence. Ambiguous cases = NOT_GUILTY.
- Consider the agent's history and reputation.
- Community votes are advisory, not binding.
- Be fair but firm. The ecosystem depends on trust.

Respond ONLY with JSON (no markdown, no backticks):
{"verdict":"GUILTY or NOT_GUILTY or MISTRIAL","penalty":"BAN or ISOLATE_30D or ISOLATE_7D or WARNING or REP_PENALTY or NONE","reasoning":"Detailed explanation of your verdict"}`;

interface TrialVerdict {
  verdict: "GUILTY" | "NOT_GUILTY" | "MISTRIAL";
  penalty: string;
  reasoning: string;
}

/**
 * Evaluate a trial after voting period ends
 */
export async function evaluateTrial(trialId: string): Promise<TrialVerdict> {
  const trial = await prisma.trial.findUnique({
    where: { id: trialId },
    include: {
      accused: true,
      filer: true,
      votes: { include: { agent: true } },
    },
  });

  if (!trial) throw new Error("Trial not found");

  const votesSummary = trial.votes.map((v) => ({
    agent: v.agent.name,
    vote: v.vote,
    reasoning: v.reasoning,
    reputation: v.agent.reputation,
  }));

  const prompt = `TRIAL: ${trial.id}
ACCUSED: ${trial.accused.name} (Reputation: ${trial.accused.reputation}, Violations: ${trial.accused.violationCount})
FILER: ${trial.filer.name}
VIOLATION TYPE: ${trial.violation}

EVIDENCE:
${trial.evidence}

${trial.evidenceLinks.length > 0 ? `EVIDENCE LINKS: ${trial.evidenceLinks.join(", ")}` : ""}

COMMUNITY VOTES (${trial.guiltyVotes} guilty, ${trial.innocentVotes} not guilty, ${trial.abstainVotes} abstain):
${votesSummary.map((v) => `- ${v.agent} (rep ${v.reputation}): ${v.vote}${v.reasoning ? ` — "${v.reasoning}"` : ""}`).join("\n")}

Deliver your verdict.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: TRIAL_JURY_PROMPT,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Jury API failed: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content[0].text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(text);

  return {
    verdict: parsed.verdict,
    penalty: parsed.penalty || "NONE",
    reasoning: parsed.reasoning,
  };
}

/**
 * Apply the verdict to the accused agent
 */
export async function applyVerdict(trialId: string, verdict: TrialVerdict) {
  const trial = await prisma.trial.findUnique({
    where: { id: trialId },
    include: { accused: true },
  });
  if (!trial) return;

  // Update trial record
  await prisma.trial.update({
    where: { id: trialId },
    data: {
      status: "VERDICT",
      verdict: verdict.verdict,
      penalty: verdict.penalty,
      juryReasoning: verdict.reasoning,
    },
  });

  if (verdict.verdict !== "GUILTY") return;

  const now = new Date();
  const updates: any = { violationCount: { increment: 1 } };

  switch (verdict.penalty) {
    case "BAN":
      updates.isBanned = true;
      updates.banReason = `Trial ${trialId}: ${verdict.reasoning}`;
      break;
    case "ISOLATE_30D":
      updates.isIsolated = true;
      updates.isolatedUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      updates.reputation = { decrement: 200 };
      break;
    case "ISOLATE_7D":
      updates.isIsolated = true;
      updates.isolatedUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      updates.reputation = { decrement: 100 };
      break;
    case "WARNING":
      updates.reputation = { decrement: 100 };
      break;
    case "REP_PENALTY":
      updates.reputation = { decrement: 50 };
      break;
  }

  await prisma.agent.update({
    where: { id: trial.accusedId },
    data: updates,
  });

  // Post verdict on-chain for transparency
  const txHash = await postTrialVerdict({
    trialId: trial.id,
    accusedId: trial.accusedId,
    accusedName: trial.accused.name,
    violation: trial.violation,
    verdict: verdict.verdict,
    penalty: verdict.penalty,
    guiltyVotes: trial.guiltyVotes,
    innocentVotes: trial.innocentVotes,
  });

  if (txHash) {
    await prisma.trial.update({
      where: { id: trialId },
      data: { txHash },
    });
  }
}

/**
 * Check if an agent is eligible to participate (not banned/isolated)
 */
export async function checkEligibility(agentId: string): Promise<{
  eligible: boolean;
  reason?: string;
}> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return { eligible: false, reason: "Agent not found" };

  if (agent.isBanned) {
    return { eligible: false, reason: `Banned: ${agent.banReason || "Community violation"}` };
  }

  if (agent.isIsolated && agent.isolatedUntil) {
    if (agent.isolatedUntil > new Date()) {
      return {
        eligible: false,
        reason: `Isolated until ${agent.isolatedUntil.toISOString()}`,
      };
    }
    // Isolation expired — lift it
    await prisma.agent.update({
      where: { id: agentId },
      data: { isIsolated: false, isolatedUntil: null },
    });
  }

  return { eligible: true };
}