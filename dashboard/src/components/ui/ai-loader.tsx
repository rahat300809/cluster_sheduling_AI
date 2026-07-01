import * as React from "react";

interface LoaderProps {
  size?: number; 
  text?: string;
}

export const Component: React.FC<LoaderProps> = ({ size = 180, text = "Generating" }) => {
  const letters = text.split("");

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-gradient-to-b from-[#020617] via-[#0b0f19] to-black">
      <div
        className="relative flex items-center justify-center font-sans select-none"
        style={{ width: size, height: size }}
      >
        <div className="flex gap-1.5 z-10">
          {letters.map((letter, index) => (
            <span
              key={index}
              className="inline-block text-white text-lg font-bold tracking-wider opacity-40 animate-loaderLetter"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              {letter}
            </span>
          ))}
        </div>

        <div
          className="absolute inset-0 rounded-full animate-loaderCircle"
        ></div>
      </div>
      <p className="text-slate-400 text-xs font-semibold tracking-widest mt-6 animate-pulse uppercase">
        Intelligent Node Profiling in progress
      </p>
    </div>
  );
};
