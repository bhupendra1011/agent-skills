# 04 — RTM Messaging
<!-- @version 1.1.0 -->

RTM (Real-Time Messaging) v2.x provides signaling, presence, and chat. Independent of RTC.

## RTM Client — Module-Scoped

```ts
import AgoraRTM from "agora-rtm-sdk";

// Module-scoped (same pattern as RTC client)
let RTM_CLIENT: InstanceType<typeof AgoraRTM.RTM> | null = null;
let currentRtmChannelName: string | null = null;
```

## Initialize RTM

```ts
const initializeAgoraRTM = async (
  uid: string, token: string, channelId: string,
  localUsername: string, audioMuted: boolean, videoMuted: boolean
) => {
  // 1. Create client (requires userId at construction)
  RTM_CLIENT = new AgoraRTM.RTM(APP_ID, uid, { useStringUserId: true });
  currentRtmChannelName = channelId;

  // 2. Add event listeners BEFORE login
  RTM_CLIENT.addEventListener("message", handleRTMMessage);
  RTM_CLIENT.addEventListener("presence", handlePresence);

  // 3. Login with token
  await RTM_CLIENT.login({ token });

  // 4. Subscribe to channel
  await RTM_CLIENT.subscribe(channelId, {
    withMessage: true,
    withPresence: true,
    withMetadata: false,
    withLock: false,
  });

  // 5. Set initial presence state (replaces setLocalUserAttributes)
  await RTM_CLIENT.presence.setState(channelId, "MESSAGE", {
    name: localUsername,
    micMuted: audioMuted.toString(),
    videoMuted: videoMuted.toString(),
  });
};
```

## RTM v2.x API Surface

| Method | Purpose |
|--------|---------|
| `new AgoraRTM.RTM(appId, userId, options)` | Create client |
| `client.login({ token })` | Authenticate |
| `client.subscribe(channel, options)` | Join channel (messages + presence) |
| `client.publish(channel, message)` | Broadcast to channel |
| `client.publish(userId, message)` | Private message to user |
| `client.unsubscribe(channel)` | Leave channel |
| `client.removeAllListeners()` | Clean up event listeners |
| `client.logout()` | Disconnect |
| `client.presence.setState(channel, "MESSAGE", state)` | Set user presence state |

## Message Types

Application-level messages sent over RTM channel:

| Type | Sender | Purpose |
|------|--------|---------|
| `user-joined` | Joining user | Announce name + mute state |
| `user-left` | Leaving user | Notify departure |
| `media-state-updated` | Any user | Sync mic/camera mute state |
| `host-mute-request` | Host | Mute target user (see 08-host-controls) |
| `host-unmute-request` | Host | Request target unmute (see 08-host-controls) |

## Message Handler

**CRITICAL**: The RTM handler receives TWO kinds of messages:
1. **Application messages** with a `type` field (user-joined, media-state-updated)
2. **Transcript/agent messages** with an `object` field (user.transcription, assistant.transcription, message.error, conversation.agent.state_changed)

You **MUST** process messages with `object` field — do NOT skip them!

```ts
const handleRTMMessage = (event: { message: string | Uint8Array; publisher: string }) => {
  const text = typeof event.message === "string"
    ? event.message
    : new TextDecoder().decode(event.message);

  let data;
  try { data = JSON.parse(text); } catch { return; }

  const store = getStore.getState();

  // Route by 'object' field — transcript, errors, agent status
  if (data.object) {
    // Error messages
    if (data.object === "message.error" || data.object.includes("error")) {
      processAgentErrorMessage(data);
      return;
    }
    // Transcript messages (user speech + agent responses)
    if (
      data.object === "user.transcription" ||
      data.object === "assistant.transcription" ||
      data.object === "transcript.content" ||
      data.object.includes("transcription")
    ) {
      processTranscriptMessage(data, store);
      return;
    }
    // Metrics (log only)
    if (data.object === "message.metrics") {
      return;
    }
    // Agent status events (listening/thinking/speaking)
    processAgentStatusEvent(data, store);
    return;
  }

  // Application-level messages with 'type' field
  switch (data.type) {
    case "user-joined":
      // Update participant info...
      break;
    case "media-state-updated":
      // Update mute state...
      break;
    case "user-left":
      break; // RTC user-left handles cleanup
  }
};
```

See `06-transcript` for `processTranscriptMessage` implementation and field name details.

## Chat Input (RTM mode)

When RTM is enabled, users can send text messages to the agent. Messages must be sent **directly to the agent's user ID** (peer-to-peer), NOT to the channel:

```ts
const sendChatMessage = async (message: string): Promise<boolean> => {
  const agentUid = store.agentRtcUid;
  if (!RTM_CLIENT || !agentUid) return false;

  const payload = JSON.stringify({
    priority: "interrupted",
    interruptable: true,
    message: message,
  });

  // CRITICAL: Publish to agent UID with channelType "USER", NOT channel broadcast
  await RTM_CLIENT.publish(agentUid, payload, {
    channelType: "USER",
    customType: "user.transcription",
  });

  // Track to prevent echo when RTM bounces it back
  recentlySentMessages.add(message);
  // Add to local transcript immediately for instant feedback
  store.addTranscriptItem({
    turn_id: `user-text-${Date.now()}`,
    role: "user",
    text: message,
    is_final: true,
    timestamp: Date.now(),
  });
  return true;
};
```

**Echo prevention**: RTM echoes sent messages back to the sender. Track sent messages in a `Set<string>` and skip matching echoes in `processTranscriptMessage`.

## Presence Events

```ts
RTM_CLIENT.addEventListener("presence", (event) => {
  switch (event.eventType) {
    case "SNAPSHOT":
      // Fires on subscribe — all current users with their states
      event.snapshot?.forEach(user => {
        if (user.states?.name) {
          updateRemoteParticipant({
            uid: user.userId, name: user.states.name,
            micMuted: user.states.micMuted === "true",
            videoMuted: user.states.videoMuted === "true",
          });
        }
      });
      break;
    case "REMOTE_STATE_CHANGED":
      // User updated their presence state
      if (event.publisher && event.stateChanged) {
        updateRemoteParticipant({
          uid: event.publisher,
          name: event.stateChanged.name,
          micMuted: event.stateChanged.micMuted === "true",
          videoMuted: event.stateChanged.videoMuted === "true",
        });
      }
      break;
  }
});
```

## Broadcasting State Changes

After toggling mute, broadcast to other participants:

```ts
// Publish mute state to channel
await RTM_CLIENT.publish(currentRtmChannelName, JSON.stringify({
  type: "media-state-updated",
  uid: localUID,
  micMuted: audioMuted,
  videoMuted: videoMuted,
}));

// Update presence for late joiners
await RTM_CLIENT.presence.setState(currentRtmChannelName, "MESSAGE", {
  micMuted: audioMuted.toString(),
  videoMuted: videoMuted.toString(),
});
```

## Cleanup

```ts
if (RTM_CLIENT) {
  if (currentRtmChannelName) {
    await RTM_CLIENT.unsubscribe(currentRtmChannelName);
    currentRtmChannelName = null;
  }
  RTM_CLIENT.removeAllListeners();
  await RTM_CLIENT.logout();
  RTM_CLIENT = null;
}
```

## Verification

1. Two users join same channel → both see each other's names
2. User A mutes → User B sees mute state update immediately
3. User B joins late → gets SNAPSHOT with User A's current state
4. Leave → RTM cleanup without errors
