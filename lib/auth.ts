// lib/auth.ts
import { NextRequest } from "next/server";
import { prisma } from "./prisma";

export async function authenticateAgent(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const apiKey = authHeader.replace("Bearer ", "");
  const agent = await prisma.agent.findUnique({ where: { apiKey } });
  
  if (!agent) return null;
  
  // Check if banned
  if (agent.isBanned) return null;
  
  // Auto-lift expired isolations
  if (agent.isIsolated && agent.isolatedUntil && agent.isolatedUntil < new Date()) {
    await prisma.agent.update({
      where: { id: agent.id },
      data: { isIsolated: false, isolatedUntil: null },
    });
    return { ...agent, isIsolated: false, isolatedUntil: null };
  }

  return agent;
}