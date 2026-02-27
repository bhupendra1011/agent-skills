# 03 — RTC Video
<!-- @version 1.1.0 -->

Extends `02-rtc-voice` with camera track. Requires voice setup first.

**Default**: `videoMuted: false` — camera should be ON by default for video-enabled apps.

## Add Video Track to Join

```ts
import AgoraRTC from "agora-rtc-sdk-ng";
import type { ILocalVideoTrack } from "agora-rtc-sdk-ng";

// Extend module-scoped ref (from 02)
const localTracksRef: { current: { audioTrack: ILocalAudioTrack | null; videoTrack: ILocalVideoTrack | null } } = {
  current: { audioTrack: null, videoTrack: null },
};

// In joinMeeting, after creating audio track:
const videoTrack = await AgoraRTC.createCameraVideoTrack();
localTracksRef.current.videoTrack = videoTrack;
await getRtcClient().publish([audioTrack, videoTrack]);
```

## VideoTile Component

Play a video track into a div using a ref:

```tsx
const VideoTile: React.FC<{ videoTrack: ILocalVideoTrack | IRemoteVideoTrack; uid: string }> = ({ videoTrack, uid }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (videoTrack && containerRef.current) {
      videoTrack.play(containerRef.current);
      return () => { videoTrack.stop(); };
    }
  }, [videoTrack]);

  return <div ref={containerRef} id={`user-${uid}`} className="w-full h-full" />;
};
```

## Toggle Video (Close/Recreate Pattern)

Same pattern as audio — close to release camera hardware, recreate to unmute.

**CRITICAL**: When unmuting, always cleanup any existing track FIRST to prevent "CAN_NOT_PUBLISH_MULTIPLE_VIDEO_TRACKS" error:

```ts
const toggleLocalVideo = async () => {
  const muted = getStore.getState().videoMuted;
  if (muted) {
    // Unmute: FIRST cleanup any lingering track, THEN create fresh one
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
    // Mute: close track to release camera hardware
    const track = localTracksRef.current.videoTrack;
    if (track) {
      await getRtcClient().unpublish(track);
      track.getMediaStreamTrack()?.stop();
      track.stop();
      track.close();
      localTracksRef.current.videoTrack = null;
      getStore.getState().setLocalTracks(getStore.getState().localAudioTrack, null);
    }
  }
  getStore.getState().toggleVideoMute();
};
```

## Camera Icons

Use proper camera SVG icons (NOT generic image/mountains icons):

```tsx
{videoMuted ? (
  // Camera OFF icon (with slash)
  <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 24 24">
    <path d="M3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82l12 12 .18-.18V6.5z" />
  </svg>
) : (
  // Camera ON icon
  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
    <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
  </svg>
)}
```

## Subscribe to Remote Video

In `user-published` handler (from 02), add video handling:

```ts
client.on("user-published", async (user, mediaType) => {
  await client.subscribe(user, mediaType);
  if (mediaType === "audio" && user.audioTrack) {
    user.audioTrack.play();
  }
  if (mediaType === "video") {
    // Add to remoteUsers state → VideoTile will render it
    setRemoteUsers(prev => [...prev.filter(u => u.uid !== user.uid), user]);
  }
});
```

## Store Additions

```ts
videoMuted: boolean;
localVideoTrack: ILocalVideoTrack | null;
toggleVideoMute: () => void;
```

## Video Layout

Grid layout for multiple participants:

```tsx
<div className={`grid gap-2 ${
  remoteUsers.length <= 1 ? 'grid-cols-1' :
  remoteUsers.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'
}`}>
  {/* Local video */}
  <VideoTile videoTrack={localVideoTrack} uid={localUID} />
  {/* Remote videos */}
  {remoteUsers.map(user => user.videoTrack && (
    <VideoTile key={user.uid} videoTrack={user.videoTrack} uid={String(user.uid)} />
  ))}
</div>
```

## Verification

1. Join → camera indicator active, local video visible
2. Mute video → camera indicator off
3. Remote user joins with video → their video appears in grid
4. Leave → camera released
