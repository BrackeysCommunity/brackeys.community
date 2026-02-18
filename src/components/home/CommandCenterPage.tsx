import {
  AlertCircleIcon,
  ChampionIcon,
  CheckListIcon,
  Copy01Icon,
  MusicNote01Icon,
  SecurityIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Button } from '@/components/ui/button';

const commands = [
  {
    id: 'brackeys-help',
    cmd: '/brackeys help',
    category: 'General',
    description:
      'Displays the master list of all available server commands, roles, and current server status. Use this if you are lost.',
    usage: '/brackeys help [category]',
  },
  {
    id: 'jam-timer',
    cmd: '/jam timer',
    category: 'Event',
    description:
      'Displays the exact countdown to the next Brackeys Game Jam submission deadline. Syncs with UTC.',
  },
  {
    id: 'team-create',
    cmd: '/team create',
    category: 'Collab',
    description:
      'Initializes a private voice and text channel for your jam team. Requires at least 2 members mentioned.',
    params: '[team_name] @member1 @member2',
  },
  {
    id: 'profile-link',
    cmd: '/profile link',
    category: 'Utility',
    description:
      'Generates a temporary link to connect your Discord account with your web portfolio.',
  },
];

const categories = [
  { id: 'moderation', title: 'MODERATION', icon: SecurityIcon, desc: 'See how to report bugs, users, or spam. Keep the arcade clean.' },
  { id: 'music-bot', title: 'MUSIC BOT', icon: MusicNote01Icon, desc: 'Control the lobby vibes. DJ commands and playlist management.' },
  { id: 'xp-system', title: 'XP SYSTEM', icon: ChampionIcon, desc: 'Learn how to earn XP, level up your card, and unlock roles.' },
];

