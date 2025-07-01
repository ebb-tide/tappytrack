import { NextRequest, NextResponse } from 'next/server';

// This API route proxies to your Lambda endpoint
export async function GET(req: NextRequest) {
  const userid = req.nextUrl.searchParams.get('userid');
  if (!userid) {
    return NextResponse.json({ error: 'Missing userid' }, { status: 400 });
  }

  // Replace with your deployed Lambda/API Gateway URL
  const LAMBDA_URL = process.env.LAMBDA_URL || '';
  const INTERNAL_SECRET = process.env.LAMBDA_SECRET || '';

  const lambdaRes = await fetch(`${LAMBDA_URL}/cards/?userid=${encodeURIComponent(userid)}`, {
    method: 'GET',
    headers: {
      'x-internal': INTERNAL_SECRET,
    },
  });

  if (!lambdaRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch cards' }, { status: 500 });
  }

  const response = await lambdaRes.json();

  const cards = response.cards || [];
  const lastCard= response.lastCard || null;
  const deviceId= response.deviceId || null;

  return NextResponse.json({ cards, lastCard, deviceId });
}
