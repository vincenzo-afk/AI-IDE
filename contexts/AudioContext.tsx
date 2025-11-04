import React, { createContext, useRef, useCallback, ReactNode, useState, useEffect } from 'react';
import { decode, decodeAudioData } from '../utils';
import { PlaylistItem } from '../types';

interface AudioPlayerContextType {
    playlist: PlaylistItem[];
    addToPlaylist: (item: PlaylistItem) => void;
    play: (index?: number, playlistOverride?: PlaylistItem[]) => void;
    pause: () => void;
    playNext: () => void;
    playPrev: () => void;
    clearPlaylist: () => void;
    isPlaying: boolean;
    currentIndex: number | null;
}

export const AudioPlayerContext = createContext<AudioPlayerContextType>({
    playlist: [],
    addToPlaylist: () => {},
    play: () => {},
    pause: () => {},
    playNext: () => {},
    playPrev: () => {},
    clearPlaylist: () => {},
    isPlaying: false,
    currentIndex: null,
});

export const AudioPlayerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentIndex, setCurrentIndex] = useState<number | null>(null);

    const audioContextRef = useRef<AudioContext | null>(null);
    const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

    const getAudioContext = useCallback(() => {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        return audioContextRef.current;
    }, []);
    
    const stopCurrentTrack = () => {
        if (currentSourceRef.current) {
            currentSourceRef.current.onended = null; // Prevent onended from firing on manual stop
            try {
                currentSourceRef.current.stop();
            } catch (e) {
                // Ignore errors from stopping an already stopped source
            }
            currentSourceRef.current = null;
        }
        setIsPlaying(false);
    };

    const play = useCallback(async (index?: number, playlistOverride?: PlaylistItem[]) => {
        const effectivePlaylist = playlistOverride || playlist;
        const trackIndex = index ?? currentIndex ?? 0;
        
        if (trackIndex >= effectivePlaylist.length || trackIndex < 0) return;

        stopCurrentTrack();
        
        if (playlistOverride) {
            setPlaylist(playlistOverride);
            setCurrentIndex(0);
        } else {
            setCurrentIndex(trackIndex);
        }

        const item = effectivePlaylist[trackIndex];
        const ctx = getAudioContext();

        try {
            setIsPlaying(true);
            const audioBuffer = await decodeAudioData(decode(item.base64Audio), ctx, 24000, 1);
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);
            currentSourceRef.current = source;
            
            source.onended = () => {
                if (currentSourceRef.current === source) {
                    currentSourceRef.current = null;
                    setIsPlaying(false);
                    
                    const isOverride = !!playlistOverride;
                    
                    if (isOverride) {
                        setPlaylist([]);
                        setCurrentIndex(null);
                    } else if (currentIndex !== null && currentIndex < playlist.length - 1) {
                         play(currentIndex + 1); // Play next
                    } else {
                         setCurrentIndex(null); // End of playlist
                    }
                }
            };
            source.start();
        } catch (error) {
            console.error("Failed to play audio:", error);
            setIsPlaying(false);
        }
    }, [playlist, currentIndex, getAudioContext]);

    const pause = () => {
        stopCurrentTrack();
    };

    const playNext = useCallback(() => {
        if (currentIndex !== null && currentIndex < playlist.length - 1) {
            play(currentIndex + 1);
        }
    }, [currentIndex, playlist, play]);

    const playPrev = useCallback(() => {
        if (currentIndex !== null && currentIndex > 0) {
            play(currentIndex - 1);
        }
    }, [currentIndex, play]);

    const addToPlaylist = (item: PlaylistItem) => {
        setPlaylist(prev => [...prev, item]);
    };
    
    const clearPlaylist = () => {
        stopCurrentTrack();
        setPlaylist([]);
        setCurrentIndex(null);
    };

    // Auto-play when a new song is added to an empty playlist
    useEffect(() => {
        if (playlist.length === 1 && !isPlaying && currentIndex === null) {
            play(0);
        }
    }, [playlist, isPlaying, currentIndex, play]);

    return (
        <AudioPlayerContext.Provider value={{ playlist, addToPlaylist, play, pause, playNext, playPrev, clearPlaylist, isPlaying, currentIndex }}>
            {children}
        </AudioPlayerContext.Provider>
    );
};