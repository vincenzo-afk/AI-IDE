import React, { useContext, useState } from 'react';
import { AudioPlayerContext } from '../contexts/AudioContext';
import { SoundWaveIcon, PlaylistIcon, PlayIcon, PauseIcon, NextIcon, PrevIcon, CloseIcon, ClearIcon } from './icons';

const AudioPlayer: React.FC = () => {
    const { isPlaying, playlist, currentIndex, play, pause, playNext, playPrev, clearPlaylist } = useContext(AudioPlayerContext);
    const [isPlaylistVisible, setIsPlaylistVisible] = useState(false);

    if (playlist.length === 0) {
        return null;
    }
    
    const currentTrack = currentIndex !== null ? playlist[currentIndex] : null;

    return (
        <>
            <div className="fixed bottom-0 left-0 right-0 p-2 flex items-center justify-between shadow-lg z-50" style={{backgroundColor: 'var(--bg-panel)', borderTop: '1px solid var(--border-primary)'}}>
                <div className="flex items-center space-x-3">
                    {isPlaying ? <SoundWaveIcon className="w-6 h-6" style={{color: 'var(--accent-orange)'}} /> : <PlaylistIcon className="w-6 h-6 text-gray-400" />}
                    <div className="text-sm">
                        <p className="font-bold text-white truncate max-w-[200px] sm:max-w-xs">{currentTrack?.name || 'Playlist Ready'}</p>
                        <p className="text-gray-400">{currentTrack?.source || `Total: ${playlist.length} tracks`}</p>
                    </div>
                </div>
                
                <div className="flex items-center space-x-2 sm:space-x-4">
                    <button onClick={playPrev} disabled={currentIndex === null || currentIndex === 0} className="text-gray-300 hover:text-white disabled:opacity-50">
                        <PrevIcon className="w-6 h-6" />
                    </button>
                    <button onClick={isPlaying ? pause : () => play(currentIndex ?? 0)} className="text-white rounded-full p-2 transition-colors" style={{backgroundColor: 'var(--accent-orange)'}} onMouseOver={e => e.currentTarget.style.backgroundColor='var(--accent-orange-hover)'} onMouseOut={e => e.currentTarget.style.backgroundColor='var(--accent-orange)'}>
                        {isPlaying ? <PauseIcon className="w-7 h-7" /> : <PlayIcon className="w-7 h-7" />}
                    </button>
                    <button onClick={playNext} disabled={currentIndex === null || currentIndex >= playlist.length - 1} className="text-gray-300 hover:text-white disabled:opacity-50">
                        <NextIcon className="w-6 h-6" />
                    </button>
                </div>

                <button onClick={() => setIsPlaylistVisible(true)} className="text-gray-300 hover:text-white p-2">
                    <PlaylistIcon className="w-6 h-6" />
                </button>
            </div>
            
            {isPlaylistVisible && (
                 <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
                    <div className="rounded-lg shadow-xl w-full max-w-md max-h-[80vh] flex flex-col" style={{backgroundColor: 'var(--bg-panel)'}}>
                        <div className="flex items-center justify-between p-4 border-b" style={{borderColor: 'var(--border-primary)'}}>
                            <h2 className="text-xl font-bold" style={{color: 'var(--accent-orange)'}}>Up Next</h2>
                            <div className="flex items-center gap-2">
                                <button onClick={() => { clearPlaylist(); setIsPlaylistVisible(false); }} className="text-gray-400 hover:text-white" title="Clear Playlist">
                                    <ClearIcon className="w-6 h-6" />
                                </button>
                                <button onClick={() => setIsPlaylistVisible(false)} className="text-gray-400 hover:text-white">
                                    <CloseIcon className="w-7 h-7" />
                                </button>
                            </div>
                        </div>
                        <ul className="overflow-y-auto p-2">
                            {playlist.map((item, index) => (
                                <li 
                                    key={item.id} 
                                    className={`flex items-center justify-between p-3 rounded-md cursor-pointer group ${currentIndex === index ? 'bg-orange-600/20' : 'hover:bg-white/5'}`}
                                    onClick={() => play(index)}
                                >
                                    <div className="flex items-center space-x-3">
                                        {currentIndex === index && isPlaying ? <SoundWaveIcon className="w-5 h-5" style={{color: 'var(--accent-orange)'}} /> : <span className="w-5 text-center text-gray-400 font-mono">{index + 1}</span>}
                                        <div>
                                            <p className={`font-semibold ${currentIndex === index ? 'text-orange-300' : 'text-white'}`}>{item.name}</p>
                                            <p className="text-xs text-gray-400">{item.source}</p>
                                        </div>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); play(index); }} className="opacity-0 group-hover:opacity-100 text-white rounded-full p-2 transition-colors" style={{backgroundColor: 'var(--accent-orange)'}} onMouseOver={e => e.currentTarget.style.backgroundColor='var(--accent-orange-hover)'} onMouseOut={e => e.currentTarget.style.backgroundColor='var(--accent-orange)'}>
                                        <PlayIcon className="w-5 h-5" />
                                    </button>
                                </li>
                            ))}
                             {playlist.length === 0 && <p className="text-center text-gray-500 p-8">Playlist is empty.</p>}
                        </ul>
                    </div>
                 </div>
            )}
        </>
    );
};

export default AudioPlayer;