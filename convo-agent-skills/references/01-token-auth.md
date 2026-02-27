# 01 — Token Authentication

## Why Tokens

Agora tokens authenticate clients to RTC channels. They encode: App ID, channel name, user UID, role (PUBLISHER), and expiration. Without tokens, anyone with your App ID could join any channel.

## Token Types

| Function | When to use |
|----------|-------------|
| `buildTokenWithRtm` | When RTM is enabled (grants both RTC + Signaling privileges in one token) |
| `buildTokenWithUid` | When using RTC only (no RTM) |

**Rule**: If the agent uses RTM (`enable_rtm: true`), its token MUST be built with `buildTokenWithRtm`. Mismatching token type causes auth failures.

## Token Route

See `snippets/generate-token-route.ts` for the complete copy-paste route.

Key decisions:
- **Random UID**: `Math.floor(1 + Math.random() * (2**31 - 2))` — Agora UIDs are uint32
- **Random channel**: `channel-${Date.now()}-${random}` — unique per session
- **Expiration**: 3600s (1 hour). For longer sessions, implement token refresh.

```ts
// app/api/generate-agora-token/route.ts
import { RtcTokenBuilder, RtcRole } from "agora-token";

const token = RtcTokenBuilder.buildTokenWithRtm(
  APP_ID, APP_CERTIFICATE, channelName,
  String(uid), RtcRole.PUBLISHER,
  3600, // token expiration
  3600  // privilege expiration
);
```

## Agent Token (server-side only)

When inviting an AI agent, the server generates a separate token for the agent:

```ts
// Agent UID = 0 (let Agora assign)
const agentToken = advanced_features?.enable_rtm
  ? RtcTokenBuilder.buildTokenWithRtm(APP_ID, APP_CERTIFICATE, channel, "0", ...)
  : RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, channel, 0, ...);
```

This token is included in the invite payload and never sent to the client.

## Token Refresh

For sessions longer than the token expiration:

```ts
// Listen for the token-privilege-will-expire event
rtcClient.on("token-privilege-will-expire", async () => {
  const { token } = await fetch("/api/generate-agora-token?channel=X&uid=Y").then(r => r.json());
  await rtcClient.renewToken(token);
});
```

## Security Checklist

- App Certificate is NEVER in client code or `NEXT_PUBLIC_` vars
- Token route is a server API route (not a client function)
- Agent token is generated server-side in the invite route
- Tokens expire (1 hour default) — implement refresh for long sessions
