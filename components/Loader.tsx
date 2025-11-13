import React from 'react';

interface LoaderProps {
  message: string;
  progress?: number;
}

const Loader: React.FC<LoaderProps> = ({ message, progress }) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 bg-gray-800/50 rounded-lg">
      <div className="w-12 h-12 border-4 border-t-teal-400 border-gray-600 rounded-full animate-spin"></div>
      <p className="mt-4 text-lg text-gray-300">{message}</p>
      {progress !== undefined && (
        <div className="w-full max-w-sm bg-gray-600 rounded-full h-2.5 mt-4">
            <div className="bg-teal-400 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
        </div>
      )}
    </div>
  );
};

export default Loader;
