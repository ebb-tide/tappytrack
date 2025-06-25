import NextAuth from "next-auth";
import SpotifyProvider from "next-auth/providers/spotify";

const handler = NextAuth({
  providers: [
    SpotifyProvider({
      clientId: process.env.SPOTIFY_CLIENT_ID as string,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET as string,
    }),
  ],
  callbacks: {
      async signIn({ user, account }) {
        // Call your internal API route

        if (!account || !user) {
          // Block sign-in if account is null
          return false;
        }

        const res = await fetch(`${process.env.NEXTAUTH_URL}/api/register-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userid: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            expiresAt: account.expires_at, //unix timestamp
          }),
        });

        if (!res.ok) {
          // Block sign-in if backend registration fails
          return false;
        }
        return true;
      },
    },
});

export { handler as GET, handler as POST };
