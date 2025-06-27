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
    async jwt({ token, account, user }) {
      const LAMBDA_URL=process.env.LAMBDA_URL || '';
      const LAMBDA_SECRET=process.env.LAMBDA_SECRET || '';

      // Initial sign-in
      if (account && user) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;

        await fetch(`${LAMBDA_URL}/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal': LAMBDA_SECRET,
          },
          body: JSON.stringify({
            userid: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            expiresAt: account.expires_at, //unix timestamp),
          })
        })
      }
      return token;
    },

    async session({ session, token }) {
      // Forward the tokens to the session
      // @ts-expect-error: Add custom property to session
      session.accessToken = token.accessToken;
      // @ts-expect-error: Add custom property to session
      session.refreshToken = token.refreshToken;
      // @ts-expect-error: Add custom property to session
      session.expiresAt = token.expiresAt;
      return session;
    },


  },
});

export { handler as GET, handler as POST };
