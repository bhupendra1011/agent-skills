// @version 1.1.0
// src/hooks/useAgora.ts
// Voice + video hook with RTM transcript, chat, agent UID filtering, mic selection.
// Module-scoped singletons ensure shared state across all components that call useAgora().
"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import AgoraRTC from "agora-rtc-sdk-ng";
import type {
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ILocalAudioTrack,
  ILocalVideoTrack,
} from "agora-rtc-sdk-ng";
import useAppStore from "@/store/useAppStore";
import { showToast } from "@/services/uiService";

const APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID!;

// --- Module-scoped singletons (shared across ALL hook instances) ---
let RTC_CLIENT: IAgoraRTCClient | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RTM_CLIENT: any | null = null;
let currentRtmChannelName: string | null = null;

const getRtcClient = (): IAgoraRTCClient => {
  if (!RTC_CLIENT && typeof window !== "undefined") {
    RTC_CLIENT = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  }
  return RTC_CLIENT!;
};

// CRITICAL: Module-scoped track refs — NOT useRef inside hook.
// Multiple components call useAgora(). useRef would give each instance its own
// empty ref. Only the instance that called joinMeeting would have tracks.
const localTracksRef: {
  current: { audioTrack: ILocalAudioTrack | null; videoTrack: ILocalVideoTrack | null };
} = {
  current: { audioTrack: null, videoTrack: null },
};

// Track added turn_ids to prevent duplicates
const addedTurnIds = new Set<string>();
// Track messages sent via chat to prevent RTM echo duplicates
const recentlySentMessages = new Set<string>();

// Separate turn tracking for user and agent (NOT shared — prevents overwriting)
let currentUserTurnId: number | null = null;
let currentAgentTurnId: number | null = null;

// --- Module-scoped transcript processor ---
// Handles both user.transcription (uses `final`) and assistant.transcription (uses `turn_status`)
function processTranscriptMessage(
  data: {
    object?: string;
    turn_id?: number;
    text?: string;
    final?: boolean; // user transcription uses 'final'
    turn_status?: number; // agent uses turn_status: 0=in_progress, 1=end, 2=interrupted
    quiet?: boolean;
  },
  store: ReturnType<typeof useAppStore.getState>
) {
  if (!data.object || data.turn_id === undefined) return;

  const isUser = data.object === "user.transcription";
  const isAgent = data.object === "assistant.transcription";
  if (!isUser && !isAgent) return;

  // IMPORTANT: Different field names per message type
  const isFinal = isUser
    ? data.final === true
    : (data.turn_status === 1 || data.turn_status === 2);

  const role = isUser ? "user" : "assistant";
  const turnIdStr = `${role}-${data.turn_id}`;

  const item = {
    turn_id: turnIdStr,
    role: role as "user" | "assistant",
    text: data.text || "",
    is_final: isFinal,
    timestamp: Date.now(),
  };

  if (isFinal) {
    // Skip echo of locally-sent chat messages
    if (isUser && recentlySentMessages.has(data.text || "")) {
      recentlySentMessages.delete(data.text || "");
      if (store.currentInProgressMessage?.turn_id === turnIdStr) {
        store.setCurrentInProgressMessage(null);
      }
      return;
    }
    // Deduplicate — only add if not already added
    if (!addedTurnIds.has(turnIdStr)) {
      addedTurnIds.add(turnIdStr);
      store.addTranscriptItem(item);
    }
    if (store.currentInProgressMessage?.turn_id === turnIdStr) {
      store.setCurrentInProgressMessage(null);
    }
    if (isUser) currentUserTurnId = null;
    else currentAgentTurnId = null;
  } else {
    if (isUser) currentUserTurnId = data.turn_id;
    else currentAgentTurnId = data.turn_id;
    store.setCurrentInProgressMessage(item);
  }
}

