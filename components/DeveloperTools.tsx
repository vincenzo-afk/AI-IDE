import React, { useState, useEffect } from 'react';
import { useDevTools } from '../contexts/DevToolsContext';
import { DevToolsSettings } from '../types';
import { WrenchScrewdriverIcon } from './icons';

const DeveloperTools: React.FC = () => {
    const { settings, saveSettings, resetSettings } = useDevTools();
    const [localSettings, setLocalSettings] = useState<DevToolsSettings>(settings);
    const [isSaved, setIsSaved] = useState(false);

    useEffect(() => {
        setLocalSettings(settings);
    }, [settings]);

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
        const { name, value } = e.target;
        setLocalSettings(prev => ({ ...prev, [name]: name === 'systemInstruction' ? value : parseFloat(value) }));
    };

    const handleSave = () => {
        saveSettings(localSettings);
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 2000);
    };

    const handleReset = () => {
        resetSettings();
    };

    const SliderControl = ({ name, label, min, max, step, value }: { name: keyof DevToolsSettings, label: string, min: number, max: number, step: number, value: number }) => (
        <div className="space-y-2">
            <div className="flex justify-between items-center">
                <label htmlFor={name} className="font-semibold">{label}</label>
                <span className="text-sm font-mono px-2 py-1 rounded-md" style={{ backgroundColor: 'var(--bg-deep-space)', color: 'var(--accent-orange)' }}>
                    {value.toFixed(name === 'temperature' || name === 'topP' ? 2 : 0)}
                </span>
            </div>
            <input
                id={name}
                name={name}
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={handleInputChange}
            />
        </div>
    );

    return (
        <div className="h-full flex items-center justify-center p-4 overflow-y-auto" style={{ backgroundColor: 'var(--bg-space)' }}>
            <div className="w-full max-w-4xl rounded-lg space-y-6 p-6" style={{ backgroundColor: 'var(--bg-panel)' }}>
                <div className="text-center">
                    <WrenchScrewdriverIcon className="w-12 h-12 mx-auto" style={{ color: 'var(--accent-orange)' }} />
                    <h2 className="text-2xl font-bold mt-2" style={{ color: 'var(--accent-orange)' }}>EVO-X Core Settings</h2>
                    <p style={{ color: 'var(--text-secondary)' }}>Fine-tune model parameters and behavior.</p>
                </div>
                
                <div className="space-y-4">
                    <div>
                        <label htmlFor="systemInstruction" className="font-semibold block mb-2">System Instruction</label>
                        <textarea
                            id="systemInstruction"
                            name="systemInstruction"
                            value={localSettings.systemInstruction}
                            onChange={handleInputChange}
                            rows={15}
                            className="w-full p-3 rounded-md focus:outline-none font-mono text-sm"
                            style={{ backgroundColor: 'var(--bg-deep-space)', border: '1px solid var(--border-primary)', resize: 'vertical' }}
                        />
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <SliderControl name="temperature" label="Temperature" min={0} max={1} step={0.01} value={localSettings.temperature} />
                        <SliderControl name="topP" label="Top P" min={0} max={1} step={0.01} value={localSettings.topP} />
                        <SliderControl name="topK" label="Top K" min={1} max={100} step={1} value={localSettings.topK} />
                    </div>
                </div>

                <div className="flex justify-end gap-4 pt-4 border-t" style={{ borderColor: 'var(--border-primary)' }}>
                    <button 
                        onClick={handleReset} 
                        className="font-semibold py-2 px-4 rounded-md transition-colors" 
                        style={{ backgroundColor: 'var(--bg-space)', border: '1px solid var(--border-primary)' }}
                        onMouseOver={e => e.currentTarget.style.borderColor='var(--text-secondary)'} 
                        onMouseOut={e => e.currentTarget.style.borderColor='var(--border-primary)'}
                    >
                        Reset to Defaults
                    </button>
                    <button 
                        onClick={handleSave} 
                        className="font-bold py-2 px-6 rounded-md transition-colors" 
                        style={{ backgroundColor: 'var(--accent-orange)', color: 'white' }} 
                        onMouseOver={e => e.currentTarget.style.backgroundColor='var(--accent-orange-hover)'} 
                        onMouseOut={e => e.currentTarget.style.backgroundColor='var(--accent-orange)'}
                    >
                        {isSaved ? 'Saved!' : 'Save Settings'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DeveloperTools;