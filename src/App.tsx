import { useState } from 'react';
import { SplashScreen } from './components/ui/SplashScreen';
import { ContextProviders } from './context/ContextProviders';

export const App = () => {
  const [showSplash, setShowSplash] = useState(true);

  return showSplash
    ? <SplashScreen onComplete={() => setShowSplash(false)} />
    : <ContextProviders />;
}