import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, FunctionDeclaration, Type, GenerateContentResponse } from '@google/genai';
import { useDevTools } from '../contexts/DevToolsContext';
import { BoltIcon } from './icons';
import { StreamedResponse } from './StreamedResponse';
import { getFriendlyErrorMessage } from '../utils';

type Device = 'light' | 'thermostat' | 'music';
type Message = { role: 'user' | 'model'; text: string; tool?: string };

const controlLight: FunctionDeclaration = {
    name: 'controlLight',
    parameters: {
        type: Type.OBJECT,
        description: 'Set the state and brightness of a light.',
        properties: {
            on: { type: Type.BOOLEAN, description: 'Whether the light should be on or off.' },
            brightness: { type: Type.NUMBER, description: 'Light level from 0 to 100.' },
        },
        required: ['on'],
    },
};

const controlThermostat: FunctionDeclaration = {
    name: 'controlThermostat',
    parameters: {
        type: Type.OBJECT,
        description: 'Set the temperature of the thermostat.',
        properties: {
            temperature: { type: Type.NUMBER, description: 'The target temperature.' },
            unit: { type: Type.STRING, description: 'Temperature unit, either "celsius" or "fahrenheit". Default is fahrenheit.', enum: ["celsius", "fahrenheit"] },
        },
        required: ['temperature'],
    },
};

const controlMusic: FunctionDeclaration = {
    name: 'controlMusic',
    parameters: {
        type: Type.OBJECT,
        description: 'Control music playback.',
        properties: {
            playing: { type: Type.BOOLEAN, description: 'Whether music should be playing or paused.' },
            genre: { type: Type.STRING, description: 'The genre of music to play.' },
        },
        required: ['playing'],
    },
};

