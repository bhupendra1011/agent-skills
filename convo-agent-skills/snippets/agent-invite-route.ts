// @version 1.1.0
// app/api/agent/invite/route.ts
// Invites an AI agent to the channel via Agora Conversational AI API v2.
// Client calls POST /api/agent/invite with { channelName, uid, agentSettings, username }.
// Server injects API keys from .env when client sends empty values (keys never exposed to client).

import { NextRequest, NextResponse } from "next/server";
import { RtcTokenBuilder, RtcRole } from "agora-token";

const APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID!;
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE!;
const CUSTOMER_ID = process.env.AGORA_CUSTOMER_ID!;
const CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET!;

// Helper: Get key from client or fallback to server .env
const getKey = (clientKey: string | undefined, serverEnvKey: string): string => {
  const trimmed = (clientKey ?? "").trim();
  if (trimmed && trimmed !== "__USE_SERVER__" && trimmed !== "***MASKED***") {
    return trimmed;
  }
  return (process.env[serverEnvKey] || "").trim();
};

// Helper: Generate unique agent name to prevent 409 TaskConflict errors
const generateAgentName = (baseName: string): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${baseName}-${timestamp}-${random}`;
};

// Helper: Mask API keys in payload for safe logging
const maskKeysInPayload = (obj: unknown): unknown => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(maskKeysInPayload);
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (
      (key === "api_key" || key === "key" || key === "token" || key === "agora_token") &&
      typeof value === "string" && value.length > 0
    ) {
      masked[key] = value.slice(0, 4) + "****" + value.slice(-4);
    } else if (typeof value === "object") {
      masked[key] = maskKeysInPayload(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
};

type InviteBody = {
  channelName: string;
  uid: string;
  agentSettings: {
    name: string;
    idle_timeout?: number;
    llm: {
      url: string;
      api_key?: string;
      style?: string;
      system_messages?: Array<{ role: string; content: string }>;
      greeting_message?: string;
      failure_message?: string;
      template_variables?: Record<string, string>;
      max_history?: number;
      params?: Record<string, unknown>;
      input_modalities?: string[];
      mcp_servers?: Array<{
        name: string;
        endpoint: string;
        transport?: string;
        headers?: Record<string, string>;
        queries?: Record<string, string>;
        allowed_tools?: string[];
        enabled?: boolean;
      }>;
    };
    tts: {
      vendor: string;
      params: Record<string, unknown>;
    };
    asr?: {
      vendor?: string;
      language?: string;
      params?: Record<string, unknown>;
    };
    advanced_features?: {
      enable_rtm?: boolean;
      enable_sal?: boolean;
      enable_tools?: boolean;
    };
    parameters?: {
      data_channel?: string;
      enable_farewell?: boolean;
      farewell_phrases?: string[];
    };
    avatar?: {
      enable?: boolean;
      vendor?: string;
      params?: Record<string, unknown>;
    };
  };
  username?: string;
};

export async function POST(request: NextRequest) {
  console.log("[Agent Invite] Starting agent invite request...");

  try {
    const body = (await request.json()) as InviteBody;
    const { channelName, uid, agentSettings, username } = body;

    console.log(`[Agent Invite] Channel: ${channelName}, UID: ${uid}, Username: ${username}`);

    if (!channelName || !uid) {
      return NextResponse.json({ error: "channelName and uid are required" }, { status: 400 });
    }
    if (!APP_CERTIFICATE || !CUSTOMER_ID || !CUSTOMER_SECRET) {
      return NextResponse.json({ error: "Server missing Agora credentials" }, { status: 500 });
    }

    const { llm, tts, asr, advanced_features, parameters, avatar } = agentSettings;

    // --- Generate agent token ---
    const agentUid = 0; // Let Agora assign the actual UID
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

    // --- LLM config (inject server key if client sent empty) ---
    const llmApiKey = getKey(llm.api_key, "LLM_API_KEY");
    console.log("[Agent Invite] LLM API Key source:", llm.api_key?.trim() ? "client" : "server (.env)");

    const llmPayload: Record<string, unknown> = {
      url: llm.url,
      api_key: llmApiKey,
    };

    if (llm.style) llmPayload.style = llm.style;
    if (llm.system_messages?.length) llmPayload.system_messages = llm.system_messages;

    const displayName = username || "Guest";
    llmPayload.template_variables = { ...(llm.template_variables ?? {}), username: displayName };
    llmPayload.greeting_message = llm.greeting_message?.trim() ||
      "Hello {{username}}, glad to meet you, how can I help you?";
    if (llm.failure_message?.trim()) llmPayload.failure_message = llm.failure_message.trim();
    if (llm.max_history) llmPayload.max_history = llm.max_history;
    if (llm.params) llmPayload.params = llm.params;
    llmPayload.input_modalities = llm.input_modalities ?? ["text"];

    // MCP servers (only enabled ones)
    const enabledMcp = (llm.mcp_servers ?? []).filter((s) => s.enabled !== false);
    if (enabledMcp.length > 0) {
      llmPayload.mcp_servers = enabledMcp.map((s) => {
        const endpoint = s.queries && Object.keys(s.queries).length > 0
          ? `${s.endpoint.replace(/\?$/, "")}?${new URLSearchParams(s.queries).toString()}`
          : s.endpoint;
        const { enabled, queries, endpoint: _ep, ...rest } = s;
        void enabled; void queries; void _ep;
        return { ...rest, endpoint };
      });
    }

    // --- TTS config (inject server key based on vendor) ---
    const ttsParams = { ...tts.params } as Record<string, unknown>;
    const ttsEnvKey = tts.vendor === "elevenlabs" ? "ELEVENLABS_API_KEY"
      : tts.vendor === "openai" ? "OPENAI_TTS_KEY"
      : "MICROSOFT_TTS_KEY";
    ttsParams.key = getKey(ttsParams.key as string, ttsEnvKey);

    // --- ASR config (optional, inject server key for Deepgram/Microsoft) ---
    let asrPayload: Record<string, unknown> | undefined;
    if (asr) {
      asrPayload = {};
      if (asr.vendor) asrPayload.vendor = asr.vendor;
      if (asr.language) asrPayload.language = asr.language;
      if (asr.params && Object.keys(asr.params).length > 0) {
        const asrParams = { ...asr.params };
        if (asr.vendor === "deepgram") {
          asrParams.api_key = getKey(asrParams.api_key as string, "DEEPGRAM_API_KEY");
        } else if (asr.vendor === "microsoft") {
          asrParams.key = getKey(asrParams.key as string, "MICROSOFT_ASR_KEY");
        }
        asrPayload.params = asrParams;
      }
    }

    // --- Build properties payload ---
    const useRtm = advanced_features?.enable_rtm ?? false;
    const enableTools = enabledMcp.length > 0 || advanced_features?.enable_tools;

    const propertiesPayload: Record<string, unknown> = {
      channel: channelName,
      token: agentRtcToken,
      agent_rtc_uid: String(agentUid),
      remote_rtc_uids: ["*"],
      enable_string_uid: false,
      idle_timeout: agentSettings.idle_timeout || 30,
      llm: llmPayload,
      tts: { vendor: tts.vendor, params: ttsParams },
    };

    if (asrPayload && Object.keys(asrPayload).length > 0) propertiesPayload.asr = asrPayload;

    if (advanced_features || enabledMcp.length > 0) {
      propertiesPayload.advanced_features = {
        enable_rtm: useRtm,
        enable_tools: enableTools,
      };
    }

    propertiesPayload.parameters = {
      ...(parameters?.enable_farewell !== undefined && { enable_farewell: parameters.enable_farewell }),
      ...(parameters?.farewell_phrases && { farewell_phrases: parameters.farewell_phrases }),
      data_channel: useRtm ? "rtm" : "datastream",
    };

    // --- Avatar config (if enabled) ---
    let avatarRtcUid: string | null = null;
    if (avatar?.enable && avatar?.vendor) {
      avatarRtcUid = "999999";
      const avatarRtcToken = RtcTokenBuilder.buildTokenWithUid(
        APP_ID, APP_CERTIFICATE, channelName, Number(avatarRtcUid),
        RtcRole.PUBLISHER, tokenExpiration, privilegeExpiration
      );

      const avatarEnvKey = avatar.vendor === "heygen" ? "HEYGEN_API_KEY"
        : avatar.vendor === "akool" ? "AKOOL_API_KEY"
        : "ANAM_API_KEY";
      const avatarApiKey = getKey(avatar.params?.api_key as string, avatarEnvKey);

      let avatarId = (avatar.params?.avatar_id as string) || "";
      if (!avatarId.trim()) {
        const avatarIdEnvKey = avatar.vendor === "heygen" ? "NEXT_PUBLIC_HEYGEN_AVATAR_ID"
          : avatar.vendor === "akool" ? "NEXT_PUBLIC_AKOOL_AVATAR_ID"
          : "NEXT_PUBLIC_ANAM_AVATAR_ID";
        avatarId = process.env[avatarIdEnvKey] || "";
      }

      let avatarParams: Record<string, unknown> = {
        agora_uid: avatarRtcUid,
        agora_token: avatarRtcToken,
      };

      if (avatar.vendor === "anam") {
        avatarParams = { ...avatarParams, anam_api_key: avatarApiKey, anam_avatar_id: avatarId, anam_base_url: "https://api.anam.ai/v1" };
      } else if (avatar.vendor === "heygen") {
        avatarParams = { ...avatarParams, api_key: avatarApiKey, avatar_id: avatarId, quality: avatar.params?.quality || "medium", activity_idle_timeout: avatar.params?.activity_idle_timeout || 60 };
      } else {
        avatarParams = { ...avatarParams, api_key: avatarApiKey, avatar_id: avatarId };
      }

      propertiesPayload.avatar = { enable: true, vendor: avatar.vendor, params: avatarParams };
      propertiesPayload.remote_rtc_uids = [uid]; // Avatar requires explicit UIDs, not wildcard

      // Enforce TTS sample rates for avatar vendors
      if (avatar.vendor === "heygen" || avatar.vendor === "anam") {
        (propertiesPayload.tts as Record<string, unknown>).params = { ...ttsParams, sample_rate: 24000 };
      } else if (avatar.vendor === "akool") {
        (propertiesPayload.tts as Record<string, unknown>).params = { ...ttsParams, sample_rate: 16000 };
      }
    }

    // --- Call Agora API ---
    const authHeader = Buffer.from(`${CUSTOMER_ID}:${CUSTOMER_SECRET}`).toString("base64");
    const apiUrl = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${APP_ID}/join`;
    const uniqueAgentName = generateAgentName(agentSettings.name || "agent");
    const requestBody = { name: uniqueAgentName, properties: propertiesPayload };

    console.log("[Agent Invite] Agent name:", uniqueAgentName);
    console.log("[Agent Invite] Request payload (masked):");
    console.log(JSON.stringify(maskKeysInPayload(requestBody), null, 2));

    const agoraResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${authHeader}`,
      },
      body: JSON.stringify(requestBody),
    });

    const responseData = await agoraResponse.json();
    console.log("[Agent Invite] Response status:", agoraResponse.status);
    console.log("[Agent Invite] Response payload:", JSON.stringify(responseData, null, 2));

    if (!agoraResponse.ok) {
      return NextResponse.json(
        { error: "Failed to start AI agent", details: responseData },
        { status: agoraResponse.status }
      );
    }

    // CRITICAL: Return the ACTUAL agent UID from Agora's response, NOT the input "0"
    const actualAgentRtcUid = responseData.agent_uid || responseData.rtc_uid || String(agentUid);

    console.log("[Agent Invite] SUCCESS - Agent ID:", responseData.agent_id, "UID:", actualAgentRtcUid);

    return NextResponse.json({
      agentId: responseData.agent_id,
      status: responseData.status,
      agentRtcUid: String(actualAgentRtcUid),
      avatarRtcUid,
    });
  } catch (error) {
    console.error("[Agent Invite] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
