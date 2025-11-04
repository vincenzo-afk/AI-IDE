import React, { useState, useCallback } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { fileToBase64, getFriendlyErrorMessage } from '../utils';
// FIX: Imported ImageIcon to be used in the component.
import { DownloadIcon, ImageIcon } from './icons';

type StudioMode = 'generate' | 'edit';
type AspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";

const stylePresets = [
    { name: 'Photorealistic', append: 'photorealistic, 8k, hyper-detailed, cinematic lighting, professional photography' },
    { name: 'Anime', append: 'anime style, vibrant colors, detailed line art, by Studio Ghibli, makoto shinkai' },
    { name: 'Fantasy Art', append: 'fantasy art, epic, magical, glowing elements, matte painting, by Greg Rutkowski' },
    { name: 'Cyberpunk', append: 'cyberpunk style, neon lights, dystopian city, futuristic, synthwave aesthetic' },
    { name: 'Watercolor', append: 'watercolor painting, soft wash, flowing colors, textured paper, gentle gradients' },
    { name: 'Pixel Art', append: 'pixel art, 16-bit, detailed, vibrant color palette, retro gaming style' },
];

const ImageStudio: React.FC = () => {
    const [mode, setMode] = useState<StudioMode>('generate');
    const [prompt, setPrompt] = useState('');
    const [negativePrompt, setNegativePrompt] = useState('');
    const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [generatedImage, setGeneratedImage] = useState<string | null>(null);
    const [originalImage, setOriginalImage] = useState<{ file: File | null; base64: string; mimeType: string, preview: string }>({ file: null, base64: '', mimeType: '', preview: '' });
    const [editedImage, setEditedImage] = useState<string | null>(null);

    const handleDownload = (imageUrl: string | null, filename: string) => {
        if (!imageUrl) return;
        const link = document.createElement('a');
        link.href = imageUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleGenerate = async () => {
        if (!prompt) {
            setError('Please enter a prompt.');
            return;
        }

        if (typeof window.aistudio === 'undefined' || typeof window.aistudio.hasSelectedApiKey === 'undefined') {
            setError("AI Studio context not available. Please run this in AI Studio.");
            return;
        }
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
            await window.aistudio.openSelectKey();
        }

        setIsLoading(true);
        setError(null);
        setGeneratedImage(null);
        try {
            const apiKey = process.env.API_KEY;
            if (!apiKey) throw new Error("API_KEY is not configured.");
            const ai = new GoogleGenAI({ apiKey });
            
            const fullPrompt = negativePrompt ? `${prompt}, negative prompt: ${negativePrompt}` : prompt;

            const response = await ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: fullPrompt,
                config: { numberOfImages: 1, outputMimeType: 'image/jpeg', aspectRatio },
            });

            const base64ImageBytes = response.generatedImages[0].image.imageBytes;
            setGeneratedImage(`data:image/jpeg;base64,${base64ImageBytes}`);
        } catch (err) {
            console.error("Image generation error:", err);
            setError(getFriendlyErrorMessage(err));
        } finally {
            setIsLoading(false);
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const base64 = await fileToBase64(file);
            const preview = URL.createObjectURL(file);
            setOriginalImage({ file, base64, mimeType: file.type, preview });
            setEditedImage(null);
            setError(null);
        }
    };

    const handleEdit = async () => {
        if (!prompt || !originalImage.file) {
            setError('Please provide an image and a prompt.');
            return;
        }

        if (typeof window.aistudio === 'undefined' || typeof window.aistudio.hasSelectedApiKey === 'undefined') {
            setError("AI Studio context not available. Please run this in AI Studio.");
            return;
        }
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
            await window.aistudio.openSelectKey();
        }

        setIsLoading(true);
        setError(null);
        setEditedImage(null);
        try {
            const apiKey = process.env.API_KEY;
            if (!apiKey) throw new Error("API_KEY is not configured.");
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: {
                    parts: [
                        { inlineData: { data: originalImage.base64, mimeType: originalImage.mimeType } },
                        { text: prompt },
                    ],
                },
                config: { responseModalities: [Modality.IMAGE] },
            });
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    setEditedImage(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
                    break;
                }
            }
        } catch (err) {
            console.error("Image editing error:", err);
            setError(getFriendlyErrorMessage(err));
        } finally {
            setIsLoading(false);
        }
    };

    const reset = () => {
        setPrompt('');
        setNegativePrompt('');
        setAspectRatio('1:1');
        setGeneratedImage(null);
        setOriginalImage({ file: null, base64: '', mimeType: '', preview: '' });
        setEditedImage(null);
        setError(null);
    };
    
    const handleModeChange = (newMode: StudioMode) => {
        setMode(newMode);
        reset();
    };
    
    return (
        <div className="flex h-full p-4" style={{backgroundColor: 'var(--bg-space)'}}>
            <div className="w-96 flex-shrink-0 pr-4 space-y-4 overflow-y-auto pb-20">
                <div className="flex border-b" style={{borderColor: 'var(--border-primary)'}}>
                    <button onClick={() => handleModeChange('generate')} className={`relative px-4 py-3 font-semibold transition-colors ${mode === 'generate' ? 'text-white' : 'text-gray-400 hover:text-white'}`}>
                        Generate
                        {mode === 'generate' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-full"></span>}
                    </button>
                    <button onClick={() => handleModeChange('edit')} className={`relative px-4 py-3 font-semibold transition-colors ${mode === 'edit' ? 'text-white' : 'text-gray-400 hover:text-white'}`}>
                        Edit
                        {mode === 'edit' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-full"></span>}
                    </button>
                </div>
                
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={mode === 'generate' ? 'e.g., A neon hologram of a cat...' : 'e.g., Add a retro filter...'}
                    className="w-full h-24 p-2 rounded-md focus:outline-none"
                    style={{backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-primary)'}}
                    disabled={isLoading}
                />

                {mode === 'generate' && (
                    <>
                        <textarea
                            value={negativePrompt}
                            onChange={(e) => setNegativePrompt(e.target.value)}
                            placeholder="Negative prompt (optional)..."
                            className="w-full h-16 p-2 rounded-md focus:outline-none"
                            style={{backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-primary)'}}
                            disabled={isLoading}
                        />
                        <div>
                             <p className="text-sm font-semibold mb-2" style={{color: 'var(--text-secondary)'}}>Style Presets:</p>
                             <div className="flex flex-wrap gap-2">
                                {stylePresets.map(preset => (
                                    <button 
                                        key={preset.name} 
                                        onClick={() => setPrompt(p => p ? `${p}, ${preset.append}`.trim() : preset.append)}
                                        disabled={isLoading}
                                        className="px-3 py-1 text-xs font-medium rounded-full transition-colors disabled:opacity-50"
                                        style={{backgroundColor: 'var(--bg-panel)', color: 'var(--text-primary)'}}
                                        onMouseOver={e => e.currentTarget.style.backgroundColor='var(--accent-orange)'} 
                                        onMouseOut={e => e.currentTarget.style.backgroundColor='var(--bg-panel)'}
                                    >
                                        {preset.name}
                                    </button>
                                ))}
                             </div>
                        </div>
                         <div className="flex items-center space-x-4">
                            <label htmlFor="aspect-ratio" className="font-semibold text-sm">Aspect Ratio:</label>
                            <select id="aspect-ratio" value={aspectRatio} onChange={e => setAspectRatio(e.target.value as AspectRatio)} className="w-full p-2 rounded-md focus:outline-none" style={{backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-primary)'}} disabled={isLoading}>
                                <option value="1:1">1:1 (Square)</option>
                                <option value="16:9">16:9 (Landscape)</option>
                                <option value="9:16">9:16 (Portrait)</option>
                                <option value="4:3">4:3</option>
                                <option value="3:4">3:4</option>
                            </select>
                        </div>
                    </>
                )}

                {mode === 'edit' && (
                    <input type="file" accept="image/*" onChange={handleFileChange} className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-orange-100 file:text-orange-600 hover:file:bg-orange-200" disabled={isLoading} />
                )}

                {error && <p className="text-red-500 text-sm">{error}</p>}
                
                <button onClick={mode === 'generate' ? handleGenerate : handleEdit} disabled={isLoading || (mode === 'edit' && !originalImage.file)} className="w-full font-bold py-2 px-4 rounded-md disabled:opacity-50 transition-colors" style={{backgroundColor: 'var(--accent-orange)', color: 'white'}} onMouseOver={e => e.currentTarget.style.backgroundColor='var(--accent-orange-hover)'} onMouseOut={e => e.currentTarget.style.backgroundColor='var(--accent-orange)'}>
                    {isLoading ? (mode === 'generate' ? 'Generating...' : 'Editing...') : (mode === 'generate' ? 'Generate' : 'Edit Image')}
                </button>
            </div>
            
            <div className="flex-1 flex items-center justify-center p-4 rounded-lg" style={{backgroundColor: 'var(--bg-deep-space)'}}>
                {isLoading && <div className="animate-spin rounded-full h-16 w-16 border-b-2" style={{borderColor: 'var(--accent-orange)'}}></div>}
                
                {!isLoading && mode === 'generate' && generatedImage && (
                    <div className="text-center">
                        <img src={generatedImage} alt="Generated art" className="rounded-lg mx-auto max-h-[70vh] shadow-lg" />
                        <button onClick={() => handleDownload(generatedImage, 'evox-generated-image.jpg')} className="mt-4 inline-flex items-center px-4 py-2 font-semibold rounded-md transition-colors" style={{backgroundColor: 'var(--bg-panel)'}} onMouseOver={e => e.currentTarget.style.backgroundColor='var(--accent-orange)'} onMouseOut={e => e.currentTarget.style.backgroundColor='var(--bg-panel)'}>
                            <DownloadIcon className="w-5 h-5 mr-2" /> Download
                        </button>
                    </div>
                )}

                {!isLoading && mode === 'edit' && (originalImage.preview || editedImage) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full h-full">
                       {originalImage.preview && (
                            <div className="flex flex-col items-center justify-center text-center p-2 rounded-lg" style={{backgroundColor: 'var(--bg-space)'}}>
                                <h3 className="font-semibold mb-2" style={{color: 'var(--text-secondary)'}}>Original</h3>
                                <img src={originalImage.preview} alt="Original" className="rounded-lg max-h-full max-w-full object-contain" />
                            </div>
                        )}
                        {editedImage && (
                            <div className="flex flex-col items-center justify-center text-center p-2 rounded-lg" style={{backgroundColor: 'var(--bg-space)'}}>
                                <h3 className="font-semibold mb-2" style={{color: 'var(--text-secondary)'}}>Edited</h3>
                                <img src={editedImage} alt="Edited" className="rounded-lg max-h-full max-w-full object-contain" />
                                <button onClick={() => handleDownload(editedImage, 'evox-edited-image.jpg')} className="mt-4 inline-flex items-center px-4 py-2 font-semibold rounded-md transition-colors" style={{backgroundColor: 'var(--bg-panel)'}} onMouseOver={e => e.currentTarget.style.backgroundColor='var(--accent-orange)'} onMouseOut={e => e.currentTarget.style.backgroundColor='var(--bg-panel)'}>
                                    <DownloadIcon className="w-5 h-5 mr-2" /> Download
                                </button>
                            </div>
                        )}
                    </div>
                )}
                 {!isLoading && !generatedImage && !originalImage.preview && !editedImage && (
                     <div className="text-center text-gray-500">
                        <ImageIcon className="w-24 h-24 mx-auto mb-4" />
                        <p>Your generated or edited image will appear here.</p>
                     </div>
                 )}
            </div>
        </div>
    );
};

// FIX: Added default export to the component.
export default ImageStudio;