# 02 — RTC Voice (Audio Only)
<!-- @version 1.1.0 -->

## Overview

RTC (Real-Time Communication) handles audio/video streaming via WebRTC. This reference covers audio-only (voice agent). Add video with `03-rtc-video.md`.

## RTC Client — Module-Scoped Singleton

```ts
import AgoraRTC from "agora-rtc-sdk-ng";
import type { IAgoraRTCClient } from "agora-rtc-sdk-ng";

// CRITICAL: Module-scoped, NOT inside hook. Shared across all useAgora() instances.
let RTC_CLIENT: IAgoraRTCClient | null = null;
const getRtcClient = (): IAgoraRTCClient => {
  if (!RTC_CLIENT && typeof window !== "undefined") {
    RTC_CLIENT = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  }
  return RTC_CLIENT!;
};
```

**Why module-scoped?** Multiple components call `useAgora()`. Each gets its own hook instance. If the client were `useRef`, each instance would have its own client — only one could join. Module scope = singleton = shared.

## Local Tracks Ref — Module-Scoped

```ts
// CRITICAL: Module-scoped. NOT useRef inside hook.
const localTracksRef: { current: { audioTrack: ILocalAudioTrack | null } } = {
  current: { audioTrack: null },
};
```

Same pattern as the client: Controls.tsx calls `toggleLocalAudio()` via its own `useAgora()` instance. It needs access to the same track ref that `joinMeeting()` populated.

## Join Flow

1. Fetch token: `GET /api/generate-agora-token` → `{ token, uid, channel }`
2. Store call state: `callStart({ userName, uid, channelId })`
3. Create mic track: `AgoraRTC.createMicrophoneAudioTrack()`
4. Join channel: `client.join(APP_ID, channelId, token, uid)`
5. Publish: `client.publish(audioTrack)`

```ts
const joinMeeting = async (token: string, uid: number, channelId: string) => {
  const audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
  localTracksRef.current.audioTrack = audioTrack;
  await getRtcClient().join(APP_ID, channelId, token, uid);
  await getRtcClient().publish(audioTrack);
};
```

## RTC Event Handlers

| Event | Trigger | Action |
|-------|---------|--------|
| `user-published` | Remote user publishes audio/video | Subscribe + play audio |
| `user-unpublished` | Remote user unpublishes | Clean up |
| `user-left` | Remote user leaves channel | Remove from state |

```ts
client.on("user-published", async (user, mediaType) => {
  await client.subscribe(user, mediaType);
  if (mediaType === "audio" && user.audioTrack) {
    user.audioTrack.play(); // MUST call play() for audio to be heard
  }
});

client.on("user-left", (user) => {
  // Remove from remoteUsers state
});
```

**Important**: Remote audio tracks MUST be explicitly played with `.play()`. Unlike video which auto-plays into a DOM element, audio requires manual play.

## Agent UID Filtering

When an AI agent joins the channel, it publishes audio like any other user. You **MUST** filter it from `remoteUsers` to avoid inflating participant count or rendering extra tiles.

In `handleUserPublished`, check **before** adding to remoteUsers:

```ts
const handleUserPublished = async (user, mediaType) => {
  await client.subscribe(user, mediaType);
  const uid = String(user.uid);

  // 1. Filter agent main UID — play audio, DON'T add to remoteUsers
  const agentUid = getStore.getState().agentRtcUid;
  if (agentUid && uid === agentUid) {
    if (mediaType === "audio" && user.audioTrack) {
      user.audioTrack.play();
    }
    return;
  }

  // 2. Filter avatar UID — handle avatar tracks separately (see 09-avatar)
  const avatarUid = getStore.getState().agentAvatarRtcUid;
  if (avatarUid && uid === avatarUid) {
    // Handle avatar video/audio tracks...
    return;
  }

  // 3. Regular remote user
  if (mediaType === "audio" && user.audioTrack) {
    user.audioTrack.play();
  }
  // Add to remoteUsers state...
};
```

Also filter in `handleUserLeft`:

```ts
const handleUserLeft = (user) => {
  const uid = String(user.uid);
  const agentUid = getStore.getState().agentRtcUid;
  const avatarUid = getStore.getState().agentAvatarRtcUid;
  if ((agentUid && uid === agentUid) || (avatarUid && uid === avatarUid)) {
    return; // Ignore agent UIDs
  }
  // Remove from remoteUsers...
};
```

