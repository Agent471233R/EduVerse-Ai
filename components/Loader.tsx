import React from 'react';

interface LoaderProps {
  message: string;
  progress?: number;
}

const Loader: React.FC<LoaderProps> = ({ message, progress }) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 w-full">
      <div className="relative w-12 h-12 mb-4">
        <div className="absolute inset-0 border-4 border-slate-800 rounded-full"></div>
        <div className="absolute inset-0 border-4 border-indigo-500 rounded-full border-t-transparent animate-spin"></div>
      </div>
      <p className="text-sm font-medium text-slate-300 animate-pulse">{message}</p>
      {progress !== undefined && (
        <div className="w-full max-w-xs bg-slate-800 rounded-full h-1.5 mt-4 overflow-hidden">
            <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300 ease-out shadow-[0_0_10px_rgba(99,102,241,0.5)]" style={{ width: `${progress}%` }}></div>
        </div>
      )}
    </div>
  );
};

export default Loader;