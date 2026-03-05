# convo-agent-skills

A [Claude Code skill](https://skills.sh) for building real-time conversational AI applications using **Agora SDKs** and **Next.js**.

> Pair with [next-best-practices](https://skills.sh/vercel-labs/next-skills/next-best-practices) for full coverage — this skill handles Agora patterns, that skill handles Next.js conventions.

## Install

```bash
npx skills add YOUR_USERNAME/convo-agent-skills -g -y
```

Or install locally in a project:

```bash
npx skills add YOUR_USERNAME/convo-agent-skills -y
```

## What It Does

Tell Claude what you want to build and it asks the right questions first:

```
You: "Build me a voice agent with Agora"
Claude: What type of agent? Do you need subtitles? Avatar? Settings UI?
```

Then it loads **only the relevant guides** — not everything at once. A voice-only agent loads ~550 lines of context instead of ~3,500.

## Features Covered

| Feature | Reference | When loaded |
|---------|-----------|-------------|
| Env setup & project scaffold | `00-core-setup` | Always (first step) |
| Token generation (RTC+RTM) | `01-token-auth` | Always |
| Voice (audio-only RTC) | `02-rtc-voice` | Voice or video agent |
| Video (camera track) | `03-rtc-video` | Video agent only |
| RTM messaging & chat | `04-rtm-messaging` | Chat or RTM features |
| AI agent invite/stop/update | `05-agent-lifecycle` | Any agent |
| Live transcript / subtitles | `06-transcript` | When subtitles needed |
| Settings UI & persistence | `07-settings` | When settings UI needed |
| Avatar (HeyGen/Anam/Akool) | `08-avatar` | When avatar needed |
| MCP, SAL, filler words | `09-advanced` | Advanced features |

## Progressive Loading

The skill uses a **router architecture**:

- `SKILL.md` (~100 lines) is always loaded — contains discovery questions, dependency graph, and build order
- `references/*.md` (10 files) are loaded one-at-a-time via the Read tool as the user progresses
- `snippets/*.ts` (14 files) are copy-paste code extracted from a working production app

### Loading Paths

| Goal | References loaded |
|------|-------------------|
| Voice-only agent | 00 → 01 → 02 → 05 |
| Video + voice agent | 00 → 01 → 02 → 03 → 05 |
| Text chat with AI | 00 → 01 → 04 → 05 |
| Full-featured | 00 → 01 → 02 → 03 → 04 → 05 → 06 |

Add features incrementally: `+ transcript` → load 06, `+ avatar` → load 08, etc.

## Snippets Included

Ready-to-use code files extracted from a working Next.js + Agora app:

| File | What it is |
|------|-----------|
| `types-agora.ts` | `src/types/agora.ts` — All TypeScript interfaces, enums, vendor presets |
| `generate-token-route.ts` | `app/api/generate-agora-token/route.ts` — RTC+RTM combined token |
| `agent-invite-route.ts` | `app/api/agent/invite/route.ts` — invite AI agent with server key injection |
| `agent-stop-route.ts` | `app/api/agent/stop/route.ts` — stop running agent |
| `agent-update-route.ts` | `app/api/agent/update/route.ts` — update agent config at runtime |
| `agent-query-route.ts` | `app/api/agent/query/route.ts` — query agent operational status |
| `agentApi.ts` | `src/api/agentApi.ts` — client API layer for agent lifecycle |
| `agoraApi.ts` | `src/api/agoraApi.ts` — AGORA_CONFIG export |
| `uiService.ts` | `src/services/uiService.ts` — toast notification helper |
| `useAgora-minimal.ts` | Full RTC+RTM hook with module-scoped singletons |
| `useAppStore-minimal.ts` | Full Zustand store with all slices |
| `useConversationalAI.ts` | Transcript hook bridging ConversationalAIAPI and store |
| `conversational-ai-api.ts` | ConversationalAIAPI singleton for transcript subscription |
| `env-example.txt` | `.env.example` with all Agora/LLM/TTS/ASR/Avatar vars |

## Key Patterns

Patterns embedded in the skill that prevent common pitfalls:

- **Module-scoped singletons** — RTC/RTM clients and track refs live outside the hook function (not `useRef`), so all components share the same instance
- **Track lifecycle** — `getMediaStreamTrack().stop()` → `.stop()` → `.close()` guarantees hardware release (mic/camera indicator off)
- **Server key injection** — Client sends `"__USE_SERVER__"` sentinel; server replaces with env vars. API keys never reach the browser.
- **LLM vendor compatibility** — Anthropic requires `headers` and `style: "anthropic"` in invite payload; presets handle this automatically

## Tech Stack

Built for apps using:

- **Next.js 15** (App Router)
- **agora-rtc-sdk-ng** v4.x (WebRTC)
- **agora-rtm-sdk** v2.x (Real-time messaging)
- **agora-token** v2.x (Token generation)
- **Zustand** 5 (State management)
- **TailwindCSS** 4 (Styling)

## Reference App

This skill was built from the patterns in [My Agora App](https://github.com/AgoraIO-Community/my-agora-app) — a production conversational AI app with voice/video calls, AI agents, live transcript, avatars, and MCP tool calling.

## License

MIT
