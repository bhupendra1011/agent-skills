# 10 — Advanced Features

## MCP Server Integration

Enable tool calling so the agent can invoke external tools via MCP (Model Context Protocol):

```ts
// In agentSettings:
advanced_features: { enable_tools: true },
llm: {
  mcp_servers: [{
    name: "my-tool-server",
    endpoint: "https://my-server.com/mcp",
    transport: "sse",
    headers: { "Authorization": "Bearer <token>" },
    allowed_tools: ["search", "calculator"],
    enabled: true,
  }],
}
```

In the invite route, auto-enable tools when MCP servers are configured:

```ts
const hasMcpServers = enabledMcpServers.length > 0;
propertiesPayload.advanced_features = {
  enable_rtm: useRtm,
  enable_tools: hasMcpServers || advanced_features?.enable_tools,
};
```

## SAL (Selective Attention Locking)

Voice cloning / tone matching. Requires audio samples:

```ts
// In agentSettings:
advanced_features: { enable_sal: true },
sal: {
  sal_mode: "locking",  // or "recognition"
  sample_urls: {
    "en-US": "https://example.com/voice-sample.wav",
  },
},
```

Invite route:
```ts
if (advanced_features?.enable_sal) {
  propertiesPayload.sal = {
    sal_mode: sal?.sal_mode ?? "locking",
    ...(sal?.sample_urls && { sample_urls: sal.sample_urls }),
  };
}
```

## Filler Words

Agent says filler phrases while processing (reduces perceived latency):

```ts
// In agentSettings:
filler_words: {
  enable: true,
  trigger: { mode: "fixed_time", fixed_time_config: { response_wait_ms: 1500 } },
  content: {
    mode: "static",
    static_config: {
      phrases: ["Please wait.", "Okay.", "Uh-huh."],
      selection_rule: "shuffle",
    },
  },
},
```

## Turn Detection

Control how the agent detects when the user starts/stops speaking:

```ts
turn_detection: {
  mode: "default",
  config: {
    speech_threshold: 0.5,
    start_of_speech: {
      mode: "vad",  // "vad" | "keywords" | "disabled"
      vad_config: {
        interrupt_duration_ms: 160,
        speaking_interrupt_duration_ms: 160,
        prefix_padding_ms: 800,
      },
    },
    end_of_speech: {
      mode: "vad",  // "vad" | "semantic"
      vad_config: { silence_duration_ms: 640 },
    },
  },
},
```

## Whiteboard Integration

Add interactive whiteboard using `@netless/fastboard-react`:

```bash
npm install @netless/fastboard-react
```

Requires a Netless app identifier and token (separate from Agora RTC). The whiteboard is a separate React component that can be shown alongside the video call.

## Token Refresh for Long Sessions

```ts
// Set up refresh before token expires
rtcClient.on("token-privilege-will-expire", async () => {
  const { token } = await fetch(`/api/generate-agora-token?channel=${channelId}&uid=${uid}`).then(r => r.json());
  await rtcClient.renewToken(token);
});

// For RTM (if using):
rtmClient.on("token-privilege-will-expire", async () => {
  const { token } = await fetch(`/api/generate-agora-token?channel=${channelId}&uid=${uid}`).then(r => r.json());
  await rtmClient.renewToken(token);
});
```

## Telephony / SIP (Future)

Outbound calling via Agora's SIP integration. Uses Twilio for caller ID:

```ts
// POST /api/agent/call
// Uses https://api.agora.io/api/conversational-ai-agent/v2/projects/{APP_ID}/call
// Requires: sip_uri, from_number, to_number
```

This is an emerging feature — check Agora docs for latest API shape.

## Verification

1. MCP: Configure an MCP server → ask agent to use a tool → verify tool call in logs
2. SAL: Provide voice sample URL → agent's voice should match sample tone
3. Filler words: Set 1500ms wait → agent says filler phrase before responding
4. Token refresh: Set 5-minute token → session continues past 5 minutes without disconnection
