// src/conversational-ai-api/index.ts
// ConversationalAIAPI — Singleton that subscribes to transcript events from RTC or RTM.
// This is custom in-repo code (NOT an npm package).
//
// File structure in your project:
//   src/conversational-ai-api/
//     index.ts       ← this file (main class + EventHelper + SubRenderController combined)
//
// Usage:
//   1. ConversationalAIAPI.init({ rtcEngine, rtmEngine, renderMode, enableLog })
//   2. api.setAgentRtcUid(uid)
//   3. api.subscribeMessage(channelName)
//   4. api.on(EConversationalAIAPIEvents.TRANSCRIPT_UPDATED, (items) => {...})
//   5. api.unsubscribe() — after agent session ends
//   6. api.destroy() — at end of call

import type { IAgoraRTCClient } from "agora-rtc-sdk-ng";
import type {
  ITranscriptHelperItem,
  IUserTranscription,
  IAgentTranscription,
} from "@/types/agora";
import { ETurnStatus } from "@/types/agora";

// ============================================
// ENUMS & TYPES
// ============================================

export enum EConversationalAIAPIEvents {
  AGENT_STATE_CHANGED = "agent-state-changed",
  TRANSCRIPT_UPDATED = "transcript-updated",
}

export enum EMessageType {
  USER_TRANSCRIPTION = "user.transcription",
  AGENT_TRANSCRIPTION = "assistant.transcription",
  MSG_INTERRUPTED = "message.interrupt",
}

export enum EChatMessageType {
  TEXT = "text",
  IMAGE = "image",
}

export interface IChatMessageText {
  messageType: EChatMessageType.TEXT;
  text?: string;
}

export interface IChatMessageImage {
  messageType: EChatMessageType.IMAGE;
  uuid: string;
  url?: string;
}

// ============================================
// EVENT HELPER (base class)
// ============================================

type EventHandler = (...args: unknown[]) => void;

class EventHelper {
  private listeners: Map<string, EventHandler[]> = new Map();

  public on(event: string, handler: EventHandler): void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(handler);
  }

  public off(event: string, handler: EventHandler): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx > -1) handlers.splice(idx, 1);
    }
  }

  protected emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((handler) => {
      try { handler(...args); } catch (e) { console.error(`Event handler error (${event}):`, e); }
    });
  }

  public removeAllEventListeners(): void {
    this.listeners.clear();
  }
}

// ============================================
// CONFIG
// ============================================

export interface IConversationalAIAPIConfig {
  rtcEngine: IAgoraRTCClient;
  rtmEngine?: unknown | null;
  enableLog?: boolean;
}

// ============================================
// MAIN CLASS
// ============================================

const TAG = "ConversationalAIAPI";

export class ConversationalAIAPI extends EventHelper {
  private static _instance: ConversationalAIAPI | null = null;

  private rtcEngine: IAgoraRTCClient | null = null;
  private rtmEngine: unknown = null;
  private channel: string | null = null;
  private enableLog = false;
  private agentRtcUid = "0";

  // Transcript message store
  private messageMap: Map<string, ITranscriptHelperItem> = new Map();

  // Chunk cache for RTC datastream (format: message_id|chunk_index|total_chunks|base64)
  private chunkCache: Map<string, { chunks: Map<number, string>; total: number }> = new Map();

  // Event handler references (for cleanup)
  private handleStreamMessage: ((uid: number | string, data: Uint8Array) => void) | null = null;
  private handleRTMMessage: ((event: unknown) => void) | null = null;
  private handleRTMPresence: ((event: unknown) => void) | null = null;

  // --- Singleton ---

  public static init(cfg: IConversationalAIAPIConfig): ConversationalAIAPI {
    if (!ConversationalAIAPI._instance) {
      ConversationalAIAPI._instance = new ConversationalAIAPI();
    }
    const inst = ConversationalAIAPI._instance;
    inst.rtcEngine = cfg.rtcEngine;
    inst.rtmEngine = cfg.rtmEngine ?? null;
    inst.enableLog = cfg.enableLog ?? false;
    return inst;
  }

