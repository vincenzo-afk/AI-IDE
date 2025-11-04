import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GoogleGenAI, FunctionDeclaration, Type } from '@google/genai';
import { FileSystemNode, CodeCoreWorkspace, ChatMessage as AiChatMessage } from '../types';
import { getFriendlyErrorMessage } from '../utils';
import { ArrowsRightLeftIcon, FileIcon, FolderIcon, FolderOpenIcon, TerminalIcon, BoltIcon, PencilIcon, EyeIcon, ChevronRightIcon, ChevronDownIcon, CloseIcon, DownloadIcon, PlusIcon, MinusIcon, ClearIcon, DocumentDuplicateIcon, GitBranchIcon, UndoIcon, ClockIcon } from './icons';

// Add Monaco Editor & JSZip types to the window object
declare const window: any;
declare const JSZip: any;

const WORKSPACE_STORAGE_KEY = 'evox-codecore-workspace';
const CHAT_STORAGE_KEY = 'evox-codecore-chat';
const COMMITS_STORAGE_KEY = 'evox-codecore-commits';

interface Commit {
    id: string;
    message: string;
    timestamp: number;
    nodesSnapshot: FileSystemNode[];
}

interface MonacoEditorProps {
    file: FileSystemNode | undefined;
    onContentChange: (content: string) => void;
    fontSize: number;
    onCursorPositionChange: (pos: { lineNumber: number, column: number }) => void;
    onEditorReady: (editor: any) => void;
    onRefactorRequest: (selectedText: string) => void;
    readOnly?: boolean;
    originalContent?: string;
}

const MonacoEditor: React.FC<MonacoEditorProps> = ({ file, onContentChange, fontSize, onCursorPositionChange, onEditorReady, onRefactorRequest, readOnly = false, originalContent }) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const editorInstanceRef = useRef<any>(null);
    const suggestionTimeoutRef = useRef<any>(null);
    const suggestionDecoration = useRef<string[]>([]);

    const getLanguage = (fileName: string | undefined) => {
        if (!fileName) return 'plaintext';
        const language = fileName.split('.').pop();
        if (['js', 'jsx'].includes(language!)) return 'javascript';
        if (['ts', 'tsx'].includes(language!)) return 'typescript';
        if (language === 'json') return 'json';
        if (language === 'css') return 'css';
        if (language === 'html') return 'html';
        if (language === 'py') return 'python';
        return 'plaintext';
    };
    
    const clearSuggestion = useCallback(() => {
        if (editorInstanceRef.current) {
            suggestionDecoration.current = editorInstanceRef.current.deltaDecorations(suggestionDecoration.current, []);
        }
    }, []);

    const fetchAutocompleteSuggestion = useCallback(async () => {
        const editor = editorInstanceRef.current;
        if (!editor || readOnly) return;
        
        const model = editor.getModel();
        const position = editor.getPosition();
        if (!model || !position) return;

        const lineContent = model.getLineContent(position.lineNumber);
        const codeBeforeCursor = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column
        });
        
        if (!lineContent.trim() || lineContent.trim().endsWith(';')) return; // Don't trigger on empty lines or after semicolon

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
            const prompt = `You are an AI code completion assistant. Your task is to complete the current line of code based on the context. Respond with ONLY the suggested code to complete the line, without any explanation, markdown, or code block syntax.\n\nHere is the code context (the user's cursor is at the end):\n\`\`\`\n${codeBeforeCursor}\n\`\`\``;
            
            const response = await ai.models.generateContent({
                model: 'gemini-flash-lite-latest',
                contents: prompt,
            });

            const completion = response.text.trim().split('\n')[0]; // Take only the first line of suggestion
            if (completion && completion.length > 0) {
                 const currentPosition = editor.getPosition();
                 if (currentPosition && currentPosition.lineNumber === position.lineNumber && currentPosition.column === position.column) {
                    suggestionDecoration.current = editor.deltaDecorations(suggestionDecoration.current, [
                        {
                            range: new window.monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                            options: {
                                after: { content: completion, inlineClassName: 'ghost-text' },
                                isWholeLine: false
                            }
                        }
                    ]);
                 }
            }
        } catch (error) {
            console.error("Autocomplete error:", error);
        }
    }, [readOnly]);
    
    useEffect(() => {
        const createEditor = () => {
            if (!editorRef.current) return;
            const isDiffEditor = originalContent !== undefined;

            if (isDiffEditor) {
                editorInstanceRef.current = window.monaco.editor.createDiffEditor(editorRef.current, { theme: 'vs-dark', readOnly: true, automaticLayout: true, fontSize });
                const originalModel = window.monaco.editor.createModel(originalContent || '', getLanguage(file?.name));
                const modifiedModel = window.monaco.editor.createModel(file?.content || '', getLanguage(file?.name));
                editorInstanceRef.current.setModel({ original: originalModel, modified: modifiedModel });
            } else {
                editorInstanceRef.current = window.monaco.editor.create(editorRef.current, {
                    value: file?.content || '', language: getLanguage(file?.name), theme: 'vs-dark', automaticLayout: true, minimap: { enabled: true }, fontSize, wordWrap: 'on', background: '#0D1117', readOnly
                });

                editorInstanceRef.current.onDidChangeModelContent(() => {
                    if (!readOnly) onContentChange(editorInstanceRef.current.getValue());
                    clearSuggestion();
                    if(suggestionTimeoutRef.current) clearTimeout(suggestionTimeoutRef.current);
                    suggestionTimeoutRef.current = setTimeout(fetchAutocompleteSuggestion, 750);
                });

                editorInstanceRef.current.onDidChangeCursorPosition((e: any) => {
                    onCursorPositionChange(e.position);
                    clearSuggestion();
                });

                editorInstanceRef.current.onKeyDown((e: any) => {
                    if (editorInstanceRef.current.getPosition()) {
                        const decorations = editorInstanceRef.current.getModel()?.getLineDecorations(editorInstanceRef.current.getPosition().lineNumber);
                        const suggestion = decorations?.[0]?.options.after?.content;
                        if (e.keyCode === window.monaco.KeyCode.Tab && suggestion) {
                            e.preventDefault();
                            const position = editorInstanceRef.current.getPosition();
                            editorInstanceRef.current.executeEdits('suggestion', [{
                                range: new window.monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                                text: suggestion
                            }]);
                            clearSuggestion();
                        } else if (e.keyCode !== window.monaco.KeyCode.Tab) {
                            clearSuggestion();
                        }
                    }
                });
            }
            onEditorReady(editorInstanceRef.current);
        };

        if (editorRef.current) {
            if (typeof window.monaco === 'undefined') {
                window.require(['vs/editor/editor.main'], createEditor);
            } else {
                createEditor();
            }
        }

        return () => {
            if (editorInstanceRef.current) {
                editorInstanceRef.current.dispose();
                editorInstanceRef.current = null;
            }
            if (suggestionTimeoutRef.current) clearTimeout(suggestionTimeoutRef.current);
        };
    }, [originalContent]);

    useEffect(() => {
        const editor = editorInstanceRef.current;
        if (!editor || readOnly) return;
        const isDiffEditor = originalContent !== undefined;
        if (isDiffEditor) {
            const model = editor.getModel();
            if (model) {
                if (model.original.getValue() !== originalContent) model.original.setValue(originalContent || '');
                if (model.modified.getValue() !== file?.content) model.modified.setValue(file?.content || '');
            }
        } else {
            if (file && file.content !== editor.getValue()) editor.setValue(file.content || '');
            else if (!file && editor.getValue()) editor.setValue('');
            if (window.monaco && file) window.monaco.editor.setModelLanguage(editor.getModel(), getLanguage(file.name));
        }
    }, [file, originalContent, readOnly]);

    useEffect(() => {
        if (editorInstanceRef.current) editorInstanceRef.current.updateOptions({ fontSize });
    }, [fontSize]);

    useEffect(() => {
        const editor = editorInstanceRef.current;
        if (editor && !readOnly) {
            const action = editor.addAction({
                id: 'propose-refactor',
                label: 'AI: Propose a Refactor',
                contextMenuGroupId: '9_cutcopypaste',
                contextMenuOrder: 1.5,
                run: (ed: any) => {
                    const selectedText = ed.getModel().getValueInRange(ed.getSelection());
                    onRefactorRequest(selectedText);
                }
            });
            return () => action?.dispose();
        }
    }, [readOnly, onRefactorRequest]);


    return <div ref={editorRef} className="w-full h-full"></div>;
};

