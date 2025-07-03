'use client';

import { signIn, signOut, useSession } from "next-auth/react";
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-white px-4">
      <div className="text-center space-y-6 max-w-md">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">tappytrack</h1>
        <p className="text-muted-foreground">
          a spotify player kids can run
        </p>
        {!session ? (
          <Button size="lg" className="mt-2"
            onClick={() => signIn('spotify',{ callbackUrl: '/dashboard' })}>
            Sign in with Spotify
          </Button>
        ) : (
          <div>
            <p className="mb-4">Signed in as {session.user?.name}</p>
            <Button size="lg" className="mt-2"
              onClick={() => signOut()}
            >
              Sign Out
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
