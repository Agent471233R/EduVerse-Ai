
import React, { useState } from 'react';
import VideoProcessor from './components/VideoProcessor';
import ImageAnalyzer from './components/ImageAnalyzer';
import AudioTranscriber from './components/AudioTranscriber';
import Header from './components/Header';
import TabButton from './components/TabButton';
import { FilmIcon, PhotoIcon, LiveIcon, UserIcon } from './components/icons/FeatureIcons';
import About from './components/About';

type Tab = 'video' | 'image' | 'audio' | 'about';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('video');

  const renderContent = () => {
    switch (activeTab) {
      case 'video':
        return <VideoProcessor />;
      case 'image':
        return <ImageAnalyzer />;
      case 'audio':
        return <AudioTranscriber />;
      case 'about':
        return <About />;
      default:
        return <VideoProcessor />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans">
      <Header />
      <main className="container mx-auto p-4 md:p-6 lg:p-8">
        <div className="mb-8 flex justify-center space-x-2 md:space-x-4 border-b border-gray-700 pb-4">
          <TabButton
            label="Video Learning Hub"
            icon={<FilmIcon />}
            isActive={activeTab === 'video'}
            onClick={() => setActiveTab('video')}
          />
          <TabButton
            label="Image Analyzer"
            icon={<PhotoIcon />}
            isActive={activeTab === 'image'}
            onClick={() => setActiveTab('image')}
          />
          <TabButton
            label="Live Conversation"
            icon={<LiveIcon />}
            isActive={activeTab === 'audio'}
            onClick={() => setActiveTab('audio')}
          />
          <TabButton
            label="About"
            icon={<UserIcon />}
            isActive={activeTab === 'about'}
            onClick={() => setActiveTab('about')}
          />
        </div>
        
        {renderContent()}
      </main>
       <footer className="text-center p-4 text-gray-500 text-sm">
        <p>Powered by Google Gemini. Designed for modern learning experiences.</p>
      </footer>
    </div>
  );
};

export default App;
