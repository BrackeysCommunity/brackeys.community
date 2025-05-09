import { useState } from 'react';
import { SplashScreen } from './components/ui/SplashScreen';
import { ContextProviders } from './context/ContextProviders';

export const App = () => {
  const [showSplash, setShowSplash] = useState(!localStorage.getItem('splash-screen-complete'));

  return showSplash
    ? <SplashScreen onComplete={() => setShowSplash(false)} />
    : <ContextProviders />;
}