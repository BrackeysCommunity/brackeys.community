import { Users } from 'lucide-react';

type StatusIndicatorsProps = {
  isConnected: boolean;
  userCount: number;
  roomCode?: string;
  onRoomClick?: () => void;
};

export const StatusIndicators = ({
  isConnected,
  userCount,
  roomCode,
  onRoomClick,
}: StatusIndicatorsProps) => {
  return (
    <>
      <div className="absolute top-4 right-4 flex items-center gap-2 bg-gray-900/80 backdrop-blur-sm px-3 py-2 rounded-lg z-10 border border-gray-700">
        <div
          className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
        />
        <span className="text-sm font-medium text-gray-300">
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div className="absolute top-4 left-4 flex items-center gap-2 bg-gray-900/80 backdrop-blur-sm px-3 py-2 rounded-lg z-10 border border-gray-700">
        <Users className="w-4 h-4 text-gray-300" />
        <span className="text-sm font-medium text-gray-300">
          {userCount} user{userCount !== 1 ? 's' : ''} online
        </span>
      </div>

      {roomCode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
          <button
            onClick={onRoomClick}
            className="cursor-none flex items-center gap-2 bg-gray-900/80 backdrop-blur-sm px-4 py-2 rounded-lg border border-gray-700 hover:bg-gray-800/80 transition-colors"
          >
            <span className="text-sm font-medium text-gray-300">
              Room: {roomCode}
            </span>
          </button>
        </div>
      )}
    </>
  );
};
