// src/hooks/useConversationalAI.ts
// Bridge hook between ConversationalAIAPI singleton and Zustand store.
// Handles transcript subscription, agent state changes, and chat message sending.
//
// IMPORTANT: This hook depends on the ConversationalAIAPI source files.
// Copy snippets/conversational-ai-api.ts → src/conversational-ai-api/

"use client";

import { useEffect, useRef, useCallback } from "react";
import type { IAgoraRTCClient } from "agora-rtc-sdk-ng";
import useAppStore from "@/store/useAppStore";
import type { EAgentState, ITranscriptHelperItem } from "@/types/agora";
import { EAgentState as EAgentStateEnum, ETurnStatus } from "@/types/agora";
import {
  ConversationalAIAPI,
  EConversationalAIAPIEvents,
  EChatMessageType,
} from "@/conversational-ai-api";

interface UseConversationalAIOptions {
  rtcClient: IAgoraRTCClient | null;
  rtmClient: unknown | null;
  channelId: string | null;
  isAgentActive: boolean;
  transcriptionMode: "rtc" | "rtm";
  agentRtcUid: string | null;
}

export const useConversationalAI = ({
  rtcClient,
  rtmClient,
  channelId,
  isAgentActive,
  transcriptionMode,
  agentRtcUid,
}: UseConversationalAIOptions) => {
  const setAgentState = useAppStore((s) => s.setAgentState);
  const setTranscriptItems = useAppStore((s) => s.setTranscriptItems);
  const setCurrentInProgressMessage = useAppStore((s) => s.setCurrentInProgressMessage);
  const addUserSentMessage = useAppStore((s) => s.addUserSentMessage);
  const toolkitInitializedRef = useRef(false);

  // Initialize ConversationalAIAPI when agent becomes active
  useEffect(() => {
    if (!isAgentActive || !rtcClient || !channelId || !agentRtcUid) return;

    try {
      // 1. Init — rtcEngine (not rtcClient!), rtmEngine optional
      const api = ConversationalAIAPI.init({
        rtcEngine: rtcClient,
        rtmEngine: rtmClient ?? undefined,
        enableLog: true,
      });
      api.setAgentRtcUid(agentRtcUid);

      // 2. Handle TRANSCRIPT_UPDATED — flat array of ITranscriptHelperItem[]
      const handleTranscriptUpdated = (...args: unknown[]) => {
        const chatHistory = args[0] as ITranscriptHelperItem[];
        const completed = chatHistory.filter((m) => m.status !== ETurnStatus.IN_PROGRESS);
        const inProgress = chatHistory.find((m) => m.status === ETurnStatus.IN_PROGRESS);
        completed.sort((a, b) => a.turn_id - b.turn_id);
        setTranscriptItems(completed);
        setCurrentInProgressMessage(inProgress ?? null);
      };

      // 3. Handle AGENT_STATE_CHANGED
      const handleAgentStateChanged = (...args: unknown[]) => {
        const event = args[1] as { state: string };
        if (event?.state && Object.values(EAgentStateEnum).includes(event.state as EAgentState)) {
          setAgentState(event.state as EAgentState);
        }
      };

      api.on(EConversationalAIAPIEvents.TRANSCRIPT_UPDATED, handleTranscriptUpdated);
      api.on(EConversationalAIAPIEvents.AGENT_STATE_CHANGED, handleAgentStateChanged);

      // 4. Subscribe — pass channelName (NOT mode string)
      api.subscribeMessage(channelId);
      toolkitInitializedRef.current = true;

      return () => {
        api.unsubscribe();
        api.off(EConversationalAIAPIEvents.TRANSCRIPT_UPDATED, handleTranscriptUpdated);
        api.off(EConversationalAIAPIEvents.AGENT_STATE_CHANGED, handleAgentStateChanged);
        toolkitInitializedRef.current = false;
      };
    } catch (err) {
      console.error("[useConversationalAI] Init error:", err);
      return undefined;
    }
  }, [isAgentActive, rtcClient, rtmClient, channelId, agentRtcUid, setTranscriptItems, setCurrentInProgressMessage, setAgentState]);

  // Clear transcript when agent stops
  useEffect(() => {
    if (!isAgentActive) {
      setTranscriptItems([]);
      setCurrentInProgressMessage(null);
    }
  }, [isAgentActive, setTranscriptItems, setCurrentInProgressMessage]);

  // Send chat message (RTM mode only)
  const sendChatMessage = useCallback(
    async (text: string) => {
      if (!agentRtcUid || transcriptionMode !== "rtm") return;

      try {
        const api = ConversationalAIAPI.getInstance();
        const trimmed = text.trim();
        if (trimmed) {
          await api.chat(agentRtcUid, {
            messageType: EChatMessageType.TEXT,
            text: trimmed,
          });
          addUserSentMessage({ text: trimmed });
        }
      } catch (error) {
        console.error("Failed to send chat message:", error);
        throw error;
      }
    },
    [agentRtcUid, transcriptionMode, addUserSentMessage]
  );

  return { sendChatMessage };
};
