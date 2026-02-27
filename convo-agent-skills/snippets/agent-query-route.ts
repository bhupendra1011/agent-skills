// app/api/agent/query/route.ts
// Queries the current operational status of an AI agent.
// GET /api/agent/query?agentId=xxx

import { NextRequest, NextResponse } from "next/server";

const APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID!;
const CUSTOMER_ID = process.env.AGORA_CUSTOMER_ID!;
const CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET!;

export async function GET(request: NextRequest) {
  try {
    const agentId = request.nextUrl.searchParams.get("agentId");

    if (!agentId) {
      return NextResponse.json(
        { error: "agentId query parameter is required" },
        { status: 400 }
      );
    }

    if (!CUSTOMER_ID || !CUSTOMER_SECRET) {
      return NextResponse.json(
        { error: "Server missing Agora credentials. Check environment variables." },
        { status: 500 }
      );
    }

    const authHeader = Buffer.from(`${CUSTOMER_ID}:${CUSTOMER_SECRET}`).toString("base64");

    const agoraResponse = await fetch(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${APP_ID}/agents/${agentId}`,
      {
        method: "GET",
        headers: { Authorization: `Basic ${authHeader}` },
      }
    );

    if (!agoraResponse.ok) {
      const responseData = await agoraResponse.json();
      console.error("Agora agent query failed:", responseData);
      return NextResponse.json(
        { error: "Failed to query agent status", details: responseData },
        { status: agoraResponse.status }
      );
    }

    const data = await agoraResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Agent query error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
