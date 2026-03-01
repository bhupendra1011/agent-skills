# 06 — Transcript & Streaming
<!-- @version 1.1.0 -->

Live transcript shows what the user says (ASR) and what the agent says (LLM response) in real time.

## Delivery Modes

| Mode | Config | Transport | Chat support |
|------|--------|-----------|--------------|
| RTC datastream | `data_channel: "datastream"` | RTC `stream-message` event | No (text only) |
| RTM | `data_channel: "rtm"`, `enable_rtm: true` | RTM channel messages | Yes (text + image) |

The mode is set in the agent invite payload under `parameters.data_channel` and `advanced_features.enable_rtm`.

## ConversationalAIAPI Pattern

A singleton class that subscribes to transcript events from either RTC or RTM:

```ts
class ConversationalAIAPI {
  private static _instance: ConversationalAIAPI;

  static init(options: { rtcClient: IAgoraRTCClient; rtmClient?: RTMClient; agentRtcUid: string }) {
    if (!this._instance) this._instance = new ConversationalAIAPI();
    this._instance.setup(options);
    return this._instance;
  }

  static getInstance() { return this._instance; }

  subscribeMessage(mode: "rtm" | "rtc") {
    if (mode === "rtc") {
      // Listen for RTC stream-message events (chunked base64)
      this.rtcClient.on("stream-message", this.handleStreamMessage);
    }
    // RTM messages are received via RTM event listener (already set up)
  }
}
```

## Message Types

| Type | Direction | Content |
|------|-----------|---------|
| `user.transcription` | User → ASR | What the user said |
| `assistant.transcription` | Agent → User | Agent's response text |
| `message.interrupt` | System | User interrupted the agent |
| `message.error` | System | Agent error (LLM/TTS/ASR failure) |
| `message.metrics` | System | Latency metrics (log only) |
| `conversation.agent.state_changed` | System | Agent status (listening/thinking/speaking) |

## CRITICAL: Transcript Field Names

User and agent transcripts use **DIFFERENT** field names for finality:

| Field | `user.transcription` | `assistant.transcription` |
|-------|---------------------|--------------------------|
| Finality | `final: boolean` | `turn_status: number` |
| Values | `true` = final | `0` = in-progress, `1` = end, `2` = interrupted |

Both share: `object`, `turn_id` (number), `text`

**WARNING**: Do NOT use `is_final` — Agora uses `final` for user and `turn_status` for agent.

```ts
const isFinal = isUser
  ? data.final === true
  : (data.turn_status === 1 || data.turn_status === 2);
```

## Turn Deduplication

Use a module-scoped `addedTurnIds: Set<string>` to prevent adding the same turn twice (Agora may send multiple final messages for the same turn):

```ts
const addedTurnIds = new Set<string>();  // module-scoped

// In processTranscriptMessage:
const turnIdStr = `${role}-${data.turn_id}`;
if (isFinal && !addedTurnIds.has(turnIdStr)) {
  addedTurnIds.add(turnIdStr);
  store.addTranscriptItem(item);
}
```

## Separate Turn Tracking

Track user and agent turns **separately** to prevent overwriting in-progress messages:

```ts
let currentUserTurnId: number | null = null;   // module-scoped
let currentAgentTurnId: number | null = null;   // module-scoped
```

Do NOT use a shared `currentTurnId` — agent messages would overwrite the user's in-progress state.

## RTC Datastream Format

Messages arrive chunked as: `id|idx|total|base64_payload`

**IMPORTANT**: Chunk indexing is **1-based** (Agora sends 1/3, 2/3, 3/3), NOT 0-based.

Use a Map-based cache with timeout cleanup:

```ts
const chunkCache = new Map<string, { chunks: Map<number, string>; total: number; lastSeen: number }>();

// Single-chunk messages: parse directly (no "|" separator)
if (!message.includes("|")) {
  try { processTranscriptMessage(JSON.parse(message), store); } catch {}
  return;
}

// Multi-chunk: id|idx|total|base64_payload
const [id, idxStr, totalStr, base64Payload] = message.split("|");
const chunkIndex = Number(idxStr);
const totalChunks = Number(totalStr);
const cacheKey = `${uid}-${id}`;

let cache = chunkCache.get(cacheKey);
if (!cache) {
  cache = { chunks: new Map(), total: totalChunks, lastSeen: Date.now() };
  chunkCache.set(cacheKey, cache);
}
cache.chunks.set(chunkIndex, base64Payload); // 1-based key
cache.lastSeen = Date.now();

if (cache.chunks.size === totalChunks) {
  const decodedChunks: string[] = [];
  for (let i = 1; i <= totalChunks; i++) {  // 1-based loop
    decodedChunks.push(atob(cache.chunks.get(i)!));
  }
  const fullMessage = JSON.parse(decodedChunks.join(""));
  processTranscriptMessage(fullMessage, store);
  chunkCache.delete(cacheKey);
}

// Cleanup stale chunks (every 5s, remove entries older than 10s)
```

