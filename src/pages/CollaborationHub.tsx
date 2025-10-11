import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Link } from '@tanstack/react-router';
import {
  Users,
  PlusCircle,
  Bell,
  Bookmark,
  MessageCircle,
  TrendingUp,
  User,
  Settings,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useMyCollaborationProfile } from '../hooks/query/useMyCollaborationProfile';
import { useMyCollaborationPosts } from '../hooks/query/useMyCollaborationPosts';
import { useUser } from '../store';
import {
  CreateProfileModal,
  ProfileFormData,
} from '../components/collaborations/CreateProfileModal';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { X } from 'lucide-react';

export function CollaborationHub() {
  const user = useUser();
  const { profile, loading: profileLoading } = useMyCollaborationProfile();
  const { posts } = useMyCollaborationPosts(profile?.id);
  const [showCreateProfile, setShowCreateProfile] = useState(false);
  const [alertMessage, setAlertMessage] = useState<{
    variant: 'success' | 'error' | 'warning' | 'info';
    message: string;
  } | null>(null);

  useEffect(() => {
    document.title = 'Collaboration Hub - Brackeys Community';
  }, []);

  const handleCreateProfile = async (data: ProfileFormData) => {
    // TODO: Implement API call to create profile
    console.log('Creating profile:', data);
    setAlertMessage({
      variant: 'info',
      message: 'Profile creation is coming soon!',
    });
    setShowCreateProfile(false);
  };

  const stats = [
    {
      label: 'Active Collaborations',
      value: '42',
      icon: Users,
      color: 'text-green-400',
    },
    {
      label: 'Responses Today',
      value: '12',
      icon: MessageCircle,
      color: 'text-blue-400',
    },
    {
      label: 'New Opportunities',
      value: '8',
      icon: TrendingUp,
      color: 'text-purple-400',
    },
  ];

  const quickActions = [
    {
      title: 'Browse Collaborations',
      description: 'Find your next project or team member',
      icon: Users,
      href: '/collaborations',
      color: 'from-blue-600 to-blue-800',
    },
    {
      title: 'Post a Collaboration',
      description: 'Share your project or opportunity',
      icon: PlusCircle,
      href: '#',
      onClick: () =>
        setAlertMessage({
          variant: 'info',
          message: 'Post creation coming soon!',
        }),
      color: 'from-green-600 to-green-800',
    },
    {
      title: 'My Bookmarks',
      description: 'View your saved collaborations',
      icon: Bookmark,
      href: '#',
      onClick: () =>
        setAlertMessage({
          variant: 'info',
          message: 'Bookmarks feature coming soon!',
        }),
      color: 'from-yellow-600 to-yellow-800',
    },
    {
      title: 'Alerts & Notifications',
      description: 'Manage your collaboration alerts',
      icon: Bell,
      href: '#',
      onClick: () =>
        setAlertMessage({
          variant: 'info',
          message: 'Alerts feature coming soon!',
        }),
      color: 'from-purple-600 to-purple-800',
    },
  ];

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <h1 className="text-4xl font-bold text-white mb-6">
            Collaboration Hub
          </h1>
          <p className="text-lg text-gray-300 mb-8 max-w-2xl mx-auto">
            Join our community of developers, artists, and creators. Find your
            next team or project.
          </p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-6 py-3 bg-brackeys-purple-600 hover:bg-brackeys-purple-700 text-white rounded-lg font-medium transition-colors"
          >
            Sign in to get started
          </Link>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-8"
      >
        <h1 className="text-4xl font-bold text-white mb-4">
          Collaboration Hub
        </h1>
        <p className="text-lg text-gray-300">
          Welcome back! Here's what's happening in the collaboration community.
        </p>
      </motion.div>

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

      {/* Profile Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-gray-800 rounded-lg p-6 mb-8"
      >
        {profileLoading ? (
          <div className="animate-pulse">
            <div className="h-6 w-48 bg-gray-700 rounded mb-4" />
            <div className="h-4 w-64 bg-gray-700 rounded" />
          </div>
        ) : profile ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-gray-700 flex items-center justify-center">
                <User className="h-8 w-8 text-gray-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">
                  {profile.displayName}
                </h2>
                <p className="text-gray-400">
                  {posts?.length || 0} active posts
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowCreateProfile(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              <Settings className="h-4 w-4" />
              Edit Profile
            </button>
          </div>
        ) : (
          <div className="text-center py-8">
            <User className="h-16 w-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">
              Create Your Collaboration Profile
            </h3>
            <p className="text-gray-400 mb-6 max-w-md mx-auto">
              Set up your profile to start collaborating with other community
              members.
            </p>
            <Button
              onClick={() => setShowCreateProfile(true)}
              variant="primary"
            >
              Create Profile
            </Button>
          </div>
        )}
      </motion.div>

      {/* Stats Grid */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8"
      >
        {stats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 + index * 0.1 }}
            className="bg-gray-800 rounded-lg p-6 border border-gray-700"
          >
            <div className="flex items-center justify-between mb-2">
              <stat.icon className={cn('h-8 w-8', stat.color)} />
              <span className="text-2xl font-bold text-white">
                {stat.value}
              </span>
            </div>
            <p className="text-gray-400 text-sm">{stat.label}</p>
          </motion.div>
        ))}
      </motion.div>

      {/* Quick Actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <h2 className="text-2xl font-semibold text-white mb-6">
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {quickActions.map((action, index) => (
            <motion.div
              key={action.title}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 + index * 0.1 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {action.onClick ? (
                <button
                  onClick={action.onClick}
                  className="w-full text-left group relative overflow-hidden rounded-lg border border-gray-700 hover:border-gray-600 transition-all"
                >
                  <div
                    className={cn(
                      'absolute inset-0 opacity-10',
                      `bg-gradient-to-br ${action.color}`,
                    )}
                  />
                  <div className="relative p-6">
                    <action.icon className="h-10 w-10 text-white mb-3" />
                    <h3 className="text-lg font-semibold text-white mb-1">
                      {action.title}
                    </h3>
                    <p className="text-gray-400 text-sm">
                      {action.description}
                    </p>
                  </div>
                </button>
              ) : (
                <Link
                  to={action.href}
                  className="block group relative overflow-hidden rounded-lg border border-gray-700 hover:border-gray-600 transition-all"
                >
                  <div
                    className={cn(
                      'absolute inset-0 opacity-10',
                      `bg-gradient-to-br ${action.color}`,
                    )}
                  />
                  <div className="relative p-6">
                    <action.icon className="h-10 w-10 text-white mb-3" />
                    <h3 className="text-lg font-semibold text-white mb-1">
                      {action.title}
                    </h3>
                    <p className="text-gray-400 text-sm">
                      {action.description}
                    </p>
                  </div>
                </Link>
              )}
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Create/Edit Profile Modal */}
      <CreateProfileModal
        isOpen={showCreateProfile}
        onClose={() => setShowCreateProfile(false)}
        onSubmit={handleCreateProfile}
        initialData={
          profile
            ? {
                displayName: profile.displayName || '',
                bio: profile.bio || '',
                skills: profile.skills || '',
                portfolio: profile.portfolio || '',
                contactPreferences: profile.contactPreferences || '',
                isPublic: profile.isPublic === 1,
              }
            : undefined
        }
      />
    </div>
  );
}
