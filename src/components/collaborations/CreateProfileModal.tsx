import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Dialog } from '@headlessui/react';
import { X, User, FileText, Briefcase, Mail } from 'lucide-react';
import { cn } from '../../lib/utils';

type CreateProfileModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (profile: ProfileFormData) => void;
  initialData?: ProfileFormData;
  isLoading?: boolean;
};

export type ProfileFormData = {
  displayName: string;
  bio: string;
  skills: string;
  portfolio: string;
  contactPreferences: string;
  isPublic: boolean;
};

export const CreateProfileModal = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  isLoading,
}: CreateProfileModalProps) => {
  const [formData, setFormData] = useState<ProfileFormData>(
    initialData || {
      displayName: '',
      bio: '',
      skills: '',
      portfolio: '',
      contactPreferences: '',
      isPublic: true,
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const isEdit = !!initialData;

  return (
    <AnimatePresence>
      {isOpen && (
        <Dialog
          static
          as={motion.div}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          open={isOpen}
          onClose={onClose}
          className="relative z-50"
        >
          <div className="fixed inset-0 bg-black/75" aria-hidden="true" />

          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel
              as={motion.div}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="mx-auto max-w-2xl w-full rounded-xl bg-gray-800 shadow-xl overflow-hidden"
            >
              <div className="relative">
                <div className="bg-gradient-to-r from-brackeys-purple-600 to-brackeys-purple-800 px-6 py-4">
                  <Dialog.Title className="text-xl font-semibold text-white">
                    {isEdit
                      ? 'Edit Collaboration Profile'
                      : 'Create Collaboration Profile'}
                  </Dialog.Title>
                  <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                  {/* Display Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      <User className="inline h-4 w-4 mr-2" />
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={formData.displayName}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          displayName: e.target.value,
                        })
                      }
                      className={cn(
                        'w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg',
                        'text-white placeholder-gray-500',
                        'focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500 focus:border-transparent',
                        'transition-colors',
                      )}
                      placeholder="Your professional name"
                      required
                    />
                  </div>

                  {/* Bio */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      <FileText className="inline h-4 w-4 mr-2" />
                      Bio
                    </label>
                    <textarea
                      value={formData.bio}
                      onChange={(e) =>
                        setFormData({ ...formData, bio: e.target.value })
                      }
                      rows={4}
                      className={cn(
                        'w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg',
                        'text-white placeholder-gray-500',
                        'focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500 focus:border-transparent',
                        'transition-colors resize-none',
                      )}
                      placeholder="Tell others about yourself..."
                    />
                  </div>

                  {/* Skills */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      <Briefcase className="inline h-4 w-4 mr-2" />
                      Skills
                    </label>
                    <textarea
                      value={formData.skills}
                      onChange={(e) =>
                        setFormData({ ...formData, skills: e.target.value })
                      }
                      rows={3}
                      className={cn(
                        'w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg',
                        'text-white placeholder-gray-500',
                        'focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500 focus:border-transparent',
                        'transition-colors resize-none',
                      )}
                      placeholder="List your skills (e.g., Unity, C#, Game Design, 3D Modeling)"
                    />
                  </div>

                  {/* Portfolio */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Portfolio Links
                    </label>
                    <textarea
                      value={formData.portfolio}
                      onChange={(e) =>
                        setFormData({ ...formData, portfolio: e.target.value })
                      }
                      rows={2}
                      className={cn(
                        'w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg',
                        'text-white placeholder-gray-500',
                        'focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500 focus:border-transparent',
                        'transition-colors resize-none',
                      )}
                      placeholder="Links to your work (GitHub, portfolio site, etc.)"
                    />
                  </div>

                  {/* Contact Preferences */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      <Mail className="inline h-4 w-4 mr-2" />
                      Contact Preferences
                    </label>
                    <textarea
                      value={formData.contactPreferences}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          contactPreferences: e.target.value,
                        })
                      }
                      rows={2}
                      className={cn(
                        'w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg',
                        'text-white placeholder-gray-500',
                        'focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500 focus:border-transparent',
                        'transition-colors resize-none',
                      )}
                      placeholder="How should people contact you? (Discord, email, etc.)"
                    />
                  </div>

                  {/* Public Profile Toggle */}
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-300">
                      Make profile public
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          isPublic: !formData.isPublic,
                        })
                      }
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                        formData.isPublic
                          ? 'bg-brackeys-purple-600'
                          : 'bg-gray-700',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                          formData.isPublic ? 'translate-x-6' : 'translate-x-1',
                        )}
                      />
                    </button>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={onClose}
                      className={cn(
                        'flex-1 px-4 py-2 rounded-lg font-medium',
                        'bg-gray-700 text-gray-300 hover:bg-gray-600',
                        'transition-colors',
                      )}
                      disabled={isLoading}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className={cn(
                        'flex-1 px-4 py-2 rounded-lg font-medium',
                        'bg-brackeys-purple-600 text-white hover:bg-brackeys-purple-700',
                        'transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                      )}
                      disabled={isLoading}
                    >
                      {isLoading
                        ? 'Saving...'
                        : isEdit
                          ? 'Update Profile'
                          : 'Create Profile'}
                    </button>
                  </div>
                </form>
              </div>
            </Dialog.Panel>
          </div>
        </Dialog>
      )}
    </AnimatePresence>
  );
};