## Render Modes

| Mode | Behavior |
|------|----------|
| TEXT | Full sentence blocks — wait for `is_final: true` |
| WORD | Word-by-word rendering with timing data |
| AUTO | Uses WORD when timing data is available, falls back to TEXT |

## useConversationalAI Hook

```ts
const useConversationalAI = (channelId: string, agentRtcUid: string | null) => {
  const { rtcClient, rtmClient } = useAgora();
  const transcriptionMode = useAppStore(s => s.transcriptionMode);
  const setTranscriptItems = useAppStore(s => s.setTranscriptItems);
  const setCurrentInProgressMessage = useAppStore(s => s.setCurrentInProgressMessage);

  useEffect(() => {
    if (!agentRtcUid || !channelId) return;

    const api = ConversationalAIAPI.init({ rtcClient, rtmClient, agentRtcUid });
    api.subscribeMessage(transcriptionMode);

    api.on("TRANSCRIPT_UPDATED", ({ items, inProgress }) => {
      setTranscriptItems(items);
      setCurrentInProgressMessage(inProgress);
    });

    return () => { api.unsubscribe(); };
  }, [agentRtcUid, channelId, transcriptionMode]);
};
```

## Store Slices

```ts
transcriptItems: ITranscriptHelperItem[];        // completed messages
currentInProgressMessage: ITranscriptHelperItem | null; // typing indicator
transcriptionMode: "rtc" | "rtm";
transcriptRenderMode: ETranscriptRenderMode;      // TEXT | WORD | AUTO
userSentMessages: { text?: string; imageUrl?: string; _time: number }[];
```

## TranscriptSidePanel Component

**Layout**: Always visible — use `w-80 flex-shrink-0`, NOT `hidden lg:block` which hides on mobile.

```tsx
const TranscriptSidePanel: React.FC = () => {
  const items = useAppStore(s => s.transcriptItems);
  const inProgress = useAppStore(s => s.currentInProgressMessage);
  const isRtmEnabled = useAppStore(s => s.agentSettings.advanced_features?.enable_rtm);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: "smooth" });
  }, [items, inProgress]);

  return (
    <div className="w-80 flex-shrink-0 flex flex-col h-full">
      {/* RTM disabled warning */}
      {!isRtmEnabled && (
        <div className="text-xs text-yellow-400 p-2">
          RTM disabled — live transcript not available. Enable RTM in Settings.
        </div>
      )}

      <div ref={containerRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {items.map(item => (
          <div key={item.turn_id} className={item.role === "user" ? "text-right" : "text-left"}>
            <span className="text-xs text-gray-500">{item.role}</span>
            <p className={item.role === "user" ? "text-cyan-400" : "text-gray-300"}>
              {item.text}
            </p>
          </div>
        ))}
        {inProgress && <p className="text-gray-400 italic">{inProgress.text}...</p>}
      </div>

      {/* Chat input at bottom — see 04-rtm-messaging for sendChatMessage */}
      <ChatInput />
    </div>
  );
};
```

## Chat Input Component

```tsx
import { Send } from "lucide-react";

const ChatInput: React.FC = () => {
  const [message, setMessage] = useState("");
  const { sendChatMessage } = useAgora();
  const isAgentActive = useAppStore(s => s.isAgentActive);

  const handleSend = async () => {
    if (!message.trim() || !isAgentActive) return;
    await sendChatMessage(message.trim());
    setMessage("");
  };

  return (
    <div className="flex items-center gap-2 p-2 border-t border-gray-700">
      <input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSend()}
        placeholder={isAgentActive ? "Type a message..." : "Start agent to chat"}
        disabled={!isAgentActive}
        className="flex-1 bg-gray-800 text-white rounded px-3 py-2 text-sm"
      />
      <button onClick={handleSend} disabled={!isAgentActive || !message.trim()}>
        <Send className="w-5 h-5 text-cyan-400" />
      </button>
    </div>
  );
};
```

## Agent Status (Conditional)

Only show listening/thinking/speaking status when RTM is enabled. When RTM is off, show generic "Active":

```tsx
if (!isRtmEnabled) {
  return { text: "Active", color: "text-green-400" };
}
// Otherwise map agentStatus to display...
```

## Verification

1. Invite agent → speak → see your words appear as transcript
2. Agent responds → see agent's response in transcript
3. Switch render mode → TEXT shows full blocks, WORD shows word-by-word
4. (RTM mode) Type a chat message → agent responds to it
