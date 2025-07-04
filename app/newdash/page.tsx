"use client"
// https://ui.shadcn.com/colors
import { useState, useEffect, useRef } from "react"
import { useSession, signIn, signOut } from 'next-auth/react';
import { Music, Nfc, Plus, Settings, LogOut, Smartphone, Trash2, Edit } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

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

interface Card {
    id: string
    spotifyUrl: string
    trackName?: string
    artistName?: string
}

export default function Dashboard() {
    const { data: session, status } = useSession();
    const [lastTappedCardId, setLastTappedCardId] = useState("");
    const [newCardId, setNewCardId] = useState("");
    const [spotifyUrl, setSpotifyUrl] = useState("");
    const [cards, setCards] = useState<Card[]>([]);
    const [_, setShowDeviceModal] = useState(false);  // todo add modal for device ID input
    const [newDeviceId, setNewDeviceId] = useState("");
    const [deviceid, setDeviceId] = useState("");
    const deviceInputRef = useRef<HTMLInputElement>(null);
    const [spotifyPlayers, setSpotifyPlayers] = useState<{ id: string, name: string }[]>([]);
    const [currentSpotifyPlayer, setCurrentSpotifyPlayer] = useState<string>("");
    const [selectedSpotifyPlayer, setSelectedSpotifyPlayer] = useState<string>("");


    const fetchCards = async () => {
        if (status === 'authenticated' && session?.user?.id) {
            try {
                const res = await fetch(`/api/get-cards?userid=${session.user.id}`);
                const data = await res.json();
                setCards(data.cards || []);
                setLastTappedCardId(data.lastCard || "");
                setDeviceId(data.deviceid || "");
                setCurrentSpotifyPlayer(data.player?.id || "");
                if (!data.deviceid) {
                    setShowDeviceModal(true);
                    if (deviceInputRef.current) {
                        deviceInputRef.current.focus();
                    }
                }
            } catch (err) {
                console.error("Error fetching cards:", err);
                setCards([]);
                setLastTappedCardId("");
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
        <div className="min-h-screen">
            {/* Header */}
            <header className="bg-emerald-300 text-white p-4 shadow-lg">
                <div className="bg-emerald-300 flex items-center justify-between">
                    <div className=" bg-emerald-300 flex items-center gap-3">
                        <div className="bg-emerald-300 p-2 rounded-full">
                            <Music className="h-6 w-6" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-wide">tappytrack</h1>
                    </div>
                    <Button
                        variant="ghost" className="text-white hover:bg-emerald-300"
                        onClick={() => signOut({ callbackUrl: '/' })}
                    >
                        <LogOut className="h-4 w-4 mr-2" />
                        Logout
                    </Button>
                </div>
            </header>

            <div className="flex">
                {/* Left Sidebar */}
                <aside className="w-80 bg-white border-r border-emerald-200 p-6 min-h-[calc(100vh-80px)]">
                    <div className="space-y-6">
                        {/* Device Settings */}

                        <Card className="border-emerald-200 shadow-mdv rounded-md p-0">
                            <CardHeader className="bg-emerald-100 p-4 rounded-t-md pb-3">
                                <CardTitle className="flex items-center gap-2 text-emerald-800">
                                    <Smartphone className="h-5 w-5" />
                                    Select Device
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div>
                                    <Label className="text-sm font-medium text-gray-700">Current Device ID</Label>
                                    <div className="mt-1 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                                        <code className="text-emerald-700 font-mono text-sm">{deviceid}</code>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="new-device-id" className="text-sm font-medium text-gray-700">
                                        New Device ID
                                    </Label>
                                    <div className="flex gap-2">
                                        <Input
                                            id="new-device-id"
                                            value={newDeviceId}
                                            onChange={(e) => setNewDeviceId(e.target.value)}
                                            placeholder="Enter device ID"
                                            className="border-emerald-200 focus:border-emerald-400"
                                        />
                                        <Button onClick={handleNewDeviceSubmit} className="bg-emerald-300 hover:bg-emerald-700">
                                            Set
                                        </Button>
                                    </div>
                                    < div className="flex gap-5"> </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Spotify Player Selection */}
                        <Card className="border-emerald-300 shadow-mdv rounded-md p-0">
                            <CardHeader className="bg-emerald-100 pb-3 p-4 rounded-t-md pb-3">
                                <CardTitle className="flex items-center gap-2 text-emerald-800">
                                    <Smartphone className="h-5 w-5" />
                                    Spotify Player
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-">
                                <div>
                                    <Label className="text-sm font-medium text-gray-700">Current Spotify Player</Label>
                                    <div className="mt-1 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                                        <code className="text-emerald-700 font-mono text-sm">{selectedSpotifyPlayer}</code>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="new-device-id" className="text-sm font-medium text-gray-700">
                                        New Spotify Player
                                    </Label>
                                    <div className="flex gap-2">
                                        <Select value={currentSpotifyPlayer} onValueChange={setCurrentSpotifyPlayer}>
                                            <SelectTrigger className="border-emerald-200 focus:border-emerald-400">
                                                <SelectValue placeholder="Select a player device" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {spotifyPlayers.map((device) => (
                                                    <SelectItem key={device.id} value={device.id}>
                                                        {device.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Button onClick={handleNewDeviceSubmit} className="bg-emerald-300 hover:bg-emerald-700">
                                            Set
                                        </Button>
                                    </div>
                                    <div className="flex gap-3">    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </aside>

                {/* Main Content */}
                <main className="flex-1 p-6">
                    <div className="flex flex-col gap-6">
                        {/* Add New Card */}

                        <Card className="border-emerald-200 shadow-mdv rounded-md p-0">
                            <CardHeader className="bg-emerald-300 text-white p-4 rounded-t-md">
                                <CardTitle className="flex items-center">
                                    <Plus className="h-5 w-5" />
                                    Add New Card
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-6">
                                
                                {lastTappedCardId && (
                                    <div>
                                        <Label className="text-sm font-medium text-gray-700">Last Tapped Card</Label>
                                        <div className="mt-1 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                                            <code className="text-emerald-700 font-mono text-sm">{lastTappedCardId}</code>
                                        </div>
                                    </div>
                                )}
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="card-id" className="text-sm font-medium text-gray-700">
                                            Card ID
                                        </Label>
                                        <Input
                                            id="card-id"
                                            value={newCardId}
                                            onChange={(e) => setNewCardId(e.target.value)}
                                            placeholder="e.g., 1092409874..."
                                            className="border-emerald-200 focus:border-emerald-400"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="spotify-url" className="text-sm font-medium text-gray-700">
                                            Spotify URL
                                        </Label>
                                        <Input
                                            id="spotify-url"
                                            value={spotifyUrl}
                                            onChange={(e) => setSpotifyUrl(e.target.value)}
                                            placeholder="https://open.spotify.com/track/..."
                                            className="border-emerald-200 focus:border-emerald-400"
                                        />
                                    </div>
                                </div>
                                <Button
                                    onClick={handleAddCard}
                                    className="mt-4 bg-emerald-300 hover:bg-emerald-700"
                                    disabled={!newCardId.trim() || !spotifyUrl.trim()}
                                >
                                    <Plus className="h-4 w-4 mr-2" />
                                    Add New Card
                                </Button>
                            </CardContent>
                        </Card>

                        {/* Cards Table */}

                        <Card className="border-emerald-00 shadow-mdv rounded-md p-0">
                            <CardHeader className="bg-emerald-300 text-white p-4 rounded-t-md">
                                <CardTitle className="flex items-center gap-2">
                                    <Nfc className="h-5 w-5" />
                                    Cards Collection
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-emerald-50">
                                            <TableHead className="font-semibold text-emerald-800">Card ID</TableHead>
                                            <TableHead className="font-semibold text-emerald-800">Song</TableHead>
                                            <TableHead className="font-semibold text-emerald-800">Artist</TableHead>
                                            <TableHead className="font-semibold text-emerald-800">Spotify URL</TableHead>
                                            <TableHead className="font-semibold text-emerald-800">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {cards.map((card) => (
                                            <TableRow key={card.id} className="hover:bg-emerald-25">
                                                <TableCell>
                                                    <Badge variant="outline" className="border-emerald-400 text-emerald-700 bg-emerald-50">
                                                        {card.id}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="font-medium">{card.trackName}</TableCell>
                                                <TableCell className="text-gray-600">{card.artistName}</TableCell>
                                                <TableCell>
                                                    <a
                                                        href={card.spotifyUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-emerald-300 hover:text-emerald-800 text-sm truncate block max-w-xs"
                                                    >
                                                        {card.spotifyUrl}
                                                    </a>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex gap-2">
                                                        {/* <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="text-emerald-300 hover:text-emerald-800 hover:bg-emerald-50"
                                                        >
                                                            <Edit className="h-4 w-4" />
                                                        </Button> */}
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => handleDeleteCard(card.id)}
                                                            className="text-emerald-300 hover:text-emerald-800 hover:bg-emerald-100"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </div>
                </main>
            </div>
        </div>
    )
}
