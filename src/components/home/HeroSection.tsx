import { Link } from '@tanstack/react-router';
import { Users, Terminal, Badge } from 'lucide-react';

const NAV_ITEMS = [
  { id: '01', label: 'COLLAB\nBOARD', icon: Users, to: '#' },
  { id: '02', label: 'COMMAND\nCENTER', icon: Terminal, to: '#' },
  { id: '03', label: 'DEV\nPROFILE', icon: Badge, to: '#' },
];

export function HeroSection() {
  return (
    <div className="flex w-full flex-col justify-between p-6 lg:w-3/5 lg:p-12 xl:p-16">
      <div className="mb-4 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        <span className="text-primary">&gt;</span> SYSTEM READY
        <span className="mx-2 text-primary">//</span> v2.0.4 
        <span className="mx-2 text-primary">//</span> WELCOME USER
      </div>

      <div className="flex flex-col justify-center">
        <h1 className="font-display text-[15vw] font-bold leading-[0.85] tracking-tighter text-foreground lg:text-[9rem] xl:text-[11rem]">
          MAKE.<br/>
          <span className="text-transparent border-primary [-webkit-text-stroke:1px_var(--color-primary)] hover:text-primary transition-colors duration-300 cursor-default">GAMES.</span>
        </h1>
        <p className="mt-8 max-w-xl font-sans text-lg text-muted-foreground lg:text-xl">
          The central neural network for the Brackeys Game Dev community. 
          Find your squad, access the knowledge base, and deploy your build.
        </p>
      </div>

      <nav className="mt-12 flex flex-col gap-4 sm:flex-row sm:items-end">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.id}
            to={item.to}
            data-magnetic
            className="group relative flex h-24 w-full min-w-[200px] flex-col justify-between border-2 border-muted bg-card p-4 transition-all duration-100 hover:-translate-y-1 hover:border-primary hover:bg-background hover:shadow-[4px_4px_0px_var(--color-primary)] active:translate-y-0 active:shadow-none sm:w-auto"
          >
            <div className="flex justify-between">
              <span className="font-mono text-xs text-muted-foreground group-hover:text-primary">{item.id}</span>
              <item.icon className="size-5 text-muted-foreground group-hover:text-primary" />
            </div>
            <div className="font-display text-2xl font-bold leading-none tracking-tight text-foreground group-hover:text-primary whitespace-pre-line">
              {item.label}
            </div>
          </Link>
        ))}
      </nav>
    </div>
  );
}
