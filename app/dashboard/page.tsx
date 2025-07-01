'use client';
import { useSession, signIn, signOut } from 'next-auth/react';
import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RefreshCw } from "lucide-react"

// Extend the session user type to include 'id'
declare module "next-auth" {
  interface Session {
    user?: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    }
  }
}

import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Menu, User } from "lucide-react"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"

interface Card {
  id: string
  spotifyUrl: string
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  const [newCardId, setNewCardId] = useState("");
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const deviceInputRef = useRef<HTMLInputElement>(null);

  // Refactored fetch logic
  const fetchCards = async () => {
    if (status === 'authenticated' && session?.user?.id) {
      try {
        const res = await fetch(`/api/get-cards?userid=${session.user.id}`);
        const data = await res.json();
        setCards(data.cards || []);
        setNewCardId(data.lastCard || "");
      } catch (err) {
        console.log("Error fetching cards:", err);
        setCards([]);
        setNewCardId("");
      }
    }
  };

  useEffect(() => {
    fetchCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session]);

  const handleAddCard = async () => {
    if (!newCardId || spotifyUrl.trim() === "" || !session?.user?.id) return;
    const res = await fetch('/api/add-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userid: session.user.id,
        cardID: newCardId,
        spotifyURL: spotifyUrl,
      }),
    });

    if (res.ok) {
      setCards([...cards, { id: newCardId, spotifyUrl }]);
      setSpotifyUrl("");
      setNewCardId("");
    } else {
      console.log("Failed to add card:", res.statusText);
    }
  };

  const handleDeleteCard = async (id: string) => {
    if (!session?.user?.id) return;
    const res = await fetch('/api/delete-card', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userid: session.user.id, cardID: id }),
    });
    if (res.ok) {
      setCards(cards.filter((card) => card.id !== id));
    } else {
      console.log('Failed to delete card:', res.statusText);
    }
  }

  const handleDeviceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: handle device ID submission logic here
    setShowDeviceModal(false);
    setDeviceId("");
  };

  if (status === 'loading') return <div>Loading...</div>;
  if (!session) {
    signIn('spotify');
    return <div>Redirecting to login...</div>;
  }

  return (
    <div className="min-h-screen bg-white relative">
      {/* Device Modal Overlay */}
      {showDeviceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/30">
          <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-sm border flex flex-col items-center">
            <h2 className="text-xl font-semibold mb-4">Enter Device ID</h2>
            <form onSubmit={handleDeviceSubmit} className="w-full flex flex-col gap-4">
              <Input
                ref={deviceInputRef}
                value={deviceId}
                onChange={e => setDeviceId(e.target.value)}
                placeholder="Device ID"
                className="w-full"
                autoFocus
              />
              <Button type="submit" className="w-full">Submit</Button>
              /* <Button type="button" variant="ghost" className="w-full" onClick={() => setShowDeviceModal(false)}>
                Cancel
              </Button> */
            </form>
          </div>
        </div>
      )}
      <header className="border-b">
        <div className="container flex h-16 items-center justify-between px-4">
          <h1 className="text-xl font-semibold">isla&apos;s spotify player</h1>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="rounded-full" aria-label="User account">
              <User className="h-5 w-5" />
            </Button>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full" aria-label="Menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent>
                <nav className="grid gap-4 py-4">
                  <Button variant="ghost" className="justify-start" onClick={() => setShowDeviceModal(true)}>
                    Connect new device
                  </Button>
                  <Button variant="ghost" className="justify-start" onClick={() => signOut({ callbackUrl: '/' })}>
                    Logout
                  </Button>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <div className="flex flex-col items-center justify-center">
        <main className="w-full max-w-2xl px-4 py-8 flex flex-col items-center justify-center">
          <div className="mb-8 p-6 border rounded-lg bg-gray-50 w-full">
            <div className="mb-4">
              <div className="flex flex-col gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="cardid">CardID</Label>
                  <Input
                    id="cardid"
                    placeholder="Enter value or flash a new card on your device to capture the ID"
                    value={newCardId || ""}
                    onChange={(e) => setNewCardId(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="spotify-url">Spotify URL</Label>
                  <Input
                    id="spotify-url"
                    type="url"
                    placeholder="Enter Spotify URL"
                    value={spotifyUrl}
                    onChange={(e) => setSpotifyUrl(e.target.value)}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end mt-4 gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Refresh cards"
                onClick={fetchCards}
                className="h-9 w-9"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button onClick={handleAddCard}>Add New Card</Button>
            </div>
          </div>
          <div className="rounded-md border w-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Card ID</TableHead>
                  <TableHead>Spotify URL</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cards.map((card) => (
                  <TableRow key={card.id}>
                    <TableCell className="font-mono">{card.id}</TableCell>
                    <TableCell className="font-mono text-sm truncate max-w-[400px]">{card.spotifyUrl}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        className="bg-white text-red-500 hover:bg-red-50 hover:text-red-600"
                        size="sm"
                        onClick={() => handleDeleteCard(card.id)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </main>
      </div>
    </div>
  )
}
