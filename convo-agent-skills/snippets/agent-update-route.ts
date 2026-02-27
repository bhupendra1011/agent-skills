// app/api/agent/update/route.ts
// Updates agent configuration at runtime (LLM system_messages, params, token).
// TTS, ASR, turn_detection, advanced_features require agent restart (stop + re-invite).

import { NextRequest, NextResponse } from "next/server";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import type { AgentSettings } from "@/types/agora";

const APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID!;
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE!;
const CUSTOMER_ID = process.env.AGORA_CUSTOMER_ID!;
const CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET!;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, channelName, agentSettings } = body as {
      agentId: string;
      channelName: string;
      agentSettings: AgentSettings;
    };

    if (!agentId || !channelName) {
      return NextResponse.json(
        { error: "agentId and channelName are required" },
        { status: 400 }
      );
    }
    if (!agentSettings) {
      return NextResponse.json(
        { error: "agentSettings is required" },
        { status: 400 }
      );
    }
    if (!APP_CERTIFICATE || !CUSTOMER_ID || !CUSTOMER_SECRET) {
      return NextResponse.json(
        { error: "Server missing Agora credentials. Check environment variables." },
        { status: 500 }
      );
    }

    const { llm, advanced_features } = agentSettings;

    // Regenerate token (may change if RTM is toggled)
    const agentUid = 0;
    const tokenExpiration = 3600;
    const privilegeExpiration = 3600;

    const agentRtcToken = advanced_features?.enable_rtm
      ? RtcTokenBuilder.buildTokenWithRtm(
          APP_ID, APP_CERTIFICATE, channelName, String(agentUid),
          RtcRole.PUBLISHER, tokenExpiration, privilegeExpiration
        )
      : RtcTokenBuilder.buildTokenWithUid(
          APP_ID, APP_CERTIFICATE, channelName, agentUid,
          RtcRole.PUBLISHER, tokenExpiration, privilegeExpiration
        );

    // Build LLM update payload (only updatable fields)
    const llmPayload: Record<string, unknown> = {};
    if (llm.system_messages?.length) llmPayload.system_messages = llm.system_messages;
    if (llm.params) llmPayload.params = llm.params;

    const propertiesPayload: Record<string, unknown> = { token: agentRtcToken };
    if (Object.keys(llmPayload).length > 0) propertiesPayload.llm = llmPayload;

    const authHeader = Buffer.from(`${CUSTOMER_ID}:${CUSTOMER_SECRET}`).toString("base64");
    const apiUrl = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${APP_ID}/agents/${agentId}/update`;

    const agoraResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${authHeader}`,
      },
      body: JSON.stringify({ properties: propertiesPayload }),
    });

    const responseData = await agoraResponse.json();

    if (!agoraResponse.ok) {
      console.error("Agora agent update failed:", responseData);
      return NextResponse.json(
        { error: "Failed to update agent configuration", details: responseData },
        { status: agoraResponse.status }
      );
    }

    return NextResponse.json({
      agentId: responseData.agent_id,
      status: responseData.status,
    });
  } catch (error) {
    console.error("Agent update error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 }
    );
  }
}
