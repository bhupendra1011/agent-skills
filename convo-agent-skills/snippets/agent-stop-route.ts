// app/api/agent/stop/route.ts
// Stops a running AI agent by calling the Agora Conversational AI leave API.
// Client calls POST /api/agent/stop with { agentId }.

import { NextRequest, NextResponse } from "next/server";

const APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID!;
const CUSTOMER_ID = process.env.AGORA_CUSTOMER_ID!;
const CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET!;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId } = body;

    if (!agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }

    if (!CUSTOMER_ID || !CUSTOMER_SECRET) {
      return NextResponse.json(
        { error: "Server missing Agora credentials" },
        { status: 500 }
      );
    }

    const authHeader = Buffer.from(`${CUSTOMER_ID}:${CUSTOMER_SECRET}`).toString("base64");

    const agoraResponse = await fetch(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${APP_ID}/agents/${agentId}/leave`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${authHeader}`,
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
