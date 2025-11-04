import React, { useState, useEffect } from 'react';

interface StreamedResponseProps {
    text: string;
    isStreaming: boolean;
}

const TypingCursor: React.FC = () => (
    <span className="inline-block w-2.5 h-5 bg-white/70 animate-pulse rounded-full ml-1" />
);

export const StreamedResponse: React.FC<StreamedResponseProps> = ({ text, isStreaming }) => {
    const [displayedText, setDisplayedText] = useState('');

    useEffect(() => {
        if (!text) {
            setDisplayedText('');
            return;
        }

        if (displayedText.length < text.length) {
            const timeout = setTimeout(() => {
                setDisplayedText(text.substring(0, displayedText.length + 1));
            }, 20); // Typing speed in ms

            return () => clearTimeout(timeout);
        }
    }, [text, displayedText]);

    const showCursor = displayedText.length < text.length || (isStreaming && displayedText.length === text.length);

    return (
        <div className="whitespace-pre-wrap text-white font-sans">
            {displayedText}
            {showCursor && <TypingCursor />}
        </div>
    );
};
