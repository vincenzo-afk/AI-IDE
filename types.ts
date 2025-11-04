import { GroundingChunk as ApiGroundingChunk } from '@google/genai';

// Re-exporting to allow for potential future customizations or extensions.
export type GroundingChunk = ApiGroundingChunk;

// For use with the Live API, which expects this shape but doesn't export the type.
// This avoids conflict with the browser's built-in Blob type in terms of usage.
export interface Blob {
    data: string; // base64 encoded bytes
    mimeType: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  image?: {
    base64: string;
    mimeType: string;
  };
  groundingChunks?: GroundingChunk[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
}

export interface DevToolsSettings {
  systemInstruction: string;
  temperature: number;
  topP: number;
  topK: number;
}

export enum Tab {
  CHAT = 'chat',
  IMAGE = 'image',
  VIDEO = 'video',
  LIVE = 'live',
  VOICE = 'voice',
  TTS_STUDIO = 'tts',
  DOCUMENT = 'document',
  CONTROL_PANEL = 'control',
  CODE_CORE = 'codecore',
  DEV_TOOLS = 'devtools',
}

export interface PlaylistItem {
  id: string;
  name: string;
  base64Audio: string;
  source: string; // e.g., "Voice Assistant" or "TTS Studio"
}

export interface DocumentFile {
    name: string;
    content: string; // Base64 for media, text content for text files
    mimeType: string;
    type: 'text' | 'image' | 'audio' | 'video' | 'pdf';
    previewUrl?: string; // For Object URLs of audio/video
}

export interface FileSystemNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  parentId: string | null;
  content?: string; // For files only
  isOpen?: boolean; // For folders only (UI state)
}

export interface CodeCoreWorkspace {
  nodes: FileSystemNode[];
  openFileIds: string[];
  activeFileId: string | null;
}