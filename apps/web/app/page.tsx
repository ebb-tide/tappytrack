'use client';

import { signIn, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button"


export default function Home() {
  const { data: session } = useSession();

  if (session) {
    if (typeof window !== 'undefined') {
      window.location.href = '/dashboard';
    }
    return null;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-emerald-50 px-4">
      <div className="text-center space-y-6 max-w-md">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl text-emerald-600">tappytrack</h1>
        <p className="text-emerald-700">
          a spotify player for kids!
        </p>
          <Button size="lg" className="mt-2 text-emerald-800 bg-emerald-300 hover:bg-emerald-400"
            onClick={() => signIn('spotify',{ callbackUrl: '/dashboard' })}>
            Sign in with Spotify
          </Button>
      </div>
    </div>
  );
}
