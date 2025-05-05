import { ReactNode } from 'react';
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

  if (isLoading) {
    return <Loading />;
  }

  if (!user) {
    navigate({ to: '/login', search: { redirect: pathname } });
    return null;
  }

  return children;
};