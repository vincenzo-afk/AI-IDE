import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { DocumentFile, ChatMessage } from '../types';
import { fileToBase64, getFriendlyErrorMessage } from '../utils';
import { DocumentIcon, StopIcon } from './icons';
import { useDevTools } from '../contexts/DevToolsContext';
import { StreamedResponse } from './StreamedResponse';

const DocumentAnalyzer: React.FC = () => {
    const [documentFile, setDocumentFile] = useState<DocumentFile | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isCancelledRef = useRef(false);
    const { settings } = useDevTools();
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);
    
    useEffect(() => {
        // Clean up the object URL to prevent memory leaks
        const currentPreviewUrl = documentFile?.previewUrl;
        return () => {
            if (currentPreviewUrl) {
                URL.revokeObjectURL(currentPreviewUrl);
            }
        };
    }, [documentFile]);


    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setError(null);
        setMessages([]);
        setDocumentFile(null);

        try {
            if (file.type.startsWith('image/')) {
                const base64 = await fileToBase64(file);
                setDocumentFile({ name: file.name, content: base64, mimeType: file.type, type: 'image' });
            } else if (file.type.startsWith('audio/')) {
                const base64 = await fileToBase64(file);
                const previewUrl = URL.createObjectURL(file);
                setDocumentFile({ name: file.name, content: base64, mimeType: file.type, type: 'audio', previewUrl });
            } else if (file.type.startsWith('video/')) {
                const base64 = await fileToBase64(file);
                const previewUrl = URL.createObjectURL(file);
                setDocumentFile({ name: file.name, content: base64, mimeType: file.type, type: 'video', previewUrl });
            } else if (file.type === 'application/pdf') {
                const base64 = await fileToBase64(file);
                setDocumentFile({ name: file.name, content: base64, mimeType: file.type, type: 'pdf' });
            } else if (file.type === 'text/plain') {
                const textContent = await file.text();
                setDocumentFile({ name: file.name, content: textContent, mimeType: file.type, type: 'text' });
            } else {
                setError('Unsupported file type. Please upload a supported PDF, image, video, audio, or text file.');
            }
        } catch (err) {
            setError("Failed to read the file.");
            console.error(err);
        }
    };

    const handleSendMessage = async () => {
        if (!input.trim() || !documentFile) return;

        const newUserMessage: ChatMessage = { role: 'user', text: input };
        setMessages(prev => [...prev, newUserMessage, { role: 'model', text: '' }]);
        setInput('');
        setIsLoading(true);
        isCancelledRef.current = false;
        setError(null);

        try {
            const apiKey = process.env.API_KEY;
            if (!apiKey) throw new Error("API_KEY is not configured.");
            const ai = new GoogleGenAI({ apiKey });

            const model = 'gemini-2.5-flash';
            const contents: any = { parts: [] };

            if (documentFile.type === 'image' || documentFile.type === 'audio' || documentFile.type === 'video' || documentFile.type === 'pdf') {
                contents.parts.push({ inlineData: { data: documentFile.content, mimeType: documentFile.mimeType } });
                contents.parts.push({ text: input });
            } else { // text
                const prompt = `Based on the following document, please answer the user's question.\n\nDOCUMENT:\n---\n${documentFile.content}\n---\n\nQUESTION: ${input}`;
                contents.parts.push({ text: prompt });
            }

            const stream = await ai.models.generateContentStream({ model, contents, config: settings });
            let fullText = '';
            for await (const chunk of stream) {
                if (isCancelledRef.current) break;
                fullText += chunk.text;
                setMessages(prev => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = { role: 'model', text: fullText };
                    return newMessages;
                });
            }
        } catch (err) {
            if (!isCancelledRef.current) {
                console.error("Error analyzing document:", err);
                const userFriendlyError = getFriendlyErrorMessage(err);
                setMessages(prev => {
                    const newMessages = [...prev];
                    if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'model') {
                        newMessages[newMessages.length - 1].text = `Sorry, an error occurred: ${userFriendlyError}`;
                    }
                    return newMessages;
                });
            }
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleStopGeneration = () => {
        isCancelledRef.current = true;
        setIsLoading(false);
    };

    const FileUploader = () => (
        <div className="flex flex-col items-center justify-center h-full text-center p-8 rounded-lg" style={{backgroundColor: 'var(--bg-space)'}}>
            <DocumentIcon className="w-24 h-24 text-gray-500 mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Document Analyzer</h3>
            <p className="text-gray-400 mb-6 max-w-md">Upload a PDF, image, video, audio, or text file to begin the analysis and start asking questions.</p>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*,video/*,audio/*,text/plain,.pdf,application/pdf" className="hidden" />
            <button
                onClick={() => fileInputRef.current?.click()}
                className="font-bold py-2 px-6 rounded-md transition-colors"
                style={{backgroundColor: 'var(--accent-orange)', color: 'white'}} onMouseOver={e => e.currentTarget.style.backgroundColor='var(--accent-orange-hover)'} onMouseOut={e => e.currentTarget.style.backgroundColor='var(--accent-orange)'}
            >
                Upload File
            </button>
             <p className="text-xs text-gray-500 mt-3">Supported: PDF, Images, Videos, Audio, Text</p>
            {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
        </div>
    );

    const AnalysisView = () => (
        <div className="grid grid-cols-1 md:grid-cols-2 h-full gap-4">
            {/* Document Viewer */}
            <div className="flex flex-col rounded-lg overflow-hidden" style={{backgroundColor: 'var(--bg-panel)'}}>
                <div className="p-3 border-b flex justify-between items-center" style={{borderColor: 'var(--border-primary)'}}>
                    <h3 className="font-semibold truncate" style={{color: 'var(--accent-orange)'}}>{documentFile?.name}</h3>
                    <button onClick={() => fileInputRef.current?.click()} className="text-xs font-semibold py-1 px-3 rounded-md transition" style={{backgroundColor: 'var(--bg-space)'}} onMouseOver={e => e.currentTarget.style.backgroundColor='var(--border-primary)'} onMouseOut={e => e.currentTarget.style.backgroundColor='var(--bg-space)'}>
                        Change File
                    </button>
                </div>
                <div className="flex-1 p-4 overflow-y-auto pb-20 flex items-center justify-center">
                    {documentFile?.type === 'image' ? (
                        <img
                            src={`data:${documentFile.mimeType};base64,${documentFile.content}`}
                            alt={documentFile.name}
                            className="max-w-full max-h-full object-contain rounded-md"
                        />
                    ) : documentFile?.type === 'audio' ? (
                        <audio controls src={documentFile.previewUrl} className="w-full" />
                    ) : documentFile?.type === 'video' ? (
                        <video controls src={documentFile.previewUrl} className="max-w-full max-h-full object-contain rounded-md" />
                    ) : documentFile?.type === 'pdf' ? (
                        <div className="flex flex-col items-center justify-center h-full text-center p-4 text-gray-400">
                            <DocumentIcon className="w-24 h-24 mx-auto mb-4" />
                            <p className="font-semibold text-white">{documentFile.name}</p>
                            <p className="text-sm mt-2">PDF preview is not available. <br />Ask your questions about the content in the chat panel.</p>
                        </div>
                    ) : (
                        <pre className="whitespace-pre-wrap text-sm text-gray-300 font-sans w-full h-full">{documentFile?.content}</pre>
                    )}
                </div>
            </div>

            {/* Chat View */}
            <div className="flex flex-col rounded-lg" style={{backgroundColor: 'var(--bg-panel)'}}>
                <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-20">
                    {messages.map((msg, index) => (
                        <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-lg p-3 rounded-lg overflow-x-auto ${msg.role === 'user' ? 'bg-orange-600' : ''}`} style={msg.role === 'model' ? {backgroundColor: 'var(--bg-space)'} : {}}>
                                {msg.role === 'model' ? (
                                    <StreamedResponse
                                        text={msg.text}
                                        isStreaming={isLoading && index === messages.length - 1}
                                    />
                                ) : (
                                    <p className="whitespace-pre-wrap">{msg.text}</p>
                                )}
                            </div>
                        </div>
                    ))}
                    {isLoading && messages[messages.length - 1]?.text === '' && (
                        <div className="flex justify-start">
                             <div className="p-3 rounded-lg flex items-center space-x-3" style={{backgroundColor: 'var(--bg-space)'}}>
                                <p className="text-sm">EVO-X is analyzing...</p>
                                <button onClick={handleStopGeneration} className="bg-gray-600 hover:bg-gray-500 text-white text-xs font-bold py-1 px-2 rounded-md flex items-center">
                                    <StopIcon className="w-3 h-3 mr-1" /> Stop
                                </button>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
                <div className="p-4 border-t" style={{borderColor: 'var(--border-primary)'}}>
                     {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
                    <div className="flex items-center rounded-lg" style={{backgroundColor: 'var(--bg-deep-space)', border: '1px solid var(--border-primary)'}}>
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && !isLoading && handleSendMessage()}
                            placeholder="Ask about the document..."
                            className="flex-1 bg-transparent p-3 focus:outline-none"
                            disabled={isLoading}
                        />
                        <button
                            onClick={handleSendMessage}
                            disabled={isLoading || !input.trim()}
                            className="text-white font-bold py-3 px-4 rounded-r-lg disabled:opacity-50 transition-colors"
                            style={{backgroundColor: 'var(--accent-orange)'}} onMouseOver={e => e.currentTarget.style.backgroundColor='var(--accent-orange-hover)'} onMouseOut={e => e.currentTarget.style.backgroundColor='var(--accent-orange)'}
                        >
                            Send
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="h-full p-4" style={{backgroundColor: 'var(--bg-space)'}}>
            {documentFile ? <AnalysisView /> : <FileUploader />}
        </div>
    );
};

export default DocumentAnalyzer;