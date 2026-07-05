import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { upstreamJson } from '@/lib/upstream';

// This API route proxies to your Lambda endpoint
export async function GET() {
  const session = await getServerSession(authOptions);
  const userid = session?.user?.id;
  if (!userid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const LAMBDA_URL = process.env.LAMBDA_URL || '';
  const INTERNAL_SECRET = process.env.LAMBDA_SECRET || '';

  const lambdaRes = await fetch(`${LAMBDA_URL}/cards/?userid=${encodeURIComponent(userid)}`, {
    method: 'GET',
    headers: {
      'x-internal': INTERNAL_SECRET,
    },
  });

  const response = await upstreamJson(lambdaRes);
  if (!lambdaRes.ok) {
    return NextResponse.json(response, { status: lambdaRes.status });
  }

  const cards = response.cards || [];
  const lastCard = response.lastCard || null;
  const deviceid = response.deviceid || null;
  const player = response.player || null;
  const lastError = response.lastError || null;

  return NextResponse.json({ cards, lastCard, deviceid, player, lastError });
}
