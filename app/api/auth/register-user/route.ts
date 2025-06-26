import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const userData = await req.json();
  console.dir(userData);

  // const LAMBDA_URL=process.env.LAMBDA_URL || '';
  // const LAMBDA_SECRET=process.env.LAMBDA_SECRET || '';

  // const lambdaRes = await fetch(`${LAMBDA_URL}/users`, {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'x-internal': LAMBDA_SECRET,
  //   },
  //   body: JSON.stringify(userData),
  // });

  // if (!lambdaRes.ok) {
  //   return NextResponse.json({ error: 'Backend registration failed' }, { status: 500 });
  // }

  return NextResponse.json({ success: true });
}