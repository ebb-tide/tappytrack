import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const userid = req.nextUrl.searchParams.get('userid');
  if (!userid) {
    return NextResponse.json({ error: 'Missing userid' }, { status: 400 });
  }

  const LAMBDA_URL = process.env.LAMBDA_URL || '';
  const res = await fetch(`${LAMBDA_URL}/players/?userid=${encodeURIComponent(userid)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-internal': process.env.LAMBDA_SECRET || '',
    },
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}