const ControlPanel: React.FC = () => {
    // Device states
    const [lightOn, setLightOn] = useState(true);
    const [lightBrightness, setLightBrightness] = useState(80);
    const [temperature, setTemperature] = useState(68);
    const [musicPlaying, setMusicPlaying] = useState(false);
    const [musicGenre, setMusicGenre] = useState('None');

    // Chat states
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { settings } = useDevTools();
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSendMessage = async () => {
        if (!input.trim()) return;
        const userMessage: Message = { role: 'user', text: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const apiKey = process.env.API_KEY;
            if (!apiKey) throw new Error("API_KEY is not configured.");
            const ai = new GoogleGenAI({ apiKey });

            const response: GenerateContentResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: input,
                config: {
                    ...settings,
                    tools: [{ functionDeclarations: [controlLight, controlThermostat, controlMusic] }],
                },
            });
            
            let modelResponseText = response.text;
            let toolUsed = '';

            if (response.functionCalls && response.functionCalls.length > 0) {
                for (const fc of response.functionCalls) {
                    toolUsed += `[Tool Call: ${fc.name}] `;
                    switch (fc.name) {
                        case 'controlLight':
                            if (fc.args.on !== undefined) {
                                setLightOn(Boolean(fc.args.on));
                            }
                            if (fc.args.brightness !== undefined) {
                                const brightness = Number(fc.args.brightness);
                                if (!isNaN(brightness)) {
                                    setLightBrightness(Math.max(0, Math.min(100, brightness)));
                                }
                            }
                            break;
                        case 'controlThermostat':
                             if (fc.args.temperature !== undefined) {
                                const temp = Number(fc.args.temperature);
                                if (!isNaN(temp)) {
                                    setTemperature(temp);
                                }
                            }
                            // Unit handling could be added here
                            break;
                        case 'controlMusic':
                            if (fc.args.playing !== undefined) {
                                setMusicPlaying(Boolean(fc.args.playing));
                            }
                             if (fc.args.genre) {
                                setMusicGenre(String(fc.args.genre));
                            }
                            break;
                    }
                }
            }
            if (!modelResponseText && toolUsed) {
                modelResponseText = "Okay, I've updated the device for you.";
            }

            setMessages(prev => [...prev, { role: 'model', text: modelResponseText, tool: toolUsed || undefined }]);
        } catch (error) {
            console.error("Control Panel error:", error);
            const userFriendlyError = getFriendlyErrorMessage(error);
            setMessages(prev => [...prev, { role: 'model', text: `Sorry, an error occurred: ${userFriendlyError}` }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="h-full p-4 grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ backgroundColor: 'var(--bg-space)' }}>
            {/* Control Modules */}
            <div className="space-y-4 flex flex-col">
                <div className="text-center mb-4">
                    <BoltIcon className="w-12 h-12 mx-auto" style={{ color: 'var(--accent-orange)' }} />
                    <h2 className="text-2xl font-bold mt-2" style={{ color: 'var(--accent-orange)' }}>EVO-X Control Panel</h2>
                    <p style={{ color: 'var(--text-secondary)' }}>Use natural language to control your environment.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Light Control */}
                    <div className="p-4 rounded-lg flex flex-col items-center justify-center transition-all duration-300" style={{ backgroundColor: lightOn ? 'rgba(247, 120, 41, 0.15)' : 'var(--bg-panel)', border: '1px solid var(--border-primary)' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" className={`w-16 h-16 mb-4 transition-colors duration-300 ${lightOn ? 'text-yellow-300' : 'text-gray-500'}`} viewBox="0 0 20 20" fill="currentColor">
                            <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.657a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 14.95a1 1 0 001.414 1.414l.707-.707a1 1 0 00-1.414-1.414l-.707.707zM4 10a1 1 0 01-1 1H2a1 1 0 110-2h1a1 1 0 011 1zM10 18a1 1 0 011-1v1a1 1 0 11-2 0v-1a1 1 0 011 1zM3.939 3.939a1 1 0 00-1.414 1.414l.707.707a1 1 0 001.414-1.414L3.94 3.94zM10 5.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9z" />
                        </svg>
                        <h3 className="font-semibold text-white">Main Light</h3>
                        <p className={`text-sm mb-3 ${lightOn ? 'text-yellow-300' : 'text-gray-400'}`}>{lightOn ? `On - ${lightBrightness}%` : 'Off'}</p>
                        <input type="range" min="0" max="100" value={lightBrightness} readOnly disabled={!lightOn} className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-orange-500 disabled:opacity-30" />
                    </div>
                    {/* Thermostat */}
                    <div className="p-4 rounded-lg flex flex-col items-center justify-center" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-primary)' }}>
                         <div className="w-24 h-24 rounded-full border-4 flex items-center justify-center mb-3" style={{borderColor: 'var(--accent-orange)'}}>
                            <span className="text-3xl font-bold text-white">{temperature}°</span>
                        </div>
                        <h3 className="font-semibold text-white">Thermostat</h3>
                        <p className="text-sm text-gray-400">Fahrenheit</p>
                    </div>
                </div>
                {/* Music Player */}
                <div className="p-4 rounded-lg flex items-center" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-primary)' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" className={`w-12 h-12 mr-4 ${musicPlaying ? 'text-orange-400' : 'text-gray-500'}`} viewBox="0 0 20 20" fill="currentColor">
                        <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 1.343-3 3s1.343 3 3 3 3-1.343 3-3V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 1.343-3 3s1.343 3 3 3 3-1.343 3-3V3z" />
                    </svg>
                    <div>
                        <h3 className="font-semibold text-white">Music Player</h3>
                        <p className={`text-sm ${musicPlaying ? 'text-orange-400' : 'text-gray-400'}`}>
                            {musicPlaying ? `Playing: ${musicGenre}` : 'Paused'}
                        </p>
                    </div>
                </div>
            </div>
            {/* Chat Interface */}
            <div className="flex flex-col rounded-lg" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-primary)' }}>
                 <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-20">
                    {messages.map((msg, index) => (
                        <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-lg p-3 rounded-lg overflow-x-auto ${msg.role === 'user' ? 'bg-orange-600' : ''}`} style={msg.role === 'model' ? { backgroundColor: 'var(--bg-space)' } : {}}>
                                {msg.tool && <p className="text-xs italic text-cyan-400 mb-1">{msg.tool}</p>}
                                <StreamedResponse text={msg.text} isStreaming={isLoading && index === messages.length -1} />
                            </div>
                        </div>
                    ))}
                    {isLoading && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
                         <div className="flex justify-start">
                            <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-space)' }}>
                                <div className="flex items-center space-x-2">
                                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse delay-75"></div>
                                    <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse delay-150"></div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
                <div className="p-4 border-t" style={{ borderColor: 'var(--border-primary)' }}>
                    <div className="flex items-center rounded-lg" style={{ backgroundColor: 'var(--bg-deep-space)', border: '1px solid var(--border-primary)' }}>
                        <input
                            type="text" value={input} onChange={(e) => setInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && !isLoading && handleSendMessage()}
                            placeholder="e.g., Turn on the light and play jazz music"
                            className="flex-1 bg-transparent p-3 focus:outline-none" disabled={isLoading}
                        />
                        <button onClick={handleSendMessage} disabled={isLoading || !input.trim()} className="text-white font-bold py-3 px-4 rounded-r-lg disabled:opacity-50 transition-colors" style={{ backgroundColor: 'var(--accent-orange)' }} onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--accent-orange-hover)'} onMouseOut={e => e.currentTarget.style.backgroundColor = 'var(--accent-orange)'}>
                            Send
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ControlPanel;