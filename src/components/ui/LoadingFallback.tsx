type LoadingFallbackProps = {
  message?: string;
  className?: string;
};

export const LoadingFallback = ({
  message = 'Loading...',
  className = '',
}: LoadingFallbackProps) => (
  <div className={`flex min-h-[60vh] items-center justify-center ${className}`}>
    <div className="text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brackeys-purple-600 mx-auto mb-4" />
      <p className="text-gray-400">{message}</p>
    </div>
  </div>
);

type InlineLoadingProps = {
  className?: string;
};

export const InlineLoading = ({ className = '' }: InlineLoadingProps) => (
  <div className={`flex justify-center py-12 ${className}`}>
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brackeys-purple-600" />
  </div>
);

type MinimalLoadingProps = {
  className?: string;
};

export const MinimalLoading = ({ className = '' }: MinimalLoadingProps) => (
  <div className={`w-full py-20 flex justify-center ${className}`}>
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brackeys-purple-600" />
  </div>
);
