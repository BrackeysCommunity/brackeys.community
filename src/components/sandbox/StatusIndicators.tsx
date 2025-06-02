import { Users } from 'lucide-react'

type StatusIndicatorsProps = {
  isConnected: boolean
  userCount: number
}

export const StatusIndicators = ({ isConnected, userCount }: StatusIndicatorsProps) => (
  <>
    <div className="absolute top-4 right-4 flex items-center gap-2 bg-gray-900/80 backdrop-blur-sm px-3 py-2 rounded-lg z-10 border border-gray-700">
      <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
      <span className="text-sm font-medium text-gray-300">
        {isConnected ? 'Connected' : 'Disconnected'}
      </span>
    </div>

    <div className="absolute top-4 left-4 flex items-center gap-2 bg-gray-900/80 backdrop-blur-sm px-3 py-2 rounded-lg z-10 border border-gray-700">
      <Users size={16} className="text-brackeys-purple-400" />
      <span className="text-sm font-medium text-gray-300">
        {userCount} user{userCount !== 1 ? 's' : ''} online
      </span>
    </div>
  </>
)