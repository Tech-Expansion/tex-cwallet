// Status pill at the top of the popup (busy / result). Ink pill with paper text, the site's "status pill" shape.
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const SPRING = { type: 'spring' as const, stiffness: 420, damping: 34 };
const SIZES = {
  compact: { width: 220, height: 36 },
  long: { width: 336, height: 64 },
} as const;
export type IslandSize = keyof typeof SIZES;

export function DynamicIsland({ size, open, children, testId }: { size: IslandSize; open: boolean; children: ReactNode; testId?: string }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center">
      <AnimatePresence>
        {open && (
          <motion.div
            key="island"
            data-testid={testId}
            role="status"
            aria-live="polite"
            initial={{ width: 36, height: 36, opacity: 0, y: -8 }}
            animate={{ ...SIZES[size], opacity: 1, y: 0 }}
            exit={{ width: 36, height: 36, opacity: 0, y: -8 }}
            transition={SPRING}
            className="pointer-events-auto overflow-hidden rounded-full bg-[rgb(var(--panel))] text-[rgb(var(--on-panel))] ring-1 ring-[rgb(var(--on-panel)/0.12)]"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={size}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: 0.08 } }}
                exit={{ opacity: 0 }}
                className="flex h-full w-full items-center gap-2.5 px-4"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
