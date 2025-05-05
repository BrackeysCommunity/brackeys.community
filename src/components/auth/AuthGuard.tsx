import { ReactNode } from 'react';
import { useRouter, useNavigate } from '@tanstack/react-router';
import { useAuth } from '../../context/AuthContext';
import { Loading } from '../ui/Loading';

interface AuthGuardProps {
  children: ReactNode;
}

export const AuthGuard = ({ children }: AuthGuardProps) => {
  const { state: { user, isLoading } } = useAuth();
  const router = useRouter();
  const navigate = useNavigate();

  if (isLoading) {
    return <Loading />;
  }

  if (!user) {
    // Store current location for redirect after login
    const currentPath = router.state.location.pathname;
    navigate({ to: '/login', search: { redirect: currentPath } });
    return null;
  }

  return children;
};