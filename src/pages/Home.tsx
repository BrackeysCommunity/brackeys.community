import { HeroSection } from '../components/home/HeroSection';
import { useLayoutProps } from '../context/LayoutProvider';

const HomeContainer = () => {
  useLayoutProps({
    fullHeight: true,
    mainClassName: '',
    containerized: false,
  });

  return <HomeView />;
};

const HomeView = () => <HeroSection />;

export const Home = HomeContainer;
