import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="w-full py-4 px-6 md:px-8 flex justify-between items-center sticky top-0 z-10 md:relative">
      <div className="md:hidden flex items-center space-x-2">
         <div className="w-6 h-6 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-md shadow-md"></div>
         <span className="font-bold text-lg text-white">EduVerse</span>
      </div>

      <div className="hidden md:block">
        <h2 className="text-lg font-medium text-slate-200">Welcome Back, Scholar</h2>
        <p className="text-xs text-slate-500">Ready to explore new knowledge?</p>
      </div>

      <div className="flex items-center space-x-4">
        <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 border border-slate-500 flex items-center justify-center text-xs font-bold text-white shadow-inner">
            SR
        </div>
      </div>
    </header>
  );
};

export default Header;