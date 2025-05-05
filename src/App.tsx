import { useState } from 'react';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import { SplashScreen } from './components/SplashScreen';
import { AuthProvider } from './context/AuthProvider';

function App() {
  const [showSplash, setShowSplash] = useState(true);

  const handleSplashComplete = () => {
    setShowSplash(false);
  };

  return (
    <>
      {showSplash && <SplashScreen onComplete={handleSplashComplete} />}
      {!showSplash && (
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      )}
    </>
  );
}

export default App;