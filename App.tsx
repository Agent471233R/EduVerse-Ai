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
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Sidebar Navigation for Desktop */}
      <aside className="hidden md:flex flex-col w-64 bg-slate-900 border-r border-slate-800 h-full shrink-0">
        <div className="p-6 flex items-center justify-center border-b border-slate-800">
             <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg mr-3 shadow-lg shadow-indigo-500/20"></div>
             <h1 className="text-xl font-bold tracking-tight text-white">EduVerse</h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 px-3">Tools</div>
          <TabButton
            label="Video Hub"
            icon={<FilmIcon />}
            isActive={activeTab === 'video'}
            onClick={() => setActiveTab('video')}
          />
          <TabButton
            label="Image Analyst"
            icon={<PhotoIcon />}
            isActive={activeTab === 'image'}
            onClick={() => setActiveTab('image')}
          />
          <TabButton
            label="Live Tutor"
            icon={<LiveIcon />}
            isActive={activeTab === 'audio'}
            onClick={() => setActiveTab('audio')}
          />
          
          <div className="mt-8 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 px-3">System</div>
          <TabButton
            label="About App"
            icon={<UserIcon />}
            isActive={activeTab === 'about'}
            onClick={() => setActiveTab('about')}
          />
        </nav>
        
        <div className="p-4 border-t border-slate-800">
            <div className="bg-slate-800/50 rounded-xl p-4">
                <p className="text-xs text-slate-400">Powered by</p>
                <p className="text-sm font-medium text-white">Google Gemini 2.5</p>
            </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        <Header />
        
        <main className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth relative z-0">
            <div className="max-w-5xl mx-auto pb-24 md:pb-0 animate-fade-in">
                {renderContent()}
            </div>
        </main>

        {/* Mobile Bottom Navigation */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900/90 backdrop-blur-md border-t border-slate-800 z-50 px-4 py-2 flex justify-around items-center safe-area-pb">
            <button onClick={() => setActiveTab('video')} className={`p-2 rounded-lg flex flex-col items-center ${activeTab === 'video' ? 'text-indigo-400' : 'text-slate-500'}`}>
                <FilmIcon />
                <span className="text-[10px] mt-1">Video</span>
            </button>
            <button onClick={() => setActiveTab('image')} className={`p-2 rounded-lg flex flex-col items-center ${activeTab === 'image' ? 'text-indigo-400' : 'text-slate-500'}`}>
                <PhotoIcon />
                <span className="text-[10px] mt-1">Image</span>
            </button>
            <button onClick={() => setActiveTab('audio')} className={`p-2 rounded-lg flex flex-col items-center ${activeTab === 'audio' ? 'text-indigo-400' : 'text-slate-500'}`}>
                <LiveIcon />
                <span className="text-[10px] mt-1">Live</span>
            </button>
            <button onClick={() => setActiveTab('about')} className={`p-2 rounded-lg flex flex-col items-center ${activeTab === 'about' ? 'text-indigo-400' : 'text-slate-500'}`}>
                <UserIcon />
                <span className="text-[10px] mt-1">About</span>
            </button>
        </div>
      </div>
    </div>
  );
};

export default App;