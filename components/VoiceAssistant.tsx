import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ChatMessage, Blob } from '../types';
import { MicIcon, StopIcon } from './icons';
import { encode, decode, decodeAudioData, getFriendlyErrorMessage } from '../utils';
import { useDevTools } from '../contexts/DevToolsContext';
import EvoXAvatar from './HomerAvatar';

type AssistantStatus = 'idle' | 'listening' | 'processing' | 'speaking';

const LOCATION_KEYWORDS = [
    'where', 'nearby', 'directions', 'map', 'restaurant', 'cafe', 'park', 'store', 'address', 'find me', 'located', 'how to get to', 'closest'
];
const isLocationQuery = (text: string) => {
    const lowerText = text.toLowerCase();
    return LOCATION_KEYWORDS.some(keyword => lowerText.includes(keyword));
};

const VoiceAssistant: React.FC = () => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [status, setStatus] = useState<AssistantStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const [currentInputTranscription, setCurrentInputTranscription] = useState('');
    const [currentOutputTranscription, setCurrentOutputTranscription] = useState('');
    const { settings } = useDevTools();

    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    
    const silenceTimerRef = useRef<number | null>(null);
    const userHasSpokenThisTurnRef = useRef(false);
    
    const nextStartTimeRef = useRef(0);
    const audioSourcesRef = useRef(new Set<AudioBufferSourceNode>());

    // FIX: Use a ref to hold the current status to avoid stale closures in callbacks.
    const statusRef = useRef(status);
    useEffect(() => {
        statusRef.current = status;
    }, [status]);


    const stopSession = useCallback(() => {
        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then(session => session.close());
            sessionPromiseRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
            inputAudioContextRef.current.close().catch(console.error);
            inputAudioContextRef.current = null;
        }
        if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
            outputAudioContextRef.current.close().catch(console.error);
            outputAudioContextRef.current = null;
        }
        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
        }
        audioSourcesRef.current.forEach(source => source.stop());
        audioSourcesRef.current.clear();
        nextStartTimeRef.current = 0;
        setStatus('idle');
    }, []);

    useEffect(() => {
        return () => stopSession();
    }, [stopSession]);

    const generateAndPlaySpeech = async (text: string) => {
        if (!text.trim()) return;

        try {
            setStatus('speaking');
            const apiKey = process.env.API_KEY;
            if (!apiKey) throw new Error("API_KEY is not configured.");
            const ai = new GoogleGenAI({ apiKey });

            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
                },
            });
            
            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

            if (base64Audio && outputAudioContextRef.current) {
                const ctx = outputAudioContextRef.current;
                if (ctx.state === 'suspended') await ctx.resume();
                
                const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx.destination);
                
                await new Promise<void>(resolve => {
                    source.onended = () => resolve();
                    source.start();
                });
            }
        } catch (err) {
            console.error("TTS generation/playback error:", err);
            setError(getFriendlyErrorMessage(err));
        }
    };
    
    const handleLocationQuery = async (text: string) => {
        setStatus('processing');
        try {
            const position = await new Promise<GeolocationPosition>((resolve, reject) => 
                navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
            );
            
            const apiKey = process.env.API_KEY;
            if (!apiKey) throw new Error("API_KEY is not configured.");
            const ai = new GoogleGenAI({ apiKey });

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: text,
                config: {
                    tools: [{ googleMaps: {} }],
                    toolConfig: {
                        retrievalConfig: {
                            latLng: {
                                latitude: position.coords.latitude,
                                longitude: position.coords.longitude
                            }
                        }
                    }
                }
            });
            
            const responseText = response.text;
            const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;

            setMessages(prev => [...prev, 
                { role: 'user', text },
                { role: 'model', text: responseText, groundingChunks }
            ]);
            
            await generateAndPlaySpeech(responseText);

        } catch (err) {
            console.error("Location query error:", err);
            const userFriendlyError = getFriendlyErrorMessage(err);
            const errorMsg = `Sorry, I couldn't get location data: ${userFriendlyError}. Please ensure location permissions are enabled.`;
            setMessages(prev => [...prev, { role: 'user', text }, { role: 'model', text: errorMsg }]);
            await generateAndPlaySpeech(errorMsg);
        }
    };

    const startSession = useCallback(async () => {
        if (status !== 'idle') return;
        stopSession();
        setError(null);
        setCurrentInputTranscription('');
        setCurrentOutputTranscription('');

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
            setStatus('listening');
            userHasSpokenThisTurnRef.current = false;

            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

            const apiKey = process.env.API_KEY;
            if (!apiKey) throw new Error("API_KEY is not configured.");
            const ai = new GoogleGenAI({ apiKey });

            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => {
                        if (!inputAudioContextRef.current || !mediaStreamRef.current || inputAudioContextRef.current.state === 'closed') return;
                        const source = inputAudioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
                        scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const rms = Math.sqrt(inputData.reduce((acc, val) => acc + val * val, 0) / inputData.length);

                            if (rms > 0.01) {
                                userHasSpokenThisTurnRef.current = true;
                                if (silenceTimerRef.current) {
                                    clearTimeout(silenceTimerRef.current);
                                    silenceTimerRef.current = null;
                                }
                            } else if (userHasSpokenThisTurnRef.current && statusRef.current === 'listening') {
                                if (!silenceTimerRef.current) {
                                    silenceTimerRef.current = window.setTimeout(() => setStatus('processing'), 2000);
                                }
                            }

                            const pcmBlob: Blob = { data: encode(new Uint8Array(new Int16Array(inputData.map(x => x * 32768)).buffer)), mimeType: 'audio/pcm;rate=16000' };
                            sessionPromise.then((session) => session.sendRealtimeInput({ media: pcmBlob }));
                        };
                        source.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
                    },
                    onmessage: (message: LiveServerMessage) => {
                        (async () => {
                            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                            if (base64Audio && outputAudioContextRef.current) {
                                setStatus('speaking');
                                const ctx = outputAudioContextRef.current;
                                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                                const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
                                const source = ctx.createBufferSource();
                                source.buffer = audioBuffer;
                                source.connect(ctx.destination);
                                source.addEventListener('ended', () => audioSourcesRef.current.delete(source));
                                source.start(nextStartTimeRef.current);
                                nextStartTimeRef.current += audioBuffer.duration;
                                audioSourcesRef.current.add(source);
                            }

                            if (message.serverContent?.interrupted) {
                                audioSourcesRef.current.forEach(source => source.stop());
                                audioSourcesRef.current.clear();
                                nextStartTimeRef.current = 0;
                            }

                            if (message.serverContent?.inputTranscription) setCurrentInputTranscription(prev => prev + message.serverContent!.inputTranscription!.text);
                            if (message.serverContent?.outputTranscription) setCurrentOutputTranscription(prev => prev + message.serverContent!.outputTranscription!.text);
                            
                            if (message.serverContent?.turnComplete) {
                                const finalInput = currentInputTranscription + (message.serverContent?.inputTranscription?.text || '');
                                const finalOutput = currentOutputTranscription + (message.serverContent?.outputTranscription?.text || '');
                                
                                setCurrentInputTranscription('');
                                setCurrentOutputTranscription('');
                                
                                if (!finalInput.trim()) {
                                    setStatus('listening');
                                    userHasSpokenThisTurnRef.current = false;
                                    return;
                                }

                                if (isLocationQuery(finalInput)) {
                                    stopSession();
                                    await handleLocationQuery(finalInput);
                                    startSession();
                                } else {
                                    setMessages(prev => [...prev, { role: 'user', text: finalInput }, { role: 'model', text: finalOutput }]);
                                    const timeUntilEnd = (nextStartTimeRef.current - (outputAudioContextRef.current?.currentTime ?? 0));
                                    setTimeout(() => {
                                        if (audioSourcesRef.current.size === 0) {
                                            setStatus('listening');
                                            userHasSpokenThisTurnRef.current = false;
                                        }
                                    }, Math.max(0, timeUntilEnd * 1000) + 200);
                                }
                            }
                        })();
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error("Voice session error:", e.error || e);
                        setError(getFriendlyErrorMessage(e.error || e.message || 'An unknown live session error occurred.'));
                        stopSession();
                    },
                    onclose: () => stopSession(),
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' }}},
                    systemInstruction: settings.systemInstruction,
                }
            });
            sessionPromiseRef.current = sessionPromise;

        } catch (err) {
            console.error("Failed to start voice session:", err);
            setError(getFriendlyErrorMessage(err));
            setStatus('idle');
        }
    }, [status, stopSession, settings.systemInstruction]);
    
    const messagesEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, currentInputTranscription, currentOutputTranscription]);
    
    const avatarState = status === 'speaking' ? 'speaking' : (status === 'listening' || status === 'processing') ? 'thinking' : 'idle';

    const getStatusText = (s: AssistantStatus) => {
        switch (s) {
            case 'idle': return 'Press the button to start the conversation';
            case 'listening': return 'Listening...';
            case 'processing': return 'Thinking...';
            case 'speaking': return 'EVO-X is speaking...';
        }
    };

    return (
        <div className="flex flex-col h-full p-4 items-center justify-center text-center" style={{backgroundColor: 'var(--bg-space)'}}>
             <div className="flex-1 flex flex-col justify-end w-full max-w-3xl">
                <div className="overflow-y-auto pr-2 space-y-4 mb-4">
                    {messages.map((msg, index) => (
                        <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`p-3 rounded-lg text-left overflow-x-auto ${msg.role === 'user' ? 'bg-orange-600' : ''}`} style={msg.role === 'model' ? {backgroundColor: 'var(--bg-panel)'} : {}}>
                                <p className="whitespace-pre-wrap">{msg.text}</p>
                                {msg.groundingChunks && msg.groundingChunks.length > 0 && (
                                    <div className="mt-2 pt-2 border-t border-gray-600/50 text-xs">
                                        <h4 className="font-semibold mb-1 text-gray-400">Sources:</h4>
                                        <ul className="space-y-1">
                                            {msg.groundingChunks.map((chunk, i) => {
                                                const uri = chunk.web?.uri || chunk.maps?.uri;
                                                const title = chunk.web?.title || chunk.maps?.title;
                                                if (!uri) return null;
                                                return <li key={i}><a href={uri} target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:underline truncate block max-w-xs">{title || uri}</a></li>
                                            })}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {currentInputTranscription && <div className="flex justify-end"><div className="p-3 rounded-lg bg-orange-600/70 text-left">{currentInputTranscription}...</div></div>}
                    {currentOutputTranscription && <div className="flex justify-start"><div className="p-3 rounded-lg text-left opacity-70" style={{backgroundColor: 'var(--bg-panel)'}}>{currentOutputTranscription}...</div></div>}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            <EvoXAvatar state={avatarState} />

            <div className="mt-8">
                <button
                    onClick={status !== 'idle' ? stopSession : startSession}
                    className="w-20 h-20 rounded-full flex items-center justify-center transition-colors duration-300"
                    style={{backgroundColor: status !== 'idle' ? '#dc2626' : 'var(--accent-orange)'}}
                >
                    {status !== 'idle' ? <StopIcon className="w-8 h-8 text-white" /> : <MicIcon className="w-8 h-8 text-white" />}
                </button>
            </div>
            {error && <p className="text-red-500 mt-4">{error}</p>}
            <p className="text-gray-400 mt-4 text-sm h-6">
                {getStatusText(status)}
            </p>
        </div>
    );
};

export default VoiceAssistant;