
import React, { useState, useEffect } from 'react';
import { analyzeImage } from '../services/geminiService';
import { fileToBase64 } from '../utils/fileUtils';
import { AppStatus } from '../types';
import Loader from './Loader';
import { PhotoIcon, ClockIcon, TrashIcon } from './icons/FeatureIcons';

interface ImageHistoryItem {
    id: string;
    timestamp: number;
    prompt: string;
    result: string;
}

const errorDetails: Record<string, { title: string; message: string }> = {
    no_prompt: { title: 'Missing Question', message: 'Please enter a question about the image.' },
    no_file: { title: 'No Image', message: 'Please select an image file.' },
    no_url: { title: 'No URL', message: 'Please enter a valid image URL.' },
    cors: { title: 'Access Error', message: 'Security restrictions prevented loading this image URL.' },
    invalid_image_url: { title: 'Invalid Image', message: 'The URL must point to an image file.' },
    preview_load: { title: 'Preview Failed', message: 'Could not load the image preview.' },
    generic_analysis: { title: 'Analysis Failed', message: 'An error occurred during analysis.' },
};

const ImageAnalyzer: React.FC = () => {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [prompt, setPrompt] = useState<string>('');
  const [status, setStatus] = useState<AppStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string>('');
  const [inputMethod, setInputMethod] = useState<'upload' | 'url'>('upload');
  const [imageUrlInput, setImageUrlInput] = useState<string>('');
  
  // History
  const [history, setHistory] = useState<ImageHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
      const stored = localStorage.getItem('eduverse_image_history');
      if (stored) {
          try { setHistory(JSON.parse(stored)); } catch (e) { console.error(e); }
      }
  }, []);

  const saveToHistory = (promptText: string, resultText: string) => {
      const newItem: ImageHistoryItem = {
          id: Date.now().toString(),
          timestamp: Date.now(),
          prompt: promptText,
          result: resultText
      };
      const updated = [newItem, ...history].slice(0, 10);
      setHistory(updated);
      localStorage.setItem('eduverse_image_history', JSON.stringify(updated));
  };

  const clearHistory = () => {
      setHistory([]);
      localStorage.removeItem('eduverse_image_history');
  };

  const restoreFromHistory = (item: ImageHistoryItem) => {
      setPrompt(item.prompt);
      setResult(item.result);
      setStatus('success');
      setImageFile(null);
      setImageUrl('');
      setShowHistory(false);
  };

  const cleanText = (text: string) => {
      // Remove asterisks (bold/italic markers), hashes (headers), and long dashes (separators)
      return text.replace(/[\*#]/g, '').replace(/[-]{3,}/g, '').trim();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setImageUrl(URL.createObjectURL(file));
      setResult('');
      setInputMethod('upload');
      setImageUrlInput('');
      setError(null);
    }
  };

  const handleUrlInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const url = e.target.value;
    setImageUrlInput(url);
    setImageUrl(url);
    setImageFile(null);
    setResult('');
    setInputMethod('url');
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!prompt) return setError("no_prompt");
    if (inputMethod === 'upload' && !imageFile) return setError("no_file");
    if (inputMethod === 'url' && !imageUrlInput) return setError("no_url");

    setStatus('processing');
    setResult('');

    try {
      let base64Image: string;
      let mimeType: string;
      if (inputMethod === 'upload' && imageFile) {
        base64Image = await fileToBase64(imageFile);
        mimeType = imageFile.type;
      } else {
        const response = await fetch(imageUrlInput);
        if (!response.ok) throw new Error(`Network error`);
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw new Error('Invalid image');
        base64Image = await fileToBase64(blob as File);
        mimeType = blob.type;
      }
      const analysisResult = await analyzeImage(base64Image, mimeType, prompt);
      const cleanedResult = cleanText(analysisResult);
      setResult(cleanedResult);
      saveToHistory(prompt, cleanedResult);
      setStatus('success');
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Network') || msg.includes('CORS')) setError('cors');
      else if (msg.includes('Invalid image')) setError('invalid_image_url');
      else setError('generic_analysis');
      setStatus('error');
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Input Section */}
        <div className="space-y-6">
            <div className="bg-slate-900/50 backdrop-blur border border-slate-800 p-6 rounded-2xl shadow-lg">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold text-white">Image Input</h2>
                    <button onClick={() => setShowHistory(!showHistory)} className={`p-2 rounded-lg transition-colors ${showHistory ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}>
                        <ClockIcon />
                    </button>
                </div>

                {showHistory && (
                    <div className="mb-4 bg-slate-950 rounded-xl border border-slate-800 overflow-hidden animate-fade-in">
                        <div className="p-3 border-b border-slate-800 flex justify-between items-center">
                             <span className="text-xs font-bold text-slate-400 uppercase">Recent Analysis</span>
                             <button onClick={clearHistory} className="text-slate-600 hover:text-red-400 transition-colors"><TrashIcon /></button>
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                             {history.length === 0 ? <div className="p-4 text-center text-xs text-slate-600">No history.</div> : history.map(item => (
                                 <button key={item.id} onClick={() => restoreFromHistory(item)} className="w-full text-left p-3 hover:bg-slate-900 border-b border-slate-800 last:border-0 transition-colors">
                                     <p className="text-sm text-slate-300 font-medium truncate">{item.prompt}</p>
                                     <p className="text-xs text-slate-500 mt-0.5">{new Date(item.timestamp).toLocaleDateString()}</p>
                                 </button>
                             ))}
                        </div>
                    </div>
                )}

                <div className="flex p-1 bg-slate-800 rounded-lg mb-4">
                    <button onClick={() => setInputMethod('upload')} className={`flex-1 py-2 text-xs font-bold uppercase tracking-wide rounded-md transition-all ${inputMethod === 'upload' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}>Upload</button>
                    <button onClick={() => setInputMethod('url')} className={`flex-1 py-2 text-xs font-bold uppercase tracking-wide rounded-md transition-all ${inputMethod === 'url' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}>URL</button>
                </div>

                <div className="min-h-[200px] flex flex-col justify-center relative">
                    {inputMethod === 'upload' ? (
                         <div className="relative w-full h-48 border-2 border-dashed border-slate-700 rounded-xl bg-slate-800/20 hover:bg-slate-800/40 hover:border-indigo-500 transition-all group">
                             <input type="file" accept="image/*" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" disabled={status === 'processing'} />
                             <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 group-hover:text-indigo-400">
                                 <PhotoIcon />
                                 <p className="mt-2 text-xs font-medium">Click or Drag Image</p>
                             </div>
                         </div>
                    ) : (
                        <input type="text" placeholder="https://example.com/image.jpg" value={imageUrlInput} onChange={handleUrlInputChange} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:ring-2 focus:ring-indigo-500 outline-none" disabled={status === 'processing'}/>
                    )}
                    
                    {imageUrl && (
                        <div className="mt-4 relative rounded-xl overflow-hidden border border-slate-700 shadow-lg group">
                            <img src={imageUrl} alt="Preview" className="w-full h-48 object-cover" onError={() => setError('preview_load')}/>
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <p className="text-white text-xs font-bold">Preview</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-slate-900/50 backdrop-blur border border-slate-800 p-6 rounded-2xl shadow-lg">
                <h2 className="text-lg font-semibold text-white mb-4">Your Question</h2>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What insights do you need from this image?" className="w-full h-32 bg-slate-950 border border-slate-700 rounded-xl p-4 text-white placeholder-slate-600 focus:ring-2 focus:ring-indigo-500 outline-none resize-none" disabled={status === 'processing'} />
                <button onClick={handleSubmit} disabled={(!imageFile && !imageUrlInput) || !prompt || status === 'processing'} className="w-full mt-4 bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed transition-all">
                    Analyze Now
                </button>
            </div>
        </div>

        {/* Results Section */}
        <div className="space-y-6">
            {status === 'processing' && (
                <div className="h-full flex items-center justify-center bg-slate-900/30 border border-slate-800 rounded-2xl min-h-[400px]">
                    <Loader message="Vision AI Processing..." />
                </div>
            )}

            {status === 'error' && error && (
                <div className="bg-red-950/30 border border-red-900 p-6 rounded-2xl text-center min-h-[200px] flex flex-col justify-center items-center">
                    <div className="w-10 h-10 bg-red-900/50 rounded-full flex items-center justify-center text-red-400 mb-3">!</div>
                    <p className="font-bold text-red-200">{errorDetails[error]?.title}</p>
                    <p className="text-sm text-red-300/70 mt-1">{errorDetails[error]?.message}</p>
                </div>
            )}

            {status === 'success' && result && (
                <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 p-8 rounded-2xl shadow-2xl h-full animate-fade-in">
                    <h2 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400 mb-6">AI Insights</h2>
                    <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed whitespace-pre-line font-sans">
                        {result}
                    </div>
                </div>
            )}
            
            {status === 'idle' && (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50 min-h-[400px] border-2 border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
                    <PhotoIcon />
                    <p className="mt-3 text-sm font-medium">Results appear here</p>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default ImageAnalyzer;
