import { ExternalLink } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useState, useEffect, useRef } from "react";
import { DiscordLogo } from "../icons/DiscordLogo";

export const DiscordProfileButton = () => {
  const { state: { user } } = useAuth();
  const [buttonClicked, setButtonClicked] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const timerRef = useRef<number | null>(null);
  const buttonRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const handleBlur = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    if (buttonClicked) {
      timerRef.current = window.setTimeout(() => {
        buttonRef.current?.blur();
        setShowFallback(true);
      }, 1500);

      window.addEventListener('blur', handleBlur);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      window.removeEventListener('blur', handleBlur);
    };
  }, [buttonClicked]);

  return (
    <a
      ref={buttonRef}
      role="button"
      aria-label="View on Discord"
      href={`${showFallback ? "https://discord.com" : "discords://"}/users/${user?.discord_id}`}
      onClick={() => {
        setButtonClicked(true);
      }}
      className="inline-flex items-center px-4 py-2 border border-gray-600 rounded-md shadow-xs text-sm font-medium text-gray-300 bg-gray-700 hover:bg-gray-600 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-brackeys-purple-500"
      {...(showFallback && { target: "_blank", rel: "noopener noreferrer" })}
    >
      {showFallback
        ? <ExternalLink className="mr-2 h-4 w-4" />
        : <DiscordLogo className="mr-2 h-4 w-4" />}
      {showFallback ? "Didn't launch? Open in a new tab." : 'View on Discord'}
    </a>
  );
};