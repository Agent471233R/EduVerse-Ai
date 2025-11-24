
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ai, analyzeVideoFrames, getTextToSpeech } from '../services/geminiService';
import { VideoAnalysisResult, AppStatus } from '../types';
import Loader from './Loader';
import { VolumeUpIcon, CheckCircleIcon, XCircleIcon, PlayIcon, FilmIcon, ClockIcon, TrashIcon } from './icons/FeatureIcons';
import { FunctionDeclaration, Type, Modality, LiveServerMessage } from '@google/genai';
import { encode, decode, decodeAudioData } from '../utils/audioUtils';

interface CustomBlob {
    data: string;
    mimeType: string;
}

type ConversationTurn = {
    speaker: 'user' | 'model';
    text: string;
};

interface VideoHistoryItem {
    id: string;
    timestamp: number;
    sourceName: string;
    result: VideoAnalysisResult;
}

const errorDetails: Record<string, { title: string; message: React.ReactNode }> = {
    timeout: {
        title: 'Video Loading Timeout',
        message: 'The video took too long to load. Please check the video URL or try a smaller file.',
    },
    cors: {
        title: 'Access Restricted',
        message: 'Browser security blocks this video URL. Please download the video and use "Upload File".',
    },
    extract_frames: {
        title: 'Processing Failed',
        message: "We couldn't extract frames from this video. The file might be corrupted.",
    },
    invalid_duration: {
        title: 'Invalid Metadata',
        message: "The video file seems to be missing duration metadata.",
    },
    invalid_url_format: {
        title: 'Unsupported URL',
        message: 'Please provide a direct link ending in .mp4, .webm, or .ogv.',
    },
    generic_analysis: {
        title: 'Analysis Error',
        message: 'The AI encountered an issue. Please try again.',
    },
    mic_permission: {
        title: 'Microphone Error',
        message: 'Access denied. Please enable microphone permissions.',
    },
    session_interrupted: {
        title: 'Connection Lost',
        message: 'The live connection was interrupted.',
    },
};

const learningReportFunctionDeclaration: FunctionDeclaration = {
    name: 'generateLearningReport',
    parameters: {
        type: Type.OBJECT,
        description: 'Generates a report on the user\'s understanding and a learning plan.',
        properties: {
            strengths: { type: Type.STRING, description: 'A paragraph summarizing the user\'s areas of strong understanding.' },
            weaknesses: { type: Type.STRING, description: 'A paragraph summarizing the user\'s areas for improvement.' },
            plan: { type: Type.STRING, description: 'A multi-step, personalized learning plan with suggested topics or resources, formatted as a bulleted or numbered list.' },
        },
        required: ['strengths', 'weaknesses', 'plan'],
    },
};

