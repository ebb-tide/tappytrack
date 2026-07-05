import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { upstreamJson } from '@/lib/upstream';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userid = session?.user?.id;
  if (!userid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { deviceid } = await req.json();
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

  const data = await upstreamJson(lambdaRes);
  return NextResponse.json(data, { status: lambdaRes.status });
}
