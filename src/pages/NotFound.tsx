import { motion } from 'motion/react';
import { useAuth } from '../context/useAuth';
import { ShieldQuestion } from 'lucide-react';
import { Button } from '../components/ui/Button';

export const NotFound = () => {
  const {
    state: { user },
  } = useAuth();

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <ShieldQuestion className="mx-auto h-24 w-24 text-brackeys-purple-400" />
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">Page Not Found</h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            The page you're looking for doesn't exist or has been moved.
          </p>
        </motion.div>

        <div className="mt-6 flex flex-col items-center justify-center space-y-4">
          <Button to="/" variant="primary" size="lg">
            Go to Home Page
          </Button>

          {user ? (
            <Button to="/dashboard" variant="secondary" size="lg">
              Go to Dashboard
            </Button>
          ) : (
            <Button to="/login" variant="secondary" size="lg">
              Sign In
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
