import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ai, analyzeVideoFrames, getTextToSpeech } from '../services/geminiService';
import { fileToBase64 } from '../utils/fileUtils';
import { encode, decode, decodeAudioData } from '../utils/audioUtils';
import { VideoAnalysisResult, AppStatus } from '../types';
import Loader from './Loader';
import { VolumeUpIcon, CheckCircleIcon, XCircleIcon } from './icons/FeatureIcons';
import { FunctionDeclaration, Type, Modality, LiveServerMessage } from '@google/genai';

// Simplified Blob type for the gemini SDK
interface CustomBlob {
    data: string;
    mimeType: string;
}

type ConversationTurn = {
    speaker: 'user' | 'model';
    text: string;
};

const errorDetails: Record<string, { title: string; message: React.ReactNode }> = {
    timeout: {
        title: 'Video Loading Timeout',
        message: 'The video took too long to load. This can happen if the file is very large, your network is slow, or the hosting server is unresponsive. Please check the video URL or try a smaller file.',
    },
    cors: {
        title: 'Video Access Error (CORS Policy)',
        message: (
            <>
                <p>The browser blocked access to this video URL due to the server's security rules. This is a standard web security feature to protect your data.</p>
                <p className="mt-2 font-semibold">Recommended Solution:</p>
                <p>Download the video file to your device and use the "Upload File" option for analysis.</p>
            </>
        ),
    },
    extract_frames: {
        title: 'Frame Extraction Failed',
        message: "We couldn't extract frames from this video. The file might be corrupted or in an unsupported format. Please try a different video.",
    },
    invalid_duration: {
        title: 'Invalid Video Metadata',
        message: "The video file seems to be missing key metadata (like its duration), which prevents analysis. Please try re-encoding the video or using a different file.",
    },
    invalid_url_format: {
        title: 'Unsupported URL Format',
        message: 'The URL does not appear to be a direct link to a video file. Please provide a URL that ends with a video extension like .mp4, .webm, or .ogv.',
    },
    generic_analysis: {
        title: 'Analysis Error',
        message: 'An unexpected error occurred with the AI model. This might be a temporary issue. Please try again in a moment.',
    },
    mic_permission: {
        title: 'Microphone Access Denied',
        message: 'Could not access your microphone. Please check your browser’s site settings and ensure microphone permissions are granted for this page.',
    },
    session_interrupted: {
        title: 'Connection Interrupted',
        message: 'The live connection to the AI was interrupted, likely due to a network issue. Please try starting a new session.',
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

    // Deep Dive State
    const [deepDiveStatus, setDeepDiveStatus] = useState<'idle' | 'active' | 'generating_report' | 'complete'>('idle');
    const [deepDiveConversation, setDeepDiveConversation] = useState<ConversationTurn[]>([]);
    const [learningReport, setLearningReport] = useState<{ strengths: string; weaknesses: string; plan: string; } | null>(null);
    const [deepDiveError, setDeepDiveError] = useState<string | null>(null);

    const videoRef = useRef<HTMLVideoElement>(null);
    const quizFormRef = useRef<HTMLFormElement>(null);
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

        if (!url) {
            return;
        }

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
            if (!context) {
                return reject(new Error("Could not create canvas context."));
            }
            
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
                    reject(new Error("Video has an invalid duration or metadata could not be loaded."));
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
    
            if (videoElement.readyState >= 1) { // HAVE_METADATA
                onReady();
            } else {
                videoElement.load();
            }
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
                setProgressMessage(`Extracting frames... ${currentFrame}/${numFrames}`);
            });

            if (frames.length === 0) {
                throw new Error("Could not extract frames from video.");
            }

            setProgressMessage('Analyzing video with Gemini...');
            setProgress(undefined);

            const prompt = `Analyze these video frames to provide a comprehensive summary and generate a quiz. 
            The summary should have a brief version, a detailed version, and key bullet points. 
            The quiz should contain a mix of 5 questions: 2 multiple-choice, 1 true/false, 1 short-answer, and 1 fill-in-the-blank.
            Provide correct answers and explanations for each question.`;
            
            const result = await analyzeVideoFrames(frames, prompt);
            setAnalysisResult(result);
            setStatus('success');
        } catch (err) {
            console.error(err);
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';

            if (errorMessage.includes('timed out')) {
                setError('timeout');
            } else if (errorMessage.includes('CORS')) {
                setError('cors');
            } else if (errorMessage.includes('extract frames')) {
                 setError('extract_frames');
            } else if (errorMessage.includes('invalid duration')) {
                setError('invalid_duration');
            } else {
                 setError('generic_analysis');
            }
            
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
            if (userAnswer === correctAnswer) {
                score++;
            }
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
        } catch (err) {
            console.error("Error playing audio:", err);
            setError("generic_analysis");
        }
    };

    // --- DEEP DIVE FUNCTIONS ---

    const handleDeepDiveSessionEnded = useCallback(() => {
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
        }
        if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
        if (mediaStreamSourceRef.current) mediaStreamSourceRef.current.disconnect();
        if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') inputAudioContextRef.current.close();
        if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') outputAudioContextRef.current.close();

        sessionPromiseRef.current = null;
        if (deepDiveStatus !== 'complete') {
            setDeepDiveStatus('idle');
        }
    }, [deepDiveStatus]);

    const stopDeepDive = useCallback(() => {
        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then((session: any) => session.close());
        }
        handleDeepDiveSessionEnded();
    }, [handleDeepDiveSessionEnded]);

    const startDeepDive = async () => {
        if (!analysisResult) return;
        setDeepDiveError(null);
        setDeepDiveConversation([]);
        setLearningReport(null);
        setDeepDiveStatus('active');

        const systemInstruction = `You are an expert tutor. You have the following context from an educational video: "${analysisResult.summary.detailed}". Your goal is to assess the user's depth of understanding of this topic through a spoken conversation. Ask a series of 3-4 conceptual questions, listen to the user's responses, and ask follow-up questions to probe their knowledge. After the conversation, you MUST call the "generateLearningReport" function with your analysis. Do not conclude the conversation in any other way. Begin by asking your first question.`;
        
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
                            for (let i = 0; i < l; i++) {
                                int16[i] = inputData[i] * 32768;
                            }
                            const pcmBlob: CustomBlob = {
                                data: encode(new Uint8Array(int16.buffer)),
                                mimeType: 'audio/pcm;rate=16000',
                            };
                            sessionPromiseRef.current?.then((session: any) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
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
        } catch (err) {
            console.error("Error starting session:", err);
            setDeepDiveError("mic_permission");
            setDeepDiveStatus('idle');
        }
    };
    
    useEffect(() => {
        return () => { if (sessionPromiseRef.current) stopDeepDive(); };
    }, [stopDeepDive]);

    return (
        <div className="space-y-8">
            <div className="bg-gray-800 p-6 rounded-xl shadow-lg">
                <h2 className="text-xl font-semibold text-teal-300 mb-4">1. Provide Your Video</h2>
                 <div className="flex border-b border-gray-700 mb-4">
                    <button onClick={() => setInputMethod('upload')} className={`px-4 py-2 text-sm font-medium transition-colors duration-200 focus:outline-none ${inputMethod === 'upload' ? 'border-b-2 border-teal-400 text-teal-300' : 'text-gray-400 hover:text-gray-200'}`}>
                        Upload File
                    </button>
                    <button onClick={() => setInputMethod('url')} className={`px-4 py-2 text-sm font-medium transition-colors duration-200 focus:outline-none ${inputMethod === 'url' ? 'border-b-2 border-teal-400 text-teal-300' : 'text-gray-400 hover:text-gray-200'}`}>
                        From URL
                    </button>
                </div>
                {inputMethod === 'upload' ? (
                     <input type="file" accept="video/*" onChange={handleFileChange} className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100 disabled:opacity-50" disabled={status === 'processing'}/>
                ) : (
                    <div>
                        <input type="text" placeholder="Enter a direct video URL (e.g., https://.../video.mp4)" value={videoUrlInput} onChange={handleUrlInputChange} className="w-full bg-gray-900 border-gray-700 rounded-md p-2 text-white focus:ring-teal-500 focus:border-teal-500" disabled={status === 'processing'}/>
                         <p className="text-xs text-gray-500 mt-2">Note: Please use a direct link to a video file. Platform links (YouTube, Vimeo) are not supported.</p>
                    </div>
                )}
                <div className="mt-6 text-center">
                    <button onClick={handleSubmit} disabled={!videoUrl || status === 'processing' || !!error} className="bg-teal-500 text-white font-bold py-2 px-6 rounded-full hover:bg-teal-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors duration-300">
                        Analyze & Generate
                    </button>
                </div>
            </div>

            {status === 'processing' && <Loader message={progressMessage} progress={progress} />}
            
            {error && (
                 <div className={`p-4 rounded-lg ${error === 'platform_link' ? 'bg-amber-900/30 text-amber-300' : 'bg-red-900/30 text-red-300'}`}>
                     {error === 'platform_link' ? (
                         <div>
                             <p className="font-semibold text-amber-200">Platform Links Not Supported Directly</p>
                             <p className="text-sm mt-1">Browser security prevents direct analysis of videos from platforms like YouTube. Please download the video first, then use the "Upload File" option.</p>
                             <button onClick={() => { setInputMethod('upload'); setError(null); setVideoUrlInput(''); setVideoUrl(''); }} className="mt-3 bg-teal-500 text-white font-semibold py-1.5 px-4 rounded-full hover:bg-teal-600 text-sm transition-colors">Switch to Upload</button>
                         </div>
                     ) : (
                         <div>
                             <p className="font-semibold text-red-200">{errorDetails[error]?.title || 'An Error Occurred'}</p>
                             <div className="text-sm mt-1">{errorDetails[error]?.message || 'An unknown error occurred. Please try again.'}</div>
                         </div>
                     )}
                 </div>
            )}


            {videoUrl && !error && (
                <div className="bg-gray-800 p-6 rounded-xl shadow-lg">
                    <h3 className="text-lg font-semibold text-teal-300 mb-4">Video Preview</h3>
                    <video key={videoUrl} ref={videoRef} src={videoUrl} controls className="w-full rounded-lg bg-black" crossOrigin="anonymous" muted preload="metadata"></video>
                </div>
            )}
            
            {status === 'success' && analysisResult && (
                <div className="space-y-8">
                    <div className="bg-gray-800 p-6 rounded-xl shadow-lg">
                        <h2 className="text-2xl font-bold text-teal-300 mb-4">Video Summary</h2>
                        
                        <div className="flex border-b border-gray-700 mb-4">
                            <button onClick={() => setSummaryView('brief')} className={`px-4 py-2 text-sm font-medium transition-colors duration-200 focus:outline-none ${summaryView === 'brief' ? 'border-b-2 border-teal-400 text-teal-300' : 'text-gray-400 hover:text-gray-200'}`}>
                                Brief Summary
                            </button>
                            <button onClick={() => setSummaryView('detailed')} className={`px-4 py-2 text-sm font-medium transition-colors duration-200 focus:outline-none ${summaryView === 'detailed' ? 'border-b-2 border-teal-400 text-teal-300' : 'text-gray-400 hover:text-gray-200'}`}>
                                Detailed Summary
                            </button>
                            <button onClick={() => setSummaryView('keyPoints')} className={`px-4 py-2 text-sm font-medium transition-colors duration-200 focus:outline-none ${summaryView === 'keyPoints' ? 'border-b-2 border-teal-400 text-teal-300' : 'text-gray-400 hover:text-gray-200'}`}>
                                Key Points
                            </button>
                        </div>
                        
                        <div>
                            {summaryView === 'brief' && <p className="text-gray-300 whitespace-pre-line">{analysisResult.summary.brief}</p>}
                            {summaryView === 'detailed' && <p className="text-gray-300 whitespace-pre-line">{analysisResult.summary.detailed}</p>}
                            {summaryView === 'keyPoints' && (
                                <ul className="list-disc list-inside space-y-2 text-gray-300">
                                    {analysisResult.summary.keyPoints.map((point, i) => <li key={i}>{point}</li>)}
                                </ul>
                            )}
                        </div>
                    </div>

                    <div className="bg-gray-800 p-6 rounded-xl shadow-lg">
                        <h2 className="text-2xl font-bold text-teal-300 mb-4">Knowledge Check Quiz</h2>
                        {quizScore === null ? (
                            <form ref={quizFormRef} onSubmit={(e) => { e.preventDefault(); handleQuizSubmit(); }}>
                                {analysisResult.quiz.map((q, index) => (
                                    <div key={index} className="mb-6 bg-gray-900/50 p-4 rounded-lg">
                                        <div className="flex justify-between items-center">
                                            <p className="font-semibold text-gray-200 mb-2 flex-1">{index + 1}. {q.question}</p>
                                            <button type="button" onClick={() => playAudio(q.question)} className="ml-2 p-1 text-gray-400 hover:text-teal-300 focus:outline-none">
                                                <VolumeUpIcon />
                                            </button>
                                        </div>
                                        {q.type === 'multiple-choice' && q.options && (
                                            <div className="space-y-2">
                                                {q.options.map((opt, i) => (
                                                    <label key={i} className="flex items-center text-gray-300">
                                                        <input type="radio" name={`q-${index}`} value={opt} onChange={(e) => setUserAnswers(prev => ({ ...prev, [index]: e.target.value }))} className="form-radio h-4 w-4 text-teal-500 bg-gray-700 border-gray-600 focus:ring-teal-500" />
                                                        <span className="ml-2">{opt}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                        {q.type === 'true-false' && (
                                            <div className="space-y-2">
                                                <label className="flex items-center text-gray-300">
                                                    <input type="radio" name={`q-${index}`} value="True" onChange={(e) => setUserAnswers(prev => ({ ...prev, [index]: e.target.value }))} className="form-radio h-4 w-4 text-teal-500 bg-gray-700 border-gray-600 focus:ring-teal-500" />
                                                    <span className="ml-2">True</span>
                                                </label>
                                                <label className="flex items-center text-gray-300">
                                                    <input type="radio" name={`q-${index}`} value="False" onChange={(e) => setUserAnswers(prev => ({ ...prev, [index]: e.target.value }))} className="form-radio h-4 w-4 text-teal-500 bg-gray-700 border-gray-600 focus:ring-teal-500" />
                                                    <span className="ml-2">False</span>
                                                </label>
                                            </div>
                                        )}
                                        {(q.type === 'short-answer' || q.type === 'fill-in-the-blank') && (
                                            <input type="text" onChange={(e) => setUserAnswers(prev => ({ ...prev, [index]: e.target.value }))} className="w-full bg-gray-900 border-gray-700 rounded-md p-2 text-white focus:ring-teal-500 focus:border-teal-500" />
                                        )}
                                    </div>
                                ))}
                                <div className="text-center mt-6">
                                    <button type="submit" className="bg-teal-500 text-white font-bold py-2 px-6 rounded-full hover:bg-teal-600 transition-colors">Submit Quiz</button>
                                </div>
                            </form>
                        ) : (
                            <div className="text-center">
                                <h3 className="text-xl font-semibold">Your Score: {quizScore} / {analysisResult.quiz.length}</h3>
                                <div className="my-4">
                                    {analysisResult.quiz.map((q, index) => {
                                        const userAnswer = userAnswers[index]?.trim().toLowerCase() || "";
                                        const correctAnswer = q.answer.trim().toLowerCase();
                                        const isCorrect = userAnswer === correctAnswer;
                                        
                                        return (
                                            <div key={index} className={`mb-4 text-left p-4 bg-gray-900/50 rounded-lg border-l-4 transition-colors ${isCorrect ? 'border-green-500' : 'border-red-500'}`}>
                                                <div className="flex items-start font-semibold">
                                                    {isCorrect ? <CheckCircleIcon className="h-5 w-5 text-green-400 mr-2 flex-shrink-0 mt-0.5" /> : <XCircleIcon className="h-5 w-5 text-red-400 mr-2 flex-shrink-0 mt-0.5" />}
                                                    <p className="flex-1">{index + 1}. {q.question}</p>
                                                </div>

                                                { (q.type === 'multiple-choice' || q.type === 'true-false') &&
                                                    <div className="mt-3 ml-7 space-y-2">
                                                        {(q.type === 'true-false' ? ['True', 'False'] : q.options!).map((option, optIndex) => {
                                                            const optionLower = option.trim().toLowerCase();
                                                            const isCorrectAnswer = optionLower === correctAnswer;
                                                            const isUserAnswer = optionLower === userAnswer;

                                                            let optionClasses = "text-gray-300";
                                                            let icon = <div className="w-5 h-5 mr-2 flex-shrink-0" />; // Placeholder for alignment

                                                            if (isCorrectAnswer) {
                                                                optionClasses = "font-bold text-green-300";
                                                                icon = <CheckCircleIcon className="h-5 w-5 text-green-400 mr-2 flex-shrink-0" />;
                                                            } else if (isUserAnswer) {
                                                                optionClasses = "text-red-300 line-through";
                                                                icon = <XCircleIcon className="h-5 w-5 text-red-400 mr-2 flex-shrink-0" />;
                                                            }

                                                            return (
                                                                <div key={optIndex} className="flex items-center">
                                                                    {icon}
                                                                    <span className={optionClasses}>{option}</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                }

                                                { (q.type === 'short-answer' || q.type === 'fill-in-the-blank') &&
                                                    <div className="mt-3 ml-7 space-y-1 text-sm">
                                                        <p className={isCorrect ? 'text-green-300' : 'text-red-300'}>
                                                            <span className="font-semibold">Your answer: </span>{userAnswers[index] || <span className="italic text-gray-400">No answer provided</span>}
                                                        </p>
                                                        {!isCorrect && (
                                                            <p className="text-gray-300">
                                                                <span className="font-semibold">Correct answer: </span>{q.answer}
                                                            </p>
                                                        )}
                                                    </div>
                                                }

                                                <div className="flex justify-between items-center ml-7 mt-3">
                                                    <p className="text-xs text-gray-400 italic flex-1 pr-2">{q.explanation}</p>
                                                    <button type="button" onClick={() => playAudio(q.explanation)} className="ml-2 p-1 text-gray-400 hover:text-teal-300 focus:outline-none flex-shrink-0">
                                                        <VolumeUpIcon />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <button onClick={handleRetakeQuiz} className="bg-gray-600 text-white font-bold py-2 px-6 rounded-full hover:bg-gray-700 transition-colors">Retake Quiz</button>
                            </div>
                        )}
                    </div>
                    
                    <div className="bg-gray-800 p-6 rounded-xl shadow-lg">
                        <h2 className="text-2xl font-bold text-teal-300 mb-4">Deep Dive Session</h2>
                        <p className="text-gray-400 mb-4">
                            Ready to test your understanding? Start a live voice conversation with our AI tutor to explore the topics from the video in more detail. The AI will ask you questions and provide a personalized learning report at the end.
                        </p>

                        {deepDiveStatus === 'idle' && (
                            <div className="text-center">
                                <button onClick={startDeepDive} disabled={quizScore === null} className="bg-blue-600 text-white font-bold py-3 px-8 rounded-full hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors duration-300">
                                    Start Live Conversation
                                </button>
                                {quizScore === null && <p className="text-xs text-gray-500 mt-2">Please complete the quiz before starting a deep dive session.</p>}
                            </div>
                        )}

                        {deepDiveStatus === 'active' && (
                            <div className="text-center">
                                <p className="text-lg text-teal-300 mb-4 animate-pulse">Live session in progress... Speak now.</p>
                                <button onClick={stopDeepDive} className="bg-red-600 text-white font-bold py-2 px-6 rounded-full hover:bg-red-700 transition-colors">
                                    End Session
                                </button>
                            </div>
                        )}
                        
                        {deepDiveError && (
                            <div className="mt-4 p-3 bg-red-900/30 rounded-lg text-red-300 text-center">
                                <p className="font-semibold text-red-200">{errorDetails[deepDiveError]?.title || 'An Error Occurred'}</p>
                                <p className="text-sm mt-1">{errorDetails[deepDiveError]?.message || 'An unknown error occurred.'}</p>
                            </div>
                        )}

                        {deepDiveConversation.length > 0 && (
                            <div className="mt-6 space-y-4 max-h-80 overflow-y-auto pr-2 bg-gray-900/50 p-4 rounded-lg">
                                {deepDiveConversation.map((turn, index) => (
                                    <div key={index} className={`flex ${turn.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-md p-3 rounded-lg ${ turn.speaker === 'user' ? 'bg-teal-800/80 text-white' : 'bg-gray-700 text-gray-200'}`}>
                                            <p className="font-bold capitalize text-sm mb-1">{turn.speaker}</p>
                                            <p className="whitespace-pre-wrap">{turn.text}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {deepDiveStatus === 'complete' && learningReport && (
                            <div className="mt-6">
                                <h3 className="text-xl font-bold text-teal-300 mb-3">Personalized Learning Report</h3>
                                <div className="space-y-4 text-gray-300 bg-gray-900/50 p-4 rounded-lg">
                                    <div>
                                        <h4 className="font-semibold text-teal-400">Strengths</h4>
                                        <p>{learningReport.strengths}</p>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-orange-400">Areas for Improvement</h4>
                                        <p>{learningReport.weaknesses}</p>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-blue-400">Your Learning Plan</h4>
                                        <div className="whitespace-pre-wrap">{learningReport.plan}</div>
                                    </div>
                                </div>
                                <div className="text-center mt-6">
                                    <button onClick={startDeepDive} className="bg-blue-600 text-white font-bold py-2 px-6 rounded-full hover:bg-blue-700 transition-colors">Start a New Session</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default VideoProcessor;