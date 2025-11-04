import React, { useState, useRef } from 'react';
import { GoogleGenAI, GenerateVideosOperation, VideoGenerationReferenceImage, VideoGenerationReferenceType } from '@google/genai';
import { DownloadIcon } from './icons';
import { fileToBase64, getFriendlyErrorMessage } from '../utils';

type AspectRatio = "16:9" | "9:16";
type Resolution = "720p" | "1080p";
type GenerationMode = 'text' | 'image' | 'multi-reference';
type ImageFile = { base64: string, mimeType: string, preview: string };

const VideoStudio: React.FC = () => {
    const [mode, setMode] = useState<GenerationMode>('text');
    const [prompt, setPrompt] = useState('');
    const [extendPrompt, setExtendPrompt] = useState('');
    const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
    const [resolution, setResolution] = useState<Resolution>('720p');
    const [image, setImage] = useState<ImageFile | null>(null);
    const [referenceImages, setReferenceImages] = useState<(ImageFile | null)[]>(Array(3).fill(null));
    const [isLoading, setIsLoading] = useState(false);
    const [isExtending, setIsExtending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [generatedVideo, setGeneratedVideo] = useState<any | null>(null);
    const [progressMessage, setProgressMessage] = useState('');
    const isCancelledRef = useRef(false);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const base64 = await fileToBase64(file);
            const preview = URL.createObjectURL(file);
            setImage({ base64, mimeType: file.type, preview });
        }
    };
    
    const handleReferenceFileChange = async (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
        const file = e.target.files?.[0];
        if (file) {
            const base64 = await fileToBase64(file);
            const preview = URL.createObjectURL(file);
            setReferenceImages(prev => {
                const newImages = [...prev];
                newImages[index] = { base64, mimeType: file.type, preview };
                return newImages;
            });
        }
    };


    const runVideoGeneration = async (apiCall: () => Promise<GenerateVideosOperation>, loadingSetter: React.Dispatch<React.SetStateAction<boolean>>) => {
        if (typeof window.aistudio === 'undefined' || typeof window.aistudio.hasSelectedApiKey === 'undefined') {
            setError("AI Studio context not available."); return;
        }
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) { await window.aistudio.openSelectKey(); }
        
        loadingSetter(true);
        setError(null);
        setVideoUrl(null);
        isCancelledRef.current = false;
        setProgressMessage('Initializing video generation...');

        try {
            const apiKey = process.env.API_KEY;
            if (!apiKey) throw new Error("API_KEY is not configured.");
            const ai = new GoogleGenAI({ apiKey });

            let operation = await apiCall();
            setProgressMessage('Video generation in progress... this can take a few minutes.');
            
            while (!operation.done && !isCancelledRef.current) {
                await new Promise(resolve => setTimeout(resolve, 10000));
                operation = await ai.operations.getVideosOperation({ operation });
                setProgressMessage(`Processing... Current status: ${operation.metadata?.state || 'IN_PROGRESS'}`);
            }

            if (isCancelledRef.current) return;
            if (operation.error) throw new Error(((operation.error as any).message && String((operation.error as any).message)) || 'An unknown error occurred.');

            const videoObject = operation.response?.generatedVideos?.[0]?.video;
            if (videoObject?.uri) {
                const response = await fetch(`${videoObject.uri}&key=${apiKey}`);
                if (!response.ok) throw new Error(`Failed to download video: ${response.statusText}`);
                const videoBlob = await response.blob();
                const objectUrl = URL.createObjectURL(videoBlob);
                setVideoUrl(objectUrl);
                setGeneratedVideo(videoObject);
                setProgressMessage('Video generated successfully!');
            } else {
                 throw new Error('Video URI not found in the response.');
            }
        } catch (err) {
            console.error("Video generation error:", err);
            setError(getFriendlyErrorMessage(err));
        } finally {
            loadingSetter(false);
            setProgressMessage('');
        }
    };

    const handleGenerate = async () => {
        if (mode === 'text' && !prompt) { setError('Please enter a prompt.'); return; }
        if (mode === 'image' && !image) { setError('Please upload an image.'); return; }
        if (mode === 'multi-reference' && (!prompt || referenceImages.every(img => img === null))) { setError('Please provide a prompt and at least one reference image.'); return; }
        
        setGeneratedVideo(null); // Reset previous video
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
        
        const payload: any = { prompt };
        
        if (mode === 'image' && image) {
            payload.model = 'veo-3.1-fast-generate-preview';
            payload.image = { imageBytes: image.base64, mimeType: image.mimeType };
            payload.config = { numberOfVideos: 1, resolution, aspectRatio };
        } else if (mode === 'multi-reference') {
            payload.model = 'veo-3.1-generate-preview';
            payload.config = { numberOfVideos: 1, resolution: '720p', aspectRatio: '16:9' };
            
            const referenceImagesPayload: VideoGenerationReferenceImage[] = [];
            for (const img of referenceImages) {
                if(img) {
                    referenceImagesPayload.push({
                        image: { imageBytes: img.base64, mimeType: img.mimeType },
                        referenceType: VideoGenerationReferenceType.ASSET,
                    });
                }
            }
            payload.config.referenceImages = referenceImagesPayload;
        } else { // text mode
             payload.model = 'veo-3.1-fast-generate-preview';
             payload.config = { numberOfVideos: 1, resolution, aspectRatio };
        }
        
        await runVideoGeneration(() => ai.models.generateVideos(payload), setIsLoading);
    };

    const handleExtend = async () => {
        if (!extendPrompt) { setError('Please enter a prompt for the extension.'); return; }
        if (!generatedVideo) { setError('A base video must be generated first.'); return; }
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
        await runVideoGeneration(() => ai.models.generateVideos({
            model: 'veo-3.1-generate-preview',
            prompt: extendPrompt,
            video: generatedVideo,
            config: { numberOfVideos: 1, resolution: '720p', aspectRatio: generatedVideo.aspectRatio }
        }), setIsExtending);
        setExtendPrompt('');
    };

    const handleCancel = () => {
        isCancelledRef.current = true;
        setIsLoading(false);
        setIsExtending(false);
        setProgressMessage('Video generation cancelled.');
    };

    const handleModeChange = (newMode: GenerationMode) => {
        setMode(newMode);
        setError(null);
        setPrompt('');
        setImage(null);
        setReferenceImages(Array(3).fill(null));
        if (newMode === 'multi-reference') {
            setAspectRatio('16:9');
            setResolution('720p');
        }
    };

    return (
        <div className="flex flex-col h-full p-4 overflow-y-auto pb-20" style={{backgroundColor: 'var(--bg-space)'}}>
            <h2 className="text-2xl font-bold mb-4 text-center" style={{color: 'var(--accent-orange)'}}>Video Studio</h2>
             <div className="flex border-b mb-4 max-w-2xl mx-auto w-full" style={{borderColor: 'var(--border-primary)'}}>
                <button onClick={() => handleModeChange('text')} className={`relative px-4 py-3 font-semibold transition-colors ${mode === 'text' ? 'text-white' : 'text-gray-400 hover:text-white'}`}>Text to Video {mode === 'text' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-full"></span>}</button>
                <button onClick={() => handleModeChange('image')} className={`relative px-4 py-3 font-semibold transition-colors ${mode === 'image' ? 'text-white' : 'text-gray-400 hover:text-white'}`}>Image to Video {mode === 'image' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-full"></span>}</button>
                <button onClick={() => handleModeChange('multi-reference')} className={`relative px-4 py-3 font-semibold transition-colors ${mode === 'multi-reference' ? 'text-white' : 'text-gray-400 hover:text-white'}`}>Multi-Reference {mode === 'multi-reference' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-full"></span>}</button>
            </div>
            <div className="space-y-4 max-w-2xl mx-auto w-full">
                {mode === 'image' && (
                    <div className="space-y-2">
                        <label className="font-semibold block mb-1">Starting Image:</label>
                        <input type="file" accept="image/*" onChange={handleFileChange} className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-orange-100 file:text-orange-600 hover:file:bg-orange-200" disabled={isLoading || isExtending} />
                        {image?.preview && <img src={image.preview} alt="Preview" className="rounded-lg mx-auto max-h-40 mt-2" />}
                    </div>
                )}
                 {mode === 'multi-reference' && (
                    <div className="space-y-3 p-3 rounded-lg" style={{backgroundColor: 'var(--bg-panel)'}}>
                        <label className="font-semibold block mb-1">Reference Images (up to 3):</label>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {[0,1,2].map(i => (
                                <div key={i} className="text-center">
                                    <input type="file" id={`ref-img-${i}`} accept="image/*" onChange={(e) => handleReferenceFileChange(e, i)} className="hidden" disabled={isLoading || isExtending} />
                                    <label htmlFor={`ref-img-${i}`} className="w-full h-24 border-2 border-dashed rounded-lg flex items-center justify-center cursor-pointer hover:bg-gray-700" style={{borderColor: 'var(--border-primary)'}}>
                                        {referenceImages[i] ? <img src={referenceImages[i]!.preview} alt={`Ref ${i+1}`} className="w-full h-full object-cover rounded-md" /> : <span className="text-xs text-gray-400">Image {i+1}</span>}
                                    </label>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={mode === 'image' ? "Prompt (optional)..." : mode === 'multi-reference' ? "Prompt (required)..." : "e.g., A neon hologram of a cat..."} className="w-full h-24 p-2 rounded-md focus:outline-none" style={{backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-primary)'}} disabled={isLoading || isExtending} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div>
                        <label htmlFor="aspect-ratio-video" className="font-semibold block mb-1">Aspect Ratio:</label>
                        <select id="aspect-ratio-video" value={aspectRatio} onChange={e => setAspectRatio(e.target.value as AspectRatio)} className="w-full p-2 rounded-md" style={{backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-primary)'}} disabled={isLoading || isExtending || mode === 'multi-reference'}> <option value="16:9">16:9 (Landscape)</option> <option value="9:16">9:16 (Portrait)</option> </select>
                    </div>
                    <div>
                        <label htmlFor="resolution-video" className="font-semibold block mb-1">Resolution:</label>
                        <select id="resolution-video" value={resolution} onChange={e => setResolution(e.target.value as Resolution)} className="w-full p-2 rounded-md" style={{backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-primary)'}} disabled={isLoading || isExtending || mode === 'multi-reference'}> <option value="720p">720p</option> <option value="1080p">1080p</option> </select>
                    </div>
                </div>
                 {mode === 'multi-reference' && <p className="text-xs text-center text-gray-400">Multi-reference mode is locked to 16:9 and 720p.</p>}
                {error && <p className="text-red-500 text-sm text-center">{error}</p>}
                <button onClick={handleGenerate} disabled={isLoading || isExtending} className="w-full font-bold py-2.5 px-4 rounded-md disabled:opacity-50 transition-colors" style={{backgroundColor: 'var(--accent-orange)', color: 'white'}} onMouseOver={e => e.currentTarget.style.backgroundColor='var(--accent-orange-hover)'} onMouseOut={e => e.currentTarget.style.backgroundColor='var(--accent-orange)'}> {isLoading ? 'Generating...' : 'Generate Video'} </button>
                
                {(isLoading || isExtending) && (
                    <div className="text-center p-4">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto" style={{borderColor: 'var(--accent-orange)'}}></div>
                        <p className="mt-4 text-gray-300">{progressMessage}</p>
                        <button onClick={handleCancel} className="mt-4 bg-red-600 hover:bg-red-500 text-white font-bold py-1 px-3 rounded-md"> Cancel </button>
                    </div>
                )}
                
                {videoUrl && (
                    <div className="text-center mt-4 space-y-4">
                        <video src={videoUrl} controls className="rounded-lg mx-auto max-h-96 w-full" />
                        <a href={videoUrl} download="evox-generated-video.mp4" className="inline-flex items-center px-4 py-2 font-semibold rounded-md transition-colors" style={{backgroundColor: 'var(--bg-panel)'}} onMouseOver={e => e.currentTarget.style.backgroundColor='var(--accent-orange)'} onMouseOut={e => e.currentTarget.style.backgroundColor='var(--bg-panel)'}> <DownloadIcon className="w-5 h-5 mr-2" /> Download </a>
                        <div className="p-4 rounded-lg space-y-2" style={{backgroundColor: 'var(--bg-panel)'}}>
                             <h3 className="font-semibold text-lg" style={{color: 'var(--accent-orange)'}}>Extend Video (+7s)</h3>
                             <p className="text-xs text-gray-400">Note: Extension is only available in 720p.</p>
                             <textarea value={extendPrompt} onChange={(e) => setExtendPrompt(e.target.value)} placeholder="e.g., something unexpected happens..." className="w-full h-16 p-2 bg-gray-800 border rounded-md" style={{backgroundColor: 'var(--bg-deep-space)', borderColor: 'var(--border-primary)'}} disabled={isExtending || isLoading} />
                             <button onClick={handleExtend} disabled={isExtending || isLoading} className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-2 px-4 rounded-md disabled:opacity-50"> {isExtending ? 'Extending...' : 'Extend'} </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default VideoStudio;