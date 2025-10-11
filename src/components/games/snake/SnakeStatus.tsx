type GameStatusProps = {
  score: number;
  highScore: number;
};

export const SnakeStatus = ({ score, highScore }: GameStatusProps) => {
  return (
    <div className="w-full mb-2 flex items-center">
      <div className="flex-1 flex justify-between items-center">
        <div className="bg-gray-800 px-3 py-2 rounded-lg shadow flex flex-col">
          <p className="text-gray-400 text-xs font-medium">SCORE</p>
          <p className="text-xl font-bold text-white">{score}</p>
        </div>

        <div className="flex-1 flex flex-wrap justify-center gap-1 px-2 text-center">
          <div className="w-full mx-auto">
            <span className="text-gray-300 text-xs px-1 bg-gray-800 rounded-md py-1 inline-block min-w-9">
              ↑/W
            </span>
          </div>
          <span className="text-gray-300 text-xs px-1 bg-gray-800 rounded-md py-1 inline-block min-w-9">
            ←/A
          </span>
          <span className="text-gray-300 text-xs px-1 bg-gray-800 rounded-md py-1 inline-block min-w-9">
            ↓/S
          </span>
          <span className="text-gray-300 text-xs px-1 bg-gray-800 rounded-md py-1 inline-block min-w-9">
            →/D
          </span>
        </div>

        <div className="bg-gray-800 px-3 py-2 rounded-lg shadow flex flex-col">
          <p className="text-gray-400 text-xs font-medium">HIGH SCORE</p>
          <p className="text-xl font-bold text-white">{highScore}</p>
        </div>
      </div>
    </div>
  );
};
