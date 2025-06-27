import { NextResponse } from 'next/server';

export async function POST(){//req: NextRequest) {
  // const userData = await req.json(); 
  // console.dir(userData);

  return NextResponse.json({ success: true });
}