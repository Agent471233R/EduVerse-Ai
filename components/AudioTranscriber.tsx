
import React, { useState, useRef, useEffect } from 'react';
import { ai } from '../services/geminiService';
import { Modality, LiveServerMessage } from '@google/genai';
import { encode, decode, decodeAudioData } from '../utils/audioUtils';

// Simplified Blob type for the gemini SDK
interface CustomBlob {
    data: string;
    mimeType: string;
}

type ConversationTurn = {
    speaker: 'user' | 'model';
    text: string;
    isFinal: boolean;
};

const errorDetails: Record<string, { title: string; message: string }> = {
    mic_permission: {
        title: 'Microphone Access Denied',
        message: 'Could not access your microphone. Please check your browser’s site settings and ensure microphone permissions are granted.',
    },
    session_interrupted: {
        title: 'Connection Interrupted',
        message: 'The live connection to the AI was interrupted, likely due to a network issue. Please try starting a new conversation.',
    },
};


const AudioTranscriber: React.FC = () => {
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [conversation, setConversation] = useState<ConversationTurn[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState('Click "Start Conversation" to begin.');

    const sessionPromiseRef = useRef<any>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    
    const nextStartTimeRef = useRef(0);
    const audioSourcesRef = useRef(new Set<AudioBufferSourceNode>());

    const handleSessionEnded = () => {
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
        }
        if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
        if (mediaStreamSourceRef.current) mediaStreamSourceRef.current.disconnect();
        if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') inputAudioContextRef.current.close();
        if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') outputAudioContextRef.current.close();

        sessionPromiseRef.current = null;
        setIsSessionActive(false);
        setStatusMessage('Conversation ended. Click "Start" to talk again.');
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
                        setStatusMessage('Connected! Start speaking...');
                        inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                        mediaStreamSourceRef.current = inputAudioContextRef.current.createMediaStreamSource(stream);
                        scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
                        
                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const l = inputData.length;
                            const int16 = new Int16Array(l);
                            for (let i = 0; i < l; i++) {
                                int16[i] = inputData[i] * 32768;
                            }
                            const pcmBlob: CustomBlob = {
                                data: encode(new Uint8Array(int16.buffer)),
                                mimeType: 'audio/pcm;rate=16000',
                            };
                            
                            sessionPromiseRef.current.then((session: any) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        };

                        mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        // Handle transcription
                        if (message.serverContent?.inputTranscription || message.serverContent?.outputTranscription) {
                            const isInput = !!message.serverContent.inputTranscription;
                            const transcription = isInput ? message.serverContent.inputTranscription!.text : message.serverContent.outputTranscription!.text;
                            const speaker = isInput ? 'user' : 'model';

                            setConversation(prev => {
                                const newConversation = [...prev];
                                const lastTurn = newConversation[newConversation.length - 1];
                                if (lastTurn && lastTurn.speaker === speaker && !lastTurn.isFinal) {
                                    lastTurn.text += transcription;
                                } else {
                                    newConversation.push({ speaker, text: transcription, isFinal: false });
                                }
                                return newConversation;
                            });
                        }
                         // Handle audio playback
                        const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                        if (base64Audio && outputAudioContextRef.current) {
                            const audioContext = outputAudioContextRef.current;
                            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContext.currentTime);
                            const audioBuffer = await decodeAudioData(decode(base64Audio), audioContext, 24000, 1);
                            const source = audioContext.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(audioContext.destination);
                            source.addEventListener('ended', () => audioSourcesRef.current.delete(source));
                            source.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += audioBuffer.duration;
                            audioSourcesRef.current.add(source);
                        }

                        // Handle interruptions
                        if (message.serverContent?.interrupted) {
                            audioSourcesRef.current.forEach(source => source.stop());
                            audioSourcesRef.current.clear();
                            nextStartTimeRef.current = 0;
                        }

                        // Finalize turns
                        if (message.serverContent?.turnComplete) {
                            setConversation(prev => prev.map(turn => ({ ...turn, isFinal: true })));
                        }
                    },
                    onerror: (e: any) => {
                        console.error('Session error:', e);
                        setError('session_interrupted');
                        handleSessionEnded();
                    },
                    onclose: () => {
                        console.log('Session closed.');
                        handleSessionEnded();
                    },
                },
                config: {
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { 
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } 
                    },
                }
            });
        } catch (err) {
            console.error("Error starting session:", err);
            setError("mic_permission");
            setIsSessionActive(false);
            setStatusMessage('Error: Could not start session.');
        }
    };

    const stopSession = () => {
        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then((session: any) => session.close());
        }
        handleSessionEnded();
    };

    useEffect(() => {
        // Cleanup on unmount
        return () => {
            if (isSessionActive) {
                stopSession();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="space-y-8">
            <div className="bg-gray-800 p-6 rounded-xl shadow-lg text-center">
                <h2 className="text-xl font-semibold text-teal-300 mb-2">Live AI Conversation</h2>
                <p className="text-gray-400 mb-6">{statusMessage}</p>

                <button
                    onClick={isSessionActive ? stopSession : startSession}
                    className={`text-white font-bold py-3 px-8 rounded-full transition-all duration-300 flex items-center justify-center mx-auto ${
                        isSessionActive ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-500 hover:bg-teal-600'
                    }`}
                >
                    {isSessionActive ? (
                        <>
                            <span className="relative flex h-3 w-3 mr-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
                            </span>
                            End Conversation
                        </>
                    ) : 'Start Conversation'}
                </button>
            </div>

            {error && (
                <div className="bg-red-900/30 text-red-300 p-4 rounded-lg text-center">
                    <p className="font-semibold text-red-200">{errorDetails[error]?.title || 'An Error Occurred'}</p>
                    <p className="text-sm mt-1">{errorDetails[error]?.message || 'An unknown error occurred.'}</p>
                </div>
            )}

            <div className="bg-gray-800 p-4 md:p-6 rounded-xl shadow-lg">
                <h3 className="text-lg font-semibold text-teal-300 mb-4">Conversation Transcript</h3>
                <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
                    {conversation.length === 0 && !isSessionActive && (
                        <p className="text-gray-500 text-center py-8">Conversation will appear here...</p>
                    )}
                    {conversation.map((turn, index) => (
                        <div key={index} className={`flex ${turn.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-md p-3 rounded-lg ${
                                turn.speaker === 'user' 
                                ? 'bg-teal-800/80 text-white' 
                                : 'bg-gray-700 text-gray-200'
                            }`}>
                                <p className="font-bold capitalize text-sm mb-1">{turn.speaker}</p>
                                <p className="whitespace-pre-wrap">{turn.text}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default AudioTranscriber;
