// src/api/agentApi.ts
// Client-side API layer for AI agent lifecycle (invite, stop, update, query).
// These call YOUR Next.js API routes — never Agora directly from the browser.

import type { AgentSettings, AgentQueryStatus } from "@/types/agora";

export const DEFAULT_GREETING_MESSAGE =
  "Hello {{username}}, glad to meet you, how can I help you?";

/**
 * Invite an AI agent to the current call.
 * Pass username for greeting template variable: "Hello {{username}}, ..."
 */
export async function inviteAgent(
  channelName: string,
  uid: string,
  agentSettings: AgentSettings,
  options?: { username?: string },
): Promise<{
  agentId: string;
  status: string;
  agentRtcUid?: string;
  avatarRtcUid?: string;
}> {
  const body: Record<string, unknown> = { channelName, uid, agentSettings };
  if (options?.username) body.username = options.username;

  const response = await fetch("/api/agent/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to invite agent");
  }
  return response.json();
}

/** Stop the AI agent. */
export async function stopAgent(agentId: string): Promise<{ success: boolean }> {
  const response = await fetch("/api/agent/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to stop agent");
  }
  return response.json();
}

/** Update agent config at runtime (LLM system_messages, params). */
export async function updateAgent(
  agentId: string,
  channelName: string,
  agentSettings: AgentSettings,
): Promise<{ agentId: string; status: string }> {
  const response = await fetch("/api/agent/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, channelName, agentSettings }),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to update agent");
  }
  return response.json();
}

/** Query agent operational status. */
export async function queryAgent(agentId: string): Promise<AgentQueryStatus> {
  const response = await fetch(`/api/agent/query?agentId=${encodeURIComponent(agentId)}`);
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to query agent status");
  }
  return response.json();
}
