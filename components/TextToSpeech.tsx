import React, { useState, useContext } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { AudioPlayerContext } from '../contexts/AudioContext';
import { AddIcon } from './icons';
import { PlaylistItem } from '../types';
import { decode, decodeAudioData, getFriendlyErrorMessage } from '../utils';

const voices = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];
type TTSMode = 'single' | 'multi';

const TextToSpeech: React.FC = () => {
    const [mode, setMode] = useState<TTSMode>('single');
    const [text, setText] = useState('Say cheerfully: Have a wonderful day!');
    const [script, setScript] = useState('Joe: How\'s it going today Jane?\nJane: Not too bad, how about you?');
    const [selectedVoice, setSelectedVoice] = useState('Kore');
    const [speaker1Name, setSpeaker1Name] = useState('Joe');
    const [speaker1Voice, setSpeaker1Voice] = useState('Kore');
    const [speaker2Name, setSpeaker2Name] = useState('Jane');
    const [speaker2Voice, setSpeaker2Voice] = useState('Puck');
    const [isLoading, setIsLoading] = useState(false);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { play, addToPlaylist } = useContext(AudioPlayerContext);

    const generateSpeech = async (prompt: string, voice: string, multiSpeakerConfig?: any) => {
        if (!prompt) {
            setError('Please enter some text.');
            return null;
        }
        setError(null);
        try {
            const apiKey = process.env.API_KEY;
            if (!apiKey) throw new Error("API_KEY is not configured.");
            const ai = new GoogleGenAI({ apiKey });

            const config: any = {
                responseModalities: [Modality.AUDIO],
                speechConfig: multiSpeakerConfig 
                    ? { multiSpeakerVoiceConfig: multiSpeakerConfig }
                    : { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            };

            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: prompt }] }],
                config,
            });
            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!base64Audio) throw new Error("No audio data received.");
            return base64Audio;
        } catch (err) {
            console.error("TTS error:", err);
            setError(getFriendlyErrorMessage(err));
            return null;
        }
    };
    
    const handleGenerate = async () => {
        setIsLoading(true);
        let base64Audio;
        let name;

        if (mode === 'single') {
            base64Audio = await generateSpeech(text, selectedVoice);
            name = `"${text.substring(0, 25)}..."`;
        } else {
            const prompt = `TTS the following conversation between ${speaker1Name} and ${speaker2Name}:\n${script}`;
            const multiSpeakerConf = {
                speakerVoiceConfigs: [
                    { speaker: speaker1Name, voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker1Voice } } },
                    { speaker: speaker2Name, voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker2Voice } } }
                ]
            };
            base64Audio = await generateSpeech(prompt, '', multiSpeakerConf);
            name = `Dialogue: ${speaker1Name} & ${speaker2Name}`;
        }
        setIsLoading(false);
        return { base64Audio, name };
    };

    const handleGenerateAndPlay = async () => {
        const { base64Audio, name } = await handleGenerate();
        if (base64Audio && name) {
            const newItem: PlaylistItem = { id: `tts-${Date.now()}`, name, base64Audio, source: 'TTS Studio' };
            addToPlaylist(newItem);
        }
    };
    
    const handleAddToPlaylist = async () => {
        const { base64Audio, name } = await handleGenerate();
        if (base64Audio && name) {
            const newItem: PlaylistItem = { id: `tts-${Date.now()}`, name, base64Audio, source: 'TTS Studio' };
            addToPlaylist(newItem);
        }
    };
    
    const handlePreviewVoice = async (voice: string) => {
        setIsPreviewLoading(true);
        const base64Audio = await generateSpeech("Hello, this is a preview of my voice.", voice);
        setIsPreviewLoading(false);

        if (base64Audio) {
            try {
                const previewCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                const audioBuffer = await decodeAudioData(decode(base64Audio), previewCtx, 24000, 1);
                const source = previewCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(previewCtx.destination);
                source.start();
                source.onended = () => { previewCtx.close(); };
            } catch (err) {
                console.error("Failed to play preview:", err);
                setError("Could not play the audio preview.");
            }
        }
    };

    const anyLoading = isLoading || isPreviewLoading;
    
    return (
        <div className="h-full flex items-center justify-center p-4" style={{backgroundColor: 'var(--bg-space)'}}>
            <div className="w-full max-w-2xl rounded-lg space-y-4 p-6" style={{backgroundColor: 'var(--bg-panel)'}}>
                <h3 className="text-2xl font-bold text-center" style={{color: 'var(--accent-orange)'}}>Text-to-Speech Studio</h3>
                <div className="flex border-b" style={{borderColor: 'var(--border-primary)'}}>
                    <button onClick={() => setMode('single')} className={`relative px-4 py-3 font-semibold transition-colors ${mode === 'single' ? 'text-white' : 'text-gray-400 hover:text-white'}`}>Single Speaker {mode === 'single' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-full"></span>}</button>
                    <button onClick={() => setMode('multi')} className={`relative px-4 py-3 font-semibold transition-colors ${mode === 'multi' ? 'text-white' : 'text-gray-400 hover:text-white'}`}>Multi-Speaker {mode === 'multi' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-full"></span>}</button>
                </div>

                {mode === 'single' && (
                    <div className="space-y-4">
                        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter text..." className="w-full h-32 p-3 rounded-md focus:outline-none" style={{backgroundColor: 'var(--bg-deep-space)', border: '1px solid var(--border-primary)'}} disabled={anyLoading}/>
                        <div className="flex items-center space-x-4">
                            <label htmlFor="voice-select" className="font-semibold">Voice:</label>
                            <select id="voice-select" value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)} className="w-full p-2 rounded-md" style={{backgroundColor: 'var(--bg-deep-space)', border: '1px solid var(--border-primary)'}} disabled={anyLoading}>
                                {voices.map(voice => <option key={voice} value={voice}>{voice}</option>)}
                            </select>
                            <button onClick={() => handlePreviewVoice(selectedVoice)} disabled={anyLoading} className="font-semibold py-2 px-4 rounded-md disabled:opacity-50 transition-colors" style={{backgroundColor: 'var(--bg-space)', border: '1px solid var(--border-primary)'}} onMouseOver={e => e.currentTarget.style.borderColor='var(--text-secondary)'} onMouseOut={e => e.currentTarget.style.borderColor='var(--border-primary)'}>
                                {isPreviewLoading ? '...' : 'Preview'}
                            </button>
                        </div>
                    </div>
                )}
                
                {mode === 'multi' && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {[1, 2].map(num => {
                                const name = num === 1 ? speaker1Name : speaker2Name;
                                const setName = num === 1 ? setSpeaker1Name : setSpeaker2Name;
                                const voice = num === 1 ? speaker1Voice : speaker2Voice;
                                const setVoice = num === 1 ? setSpeaker1Voice : setSpeaker2Voice;
                                return (
                                <div key={num} className="p-3 rounded-md space-y-2" style={{backgroundColor: 'var(--bg-space)'}}>
                                    <label className="font-semibold">Speaker {num}</label>
                                    <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={`Name (e.g., ${num === 1 ? 'Joe' : 'Jane'})`} className="w-full p-2 rounded-md" style={{backgroundColor: 'var(--bg-deep-space)', border: '1px solid var(--border-primary)'}}/>
                                    <select value={voice} onChange={e => setVoice(e.target.value)} className="w-full p-2 rounded-md" style={{backgroundColor: 'var(--bg-deep-space)', border: '1px solid var(--border-primary)'}} disabled={anyLoading}>
                                        {voices.map(v => <option key={v} value={v}>{v}</option>)}
                                    </select>
                                    <button onClick={() => handlePreviewVoice(voice)} disabled={anyLoading} className="w-full text-sm font-semibold py-1 px-2 rounded-md disabled:opacity-50 transition-colors" style={{backgroundColor: 'var(--bg-deep-space)', border: '1px solid var(--border-primary)'}} onMouseOver={e => e.currentTarget.style.borderColor='var(--text-secondary)'} onMouseOut={e => e.currentTarget.style.borderColor='var(--border-primary)'}>
                                        {isPreviewLoading ? '...' : 'Preview Voice'}
                                    </button>
                                </div>
                            )})}
                        </div>
                        <textarea value={script} onChange={(e) => setScript(e.target.value)} placeholder={`Enter script, like:\n${speaker1Name}: Hello!\n${speaker2Name}: Hi there.`} className="w-full h-32 p-3 rounded-md" style={{backgroundColor: 'var(--bg-deep-space)', border: '1px solid var(--border-primary)'}} disabled={anyLoading} />
                    </div>
                )}

                {error && <p className="text-red-500 text-sm">{error}</p>}
                <div className="flex gap-4 pt-2">
                    <button onClick={handleGenerateAndPlay} disabled={anyLoading} className="w-full font-bold py-3 px-4 rounded-md disabled:opacity-50 transition-colors" style={{backgroundColor: 'var(--accent-orange)', color: 'white'}} onMouseOver={e => e.currentTarget.style.backgroundColor='var(--accent-orange-hover)'} onMouseOut={e => e.currentTarget.style.backgroundColor='var(--accent-orange)'}>
                        {isLoading ? 'Generating...' : 'Generate and Play'}
                    </button>
                    <button onClick={handleAddToPlaylist} disabled={anyLoading} title="Add to Playlist" className="font-bold py-3 px-4 rounded-md disabled:opacity-50 transition-colors" style={{backgroundColor: 'var(--bg-space)', border: '1px solid var(--border-primary)'}} onMouseOver={e => e.currentTarget.style.borderColor='var(--text-secondary)'} onMouseOut={e => e.currentTarget.style.borderColor='var(--border-primary)'}>
                        <AddIcon className="w-6 h-6" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TextToSpeech;