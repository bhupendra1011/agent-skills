# 05 — Agent Lifecycle
<!-- @version 1.2.0 -->

Invite, update, stop, and query an AI agent via the Agora Conversational AI API v2.

## Architecture

```
Client → Your API route → Agora Conversational AI API → Agent joins channel
```

The client never calls Agora directly. Your server:
1. Receives agent settings from client
2. Injects API keys from env (server key injection pattern)
3. Generates agent RTC token
4. Calls Agora API using RTC token auth (`Authorization: agora token=<token>`)

## Agora API Endpoints

| Action | Method | URL |
|--------|--------|-----|
| Join (invite) | POST | `https://api.agora.io/api/conversational-ai-agent/v2/projects/{APP_ID}/join` |
| Leave (stop) | POST | `https://api.agora.io/api/conversational-ai-agent/v2/projects/{APP_ID}/agents/{agentId}/leave` |
| Update | POST | `https://api.agora.io/api/conversational-ai-agent/v2/projects/{APP_ID}/agents/{agentId}/update` |
| Query | GET | `https://api.agora.io/api/conversational-ai-agent/v2/projects/{APP_ID}/agents/{agentId}` |

Auth header: `Authorization: agora token=<agent-rtc-token>`

> **No Customer ID/Secret needed.** The Agora Conversational AI API v2 accepts RTC token auth. Build the token with `RtcTokenBuilder` using `APP_ID` + `APP_CERTIFICATE`, then pass it as the Authorization header. Customer ID/Secret are optional and only needed if you prefer Basic Auth.

## Minimal Join Payload

```json
{
  "name": "my-agent",
  "properties": {
    "channel": "channel-123",
    "token": "<agent-rtc-token>",
    "agent_rtc_uid": "0",
    "remote_rtc_uids": ["*"],
    "enable_string_uid": false,
    "idle_timeout": 30,
    "llm": {
      "url": "https://api.openai.com/v1/chat/completions",
      "api_key": "<from-env>",
      "system_messages": [{ "role": "system", "content": "You are a helpful assistant." }],
      "greeting_message": "Hello {{username}}, how can I help?",
      "template_variables": { "username": "Guest" }
    },
    "tts": {
      "vendor": "microsoft",
      "params": { "key": "<from-env>", "region": "eastus", "voice_name": "en-US-AndrewMultilingualNeural" }
    },
    "parameters": {
      "data_channel": "datastream"
    }
  }
}
```

## Server Key Injection Pattern

Client sends sentinel values for API keys. Server replaces with env vars:

```ts
const shouldInjectServerKey = (v: string | undefined) =>
  !v || v.trim() === "" || v === "__USE_SERVER__" || v === "***MASKED***";

const llmApiKey = shouldInjectServerKey(llm.api_key)
  ? (process.env.LLM_API_KEY || "").trim()
  : (llm.api_key ?? "").trim();
```

This ensures keys never appear in client code, network requests, or IndexedDB.

## Agent Token

Token type must match RTM usage:

```ts
const agentToken = advanced_features?.enable_rtm
  ? RtcTokenBuilder.buildTokenWithRtm(APP_ID, APP_CERTIFICATE, channel, "0", ...)
  : RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, channel, 0, ...);
```

Mismatch = auth failure.

## Client API Layer

```ts
// src/api/agentApi.ts
export const inviteAgent = async (
  channelName: string, uid: string, agentSettings: AgentSettings, options?: { username?: string }
) => {
  const res = await fetch("/api/agent/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channelName, uid, agentSettings, username: options?.username }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to invite agent");
  return res.json(); // { agentId, status, agentRtcUid }
};

export const stopAgent = async (agentId: string, token: string) => {
  const res = await fetch("/api/agent/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, token }),
  });
  if (!res.ok) throw new Error("Failed to stop agent");
  return res.json();
};

export const updateAgent = async (agentId: string, channelName: string, agentSettings: AgentSettings) => {
  const res = await fetch("/api/agent/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, channelName, agentSettings }),
  });
  if (!res.ok) throw new Error("Failed to update agent");
  return res.json();
};

export const queryAgent = async (agentId: string) => {
  const res = await fetch(`/api/agent/query?agentId=${agentId}`);
  if (!res.ok) throw new Error("Failed to query agent");
  return res.json(); // { status, create_ts, ... }
};
```

## Store Integration

```ts
// After successful invite
store.setAgentLoading(true);
const { agentId, agentRtcUid } = await inviteAgent(channelId, localUID, agentSettings);
store.setAgentActive(agentId, agentRtcUid);

// Stop agent (pass the user's RTC token for auth)
await stopAgent(store.agentId, store.agoraToken);
store.clearAgent();
```

## Update API

Some fields are updatable without restarting:
- `llm.system_messages`
- `llm.greeting_message`
- `tts.vendor`, `tts.params`
- `asr.vendor`, `asr.language`

Others require stop + re-invite (e.g., `channel`, `token`, `advanced_features`).

## CRITICAL: Return Actual Agent UID from Response

The `agent_rtc_uid: "0"` you send in the payload means "let Agora assign". You **MUST** return the actual UID from Agora's response, **NOT** the `"0"` you sent:

```ts
// WRONG — always returns "0", agent UID filtering never matches:
return NextResponse.json({ agentId: responseData.agent_id, agentRtcUid: String(agentUid) });

// CORRECT — return the real UID Agora assigned:
const actualAgentRtcUid = responseData.agent_uid || responseData.rtc_uid || String(agentUid);
return NextResponse.json({
  agentId: responseData.agent_id,
  agentRtcUid: String(actualAgentRtcUid),
  avatarRtcUid,  // if avatar enabled
});
```

Without this fix, client-side agent UID filtering (see `02-rtc-voice`) will never match and the agent will appear as an extra participant tile.

## Unique Agent Names

Generate unique names to prevent **409 TaskConflict** errors when re-inviting quickly:

```ts
const generateAgentName = (baseName: string): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${baseName}-${timestamp}-${random}`;
};
// Use: name: generateAgentName(agentSettings.name)
```

## Stop Agent on Leave

Always stop the agent when the user leaves the call:

```ts
const leaveCall = async () => {
  if (store.agentId) {
    try {
      await fetch("/api/agent/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: store.agentId, token: store.agoraToken }),
      });
    } catch { /* noop */ }
  }
  // Then cleanup tracks and leave RTC...
};
```

## Error Handling

Always read the response body — Agora returns detailed error messages:

```ts
const agoraResponse = await fetch(apiUrl, { method: "POST", ... });
const responseData = await agoraResponse.json();
if (!agoraResponse.ok) {
  return NextResponse.json(
    { error: "Failed to start AI agent", details: responseData },
    { status: agoraResponse.status }
  );
}
```

## Verification

1. Click "Invite Agent" → agent joins channel within ~3 seconds
2. Agent speaks greeting message
3. Speak to agent → agent responds (confirms RTC audio bidirectional)
4. Click "Stop Agent" → agent leaves, store cleared
5. Check server logs for payload and response
