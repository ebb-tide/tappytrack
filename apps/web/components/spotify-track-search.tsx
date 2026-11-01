"use client"

import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import { signIn } from 'next-auth/react';
import { Music, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export interface SpotifyTrack {
    id: string;
    name: string;
    artistName: string;
    albumName: string;
    imageUrl: string | null;
    spotifyUrl: string;
}

interface SearchState {
    query: string;
    tracks: SpotifyTrack[];
    pending: boolean;
    error?: string;
    reconnect?: boolean;
}

export function SpotifyTrackSearch({ onSelect, disabled = false }: {
    onSelect: (track: SpotifyTrack) => void;
    disabled?: boolean;
}) {
    const id = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const retryAt = useRef(0);
    const [query, setQuery] = useState('');
    const [selectedQuery, setSelectedQuery] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [retry, setRetry] = useState(0);
    const [state, setState] = useState<SearchState>({ query: '', tracks: [], pending: false });
    const term = query.trim();
    const canSearch = term.length >= 2 && query !== selectedQuery && !disabled;
    const current = state.query === term ? state : null;
    const loading = canSearch && (!current || current.pending);
    const tracks = canSearch && !loading ? current?.tracks || [] : [];
    const showResults = expanded && canSearch;

    useEffect(() => {
        if (!canSearch) return;
        const controller = new AbortController();
        setState({ query: term, tracks: [], pending: true });
        // Honor Spotify's Retry-After before starting another query.
        const timer = setTimeout(async () => {
            try {
                const response = await fetch(`/api/search-tracks?q=${encodeURIComponent(term)}`, {
                    signal: controller.signal,
                });
                const data = await response.json();
                if (controller.signal.aborted) return;
                if (response.status === 429) {
                    retryAt.current = Date.now() + Math.min(3600, Math.max(1, Number(data.retryAfter) || 30)) * 1000;
                }
                if (!response.ok) {
                    setState({ query: term, tracks: [], pending: false,
                        error: data.error || 'Could not search Spotify. Please try again.',
                        reconnect: response.status === 401 || response.status === 403 });
                    return;
                }
                if (!Array.isArray(data.tracks)) throw new Error('Invalid search response');
                setState({ query: term, tracks: data.tracks, pending: false });
                setActiveIndex(-1);
            } catch {
                if (!controller.signal.aborted) {
                    setState({ query: term, tracks: [], pending: false,
                        error: 'Could not search Spotify. Please try again or paste a Spotify URL below.' });
                }
            }
        }, Math.max(300, retryAt.current - Date.now()));
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [term, canSearch, retry]);

    useEffect(() => {
        if (showResults && activeIndex >= 0) {
            document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
        }
    }, [activeIndex, showResults, id]);

    const select = (track: SpotifyTrack) => {
        const label = `${track.name} — ${track.artistName}`;
        setSelectedQuery(label);
        setQuery(label);
        setExpanded(false);
        setActiveIndex(-1);
        onSelect(track);
    };

    return (
        <div className="space-y-2">
            <Label htmlFor={id} className="text-sm font-medium text-gray-700">Search songs or artists</Label>
            <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-emerald-700" />
                <Input
                    ref={inputRef}
                    id={id}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={showResults}
                    aria-controls={`${id}-results`}
                    aria-activedescendant={showResults && activeIndex >= 0 && tracks[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
                    aria-describedby={`${id}-hint`}
                    autoComplete="off"
                    maxLength={120}
                    disabled={disabled}
                    value={query}
                    placeholder="Start typing a song title or artist…"
                    className="border-emerald-200 pl-9 focus:border-emerald-400"
                    onChange={event => {
                        setQuery(event.target.value);
                        setSelectedQuery(null);
                        setActiveIndex(-1);
                        setExpanded(true);
                    }}
                    onFocus={() => setExpanded(true)}
                    onBlur={() => setExpanded(false)}
                    onKeyDown={event => {
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === 'Escape') {
                            setExpanded(false);
                            setActiveIndex(-1);
                        } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && tracks.length) {
                            event.preventDefault();
                            setExpanded(true);
                            setActiveIndex(index => event.key === 'ArrowDown'
                                ? (index + 1) % tracks.length
                                : (index <= 0 ? tracks.length - 1 : index - 1));
                        } else if (event.key === 'Enter' && showResults && tracks[activeIndex]) {
                            event.preventDefault();
                            select(tracks[activeIndex]);
                        }
                    }}
                />
                {showResults && (
                    <div className="absolute z-20 mt-1 w-full rounded-md border border-emerald-200 bg-white shadow-lg">
                        <div role="status" aria-live="polite" className="px-3 py-2 text-sm text-gray-600">
                            {loading ? 'Searching Spotify…' : current?.error || (tracks.length ? `${tracks.length} songs found on Spotify` : 'No songs found. Try another title or artist.')}
                        </div>
                        <ul id={`${id}-results`} role="listbox" aria-label="Spotify songs" aria-busy={loading} className="max-h-80 overflow-y-auto">
                            {tracks.map((track, index) => (
                                <li
                                    key={track.id}
                                    id={`${id}-option-${index}`}
                                    role="option"
                                    aria-selected={index === activeIndex}
                                    className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${index === activeIndex ? 'bg-emerald-100' : 'hover:bg-emerald-50'}`}
                                    onMouseDown={event => event.preventDefault()}
                                    onMouseMove={() => setActiveIndex(index)}
                                    onClick={() => select(track)}
                                >
                                    {track.imageUrl ? (
                                        <Image unoptimized src={track.imageUrl} width={48} height={48} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                                    ) : (
                                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-emerald-50"><Music aria-hidden="true" className="h-5 w-5 text-emerald-700" /></div>
                                    )}
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium text-emerald-900">{track.name}</div>
                                        <div className="truncate text-sm text-gray-700">{track.artistName}</div>
                                        <div className="truncate text-xs text-gray-500">{track.albumName}</div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
            <p id={`${id}-hint`} className="text-xs text-gray-500">Type at least 2 characters, then choose a song. You can also paste a Spotify URL below.</p>
            {current?.error && canSearch && (
                <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => {
                        setRetry(value => value + 1);
                        setExpanded(true);
                        inputRef.current?.focus();
                    }}>Try search again</Button>
                    {current.reconnect && <Button type="button" variant="outline" size="sm" onClick={() => signIn('spotify', { callbackUrl: '/dashboard' })}>Reconnect Spotify</Button>}
                </div>
            )}
        </div>
    );
}
