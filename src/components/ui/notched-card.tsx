import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import { NOTCH_SIZE, notchClip, notchClipInner } from '@/lib/notch'
import { cn } from '@/lib/utils'

interface NotchedCardProps {
  children: React.ReactNode
  className?: string
  header?: React.ReactNode
  footer?: React.ReactNode
  scrollable?: boolean
}

export function NotchedCard({ children, className, header, footer, scrollable = true }: NotchedCardProps) {
  return (
    <div
      className={cn('bg-muted/60 pointer-events-auto', className)}
      style={{ clipPath: notchClip, padding: '2px' }}
    >
      <div
        className="flex flex-col h-full bg-background/70 relative"
        style={{ clipPath: notchClipInner }}
      >
        <NotchedCardDecorators />

        {header && (
          <div className="border-b border-muted/60 bg-card/40 px-4 py-2.5 shrink-0">
            {header}
          </div>
        )}

        {scrollable ? (
          <OverlayScrollbarsComponent
            element="div"
            className="flex-1 min-h-0"
            options={{
              scrollbars: {
                theme: 'os-theme-dark',
                autoHide: 'scroll',
                autoHideDelay: 800,
              },
            }}
          >
            {children}
          </OverlayScrollbarsComponent>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {children}
          </div>
        )}

        {footer && (
          <div className="border-t border-muted/60 bg-card/30 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function NotchedCardDecorators() {
  return (
    <>
      <span className="absolute top-0 left-0 w-2 h-2 border-t border-l border-brackeys-yellow/50 pointer-events-none z-10" />
      <span className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-brackeys-yellow/50 pointer-events-none z-10" />
      <svg
        aria-hidden="true"
        className="absolute top-0 right-0 pointer-events-none text-brackeys-yellow/40 z-10"
        width={NOTCH_SIZE + 2}
        height={NOTCH_SIZE + 2}
        viewBox={`0 0 ${NOTCH_SIZE + 2} ${NOTCH_SIZE + 2}`}
        fill="none"
      >
        <line x1="0" y1="1" x2={NOTCH_SIZE + 1} y2={NOTCH_SIZE + 2} stroke="currentColor" strokeWidth="1" />
      </svg>
      <svg
        aria-hidden="true"
        className="absolute bottom-0 left-0 pointer-events-none text-brackeys-yellow/40 z-10"
        width={NOTCH_SIZE + 2}
        height={NOTCH_SIZE + 2}
        viewBox={`0 0 ${NOTCH_SIZE + 2} ${NOTCH_SIZE + 2}`}
        fill="none"
      >
        <line x1={NOTCH_SIZE + 1} y1={NOTCH_SIZE + 1} x2="0" y2="0" stroke="currentColor" strokeWidth="1" />
      </svg>
    </>
  )
}
