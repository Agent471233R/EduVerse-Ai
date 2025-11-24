
import React, { useState, useRef, useEffect } from 'react';
import { ai } from '../services/geminiService';
import { Modality, LiveServerMessage } from '@google/genai';
import { encode, decode, decodeAudioData } from '../utils/audioUtils';
import { LiveIcon, ClockIcon, TrashIcon } from './icons/FeatureIcons';

interface CustomBlob {
    data: string;
    mimeType: string;
}

type ConversationTurn = {
    speaker: 'user' | 'model';
    text: string;
    isFinal: boolean;
};

interface AudioHistoryItem {
    id: string;
    timestamp: number;
    conversation: ConversationTurn[];
}

const errorDetails: Record<string, { title: string; message: string }> = {
    mic_permission: { title: 'Microphone Blocked', message: 'Please allow microphone access in your browser settings.' },
    session_interrupted: { title: 'Connection Lost', message: 'The session disconnected unexpectedly.' },
};

const AudioTranscriber: React.FC = () => {
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [conversation, setConversation] = useState<ConversationTurn[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState('Ready to connect');
    
    // History
    const [history, setHistory] = useState<AudioHistoryItem[]>([]);
    const [showHistory, setShowHistory] = useState(false);

    const sessionPromiseRef = useRef<any>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const nextStartTimeRef = useRef(0);
    const audioSourcesRef = useRef(new Set<AudioBufferSourceNode>());
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const stored = localStorage.getItem('eduverse_audio_history');
        if (stored) {
            try { setHistory(JSON.parse(stored)); } catch (e) { console.error(e); }
        }
    }, []);

    const saveToHistory = (conv: ConversationTurn[]) => {
        if (conv.length === 0) return;
        const newItem: AudioHistoryItem = {
            id: Date.now().toString(),
            timestamp: Date.now(),
            conversation: conv
        };
        const updated = [newItem, ...history].slice(0, 10);
        setHistory(updated);
        localStorage.setItem('eduverse_audio_history', JSON.stringify(updated));
    };

    const clearHistory = () => {
        setHistory([]);
        localStorage.removeItem('eduverse_audio_history');
    };

    const restoreFromHistory = (item: AudioHistoryItem) => {
        if (isSessionActive) stopSession();
        setConversation(item.conversation);
        setShowHistory(false);
    };

    const handleSessionEnded = () => {
        if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(track => track.stop());
        if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
        if (mediaStreamSourceRef.current) mediaStreamSourceRef.current.disconnect();
        if (inputAudioContextRef.current?.state !== 'closed') inputAudioContextRef.current?.close();
        if (outputAudioContextRef.current?.state !== 'closed') outputAudioContextRef.current?.close();

        // Save conversation on end
        if (sessionPromiseRef.current && conversation.length > 0) {
            saveToHistory(conversation);
        }

        sessionPromiseRef.current = null;
        setIsSessionActive(false);
        setStatusMessage('Session ended');
    };

    const startSession = async () => {
        setError(null);
        setConversation([]);
        setIsSessionActive(true);
        setStatusMessage('Connecting...');

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            nextStartTimeRef.current = 0;
            audioSourcesRef.current.clear();

            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => {
                        setStatusMessage('Listening...');
                        inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                        mediaStreamSourceRef.current = inputAudioContextRef.current.createMediaStreamSource(stream);
                        scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
                        scriptProcessorRef.current.onaudioprocess = (e) => {
                            const inputData = e.inputBuffer.getChannelData(0);
                            const l = inputData.length;
                            const int16 = new Int16Array(l);
                            for (let i = 0; i < l; i++) int16[i] = inputData[i] * 32768;
                            const pcmBlob: CustomBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
                            sessionPromiseRef.current.then((session: any) => session.sendRealtimeInput({ media: pcmBlob }));
                        };
                        mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                         if (message.serverContent?.inputTranscription || message.serverContent?.outputTranscription) {
                            const isInput = !!message.serverContent.inputTranscription;
                            const transcription = isInput ? message.serverContent.inputTranscription!.text : message.serverContent.outputTranscription!.text;
                            const speaker = isInput ? 'user' : 'model';
                            setConversation(prev => {
                                const newConv = [...prev];
                                const lastTurn = newConv[newConv.length - 1];
                                if (lastTurn && lastTurn.speaker === speaker && !lastTurn.isFinal) lastTurn.text += transcription;
                                else newConv.push({ speaker, text: transcription, isFinal: false });
                                return newConv;
                            });
                        }
                        const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                        if (base64Audio && outputAudioContextRef.current) {
                            const ctx = outputAudioContextRef.current;
                            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                            const buffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
                            const source = ctx.createBufferSource();
                            source.buffer = buffer;
                            source.connect(ctx.destination);
                            source.addEventListener('ended', () => audioSourcesRef.current.delete(source));
                            source.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += buffer.duration;
                            audioSourcesRef.current.add(source);
                        }
                        if (message.serverContent?.interrupted) {
                            audioSourcesRef.current.forEach(s => s.stop());
                            audioSourcesRef.current.clear();
                            nextStartTimeRef.current = 0;
                        }
                        if (message.serverContent?.turnComplete) {
                            setConversation(prev => prev.map(turn => ({ ...turn, isFinal: true })));
                        }
                    },
                    onerror: (e: any) => { console.error('Session error:', e); setError('session_interrupted'); handleSessionEnded(); },
                    onclose: () => handleSessionEnded(),
                },
                config: {
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
                }
            });
        } catch (err) { console.error(err); setError("mic_permission"); setIsSessionActive(false); setStatusMessage('Error connecting'); }
    };

    const stopSession = () => {
        if (sessionPromiseRef.current) sessionPromiseRef.current.then((session: any) => session.close());
        // Handle session ended is called by onclose, but calling it here ensures state update if onclose doesn't fire immediately
        // We rely on onclose mostly, but safe to ensure state reset
    };

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }, [conversation]);

    useEffect(() => { return () => { if (isSessionActive) stopSession(); }; }, []);

    return (
        <div className="max-w-3xl mx-auto h-[calc(100vh-140px)] flex flex-col relative">
            
            {/* History Panel (Absolute overlay) */}
            {showHistory && (
                <div className="absolute top-16 right-0 left-0 z-30 mx-4 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-[60vh] overflow-hidden animate-fade-in">
                     <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-950">
                         <span className="text-xs font-bold text-slate-400 uppercase">Past Conversations</span>
                         <button onClick={clearHistory} className="text-slate-600 hover:text-red-400 transition-colors"><TrashIcon /></button>
                    </div>
                    <div className="overflow-y-auto max-h-[calc(60vh-50px)]">
                        {history.length === 0 ? <div className="p-4 text-center text-xs text-slate-600">No history.</div> : history.map(item => (
                             <button key={item.id} onClick={() => restoreFromHistory(item)} className="w-full text-left p-3 hover:bg-slate-800 border-b border-slate-800 last:border-0 transition-colors">
                                 <p className="text-sm text-slate-300 font-medium truncate">Session from {new Date(item.timestamp).toLocaleTimeString()}</p>
                                 <p className="text-xs text-slate-500 mt-0.5">{new Date(item.timestamp).toLocaleDateString()} • {item.conversation.length} turns</p>
                             </button>
                         ))}
                    </div>
                    <div className="p-2 bg-slate-950 text-center border-t border-slate-800">
                        <button onClick={() => setShowHistory(false)} className="text-xs text-slate-400 hover:text-white">Close History</button>
                    </div>
                </div>
            )}

            {/* Control Header */}
            <div className="bg-slate-900/80 backdrop-blur border border-slate-800 p-4 rounded-t-2xl flex items-center justify-between shadow-lg z-20">
                <div className="flex items-center">
                    <div className={`w-3 h-3 rounded-full mr-3 ${isSessionActive ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`}></div>
                    <div>
                        <h2 className="text-sm font-bold text-white">Live Tutor</h2>
                        <p className="text-xs text-slate-400">{statusMessage}</p>
                    </div>
                </div>
                <div className="flex items-center space-x-3">
                    <button onClick={() => setShowHistory(!showHistory)} className={`p-2 rounded-lg transition-colors ${showHistory ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}>
                        <ClockIcon />
                    </button>
                    <button onClick={isSessionActive ? stopSession : startSession} className={`px-6 py-2 rounded-full text-sm font-bold transition-all shadow-lg ${isSessionActive ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-indigo-600 text-white hover:bg-indigo-500'}`}>
                        {isSessionActive ? 'End Session' : 'Start Conversation'}
                    </button>
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 bg-slate-950/50 border-x border-slate-800 relative overflow-hidden">
                <div className="absolute inset-0 overflow-y-auto p-6 space-y-6">
                    {conversation.length === 0 && !isSessionActive && !error && (
                        <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-60">
                            <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4">
                                <LiveIcon />
                            </div>
                            <p className="text-sm">Start a conversation to begin learning</p>
                        </div>
                    )}
                    
                    {error && (
                        <div className="bg-red-900/20 border border-red-800 p-4 rounded-xl text-center mx-auto max-w-md">
                            <p className="text-red-300 font-bold">{errorDetails[error]?.title}</p>
                            <p className="text-red-400/70 text-xs mt-1">{errorDetails[error]?.message}</p>
                        </div>
                    )}

                    {conversation.map((turn, index) => (
                        <div key={index} className={`flex ${turn.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed shadow-md ${
                                turn.speaker === 'user' 
                                ? 'bg-indigo-600 text-white rounded-br-sm' 
                                : 'bg-slate-800 text-slate-200 rounded-bl-sm border border-slate-700'
                            }`}>
                                <p className="text-[10px] uppercase font-bold opacity-50 mb-1">{turn.speaker === 'user' ? 'You' : 'AI Tutor'}</p>
                                {turn.text}
                            </div>
                        </div>
                    ))}
                    <div ref={scrollRef} />
                </div>
            </div>

            {/* Footer Visualizer (Decorative) */}
            <div className="bg-slate-900/80 backdrop-blur border border-slate-800 p-4 rounded-b-2xl h-16 flex items-center justify-center">
                {isSessionActive ? (
                    <div className="flex space-x-1 items-center h-full">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="w-1 bg-indigo-500 rounded-full animate-[pulse_1s_ease-in-out_infinite]" style={{ height: `${Math.random() * 100}%`, animationDelay: `${i * 0.1}s` }}></div>
                        ))}
                    </div>
                ) : (
                    <div className="w-full h-0.5 bg-slate-800 rounded-full"></div>
                )}
            </div>
        </div>
    );
};

export default AudioTranscriber;
