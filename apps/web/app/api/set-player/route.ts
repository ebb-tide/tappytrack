import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userid = session?.user?.id;
  if (!userid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { spotifyPlayerId, spotifyPlayerName } = body;
  if (!spotifyPlayerId || !spotifyPlayerName) {
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
