// @version 1.1.0
// src/store/useAppStore.ts
// Zustand store for voice agent app. Includes call, media, agent, transcript,
// avatar, host controls, settings, and device selection slices.

import { create } from "zustand";
import type { ILocalAudioTrack, ILocalVideoTrack, IRemoteVideoTrack, IRemoteAudioTrack } from "agora-rtc-sdk-ng";

// --- Types (define in src/types/agora.ts for real projects) ---
interface TranscriptItem {
  turn_id: string;
  role: "user" | "assistant";
  text: string;
  is_final: boolean;
  timestamp: number;
}

interface RemoteParticipant {
  uid: string;
  name?: string;
  micMuted?: boolean;
  videoMuted?: boolean;
}

interface PendingUnmuteRequest {
  fromUid: string;
  fromName: string;
  mediaType: "audio" | "video" | "both";
  timestamp: number;
}

// Agent settings — extend with vendor-specific fields as needed
interface AgentSettings {
  name: string;
  idle_timeout?: number;
  llm: {
    url: string;
    api_key?: string;
    style?: string;
    system_messages?: Array<{ role: string; content: string }>;
    greeting_message?: string;
    failure_message?: string;
    max_history?: number;
    params?: Record<string, unknown>;
    input_modalities?: string[];
    mcp_servers?: Array<{
      name: string;
      endpoint: string;
      transport?: string;
      headers?: Record<string, string>;
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
    enable_tools?: boolean;
  };
  parameters?: {
    data_channel?: string;
    enable_farewell?: boolean;
    farewell_phrases?: string[];
  };
  avatar?: {
    enable: boolean;
    vendor: string;
    params: Record<string, unknown>;
  };
}

type TranscriptionMode = "rtc" | "rtm";
type TranscriptRenderMode = "TEXT" | "WORD" | "AUTO";

// Default settings — ElevenLabs TTS, ARES ASR (no key needed), RTM enabled
const defaultAgentSettings: AgentSettings = {
  name: "voice-agent",
  idle_timeout: 30,
  llm: {
    url: "https://api.openai.com/v1/chat/completions",
    api_key: "", // Leave blank to use server key (LLM_API_KEY in .env)
    style: "openai",
    system_messages: [{ role: "system", content: "You are a helpful AI assistant. Be concise and friendly." }],
    greeting_message: "Hello {{username}}, how can I help you today?",
    failure_message: "I'm sorry, I didn't catch that. Could you please repeat?",
    max_history: 10,
    params: { model: "gpt-4o-mini" },
    input_modalities: ["text"],
  },
  tts: {
    vendor: "elevenlabs",
    params: {
      key: "", // Leave blank to use server key (ELEVENLABS_API_KEY in .env)
      voice_id: "21m00Tcm4TlvDq8ikWAM", // Rachel
      model_id: "eleven_flash_v2_5",
      sample_rate: 24000,
      speed: 1.0,
    },
  },
  asr: {
    vendor: "ares", // Built-in, no key required
    language: "en-US",
  },
  advanced_features: {
    enable_rtm: true,
    enable_tools: false,
  },
  parameters: {
    data_channel: "rtm",
  },
  avatar: {
    enable: false,
    vendor: "anam",
    params: { api_key: "", avatar_id: "" },
  },
};

interface AppState {
  // --- Call State ---
  callActive: boolean;
  localUID: string | null;
  localUsername: string;
  channelId: string;
  callToken: string | null;
  isHost: boolean;

  // --- Media ---
  audioMuted: boolean;
  videoMuted: boolean;
  localAudioTrack: ILocalAudioTrack | null;
  localVideoTrack: ILocalVideoTrack | null;

  // --- Remote Participants ---
  remoteParticipants: Record<string, RemoteParticipant>;

  // --- Agent ---
  agentId: string | null;
  isAgentActive: boolean;
  isAgentLoading: boolean;
  agentRtcUid: string | null;
  agentAvatarRtcUid: string | null;
  agentSettings: AgentSettings;
  agentStatus: "silent" | "listening" | "thinking" | "speaking";

  // --- Avatar ---
  avatarVideoTrack: IRemoteVideoTrack | null;
  avatarAudioTrack: IRemoteAudioTrack | null;

  // --- Transcript ---
  transcriptItems: TranscriptItem[];
  currentInProgressMessage: TranscriptItem | null;
  transcriptionMode: TranscriptionMode;
  transcriptRenderMode: TranscriptRenderMode;

  // --- Host Controls ---
  pendingUnmuteRequest: PendingUnmuteRequest | null;

  // --- Settings UI ---
  isSettingsOpen: boolean;

  // --- Device Selection ---
  selectedMicrophoneId: string | null;

