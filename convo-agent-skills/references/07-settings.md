# 07 — Settings & Persistence
<!-- @version 1.1.0 -->

## AgentSettings Interface

The complete settings shape that feeds into the agent invite/update:

```ts
interface AgentSettings {
  name: string;
  idle_timeout?: number;
  enable_turn_detection?: boolean;

  llm: {
    url: string;
    api_key?: string;            // "__USE_SERVER__" sentinel for server injection
    system_messages?: Array<{ role: string; content: string }>;
    greeting_message?: string;
    failure_message?: string;
    max_history?: number;
    style?: string;
    params?: Record<string, unknown>;
    input_modalities?: ("text" | "image")[];
    template_variables?: Record<string, string>;
    mcp_servers?: MCPServerConfig[];
  };

  tts: {
    vendor: string;              // "microsoft" | "elevenlabs" | "openai" | etc.
    params: Record<string, unknown>;
  };

  asr?: {
    vendor?: string;             // "ares" | "deepgram" | "microsoft" | etc.
    language?: string;
    params?: Record<string, unknown>;
  };

  turn_detection?: TurnDetectionConfig;
  filler_words?: FillerWordsConfig;
  sal?: SalConfig;
  advanced_features?: {
    enable_rtm?: boolean;
    enable_sal?: boolean;
    enable_tools?: boolean;
    enable_mllm?: boolean;
  };
  parameters?: {
    data_channel?: "rtm" | "datastream";
    enable_farewell?: boolean;
    farewell_phrases?: string[];
  };
  avatar?: AvatarConfig;
}
```

## Vendor Presets

Provide dropdown presets so users can quickly select a vendor:

```ts
const LLM_PRESETS = [
  { name: "OpenAI GPT-4o-mini", url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
  { name: "OpenAI GPT-4o", url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o" },
  { name: "Anthropic Claude", url: "https://api.anthropic.com/v1/messages", model: "claude-sonnet-4-20250514" },
  // Add more as needed
];

const TTS_PRESETS = [
  { name: "Microsoft Azure", vendor: "microsoft" },
  { name: "ElevenLabs", vendor: "elevenlabs" },
  { name: "OpenAI TTS", vendor: "openai" },
];

const ASR_PRESETS = [
  { name: "Agora ARES (built-in)", vendor: "ares" },
  { name: "Deepgram", vendor: "deepgram" },
  { name: "Microsoft", vendor: "microsoft" },
];
```

## Settings Modal Layout

Ensure the settings modal has adequate padding and overflow handling to prevent label clipping:

```tsx
import { X } from "lucide-react";

{/* Settings modal wrapper */}
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
  <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
    {/* Header with close button */}
    <div className="flex items-center justify-between p-4 border-b border-gray-700">
      <h2 className="text-lg font-semibold text-white">Settings</h2>
      <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
    </div>

    {/* Tab bar — overflow-x-auto prevents tab labels from clipping on narrow viewports */}
    <div className="flex border-b border-gray-700 overflow-x-auto">
      {tabs.map(tab => (
        <button key={tab} className="px-4 py-2 text-sm whitespace-nowrap ...">{tab}</button>
      ))}
    </div>

    {/* Content area — p-6 ensures labels are not clipped on left edge */}
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Tab content */}
    </div>
  </div>
</div>
```

**Toggle rows** — use `min-w-0` on labels and `flex-shrink-0` on toggles to prevent label collapse:

```tsx
<div className="flex items-center justify-between">
  <label className="text-sm text-gray-300 min-w-0">Enable Avatar</label>
  <button className="flex-shrink-0 w-10 h-6 rounded-full ..." />
</div>
```

## Settings UI Pattern

Tabbed sidebar with sections. **Recommended tab structure**: Voice, LLM, TTS, ASR, Avatar, Advanced.

### Voice Tab
Include `MicrophoneSelector` component for device selection (see `02-rtc-voice`).

### LLM Tab
- **Provider preset dropdown** (OpenAI, Anthropic, Custom)
- API Key: `"Leave blank to use server key (LLM_API_KEY in .env)"`
- API URL, Model (auto-filled from preset)
- System Prompt (textarea), Greeting Message, Failure Message
- Max History (number input)

### TTS Tab — Vendor-Specific Fields
Show different fields based on selected vendor:

| Vendor | Fields |
|--------|--------|
| Microsoft | API Key, Region, Voice Name (dropdown), Speed, Volume |
| ElevenLabs | API Key, Voice ID (dropdown + custom), Model ID, Sample Rate, Speed |
| OpenAI TTS | API Key, Model, Voice (dropdown), Speed |

**Default recommendation**: ElevenLabs for conversational AI quality.

### ASR Tab — Vendor-Specific Fields

| Vendor | Fields |
|--------|--------|
| ARES (built-in) | Language only (no key required) |
| Deepgram | API Key, WebSocket URL, Model, Language |
| Microsoft | API Key, Region, Language |

### Avatar Tab
- Enable Avatar toggle
- Vendor dropdown (HeyGen, Akool, Anam)
- API Key per vendor
- Avatar ID/selection per vendor
- **TTS requirement warnings**:
  - HeyGen/Anam: Requires 24kHz sample rate (ElevenLabs or OpenAI TTS)
  - Akool: Requires 16kHz sample rate (Microsoft Azure TTS)

### Advanced Tab
- RTM enable/disable toggle
- Idle timeout

### Server Key Fallback UX
All API key fields should show: `"Leave blank to use server key (ENV_VAR_NAME in .env)"`

```tsx
<input
  placeholder="Leave blank to use server key"
  value={draft.llm.api_key}
  onChange={...}
/>
<span className="text-xs text-gray-500">
  Server key: LLM_API_KEY in .env
</span>
```

## IndexedDB Persistence

Persist settings across sessions using IndexedDB. Mask API keys before storage:

```ts
// src/services/settingsDb.ts
const DB_NAME = "convo-settings";
const STORE_NAME = "settings";

const maskKey = (key: string) =>
  key && key !== "__USE_SERVER__" ? "***MASKED***" : key;

export const setAgentSettings = async (settings: AgentSettings) => {
  const masked = { ...settings };
  if (masked.llm?.api_key) masked.llm.api_key = maskKey(masked.llm.api_key);
  // Mask TTS/ASR keys similarly
  // Store in IndexedDB
};

export const getAgentSettings = async (): Promise<AgentSettings | null> => {
  // Read from IndexedDB
};
```

## MCP Server Configuration

```ts
interface MCPServerConfig {
  name: string;
  endpoint: string;
  transport?: "sse" | "streamable-http";
  headers?: Record<string, string>;
  queries?: Record<string, string>;
  allowed_tools?: string[];
  enabled?: boolean;
}
```

## Settings Flow

1. **Load**: Read from IndexedDB on mount → populate draft state
2. **Edit**: User changes values in UI → updates draft (not store)
3. **Apply**: User clicks Apply → write to Zustand store + persist to IndexedDB
4. **Invite/Update**: Agent API reads from Zustand store

## Store Integration

```ts
// Derive transcript mode from settings
setAgentSettings: (settings) => {
  const mode = settings?.advanced_features?.enable_rtm === false ? "rtc" : "rtm";
  set({ agentSettings: settings, transcriptionMode: mode });
},
```

## Verification

1. Change LLM model → Apply → invite agent → agent uses new model
2. Refresh page → settings persist from IndexedDB
3. API keys show as "***MASKED***" in IndexedDB (inspect in DevTools)
