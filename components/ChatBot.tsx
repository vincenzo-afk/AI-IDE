import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, GenerateContentResponse, GroundingChunk } from '@google/genai';
import { ChatMessage, ChatSession } from '../types';
import { MicIcon, ClearIcon, CopyIcon, StopIcon, ImageIcon, CloseIcon, AddIcon, PencilIcon, HistoryIcon } from './icons';
import { encode, fileToBase64, getFriendlyErrorMessage } from '../utils';
import { useDevTools } from '../contexts/DevToolsContext';
import { StreamedResponse } from './StreamedResponse';

type ChatMode = 'flash' | 'flash-lite' | 'pro-thinking' | 'search' | 'maps' | 'code';

const CHAT_SESSIONS_KEY = 'evox-chat-sessions';

// A simple component to render markdown, focusing on code blocks
const MarkdownRenderer: React.FC<{ text: string }> = ({ text }) => {
    const [copied, setCopied] = useState(false);
    const parts = text.split(/(```[\s\S]*?```)/g);

    const handleCopy = (code: string) => {
        // remove ```language and ```
        const cleanCode = code.replace(/^```[a-z]*\n|```$/g, '');
        navigator.clipboard.writeText(cleanCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="whitespace-pre-wrap">
            {parts.map((part, index) => {
                if (part.startsWith('```')) {
                    return (
                        <div key={index} className="relative group my-2 rounded-md" style={{backgroundColor: 'var(--bg-deep-space)'}}>
                            <button
                                onClick={() => handleCopy(part)}
                                className="absolute top-2 right-2 p-1.5 bg-gray-600 rounded-md hover:bg-orange-600 transition-colors opacity-0 group-hover:opacity-100 text-xs"
                            >
                                {copied ? 'Copied!' : <CopyIcon className="w-4 h-4" />}
                            </button>
                            <pre className="p-4 overflow-x-auto text-sm">{part.replace(/^```[a-z]*\n|```$/g, '')}</pre>
                        </div>
                    );
                }
                return <span key={index}>{part}</span>;
            })}
        </div>
    );
};

const ChatBot: React.FC = () => {
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [input, setInput] = useState('');
    const [image, setImage] = useState<{ base64: string, mimeType: string, preview: string } | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [mode, setMode] = useState<ChatMode>('flash');
    const [isRecording, setIsRecording] = useState(false);
    const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
    const [tempTitle, setTempTitle] = useState('');
    const [isHistoryVisible, setIsHistoryVisible] = useState(true);
    
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { settings } = useDevTools();
    const isCancelledRef = useRef(false);

    useEffect(() => {
        try {
            const savedData = localStorage.getItem(CHAT_SESSIONS_KEY);
            if (savedData) {
                const { sessions: savedSessions, activeSessionId: savedActiveId } = JSON.parse(savedData);
                setSessions(savedSessions);
                setActiveSessionId(savedActiveId);
            } else {
                handleNewChat();
            }
        } catch (error) {
            console.error("Could not load chat sessions:", error);
            handleNewChat();
        }
    }, []);

    useEffect(() => {
        if (sessions.length > 0 && activeSessionId) {
            try {
                const dataToSave = JSON.stringify({ sessions, activeSessionId });
                localStorage.setItem(CHAT_SESSIONS_KEY, dataToSave);
            } catch (error) {
                console.error("Could not save chat sessions:", error);
            }
        }
    }, [sessions, activeSessionId]);

    const activeSession = sessions.find(s => s.id === activeSessionId);
    const messages = activeSession?.messages || [];

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    useEffect(scrollToBottom, [messages]);
    
    const summarizeAndRenameSession = useCallback(async (session: ChatSession) => {
        const isDefaultTitle = session.title === 'New Chat' || session.title === session.messages[0]?.text.trim().split(' ').slice(0, 5).join(' ');
        if (session.messages.length < 2 || !isDefaultTitle) return;

        try {
            const history = session.messages.map(m => `${m.role}: ${m.text}`).join('\n');
            const prompt = `Based on the following conversation, create a short, concise title (5 words max).\n\nConversation:\n${history}`;
            
            const apiKey = process.env.API_KEY;
            if (!apiKey) return;
            const ai = new GoogleGenAI({ apiKey });

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });
            const newTitle = response.text.trim().replace(/"/g, '');
            
            if (newTitle) {
                setSessions(prev => prev.map(s => s.id === session.id ? { ...s, title: newTitle } : s));
            }
        } catch (error) {
            console.error("Failed to summarize session title:", error);
        }
    }, []);


    const updateSessionMessages = (newMessages: ChatMessage[], overwriteLast: boolean = false) => {
        setSessions(prev => prev.map(s => {
            if (s.id === activeSessionId) {
                if (overwriteLast) {
                    const updated = [...s.messages];
                    updated[s.messages.length - 1] = newMessages[0];
                    return { ...s, messages: updated };
                }
                return { ...s, messages: newMessages };
            }
            return s;
        }));
    };


    const handleNewChat = () => {
        const newSession: ChatSession = { id: `session-${Date.now()}`, title: 'New Chat', messages: [] };
        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(newSession.id);
    };

    const handleDeleteSession = (sessionId: string) => {
        setSessions(prev => prev.filter(s => s.id !== sessionId));
        if (activeSessionId === sessionId) {
            const remainingSessions = sessions.filter(s => s.id !== sessionId);
            if (remainingSessions.length > 0) {
                setActiveSessionId(remainingSessions[0].id);
            } else {
                handleNewChat();
            }
        }
    };
    
    const handleStartRename = (session: ChatSession) => {
        setRenamingSessionId(session.id);
        setTempTitle(session.title);
    };

    const handleConfirmRename = (sessionId: string) => {
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: tempTitle.trim() || 'Untitled' } : s));
        setRenamingSessionId(null);
        setTempTitle('');
    };
    
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const base64 = await fileToBase64(file);
            const preview = URL.createObjectURL(file);
            setImage({ base64, mimeType: file.type, preview });
        }
    };

    const handleSendMessage = async (messageText: string) => {
        if (!activeSessionId || (!messageText.trim() && !image)) return;

        const userMessage: ChatMessage = { role: 'user', text: messageText };
        if (image) {
            userMessage.image = { base64: image.base64, mimeType: image.mimeType };
        }
        
        const isFirstMessage = activeSession?.messages.length === 0;
        if (isFirstMessage && messageText.trim()) {
            const newTitle = messageText.trim().split(' ').slice(0, 5).join(' ');
            setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, title: newTitle } : s));
        }

        const updatedMessages: ChatMessage[] = [...messages, userMessage, { role: 'model', text: '' }];
        updateSessionMessages(updatedMessages);
        setInput('');
        setImage(null);
        setIsLoading(true);
        isCancelledRef.current = false;

        try {
            const apiKey = process.env.API_KEY;
            if (!apiKey) throw new Error("API_KEY is not configured.");
            const ai = new GoogleGenAI({ apiKey });
            
            let model: string;
            let modelSpecificConfig: any = {};

            switch (mode) {
                 case 'flash-lite': model = 'gemini-flash-lite-latest'; break;
                 case 'pro-thinking': model = 'gemini-2.5-pro'; modelSpecificConfig = { thinkingConfig: { thinkingBudget: 32768 } }; break;
                 case 'search': model = 'gemini-2.5-flash'; modelSpecificConfig = { tools: [{ googleSearch: {} }] }; break;
                 case 'code': model = 'gemini-2.5-pro'; break;
                 case 'maps':
                    model = 'gemini-2.5-flash';
                    try {
                        const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 }));
                        modelSpecificConfig = { 
                            tools: [{ googleMaps: {} }],
                            toolConfig: { retrievalConfig: { latLng: { latitude: position.coords.latitude, longitude: position.coords.longitude } } }
                        };
                    } catch (geoError) {
                        console.error("Geolocation error:", geoError);
                        const errorMsg = "Could not get your location. Please enable location services and grant permission. I cannot answer this question without it.";
                        updateSessionMessages([{ role: 'model', text: errorMsg }], true);
                        setIsLoading(false);
                        return;
                    }
                    break;
                default: model = 'gemini-2.5-flash';
            }
            
            const contents: any = { parts: [{ text: messageText }] };
            if (image) {
                 model = 'gemini-2.5-flash'; 
                 contents.parts.unshift({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
            }

            const stream = await ai.models.generateContentStream({ model, contents, config: { ...settings, ...modelSpecificConfig } });
            
            let fullText = '';
            let groundingChunks: GroundingChunk[] | undefined = undefined;

            for await (const chunk of stream) {
                if (isCancelledRef.current) break;

                fullText += chunk.text;
                if (chunk.candidates?.[0]?.groundingMetadata?.groundingChunks) {
                    groundingChunks = chunk.candidates[0].groundingMetadata.groundingChunks;
                }
                
                const modelMessage: ChatMessage = { role: 'model', text: fullText, groundingChunks };
                updateSessionMessages([modelMessage], true);
            }
        } catch (error) {
            if (!isCancelledRef.current) {
                console.error("Error sending message:", error);
                const userFriendlyError = getFriendlyErrorMessage(error);
                const errorMsg: ChatMessage = { role: 'model', text: `Sorry, an error occurred: ${userFriendlyError}` };
                updateSessionMessages([errorMsg], true);
            }
        } finally {
            setIsLoading(false);
            const currentSession = sessions.find(s => s.id === activeSessionId);
            if (currentSession && !isCancelledRef.current) {
                summarizeAndRenameSession(currentSession);
            }
        }
    };

    const handleStopGeneration = () => {
        isCancelledRef.current = true;
        setIsLoading(false);
    };

    return (
        <div className="flex h-full">
            <div className={`flex flex-col transition-all duration-300 ${isHistoryVisible ? 'w-72' : 'w-0'} overflow-hidden`} style={{backgroundColor: 'var(--bg-space)'}}>
                <div className="flex-1 p-2 space-y-1 overflow-y-auto">
                    <div className="flex items-center justify-between p-2">
                        <h2 className="text-lg font-semibold">History</h2>
                        <button onClick={handleNewChat} className="p-2 rounded-md hover:bg-white/10" title="New Chat"><AddIcon className="w-5 h-5"/></button>
                    </div>
                    {sessions.map(session => (
                        <div key={session.id} onClick={() => setActiveSessionId(session.id)}
                            className={`group flex items-center justify-between p-2 rounded-md cursor-pointer ${activeSessionId === session.id ? 'bg-orange-600/20' : 'hover:bg-white/5'}`}>
                            {renamingSessionId === session.id ? (
                                <input
                                    type="text"
                                    value={tempTitle}
                                    onChange={(e) => setTempTitle(e.target.value)}
                                    onBlur={() => handleConfirmRename(session.id)}
                                    onKeyPress={(e) => e.key === 'Enter' && handleConfirmRename(session.id)}
                                    autoFocus
                                    className="bg-transparent w-full focus:outline-none"
                                />
                            ) : (
                                <span className="truncate text-sm">{session.title}</span>
                            )}
                            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={(e) => { e.stopPropagation(); handleStartRename(session); }} className="p-1 hover:text-white"><PencilIcon className="w-4 h-4"/></button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }} className="p-1 hover:text-white"><ClearIcon className="w-4 h-4"/></button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className={`relative flex-1 flex flex-col chatbot-container ${isLoading ? 'ai-thinking' : ''}`} style={{backgroundColor: 'var(--bg-deep-space)'}}>
                {/* Header */}
                <div className="flex-shrink-0 flex items-center justify-between p-2 border-b" style={{borderColor: 'var(--border-primary)'}}>
                    <button onClick={() => setIsHistoryVisible(!isHistoryVisible)} className="p-2 rounded-md hover:bg-white/10" title="Toggle History">
                        <HistoryIcon className="w-5 h-5"/>
                    </button>
                    <div className="flex items-center space-x-1 p-1 rounded-lg" style={{backgroundColor: 'var(--bg-space)'}}>
                        {(['flash', 'flash-lite', 'pro-thinking', 'code', 'search', 'maps'] as ChatMode[]).map(m => (
                            <button key={m} onClick={() => setMode(m)} className={`px-3 py-1 text-sm rounded-md transition-colors ${mode === m ? 'bg-orange-600 text-white' : 'hover:bg-white/10'}`}>
                                {m.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </button>
                        ))}
                    </div>
                    <button onClick={handleNewChat} className="p-2 rounded-md hover:bg-white/10" title="New Chat"><AddIcon className="w-5 h-5"/></button>
                </div>
                
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.length === 0 && (
                        <div className="text-center text-gray-500 pt-20">
                            <h1 className="text-4xl font-bold mb-2">EVO-X</h1>
                            <p>Your personal AI assistant. How can I help you today?</p>
                        </div>
                    )}
                    {messages.map((msg, index) => (
                        <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`relative group max-w-2xl p-3 rounded-lg overflow-x-auto ${msg.role === 'user' ? 'bg-orange-600' : ''}`} style={msg.role === 'model' ? {backgroundColor: 'var(--bg-space)'} : {}}>
                                {msg.image && <img src={`data:${msg.image.mimeType};base64,${msg.image.base64}`} alt="User upload" className="rounded-md mb-2 max-w-xs" />}
                                {msg.role === 'model' && mode === 'code' ? (
                                    <MarkdownRenderer text={msg.text} />
                                ) : msg.role === 'model' ? (
                                    <StreamedResponse text={msg.text} isStreaming={isLoading && index === messages.length - 1} />
                                ) : (
                                    <p className="whitespace-pre-wrap">{msg.text}</p>
                                )}
                                {msg.groundingChunks && msg.groundingChunks.length > 0 && (
                                    <div className="mt-3 pt-2 border-t border-gray-600 text-xs">
                                        <h4 className="font-semibold mb-1 text-gray-400">Sources:</h4>
                                        <ul className="space-y-1">
                                            {msg.groundingChunks.map((chunk, i) => {
                                                const uri = chunk.web?.uri || chunk.maps?.uri;
                                                const title = chunk.web?.title || chunk.maps?.title;
                                                if (!uri) return null;
                                                return <li key={i}><a href={uri} target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:underline truncate block">{title || uri}</a></li>
                                            })}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {isLoading && messages.length > 0 && messages[messages.length - 1].role === 'model' && messages[messages.length - 1].text === '' && (
                         <div className="flex justify-start">
                            <div className="p-3 rounded-lg flex items-center space-x-3" style={{backgroundColor: 'var(--bg-space)'}}>
                                <p className="text-sm">EVO-X is thinking...</p>
                                <button onClick={handleStopGeneration} className="bg-gray-600 hover:bg-gray-500 text-white text-xs font-bold py-1 px-2 rounded-md flex items-center">
                                    <StopIcon className="w-3 h-3 mr-1" /> Stop
                                </button>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
                
                {/* Input Bar */}
                <div className="p-4 border-t" style={{borderColor: 'var(--border-primary)'}}>
                    {image && (
                        <div className="relative inline-block mb-2">
                            <img src={image.preview} alt="preview" className="h-20 w-20 object-cover rounded-md"/>
                            <button onClick={() => setImage(null)} className="absolute top-0 right-0 -mt-2 -mr-2 bg-gray-700 rounded-full p-1 text-white"><CloseIcon className="w-4 h-4"/></button>
                        </div>
                    )}
                    <div className="flex items-center rounded-lg" style={{backgroundColor: 'var(--bg-deep-space)', border: '1px solid var(--border-primary)'}}>
                        <button onClick={() => fileInputRef.current?.click()} className="p-3 text-gray-400 hover:text-white"><ImageIcon className="w-6 h-6"/></button>
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden"/>
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage(input))}
                            placeholder="Message EVO-X..."
                            className="flex-1 bg-transparent p-3 focus:outline-none resize-none max-h-40"
                            rows={1}
                            disabled={isLoading}
                        />
                         <button onClick={() => handleSendMessage(input)} disabled={isLoading || (!input.trim() && !image)} className="text-white font-bold py-3 px-4 rounded-r-lg disabled:opacity-50 transition-colors" style={{backgroundColor: 'var(--accent-orange)'}} onMouseOver={e => e.currentTarget.style.backgroundColor='var(--accent-orange-hover)'} onMouseOut={e => e.currentTarget.style.backgroundColor='var(--accent-orange)'}>
                            Send
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ChatBot;