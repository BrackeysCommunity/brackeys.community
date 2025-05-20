import { DiscordLogo } from "../icons/DiscordLogo";

export const Footer = () => (
  <footer className="bg-gray-900 border-t border-gray-800 py-6">
    <div className="container mx-auto px-4 transition-all duration-200">
      <div className="flex flex-col md:flex-row justify-between items-center max-w-7xl mx-auto">
        <div className="mb-4 md:mb-0">
          <p className="text-gray-400 text-sm">
            © {new Date().getFullYear()} Brackeys Community. All rights reserved.
          </p>
        </div>

        <div className="flex space-x-6">
          {/* TODO: put a github link to this repo here eventually */}
          <a
            href="https://discord.com/gg/brackeys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-gray-300 transition-colors"
          >
            <span className="sr-only">Discord</span>
            <DiscordLogo className="h-5 w-5" />
          </a>
        </div>
      </div>
    </div>
  </footer>
);