// --- Module-scoped agent status processor ---
function processAgentStatusEvent(
  data: { object?: string; state?: string },
  store: ReturnType<typeof useAppStore.getState>
) {
  const obj = data.object || "";
  if (obj === "conversation.agent.state_changed" || obj.startsWith("conversation.agent.")) {
    const state = data.state || obj.split(".").pop();
    switch (state) {
      case "speaking": store.setAgentStatus("speaking"); break;
      case "thinking": store.setAgentStatus("thinking"); break;
      case "listening": store.setAgentStatus("listening"); break;
      case "silent":
      case "idle": store.setAgentStatus("silent"); break;
    }
  } else if (obj === "conversation.user.speaking" || obj === "user.speech_started") {
    store.setAgentStatus("listening");
  } else if (obj === "agent.speaking" || obj === "agent.speech_started") {
    store.setAgentStatus("speaking");
  } else if (obj === "agent.thinking" || obj === "agent.processing") {
    store.setAgentStatus("thinking");
  }
}

// --- Module-scoped error processor ---
function processAgentErrorMessage(data: {
  object?: string;
  module?: string;
  code?: number;
  message?: string;
  turn_id?: number;
}) {
  const module = data.module || "unknown";
  const code = data.code || 0;
  const message = data.message || "Unknown error";

  console.error("[Agent Error]", { module, code, message, turn_id: data.turn_id });

  let userMessage = `Agent Error: ${message}`;
  if (module === "llm") {
    if (code === 401 || message.toLowerCase().includes("unauthorized")) {
      userMessage = "LLM API Key Error: Invalid or expired API key.";
    } else if (code === 429 || message.toLowerCase().includes("rate limit")) {
      userMessage = "LLM Rate Limit: Too many requests. Please wait.";
    } else {
      userMessage = `LLM Error (${code}): ${message}`;
    }
  } else if (module === "tts") {
    userMessage = `TTS Error (${code}): ${message}`;
  } else if (module === "asr") {
    userMessage = `ASR Error (${code}): ${message}`;
  }
  showToast(userMessage, "error");
}

