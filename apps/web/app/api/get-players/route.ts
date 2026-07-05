import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET() {
  const session = await getServerSession(authOptions);
  const userid = session?.user?.id;
  if (!userid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
