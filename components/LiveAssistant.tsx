import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { Blob } from '../types';
import { decode, decodeAudioData, encode, fileToBase64, getFriendlyErrorMessage } from '../utils';
import { CameraIcon, ScreenShareIcon, SwitchCameraIcon, DownloadIcon, SubtitlesOnIcon, SubtitlesOffIcon, WrenchScrewdriverIcon } from './icons';

const FRAME_RATE = 1; // Send 1 frame per second
const JPEG_QUALITY = 0.7;
type LiveSource = 'camera' | 'screen';
type TranscriptEntry = { type: 'chat', user: string, model: string } | { type: 'tool', text: string };

const getWeatherFunctionDeclaration: FunctionDeclaration = {
  name: 'get_weather',
  parameters: {
    type: Type.OBJECT,
    description: 'Get the current weather in a given location',
    properties: {
      location: { type: Type.STRING, description: 'The city and state, e.g. San Francisco, CA' },
    },
    required: ['location'],
  },
};

const getTimeFunctionDeclaration: FunctionDeclaration = {
  name: 'get_time',
  parameters: {
    type: Type.OBJECT,
    description: 'Get the current time.',
    properties: {},
  },
};

const LiveAssistant: React.FC = () => {
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
    const [currentInputTranscription, setCurrentInputTranscription] = useState('');
    const [currentOutputTranscription, setCurrentOutputTranscription] = useState('');
    const [liveSource, setLiveSource] = useState<LiveSource>('camera');
    const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
    const [zoomLevel, setZoomLevel] = useState<number>(1);
    const [zoomCapabilities, setZoomCapabilities] = useState<{ min: number, max: number, step: number } | null>(null);
    const [showSubtitles, setShowSubtitles] = useState(true);
    const [isUserSpeaking, setIsUserSpeaking] = useState(false);

    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameIntervalRef = useRef<number | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const speakingTimerRef = useRef<number | null>(null);
    
    // Ref to hold the latest state setter to avoid stale closures in callbacks
    const setIsUserSpeakingRef = useRef(setIsUserSpeaking);
    useEffect(() => {
        setIsUserSpeakingRef.current = setIsUserSpeaking;
    });
    
    const stopSession = useCallback(() => {
        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then(session => session.close());
            sessionPromiseRef.current = null;
        }
        if (frameIntervalRef.current) {
            window.clearInterval(frameIntervalRef.current);
            frameIntervalRef.current = null;
        }
        if (speakingTimerRef.current) {
            clearTimeout(speakingTimerRef.current);
            speakingTimerRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
             inputAudioContextRef.current.close();
             inputAudioContextRef.current = null;
        }
        if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
             outputAudioContextRef.current.close();
             outputAudioContextRef.current = null;
        }
        if(scriptProcessorRef.current){
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
        setIsSessionActive(false);
        setIsUserSpeaking(false);
        setCurrentInputTranscription('');
        setCurrentOutputTranscription('');
        setZoomCapabilities(null);
        setZoomLevel(1);
    }, []);

    const handleSwitchCamera = () => {
        setFacingMode(prev => (prev === 'environment' ? 'user' : 'environment'));
    };
    
    const startSession = async () => {
        stopSession();
        setError(null);
        setTranscripts([]);
        setIsSessionActive(true);

        try {
            let stream;
            if (liveSource === 'screen') {
                const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const audioTrack = audioStream.getAudioTracks()[0];
                const videoTrack = displayStream.getVideoTracks()[0];
                stream = new MediaStream([videoTrack, audioTrack]);
                videoTrack.onended = () => stopSession();
            } else { // camera
                const constraints: MediaStreamConstraints = {
                    audio: true,
                    video: { facingMode },
                };
                stream = await navigator.mediaDevices.getUserMedia(constraints);
            }
            mediaStreamRef.current = stream;
            
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) {
                try {
                    const capabilities = videoTrack.getCapabilities();
                    // @ts-ignore - 'zoom' is a valid capability but may not be in all TS DOM lib versions.
                    if (capabilities.zoom) {
                        // @ts-ignore
                        setZoomCapabilities({ min: capabilities.zoom.min, max: capabilities.zoom.max, step: capabilities.zoom.step });
                        const settings = videoTrack.getSettings();
                         // @ts-ignore
                        if (settings.zoom) {
                             // @ts-ignore
                            setZoomLevel(settings.zoom);
                        }
                    }
                } catch (e) {
                    console.warn("Could not get zoom capabilities:", e);
                }
            }

            if (videoRef.current) {
                videoRef.current.srcObject = mediaStreamRef.current;
            }

            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            
            let nextStartTime = 0;
            const sources = new Set<AudioBufferSourceNode>();

            const apiKey = process.env.API_KEY;
            if (!apiKey) throw new Error("API_KEY is not configured.");
            
            const ai = new GoogleGenAI({ apiKey });
            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => {
                        // FIX: Added guard to prevent crash on rapid start/stop or other race conditions.
                        if (!inputAudioContextRef.current || !mediaStreamRef.current || inputAudioContextRef.current.state === 'closed') {
                            console.warn("LiveAssistant: onopen called but session was already stopped or context is invalid.");
                            return;
                        }
                        const source = inputAudioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
                        scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
                        
                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);

                            // Voice Activity Detection (VAD) for visual feedback
                            const SILENCE_THRESHOLD = 0.01;
                            const rms = Math.sqrt(inputData.reduce((acc, val) => acc + val * val, 0) / inputData.length);
                            if (rms > SILENCE_THRESHOLD) {
                                if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
                                setIsUserSpeakingRef.current(true);
                                speakingTimerRef.current = window.setTimeout(() => setIsUserSpeakingRef.current(false), 500);
                            }

                            const l = inputData.length;
                            const int16 = new Int16Array(l);
                            for (let i = 0; i < l; i++) { int16[i] = inputData[i] * 32768; }
                            const pcmBlob: Blob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
                            sessionPromise.then((session) => { session.sendRealtimeInput({ media: pcmBlob }); });
                        };
                        source.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);

                        frameIntervalRef.current = window.setInterval(() => {
                           if (videoRef.current && canvasRef.current && videoRef.current.readyState >= 3) {
                                const ctx = canvasRef.current.getContext('2d');
                                if(ctx) {
                                    canvasRef.current.width = videoRef.current.videoWidth;
                                    canvasRef.current.height = videoRef.current.videoHeight;
                                    ctx.drawImage(videoRef.current, 0, 0, videoRef.current.videoWidth, videoRef.current.videoHeight);
                                    canvasRef.current.toBlob(
                                        async (blob) => {
                                            if (blob) {
                                                const base64Data = await fileToBase64(blob);
                                                sessionPromise.then((session) => { session.sendRealtimeInput({ media: { data: base64Data, mimeType: 'image/jpeg' } }); });
                                            }
                                        }, 'image/jpeg', JPEG_QUALITY
                                    );
                                }
                           }
                        }, 1000 / FRAME_RATE);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                        if (base64Audio && outputAudioContextRef.current) {
                            nextStartTime = Math.max(nextStartTime, outputAudioContextRef.current.currentTime);
                            const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContextRef.current, 24000, 1);
                            const source = outputAudioContextRef.current.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(outputAudioContextRef.current.destination);
                            source.addEventListener('ended', () => sources.delete(source));
                            source.start(nextStartTime);
                            nextStartTime += audioBuffer.duration;
                            sources.add(source);
                        }
                        
                        if (message.toolCall) {
                            for (const fc of message.toolCall.functionCalls) {
                                if (fc.name === 'get_weather') {
                                    const location = fc.args.location || 'an unspecified location';
                                    const weather = `The weather in ${location} is sunny and 75°F.`;
                                    setTranscripts(prev => [...prev, { type: 'tool', text: `Tool Call: getWeather for "${location}"` }]);
                                    
                                    sessionPromise.then((session) => {
                                        session.sendToolResponse({
                                            functionResponses: { id : fc.id, name: fc.name, response: { result: weather } }
                                        });
                                    });
                                } else if (fc.name === 'get_time') {
                                    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                    const timeResponse = `The current time is ${currentTime}.`;
                                    setTranscripts(prev => [...prev, { type: 'tool', text: `Tool Call: getTime` }]);
                                    
                                    sessionPromise.then((session) => {
                                        session.sendToolResponse({
                                            functionResponses: { id: fc.id, name: fc.name, response: { result: timeResponse } }
                                        });
                                    });
                                }
                            }
                        }

                        if (message.serverContent?.interrupted) { sources.forEach(source => source.stop()); sources.clear(); nextStartTime = 0; }
                        if (message.serverContent?.inputTranscription) { setCurrentInputTranscription(prev => prev + message.serverContent!.inputTranscription!.text); }
                        if (message.serverContent?.outputTranscription) { setCurrentOutputTranscription(prev => prev + message.serverContent!.outputTranscription!.text); }
                        if (message.serverContent?.turnComplete) {
                            const finalInput = currentInputTranscription + (message.serverContent?.inputTranscription?.text || '');
                            const finalOutput = currentOutputTranscription + (message.serverContent?.outputTranscription?.text || '');
                            if (finalInput.trim() || finalOutput.trim()){
                                setTranscripts(prev => [...prev, { type: 'chat', user: finalInput, model: finalOutput }]);
                            }
                            setCurrentInputTranscription('');
                            setCurrentOutputTranscription('');
                        }
                    },
                    onerror: (e: ErrorEvent) => { 
                        // FIX: Improved error handling to provide more specific and useful messages.
                        console.error('Live session error:', e.error || e); 
                        setError(getFriendlyErrorMessage(e.error || e.message || 'An unknown live session error occurred.')); 
                        stopSession(); 
                    },
                    onclose: (e: CloseEvent) => { stopSession(); },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' }}},
                    systemInstruction: "You are EVO-X, a powerful real-time analysis engine. Your primary function is to continuously analyze the incoming video and audio stream. As you process the feed, provide a constant audio narration of your findings. Your analysis should include: 1. **Object and Scene Detection:** Verbally identify and describe objects, people, and the environment. 2. **Action Recognition:** Describe any actions or events as they happen. 3. **Emotion Recognition:** Analyze the user's tone of voice and facial expressions to identify their emotional state. 4. **Speech Transcription:** Transcribe what the user is saying. While maintaining your analysis stream, also engage in a natural, helpful conversation based on the user's speech and the visual context.",
                    tools: [{functionDeclarations: [getWeatherFunctionDeclaration, getTimeFunctionDeclaration]}],
                }
            });
            sessionPromiseRef.current = sessionPromise;
        } catch (err) {
            console.error("Failed to start session:", err);
            const userFriendlyError = err instanceof Error ? err.message : "Could not access camera/microphone/screen. Please check permissions.";
            setError(`Failed to start session: ${userFriendlyError}`);
            setIsSessionActive(false);
        }
    };
    
    const handleDownloadTranscript = () => {
        if (transcripts.length === 0) return;
        const transcriptText = transcripts.map(t => {
                if (t.type === 'chat') {
                    return `You: ${t.user}\n\nEVO-X: ${t.model}`
                }
                return `[${t.text}]`;
            }).join('\n\n---\n\n');
        const blob = new Blob([transcriptText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'evox-live-transcript.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleZoomChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!mediaStreamRef.current) return;
        const videoTrack = mediaStreamRef.current.getVideoTracks()[0];
        if (videoTrack && zoomCapabilities) {
            try {
                const newZoom = parseFloat(event.target.value);
                setZoomLevel(newZoom);
                // @ts-ignore
                await videoTrack.applyConstraints({ advanced: [{ zoom: newZoom }] });
            } catch (err) {
                console.error('Error applying zoom:', err);
            }
        }
    }, [zoomCapabilities]);

    useEffect(() => { return () => stopSession(); }, [stopSession]);
    
    return (
        <div className="flex flex-col h-full p-4" style={{backgroundColor: 'var(--bg-space)'}}>
            <div className="flex-shrink-0 mb-4 space-y-4">
                <div className="flex items-center justify-center space-x-2">
                    <button onClick={() => setLiveSource('camera')} disabled={isSessionActive} className={`flex items-center space-x-2 px-4 py-2 rounded-md transition ${liveSource === 'camera' ? 'text-white' : 'text-gray-400 hover:text-white'} disabled:opacity-50`} style={{backgroundColor: liveSource === 'camera' ? 'var(--accent-orange)' : 'var(--bg-panel)'}}>
                        <CameraIcon className="w-5 h-5" />
                        <span>Camera</span>
                    </button>
                    <button onClick={() => setLiveSource('screen')} disabled={isSessionActive} className={`flex items-center space-x-2 px-4 py-2 rounded-md transition ${liveSource === 'screen' ? 'text-white' : 'text-gray-400 hover:text-white'} disabled:opacity-50`} style={{backgroundColor: liveSource === 'screen' ? 'var(--accent-orange)' : 'var(--bg-panel)'}}>
                        <ScreenShareIcon className="w-5 h-5" />
                        <span>Screen</span>
                    </button>
                    <button onClick={handleSwitchCamera} disabled={isSessionActive || liveSource !== 'camera'} className="p-2 rounded-md transition hover:text-white disabled:opacity-50 disabled:cursor-not-allowed" title="Switch Camera" style={{backgroundColor: 'var(--bg-panel)'}}>
                        <SwitchCameraIcon className="w-6 h-6" />
                    </button>
                     <button onClick={() => setShowSubtitles(prev => !prev)} className="p-2 rounded-md transition hover:text-white" title={showSubtitles ? "Hide Subtitles" : "Show Subtitles"} style={{backgroundColor: 'var(--bg-panel)'}}>
                        {showSubtitles ? <SubtitlesOnIcon className="w-6 h-6" /> : <SubtitlesOffIcon className="w-6 h-6" />}
                    </button>
                </div>

                {liveSource === 'camera' && zoomCapabilities && (
                    <div className="flex items-center space-x-3 p-2 rounded-md" style={{backgroundColor: 'var(--bg-panel)'}}>
                        <label htmlFor="zoom-slider" className="text-sm font-medium">Zoom</label>
                        <input id="zoom-slider" type="range" min={zoomCapabilities.min} max={zoomCapabilities.max} step={zoomCapabilities.step} value={zoomLevel} onChange={handleZoomChange} disabled={!isSessionActive} className="w-full h-2 rounded-lg appearance-none cursor-pointer disabled:opacity-50" style={{backgroundColor: 'var(--bg-deep-space)'}}/>
                        <span className="text-sm font-mono w-12 text-center" style={{color: 'var(--accent-orange)'}}>{zoomLevel.toFixed(1)}x</span>
                    </div>
                )}

                <button
                    onClick={isSessionActive ? stopSession : startSession}
                    className={`w-full font-bold py-3 px-4 rounded-md transition-colors ${isSessionActive ? 'bg-red-600 hover:bg-red-500' : ''}`}
                    style={!isSessionActive ? {backgroundColor: 'var(--accent-orange)'} : {}}
                    onMouseOver={e => !isSessionActive ? e.currentTarget.style.backgroundColor='var(--accent-orange-hover)' : {}}
                    onMouseOut={e => !isSessionActive ? e.currentTarget.style.backgroundColor='var(--accent-orange)' : {}}
                >
                    {isSessionActive ? 'Stop Live Session' : `Start Live Session with ${liveSource === 'camera' ? 'Camera' : 'Screen'}`}
                </button>
                 {error && <p className="text-red-500 text-center mt-2">{error}</p>}
            </div>

            <div className={`flex-1 grid grid-cols-1 ${showSubtitles ? 'md:grid-cols-2' : ''} gap-4 overflow-hidden`}>
                <div className={`relative rounded-lg overflow-hidden transition-all duration-300 ${isSessionActive ? 'ring-2 ring-offset-2 ring-offset-black' : ''}`} style={{backgroundColor: 'var(--bg-deep-space)', borderColor: 'var(--accent-orange)'}}>
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain"></video>
                    <canvas ref={canvasRef} className="hidden"></canvas>
                    {!isSessionActive && <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50"><p className="text-xl text-gray-400">Live source is off</p></div>}
                </div>
                {showSubtitles && (
                    <div className={`rounded-lg p-3 flex flex-col overflow-y-auto transition-all duration-300 ring-offset-2 ring-offset-bg-space ${isUserSpeaking ? 'ring-2 ring-orange-500' : 'ring-0 ring-transparent'}`} style={{backgroundColor: 'var(--bg-deep-space)'}}>
                        <div className="flex items-center justify-between mb-2 pb-2 border-b" style={{borderColor: 'var(--border-primary)'}}>
                            <h3 className="text-lg font-semibold" style={{color: 'var(--accent-orange)'}}>Live Transcript</h3>
                            <button onClick={handleDownloadTranscript} disabled={isSessionActive || transcripts.length === 0} className="p-2 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed" title="Download Transcript">
                                <DownloadIcon className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="flex-1 space-y-4 text-sm pr-2 pb-20">
                            {transcripts.map((t, i) => (
                                <div key={i}>
                                {t.type === 'tool' ? (
                                    <div className="flex items-center space-x-2 text-cyan-400 p-2 rounded-md" style={{backgroundColor: 'rgba(0, 150, 200, 0.1)'}}>
                                        <WrenchScrewdriverIcon className="w-4 h-4 flex-shrink-0"/>
                                        <p className="italic">{t.text}</p>
                                    </div>
                                ) : (
                                    <>
                                        <div className="p-2 rounded-md" style={{backgroundColor: 'var(--bg-panel)'}}><strong className="text-gray-400">You:</strong> {t.user}</div>
                                        <div className="mt-1 p-2 rounded-md" style={{backgroundColor: 'rgba(247, 120, 41, 0.1)'}}><strong style={{color: 'var(--accent-orange)'}}>EVO-X:</strong> {t.model}</div>
                                    </>
                                )}
                                </div>
                            ))}
                            {currentInputTranscription && <div className="p-2 rounded-md opacity-70" style={{backgroundColor: 'var(--bg-panel)'}}><strong className="text-gray-400">You:</strong> {currentInputTranscription}...</div>}
                            {currentOutputTranscription && <div className="p-2 rounded-md opacity-70" style={{backgroundColor: 'rgba(247, 120, 41, 0.1)'}}><strong style={{color: 'var(--accent-orange)'}}>EVO-X:</strong> {currentOutputTranscription}...</div>}
                            {isSessionActive && !currentInputTranscription && !currentOutputTranscription && transcripts.length === 0 && <p className="text-gray-500">Listening...</p>}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LiveAssistant;