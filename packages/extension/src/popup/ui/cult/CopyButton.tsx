// Copy icon that turns into a check after copying (1.5px line icons, CKBolt style).
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Copy } from 'lucide-react';

const SPRING = { type: 'spring' as const, duration: 0.3, bounce: 0 };

export function CopyIcon({ copied, size = 14 }: { copied: boolean; size?: number }) {
  const reduce = useReducedMotion();
  const m = reduce
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, scale: 0.6 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.6 },
        transition: SPRING,
      };
  return (
    <span aria-hidden className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <AnimatePresence initial={false} mode="sync">
        <motion.span key={copied ? 'check' : 'copy'} className="absolute inset-0 flex items-center justify-center" {...m}>
          {copied ? <Check size={size} strokeWidth={1.5} /> : <Copy size={size} strokeWidth={1.5} />}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
