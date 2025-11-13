import React from 'react';

const About: React.FC = () => {
  return (
    <div className="bg-gray-800 p-6 md:p-8 rounded-xl shadow-lg text-center max-w-2xl mx-auto">
      <h2 className="text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-blue-500 mb-4">
        AI Video Summariser & Quiz Generator
      </h2>
      <p className="text-lg text-gray-300 mb-8">
        Smart Learning for a Faster World
      </p>
      
      <div className="text-left space-y-6 text-gray-400">
        <div className="border-t border-gray-700 pt-6">
          <p className="font-semibold text-teal-400">Created By:</p>
          <p className="text-xl text-gray-200">Sumit Raj</p>
        </div>
        
        <div>
          <p className="font-semibold text-teal-400">Roll No:</p>
          <p className="text-xl text-gray-200">2822444</p>
        </div>
        
        <div>
          <p className="font-semibold text-teal-400">Under the supervision of:</p>
          <p className="text-xl text-gray-200">Mr. Rajeev Dhanda</p>
        </div>
      </div>
    </div>
  );
};

export default About;
