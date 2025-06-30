'use client';
import { useSession, signIn, signOut } from 'next-auth/react';
import { useState, useEffect} from "react"
import { Button } from "@/components/ui/button"
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
  const [newCardId, setNewCardId] = useState(null)
  const [spotifyUrl, setSpotifyUrl] = useState("")
  const [cards, setCards] = useState<Card[]>([])

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.id) {
      // Replace with your actual API route or Lambda endpoint
      fetch(`/api/get-cards?userid=${session.user.id}`)
        .then(res => res.json())
        .then(data => {
          setCards(data.cards || []);
          setNewCardId(data.lastCard || null);
        })
        .catch(err => {
          // Optionally handle error
          console.log("Error fetching cards:", err);
          setCards([]);
          setNewCardId(null);
        });
    }
  }, [status, session]);

  const handleAddCard = () => {
    if (!newCardId) return
    if (spotifyUrl.trim() === "") return

    setCards([...cards, { id: newCardId, spotifyUrl }])
    setSpotifyUrl("")
    setNewCardId(null)
  }

  const handleDeleteCard = (id: string) => {
    setCards(cards.filter((card) => card.id !== id))
  }

  if (status === 'loading') return <div>Loading...</div>;
  if (!session) {
    signIn('spotify');
    return <div>Redirecting to login...</div>;
  }

  return (
    <div className="min-h-screen bg-white">
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
                    <Button variant="ghost" className="justify-start">
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
            { newCardId? (
                <div>
                <h2 className="text-lg font-medium">Add New Card</h2>
                <p className="text-sm text-muted-foreground">
                    New Card ID: <span className="font-mono">{newCardId}</span>
                </p>
                </div>
                ):(
                <p className="text-sm text-muted-foreground">
                    Flash a new card on your device to capture card ID and add it to your collection!
                </p>
            )}
          </div>
          { newCardId? (
          <div className="flex gap-4">
            <Input
              placeholder="Enter Spotify URL"
              value={spotifyUrl}
              onChange={(e) => setSpotifyUrl(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handleAddCard}>Add Card</Button>
          </div>
          ):(<div></div>)}
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
