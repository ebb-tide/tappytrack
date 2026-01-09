import { NextRequest, NextResponse } from 'next/server';

export async function DELETE(req: NextRequest) {
  const { userid, cardID } = await req.json();
  const LAMBDA_URL = process.env.LAMBDA_URL || '';
  const INTERNAL_SECRET = process.env.LAMBDA_SECRET || '';

  const lambdaRes = await fetch(`${LAMBDA_URL}/cards`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'x-internal': INTERNAL_SECRET,
    },
    body: JSON.stringify({ userid, cardID }),
  });

  const data = await lambdaRes.json();
  return NextResponse.json(data, { status: lambdaRes.status });
}
