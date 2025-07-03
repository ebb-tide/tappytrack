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
      playerid?: string; 
      playerName?: string;
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
  trackName?: string
  artistName?: string
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  const [newCardId, setNewCardId] = useState("");
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [newDeviceId, setNewDeviceId] = useState("");
  const [deviceid, setDeviceId] = useState("");
  const deviceInputRef = useRef<HTMLInputElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [spotifyPlayers, setSpotifyPlayers] = useState<{id: string, name: string}[]>([]);
  const [selectedSpotifyPlayer, setSelectedSpotifyPlayer] = useState<string>("");

  // Refactored fetch logic
  const fetchCards = async () => {
    if (status === 'authenticated' && session?.user?.id) {
      try {
        const res = await fetch(`/api/get-cards?userid=${session.user.id}`);
        const data = await res.json();
        setCards(data.cards || []);
        setNewCardId(data.lastCard || "");
        setDeviceId(data.deviceid || "");
        setSelectedSpotifyPlayer(data.player?.id || "");
        if (!data.deviceid) {
          setShowDeviceModal(true);
          if (deviceInputRef.current) {
            deviceInputRef.current.focus();
          }
        }
      } catch (err) {
        console.error("Error fetching cards:", err);
        setCards([]);
        setNewCardId("");
        setDeviceId("");
      }
    }
  };

  // Fetch Spotify players for the user
  const fetchSpotifyPlayers = async () => {
    if (session?.user?.id) {
      try {
        const res = await fetch(`/api/get-players?userid=${session.user.id}`);
        const data = await res.json();
        if (Array.isArray(data.players)) {
          setSpotifyPlayers(data.players.map((d: { id: string; name: string }) => ({ id: d.id, name: d.name })));
        }
      } catch (err) {
        console.error("Error fetching Spotify players:", err);
        setSpotifyPlayers([]);
      }
    }
  };

  useEffect(() => {
    fetchCards();
    fetchSpotifyPlayers();
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

  const handleNewDeviceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id || !newDeviceId.trim()) return;
    try {
      const res = await fetch('/api/add-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userid: session.user.id, deviceid: newDeviceId.trim() }),
      });
      if (res.ok) {
        setDeviceId(newDeviceId.trim());
        setShowDeviceModal(false);
        setNewDeviceId("");
      } else {
        // Optionally handle error
        console.log('Failed to add device:', res.statusText);
      }
    } catch (err) {
      console.error('Failed to add device:', err);
    }
  };

  // Save selected Spotify player to user profile
  const handleSetSpotifyPlayer = async () => {
    if (!session?.user?.id || !selectedSpotifyPlayer) return;
    const player = spotifyPlayers.find(p => p.id === selectedSpotifyPlayer);
    if (!player) return;
    try {
      await fetch("/api/set-player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userid: session.user.id, spotifyPlayerId: player.id, spotifyPlayerName: player.name })
      });
    } catch (err) {
      console.error("Failed to set Spotify player:", err)
    }
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
            <h2 className="text-xl font-semibold mb-4">Link a new tappytrack NFC reader to your account</h2>
            <form onSubmit={handleNewDeviceSubmit} className="w-full flex flex-col gap-4">
              <Input
                ref={deviceInputRef}
                value={newDeviceId}
                onChange={e => setNewDeviceId(e.target.value)}
                placeholder="Enter Device ID"
                className="w-full"
                autoFocus
              />
              <Button type="submit" className="w-full">Submit</Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => setShowDeviceModal(false)}>
                Cancel
              </Button> 
            </form>
          </div>
        </div>
      )}
      <header className="border-b">
        <div className="container flex h-16 items-center justify-between px-4">
          <h1 className="text-xl font-semibold">tappytrack!</h1>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="rounded-full" aria-label="User account">
              <User className="h-5 w-5" />
            </Button>
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full" aria-label="Menu" onClick={() => setSheetOpen(true)}>
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent>
                <nav className="grid gap-4 py-4">
                  <Button variant="ghost" className="justify-start" onClick={() => {setShowDeviceModal(true); setSheetOpen(false);}}>
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
        <main className="w-full max-w-4xl px-4 py-8 flex flex-col items-center justify-center">
          <div className="mb-8 p-6 border rounded-lg bg-gray-50 w-full">
            <div className="mb-4">
              <div className="flex flex-col gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="cardid">CardID</Label>
                  <Input
                    id="cardid"
                    placeholder="Enter value or tap a new card on your device to capture the ID"
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
          {/* Device ID display */}
          {deviceid && (
            <div className="mb-8 p-6 border rounded-lg bg-gray-50 w-full flex flex-col gap-4">
              <div className="flex flex-col gap-3">
                <Label htmlFor="deviceid">Device ID</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    id="deviceid"
                    value={deviceid || ""}
                    readOnly
                    className="w-full bg-gray-100 cursor-default"
                  />
                  <Button
                    onClick={() => setShowDeviceModal(true)}
                  >
                    Connect New Device
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Spotify Device Dropdown Section */}
          <div className="mb-8 p-6 border rounded-lg bg-gray-50 w-full flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <Label htmlFor="spotify-device">Select Spotify Player</Label>
              <div className="flex gap-2 items-center">
                <select
                  id="spotify-device"
                  className="w-full bg-gray-100 border rounded px-3 py-2"
                  value={selectedSpotifyPlayer}
                  onChange={e => setSelectedSpotifyPlayer(e.target.value)}
                >
                  <option value="">Select a Spotify player...</option>
                  {spotifyPlayers.map((player) => (
                    <option key={player.id} value={player.id}>{player.name}</option>
                  ))}
                </select>
                <Button onClick={handleSetSpotifyPlayer} disabled={!selectedSpotifyPlayer}>Set Spotify Player</Button>
              </div>
            </div>
          </div>

          <div className="rounded-md border w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Card ID</TableHead>
                  <TableHead className="w-[220px]">Track Name</TableHead>
                  <TableHead className="w-[180px]">Artist Name</TableHead>
                  <TableHead>Spotify URL</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cards.map((card) => (
                  <TableRow key={card.id}>
                    <TableCell className="font-mono">{card.id}</TableCell>
                    <TableCell className="truncate max-w-[220px]">{card.trackName || ""}</TableCell>
                    <TableCell className="truncate max-w-[180px]">{card.artistName || ""}</TableCell>
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
