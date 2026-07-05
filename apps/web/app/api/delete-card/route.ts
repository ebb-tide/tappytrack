import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userid = session?.user?.id;
  if (!userid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { cardID } = await req.json();
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
