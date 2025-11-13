
import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="bg-gray-800/50 backdrop-blur-sm shadow-lg sticky top-0 z-10">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-blue-500">
            EduVerse AI Learning Hub
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Transforming Content into Knowledge
          </p>
        </div>
      </div>
    </header>
  );
};

export default Header;
