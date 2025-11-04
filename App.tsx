import React, { useState, useEffect, ReactElement } from 'react';
import ChatBot from './components/ChatBot';
import ImageStudio from './components/ImageStudio';
import VideoStudio from './components/VideoStudio';
import LiveAssistant from './components/LiveAssistant';
import VoiceAssistant from './components/VoiceAssistant';
import TextToSpeech from './components/TextToSpeech';
import DocumentAnalyzer from './components/DocumentAnalyzer';
import ControlPanel from './components/ControlPanel';
import DeveloperTools from './components/DeveloperTools';
import CodeCore from './components/CodeCore';
import { DevToolsProvider } from './contexts/DevToolsContext';
import { AudioPlayerProvider } from './contexts/AudioContext';
import AudioPlayer from './components/AudioPlayer';
import { Tab } from './types';
import { 
    ChatBubbleLeftRightIcon, ImageIcon, VideoCameraIcon, CameraIcon, MicIcon, SoundWaveIcon, DocumentIcon, BoltIcon, CodeIcon, WrenchScrewdriverIcon
} from './components/icons';

const TABS: { id: Tab; label: string; icon: ReactElement }[] = [
    { id: Tab.CHAT, label: 'Chat', icon: <ChatBubbleLeftRightIcon className="w-6 h-6" /> },
    { id: Tab.IMAGE, label: 'Vision', icon: <ImageIcon className="w-6 h-6" /> },
    { id: Tab.VIDEO, label: 'Video', icon: <VideoCameraIcon className="w-6 h-6" /> },
    { id: Tab.LIVE, label: 'Live Analysis', icon: <CameraIcon className="w-6 h-6" /> },
    { id: Tab.VOICE, label: 'Voice', icon: <MicIcon className="w-6 h-6" /> },
    { id: Tab.TTS_STUDIO, label: 'TTS', icon: <SoundWaveIcon className="w-6 h-6" /> },
    { id: Tab.DOCUMENT, label: 'Documents', icon: <DocumentIcon className="w-6 h-6" /> },
    { id: Tab.CONTROL_PANEL, label: 'Controls', icon: <BoltIcon className="w-6 h-6" /> },
    { id: Tab.CODE_CORE, label: 'CodeCore', icon: <CodeIcon className="w-6 h-6" /> },
    { id: Tab.DEV_TOOLS, label: 'Settings', icon: <WrenchScrewdriverIcon className="w-6 h-6" /> },
];

interface SidebarButtonProps {
    tab: Tab;
    label: string;
    icon: ReactElement;
    isActive: boolean;
    onClick: (tab: Tab) => void;
}

const SidebarButton: React.FC<SidebarButtonProps> = ({ tab, label, icon, isActive, onClick }) => (
    <button
        onClick={() => onClick(tab)}
        className={`flex items-center w-full h-14 px-4 rounded-lg transition-colors duration-200 ${
            isActive 
            ? 'bg-orange-600/20 text-white font-semibold' 
            : 'text-gray-400 hover:bg-white/5 hover:text-white'
        }`}
    >
        <div className="flex-shrink-0">{icon}</div>
        <span className="ml-4 text-sm whitespace-nowrap overflow-hidden transition-opacity duration-200 opacity-0 group-hover:opacity-100">
            {label}
        </span>
    </button>
);

const App: React.FC = () => {
    const [activeTab, setActiveTab] = useState<Tab>(() => {
        const savedTab = localStorage.getItem('evox-active-tab');
        return (savedTab as Tab) || Tab.CHAT;
    });

    useEffect(() => {
        localStorage.setItem('evox-active-tab', activeTab);
    }, [activeTab]);

    const renderContent = () => {
        switch (activeTab) {
            case Tab.CHAT: return <ChatBot />;
            case Tab.IMAGE: return <ImageStudio />;
            case Tab.VIDEO: return <VideoStudio />;
            case Tab.LIVE: return <LiveAssistant />;
            case Tab.VOICE: return <VoiceAssistant />;
            case Tab.TTS_STUDIO: return <TextToSpeech />;
            case Tab.DOCUMENT: return <DocumentAnalyzer />;
            case Tab.CONTROL_PANEL: return <ControlPanel />;
            case Tab.CODE_CORE: return <CodeCore />;
            case Tab.DEV_TOOLS: return <DeveloperTools />;
            default: return <ChatBot />;
        }
    };

    return (
        <DevToolsProvider>
            <AudioPlayerProvider>
                <div className="h-screen w-screen flex font-sans overflow-hidden" style={{ backgroundColor: 'var(--bg-deep-space)'}}>
                    {/* Sidebar Navigation */}
                    <nav className="group w-16 hover:w-56 bg-gradient-to-b from-[var(--bg-space)] to-[var(--bg-deep-space)] border-r border-[var(--border-primary)] flex flex-col p-2 space-y-2 transition-all duration-300 ease-in-out z-10">
                        <div className="w-12 h-12 flex items-center justify-center font-bold text-xl rounded-lg bg-orange-500/80 mb-4">
                            E
                        </div>
                        {TABS.map(tab => (
                            <SidebarButton
                                key={tab.id}
                                tab={tab.id}
                                label={tab.label}
                                icon={tab.icon}
                                isActive={activeTab === tab.id}
                                onClick={setActiveTab}
                            />
                        ))}
                    </nav>

                    {/* Main Content */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <main className="flex-1 overflow-hidden">
                            {renderContent()}
                        </main>
                        <AudioPlayer />
                    </div>
                </div>
            </AudioPlayerProvider>
        </DevToolsProvider>
    );
};

export default App;
