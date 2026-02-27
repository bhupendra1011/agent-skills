// src/types/agora.ts
// Core TypeScript types for Agora Conversational AI Agent.
// Copy this file to src/types/agora.ts in your project.

import type { ILocalAudioTrack, ILocalVideoTrack } from "agora-rtc-sdk-ng";

// ============================================
// LLM CONFIGURATION
// ============================================

export type LLMVendor =
  | "openai"
  | "azure_openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "coze"
  | "dify"
  | "minimax"
  | "custom";

export type MCPTransport = "sse" | "http" | "streamable_http";

export interface MCPServerConfig {
  name: string;
  endpoint: string;
  transport?: MCPTransport;
  headers?: Record<string, string>;
  queries?: Record<string, string>;
  timeout_ms?: number;
  allowed_tools?: string[];
  enabled?: boolean;
}

export interface LLMConfig {
  url: string;
  api_key: string;
  /** Custom headers as JSON string (e.g., Anthropic requires '{"anthropic-version":"2023-06-01"}') */
  headers?: string;
  system_messages?: Array<{ role: string; content: string }>;
  greeting_message?: string;
  failure_message?: string;
  max_history?: number;
  /** "openai" or "anthropic" — must match vendor */
  style?: "openai" | "anthropic";
  params?: {
    model: string;
    max_tokens?: number;
    temperature?: number;
    [key: string]: unknown;
  };
  mcp_servers?: MCPServerConfig[];
  /** Default: ["text", "image"] */
  input_modalities?: ("text" | "image")[];
  template_variables?: Record<string, string>;
}

// ============================================
// TTS CONFIGURATION
// ============================================

export type TTSVendor =
  | "microsoft"
  | "elevenlabs"
  | "minimax"
  | "cartesia"
  | "openai"
  | "fish_audio"
  | "google"
  | "polly";

export interface TTSMicrosoftParams {
  key: string;
  region: string;
  voice_name: string;
  speed?: number;
  volume?: number;
  sample_rate?: number;
}

export interface TTSElevenLabsParams {
  base_url?: string;
  key: string;
  model_id: string;
  voice_id: string;
  sample_rate?: number;
  speed?: number;
  stability?: number;
  similarity_boost?: number;
}

export interface TTSOpenAIParams {
  key: string;
  model: string;
  voice: string;
  speed?: number;
}

export interface TTSConfig {
  vendor: TTSVendor;
  params: TTSMicrosoftParams | TTSElevenLabsParams | TTSOpenAIParams | Record<string, unknown>;
}

// ============================================
// ASR CONFIGURATION
// ============================================

export type ASRVendor =
  | "ares"
  | "microsoft"
  | "deepgram"
  | "openai"
  | "google"
  | "speechmatics"
  | "assemblyai"
  | "transcribe";

export interface ASRConfig {
  vendor?: ASRVendor;
  language?: string;
  params?: Record<string, unknown>;
}

// ============================================
// TURN DETECTION
// ============================================

export interface TurnDetectionConfig {
  mode?: "default";
  config?: {
    speech_threshold?: number;
    start_of_speech?: {
      mode: "vad" | "keywords" | "disabled";
      vad_config?: {
        interrupt_duration_ms?: number;
        speaking_interrupt_duration_ms?: number;
        prefix_padding_ms?: number;
      };
    };
    end_of_speech?: {
      mode: "vad" | "semantic";
      vad_config?: { silence_duration_ms?: number };
      semantic_config?: { silence_duration_ms?: number; max_wait_ms?: number };
    };
  };
}

// ============================================
// FILLER WORDS
// ============================================

export interface FillerWordsConfig {
  enable?: boolean;
  trigger?: {
    mode: "fixed_time";
    fixed_time_config?: { response_wait_ms?: number };
  };
  content?: {
    mode: "static";
    static_config?: {
      phrases?: string[];
      selection_rule?: "shuffle" | "round_robin";
    };
  };
}

// ============================================
// SAL (Selective Attention Locking)
// ============================================

