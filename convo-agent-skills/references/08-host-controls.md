# 08 — Host Controls

Host can mute/unmute other participants via RTM private messages. Requires `04-rtm-messaging`.

## Message Types

```ts
interface HostControlMessage {
  type: "host-mute-request" | "host-unmute-request";
  fromUid: string;
  fromName: string;
  targetUid: string;
  mediaType: "audio" | "video" | "both";
  timestamp: number;
}
```

## Send Host Control (Host Side)

```ts
const sendHostControlRequest = async (
  targetUid: string, action: "mute" | "unmute", mediaType: "audio" | "video" | "both"
) => {
  if (!RTM_CLIENT || !store.isHost) return;

  const message: HostControlMessage = {
    type: action === "mute" ? "host-mute-request" : "host-unmute-request",
    fromUid: String(store.localUID),
    fromName: store.localUsername,
    targetUid,
    mediaType,
    timestamp: Date.now(),
  };

  // RTM v2.x: publish to userId = private message
  await RTM_CLIENT.publish(targetUid, JSON.stringify(message));
};
```

## Receive (Target Side)

### Mute Request → Auto-comply

```ts
case "host-mute-request":
  if (data.targetUid === String(localUID)) {
    showToast(`${data.fromName} (Host) muted your ${data.mediaType}`, "info");
    // Close tracks (same as toggle mute)
    if (data.mediaType === "audio" || data.mediaType === "both") {
      // close audio track, update store
    }
    if (data.mediaType === "video" || data.mediaType === "both") {
      // close video track, update store
    }
    // Broadcast updated state
    await RTM_CLIENT.publish(channelName, JSON.stringify({
      type: "media-state-updated", uid: localUID, micMuted: true, videoMuted: true
    }));
  }
  break;
```

### Unmute Request → Consent Modal

```ts
case "host-unmute-request":
  if (data.targetUid === String(localUID)) {
    store.setPendingUnmuteRequest({
      fromUid: data.fromUid,
      fromName: data.fromName,
      mediaType: data.mediaType,
      timestamp: data.timestamp,
    });
    // Shows a Modal: "Host wants to unmute your mic. Allow?"
  }
  break;
```

### Accept/Decline

```ts
const acceptUnmuteRequest = async () => {
  const request = store.pendingUnmuteRequest;
  if (!request) return;
  // Create fresh tracks and publish
  if (request.mediaType === "audio" || request.mediaType === "both") {
    const newTrack = await AgoraRTC.createMicrophoneAudioTrack();
    localTracksRef.current.audioTrack = newTrack;
    await getRtcClient().publish(newTrack);
    store.toggleAudioMute();
  }
  // Broadcast updated state, clear pending request
  store.clearPendingUnmuteRequest();
};

const declineUnmuteRequest = () => {
  store.clearPendingUnmuteRequest();
  showToast("Unmute request declined", "info");
};
```

## Store Additions

```ts
isHost: boolean;
pendingUnmuteRequest: PendingUnmuteRequest | null;
setPendingUnmuteRequest: (request: PendingUnmuteRequest | null) => void;
clearPendingUnmuteRequest: () => void;
```

## Verification

1. User A (host) clicks mute on User B → B's mic indicator turns off
2. User A sends unmute request → B sees consent modal
3. B clicks "Allow" → mic turns on, state synced to all participants
4. B clicks "Decline" → nothing changes
