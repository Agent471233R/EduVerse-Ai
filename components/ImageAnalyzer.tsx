import React, { useState } from 'react';
import { analyzeImage } from '../services/geminiService';
import { fileToBase64 } from '../utils/fileUtils';
import { AppStatus } from '../types';
import Loader from './Loader';

const errorDetails: Record<string, { title: string; message: string }> = {
    no_prompt: {
        title: 'Missing Question',
        message: 'Please enter a question or a prompt about the image before analyzing.',
    },
    no_file: {
        title: 'No Image Selected',
        message: 'Please choose an image file to upload.',
    },
    no_url: {
        title: 'No Image URL',
        message: 'Please enter a URL for an image.',
    },
    cors: {
        title: 'Image Access Error',
        message: 'Could not fetch the image from the URL due to server security restrictions (CORS). Please try downloading the image and uploading it directly.',
    },
    invalid_image_url: {
        title: 'Invalid Image URL',
        message: 'The provided URL does not seem to point to a valid image. Please use a direct link to a file like .jpg or .png.',
    },
    preview_load: {
        title: 'Preview Failed',
        message: 'Could not load the image preview from the provided URL. Please check the link for errors.',
    },
    generic_analysis: {
        title: 'Analysis Failed',
        message: 'An error occurred with the AI model. This could be a temporary issue or the image content might not be analyzable.',
    },
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
    setImageUrl(url); // for preview
    setImageFile(null);
    setResult('');
    setInputMethod('url');
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!prompt) {
      setError("no_prompt");
      return;
    }
    if (inputMethod === 'upload' && !imageFile) {
      setError("no_file");
      return;
    }
    if (inputMethod === 'url' && !imageUrlInput) {
      setError("no_url");
      return;
    }

    setStatus('processing');
    setResult('');

    try {
      let base64Image: string;
      let mimeType: string;

      if (inputMethod === 'upload' && imageFile) {
        base64Image = await fileToBase64(imageFile);
        mimeType = imageFile.type;
      } else { // URL input
        const response = await fetch(imageUrlInput);
        if (!response.ok) {
          throw new Error(`Network response was not ok: ${response.statusText}`);
        }
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) {
            throw new Error('The provided URL does not point to a valid image file.');
        }
        base64Image = await fileToBase64(blob as File);
        mimeType = blob.type;
      }
      
      const analysisResult = await analyzeImage(base64Image, mimeType, prompt);
      setResult(analysisResult);
      setStatus('success');
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';

      if (errorMessage.includes('Network response was not ok') || errorMessage.includes('CORS')) {
          setError('cors');
      } else if (errorMessage.includes('not a valid image')) {
          setError('invalid_image_url');
      } else {
           setError('generic_analysis');
      }
      
      setStatus('error');
    }
  };

  return (
    <div className="space-y-8">
      <div className="bg-gray-800 p-6 rounded-xl shadow-lg">
        <h2 className="text-xl font-semibold text-teal-300 mb-4">1. Provide Your Image</h2>
        <div className="flex border-b border-gray-700 mb-4">
            <button onClick={() => setInputMethod('upload')} className={`px-4 py-2 text-sm font-medium transition-colors duration-200 focus:outline-none ${inputMethod === 'upload' ? 'border-b-2 border-teal-400 text-teal-300' : 'text-gray-400 hover:text-gray-200'}`}>
                Upload File
            </button>
            <button onClick={() => setInputMethod('url')} className={`px-4 py-2 text-sm font-medium transition-colors duration-200 focus:outline-none ${inputMethod === 'url' ? 'border-b-2 border-teal-400 text-teal-300' : 'text-gray-400 hover:text-gray-200'}`}>
                From URL
            </button>
        </div>

        {inputMethod === 'upload' ? (
            <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100 disabled:opacity-50"
                disabled={status === 'processing'}
            />
        ) : (
            <input
                type="text"
                placeholder="Enter image URL"
                value={imageUrlInput}
                onChange={handleUrlInputChange}
                className="w-full bg-gray-900 border-gray-700 rounded-md p-2 text-white focus:ring-teal-500 focus:border-teal-500"
                disabled={status === 'processing'}
            />
        )}
        
        {imageUrl && (
          <div className="mt-4 bg-gray-900/50 p-2 rounded-lg flex justify-center">
            <img src={imageUrl} alt="Preview" className="max-h-64 rounded-md" onError={() => setError('preview_load')}/>
          </div>
        )}
      </div>

      <div className="bg-gray-800 p-6 rounded-xl shadow-lg">
        <h2 className="text-xl font-semibold text-teal-300 mb-4">2. Ask a Question</h2>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g., What is in this image? Describe the main subject."
          className="w-full h-24 bg-gray-900 border-gray-700 rounded-md p-2 text-white focus:ring-teal-500 focus:border-teal-500"
          disabled={status === 'processing'}
        />
      </div>

      <div className="text-center">
        <button
          onClick={handleSubmit}
          disabled={(!imageFile && !imageUrlInput) || !prompt || status === 'processing'}
          className="bg-teal-500 text-white font-bold py-3 px-8 rounded-full hover:bg-teal-600 disabled:bg-gray-600 transition-colors duration-300"
        >
          Analyze Image
        </button>
      </div>

      {status === 'processing' && <Loader message="Analyzing image..." />}
      
      {status === 'error' && error && (
        <div className="p-4 bg-red-900/30 rounded-lg text-red-300 text-center">
            <p className="font-semibold text-red-200">{errorDetails[error]?.title || 'An Error Occurred'}</p>
            <p className="text-sm mt-1">{errorDetails[error]?.message || 'An unknown error occurred. Please try again.'}</p>
        </div>
      )}
      
      {status === 'success' && result && (
        <div className="bg-gray-800 p-6 rounded-xl shadow-lg">
          <h2 className="text-xl font-semibold text-teal-300 mb-4">Analysis Result</h2>
          <p className="text-gray-300 whitespace-pre-line">{result}</p>
        </div>
      )}
    </div>
  );
};

export default ImageAnalyzer;