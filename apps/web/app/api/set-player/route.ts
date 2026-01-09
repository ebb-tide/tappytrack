import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { userid, spotifyPlayerId, spotifyPlayerName } = body;
  if (!userid || !spotifyPlayerId || !spotifyPlayerName) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const LAMBDA_URL = process.env.LAMBDA_URL || '';
  const res = await fetch(`${LAMBDA_URL}/players/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal': process.env.LAMBDA_SECRET || '',
    },
    body: JSON.stringify({ userid, spotifyPlayerId, spotifyPlayerName }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}