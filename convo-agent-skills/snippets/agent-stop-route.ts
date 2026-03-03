// app/api/agent/stop/route.ts
// Stops a running AI agent by calling the Agora Conversational AI leave API.
// Client calls POST /api/agent/stop with { agentId, token }.
// The token is the user's own Agora RTC token (from /api/generate-agora-token).

import { NextRequest, NextResponse } from "next/server";

const APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID!;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, token } = body;

    if (!agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }
    if (!token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }

    const agoraResponse = await fetch(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${APP_ID}/agents/${agentId}/leave`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `agora token=${token}`,
        },
      }
    );

    if (!agoraResponse.ok) {
      const responseData = await agoraResponse.json();
      return NextResponse.json(
        { error: "Failed to stop AI agent", details: responseData },
        { status: agoraResponse.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Agent stop error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
