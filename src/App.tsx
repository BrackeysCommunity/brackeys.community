import { useState } from 'react';
import { SplashScreen } from './components/ui/SplashScreen';
import { ContextProviders } from './context/ContextProviders';

export const App = () => {
  const [showSplash, setShowSplash] = useState(!localStorage.getItem('splash-screen-complete'));

  const handleSplashComplete = () => {
    localStorage.setItem('splash-screen-complete', 'true');
    setShowSplash(false);
  }

  return showSplash
    ? <SplashScreen onComplete={handleSplashComplete} />
    : <ContextProviders />;
}