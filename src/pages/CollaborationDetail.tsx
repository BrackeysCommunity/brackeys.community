import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, Eye, MessageCircle, Flag, Send, X } from 'lucide-react';
import { useCollaborationPost } from '../hooks/query/useCollaborationPost';
import { useUser } from '../store';
import {
  ResponseModal,
  ResponseFormData,
} from '../components/collaborations/ResponseModal';
import { Alert } from '../components/ui/Alert';

export function CollaborationDetail() {
  const { postId } = useParams({ from: '/collaborations/$postId' });
  const navigate = useNavigate();
  const user = useUser();

  const { post, loading: isLoading, error } = useCollaborationPost(postId);
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [alertMessage, setAlertMessage] = useState<{
    variant: 'success' | 'error' | 'warning' | 'info';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (post) {
      document.title = `${post.collaborationProfile?.displayName || 'Collaboration'} - Brackeys Community`;
    }
  }, [post]);

  const handleResponse = async (data: ResponseFormData) => {
    // TODO: Implement API call to submit response
    console.log('Submitting response:', data);
    setAlertMessage({
      variant: 'info',
      message: 'Response submission is coming soon!',
    });
    setShowResponseModal(false);
  };

  const handleReport = () => {
    setAlertMessage({
      variant: 'warning',
      message: 'Reporting feature coming soon!',
    });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 w-24 bg-gray-700 rounded mb-6" />
            <div className="bg-gray-800/50 rounded-lg p-8">
              <div className="h-6 w-48 bg-gray-700 rounded mb-4" />
              <div className="h-4 w-32 bg-gray-700 rounded mb-6" />
              <div className="space-y-3">
                <div className="h-4 w-full bg-gray-700 rounded" />
                <div className="h-4 w-3/4 bg-gray-700 rounded" />
                <div className="h-4 w-5/6 bg-gray-700 rounded" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-2xl font-bold text-white mb-4">
            Collaboration not found
          </h1>
          <p className="text-gray-400 mb-8">
            This collaboration post doesn't exist or has been removed.
          </p>
          <button
            onClick={() => navigate({ to: '/collaborations' })}
            className="text-green-400 hover:text-green-300 font-medium"
          >
            ← Back to collaborations
          </button>
        </div>
      </div>
    );
  }

  const typeColorMap: Record<number, string> = {
    1: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    2: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    3: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    4: 'bg-green-500/20 text-green-400 border-green-500/30',
  };

  const statusColorMap: Record<number, string> = {
    1: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    2: 'bg-green-500/20 text-green-400 border-green-500/30',
    3: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    4: 'bg-red-500/20 text-red-400 border-red-500/30',
    5: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  };

  const typeColor =
    typeColorMap[post.collaborationTypeId] || 'bg-gray-500/20 text-gray-400';
  const statusColor =
    statusColorMap[post.statusId] || 'bg-gray-500/20 text-gray-400';
  const tags = post.tags ? JSON.parse(post.tags) : [];

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Back Button */}
        <motion.button
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={() => navigate({ to: '/collaborations' })}
          className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft size={20} />
          Back to collaborations
        </motion.button>

        {/* Alert Messages */}
        {alertMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 relative"
          >
            <Alert variant={alertMessage.variant}>{alertMessage.message}</Alert>
            <button
              onClick={() => setAlertMessage(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}

        {/* Main Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-8 border border-gray-700"
        >
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <span
                className={`px-3 py-1 rounded-md text-sm font-medium border ${typeColor}`}
              >
                {post.collaborationType?.name}
              </span>
              <span
                className={`px-3 py-1 rounded-md text-sm font-medium border ${statusColor}`}
              >
                {post.collaborationStatus?.name}
              </span>
              <span className="text-sm text-gray-400">
                {post.hiringStatus?.name}
              </span>
            </div>

            <h1 className="text-2xl font-bold text-white mb-2">
              {post.collaborationProfile?.displayName}
            </h1>

            <div className="flex items-center gap-6 text-sm text-gray-400">
              <span className="flex items-center gap-1">
                <Eye size={16} />
                {post.viewCount} views
              </span>
              <span className="flex items-center gap-1">
                <MessageCircle size={16} />
                {post.responseCount} responses
              </span>
              {post.postedAt && (
                <span>
                  Posted{' '}
                  {formatDistanceToNow(new Date(post.postedAt), {
                    addSuffix: true,
                  })}
                </span>
              )}
            </div>
          </div>

          {/* Profile Info */}
          {post.collaborationProfile && (
            <div className="mb-8 p-6 bg-gray-900/50 rounded-lg">
              <h2 className="text-lg font-semibold text-white mb-4">About</h2>

              {post.collaborationProfile.bio && (
                <p className="text-gray-300 mb-4 whitespace-pre-wrap">
                  {post.collaborationProfile.bio}
                </p>
              )}

              <div className="grid md:grid-cols-2 gap-4">
                {post.collaborationProfile.skills && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-2">
                      Skills
                    </h3>
                    <p className="text-gray-200">
                      {post.collaborationProfile.skills}
                    </p>
                  </div>
                )}

                {post.collaborationProfile.portfolio && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-400 mb-2">
                      Portfolio
                    </h3>
                    <p className="text-gray-200">
                      {post.collaborationProfile.portfolio}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Field Values */}
          {post.collaborationFieldValues &&
            post.collaborationFieldValues.length > 0 && (
              <div className="mb-8">
                <h2 className="text-lg font-semibold text-white mb-4">
                  Details
                </h2>
                <div className="space-y-4">
                  {post.collaborationFieldValues.map((field) => (
                    <div key={field.id}>
                      <h3 className="text-sm font-medium text-gray-400 mb-1">
                        {field.collaborationFieldDefinition?.displayName}
                      </h3>
                      <p className="text-gray-200 whitespace-pre-wrap">
                        {field.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Tags */}
          {tags.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-white mb-4">Tags</h2>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag: string, index: number) => (
                  <span
                    key={index}
                    className="px-3 py-1 bg-gray-700/50 text-gray-300 rounded-md text-sm"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Responses Section */}
          <div className="border-t border-gray-700 pt-8">
            <h2 className="text-lg font-semibold text-white mb-4">
              Responses ({post.collaborationResponses?.length || 0})
            </h2>

            {post.collaborationResponses &&
            post.collaborationResponses.length > 0 ? (
              <div className="space-y-4">
                {post.collaborationResponses.map((response) => (
                  <motion.div
                    key={response.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-gray-900/50 rounded-lg"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-medium text-white">
                        {response.collaborationProfile?.displayName ||
                          'Anonymous'}
                      </h3>
                      <span className="text-xs text-gray-500">
                        {formatDistanceToNow(new Date(response.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                    <p className="text-gray-300 whitespace-pre-wrap">
                      {response.message}
                    </p>
                    {response.contactInfo && response.isPublic && (
                      <p className="mt-2 text-sm text-gray-400">
                        Contact: {response.contactInfo}
                      </p>
                    )}
                  </motion.div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">
                No responses yet. Be the first to respond!
              </p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="mt-8 flex justify-center gap-4">
            {user ? (
              <>
                <button
                  onClick={() => setShowResponseModal(true)}
                  className="flex items-center gap-2 px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-lg transition-colors"
                >
                  <Send className="h-4 w-4" />
                  Respond to Collaboration
                </button>
                <button
                  onClick={handleReport}
                  className="flex items-center gap-2 px-4 py-3 bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium rounded-lg transition-colors"
                >
                  <Flag className="h-4 w-4" />
                  Report
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="flex items-center gap-2 px-6 py-3 bg-brackeys-purple-600 hover:bg-brackeys-purple-700 text-white font-medium rounded-lg transition-colors"
              >
                Sign in to respond
              </Link>
            )}
          </div>
        </motion.div>
      </div>

      {/* Response Modal */}
      {post && (
        <ResponseModal
          isOpen={showResponseModal}
          onClose={() => setShowResponseModal(false)}
          onSubmit={handleResponse}
          post={post}
        />
      )}
    </div>
  );
}
