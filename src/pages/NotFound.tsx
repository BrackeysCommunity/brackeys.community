import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ShieldQuestion } from 'lucide-react';

export const NotFound = () => {
  const { state: { user } } = useAuth();

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <ShieldQuestion className="mx-auto h-24 w-24 text-brackeys-purple-400" />
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            Page Not Found
          </h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            The page you're looking for doesn't exist or has been moved.
          </p>
        </motion.div>

        <div className="mt-6 flex flex-col items-center justify-center space-y-4">
          <Link
            to="/"
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-xs text-white bg-brackeys-purple-600 hover:bg-brackeys-purple-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-brackeys-purple-500"
          >
            Go to Home Page
          </Link>

          {user ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center px-6 py-3 border border-gray-600 text-base font-medium rounded-md shadow-xs text-gray-300 bg-gray-800 hover:bg-gray-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-indigo-500"
            >
              Go to Dashboard
            </Link>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center px-6 py-3 border border-gray-600 text-base font-medium rounded-md shadow-xs text-gray-300 bg-gray-800 hover:bg-gray-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-indigo-500"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};