  public static getInstance(): ConversationalAIAPI {
    if (!ConversationalAIAPI._instance) {
      throw new Error("ConversationalAIAPI is not initialized. Call init() first.");
    }
    return ConversationalAIAPI._instance;
  }

  public setAgentRtcUid(uid: string): void {
    this.agentRtcUid = uid;
  }

  // --- Chat (RTM mode only) ---

  public async chat(
    agentUserId: string,
    message: IChatMessageText | IChatMessageImage
  ): Promise<void> {
    const rtm = this.rtmEngine as {
      publish: (userId: string, message: string, options?: Record<string, string>) => Promise<void>;
    } | null;
    if (!rtm?.publish) throw new Error("RTM engine not available");

    if (message.messageType === EChatMessageType.IMAGE) {
      const img = message as IChatMessageImage;
      await rtm.publish(agentUserId, JSON.stringify({ uuid: img.uuid, url: img.url }), {
        channelType: "USER",
        customType: "image.upload",
      });
    } else {
      const textMsg = message as IChatMessageText;
      await rtm.publish(
        agentUserId,
        JSON.stringify({ priority: "interrupted", interruptable: true, message: textMsg.text ?? "" }),
        { channelType: "USER", customType: "user.transcription" }
      );
    }
  }

  // --- Subscribe / Unsubscribe ---

  public subscribeMessage(channelName: string): void {
    this.channel = channelName;
    this.bindRtcEvents();
    this.bindRtmEvents();
    if (this.enableLog) console.log(`[${TAG}] subscribeMessage channel=${channelName}`);
  }

  public unsubscribe(): void {
    this.unbindRtcEvents();
    this.unbindRtmEvents();
    this.channel = null;
    this.chunkCache.clear();
    this.messageMap.clear();
    if (this.enableLog) console.log(`[${TAG}] unsubscribe`);
  }

  public destroy(): void {
    this.unsubscribe();
    this.rtcEngine = null;
    this.rtmEngine = null;
    this.removeAllEventListeners();
    ConversationalAIAPI._instance = null;
  }

  // --- RTC events (stream-message for RTC datastream mode) ---

  private bindRtcEvents(): void {
    if (!this.rtcEngine) return;

    this.handleStreamMessage = (uid: number | string, data: Uint8Array) => {
      try {
        const str = new TextDecoder("utf-8").decode(data).trim();

        // Plain JSON
        if (str.startsWith("{") || str.startsWith("[")) {
          this.processMessage(JSON.parse(str), String(uid));
          return;
        }

        // Chunked: message_id|chunk_index|total_chunks|base64_payload
        if (str.includes("|")) {
          this.handleChunkedMessage(str, String(uid));
          return;
        }
      } catch (e) {
        if (this.enableLog) console.warn(`[${TAG}] RTC parse error:`, e);
      }
    };

    this.rtcEngine.on("stream-message", this.handleStreamMessage);
  }

  private handleChunkedMessage(raw: string, uid: string): void {
    const parts = raw.split("|");
    if (parts.length !== 4) return;

    const [msgId, idxStr, totalStr, b64] = parts;
    const idx = parseInt(idxStr, 10);
    const total = parseInt(totalStr, 10);
    if (isNaN(idx) || isNaN(total)) return;

    // Single chunk — decode immediately
    if (total === 1) {
      try {
        this.processMessage(JSON.parse(atob(b64)), uid);
      } catch { /* skip */ }
      return;
    }

    // Multi-chunk — cache + reassemble
    const key = `${uid}-${msgId}`;
    let cache = this.chunkCache.get(key);
    if (!cache) {
      cache = { chunks: new Map(), total };
      this.chunkCache.set(key, cache);
    }
    cache.chunks.set(idx, b64);

    if (cache.chunks.size === total) {
      try {
        const decoded: string[] = [];
        for (let i = 1; i <= total; i++) {
          const chunk = cache.chunks.get(i);
          if (!chunk) return;
          decoded.push(atob(chunk));
        }
        this.processMessage(JSON.parse(decoded.join("")), uid);
      } catch { /* skip */ }
      this.chunkCache.delete(key);
    }
  }

