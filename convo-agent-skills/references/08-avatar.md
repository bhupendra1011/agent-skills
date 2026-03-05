# 08 — Avatar Integration
<!-- @version 1.1.0 -->

Add visual AI avatars (HeyGen, Anam, Akool) that lip-sync with agent TTS. Requires `03-rtc-video` + `05-agent-lifecycle`.

## Supported Vendors

| Vendor | Key env var | Avatar ID env var |
|--------|------------|-------------------|
| HeyGen | `HEYGEN_API_KEY` | `NEXT_PUBLIC_HEYGEN_AVATAR_ID` |
| Akool | `AKOOL_API_KEY` | `NEXT_PUBLIC_AKOOL_AVATAR_ID` |
| Anam | `ANAM_API_KEY` | `NEXT_PUBLIC_ANAM_AVATAR_ID` |

## Invite Payload Additions

Avatar joins with a dedicated RTC UID (e.g., 999999) separate from the agent UID (0):

```ts
// In agent invite route, when avatar is enabled:
const avatarUid = 999999;
const avatarRtcToken = RtcTokenBuilder.buildTokenWithUid(
  APP_ID, APP_CERTIFICATE, channelName, avatarUid,
  RtcRole.PUBLISHER, tokenExpiration, privilegeExpiration
);

propertiesPayload.avatar = {
  enable: true,
  vendor: avatar.vendor, // "heygen" | "akool" | "anam"
  params: {
    agora_uid: String(avatarUid),
    agora_token: avatarRtcToken,
    api_key: "<from-env>",
    avatar_id: "<from-env-or-settings>",
    // HeyGen-specific:
    quality: "medium",
    disable_idle_timeout: false,
    activity_idle_timeout: 60,
  },
};

// IMPORTANT: When avatar is enabled, remote_rtc_uids must be explicit (not "*")
propertiesPayload.remote_rtc_uids = [String(userUid)]; // not ["*"]
```

## TTS Sample Rate Requirement

HeyGen and Anam avatars require TTS at 24,000 Hz. Force it in the invite route:

```ts
if (avatar?.enable && (avatar?.vendor === "heygen" || avatar?.vendor === "anam")) {
  ttsParams.sample_rate = 24000;
}
```

If TTS sample rate is wrong, the agent won't produce audible speech through the avatar.

## Client-Side: Separate Avatar Tracks

Track avatar video/audio independently from regular remoteUsers to avoid race conditions:

```ts
// Module-scoped or useState
const [avatarVideoTrack, setAvatarVideoTrack] = useState<IRemoteVideoTrack | null>(null);
const [avatarAudioTrack, setAvatarAudioTrack] = useState<IRemoteAudioTrack | null>(null);

// In user-published handler:
if (String(user.uid) === agentAvatarRtcUid) {
  if (mediaType === "video" && user.videoTrack) setAvatarVideoTrack(user.videoTrack);
  if (mediaType === "audio" && user.audioTrack) {
    setAvatarAudioTrack(user.audioTrack);
    user.audioTrack.play();
  }
}
```

## Store Additions

```ts
agentAvatarRtcUid: string | null;  // "999999" when avatar enabled
// Set during setAgentActive:
setAgentActive: (agentId, agentRtcUid, avatarRtcUid) =>
  set({ agentId, agentRtcUid, agentAvatarRtcUid: avatarRtcUid ?? null, ... });
```

## AgentTile with Avatar

```tsx
const AgentTile: React.FC<{ avatarVideoTrack?: IRemoteVideoTrack | null }> = ({ avatarVideoTrack }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (avatarVideoTrack && containerRef.current) {
      avatarVideoTrack.play(containerRef.current);
      return () => { avatarVideoTrack.stop(); };
    }
  }, [avatarVideoTrack]);

  if (avatarVideoTrack) {
    return <div ref={containerRef} className="w-full h-full object-contain" />;
  }

  // Fallback: animated icon for audio-only agent
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-20 h-20 rounded-full bg-blue-500 animate-pulse" />
      <span>AI Agent</span>
    </div>
  );
};
```

## Retroactive Avatar Track Polling

The avatar may publish its video track _before_ `agentAvatarRtcUid` is set in the store (race condition). Use a `useEffect` that polls for the avatar track:

```ts
useEffect(() => {
  if (!agentAvatarRtcUid || !RTC_CLIENT) return;

  // Check if avatar track is already available
  const checkAndCapture = () => {
    const user = RTC_CLIENT?.remoteUsers.find(u => String(u.uid) === agentAvatarRtcUid);
    if (user?.videoTrack) {
      store.setAvatarTracks(user.videoTrack, store.avatarAudioTrack);
      return true;
    }
    return false;
  };

  if (checkAndCapture()) return; // Already available

  // Poll every 500ms for up to 30 seconds
  const interval = setInterval(() => {
    if (checkAndCapture()) clearInterval(interval);
  }, 500);

  const timeout = setTimeout(() => clearInterval(interval), 30000);

  return () => {
    clearInterval(interval);
    clearTimeout(timeout);
  };
}, [agentAvatarRtcUid]);
```

This ensures the avatar video is captured regardless of timing.

## Verification

1. Enable avatar in settings → select vendor and avatar ID
2. Invite agent → avatar video stream appears (~5s startup)
3. Speak → agent responds with lip-synced avatar video
4. Stop agent → avatar stream disconnects cleanly
