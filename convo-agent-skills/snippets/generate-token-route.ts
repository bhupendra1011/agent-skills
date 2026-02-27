// app/api/generate-agora-token/route.ts
// Generates an RTC+RTM combined token, random UID, and random channel name.
// Client calls GET /api/generate-agora-token → receives { token, uid, channel }.

import { NextResponse } from "next/server";
import { RtcTokenBuilder, RtcRole } from "agora-token";

const APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID!;
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE!;

function randomUid(): number {
  return Math.floor(1 + Math.random() * (2 ** 31 - 2));
}

function randomChannelName(): string {
  const random = Math.random().toString(36).substring(2, 11);
  return `channel-${Date.now()}-${random}`;
}

export async function GET() {
  if (!APP_ID || !APP_CERTIFICATE) {
    return NextResponse.json(
      { error: "Agora APP_ID or APP_CERTIFICATE not configured" },
      { status: 500 }
    );
  }

  const channelName = randomChannelName();
  const uid = randomUid();
  const tokenExpiration = 3600;
  const privilegeExpiration = 3600;

  // buildTokenWithRtm grants both RTC and Signaling (RTM) privileges in one token
  const token = RtcTokenBuilder.buildTokenWithRtm(
    APP_ID,
    APP_CERTIFICATE,
    channelName,
    String(uid),
    RtcRole.PUBLISHER,
    tokenExpiration,
    privilegeExpiration
  );

  return NextResponse.json({ token, uid, channel: channelName });
}
