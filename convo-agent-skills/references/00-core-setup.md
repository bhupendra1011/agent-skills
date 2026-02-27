# 00 — Core Setup

## Agora Console Setup

1. Go to [console.agora.io](https://console.agora.io) → Create a new project
2. In project settings, enable:
   - **Real-Time Messaging (RTM)** — for signaling and chat
   - **Conversational AI** — for AI agent
3. Get credentials:
   - **App ID** → `NEXT_PUBLIC_AGORA_APP_ID`
   - **App Certificate** → `AGORA_APP_CERTIFICATE`
   - **Customer ID** and **Customer Secret** (RESTful API section) → `AGORA_CUSTOMER_ID`, `AGORA_CUSTOMER_SECRET`

## Environment Variables

Copy `snippets/env-example.txt` to `.env`. The four Agora vars are required; everything else is optional.

| Variable | Required for | Where to get |
|----------|-------------|--------------|
| `NEXT_PUBLIC_AGORA_APP_ID` | Everything | Console → Project → App ID |
| `AGORA_APP_CERTIFICATE` | Token generation | Console → Project → App Certificate |
| `AGORA_CUSTOMER_ID` | Agent API auth | Console → RESTful API |
| `AGORA_CUSTOMER_SECRET` | Agent API auth | Console → RESTful API |
| `LLM_API_KEY` | AI agent (LLM) | Your LLM provider |
| `ELEVENLABS_API_KEY` | TTS (ElevenLabs) | elevenlabs.io |
| `MICROSOFT_TTS_KEY` | TTS (Microsoft) | Azure portal |
| `OPENAI_TTS_KEY` | TTS (OpenAI) | platform.openai.com |
| `DEEPGRAM_API_KEY` | ASR (Deepgram) | deepgram.com |
| `HEYGEN_API_KEY` | Avatar (HeyGen) | heygen.com |
| `AKOOL_API_KEY` | Avatar (Akool) | akool.com |
| `ANAM_API_KEY` | Avatar (Anam) | anam.ai |

**Security pattern**: `NEXT_PUBLIC_` vars are visible to the browser (safe for non-secrets like vendor names, model IDs). Server-only vars (no prefix) are never exposed to the client — the server injects them into API payloads at runtime.

## Project Scaffold

```bash
npx create-next-app@latest my-convo-app --ts --tailwind --app --src-dir
cd my-convo-app
npm install agora-rtc-sdk-ng agora-rtm-sdk agora-token zustand
```

## Recommended Folder Structure

```
app/
  api/
    generate-agora-token/route.ts    # Token endpoint
    agent/
      invite/route.ts                # Start AI agent
      stop/route.ts                  # Stop AI agent
      update/route.ts                # Update agent settings
      query/route.ts                 # Query agent status
  page.tsx                           # Landing page
  call/page.tsx                      # Call screen
src/
  api/
    agoraApi.ts                      # APP_ID export, base config
    agentApi.ts                      # inviteAgent, stopAgent, etc.
  hooks/
    useAgora.ts                      # RTC + RTM logic
    useConversationalAI.ts           # Transcript + chat (when needed)
  store/
    useAppStore.ts                   # Zustand global state
  types/
    agora.ts                         # TypeScript interfaces
  components/
    Controls.tsx                     # Mic/video/agent buttons
    VideoTile.tsx                    # Video player
    AgentTile.tsx                    # AI agent status tile
    TranscriptSidePanel.tsx          # Transcript display
  services/
    uiService.ts                     # showToast() helper
```

## Build Order

Implement in this order so dependencies are available:
1. `.env` from env-example
2. API routes (token → invite → stop)
3. API layer (`agoraApi.ts`, `agentApi.ts`)
4. Store (`useAppStore.ts`)
5. Hooks (`useAgora.ts`)
6. Pages (landing → call)
7. Components (Controls → VideoTile → AgentTile)

## Verification

- `npm run dev` starts without errors
- `.env` has at minimum the 4 Agora vars filled in
- `curl http://localhost:3000/api/generate-agora-token` returns `{ token, uid, channel }`