  private unbindRtcEvents(): void {
    if (this.rtcEngine && this.handleStreamMessage) {
      this.rtcEngine.off("stream-message", this.handleStreamMessage);
      this.handleStreamMessage = null;
    }
  }

  // --- RTM events (for RTM mode transcripts) ---

  private bindRtmEvents(): void {
    const rtm = this.rtmEngine as {
      addEventListener?: (event: string, handler: (e: unknown) => void) => void;
    };
    if (!rtm?.addEventListener) return;

    this.handleRTMMessage = (event: unknown) => {
      try {
        const e = event as { message?: unknown; publisher?: string };
        const data = e.message;
        if (!data) return;

        let parsed: Record<string, unknown>;
        if (typeof data === "string") parsed = JSON.parse(data);
        else if (data instanceof Uint8Array) parsed = JSON.parse(new TextDecoder().decode(data));
        else parsed = data as Record<string, unknown>;

        this.processMessage(parsed, e.publisher || "unknown");
      } catch (err) {
        if (this.enableLog) console.warn(`[${TAG}] RTM parse error:`, err);
      }
    };

    this.handleRTMPresence = (event: unknown) => {
      try {
        const e = event as { stateChanged?: { state?: string } };
        if (e.stateChanged?.state) {
          this.emit(EConversationalAIAPIEvents.AGENT_STATE_CHANGED, this.agentRtcUid, {
            state: e.stateChanged.state,
          });
        }
      } catch { /* ignore */ }
    };

    rtm.addEventListener("message", this.handleRTMMessage);
    rtm.addEventListener("presence", this.handleRTMPresence);
  }

  private unbindRtmEvents(): void {
    const rtm = this.rtmEngine as {
      removeEventListener?: (event: string, handler: (e: unknown) => void) => void;
    };
    if (!rtm?.removeEventListener) return;
    if (this.handleRTMMessage) { rtm.removeEventListener("message", this.handleRTMMessage); this.handleRTMMessage = null; }
    if (this.handleRTMPresence) { rtm.removeEventListener("presence", this.handleRTMPresence); this.handleRTMPresence = null; }
  }

  // --- Process transcript messages ---

  private processMessage(message: Record<string, unknown>, publisher: string): void {
    const msgType = message.object as string;

    if (msgType === EMessageType.USER_TRANSCRIPTION) {
      const msg = message as unknown as IUserTranscription;
      const key = `${msg.user_id}-${msg.turn_id}-${msg.stream_id}`;
      this.messageMap.set(key, {
        uid: msg.user_id,
        stream_id: msg.stream_id,
        turn_id: msg.turn_id,
        _time: Date.now(),
        text: msg.text,
        status: msg.final ? ETurnStatus.END : ETurnStatus.IN_PROGRESS,
        metadata: msg,
      });
    } else if (msgType === EMessageType.AGENT_TRANSCRIPTION) {
      const msg = message as unknown as IAgentTranscription;
      const key = `${this.agentRtcUid}-${msg.turn_id}-${msg.stream_id}`;
      this.messageMap.set(key, {
        uid: this.agentRtcUid,
        stream_id: msg.stream_id,
        turn_id: msg.turn_id,
        _time: Date.now(),
        text: msg.text,
        status: msg.turn_status,
        metadata: msg,
      });
    } else if (msgType === EMessageType.MSG_INTERRUPTED) {
      const turnId = message.turn_id as number;
      this.messageMap.forEach((item) => {
        if (item.turn_id === turnId && item.status === ETurnStatus.IN_PROGRESS) {
          item.status = ETurnStatus.INTERRUPTED;
        }
      });
    } else {
      return; // Unknown message type
    }

    this.emitTranscriptUpdated();
  }

  private emitTranscriptUpdated(): void {
    const all = Array.from(this.messageMap.values());
    const completed = all.filter((m) => m.status !== ETurnStatus.IN_PROGRESS);
    const inProgress = all.find((m) => m.status === ETurnStatus.IN_PROGRESS);
    completed.sort((a, b) => a.turn_id - b.turn_id);

    const toEmit = [...completed];
    if (inProgress) toEmit.push(inProgress);

    this.emit(EConversationalAIAPIEvents.TRANSCRIPT_UPDATED, toEmit);
  }
}