export interface SalConfig {
  sal_mode?: "locking" | "recognition";
  sample_urls?: Record<string, string>;
}

// ============================================
// ADVANCED FEATURES & PARAMETERS
// ============================================

export interface AdvancedFeaturesConfig {
  enable_rtm?: boolean;
  enable_sal?: boolean;
  enable_tools?: boolean;
  enable_mllm?: boolean;
}

export interface AgentParametersConfig {
  enable_farewell?: boolean;
  farewell_phrases?: string[];
  /** "rtc" for RTC datastream, "rtm" for RTM signaling */
  data_channel?: "rtc" | "rtm";
}

// ============================================
// AVATAR
// ============================================

export type AvatarVendor = "akool" | "heygen" | "anam";

export interface AvatarConfig {
  enable: boolean;
  vendor: AvatarVendor;
  params: Record<string, unknown>;
}

// ============================================
// AGENT SETTINGS (full interface for UI + API)
// ============================================

export interface AgentSettings {
  name: string;
  llm: LLMConfig;
  tts: TTSConfig;
  asr?: ASRConfig;
  idle_timeout?: number;
  enable_turn_detection?: boolean;
  turn_detection?: TurnDetectionConfig;
  filler_words?: FillerWordsConfig;
  sal?: SalConfig;
  advanced_features?: AdvancedFeaturesConfig;
  parameters?: AgentParametersConfig;
  avatar?: AvatarConfig;
}

// ============================================
// AGENT QUERY STATUS (REST API response)
// ============================================

export type AgentOperationalStatus =
  | "IDLE"
  | "STARTING"
  | "RUNNING"
  | "STOPPING"
  | "STOPPED"
  | "RECOVERING"
  | "FAILED";

export interface AgentQueryStatus {
  message: string;
  start_ts: number;
  stop_ts: number;
  status: AgentOperationalStatus;
  agent_id: string;
}

// ============================================
// AGENT STATE & TRANSCRIPT
// ============================================

export enum EAgentState {
  IDLE = "idle",
  LISTENING = "listening",
  THINKING = "thinking",
  SPEAKING = "speaking",
  SILENT = "silent",
}

export enum ETurnStatus {
  IN_PROGRESS = 0,
  END = 1,
  INTERRUPTED = 2,
}

export enum ETranscriptRenderMode {
  TEXT = "text",
  WORD = "word",
  AUTO = "auto",
}

export interface ITranscriptHelperItem<T = unknown> {
  uid: string;
  stream_id: number;
  turn_id: number;
  _time: number;
  text: string;
  status: ETurnStatus;
  metadata: T | null;
}

export interface IUserTranscription {
  object: "user.transcription";
  text: string;
  start_ms: number;
  duration_ms: number;
  language: string;
  turn_id: number;
  stream_id: number;
  user_id: string;
  words: Array<{
    word: string;
    start_ms: number;
    duration_ms: number;
    stable: boolean;
  }> | null;
  final: boolean;
}

export interface IAgentTranscription {
  object: "assistant.transcription";
  text: string;
  start_ms: number;
  duration_ms: number;
  language: string;
  turn_id: number;
  stream_id: number;
  user_id: string;
  words: Array<{
    word: string;
    start_ms: number;
    duration_ms: number;
    stable: boolean;
  }> | null;
  quiet: boolean;
  turn_seq_id: number;
  turn_status: ETurnStatus;
}

// ============================================
// LOCAL TRACKS & PARTICIPANTS
// ============================================

export interface LocalAgoraTracks {
  audioTrack: ILocalAudioTrack | null;
  videoTrack: ILocalVideoTrack | null;
}

export interface Participant {
  name: string;
  micMuted: boolean;
  videoMuted: boolean;
}

// ============================================
// HOST CONTROLS (RTM User Channel)
// ============================================

export type HostControlMessageType = "host-mute-request" | "host-unmute-request";

export interface HostControlMessage {
  type: HostControlMessageType;
  fromUid: string;
  fromName: string;
  targetUid: string;
  mediaType: "audio" | "video" | "both";
  timestamp: number;
}

