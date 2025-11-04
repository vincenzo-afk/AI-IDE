import React from 'react';

type AvatarState = 'idle' | 'thinking' | 'speaking';

interface EvoXAvatarProps {
    state: AvatarState;
}

const EvoXAvatar: React.FC<EvoXAvatarProps> = ({ state }) => {
    const baseClasses = "absolute rounded-full transition-all duration-500 ease-in-out";

    const stateStyles = {
        idle: {
            core: "w-16 h-16 bg-orange-400 animate-[evo-idle-breathe_4s_ease-in-out_infinite]",
            ring1: "w-24 h-24 border-2 border-orange-500/80 animate-[evo-idle-breathe_4s_ease-in-out_infinite_100ms]",
            ring2: "w-32 h-32 border border-orange-500/50 animate-[evo-idle-breathe_4s_ease-in-out_infinite_200ms]",
            ring3: "w-40 h-40 border border-orange-500/30 animate-[evo-idle-breathe_4s_ease-in-out_infinite_300ms]",
        },
        thinking: {
            core: "w-16 h-16 bg-cyan-400 animate-[evo-think-spin_2s_linear_infinite]",
            ring1: "w-24 h-24 border-2 border-cyan-500/80 animate-[evo-think-spin_3s_linear_infinite_reverse]",
            ring2: "w-32 h-32 border border-cyan-500/50 animate-pulse",
            ring3: "w-40 h-40 border border-cyan-500/30 animate-[evo-think-spin_4s_linear_infinite]",
        },
        speaking: {
            core: "w-16 h-16 bg-orange-400 animate-[evo-speak-wave_1s_ease-in-out_infinite]",
            ring1: "w-24 h-24 border-2 border-orange-500/80 animate-[evo-speak-wave_1s_ease-in-out_infinite_100ms]",
            ring2: "w-32 h-32 border border-orange-500/50 animate-[evo-speak-wave_1s_ease-in-out_infinite_200ms]",
            ring3: "w-40 h-40 border border-orange-500/30 opacity-50",
        },
    };

    const currentStyles = stateStyles[state] || stateStyles.idle;

    return (
        <div className="relative w-48 h-48 flex items-center justify-center">
            <div className={`${baseClasses} ${currentStyles.ring3}`}></div>
            <div className={`${baseClasses} ${currentStyles.ring2}`}></div>
            <div className={`${baseClasses} ${currentStyles.ring1}`}></div>
            <div className={`${baseClasses} ${currentStyles.core}`}></div>
        </div>
    );
};

export default EvoXAvatar;