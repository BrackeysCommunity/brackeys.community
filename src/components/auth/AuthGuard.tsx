import { ReactNode, useEffect } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useAuth } from '../../context/useAuth';
import { Loading } from '../ui/Loading';

interface AuthGuardProps {
  children: ReactNode;
}

export const AuthGuard = ({ children }: AuthGuardProps) => {
  const { state: { user, isLoading } } = useAuth();
  const { location: { pathname } } = useRouterState();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !user) {
      navigate({ to: '/login', search: { redirect: pathname }, resetScroll: true });
    }
  }, [user, isLoading, navigate, pathname]);

  if (isLoading) {
    return <Loading />;
  }

  if (!user) {
    return null;
  }

  return children;
};