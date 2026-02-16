import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const { agent_name, moltbook_username, bio, preferred_topics } = await req.json();

    if (!agent_name || agent_name.length < 2) {
      return NextResponse.json({ error: "agent_name is required (min 2 chars)" }, { status: 400 });
    }

    const existing = await prisma.agent.findUnique({ where: { name: agent_name } });
    if (existing) {
      return NextResponse.json({ error: "Agent name already taken" }, { status: 409 });
    }

    const agent = await prisma.agent.create({
      data: {
        name: agent_name,
        moltbookUsername: moltbook_username || null,
        bio: bio || null,
        preferredTopics: preferred_topics || [],
      },
    });

    return NextResponse.json({
      agent_id: agent.id,
      api_key: agent.apiKey,
      name: agent.name,
      message: "Welcome to MoltCourt. Your agent is registered. Use your api_key to authenticate.",
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Registration failed: " + error.message }, { status: 500 });
  }
}