const createFileDeclaration: FunctionDeclaration = {
    name: 'createFile',
    parameters: {
        type: Type.OBJECT,
        description: 'Creates a new file with specified content at a given path.',
        properties: {
            path: { type: Type.STRING, description: 'The full path of the file to create (e.g., "src/components/Button.jsx").' },
            content: { type: Type.STRING, description: 'The initial content of the new file.' },
        },
        required: ['path', 'content'],
    },
};
const updateFileDeclaration: FunctionDeclaration = {
    name: 'updateFile',
    parameters: {
        type: Type.OBJECT,
        description: 'Updates the entire content of an existing file at a given path.',
        properties: {
            path: { type: Type.STRING, description: 'The full path of the file to update.' },
            content: { type: Type.STRING, description: 'The new, complete content for the file.' },
        },
        required: ['path', 'content'],
    },
};

const CodeCore: React.FC = () => {
    const [nodes, setNodes] = useState<FileSystemNode[]>([]);
    const [openFileIds, setOpenFileIds] = useState<string[]>([]);
    const [activeFileId, setActiveFileId] = useState<string | null>(null);
    const [chatMessages, setChatMessages] = useState<AiChatMessage[]>([]);
    const [terminalOutput, setTerminalOutput] = useState<string[]>(['EVO-X Terminal. Type "help" for commands.']);
    const [rightPanelTab, setRightPanelTab] = useState<'ai' | 'terminal' | 'source'>('ai');
    const [isLoading, setIsLoading] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [terminalInput, setTerminalInput] = useState('');
    const [showPreview, setShowPreview] = useState(true);
    const [isPaletteOpen, setIsPaletteOpen] = useState(false);
    const [fontSize, setFontSize] = useState(14);
    const [cursorPosition, setCursorPosition] = useState<{ lineNumber: number, column: number }>({ lineNumber: 1, column: 1 });
    const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
    const [tempNodeName, setTempNodeName] = useState('');
    const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);
    const [previewWidth, setPreviewWidth] = useState('100%');
    const [contextMenu, setContextMenu] = useState<{ visible: boolean, x: number, y: number, nodeId: string } | null>(null);
    const [commits, setCommits] = useState<Commit[]>([]);
    const [commitMessage, setCommitMessage] = useState('');
    const [stagedFileIds, setStagedFileIds] = useState<Set<string>>(new Set());
    const [refactorSuggestion, setRefactorSuggestion] = useState<{ fileId: string; originalContent: string; newContent: string; fileName: string; } | null>(null);
    const [diffModalState, setDiffModalState] = useState<{ fileId: string; fileName: string; originalContent: string; modifiedContent: string; commit?: Commit; } | null>(null);
    const [panelWidths, setPanelWidths] = useState({ explorer: 256, rightPanel: 450 });

    const editorInstanceRef = useRef<any>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const terminalEndRef = useRef<HTMLDivElement>(null);
    const dragHandleRef = useRef<string | null>(null);
    
    const handleMouseDown = (handle: 'explorer' | 'rightPanel') => {
        dragHandleRef.current = handle;
    };
    
    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!dragHandleRef.current) return;
        if (dragHandleRef.current === 'explorer') {
            const newWidth = e.clientX;
            setPanelWidths(prev => ({ ...prev, explorer: Math.max(150, Math.min(newWidth, 500)) }));
        } else if (dragHandleRef.current === 'rightPanel') {
            const newWidth = window.innerWidth - e.clientX;
            setPanelWidths(prev => ({ ...prev, rightPanel: Math.max(300, Math.min(newWidth, 800)) }));
        }
    }, []);

    const handleMouseUp = useCallback(() => {
        dragHandleRef.current = null;
    }, []);

    useEffect(() => {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [handleMouseMove, handleMouseUp]);


    useEffect(() => {
        try {
            const savedWorkspace = localStorage.getItem(WORKSPACE_STORAGE_KEY);
            if (savedWorkspace) {
                const { nodes, openFileIds, activeFileId }: CodeCoreWorkspace = JSON.parse(savedWorkspace);
                setNodes(nodes);
                setOpenFileIds(openFileIds);
                setActiveFileId(activeFileId);
            } else {
                const defaultFile: FileSystemNode = { id: `file-${Date.now()}`, name: 'welcome.js', type: 'file', parentId: null, content: `// Welcome to EVO-X CodeCore!\n// Use the AI assistant (Ctrl+K) or the terminal.\nconsole.log("Hello, EVO-X!");` };
                setNodes([defaultFile]);
                setOpenFileIds([defaultFile.id]);
                setActiveFileId(defaultFile.id);
            }
            const savedChat = localStorage.getItem(CHAT_STORAGE_KEY);
            if (savedChat) setChatMessages(JSON.parse(savedChat));
            const savedCommits = localStorage.getItem(COMMITS_STORAGE_KEY);
            if (savedCommits) setCommits(JSON.parse(savedCommits));

        } catch (error) { console.error("Failed to load CodeCore data:", error); }
    }, []);

    useEffect(() => {
        const workspaceData: CodeCoreWorkspace = { nodes, openFileIds, activeFileId };
        localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspaceData));
    }, [nodes, openFileIds, activeFileId]);

    useEffect(() => { localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatMessages)); }, [chatMessages]);
    useEffect(() => { localStorage.setItem(COMMITS_STORAGE_KEY, JSON.stringify(commits)); }, [commits]);

    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);
    useEffect(() => { terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [terminalOutput]);
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    const activeFile = nodes.find(n => n.id === activeFileId);

    const handleFileOpen = (fileId: string) => {
        if (!openFileIds.includes(fileId)) {
            setOpenFileIds(prev => [...prev, fileId]);
        }
        setActiveFileId(fileId);
    };

    const findNodeByPath = useCallback((path: string): FileSystemNode | null => {
        const parts = path.split('/').filter(p => p);
        let currentParentId: string | null = null;
        let foundNode: FileSystemNode | null = null;
        for (const part of parts) {
            const node = nodes.find(n => n.name === part && n.parentId === currentParentId);
            if (!node) return null;
            foundNode = node;
            if (node.type === 'folder') {
                currentParentId = node.id;
            }
        }
        return foundNode;
    }, [nodes]);

    const executeCreateFile = useCallback((path: string, content: string): string => {
        if (findNodeByPath(path)) return `Error: File already exists at path "${path}".`;
        const parts = path.split('/').filter(p => p);
        const fileName = parts.pop();
        if (!fileName) return "Error: Invalid file path.";

        let parentId: string | null = null;
        let finalNodes = [...nodes];

        if (parts.length > 0) {
            let currentPath = '';
            for (const part of parts) {
                currentPath += (currentPath ? '/' : '') + part;
                let folder = finalNodes.find(n => n.name === part && n.parentId === parentId);
                if (!folder) {
                    const newFolder: FileSystemNode = { id: `folder-${Date.now()}-${part}`, name: part, type: 'folder', parentId, isOpen: true };
                    finalNodes.push(newFolder);
                    parentId = newFolder.id;
                } else if (folder.type === 'folder') {
                    parentId = folder.id;
                } else {
                    return `Error: Cannot create directory. A file exists at "${currentPath}".`;
                }
            }
        }
        
        const newFile: FileSystemNode = { id: `file-${Date.now()}`, name: fileName, type: 'file', parentId, content };
        finalNodes.push(newFile);
        setNodes(finalNodes);
        handleFileOpen(newFile.id);
        return `Successfully created file: "${path}"`;
    }, [findNodeByPath, nodes]);
    
    const executeUpdateFile = useCallback((path: string, content: string): string => {
        const node = findNodeByPath(path);
        if (!node) return `Error: File not found at path "${path}".`;
        if (node.type === 'folder') return `Error: Cannot update content of a folder at path "${path}".`;
        setNodes(prev => prev.map(n => n.id === node.id ? { ...n, content } : n));
        return `Successfully updated file: "${path}"`;
    }, [findNodeByPath]);

    const handleCreateNode = (type: 'file' | 'folder', parentId: string | null = null) => {
        const name = prompt(`Enter new ${type} name:`);
        if (name) {
            const newNode: FileSystemNode = { id: `${type}-${Date.now()}`, name, type, parentId, content: type === 'file' ? '' : undefined, isOpen: type === 'folder' ? true : undefined };
            setNodes(prev => [...prev, newNode]);
            if (type === 'file') handleFileOpen(newNode.id);
            if (parentId) setNodes(prev => prev.map(n => n.id === parentId ? {...n, isOpen: true} : n));
        }
    };
    
    const deleteNodeRecursive = (nodeId: string) => {
        const nodesToDelete = new Set<string>([nodeId]);
        const queue: string[] = [nodeId];
        const allNodes = [...nodes]; 

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            const children = allNodes.filter(n => n.parentId === currentId);
            for (const child of children) {
                if (!nodesToDelete.has(child.id)) {
                    nodesToDelete.add(child.id);
                    if (child.type === 'folder') queue.push(child.id);
                }
            }
        }
        
        setNodes(prev => prev.filter(n => !nodesToDelete.has(n.id)));
        const newOpenFileIds = openFileIds.filter(id => !nodesToDelete.has(id));
        setOpenFileIds(newOpenFileIds);

        if (activeFileId && nodesToDelete.has(activeFileId)) {
            setActiveFileId(newOpenFileIds.length > 0 ? newOpenFileIds[newOpenFileIds.length - 1] : null);
        }
    };

    const handleDuplicateNode = (nodeId: string) => {
        const sourceNode = nodes.find(n => n.id === nodeId);
        if (!sourceNode) return;
        
        let newNodes: FileSystemNode[] = [];
        const nameParts = sourceNode.name.split('.');
        const baseName = nameParts.length > 1 ? nameParts.slice(0, -1).join('.') : sourceNode.name;
        const extension = nameParts.length > 1 ? `.${nameParts[nameParts.length - 1]}` : '';
        const newName = `${baseName}_copy${extension}`;

        if (sourceNode.type === 'file') {
            const newNode: FileSystemNode = { ...sourceNode, id: `file-${Date.now()}`, name: newName };
            newNodes.push(newNode);
        } else { // folder
            const newFolderId = `folder-${Date.now()}`;
            const newFolder: FileSystemNode = { ...sourceNode, id: newFolderId, name: newName, isOpen: true };
            newNodes.push(newFolder);

            const copyChildrenRecursive = (originalParentId: string, newParentId: string) => {
                const children = nodes.filter(n => n.parentId === originalParentId);
                for (const child of children) {
                    const newChildId = `${child.type}-${Date.now()}-${child.name}`;
                    const newChild: FileSystemNode = { ...child, id: newChildId, parentId: newParentId };
                    newNodes.push(newChild);
                    if (child.type === 'folder') {
                        copyChildrenRecursive(child.id, newChildId);
                    }
                }
            };
            copyChildrenRecursive(sourceNode.id, newFolderId);
        }
        setNodes(prev => [...prev, ...newNodes]);
    };

    const handleDeleteNode = (nodeId: string) => {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) return;
        if (confirm(`Delete '${node.name}' and all its contents?`)) {
            deleteNodeRecursive(nodeId);
        }
    };
    
    const handleRenameNode = (nodeId: string, newName: string) => {
        if (!newName.trim()) return;
        setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, name: newName.trim() } : n));
        setRenamingNodeId(null);
        setTempNodeName('');
    };
    
    const toggleFolder = (folderId: string) => setNodes(prev => prev.map(n => n.id === folderId ? { ...n, isOpen: !n.isOpen } : n));

    const handleFileClose = (fileId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const fileIndex = openFileIds.indexOf(fileId);
        const newOpenFileIds = openFileIds.filter(id => id !== fileId);
        setOpenFileIds(newOpenFileIds);
        if (activeFileId === fileId) {
            const newActiveId = fileIndex > 0 ? newOpenFileIds[fileIndex - 1] : newOpenFileIds.length > 0 ? newOpenFileIds[0] : null;
            setActiveFileId(newActiveId);
        }
    };

    const handleNodeMove = (draggedId: string, targetFolderId: string | null) => {
        const draggedNode = nodes.find(n => n.id === draggedId);
        if (!draggedNode) return;
        let currentParentId = targetFolderId;
        while (currentParentId) {
            if (currentParentId === draggedId) return; // Prevent dropping folder into itself
            const parentNode = nodes.find(n => n.id === currentParentId);
            currentParentId = parentNode?.parentId || null;
        }
        setNodes(prev => prev.map(n => n.id === draggedId ? { ...n, parentId: targetFolderId } : n));
    };

    const handleExportZip = async () => {
        const zip = new JSZip();
        const buildZip = (currentFolder: any, parentId: string | null) => {
            nodes.filter(n => n.parentId === parentId).forEach(node => {
                if (node.type === 'file') {
                    currentFolder.file(node.name, node.content || '');
                } else {
                    const subFolder = currentFolder.folder(node.name);
                    buildZip(subFolder, node.id);
                }
            });
        };
        buildZip(zip, null);
        const content = await zip.generateAsync({ type: "blob" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(content);
        link.download = "evox-project.zip";
        link.click();
        URL.revokeObjectURL(link.href);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        files.forEach((file: File) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const newNode: FileSystemNode = { id: `file-${Date.now()}-${file.name}`, name: file.name, type: 'file', parentId: null, content: event.target?.result as string };
                setNodes(prev => [...prev, newNode]);
                handleFileOpen(newNode.id);
            };
            reader.readAsText(file);
        });
    };
    
    const triggerSelfRepair = useCallback(async (file: FileSystemNode, errorText: string) => {
        setChatMessages(prev => [...prev, { role: 'model', text: `⚠️ I've detected an error in \`${file.name}\`. Attempting to fix it now...` }]);
        setRightPanelTab('ai');
        setIsLoading(true);

        const getPathForNode = (nodeId: string): string => {
            let path = '';
            let currentNode = nodes.find(n => n.id === nodeId);
            while (currentNode) {
                path = `${currentNode.name}${path ? '/' : ''}${path}`;
                const parent = nodes.find(n => n.id === currentNode!.parentId);
                currentNode = parent;
            }
            return path;
        };
        const filePath = getPathForNode(file.id);

        try {
            const apiKey = process.env.API_KEY;
            if (!apiKey) throw new Error("API_KEY is not configured.");
            const ai = new GoogleGenAI({ apiKey });

            const prompt = `The following code in the file "${filePath}" produced an error when run. Please fix the error and call the 'updateFile' tool with the corrected code.\n\nError:\n\`\`\`\n${errorText}\n\`\`\`\n\nCode:\n\`\`\`\n${file.content}\n\`\`\``;
            
            const response = await ai.models.generateContent({ 
                model: 'gemini-2.5-pro', 
                contents: prompt,
                config: { tools: [{ functionDeclarations: [updateFileDeclaration] }] }
            });
            
            if (response.functionCalls && response.functionCalls.length > 0) {
                for (const fc of response.functionCalls) {
                    if (fc.name === 'updateFile') {
                        // FIX: Explicitly cast arguments to string to prevent type errors.
                        const { path, content } = fc.args;
                        const result = executeUpdateFile(String(path), String(content));
                        setTerminalOutput(prev => [...prev, `[AI Self-Repair] ${result}`]);
                    }
                }
            }
            
            const successMsg = response.text || `✅ Self-repair successful. I've updated \`${file.name}\` with the fix.`;
            setChatMessages(prev => [...prev, { role: 'model', text: successMsg }]);
           
        } catch (error) {
            const errorMsg = `⚠️ Self-repair failed for \`${file.name}\`. Error: ${getFriendlyErrorMessage(error)}`;
            setChatMessages(prev => [...prev, { role: 'model', text: errorMsg }]);
        } finally {
            setIsLoading(false);
        }
    }, [nodes, executeUpdateFile]);

    const handleAiSend = useCallback(async (commandOverride?: string) => {
        const userInput = commandOverride || chatInput;
        if (!userInput.trim()) return;

        setChatMessages(prev => [...prev, { role: 'user', text: userInput }]);
        setChatInput('');
        setIsLoading(true);
        setIsPaletteOpen(false);

        const buildFileTree = (parentId: string | null = null, indent = ''): string => {
            return nodes.filter(n => n.parentId === parentId)
                .map(n => `${indent}${n.name}${n.type === 'folder' ? '/\n' + buildFileTree(n.id, indent + '  ') : ''}`)
                .join('\n');
        };

        const getPathForNode = (nodeId: string): string => {
            let path = '';
            let currentNode = nodes.find(n => n.id === nodeId);
            while (currentNode) {
                path = `${currentNode.name}${path ? '/' : ''}${path}`;
                const parent = nodes.find(n => n.id === currentNode!.parentId);
                currentNode = parent;
            }
            return path;
        };

        try {
            const apiKey = process.env.API_KEY;
            if (!apiKey) throw new Error("API_KEY is not configured.");
            const ai = new GoogleGenAI({ apiKey });
            
            if (userInput.startsWith('/create project')) {
                const projectDesc = userInput.replace('/create project', '').trim();
                const prompt = `Based on the user's request, generate a complete file and folder structure. The user wants to create: "${projectDesc}". Respond with ONLY a single JSON object in the format \`{ "files": { "path/to/file.js": "file content", "another/file.css": "/* css content */" } }\`. Do not include any other text, explanations, or markdown.`;
                const response = await ai.models.generateContent({ model: 'gemini-2.5-pro', contents: prompt });
                
                let fileData;
                try {
                    const cleanedText = response.text.replace(/```json\n?|```/g, '');
                    fileData = JSON.parse(cleanedText);
                } catch (e) {
                    throw new Error("AI did not return a valid JSON structure. Please try again with a more specific prompt.");
                }

                if (fileData && fileData.files) {
                    let creationLog = 'Project scaffolding started...\n';
                    setChatMessages(prev => [...prev, { role: 'model', text: creationLog }]);
                    for (const [path, content] of Object.entries(fileData.files)) {
                        const result = executeCreateFile(path, content as string);
                        creationLog += `${result}\n`;
                        setChatMessages(prev => {
                            const newMessages = [...prev];
                            newMessages[newMessages.length - 1] = { role: 'model', text: creationLog };
                            return newMessages;
                        });
                    }
                    creationLog += 'Project scaffolding complete!';
                    setChatMessages(prev => {
                        const newMessages = [...prev];
                        newMessages[newMessages.length - 1] = { role: 'model', text: creationLog };
                        return newMessages;
                    });
                }
                return;
            }

            const editor = editorInstanceRef.current;
            const selectedText = editor?.getModel().getValueInRange(editor.getSelection());
            
            const fileTree = buildFileTree();
            let context = `The current project structure is:\n${fileTree}\n\n`;
            if (activeFile) {
                context += `The user currently has the file "${getPathForNode(activeFile.id)}" open.\n`;
                 if(userInput.startsWith('/debug') || userInput.startsWith('/dependencies') || userInput.startsWith('/document') || userInput.startsWith('/refactor') || userInput.startsWith('/test') || userInput.startsWith('/explain')) {
                    context += `File content:\n\`\`\`\n${activeFile.content}\n\`\`\`\n`;
                }
            }
            if (selectedText) {
                context += `The user has the following code selected:\n\`\`\`\n${selectedText}\n\`\`\`\n`;
            }

            let prompt = `You are an expert AI developer integrated into an IDE. You can read and write files. Use the provided tools to fulfill the user's request.\n\n${context}\n\nUser Request: ${userInput}`;
            let isRefactor = false;
            
            if(userInput.startsWith('/debug')){
                 prompt = `You are an AI debugging assistant. Analyze the following code from "${activeFile?.name}", provide a step-by-step execution trace, identify potential bugs, and inspect the state of key variables. Respond in clear markdown format.\n\n${context}`;
            } else if (userInput.startsWith('/dependencies')){
                 prompt = `You are an AI dependency manager. Analyze the following dependency file ("${activeFile?.name}"), report any outdated packages, security vulnerabilities, or missing dependencies. Provide a summary and a list of suggested actions.\n\n${context}`;
            } else if (userInput.startsWith('/document')){
                 prompt = `You are an AI technical writer. Generate clear and concise documentation for the following code from "${activeFile?.name}". Explain the purpose, parameters, and return values for functions/classes.\n\n${context}`;
            } else if (userInput.startsWith('/explain')){
                 prompt = `You are an AI Code Mentor. Provide a detailed, line-by-line explanation of the following code from "${activeFile?.name}". Break down complex logic, explain the purpose of functions/variables, and discuss any notable design patterns. Respond in clear, easy-to-understand markdown.\n\n${context}`;
            } else if (userInput.startsWith('/test') && activeFile) {
                const nameParts = activeFile.name.split('.');
                const extension = nameParts.pop();
                const baseName = nameParts.join('.');
                const testFileName = `${baseName}.test.${extension}`;
                const testFilePath = getPathForNode(activeFile.id).replace(activeFile.name, testFileName);
                prompt = `You are an AI test generation assistant. Write comprehensive unit tests for the following code from "${activeFile.name}". Use an appropriate testing framework (like Jest for JS/TS, pytest for Python, etc.). Use the 'createFile' tool to create a new file named "${testFilePath}" with the generated test code. After creating the file, respond with a brief explanation of the tests you wrote.`;
            } else if (userInput.startsWith('/refactor') && activeFile) {
                isRefactor = true;
                prompt = `You are an AI code refactoring assistant. Your task is to rewrite the provided code from "${activeFile.name}" to improve its quality. The user wants to: "${userInput.replace('/refactor', '').trim()}". Consider factors like readability, efficiency, and best practices. Respond with ONLY the complete, updated code for the entire file. Do not include any explanations, markdown, or code block syntax.`;
            }

            const response = await ai.models.generateContent({ 
                model: 'gemini-2.5-pro', 
                contents: prompt,
                config: { tools: [{ functionDeclarations: [createFileDeclaration, updateFileDeclaration] }] }
            });
            
            if (isRefactor && activeFile) {
                setRefactorSuggestion({
                    fileId: activeFile.id,
                    fileName: activeFile.name,
                    originalContent: activeFile.content || '',
                    newContent: response.text,
                });
                return;
            }
            
            let toolExecutionResults = '';
            if (response.functionCalls && response.functionCalls.length > 0) {
                for (const fc of response.functionCalls) {
                    let result = '';
                    if (fc.name === 'createFile') {
                        result = executeCreateFile(String(fc.args.path), String(fc.args.content));
                    } else if (fc.name === 'updateFile') {
                        result = executeUpdateFile(String(fc.args.path), String(fc.args.content));
                    }
                    toolExecutionResults += `${result}\n`;
                }
            }

            const explanation = response.text || (toolExecutionResults ? `I've completed your request.\n${toolExecutionResults}` : "I'm not sure how to do that.");
            setChatMessages(prev => [...prev, { role: 'model', text: explanation }]);

        } catch (error) {
            setChatMessages(prev => [...prev, { role: 'model', text: `Error: ${getFriendlyErrorMessage(error)}` }]);
        } finally { setIsLoading(false); }
    }, [chatInput, activeFile, nodes, executeCreateFile, executeUpdateFile]);
    
    const handleRefactorRequest = useCallback((selectedText: string) => {
        const command = `/refactor ${selectedText ? 'the selected code to improve clarity and efficiency.' : 'the current file to improve its overall structure and readability.'}`;
        setChatInput(command);
        setRightPanelTab('ai');
        // A small delay to allow the user to see the command in the input before sending
        setTimeout(() => handleAiSend(command), 100);
    }, [handleAiSend]);

    const handleTerminalCommand = useCallback(async () => {
        const command = terminalInput.trim();
        if (!command) return;

        let output = [`> ${command}`];
        setTerminalInput('');
        const [cmd, ...args] = command.split(' ');

        const findNodeByPathCli = (path: string): { node: FileSystemNode | null } => {
            if (!path) return { node: null };
            const parts = path.split('/').filter(p => p);
            let currentParentId: string | null = null;
            let foundNode: FileSystemNode | null = null;
            for (const part of parts) {
                const node = nodes.find(n => n.name === part && n.parentId === currentParentId);
                if (!node) return { node: null };
                foundNode = node;
                currentParentId = node.id;
            }
            return { node: foundNode };
        };
        
        switch (cmd) {
            case 'help': output.push('Commands: ls, mkdir, touch, rm, cat, run, clear, npm install, pip install'); break;
            case 'ls':
                const targetPath = args[0] || '';
                const { node: lsNode } = targetPath ? findNodeByPathCli(targetPath) : { node: null };
                const parentId = targetPath ? (lsNode?.type === 'folder' ? lsNode.id : null) : null;
                if (targetPath && !lsNode) {
                    output.push(`ls: cannot access '${targetPath}': No such directory`);
                } else if (targetPath && lsNode?.type === 'file') {
                    output.push(lsNode.name);
                }
                 else {
                    const children = nodes.filter(n => n.parentId === parentId).map(n => n.name + (n.type === 'folder' ? '/' : ''));
                    output.push(children.join('\n') || 'Directory is empty.');
                }
                break;
            case 'mkdir':
            case 'touch': {
                const newPath = args[0];
                if (!newPath) { output.push(`${cmd}: missing operand`); break; }
                const { node } = findNodeByPathCli(newPath);
                if (node) { output.push(`${cmd}: cannot create '${newPath}': File exists`); break; }
                
                const parts = newPath.split('/').filter(p => p);
                const name = parts.pop();
                if (!name) { output.push(`${cmd}: invalid path`); break; }

                const parentPath = parts.join('/');
                const parentNode = parentPath ? findNodeByPathCli(parentPath).node : null;
                if (parentPath && !parentNode) { output.push(`${cmd}: cannot create directory '${newPath}': No such file or directory`); break; }

                const parentId = parentNode ? parentNode.id : null;

                const newNode: FileSystemNode = {
                    id: `${cmd === 'mkdir' ? 'folder' : 'file'}-${Date.now()}`, name,
                    type: cmd === 'mkdir' ? 'folder' : 'file', parentId,
                    content: cmd === 'touch' ? '' : undefined, isOpen: cmd === 'mkdir' ? true : undefined,
                };
                setNodes(prev => [...prev, newNode]);
                if (parentId) setNodes(prev => prev.map(n => n.id === parentId ? {...n, isOpen: true} : n));
                break;
            }
            case 'rm': {
                const isRecursive = args[0] === '-r';
                const pathToRemove = isRecursive ? args[1] : args[0];
                if (!pathToRemove) { output.push('rm: missing operand'); break; }
                const { node } = findNodeByPathCli(pathToRemove);
                if (!node) { output.push(`rm: cannot remove '${pathToRemove}': No such file or directory`); break; }
                if (node.type === 'folder' && !isRecursive) { output.push(`rm: cannot remove '${pathToRemove}': Is a directory`); break; }
                deleteNodeRecursive(node.id);
                break;
            }
            case 'cat':
                const { node: fileToCat } = findNodeByPathCli(args.join(' '));
                if (fileToCat && fileToCat.type === 'file') {
                    output.push(fileToCat.content || '[Empty file]');
                } else {
                    output.push(`cat: ${args.join(' ')}: No such file or is a directory`);
                }
                break;
            case 'clear':
                setTerminalOutput(['EVO-X Terminal. Type "help" for commands.']);
                return;
            case 'run': {
                const { node: fileToRun } = findNodeByPathCli(args.join(' '));
                if (fileToRun && fileToRun.type === 'file') {
                    output.push(`Simulating execution of ${fileToRun.name}...`);
                    setTerminalOutput(prev => [...prev, ...output]);
                    try {
                        const apiKey = process.env.API_KEY;
                        if (!apiKey) throw new Error("API_KEY is not configured.");
                        const ai = new GoogleGenAI({ apiKey });
                        const language = fileToRun.name.endsWith('.py') ? 'Python' : 'JavaScript';
                        const prompt = `You are a code execution simulator. Execute the following ${language} code and provide ONLY the standard output. If there's an error, provide the error message prefixed with "Error:". Do not provide any explanation or commentary. Code:\n\n${fileToRun.content}`;
                        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
                        const executionResult = response.text.trim();
                        
                        if (executionResult.toLowerCase().startsWith('error:') || executionResult.toLowerCase().includes('traceback')) {
                            setTerminalOutput(p => [...p, `\n--- ERROR DETECTED ---\n${executionResult}\n----------------------`]);
                            triggerSelfRepair(fileToRun, executionResult);
                        } else {
                            setTerminalOutput(p => [...p, executionResult || '[No output]']);
                        }
                    } catch (error) {
                        setTerminalOutput(p => [...p, `Simulation Error: ${getFriendlyErrorMessage(error)}`]);
                    }
                    return;
                } else {
                    output.push(`run: ${args.join(' ')}: No such file or is a directory`);
                }
                break;
            }
            case 'npm':
            case 'pip':
                if (args[0] === 'install' && args[1]) {
                    const pkg = args[1];
                    const fileName = cmd === 'npm' ? 'package.json' : 'requirements.txt';
                    const fileNode = nodes.find(n => n.name === fileName && n.parentId === null);
                    if (!fileNode) {
                        output.push(`Error: ${fileName} not found in root directory.`);
                    } else {
                        output.push(`Installing ${pkg}...`);
                        setTerminalOutput(prev => [...prev, ...output]);
                        await new Promise(res => setTimeout(res, 500));
                        setTerminalOutput(prev => [...prev, `... fetching packages...`]);
                        await new Promise(res => setTimeout(res, 800));

                        let newContent = fileNode.content || '';
                        if (cmd === 'npm') {
                            try {
                                const pkgJson = JSON.parse(newContent || '{}');
                                if (!pkgJson.dependencies) pkgJson.dependencies = {};
                                pkgJson.dependencies[pkg] = 'latest';
                                newContent = JSON.stringify(pkgJson, null, 2);
                            } catch (e) {
                                setTerminalOutput(prev => [...prev, `Error: could not parse ${fileName}.`]);
                                return;
                            }
                        } else { // pip
                            newContent += (newContent ? '\n' : '') + pkg;
                        }

                        setNodes(prev => prev.map(n => n.id === fileNode.id ? { ...n, content: newContent } : n));
                        setTerminalOutput(prev => [...prev, `Successfully installed ${pkg} and updated ${fileName}.`]);
                        return;
                    }
                } else {
                    output.push(`Unsupported command: ${cmd} ${args.join(' ')}`);
                }
                break;
            default: output.push(`command not found: ${cmd}`);
        }
        setTerminalOutput(prev => [...prev, ...output]);
    }, [terminalInput, nodes, triggerSelfRepair]);
    
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setIsPaletteOpen(p => !p); }
            if (e.key === 'Escape') {
                setIsPaletteOpen(false);
                setDiffModalState(null);
                setRefactorSuggestion(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);
    
    const CommandPalette = () => {
        const [search, setSearch] = useState('');
        const paletteRef = useRef<HTMLDivElement>(null);
        const commands = [
            { cmd: '/explain', desc: 'Explain the code in the current file or selection.' },
            { cmd: '/test', desc: 'Generate unit tests for the current file.' },
            { cmd: '/refactor', desc: 'Refactor selected code or the current file.' },
            { cmd: '/fix', desc: 'Attempt to fix errors in the current file.' },
            { cmd: '/optimize', desc: 'Optimize code for performance & readability.' },
            { cmd: '/document', desc: 'Generate documentation for the current file.' },
            { cmd: '/debug', desc: 'Run AI debugger on the current file.'},
            { cmd: '/dependencies', desc: 'Check dependencies in package.json, etc.'},
            { cmd: '/create project ', desc: 'Create a new project from a description.' },
        ];
        const filteredCommands = commands.filter(c => c.cmd.toLowerCase().includes(search.toLowerCase()) || c.desc.toLowerCase().includes(search.toLowerCase()));

        useEffect(() => {
            const handleClickOutside = (event: MouseEvent) => {
                if (paletteRef.current && !paletteRef.current.contains(event.target as Node)) setIsPaletteOpen(false);
            };
            document.addEventListener("mousedown", handleClickOutside);
            return () => document.removeEventListener("mousedown", handleClickOutside);
        }, []);

        return (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-20">
                <div ref={paletteRef} className="w-full max-w-lg rounded-lg shadow-lg" style={{backgroundColor: 'var(--bg-space)'}}>
                    <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Type a command or search..." autoFocus className="w-full p-3 bg-transparent focus:outline-none border-b" style={{borderColor: 'var(--border-primary)'}}/>
                    <ul className="p-2 max-h-80 overflow-y-auto">
                        {filteredCommands.map(c => (
                            <li key={c.cmd} onClick={() => handleAiSend(c.cmd)} className="p-2 hover:bg-white/10 rounded-md cursor-pointer">
                                <p className="font-semibold" style={{color: 'var(--accent-orange)'}}>{c.cmd}</p>
                                <p className="text-sm" style={{color: 'var(--text-secondary)'}}>{c.desc}</p>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        );
    };

    const FileExplorer = ({ parentId, level }: { parentId: string | null; level: number }) => {
        const children = nodes.filter(node => node.parentId === parentId).sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === 'folder' ? -1 : 1;
        });

        const handleDropOnFolder = (e: React.DragEvent, targetFolderId: string | null) => {
            e.preventDefault(); e.stopPropagation();
            if (draggedNodeId) handleNodeMove(draggedNodeId, targetFolderId);
            setDropTargetId(null);
        };
        
        return (
            <div 
                style={{ paddingLeft: level > 0 ? '1rem' : '0' }}
                onDragOver={(e) => { e.preventDefault(); if (parentId === null) setDropTargetId('root'); }}
                onDragLeave={() => setDropTargetId(null)}
                onDrop={(e) => handleDropOnFolder(e, parentId)}
            >
                {children.map(node => (
                    <div key={node.id}>
                        <div
                            className={`group flex items-center p-1 rounded-md cursor-pointer hover:bg-white/5 ${activeFileId === node.id ? 'bg-orange-600/10' : ''} ${dropTargetId === node.id ? 'bg-orange-500/20 ring-1 ring-orange-400' : ''}`}
                            onClick={node.type === 'folder' ? () => toggleFolder(node.id) : () => handleFileOpen(node.id)}
                            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, nodeId: node.id }); }}
                            draggable="true"
                            onDragStart={() => setDraggedNodeId(node.id)}
                            onDragEnd={() => setDraggedNodeId(null)}
                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (node.type === 'folder' && node.id !== draggedNodeId) setDropTargetId(node.id); }}
                            onDragLeave={() => setDropTargetId(null)}
                            onDrop={(e) => node.type === 'folder' && handleDropOnFolder(e, node.id)}
                        >
                            {node.type === 'folder' ? (node.isOpen ? <ChevronDownIcon className="w-4 h-4 mr-1 flex-shrink-0" /> : <ChevronRightIcon className="w-4 h-4 mr-1 flex-shrink-0" />) : <div className="w-4 mr-1"></div>}
                            {node.type === 'folder' ? (node.isOpen ? <FolderOpenIcon className="w-5 h-5 mr-2 flex-shrink-0" /> : <FolderIcon className="w-5 h-5 mr-2 flex-shrink-0" />) : <FileIcon className="w-5 h-5 mr-2 flex-shrink-0" />}
                            {renamingNodeId === node.id ? (
                                <input type="text" value={tempNodeName} onChange={e => setTempNodeName(e.target.value)} autoFocus onBlur={() => handleRenameNode(node.id, tempNodeName)} onKeyDown={e => e.key === 'Enter' && handleRenameNode(node.id, tempNodeName)} className="bg-transparent w-full focus:outline-none ring-1 ring-orange-500 rounded-sm px-1"/>
                            ) : (
                                <span className="truncate text-sm flex-1">{node.name}</span>
                            )}
                        </div>
                        {node.type === 'folder' && node.isOpen && <FileExplorer parentId={node.id} level={level + 1} />}
                    </div>
                ))}
            </div>
        );
    };
    
    const ContextMenu = () => {
        if (!contextMenu?.visible) return null;
        const node = nodes.find(n => n.id === contextMenu.nodeId);
        if (!node) return null;

        const menuActions = [
            { label: 'Rename', icon: <PencilIcon className="w-4 h-4 mr-2"/>, action: () => { setRenamingNodeId(node.id); setTempNodeName(node.name); } },
            { label: 'Duplicate', icon: <DocumentDuplicateIcon className="w-4 h-4 mr-2"/>, action: () => handleDuplicateNode(node.id) },
            { label: 'Delete', icon: <ClearIcon className="w-4 h-4 mr-2"/>, action: () => handleDeleteNode(node.id) },
        ];
        if (node.type === 'file') {
             menuActions.unshift({ label: 'AI: Propose a Refactor', icon: <ArrowsRightLeftIcon className="w-4 h-4 mr-2"/>, action: () => { setActiveFileId(node.id); handleRefactorRequest(''); } });
        }
        if (node.type === 'folder') {
            menuActions.unshift({ label: 'New File', icon: <FileIcon className="w-4 h-4 mr-2"/>, action: () => handleCreateNode('file', node.id) });
            menuActions.unshift({ label: 'New Folder', icon: <FolderIcon className="w-4 h-4 mr-2"/>, action: () => handleCreateNode('folder', node.id) });
        }
        
        return (
            <div className="fixed z-50 rounded-md shadow-lg p-1 text-sm" style={{ top: contextMenu.y, left: contextMenu.x, backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-primary)'}}>
                {menuActions.map(item => (
                    <button key={item.label} onClick={item.action} className="w-full flex items-center px-3 py-1.5 hover:bg-orange-600/20 rounded-sm text-left">
                        {item.icon} {item.label}
                    </button>
                ))}
            </div>
        );
    };

    const SourceControlPanel = () => {
        const [view, setView] = useState<'changes' | 'history'>('changes');
        const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);

        const lastCommit = commits[0];
        
        const allChanges = useMemo(() => {
            const lastCommitFiles = new Map(lastCommit?.nodesSnapshot.map(n => [n.id, n]));
            const currentFiles = new Map(nodes.map(n => [n.id, n]));
            const changes: { node: FileSystemNode, status: 'added' | 'modified' | 'deleted' }[] = [];
            
            currentFiles.forEach(node => {
                const oldNode = lastCommitFiles.get(node.id);
                if (!oldNode) {
                    if (node.type === 'file') changes.push({ node, status: 'added' });
                } else if (node.content !== oldNode.content) {
                    if (node.type === 'file') changes.push({ node, status: 'modified' });
                }
            });
            
            lastCommitFiles.forEach(oldNode => {
                if (!currentFiles.has(oldNode.id)) {
                    if (oldNode.type === 'file') changes.push({ node: oldNode, status: 'deleted' });
                }
            });
            return changes;
        }, [nodes, lastCommit]);
        
        const stagedChanges = allChanges.filter(c => stagedFileIds.has(c.node.id));
        const unstagedChanges = allChanges.filter(c => !stagedFileIds.has(c.node.id));

        const handleCommit = () => {
            if (!commitMessage.trim() || stagedChanges.length === 0) return;
            const newCommit: Commit = { id: `commit-${Date.now()}`, message: commitMessage, timestamp: Date.now(), nodesSnapshot: JSON.parse(JSON.stringify(nodes)) };
            setCommits(prev => [newCommit, ...prev]);
            setCommitMessage('');
            setStagedFileIds(new Set());
        };
        
        const handleStageFileClick = (change: { node: FileSystemNode, status: string }) => {
            const originalContent = lastCommit?.nodesSnapshot.find(n => n.id === change.node.id)?.content || '';
            const modifiedContent = change.status === 'deleted' ? '' : nodes.find(n => n.id === change.node.id)?.content || '';
            setDiffModalState({ fileId: change.node.id, fileName: change.node.name, originalContent, modifiedContent });
        };

        const getCommitChanges = (commit: Commit, previousCommit?: Commit) => {
            const changes: {node: FileSystemNode, status: 'added' | 'modified' | 'deleted'}[] = [];
            const currentSnapshot = new Map(commit.nodesSnapshot.map(n => [n.id, n]));
            const previousSnapshot = new Map(previousCommit?.nodesSnapshot.map(n => [n.id, n]) || []);

            currentSnapshot.forEach(node => {
                if (node.type !== 'file') return;
                const prevNode = previousSnapshot.get(node.id);
                if (!prevNode) changes.push({ node, status: 'added' });
                else if (prevNode.content !== node.content) changes.push({ node, status: 'modified' });
            });
            previousSnapshot.forEach(prevNode => {
                if (prevNode.type !== 'file') return;
                if (!currentSnapshot.has(prevNode.id)) changes.push({ node: prevNode, status: 'deleted' });
            });
            return changes;
        };

        const timeAgo = (timestamp: number) => {
            const now = Date.now();
            const seconds = Math.floor((now - timestamp) / 1000);
            let interval = seconds / 31536000;
            if (interval > 1) return `${Math.floor(interval)} years ago`;
            interval = seconds / 2592000;
            if (interval > 1) return `${Math.floor(interval)} months ago`;
            interval = seconds / 86400;
            if (interval > 1) return `${Math.floor(interval)} days ago`;
            interval = seconds / 3600;
            if (interval > 1) return `${Math.floor(interval)} hours ago`;
            interval = seconds / 60;
            if (interval > 1) return `${Math.floor(interval)} minutes ago`;
            return `${Math.floor(seconds)} seconds ago`;
        };

        const handleHistoryFileClick = (commit: Commit, fileChange: { node: FileSystemNode }) => {
            const commitIndex = commits.findIndex(c => c.id === commit.id);
            const previousCommit = commits[commitIndex + 1];
            const originalContent = previousCommit?.nodesSnapshot.find(n => n.id === fileChange.node.id)?.content || '';
            const modifiedContent = commit.nodesSnapshot.find(n => n.id === fileChange.node.id)?.content || '';
            setDiffModalState({ fileId: fileChange.node.id, fileName: fileChange.node.name, originalContent, modifiedContent, commit });
        };
        
        return (
            <div className="flex-1 flex flex-col p-2 space-y-2 overflow-y-hidden" style={{minHeight: 0}}>
                <div className="flex border-b" style={{borderColor: 'var(--border-primary)'}}>
                    <button onClick={() => setView('changes')} className={`flex-1 p-2 text-sm font-semibold ${view === 'changes' ? 'text-orange-400 border-b-2 border-orange-400' : 'text-gray-400'}`}>Changes</button>
                    <button onClick={() => setView('history')} className={`flex-1 p-2 text-sm font-semibold ${view === 'history' ? 'text-orange-400 border-b-2 border-orange-400' : 'text-gray-400'}`}>History</button>
                </div>

                {view === 'changes' ? (
                    <>
                        <div className="border-b pb-2" style={{borderColor: 'var(--border-primary)'}}>
                            <input value={commitMessage} onChange={e => setCommitMessage(e.target.value)} placeholder="Commit message..." className="w-full p-2 bg-transparent focus:outline-none rounded-md" style={{border: '1px solid var(--border-primary)'}} />
                            <button onClick={handleCommit} disabled={!commitMessage.trim() || stagedChanges.length === 0} className="w-full mt-2 font-semibold py-2 rounded-md disabled:opacity-50" style={{backgroundColor: 'var(--accent-orange)'}}>Commit</button>
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-3">
                            {stagedChanges.length > 0 && <div><h4 className="font-semibold text-sm p-1">Staged Changes ({stagedChanges.length})</h4>{stagedChanges.map(change => <ChangeItem key={change.node.id} change={change} isStaged={true} onFileClick={handleStageFileClick} setStagedFileIds={setStagedFileIds} />)}</div>}
                            {unstagedChanges.length > 0 && <div><h4 className="font-semibold text-sm p-1">Changes ({unstagedChanges.length})</h4>{unstagedChanges.map(change => <ChangeItem key={change.node.id} change={change} isStaged={false} onFileClick={handleStageFileClick} setStagedFileIds={setStagedFileIds} />)}</div>}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 overflow-y-auto">
                        {commits.map((commit, index) => (
                            <div key={commit.id} className="p-1 border-b" style={{borderColor: 'var(--border-primary)'}}>
                                <div onClick={() => setSelectedCommitId(selectedCommitId === commit.id ? null : commit.id)} className="cursor-pointer p-1 hover:bg-white/5 rounded-md">
                                    <p className="font-semibold truncate">{commit.message}</p>
                                    <p className="text-xs text-gray-400">commit by User - {timeAgo(commit.timestamp)}</p>
                                </div>
                                {selectedCommitId === commit.id && (
                                    <div className="pl-4 mt-1">
                                        {getCommitChanges(commit, commits[index + 1]).map(change => (
                                            <div key={change.node.id} onClick={() => handleHistoryFileClick(commit, change)} className="flex items-center p-1.5 rounded-md hover:bg-white/10 cursor-pointer">
                                                 <span className={`w-4 h-4 rounded-sm mr-2 flex items-center justify-center text-xs font-bold ${change.status === 'added' ? 'bg-green-500' : change.status === 'deleted' ? 'bg-red-500' : 'bg-yellow-500'}`}>{change.status.charAt(0).toUpperCase()}</span>
                                                 <span className="truncate text-sm">{change.node.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const ChangeItem = ({change, isStaged, onFileClick, setStagedFileIds}: any) => (
        <div className="flex items-center justify-between group p-1.5 rounded-md hover:bg-white/5">
            <span onClick={() => onFileClick(change)} className="flex items-center cursor-pointer truncate text-sm">
                <span className={`w-4 h-4 rounded-sm mr-2 flex items-center justify-center text-xs font-bold ${change.status === 'added' ? 'bg-green-500' : change.status === 'deleted' ? 'bg-red-500' : 'bg-yellow-500'}`}>
                    {change.status.charAt(0).toUpperCase()}
                </span>
                <span className="truncate">{change.node.name}</span>
            </span>
            <button onClick={() => setStagedFileIds((prev: Set<string>) => {
                const newStaged = new Set(prev);
                isStaged ? newStaged.delete(change.node.id) : newStaged.add(change.node.id);
                return newStaged;
            })} className="p-1 opacity-0 group-hover:opacity-100">
                 {isStaged ? <MinusIcon className="w-4 h-4" /> : <PlusIcon className="w-4 h-4" />}
            </button>
        </div>
    );

    const ResponsiveToolbar = () => (
        <div className="p-1 flex items-center justify-center gap-2" style={{backgroundColor: 'var(--bg-space)'}}>
             <button onClick={() => setPreviewWidth('375px')} className={`px-2 py-1 text-xs rounded ${previewWidth === '375px' ? 'bg-orange-500' : 'bg-gray-600'}`}>Mobile</button>
             <button onClick={() => setPreviewWidth('768px')} className={`px-2 py-1 text-xs rounded ${previewWidth === '768px' ? 'bg-orange-500' : 'bg-gray-600'}`}>Tablet</button>
             <button onClick={() => setPreviewWidth('100%')} className={`px-2 py-1 text-xs rounded ${previewWidth === '100%' ? 'bg-orange-500' : 'bg-gray-600'}`}>Desktop</button>
        </div>
    );
    
    const PreviewPanel = () => {
        const [previewContent, setPreviewContent] = useState('');
        useEffect(() => {
            if (!activeFile || !activeFile.name.endsWith('.html')) { setPreviewContent(''); return; }
            let htmlContent = activeFile.content || '';
            const linkRegex = /<link\s+.*?href="([^"]+)"/g;
            const scriptRegex = /<script\s+.*?src="([^+)".*?><\/script>/g;
            const localNodes = [...nodes];
            htmlContent = htmlContent.replace(linkRegex, (match, cssPath) => {
                const cssFile = localNodes.find(n => n.name === cssPath.replace('./', '') && n.type === 'file');
                return cssFile ? `<style>${cssFile.content}</style>` : match;
            });
            htmlContent = htmlContent.replace(scriptRegex, (match, jsPath) => {
                const jsFile = localNodes.find(n => n.name === jsPath.replace('./', '') && n.type === 'file');
                return jsFile ? `<script>${jsFile.content}</script>` : match;
            });
            setPreviewContent(htmlContent);
        }, [activeFile, nodes]);

        if (!activeFile || !activeFile.name.endsWith('.html')) return <div className="flex items-center justify-center h-full text-gray-500">Open an HTML file to see the preview.</div>;
        return (
            <div className="w-full h-full flex flex-col">
                <ResponsiveToolbar/>
                <div className="flex-1 overflow-auto p-2 bg-gray-300">
                     <iframe srcDoc={previewContent} title="preview" className="bg-white shadow-lg mx-auto" style={{width: previewWidth, height: '100%', transition: 'width 0.3s ease-in-out'}} sandbox="allow-scripts" />
                </div>
            </div>
        );
    };

    const handleRestoreFile = (commitToRestoreFrom: Commit, fileIdToRestore: string) => {
        const fileSnapshot = commitToRestoreFrom.nodesSnapshot.find(n => n.id === fileIdToRestore);
        if (!fileSnapshot || !confirm(`Restore "${fileSnapshot.name}" to the version from this commit? This will overwrite your current version.`)) {
            return;
        }
        setNodes(prevNodes => {
            const nodeExists = prevNodes.some(n => n.id === fileIdToRestore);
            if (nodeExists) {
                return prevNodes.map(n => n.id === fileIdToRestore ? { ...n, content: fileSnapshot.content } : n);
            } else {
                return [...prevNodes, fileSnapshot];
            }
        });
        setDiffModalState(null);
    };
    
    const DiffViewerModal = () => {
        if (!diffModalState) return null;
        return (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                <div className="w-full h-full max-w-6xl max-h-[90vh] flex flex-col rounded-lg shadow-lg" style={{backgroundColor: 'var(--bg-panel)'}}>
                    <div className="flex items-center justify-between p-2 border-b" style={{borderColor: 'var(--border-primary)'}}>
                        <h3 className="font-semibold">Changes for: {diffModalState.fileName}</h3>
                        <div>
                            {diffModalState.commit && (
                                <button onClick={() => handleRestoreFile(diffModalState.commit!, diffModalState.fileId)} className="p-1.5 rounded-md hover:bg-white/10 text-sm flex items-center mr-2" title="Restore this version"><UndoIcon className="w-4 h-4 mr-1"/> Restore</button>
                            )}
                            <button onClick={() => setDiffModalState(null)} className="p-1.5 rounded-full hover:bg-white/10"><CloseIcon className="w-5 h-5"/></button>
                        </div>
                    </div>
                    <div className="flex-1">
                        <MonacoEditor file={{id: '', type:'file', name: diffModalState.fileName, parentId: null, content: diffModalState.modifiedContent}} originalContent={diffModalState.originalContent} readOnly={true} onContentChange={()=>{}} fontSize={fontSize} onCursorPositionChange={()=>{}} onEditorReady={()=>{}} onRefactorRequest={handleRefactorRequest} />
                    </div>
                </div>
            </div>
        );
    }
    
    const RefactorDiffModal = () => {
        if (!refactorSuggestion) return null;
        const handleAccept = () => {
            setNodes(prev => prev.map(n => n.id === refactorSuggestion.fileId ? { ...n, content: refactorSuggestion.newContent } : n));
            setRefactorSuggestion(null);
        };
        const handleReject = () => setRefactorSuggestion(null);

        return (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                <div className="w-full h-full max-w-6xl max-h-[90vh] flex flex-col rounded-lg shadow-lg" style={{backgroundColor: 'var(--bg-panel)'}}>
                    <div className="flex items-center justify-between p-2 border-b" style={{borderColor: 'var(--border-primary)'}}>
                        <h3 className="font-semibold">AI Refactor Suggestion for: {refactorSuggestion.fileName}</h3>
                        <button onClick={handleReject} className="p-1.5 rounded-full hover:bg-white/10"><CloseIcon className="w-5 h-5"/></button>
                    </div>
                    <div className="flex-1">
                        <MonacoEditor file={{id: '', type:'file', name: refactorSuggestion.fileName, parentId: null, content: refactorSuggestion.newContent}} originalContent={refactorSuggestion.originalContent} readOnly={true} onContentChange={()=>{}} fontSize={fontSize} onCursorPositionChange={()=>{}} onEditorReady={()=>{}} onRefactorRequest={handleRefactorRequest}/>
                    </div>
                    <div className="flex justify-end p-2 gap-3" style={{backgroundColor: 'var(--bg-space)'}}>
                        <button onClick={handleReject} className="font-semibold py-2 px-4 rounded-md" style={{border: '1px solid var(--border-primary)'}}>Reject</button>
                        <button onClick={handleAccept} className="font-bold py-2 px-4 rounded-md text-white" style={{backgroundColor: 'var(--accent-orange)'}}>Accept Changes</button>
                    </div>
                </div>
            </div>
        );
    };

    const language = activeFile?.name.split('.').pop()?.toUpperCase() || 'TEXT';
    const words = useMemo(() => activeFile?.content?.match(/\b\w+\b/g)?.length || 0, [activeFile?.content]);
    const chars = useMemo(() => activeFile?.content?.length || 0, [activeFile?.content]);

    return (
        <div className="flex h-full" style={{backgroundColor: 'var(--bg-deep-space)'}}>
            <style>{`.ghost-text { color: #88888880 !important; }`}</style>
            {isPaletteOpen && <CommandPalette />}
            {diffModalState && <DiffViewerModal />}
            {refactorSuggestion && <RefactorDiffModal />}
            <ContextMenu />
            <div className="flex flex-col" style={{backgroundColor: 'var(--bg-space)', width: `${panelWidths.explorer}px`}} onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
                <div className="flex items-center justify-between p-2 border-b" style={{borderColor: 'var(--border-primary)'}}>
                    <h2 className="font-semibold">Explorer</h2>
                    <div>
                        <button onClick={() => handleCreateNode('file')} title="New File" className="p-1.5 hover:bg-white/10 rounded-md"><FileIcon className="w-5 h-5"/></button>
                        <button onClick={() => handleCreateNode('folder')} title="New Folder" className="p-1.5 hover:bg-white/10 rounded-md"><FolderIcon className="w-5 h-5"/></button>
                        <button onClick={handleExportZip} title="Export to ZIP" className="p-1.5 hover:bg-white/10 rounded-md"><DownloadIcon className="w-5 h-5"/></button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-1"><FileExplorer parentId={null} level={0} /></div>
            </div>
            
            <div onMouseDown={() => handleMouseDown('explorer')} className="w-1.5 cursor-col-resize flex-shrink-0 hover:bg-orange-500/50 transition-colors" />

            <div className="flex-1 flex flex-col">
                <div className="flex-shrink-0 flex items-center justify-between text-sm" style={{borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-space)'}}>
                    <div className="flex-1 overflow-x-auto overflow-y-hidden whitespace-nowrap h-10 flex items-center">
                        {openFileIds.map(id => {
                            const file = nodes.find(n => n.id === id);
                            if (!file) return null;
                            const isModified = useMemo(() => {
                                if (commits.length === 0) return false;
                                const lastCommittedFile = commits[0].nodesSnapshot.find(n => n.id === id);
                                if (!lastCommittedFile) return true; // new file
                                return file.content !== lastCommittedFile.content;
                            }, [file.content, commits]);
                            
                            return (
                                <div key={id} onClick={() => setActiveFileId(id)} className={`inline-flex items-center px-3 h-full cursor-pointer border-r ${activeFileId === id ? 'bg-orange-600/20' : ''}`} style={{borderColor: 'var(--border-primary)'}}>
                                    <span className={isModified ? 'italic text-yellow-400' : ''}>{file.name}</span>
                                    <button onClick={(e) => handleFileClose(id, e)} className="ml-2 p-0.5 rounded-full hover:bg-white/20"><CloseIcon className="w-3 h-3"/></button>
                                </div>
                            );
                        })}
                    </div>
                    <div className="p-2 flex items-center gap-2 border-l" style={{borderColor: 'var(--border-primary)'}}>
                        <button onClick={() => setFontSize(s => Math.max(10, s - 1))}><MinusIcon className="w-4 h-4"/></button>
                        <span className="text-xs w-5 text-center">{fontSize}</span>
                        <button onClick={() => setFontSize(s => Math.min(24, s + 1))}><PlusIcon className="w-4 h-4"/></button>
                        <button onClick={() => setShowPreview(p => !p)} title="Toggle Preview" className={`p-1 rounded-md ${showPreview ? 'bg-orange-600/20' : ''}`}><EyeIcon className="w-5 h-5"/></button>
                    </div>
                </div>
                <div className="flex-1 flex" style={{ minHeight: 0 }}>
                    <div className="flex-1 h-full">
                        <MonacoEditor file={activeFile} onContentChange={(c) => setNodes(nodes => nodes.map(n => n.id === activeFileId ? { ...n, content: c } : n))} fontSize={fontSize} onCursorPositionChange={setCursorPosition} onEditorReady={(editor) => (editorInstanceRef.current = editor)} onRefactorRequest={handleRefactorRequest} />
                    </div>
                    {showPreview && <div className="h-full border-l" style={{borderColor: 'var(--border-primary)', width: '50%'}}><PreviewPanel /></div>}
                </div>
                <div className="flex-shrink-0 p-1.5 border-t flex justify-between items-center text-xs" style={{borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-space)'}}>
                    <div className="flex items-center gap-4" style={{color: 'var(--text-secondary)'}}>
                         <div className="flex items-center gap-1">
                            <GitBranchIcon className="w-4 h-4" />
                            <span>main</span>
                        </div>
                        <span>Ln {cursorPosition.lineNumber}, Col {cursorPosition.column}</span>
                    </div>
                    <div className="flex items-center gap-4" style={{color: 'var(--text-secondary)'}}>
                        <span>Chars: {chars}</span>
                        <span>Words: {words}</span>
                        <span>{language}</span>
                    </div>
                </div>
            </div>

            <div onMouseDown={() => handleMouseDown('rightPanel')} className="w-1.5 cursor-col-resize flex-shrink-0 hover:bg-orange-500/50 transition-colors" />

            <div className="flex flex-col" style={{backgroundColor: 'var(--bg-space)', width: `${panelWidths.rightPanel}px`}}>
                <div className="flex-shrink-0 flex border-b" style={{borderColor: 'var(--border-primary)'}}>
                    <button onClick={() => setRightPanelTab('ai')} className={`flex-1 flex items-center justify-center gap-2 p-2 ${rightPanelTab === 'ai' ? 'bg-orange-600/20' : ''}`}><BoltIcon className="w-5 h-5"/> AI</button>
                    <button onClick={() => setRightPanelTab('terminal')} className={`flex-1 flex items-center justify-center gap-2 p-2 ${rightPanelTab === 'terminal' ? 'bg-orange-600/20' : ''}`}><TerminalIcon className="w-5 h-5"/> Terminal</button>
                    <button onClick={() => setRightPanelTab('source')} className={`flex-1 flex items-center justify-center gap-2 p-2 ${rightPanelTab === 'source' ? 'bg-orange-600/20' : ''}`}><GitBranchIcon className="w-5 h-5"/> Source</button>
                </div>
                {rightPanelTab === 'ai' ? (
                     <div className="flex-1 flex flex-col" style={{minHeight: 0}}>
                        <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                            {chatMessages.map((msg, i) => <div key={i} className={`p-2 rounded-md ${msg.role === 'user' ? 'bg-orange-600/10' : ''}`}><strong className="capitalize">{msg.role}:</strong> <pre className="whitespace-pre-wrap font-sans">{msg.text}</pre></div>)}
                            {isLoading && <p className="p-2">Thinking...</p>}
                            <div ref={chatEndRef}></div>
                        </div>
                        <div className="flex-shrink-0 p-2 border-t" style={{borderColor: 'var(--border-primary)'}}>
                            <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAiSend()} placeholder="Ask AI... (Ctrl+K for commands)" className="w-full p-2 bg-transparent focus:outline-none" />
                        </div>
                    </div>
                ) : rightPanelTab === 'terminal' ? (
                    <div className="flex-1 flex flex-col" style={{minHeight: 0}}>
                        <div className="flex-1 p-2 overflow-y-auto font-mono text-xs whitespace-pre-wrap" ref={terminalEndRef}>
                            {terminalOutput.join('\n')}
                        </div>
                        <div className="flex-shrink-0 flex p-1 border-t" style={{borderColor: 'var(--border-primary)'}}>
                            <span className="p-1 font-mono text-xs">&gt;</span>
                            <input value={terminalInput} onChange={e => setTerminalInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleTerminalCommand()} className="flex-1 bg-transparent focus:outline-none font-mono text-xs" />
                        </div>
                    </div>
                ) : (
                    <SourceControlPanel />
                )}
            </div>
        </div>
    );
};

export default CodeCore;