export const useAgora = () => {
  const audioMuted = useAppStore((s) => s.audioMuted);
  const videoMuted = useAppStore((s) => s.videoMuted);
  const callEnd = useAppStore((s) => s.callEnd);
  const agentAvatarRtcUid = useAppStore((s) => s.agentAvatarRtcUid);
  const getStore = useAppStore;

  const [remoteUsers, setRemoteUsers] = useState<IAgoraRTCRemoteUser[]>([]);
  const remoteUsersRef = useRef<Record<string, IAgoraRTCRemoteUser>>({});

  // --- Avatar track polling (captures track if avatar publishes before UID is set) ---
  useEffect(() => {
    if (!agentAvatarRtcUid || !RTC_CLIENT) return;
    const checkAndCapture = () => {
      const user = RTC_CLIENT?.remoteUsers.find((u) => String(u.uid) === agentAvatarRtcUid);
      if (user?.videoTrack) {
        getStore.getState().setAvatarTracks(user.videoTrack, getStore.getState().avatarAudioTrack);
        return true;
      }
      return false;
    };
    if (checkAndCapture()) return;
    const interval = setInterval(() => { if (checkAndCapture()) clearInterval(interval); }, 500);
    const timeout = setTimeout(() => clearInterval(interval), 30000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [agentAvatarRtcUid, getStore]);

  // --- RTC event handlers ---
  const handleUserPublished = useCallback(
    async (user: IAgoraRTCRemoteUser, mediaType: "video" | "audio") => {
      await getRtcClient().subscribe(user, mediaType);
      const uid = String(user.uid);

      // Filter agent main UID — play audio but DON'T add to remoteUsers
      const agentUid = getStore.getState().agentRtcUid;
      if (agentUid && uid === agentUid) {
        if (mediaType === "audio" && user.audioTrack) {
          user.audioTrack.play();
        }
        return;
      }

      // Filter avatar UID — handle avatar tracks separately (see 09-avatar)
      const avatarUid = getStore.getState().agentAvatarRtcUid;
      if (avatarUid && uid === avatarUid) {
        if (mediaType === "video" && user.videoTrack) {
          getStore.getState().setAvatarTracks(user.videoTrack, getStore.getState().avatarAudioTrack);
        }
        if (mediaType === "audio" && user.audioTrack) {
          user.audioTrack.play();
          getStore.getState().setAvatarTracks(getStore.getState().avatarVideoTrack, user.audioTrack);
        }
        return;
      }

      // Regular remote user
      if (mediaType === "audio" && user.audioTrack) {
        user.audioTrack.play();
      }
      remoteUsersRef.current[uid] = user;
      setRemoteUsers((prev) =>
        prev.some((u) => String(u.uid) === uid)
          ? prev.map((u) => (String(u.uid) === uid ? user : u))
          : [...prev, user]
      );
    },
    [getStore]
  );

  const handleUserLeft = useCallback(
    (user: IAgoraRTCRemoteUser) => {
      const uid = String(user.uid);
      // Ignore agent UIDs — they're not in remoteUsers
      const agentUid = getStore.getState().agentRtcUid;
      const avatarUid = getStore.getState().agentAvatarRtcUid;
      if ((agentUid && uid === agentUid) || (avatarUid && uid === avatarUid)) {
        return;
      }
      delete remoteUsersRef.current[uid];
      setRemoteUsers((prev) => prev.filter((u) => String(u.uid) !== uid));
    },
    [getStore]
  );

  // --- RTM message handler ---
  const handleRTMMessage = useCallback(
    (event: { message: string | Uint8Array; publisher: string }) => {
      const text =
        typeof event.message === "string"
          ? event.message
          : new TextDecoder().decode(event.message);

      let data;
      try { data = JSON.parse(text); } catch { return; }

      const store = getStore.getState();

      // Route by 'object' field — DO NOT skip these!
      if (data.object) {
        if (data.object === "message.error" || data.object.includes("error")) {
          processAgentErrorMessage(data);
          return;
        }
        if (
          data.object === "user.transcription" ||
          data.object === "assistant.transcription" ||
          data.object === "transcript.content" ||
          data.object.includes("transcription")
        ) {
          processTranscriptMessage(data, store);
          return;
        }
        if (data.object === "message.metrics") {
          return; // Log only
        }
        // Agent status events
        processAgentStatusEvent(data, store);
        return;
      }

      // Application-level messages with 'type' field
      switch (data.type) {
        case "user-joined":
          break; // Presence handles this
        case "media-state-updated":
          break;
        case "user-left":
          break; // RTC user-left handles cleanup
      }
    },
    [getStore]
  );

  // --- RTM presence handler ---
  const handlePresence = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event: any) => {
      const store = getStore.getState();
      switch (event.eventType) {
        case "SNAPSHOT":
          event.snapshot?.forEach((user: { userId: string; states?: Record<string, string> }) => {
            if (user.states?.name) {
              // Update participant info from presence snapshot
            }
          });
          break;
        case "REMOTE_STATE_CHANGED":
          if (event.publisher && event.stateChanged) {
            if (event.stateChanged.state) {
              const state = event.stateChanged.state;
              if (["listening", "thinking", "speaking", "silent", "idle"].includes(state)) {
                store.setAgentStatus(state === "idle" ? "silent" : state);
              }
            }
          }
          break;
      }
    },
    [getStore]
  );

  // --- Initialize RTM ---
  const initializeAgoraRTM = useCallback(
    async (uid: string, token: string, channelId: string, localUsername: string) => {
      const AgoraRTM = (await import("agora-rtm-sdk")).default;
      RTM_CLIENT = new AgoraRTM.RTM(APP_ID, uid, { useStringUserId: true });
      currentRtmChannelName = channelId;

      RTM_CLIENT.addEventListener("message", handleRTMMessage);
      RTM_CLIENT.addEventListener("presence", handlePresence);

      await RTM_CLIENT.login({ token });
      await RTM_CLIENT.subscribe(channelId, {
        withMessage: true,
        withPresence: true,
        withMetadata: false,
        withLock: false,
      });

      await RTM_CLIENT.presence.setState(channelId, "MESSAGE", {
        name: localUsername,
        micMuted: getStore.getState().audioMuted.toString(),
        videoMuted: getStore.getState().videoMuted.toString(),
      });
    },
    [handleRTMMessage, handlePresence, getStore]
  );

  // --- Join ---
  const joinMeeting = useCallback(
    async (token: string, uid: number, channelId: string, options?: { enableVideo?: boolean }) => {
      if (RTC_CLIENT && getRtcClient().connectionState === "CONNECTED") {
        await getRtcClient().leave();
      }

      setRemoteUsers([]);
      remoteUsersRef.current = {};
      addedTurnIds.clear();
      recentlySentMessages.clear();
      currentUserTurnId = null;
      currentAgentTurnId = null;

      const store = getStore.getState();
      const selectedMicId = store.selectedMicrophoneId;

      // Create mic track (use selected device if available)
      const audioTrack = await AgoraRTC.createMicrophoneAudioTrack({
        ...(selectedMicId ? { microphoneId: selectedMicId } : {}),
      });
      localTracksRef.current.audioTrack = audioTrack;

      // Create video track if enabled
      const shouldEnableVideo = options?.enableVideo ?? !store.videoMuted;
      let videoTrack: ILocalVideoTrack | null = null;
      if (shouldEnableVideo) {
        videoTrack = await AgoraRTC.createCameraVideoTrack();
        localTracksRef.current.videoTrack = videoTrack;
      }

      store.setLocalTracks(audioTrack, videoTrack);

      await getRtcClient().join(APP_ID, channelId, token, uid);

      // Publish tracks
      if (!store.audioMuted && localTracksRef.current.audioTrack) {
        await getRtcClient().publish(localTracksRef.current.audioTrack);
      }
      if (videoTrack) {
        await getRtcClient().publish(videoTrack);
      }
    },
    [getStore]
  );

  // --- Leave ---
  const leaveCall = useCallback(async () => {
    // Stop agent if active
    const store = getStore.getState();
    if (store.agentId) {
      try {
        await fetch("/api/agent/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: store.agentId }),
        });
      } catch { /* noop */ }
    }

    // Clean up audio track
    const audioTrack = localTracksRef.current.audioTrack;
    if (audioTrack) {
      try { audioTrack.getMediaStreamTrack()?.stop(); } catch { /* noop */ }
      audioTrack.stop();
      audioTrack.close();
      localTracksRef.current.audioTrack = null;
    }

    // Clean up video track
    const videoTrack = localTracksRef.current.videoTrack;
    if (videoTrack) {
      try { videoTrack.getMediaStreamTrack()?.stop(); } catch { /* noop */ }
      videoTrack.stop();
      videoTrack.close();
      localTracksRef.current.videoTrack = null;
    }

    // Clean up RTM
    if (RTM_CLIENT) {
      if (currentRtmChannelName) {
        try { await RTM_CLIENT.unsubscribe(currentRtmChannelName); } catch { /* noop */ }
        currentRtmChannelName = null;
      }
      RTM_CLIENT.removeAllListeners();
      try { await RTM_CLIENT.logout(); } catch { /* noop */ }
      RTM_CLIENT = null;
    }

    if (RTC_CLIENT && getRtcClient().connectionState === "CONNECTED") {
      await getRtcClient().leave();
    }
    callEnd();
  }, [callEnd, getStore]);

  // --- Toggle mic ---
  const toggleLocalAudio = useCallback(async () => {
    const muted = getStore.getState().audioMuted;
    if (muted) {
      // Unmute: create fresh track
      const selectedMicId = getStore.getState().selectedMicrophoneId;
      const newTrack = await AgoraRTC.createMicrophoneAudioTrack({
        ...(selectedMicId ? { microphoneId: selectedMicId } : {}),
      });
      localTracksRef.current.audioTrack = newTrack;
      getStore.getState().setLocalTracks(newTrack, getStore.getState().localVideoTrack);
      await getRtcClient().publish(newTrack);
    } else {
      // Mute: close track to release hardware
      const track = localTracksRef.current.audioTrack;
      if (track) {
        await getRtcClient().unpublish(track);
        try { track.getMediaStreamTrack()?.stop(); } catch { /* noop */ }
        track.stop();
        track.close();
        localTracksRef.current.audioTrack = null;
        getStore.getState().setLocalTracks(null, getStore.getState().localVideoTrack);
      }
    }
    getStore.getState().toggleAudioMute();
  }, [getStore]);

  // --- Toggle video ---
  const toggleLocalVideo = useCallback(async () => {
    const muted = getStore.getState().videoMuted;
    if (muted) {
      // Unmute: first cleanup any existing track, then create new
      const existingTrack = localTracksRef.current.videoTrack;
      if (existingTrack) {
        try {
          await getRtcClient().unpublish(existingTrack);
          existingTrack.getMediaStreamTrack()?.stop();
          existingTrack.stop();
          existingTrack.close();
        } catch { /* track may already be unpublished */ }
        localTracksRef.current.videoTrack = null;
      }
      const newTrack = await AgoraRTC.createCameraVideoTrack();
      localTracksRef.current.videoTrack = newTrack;
      getStore.getState().setLocalTracks(getStore.getState().localAudioTrack, newTrack);
      await getRtcClient().publish(newTrack);
    } else {
      // Mute: close track to release hardware
      const track = localTracksRef.current.videoTrack;
      if (track) {
        await getRtcClient().unpublish(track);
        try { track.getMediaStreamTrack()?.stop(); } catch { /* noop */ }
        track.stop();
        track.close();
        localTracksRef.current.videoTrack = null;
        getStore.getState().setLocalTracks(getStore.getState().localAudioTrack, null);
      }
    }
    getStore.getState().toggleVideoMute();
  }, [getStore]);

  // --- Send chat message via RTM (to agent directly) ---
  const sendChatMessage = useCallback(
    async (message: string): Promise<boolean> => {
      const store = getStore.getState();
      const agentUid = store.agentRtcUid;
      if (!RTM_CLIENT || !agentUid) return false;

      try {
        const payload = JSON.stringify({
          priority: "interrupted",
          interruptable: true,
          message: message,
        });

        // Publish to agent's user ID (peer-to-peer), NOT channel
        await RTM_CLIENT.publish(agentUid, payload, {
          channelType: "USER",
          customType: "user.transcription",
        });

        // Track to prevent echo when RTM bounces it back
        recentlySentMessages.add(message);
        // Add to local transcript immediately for instant feedback
        const turnId = `user-text-${Date.now()}`;
        addedTurnIds.add(turnId);
        store.addTranscriptItem({
          turn_id: turnId,
          role: "user",
          text: message,
          is_final: true,
          timestamp: Date.now(),
        });
        return true;
      } catch (error) {
        console.error("Failed to send chat message:", error);
        return false;
      }
    },
    [getStore]
  );

  // --- Filter agent from remote users (retroactive, called after setAgentActive) ---
  const filterAgentFromRemoteUsers = useCallback((agentUid: string) => {
    const uidStr = String(agentUid);
    if (remoteUsersRef.current[uidStr]) {
      delete remoteUsersRef.current[uidStr];
      setRemoteUsers((prev) => prev.filter((u) => String(u.uid) !== uidStr));
    }
  }, []);

  // --- Change microphone device ---
  const changeMicrophone = useCallback(
    async (deviceId: string) => {
      const store = getStore.getState();
      store.setSelectedMicrophoneId(deviceId);

      const audioTrack = localTracksRef.current.audioTrack;
      if (audioTrack && !store.audioMuted && RTC_CLIENT) {
        try {
          await RTC_CLIENT.unpublish(audioTrack);
          try { audioTrack.getMediaStreamTrack()?.stop(); } catch { /* noop */ }
          audioTrack.stop();
          audioTrack.close();

          const newTrack = await AgoraRTC.createMicrophoneAudioTrack({ microphoneId: deviceId });
          localTracksRef.current.audioTrack = newTrack;
          store.setLocalTracks(newTrack, store.localVideoTrack);
          await RTC_CLIENT.publish(newTrack);
        } catch (error) {
          console.error("Failed to change microphone:", error);
        }
      }
    },
    [getStore]
  );

  // --- Register RTC listeners ---
  useEffect(() => {
    const client = getRtcClient();
    client.removeAllListeners("user-published");
    client.removeAllListeners("user-left");
    client.on("user-published", handleUserPublished);
    client.on("user-left", handleUserLeft);
    return () => {
      client.removeAllListeners("user-published");
      client.removeAllListeners("user-left");
    };
  }, [handleUserPublished, handleUserLeft]);

  return {
    joinMeeting,
    leaveCall,
    toggleLocalAudio,
    toggleLocalVideo,
    changeMicrophone,
    sendChatMessage,
    filterAgentFromRemoteUsers,
    initializeAgoraRTM,
    remoteUsers,
    rtcClient: getRtcClient(),
    rtmClient: RTM_CLIENT,
  };
};
