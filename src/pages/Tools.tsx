import { useState, useEffect } from 'react';
import { motion } from 'motion/react';

type Tool = {
  name: string;
  description: string;
  url: string;
  category: string;
  isPopular: boolean;
};

const toolsList: Tool[] = [
  {
    name: 'Unity',
    description: 'A powerful cross-platform game development engine',
    url: 'https://unity.com',
    category: 'Game Development',
    isPopular: true,
  },
  {
    name: 'Blender',
    description: 'Free and open source 3D creation suite',
    url: 'https://www.blender.org',
    category: 'Graphics & Art',
    isPopular: true,
  },
  {
    name: 'Visual Studio Code',
    description: 'Lightweight but powerful source code editor',
    url: 'https://code.visualstudio.com',
    category: 'Code Editors',
    isPopular: true,
  },
  {
    name: 'Godot',
    description: 'Free and open-source game engine',
    url: 'https://godotengine.org',
    category: 'Game Development',
    isPopular: false,
  },
  {
    name: 'Aseprite',
    description: 'Animated sprite editor & pixel art tool',
    url: 'https://www.aseprite.org',
    category: 'Graphics & Art',
    isPopular: false,
  },
  {
    name: 'GitHub',
    description: 'Version control and collaboration platform',
    url: 'https://github.com',
    category: 'Development Tools',
    isPopular: true,
  },
  {
    name: 'Trello',
    description: 'Project management tool',
    url: 'https://trello.com',
    category: 'Project Management',
    isPopular: false,
  },
  {
    name: 'Visual Studio',
    description: 'Integrated development environment from Microsoft',
    url: 'https://visualstudio.microsoft.com',
    category: 'Code Editors',
    isPopular: false,
  },
];

type Category = {
  name: string;
  count: number;
};

export const Tools = () => {
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    document.title = 'Tools - Brackeys Community';
  }, []);

  const categories: Category[] = [
    { name: 'All', count: toolsList.length },
    ...Object.entries(
      toolsList.reduce<Record<string, number>>((acc, tool) => {
        acc[tool.category] = (acc[tool.category] || 0) + 1;
        return acc;
      }, {})
    ).map(([name, count]) => ({ name, count })),
  ];

  const filteredTools = toolsList.filter((tool) => {
    const matchesCategory = activeCategory === 'All' || tool.category === activeCategory;
    const matchesSearch = tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <h1 className="text-3xl font-bold text-white mb-6">Game Development Tools</h1>
        <p className="text-lg text-gray-300 mb-8">
          Discover the best tools for game development, whether you're a beginner or professional.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col md:flex-row gap-6"
      >
        {/* Sidebar */}
        <motion.div
          className="w-full md:w-64 shrink-0"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <div className="bg-gray-800 rounded-lg p-4">
            <h2 className="text-xl font-semibold text-white mb-4">Categories</h2>
            <ul>
              {categories.map((category) => (
                <li key={category.name} className="mb-2">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setActiveCategory(category.name)}
                    className={`w-full text-left py-2 px-3 rounded-md flex justify-between items-center ${activeCategory === category.name
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-400 hover:bg-gray-700/50'
                      }`}
                  >
                    <span>{category.name}</span>
                    <span className="bg-gray-900 text-gray-400 text-xs px-2 py-1 rounded-full">
                      {category.count}
                    </span>
                  </motion.button>
                </li>
              ))}
            </ul>
          </div>
        </motion.div>

        {/* Main content */}
        <div className="flex-1">
          <div className="mb-6">
            <motion.input
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              type="text"
              placeholder="Search tools..."
              className="w-full px-4 py-3 bg-gray-800 text-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="tools-search-input"
            />
          </div>

          {filteredTools.length === 0 ? (
            <div className="text-center py-12 bg-gray-800 rounded-lg">
              <p className="text-lg text-gray-300">No tools found matching your criteria.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTools.map((tool) => (
                <motion.div
                  key={`tool-${tool.name}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{
                    y: -5,
                    transition: { delay: 0 }
                  }}
                  whileTap={{
                    scale: 0.98,
                    transition: { delay: 0 }
                  }}
                  transition={{
                    duration: 0.3,
                    type: 'spring',
                    stiffness: 300,
                    damping: 20
                  }}
                  className="bg-gray-800 rounded-lg p-5 border border-gray-700 hover:border-brackeys-purple-500 transition-colors"
                  data-testid={`tool-card-${tool.name.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="text-xl font-semibold text-white">{tool.name}</h3>
                    {tool.isPopular && (
                      <span className="bg-brackeys-purple-500/20 text-brackeys-purple-400 text-xs px-2 py-1 rounded-full">
                        Popular
                      </span>
                    )}
                  </div>
                  <p className="text-gray-400 mb-4">{tool.description}</p>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500">{tool.category}</span>
                    <motion.a
                      href={tool.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brackeys-purple-500 hover:text-brackeys-purple-300 text-sm font-semibold"
                      whileHover={{ x: 3 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      Visit Website →
                    </motion.a>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
