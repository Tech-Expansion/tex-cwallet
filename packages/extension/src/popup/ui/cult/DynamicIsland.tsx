// Cult UI — Dynamic Island (https://www.cult-ui.com/docs/components/dynamic-island).
// Điều chỉnh cho popup 360px: chỉ giữ các cỡ cần dùng (compact = đang xử lý, long = kết quả), cùng lò xo
// stiffness 400 / damping 30 như bản gốc; nội dung do store thông báo của ví điều khiển.
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 };
const SIZES = {
  compact: { width: 220, height: 36, borderRadius: 22 },
  long: { width: 336, height: 72, borderRadius: 28 },
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
            initial={{ width: 36, height: 36, borderRadius: 22, opacity: 0, y: -12 }}
            animate={{ ...SIZES[size], opacity: 1, y: 0 }}
            exit={{ width: 36, height: 36, opacity: 0, y: -12 }}
            transition={SPRING}
            className="pointer-events-auto overflow-hidden bg-black text-white shadow-[0_8px_30px_rgba(0,0,0,0.45)] ring-1 ring-white/10"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={size}
                initial={{ opacity: 0, scale: 0.9, filter: 'blur(4px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', transition: { delay: 0.08 } }}
                exit={{ opacity: 0, scale: 0.9, filter: 'blur(4px)' }}
                className="flex h-full w-full items-center gap-2.5 px-3.5"
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
