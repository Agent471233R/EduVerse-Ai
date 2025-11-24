import React from 'react';

interface TabButtonProps {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}

const TabButton: React.FC<TabButtonProps> = ({ label, icon, isActive, onClick }) => {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center space-x-3 px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 group ${
        isActive
          ? 'bg-indigo-600/10 text-indigo-300 border border-indigo-500/20'
          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100 border border-transparent'
      }`}
    >
      <span className={`${isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'}`}>
        {icon}
      </span>
      <span>{label}</span>
      {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)]"></div>}
    </button>
  );
};

export default TabButton;