  // --- Actions ---
  callStart: (payload: { userName: string; uid: string; channelId: string; token: string; isHost?: boolean }) => void;
  callEnd: () => void;
  toggleAudioMute: () => void;
  toggleVideoMute: () => void;
  setLocalTracks: (audio: ILocalAudioTrack | null, video: ILocalVideoTrack | null) => void;
  updateRemoteParticipant: (participant: RemoteParticipant) => void;
  removeRemoteParticipant: (uid: string) => void;
  setAgentActive: (agentId: string, agentRtcUid?: string, avatarRtcUid?: string) => void;
  setAgentLoading: (loading: boolean) => void;
  clearAgent: () => void;
  setAgentSettings: (settings: AgentSettings) => void;
  setAgentStatus: (status: "silent" | "listening" | "thinking" | "speaking") => void;
  setAvatarTracks: (video: IRemoteVideoTrack | null, audio: IRemoteAudioTrack | null) => void;
  addTranscriptItem: (item: TranscriptItem) => void;
  setTranscriptItems: (items: TranscriptItem[]) => void;
  setCurrentInProgressMessage: (item: TranscriptItem | null) => void;
  clearTranscript: () => void;
  setTranscriptionMode: (mode: TranscriptionMode) => void;
  setPendingUnmuteRequest: (request: PendingUnmuteRequest | null) => void;
  clearPendingUnmuteRequest: () => void;
  toggleSettings: () => void;
  setSettingsOpen: (open: boolean) => void;
  setSelectedMicrophoneId: (deviceId: string | null) => void;
}

const useAppStore = create<AppState>((set) => ({
  // --- Initial State ---
  callActive: false,
  localUID: null,
  localUsername: "",
  channelId: "",
  callToken: null,
  isHost: false,

  audioMuted: false,
  videoMuted: false, // Camera ON by default for video-enabled apps
  localAudioTrack: null,
  localVideoTrack: null,

  remoteParticipants: {},

  agentId: null,
  isAgentActive: false,
  isAgentLoading: false,
  agentRtcUid: null,
  agentAvatarRtcUid: null,
  agentSettings: defaultAgentSettings,
  agentStatus: "silent",

  avatarVideoTrack: null,
  avatarAudioTrack: null,

  transcriptItems: [],
  currentInProgressMessage: null,
  transcriptionMode: "rtm",
  transcriptRenderMode: "TEXT",

  pendingUnmuteRequest: null,
  isSettingsOpen: false,
  selectedMicrophoneId: null,

  // --- Actions ---
  callStart: (payload) =>
    set({
      callActive: true,
      localUsername: payload.userName,
      localUID: payload.uid,
      channelId: payload.channelId,
      callToken: payload.token,
      isHost: payload.isHost ?? false,
    }),

  callEnd: () =>
    set({
      callActive: false,
      localUID: null,
      localUsername: "",
      channelId: "",
      callToken: null,
      isHost: false,
      agentId: null,
      isAgentActive: false,
      isAgentLoading: false,
      agentRtcUid: null,
      agentAvatarRtcUid: null,
      agentStatus: "silent",
      avatarVideoTrack: null,
      avatarAudioTrack: null,
      transcriptItems: [],
      currentInProgressMessage: null,
      remoteParticipants: {},
      pendingUnmuteRequest: null,
    }),

  toggleAudioMute: () => set((s) => ({ audioMuted: !s.audioMuted })),
  toggleVideoMute: () => set((s) => ({ videoMuted: !s.videoMuted })),
  setLocalTracks: (audio, video) => set({ localAudioTrack: audio, localVideoTrack: video }),

  updateRemoteParticipant: (participant) =>
    set((s) => ({
      remoteParticipants: {
        ...s.remoteParticipants,
        [participant.uid]: { ...s.remoteParticipants[participant.uid], ...participant },
      },
    })),
  removeRemoteParticipant: (uid) =>
    set((s) => {
      const { [uid]: _, ...rest } = s.remoteParticipants;
      void _;
      return { remoteParticipants: rest };
    }),

  setAgentActive: (agentId, agentRtcUid, avatarRtcUid) =>
    set({
      agentId,
      agentRtcUid: agentRtcUid ?? null,
      agentAvatarRtcUid: avatarRtcUid ?? null,
      isAgentActive: true,
      isAgentLoading: false,
    }),
  setAgentLoading: (loading) => set({ isAgentLoading: loading }),
  clearAgent: () =>
    set({
      agentId: null,
      isAgentActive: false,
      isAgentLoading: false,
      agentRtcUid: null,
      agentAvatarRtcUid: null,
      agentStatus: "silent",
      avatarVideoTrack: null,
      avatarAudioTrack: null,
    }),
  setAgentSettings: (settings) => {
    const mode = settings?.advanced_features?.enable_rtm === false ? "rtc" : "rtm";
    set({ agentSettings: settings, transcriptionMode: mode });
  },
  setAgentStatus: (status) => set({ agentStatus: status }),

  setAvatarTracks: (video, audio) => set({ avatarVideoTrack: video, avatarAudioTrack: audio }),

  addTranscriptItem: (item) => set((s) => ({ transcriptItems: [...s.transcriptItems, item] })),
  setTranscriptItems: (items) => set({ transcriptItems: items }),
  setCurrentInProgressMessage: (item) => set({ currentInProgressMessage: item }),
  clearTranscript: () => set({ transcriptItems: [], currentInProgressMessage: null }),
  setTranscriptionMode: (mode) => set({ transcriptionMode: mode }),

  setPendingUnmuteRequest: (request) => set({ pendingUnmuteRequest: request }),
  clearPendingUnmuteRequest: () => set({ pendingUnmuteRequest: null }),

  toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen })),
  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  setSelectedMicrophoneId: (deviceId) => set({ selectedMicrophoneId: deviceId }),
}));

export default useAppStore;
