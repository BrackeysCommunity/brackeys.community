import { createPortal } from 'react-dom';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, ExternalLink, Minimize } from 'lucide-react';

type ToolPortalProps = {
  toolName: string;
  toolUrl: string;
  onExitFullscreen: () => void;
  children: React.ReactNode;
};

export const ToolPortal = ({
  toolName,
  toolUrl,
  onExitFullscreen,
  children
}: ToolPortalProps) => {
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900">
      <div className="bg-gray-800 p-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-4">
          <Link
            to="/tools"
            className="text-gray-400 hover:text-gray-300 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-xl font-bold text-white">
            {toolName}
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onExitFullscreen}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
            title="Exit Fullscreen"
          >
            <Minimize className="h-4 w-4" />
            <span className="hidden sm:inline">Exit Fullscreen</span>
          </button>
          {toolUrl && (
            <a
              href={toolUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-brackeys-purple-600 text-white hover:bg-brackeys-purple-700 transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              <span className="hidden sm:inline">Open Original</span>
            </a>
          )}
        </div>
      </div>
      <div className="flex-1 relative">
        {children}
      </div>
    </div>,
    document.body
  );
};
