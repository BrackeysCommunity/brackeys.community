import { Dialog } from '@headlessui/react';
import { AlertCircle, Globe, Lock, Send, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useId, useState } from 'react';
import { cn } from '../../lib/utils';

type PostForResponse = {
  hiringStatusId: number;
  collaborationType?: {
    name: string;
  } | null;
  collaborationProfile?: {
    displayName?: string | null;
  } | null;
  hiringStatus?: {
    name: string;
  } | null;
};

type ResponseModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (response: ResponseFormData) => void;
  post: PostForResponse;
  isLoading?: boolean;
};

export type ResponseFormData = {
  message: string;
  contactInfo: string;
  isPublic: boolean;
};

export const ResponseModal = ({
  isOpen,
  onClose,
  onSubmit,
  post,
  isLoading,
}: ResponseModalProps) => {
  const formId = useId();
  const [formData, setFormData] = useState<ResponseFormData>({
    message: '',
    contactInfo: '',
    isPublic: false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const isLooking = post.hiringStatusId === 1;
  const postType = post.collaborationType?.name || 'collaboration';

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
                    Respond to {postType}
                  </Dialog.Title>
                  <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="p-6">
                  {/* Post Summary */}
                  <div className="bg-gray-900/50 rounded-lg p-4 mb-6">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm text-gray-400">
                        Responding to:
                      </span>
                      <span className="text-sm font-medium text-white">
                        {post.collaborationProfile?.displayName}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="px-2 py-1 bg-gray-700 rounded text-xs text-gray-300">
                        {post.collaborationType?.name}
                      </span>
                      <span className="px-2 py-1 bg-gray-700 rounded text-xs text-gray-300">
                        {post.hiringStatus?.name}
                      </span>
                    </div>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Message */}
                    <div>
                      <label
                        htmlFor={`${formId}-message`}
                        className="block text-sm font-medium text-gray-300 mb-2"
                      >
                        <Send className="inline h-4 w-4 mr-2" />
                        Your Message
                      </label>
                      <textarea
                        id={`${formId}-message`}
                        value={formData.message}
                        onChange={(e) =>
                          setFormData({ ...formData, message: e.target.value })
                        }
                        rows={6}
                        className={cn(
                          'w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg',
                          'text-white placeholder-gray-500',
                          'focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500 focus:border-transparent',
                          'transition-colors resize-none',
                        )}
                        placeholder={
                          isLooking
                            ? 'Introduce yourself and explain how you can help...'
                            : 'Express your interest and what you bring to the table...'
                        }
                        required
                      />
                    </div>

                    {/* Contact Info */}
                    <div>
                      <label
                        htmlFor={`${formId}-contactInfo`}
                        className="block text-sm font-medium text-gray-300 mb-2"
                      >
                        Contact Information
                      </label>
                      <input
                        id={`${formId}-contactInfo`}
                        type="text"
                        value={formData.contactInfo}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            contactInfo: e.target.value,
                          })
                        }
                        className={cn(
                          'w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg',
                          'text-white placeholder-gray-500',
                          'focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500 focus:border-transparent',
                          'transition-colors',
                        )}
                        placeholder="Discord username, email, or other contact method"
                        required
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        This will only be visible to the post author unless you
                        make your response public
                      </p>
                    </div>

                    {/* Privacy Toggle */}
                    <div className="bg-gray-900/50 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setFormData({
                              ...formData,
                              isPublic: !formData.isPublic,
                            })
                          }
                          className={cn(
                            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors mt-1',
                            formData.isPublic
                              ? 'bg-brackeys-purple-600'
                              : 'bg-gray-700',
                          )}
                        >
                          <span
                            className={cn(
                              'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                              formData.isPublic
                                ? 'translate-x-6'
                                : 'translate-x-1',
                            )}
                          />
                        </button>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {formData.isPublic ? (
                              <>
                                <Globe className="h-4 w-4 text-green-400" />
                                <span className="text-sm font-medium text-white">
                                  Public Response
                                </span>
                              </>
                            ) : (
                              <>
                                <Lock className="h-4 w-4 text-yellow-400" />
                                <span className="text-sm font-medium text-white">
                                  Private Response
                                </span>
                              </>
                            )}
                          </div>
                          <p className="text-xs text-gray-400">
                            {formData.isPublic
                              ? 'Your response and contact info will be visible to everyone'
                              : 'Only the post author will see your response and contact info'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Warning */}
                    <div className="flex items-start gap-2 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
                      <AlertCircle className="h-4 w-4 text-yellow-400 mt-0.5" />
                      <p className="text-xs text-yellow-200">
                        Please be respectful and professional in your response.
                        Inappropriate messages may result in restrictions on
                        your collaboration privileges.
                      </p>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3">
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
                          'flex items-center justify-center gap-2',
                        )}
                        disabled={isLoading}
                      >
                        <Send className="h-4 w-4" />
                        {isLoading ? 'Sending...' : 'Send Response'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </Dialog.Panel>
          </div>
        </Dialog>
      )}
    </AnimatePresence>
  );
};
