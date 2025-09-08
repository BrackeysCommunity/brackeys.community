import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ExternalLink, Maximize } from 'lucide-react';
import { Link, useParams } from '@tanstack/react-router';
import { ToolPortal } from '../components/tools/ToolPortal';
import { ToolFrame } from '../components/tools/ToolFrame';
import { Button } from '../components/ui/Button';

type Tool = {
  id: string;
  name: string;
  url: string;
  description: string;
};

const tools: Record<string, Tool> = {
  'documentation-generator': {
    id: 'documentation-generator',
    name: 'Documentation Generator',
    url: 'https://swagger.io/tools/swagger-editor/',
    description: 'Generate interactive API documentation for your projects',
  },
  'color-palette': {
    id: 'color-palette',
    name: 'Color Palette Generator',
    url: 'https://coolors.co/generate',
    description: 'Create beautiful color palettes for your game or website',
  },
  'pixel-editor': {
    id: 'pixel-editor',
    name: 'Pixel Editor',
    url: 'https://www.pixilart.com/draw',
    description: 'Create and edit pixel art directly in your browser',
  },
  'paste-myst': {
    id: 'paste-myst',
    name: 'Paste Myst',
    url: 'https://paste.myst.rs',
    description: 'Paste text or files to share with others',
  },
};

export const ToolEmbed = () => {
  const params = useParams({ strict: false });
  const toolId = params.toolId || '';
  const [isFullscreen, setIsFullscreen] = useState(false);

  const tool = tools[toolId] || {
    id: toolId,
    name: toolId
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' '),
    url: '',
    description: 'Tool not found',
  };

  useEffect(() => {
    document.title = `${tool.name} - Brackeys Community Tools`;
  }, [tool.name]);

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  if (isFullscreen) {
    return (
      <ToolPortal toolName={tool.name} toolUrl={tool.url} onExitFullscreen={toggleFullscreen}>
        <ToolFrame toolId={toolId} toolName={tool.name} toolUrl={tool.url} />
      </ToolPortal>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-8"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <Link to="/resources" className="text-gray-400 hover:text-gray-300 transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-3xl font-bold text-white">{tool.name}</h1>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Maximize className="h-4 w-4" />}
              onClick={toggleFullscreen}
              title="Fullscreen Mode"
            >
              <span className="hidden sm:inline">Fullscreen</span>
            </Button>
            {tool.url && (
              <a
                href={tool.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-brackeys-purple-600 text-white hover:bg-brackeys-purple-700 transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-brackeys-purple-500 focus:ring-offset-brackeys-purple-800"
              >
                <ExternalLink className="h-4 w-4" />
                <span className="hidden sm:inline">Open Original</span>
              </a>
            )}
          </div>
        </div>

        <p className="text-lg text-gray-300 mb-4">{tool.description}</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative bg-gray-800 border border-gray-700 rounded-lg overflow-hidden h-[600px]"
      >
        <ToolFrame toolId={toolId} toolName={tool.name} toolUrl={tool.url} />
      </motion.div>

      <div className="mt-4 text-xs text-gray-500">
        <p>
          Note: Some external tools may have restrictions that prevent them from being embedded. If
          a tool doesn't load properly, please use the "Open Original" button.
        </p>
      </div>
    </div>
  );
};
