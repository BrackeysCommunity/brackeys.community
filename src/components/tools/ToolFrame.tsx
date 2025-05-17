import { useState, useRef } from 'react';
import { Link } from '@tanstack/react-router';

type ToolFrameProps = {
  toolId: string;
  toolName: string;
  toolUrl: string;
};

export const ToolFrame = ({ toolId, toolName, toolUrl }: ToolFrameProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleIframeLoad = (): void => {
    setIsLoading(false);
  };

  return (
    <>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800 bg-opacity-70 z-10">
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brackeys-purple-500 mb-4"></div>
            <p className="text-gray-400">Loading tool...</p>
          </div>
        </div>
      )}
      
      {toolUrl ? (
        <iframe
          ref={iframeRef}
          src={toolUrl}
          title={toolName}
          className="w-full h-full border-0"
          onLoad={handleIframeLoad}
          sandbox="allow-scripts allow-same-origin allow-forms"
          loading="lazy"
        />
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-6 max-w-md">
            <h3 className="text-xl font-semibold text-red-400 mb-2">Tool Not Found</h3>
            <p className="text-gray-300 mb-4">
              The tool "{toolId}" does not exist or is currently unavailable.
            </p>
            <Link
              to="/tools"
              className="inline-block px-4 py-2 bg-gray-700 text-gray-300 rounded-md hover:bg-gray-600 transition-colors"
            >
              Back to Tools
            </Link>
          </div>
        </div>
      )}
    </>
  );
};
