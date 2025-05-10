import axios, { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { supabase } from '../../lib/supabase';

/**
 * Custom Axios instance for API requests that automatically includes
 * the Supabase access token in the Authorization header
 */
export const customInstance = async <T>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> => {
  const { data: sessionData } = await supabase.auth.getSession();

  const instance = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || '',
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });

  if (sessionData.session?.access_token) {
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${sessionData.session.access_token}`,
    };
  }

  instance.interceptors.request.use(
    (config) => {
      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  instance.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      if (error.response?.status === 401) {
        console.error('Authentication error: ', error);
      }

      if (error.response && error.response.status >= 500) {
        console.error('Server error: ', error);
      }

      return Promise.reject(error);
    }
  );

  return instance(config);
};