export interface PendingUnmuteRequest {
  fromUid: string;
  fromName: string;
  mediaType: "audio" | "video" | "both";
  timestamp: number;
}

// ============================================
// LLM VENDOR PRESETS (for settings UI)
// ============================================

export interface VendorPreset {
  label: string;
  value: string;
  url?: string;
  defaultModel?: string;
  models?: string[];
  requiresApiKey: boolean;
  style?: "openai" | "anthropic";
  headers?: string;
}

export const LLM_PRESETS: Record<LLMVendor, VendorPreset> = {
  openai: {
    label: "OpenAI",
    value: "openai",
    url: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    requiresApiKey: true,
    style: "openai",
  },
  azure_openai: {
    label: "Azure OpenAI",
    value: "azure_openai",
    url: "",
    defaultModel: "gpt-4o",
    requiresApiKey: true,
    style: "openai",
  },
  anthropic: {
    label: "Anthropic Claude",
    value: "anthropic",
    url: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-3-5-sonnet-latest",
    models: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"],
    requiresApiKey: true,
    style: "anthropic",
    headers: '{"anthropic-version":"2023-06-01"}',
  },
  gemini: {
    label: "Google Gemini",
    value: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    defaultModel: "gemini-2.0-flash",
    requiresApiKey: true,
    style: "openai",
  },
  groq: {
    label: "Groq",
    value: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "llama-3.3-70b-versatile",
    requiresApiKey: true,
    style: "openai",
  },
  coze: { label: "Coze", value: "coze", requiresApiKey: true, style: "openai" },
  dify: { label: "Dify", value: "dify", requiresApiKey: true, style: "openai" },
  minimax: { label: "MiniMax", value: "minimax", requiresApiKey: true, style: "openai" },
  custom: { label: "Custom (OpenAI-compatible)", value: "custom", requiresApiKey: false, style: "openai" },
};

export const TTS_PRESETS: Record<TTSVendor, VendorPreset & { voices?: string[] }> = {
  microsoft: {
    label: "Microsoft Azure",
    value: "microsoft",
    requiresApiKey: true,
    voices: ["en-US-AndrewMultilingualNeural", "en-US-JennyNeural", "en-US-GuyNeural"],
  },
  elevenlabs: {
    label: "ElevenLabs",
    value: "elevenlabs",
    requiresApiKey: true,
    defaultModel: "eleven_flash_v2_5",
    models: ["eleven_flash_v2_5", "eleven_multilingual_v2"],
  },
  openai: {
    label: "OpenAI TTS",
    value: "openai",
    requiresApiKey: true,
    defaultModel: "tts-1",
    voices: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
  },
  minimax: { label: "MiniMax", value: "minimax", requiresApiKey: true },
  cartesia: { label: "Cartesia", value: "cartesia", requiresApiKey: true },
  fish_audio: { label: "Fish Audio", value: "fish_audio", requiresApiKey: true },
  google: { label: "Google TTS", value: "google", requiresApiKey: true },
  polly: { label: "Amazon Polly", value: "polly", requiresApiKey: true },
};

export const ASR_PRESETS: Record<ASRVendor, VendorPreset> = {
  ares: { label: "Agora ARES (Built-in)", value: "ares", requiresApiKey: false },
  microsoft: { label: "Microsoft Azure", value: "microsoft", requiresApiKey: true },
  deepgram: {
    label: "Deepgram",
    value: "deepgram",
    requiresApiKey: true,
    defaultModel: "nova-3",
    models: ["nova-3", "nova-2"],
  },
  openai: { label: "OpenAI Whisper", value: "openai", requiresApiKey: true },
  google: { label: "Google", value: "google", requiresApiKey: true },
  speechmatics: { label: "Speechmatics", value: "speechmatics", requiresApiKey: true },
  assemblyai: { label: "AssemblyAI", value: "assemblyai", requiresApiKey: true },
  transcribe: { label: "Amazon Transcribe", value: "transcribe", requiresApiKey: true },
};
