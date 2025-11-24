import React from 'react';

const About: React.FC = () => {
  return (
    <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 p-8 md:p-12 rounded-3xl shadow-2xl max-w-xl text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>
          
          <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">EduVerse</h2>
          <p className="text-indigo-400 font-medium mb-8">AI-Powered Knowledge Hub</p>
          
          <p className="text-slate-400 mb-10 leading-relaxed">
            Transforming educational content into interactive learning experiences. 
            Built with the power of Google Gemini 2.5 Multimodal AI.
          </p>
          
          <div className="grid grid-cols-1 gap-6 text-left bg-slate-950/50 p-6 rounded-2xl border border-slate-800/50">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Developer</p>
              <p className="text-lg text-white font-medium">Sumit Raj</p>
              <p className="text-sm text-slate-500">Roll No: 2822444</p>
            </div>
            
            <div className="pt-4 border-t border-slate-800/50">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Supervision</p>
              <p className="text-lg text-white font-medium">Mr. Rajeev Dhanda</p>
            </div>
          </div>
          
          <div className="mt-8 text-xs text-slate-600">
            v1.0.0 • Enterprise Edition
          </div>
        </div>
    </div>
  );
};

export default About;