import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { userid, deviceid } = await req.json();
  const LAMBDA_URL = process.env.LAMBDA_URL || '';
  const INTERNAL_SECRET = process.env.LAMBDA_SECRET || '';

  const lambdaRes = await fetch(`${LAMBDA_URL}/devices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal': INTERNAL_SECRET,
    },
    body: JSON.stringify({ userid, deviceid }),
  });

  const data = await lambdaRes.json();
  return NextResponse.json(data, { status: lambdaRes.status });
}