export function CommandCenterPage() {
  return (
    <div className="bg-background text-foreground min-h-[calc(100vh-57px)] flex flex-col relative selection:bg-primary selection:text-white">
      {/* Background Grid */}
      <div
        className="fixed inset-0 z-0 pointer-events-none opacity-5"
        style={{
          backgroundImage:
            'linear-gradient(#6B6B6B 1px, transparent 1px), linear-gradient(90deg, #6B6B6B 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* CRT Scanline Overlay */}
      <div
        className="fixed inset-0 z-55 pointer-events-none opacity-10"
        style={{
          background:
            'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.2))',
          backgroundSize: '100% 4px',
        }}
      />

      <div className="relative z-10 flex flex-col flex-1">
        <main className="flex-1 flex flex-col p-4 md:p-8 max-w-5xl mx-auto w-full gap-8">
          {/* Page Header */}
          <section className="flex flex-col gap-2 mt-4">
            <div className="flex items-center gap-3 text-primary mb-1">
              <HugeiconsIcon icon={CheckListIcon} size={20} className="animate-pulse" />
              <span className="font-mono text-sm tracking-widest uppercase">
                {'System Online // Database Connected'}
              </span>
            </div>
            <h1 className="text-foreground font-sans font-bold text-4xl md:text-6xl lg:text-7xl uppercase leading-[0.9] tracking-tighter">
              Bot_Documentation<span className="text-primary">_V.1.0</span>
            </h1>
            <p className="text-muted-foreground font-mono max-w-2xl mt-2 text-sm md:text-base border-l-2 border-muted pl-4">
              {'// ACCESS LEVEL: UNRESTRICTED'} <br />
              {'// USE SEARCH TO FILTER COMMAND PROTOCOLS.'}
            </p>
          </section>

          {/* Terminal Interface */}
          <div className="flex flex-col shadow-[4px_4px_0px_var(--color-primary)] border-2 border-primary bg-[#0a0a0a]">
            <div className="bg-primary text-black px-4 py-1 flex justify-between items-center font-mono text-xs font-bold select-none">
              <span>ROOT@BRACKEYS-SERVER:~</span>
              <span>BASH_V3.2</span>
            </div>

            <div className="p-6 border-b border-muted/30 bg-[#121212]">
              <div className="relative flex items-center w-full">
                <span className="text-primary font-mono text-xl mr-3 font-bold">&gt;</span>
                <input
                  autoComplete="off"
                  className="w-full bg-transparent border-none focus:ring-0 p-0 text-xl font-mono text-cyan-400 placeholder-muted/50 caret-transparent uppercase"
                  placeholder="TYPE COMMAND SEARCH..."
                  spellCheck="false"
                  type="text"
                />
                <div className="absolute right-0 top-1/2 -translate-y-1/2 hidden md:flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground bg-card px-2 py-1 border border-muted">
                    ESC to clear
                  </span>
                </div>
                <span className="absolute left-[240px] top-1/2 -translate-y-1/2 w-3 h-6 bg-primary animate-[blink_1s_step-end_infinite] hidden md:block" />
              </div>
            </div>

            <div className="flex flex-col max-h-[500px] overflow-y-auto divide-y divide-muted/20">
              {commands.map((cmd) => (
                <div
                  key={cmd.id}
                  className="group flex flex-col md:flex-row md:items-start justify-between p-6 hover:bg-card/50 transition-colors gap-4"
                >
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <code className="text-cyan-400 font-mono text-lg font-bold bg-cyan-950/30 px-2 py-0.5 border border-cyan-400/30">
                        {cmd.cmd}
                      </code>
                      <span className="text-xs font-mono text-muted-foreground border border-muted px-1.5 py-0.5 uppercase">
                        {cmd.category}
                      </span>
                    </div>
                    <p className="text-[#cccccc] text-sm md:text-base leading-relaxed font-sans max-w-2xl">
                      {cmd.description}
                    </p>
                    {cmd.usage && (
                      <div className="text-xs font-mono text-muted-foreground mt-2">
                        <span className="text-primary">USAGE:</span> {cmd.usage}
                      </div>
                    )}
                    {cmd.params && (
                      <div className="text-xs font-mono text-muted-foreground mt-2">
                        <span className="text-primary">PARAMS:</span> {cmd.params}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    isMagnetic
                    className="flex items-center gap-2 px-3 py-2 bg-black border border-muted hover:border-primary text-muted-foreground hover:text-white transition-all group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 group-hover:shadow-[2px_2px_0px_var(--color-primary)] active:translate-x-0 active:translate-y-0 active:shadow-none self-start md:self-center shrink-0 relative z-10"
                  >
                    <HugeiconsIcon icon={Copy01Icon} size={16} />
                    <span className="font-mono text-xs font-bold uppercase">Copy</span>
                  </Button>
                </div>
              ))}

              <div className="p-6 bg-[#1a0a0a] border-l-4 border-destructive/50 flex items-start gap-4">
                <HugeiconsIcon icon={AlertCircleIcon} size={20} className="text-destructive mt-0.5 shrink-0" />
                <div>
                  <h4 className="text-destructive font-mono font-bold uppercase mb-1">System Error: 404</h4>
                  <p className="text-muted-foreground font-mono text-sm">
                    COMMAND "sudo hack mainframe" NOT RECOGNIZED. ACCESS DENIED.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-[#0a0a0a] border-t border-muted/20 p-2 flex justify-end">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest animate-pulse">
                Awaiting Input...
              </span>
            </div>
          </div>

          {/* Category Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
            {categories.map((box) => (
              <div
                key={box.id}
                className="bg-card border-2 border-muted p-4 hover:border-cyan-400 group transition-colors relative z-10"
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-sans font-bold text-foreground text-lg">{box.title}</h3>
                  <HugeiconsIcon icon={box.icon} size={20} className="text-muted-foreground group-hover:text-cyan-400" />
                </div>
                <p className="text-sm text-muted-foreground font-sans">{box.desc}</p>
                <a
                  className="inline-block mt-4 text-xs font-mono font-bold text-primary hover:text-foreground hover:underline uppercase"
                  href={`/docs/${box.id}`}
                >
                  View Docs &gt;&gt;
                </a>
              </div>
            ))}
          </div>
        </main>

        <footer className="mt-auto border-t border-muted/30 py-6 text-center">
          <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
            {'Brackeys Community © 2024 // Built for Game Devs'}
          </p>
        </footer>
      </div>
    </div>
  );
}