**Race condition**: The agent may publish _before_ the invite API returns with the UID. Provide a `filterAgentFromRemoteUsers(uid)` function to retroactively remove the agent:

```ts
const filterAgentFromRemoteUsers = (agentUid: string) => {
  const uidStr = String(agentUid);
  if (remoteUsersRef.current[uidStr]) {
    delete remoteUsersRef.current[uidStr];
    setRemoteUsers(prev => prev.filter(u => String(u.uid) !== uidStr));
  }
};
```

Call this immediately after `store.setAgentActive(agentId, agentRtcUid)`.

### JSX Safety Filter (Required)

As a defense-in-depth measure, **always** filter agent UIDs in JSX when rendering remote users. This catches the race condition where the agent publishes before the invite API returns:

```tsx
{remoteUsers
  .filter(u => String(u.uid) !== agentRtcUid && String(u.uid) !== agentAvatarRtcUid)
  .map(user => (
    <VideoTile key={user.uid} videoTrack={user.videoTrack ?? null} uid={String(user.uid)} />
  ))}
```

This is a **required** secondary filter — do not rely solely on `handleUserPublished` filtering.

## Microphone Device Selection

Users should be able to choose their microphone. Add device selection:

**Store state**: `selectedMicrophoneId: string | null` + `setSelectedMicrophoneId()`

**Use selected device when creating tracks**:
```ts
const audioTrack = await AgoraRTC.createMicrophoneAudioTrack({
  ...(selectedMicId ? { microphoneId: selectedMicId } : {}),
});
```

**Change device while in call** (recreate track):
```ts
const changeMicrophone = async (deviceId: string) => {
  store.setSelectedMicrophoneId(deviceId);
  const audioTrack = localTracksRef.current.audioTrack;
  if (audioTrack && !store.audioMuted && RTC_CLIENT) {
    await RTC_CLIENT.unpublish(audioTrack);
    audioTrack.getMediaStreamTrack()?.stop();
    audioTrack.stop();
    audioTrack.close();
    const newTrack = await AgoraRTC.createMicrophoneAudioTrack({ microphoneId: deviceId });
    localTracksRef.current.audioTrack = newTrack;
    store.setLocalTracks(newTrack, store.localVideoTrack);
    await RTC_CLIENT.publish(newTrack);
  }
};
```

**MicrophoneSelector component** uses `navigator.mediaDevices.enumerateDevices()` filtered by `kind === "audioinput"`. Listen for `devicechange` event to update the list dynamically.

## Track Lifecycle (Hardware Release)

To guarantee the mic indicator turns off:

```ts
// Muting: release hardware completely
const track = localTracksRef.current.audioTrack;
if (track) {
  await getRtcClient().unpublish(track);
  track.getMediaStreamTrack()?.stop(); // browser-native, guaranteed release
  track.stop();
  track.close();
  localTracksRef.current.audioTrack = null;
}

// Unmuting: create fresh track
const newTrack = await AgoraRTC.createMicrophoneAudioTrack();
localTracksRef.current.audioTrack = newTrack;
await getRtcClient().publish(newTrack);
```

**Why close+recreate instead of setMuted?**
- `setMuted(true)` silences but hardware stays active (Chrome mic indicator stays on)
- `setEnabled(false)` is documented to stop capture but unreliable for Chrome indicator
- Close + recreate = guaranteed hardware release

## Leave Flow

```ts
const leaveCall = async () => {
  const track = localTracksRef.current.audioTrack;
  if (track) {
    track.getMediaStreamTrack()?.stop();
    track.stop();
    track.close();
    localTracksRef.current.audioTrack = null;
  }
  if (getRtcClient().connectionState === "CONNECTED") {
    await getRtcClient().leave();
  }
  callEnd(); // Zustand action
};
```

## Zustand Store Slices (for voice)

See `snippets/useAppStore-minimal.ts` for full store. Core slices:

```ts
callActive: boolean;
localUID: string | null;
channelId: string;
audioMuted: boolean;
localAudioTrack: ILocalAudioTrack | null;
```

## Verification

1. Join a channel → mic indicator active
2. Mute → mic indicator off (hardware released)
3. Unmute → mic indicator back on
4. Another tab joins same channel → can hear each other
5. Leave → all resources cleaned up