const VideoProcessor: React.FC = () => {
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [videoUrl, setVideoUrl] = useState<string>('');
    const [status, setStatus] = useState<AppStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const [progressMessage, setProgressMessage] = useState('');
    const [progress, setProgress] = useState<number | undefined>(undefined);
    const [analysisResult, setAnalysisResult] = useState<VideoAnalysisResult | null>(null);
    const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
    const [quizScore, setQuizScore] = useState<number | null>(null);
    const [inputMethod, setInputMethod] = useState<'upload' | 'url'>('upload');
    const [videoUrlInput, setVideoUrlInput] = useState<string>('');
    const [summaryView, setSummaryView] = useState<'brief' | 'detailed' | 'keyPoints'>('brief');
    
    // History State
    const [history, setHistory] = useState<VideoHistoryItem[]>([]);
    const [showHistory, setShowHistory] = useState(false);

    // Deep Dive State
    const [deepDiveStatus, setDeepDiveStatus] = useState<'idle' | 'active' | 'generating_report' | 'complete'>('idle');
    const [deepDiveConversation, setDeepDiveConversation] = useState<ConversationTurn[]>([]);
    const [learningReport, setLearningReport] = useState<{ strengths: string; weaknesses: string; plan: string; } | null>(null);
    const [deepDiveError, setDeepDiveError] = useState<string | null>(null);

    const videoRef = useRef<HTMLVideoElement>(null);
    const quizFormRef = useRef<HTMLFormElement>(null);
    const conversationEndRef = useRef<HTMLDivElement>(null);
    const numFrames = 10;

    // Refs for Live Session
    const sessionPromiseRef = useRef<any>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const nextStartTimeRef = useRef(0);
    const audioSourcesRef = useRef(new Set<AudioBufferSourceNode>());

    useEffect(() => {
        const storedHistory = localStorage.getItem('eduverse_video_history');
        if (storedHistory) {
            try {
                setHistory(JSON.parse(storedHistory));
            } catch (e) {
                console.error("Failed to parse history", e);
            }
        }
    }, []);

    const saveToHistory = (result: VideoAnalysisResult, name: string) => {
        const newItem: VideoHistoryItem = {
            id: Date.now().toString(),
            timestamp: Date.now(),
            sourceName: name,
            result
        };
        const updatedHistory = [newItem, ...history].slice(0, 10); // Keep last 10
        setHistory(updatedHistory);
        localStorage.setItem('eduverse_video_history', JSON.stringify(updatedHistory));
    };

    const clearHistory = () => {
        setHistory([]);
        localStorage.removeItem('eduverse_video_history');
    };

    const restoreFromHistory = (item: VideoHistoryItem) => {
        resetAnalysisState();
        setAnalysisResult(item.result);
        setStatus('success');
        setVideoUrl(''); // Clear video URL as we might not have the file anymore
        setVideoFile(null);
        setShowHistory(false);
    };

    const resetAnalysisState = () => {
        setAnalysisResult(null);
        setQuizScore(null);
        setUserAnswers({});
        setDeepDiveStatus('idle');
        setLearningReport(null);
        setDeepDiveConversation([]);
        setSummaryView('brief');
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setVideoFile(file);
            setVideoUrl(URL.createObjectURL(file));
            setVideoUrlInput('');
            resetAnalysisState();
            setError(null);
        }
    };
    
    const handleUrlInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const url = e.target.value;
        setVideoUrlInput(url);
        resetAnalysisState();
        setError(null);
        setVideoUrl('');
        setVideoFile(null);

        if (!url) return;

        if (/youtube\.com|youtu\.be|vimeo\.com/.test(url)) {
            setError('platform_link');
        } else if (!/\.(mp4|webm|ogv)$/i.test(url)) {
            setError('invalid_url_format');
        } else {
            setVideoUrl(url);
        }
    };

    const extractFrames = useCallback(async (
        videoElement: HTMLVideoElement,
        totalFrames: number,
        onProgress: (percent: number) => void
    ): Promise<string[]> => {
        return new Promise((resolve, reject) => {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) return reject(new Error("Could not create canvas context."));
            
            const frames: string[] = [];
            const timeout = 30000;
            
            const timeoutId = window.setTimeout(() => {
                videoElement.removeEventListener('loadedmetadata', onReady);
                videoElement.removeEventListener('error', onError);
                reject(new Error("Video loading timed out."));
            }, timeout);
    
            const cleanup = () => {
                clearTimeout(timeoutId);
                videoElement.removeEventListener('loadedmetadata', onReady);
                videoElement.removeEventListener('error', onError);
            };
    
            const onReady = () => {
                cleanup();
                const duration = videoElement.duration;
                if (!duration || duration === Infinity) {
                    reject(new Error("Video has an invalid duration."));
                    return;
                }
                
                videoElement.currentTime = 0;
                let framesExtracted = 0;
                const interval = duration / totalFrames;
    
                const captureFrame = () => {
                    if (framesExtracted >= totalFrames) {
                        videoElement.onseeked = null;
                        resolve(frames);
                        return;
                    }
                    videoElement.currentTime = framesExtracted * interval;
                };
    
                videoElement.onseeked = () => {
                    canvas.width = videoElement.videoWidth;
                    canvas.height = videoElement.videoHeight;
                    context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                    const frameData = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
                    frames.push(frameData);
                    framesExtracted++;
                    onProgress((framesExtracted / totalFrames) * 100);
                    captureFrame();
                };
                
                captureFrame();
            };
    
            const onError = () => {
                cleanup();
                reject(new Error("Failed to load video due to CORS or a network issue."));
            };
    
            videoElement.addEventListener('loadedmetadata', onReady);
            videoElement.addEventListener('error', onError);
    
            if (videoElement.readyState >= 1) onReady();
            else videoElement.load();
        });
    }, []);

    const handleSubmit = async () => {
        if (!videoUrl || !videoRef.current || error) return;
        
        setStatus('processing');
        setError(null);
        resetAnalysisState();
        setProgress(0);

        try {
            setProgressMessage('Loading video...');
            const frames = await extractFrames(videoRef.current, numFrames, (p) => {
                setProgress(p);
                const currentFrame = Math.ceil((p / 100) * numFrames);
                setProgressMessage(`Extracting keyframes... ${currentFrame}/${numFrames}`);
            });

            if (frames.length === 0) throw new Error("Could not extract frames.");

            setProgressMessage('Analyzing visual content...');
            setProgress(undefined);

            const prompt = `Analyze these video frames to provide a comprehensive summary and generate a quiz. 
            The summary should have a brief version, a detailed version, and key bullet points. 
            The quiz should contain a mix of 5 questions: 2 multiple-choice, 1 true/false, 1 short-answer, and 1 fill-in-the-blank.
            Provide correct answers and explanations.`;
            
            const result = await analyzeVideoFrames(frames, prompt);
            setAnalysisResult(result);
            saveToHistory(result, videoFile ? videoFile.name : 'URL Video Source');
            setStatus('success');
        } catch (err) {
            console.error(err);
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
            if (errorMessage.includes('timed out')) setError('timeout');
            else if (errorMessage.includes('CORS')) setError('cors');
            else if (errorMessage.includes('extract frames')) setError('extract_frames');
            else if (errorMessage.includes('invalid duration')) setError('invalid_duration');
            else setError('generic_analysis');
            setStatus('error');
        } finally {
            setProgressMessage('');
            setProgress(undefined);
        }
    };

    const handleQuizSubmit = () => {
        if (!analysisResult) return;
        let score = 0;
        analysisResult.quiz.forEach((q, index) => {
            const userAnswer = (userAnswers[index] || '').trim().toLowerCase();
            const correctAnswer = q.answer.trim().toLowerCase();
            if (userAnswer === correctAnswer) score++;
        });
        setQuizScore(score);
    };

    const handleRetakeQuiz = () => {
        setQuizScore(null);
        setUserAnswers({});
        quizFormRef.current?.reset();
    };

    const playAudio = async (text: string) => {
        try {
            const base64Audio = await getTextToSpeech(text);
            if(base64Audio) {
                const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                const decodedData = decode(base64Audio);
                const buffer = await decodeAudioData(decodedData, audioContext, 24000, 1);
                const source = audioContext.createBufferSource();
                source.buffer = buffer;
                source.connect(audioContext.destination);
                source.start(0);
            }
        } catch (err) { console.error("Audio error:", err); }
    };

    const handleDeepDiveSessionEnded = useCallback(() => {
        if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(track => track.stop());
        if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
        if (mediaStreamSourceRef.current) mediaStreamSourceRef.current.disconnect();
        if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') inputAudioContextRef.current.close();
        if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') outputAudioContextRef.current.close();

        sessionPromiseRef.current = null;
        if (deepDiveStatus !== 'complete') setDeepDiveStatus('idle');
    }, [deepDiveStatus]);

    const stopDeepDive = useCallback(() => {
        if (sessionPromiseRef.current) sessionPromiseRef.current.then((session: any) => session.close());
        handleDeepDiveSessionEnded();
    }, [handleDeepDiveSessionEnded]);

    const startDeepDive = async () => {
        if (!analysisResult) return;
        setDeepDiveError(null);
        setDeepDiveConversation([]);
        setLearningReport(null);
        setDeepDiveStatus('active');

        const systemInstruction = `You are an expert tutor. Context: "${analysisResult.summary.detailed}". Assess understanding via 3-4 conceptual questions. Call "generateLearningReport" at the end.`;
        
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
                        inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                        mediaStreamSourceRef.current = inputAudioContextRef.current.createMediaStreamSource(stream);
                        scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const l = inputData.length;
                            const int16 = new Int16Array(l);
                            for (let i = 0; i < l; i++) int16[i] = inputData[i] * 32768;
                            const pcmBlob: CustomBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
                            sessionPromiseRef.current?.then((session: any) => session.sendRealtimeInput({ media: pcmBlob }));
                        };
                        mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                            const text = message.serverContent.inputTranscription.text;
                            setDeepDiveConversation(prev => {
                                const last = prev[prev.length - 1];
                                if (last?.speaker === 'user') return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                                return [...prev, { speaker: 'user', text }];
                            });
                        }
                        if (message.serverContent?.outputTranscription) {
                            const text = message.serverContent.outputTranscription.text;
                            setDeepDiveConversation(prev => {
                                const last = prev[prev.length - 1];
                                if (last?.speaker === 'model') return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                                return [...prev, { speaker: 'model', text }];
                            });
                        }
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
                        if (message.toolCall?.functionCalls) {
                            const fc = message.toolCall.functionCalls[0];
                            if (fc.name === 'generateLearningReport' && fc.args) {
                                setLearningReport(fc.args as any);
                                setDeepDiveStatus('complete');
                                stopDeepDive();
                            }
                        }
                    },
                    onerror: (e: any) => { console.error('Session error:', e); setDeepDiveError('session_interrupted'); stopDeepDive(); },
                    onclose: () => { handleDeepDiveSessionEnded(); },
                },
                config: {
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    responseModalities: [Modality.AUDIO],
                    tools: [{ functionDeclarations: [learningReportFunctionDeclaration] }],
                    systemInstruction,
                }
            });
        } catch (err) { console.error(err); setDeepDiveError("mic_permission"); setDeepDiveStatus('idle'); }
    };
    
    useEffect(() => {
        if (conversationEndRef.current) {
            conversationEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [deepDiveConversation]);

    useEffect(() => { return () => { if (sessionPromiseRef.current) stopDeepDive(); }; }, [stopDeepDive]);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* LEFT COLUMN - INPUT */}
            <div className="lg:col-span-5 space-y-6">
                 <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 p-6 rounded-2xl shadow-xl">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-lg font-semibold text-white flex items-center">
                             <span className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center mr-3 text-sm font-bold">1</span>
                             Source Video
                        </h2>
                        <button onClick={() => setShowHistory(!showHistory)} className={`p-2 rounded-lg transition-colors ${showHistory ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}>
                             <ClockIcon />
                        </button>
                    </div>

                    {showHistory && (
                         <div className="mb-6 bg-slate-950 rounded-xl border border-slate-800 overflow-hidden animate-fade-in">
                             <div className="p-3 border-b border-slate-800 flex justify-between items-center">
                                 <span className="text-xs font-bold text-slate-400 uppercase">Recent History</span>
                                 <button onClick={clearHistory} className="text-slate-600 hover:text-red-400 transition-colors">
                                     <TrashIcon />
                                 </button>
                             </div>
                             <div className="max-h-48 overflow-y-auto">
                                 {history.length === 0 ? (
                                     <div className="p-4 text-center text-xs text-slate-600">No history found.</div>
                                 ) : (
                                     history.map((item) => (
                                         <button key={item.id} onClick={() => restoreFromHistory(item)} className="w-full text-left p-3 hover:bg-slate-900 border-b border-slate-800 last:border-0 transition-colors">
                                             <p className="text-sm text-slate-300 font-medium truncate">{item.sourceName}</p>
                                             <p className="text-xs text-slate-500 mt-0.5">{new Date(item.timestamp).toLocaleDateString()} • {new Date(item.timestamp).toLocaleTimeString()}</p>
                                         </button>
                                     ))
                                 )}
                             </div>
                         </div>
                    )}
                    
                    <div className="flex p-1 bg-slate-800 rounded-lg mb-6">
                        <button onClick={() => setInputMethod('upload')} className={`flex-1 py-2 text-xs font-bold uppercase tracking-wide rounded-md transition-all ${inputMethod === 'upload' ? 'bg-slate-700 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}>
                            Upload File
                        </button>
                        <button onClick={() => setInputMethod('url')} className={`flex-1 py-2 text-xs font-bold uppercase tracking-wide rounded-md transition-all ${inputMethod === 'url' ? 'bg-slate-700 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}>
                            Video URL
                        </button>
                    </div>

                    <div className="min-h-[200px] flex flex-col justify-center">
                        {inputMethod === 'upload' ? (
                             <div className="relative group cursor-pointer">
                                 <input type="file" accept="video/*" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" disabled={status === 'processing'} />
                                 <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${videoFile ? 'border-indigo-500 bg-indigo-500/5' : 'border-slate-700 hover:border-slate-600 bg-slate-800/30'}`}>
                                     <div className="mx-auto w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                                         <PlayIcon />
                                     </div>
                                     <p className="text-sm font-medium text-slate-300">{videoFile ? videoFile.name : "Drop video here or click to upload"}</p>
                                     <p className="text-xs text-slate-500 mt-1">MP4, WebM, OGV up to 100MB</p>
                                 </div>
                             </div>
                        ) : (
                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-1 ml-1">Direct Video Link</label>
                                <input type="text" placeholder="https://example.com/video.mp4" value={videoUrlInput} onChange={handleUrlInputChange} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none" disabled={status === 'processing'}/>
                                <p className="text-[10px] text-slate-500 mt-2 pl-1">Note: YouTube links are not supported due to browser security policies.</p>
                            </div>
                        )}
                    </div>

                    {videoUrl && !error && (
                        <div className="mt-6 rounded-xl overflow-hidden border border-slate-700 shadow-lg">
                            <video key={videoUrl} ref={videoRef} src={videoUrl} controls className="w-full bg-black" crossOrigin="anonymous" muted preload="metadata"></video>
                        </div>
                    )}
                    
                    <button onClick={handleSubmit} disabled={!videoUrl || status === 'processing' || !!error} className="w-full mt-6 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold py-3 px-6 rounded-xl hover:shadow-lg hover:shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center">
                        {status === 'processing' ? 'Processing...' : 'Analyze Video Content'}
                    </button>

                     {error && (
                        <div className={`mt-4 p-4 rounded-xl border text-sm ${error === 'platform_link' ? 'bg-amber-900/20 border-amber-800 text-amber-200' : 'bg-red-900/20 border-red-800 text-red-200'}`}>
                            <p className="font-bold">{errorDetails[error]?.title}</p>
                            <p className="mt-1 opacity-80">{errorDetails[error]?.message}</p>
                        </div>
                    )}
                 </div>

                 {status === 'processing' && <Loader message={progressMessage} progress={progress} />}
            </div>

            {/* RIGHT COLUMN - RESULTS */}
            <div className="lg:col-span-7 space-y-6">
                {status === 'success' && analysisResult ? (
                    <>
                        {/* Summary Section */}
                        <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 p-6 rounded-2xl shadow-xl animate-fade-in">
                             <div className="flex justify-between items-center mb-6">
                                <h2 className="text-lg font-semibold text-white">Video Analysis</h2>
                                <div className="flex space-x-1 bg-slate-800 p-1 rounded-lg">
                                    {['brief', 'detailed', 'keyPoints'].map((v) => (
                                        <button key={v} onClick={() => setSummaryView(v as any)} className={`px-3 py-1.5 text-[10px] uppercase font-bold tracking-wide rounded-md transition-colors ${summaryView === v ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                                            {v.replace(/([A-Z])/g, ' $1').trim()}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed">
                                {summaryView === 'brief' && <p>{analysisResult.summary.brief}</p>}
                                {summaryView === 'detailed' && <p className="whitespace-pre-line">{analysisResult.summary.detailed}</p>}
                                {summaryView === 'keyPoints' && (
                                    <ul className="space-y-2 list-none pl-0">
                                        {analysisResult.summary.keyPoints.map((point, i) => (
                                            <li key={i} className="flex items-start">
                                                <span className="text-indigo-400 mr-2">•</span> {point}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>

                        {/* Quiz Section */}
                        <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 p-6 rounded-2xl shadow-xl animate-fade-in">
                            <div className="flex justify-between items-end mb-6">
                                <div>
                                    <h2 className="text-lg font-semibold text-white">Knowledge Check</h2>
                                    <p className="text-xs text-slate-500 mt-1">Test your understanding of the content</p>
                                </div>
                                {quizScore !== null && (
                                    <div className="text-right">
                                        <span className="text-3xl font-bold text-white">{quizScore}</span>
                                        <span className="text-slate-500 text-sm">/{analysisResult.quiz.length}</span>
                                    </div>
                                )}
                            </div>

                            {quizScore === null ? (
                                <form ref={quizFormRef} onSubmit={(e) => { e.preventDefault(); handleQuizSubmit(); }} className="space-y-4">
                                    {analysisResult.quiz.map((q, index) => (
                                        <div key={index} className="p-4 bg-slate-950 border border-slate-800 rounded-xl transition-all hover:border-slate-700">
                                            <div className="flex justify-between items-start mb-3">
                                                <p className="font-medium text-slate-200 text-sm"><span className="text-indigo-400 mr-1">{index + 1}.</span> {q.question}</p>
                                                <button type="button" onClick={() => playAudio(q.question)} className="text-slate-600 hover:text-indigo-400 transition-colors">
                                                    <VolumeUpIcon />
                                                </button>
                                            </div>
                                            
                                            {q.type === 'multiple-choice' && q.options && (
                                                <div className="space-y-2 mt-2">
                                                    {q.options.map((opt, i) => (
                                                        <label key={i} className="flex items-center p-2 rounded-lg hover:bg-slate-900 cursor-pointer group">
                                                            <input type="radio" name={`q-${index}`} value={opt} onChange={(e) => setUserAnswers(prev => ({ ...prev, [index]: e.target.value }))} className="hidden peer" />
                                                            <div className="w-4 h-4 rounded-full border border-slate-600 mr-3 peer-checked:border-indigo-500 peer-checked:border-4 transition-all"></div>
                                                            <span className="text-sm text-slate-400 peer-checked:text-white transition-colors">{opt}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            )}
                                             {q.type === 'true-false' && (
                                                <div className="flex space-x-4 mt-2">
                                                    {['True', 'False'].map((opt) => (
                                                        <label key={opt} className="flex items-center p-2 rounded-lg hover:bg-slate-900 cursor-pointer">
                                                             <input type="radio" name={`q-${index}`} value={opt} onChange={(e) => setUserAnswers(prev => ({ ...prev, [index]: e.target.value }))} className="hidden peer" />
                                                            <div className="w-4 h-4 rounded-full border border-slate-600 mr-3 peer-checked:border-indigo-500 peer-checked:border-4 transition-all"></div>
                                                            <span className="text-sm text-slate-400 peer-checked:text-white">{opt}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            )}
                                            {(q.type === 'short-answer' || q.type === 'fill-in-the-blank') && (
                                                 <input type="text" onChange={(e) => setUserAnswers(prev => ({ ...prev, [index]: e.target.value }))} className="w-full mt-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none placeholder-slate-600" placeholder="Type your answer..." />
                                            )}
                                        </div>
                                    ))}
                                    <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-indigo-900/20">Submit Quiz</button>
                                </form>
                            ) : (
                                <div className="space-y-4">
                                    {analysisResult.quiz.map((q, index) => {
                                        const isCorrect = (userAnswers[index] || '').trim().toLowerCase() === q.answer.trim().toLowerCase();
                                        return (
                                            <div key={index} className={`p-4 rounded-xl border ${isCorrect ? 'bg-emerald-900/10 border-emerald-500/30' : 'bg-red-900/10 border-red-500/30'}`}>
                                                <div className="flex items-start gap-3">
                                                    <div className={`mt-0.5 ${isCorrect ? 'text-emerald-400' : 'text-red-400'}`}>
                                                        {isCorrect ? <CheckCircleIcon className="w-5 h-5" /> : <XCircleIcon className="w-5 h-5" />}
                                                    </div>
                                                    <div className="flex-1">
                                                        <p className="text-sm font-medium text-slate-200">{q.question}</p>
                                                        <div className="mt-2 text-xs space-y-1">
                                                            {!isCorrect && <p className="text-red-300">You: {userAnswers[index] || "No answer"}</p>}
                                                            <p className="text-emerald-300">Correct: {q.answer}</p>
                                                            <p className="text-slate-500 italic mt-1 pt-2 border-t border-slate-800/50">{q.explanation}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <button onClick={handleRetakeQuiz} className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-xl transition-colors">Retake Quiz</button>
                                </div>
                            )}
                        </div>

                        {/* Deep Dive Section */}
                        <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 p-6 rounded-2xl shadow-xl animate-fade-in relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
                            <h2 className="text-lg font-semibold text-white mb-2 relative z-10">Deep Dive Session</h2>
                            <p className="text-sm text-slate-400 mb-6 relative z-10">Live 1-on-1 voice coaching to reinforce your learning.</p>

                            {deepDiveStatus === 'idle' ? (
                                <div className="text-center py-8 bg-slate-950/50 rounded-xl border border-slate-800 border-dashed">
                                    <div className="w-16 h-16 bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-400">
                                        <VolumeUpIcon />
                                    </div>
                                    <button onClick={startDeepDive} disabled={quizScore === null} className="bg-white text-slate-900 font-bold py-2 px-6 rounded-full hover:bg-slate-200 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors">
                                        Start Conversation
                                    </button>
                                    {quizScore === null && <p className="text-xs text-slate-600 mt-2">Complete the quiz first to unlock.</p>}
                                </div>
                            ) : (
                                <div className="relative z-10">
                                     <div className="h-64 overflow-y-auto mb-4 space-y-3 pr-2 scrollbar-thin scrollbar-thumb-slate-700">
                                        {deepDiveConversation.map((turn, index) => (
                                            <div key={index} className={`flex ${turn.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-[85%] px-4 py-2 rounded-2xl text-sm ${
                                                    turn.speaker === 'user' 
                                                    ? 'bg-indigo-600 text-white rounded-br-none' 
                                                    : 'bg-slate-800 text-slate-200 rounded-bl-none'
                                                }`}>
                                                    {turn.text}
                                                </div>
                                            </div>
                                        ))}
                                        <div ref={conversationEndRef} />
                                     </div>
                                     
                                     {deepDiveStatus === 'active' && (
                                         <div className="flex justify-center items-center gap-4 border-t border-slate-800 pt-4">
                                             <div className="flex space-x-1">
                                                 <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div>
                                                 <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce delay-75"></div>
                                                 <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce delay-150"></div>
                                             </div>
                                             <span className="text-xs text-indigo-400 uppercase font-bold tracking-wider">Live</span>
                                             <button onClick={stopDeepDive} className="text-xs bg-red-500/20 text-red-400 px-3 py-1 rounded-full hover:bg-red-500/30 transition-colors">End Call</button>
                                         </div>
                                     )}
                                </div>
                            )}
                            
                            {deepDiveStatus === 'complete' && learningReport && (
                                <div className="mt-6 p-5 bg-slate-950/80 rounded-xl border border-indigo-500/30">
                                    <h3 className="text-md font-bold text-white mb-4 flex items-center">
                                        <span className="w-2 h-6 bg-indigo-500 rounded-full mr-2"></span>
                                        Your Personal Growth Plan
                                    </h3>
                                    <div className="space-y-4 text-sm">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="bg-emerald-900/10 p-3 rounded-lg border border-emerald-500/20">
                                                <p className="text-emerald-400 font-semibold text-xs uppercase mb-1">Strengths</p>
                                                <p className="text-slate-300">{learningReport.strengths}</p>
                                            </div>
                                            <div className="bg-amber-900/10 p-3 rounded-lg border border-amber-500/20">
                                                <p className="text-amber-400 font-semibold text-xs uppercase mb-1">Focus Areas</p>
                                                <p className="text-slate-300">{learningReport.weaknesses}</p>
                                            </div>
                                        </div>
                                        <div className="bg-slate-900 p-4 rounded-lg">
                                            <p className="text-indigo-400 font-semibold text-xs uppercase mb-2">Action Plan</p>
                                            <div className="text-slate-300 whitespace-pre-wrap leading-relaxed">{learningReport.plan}</div>
                                        </div>
                                    </div>
                                    <button onClick={startDeepDive} className="w-full mt-4 text-xs text-slate-500 hover:text-slate-300">Start New Session</button>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50 min-h-[300px] border-2 border-dashed border-slate-800 rounded-2xl">
                        <FilmIcon />
                        <p className="mt-2 text-sm font-medium">Analysis results will appear here</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default VideoProcessor;
