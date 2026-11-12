// Cult UI — Copy Button (https://www.cult-ui.com/docs/components/copy-button).
// Điều chỉnh: icon chuyển Copy → Check bằng spring + blur; dùng làm phần icon trong ô địa chỉ của ví (không cần Button shadcn).
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Copy } from 'lucide-react';

const SPRING = { type: 'spring' as const, duration: 0.3, bounce: 0 };

export function CopyIcon({ copied, size = 14 }: { copied: boolean; size?: number }) {
  const reduce = useReducedMotion();
  const m = reduce
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, scale: 0.25, filter: 'blur(4px)' },
        animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
        exit: { opacity: 0, scale: 0.25, filter: 'blur(4px)' },
        transition: SPRING,
      };
  return (
    <span aria-hidden className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <AnimatePresence initial={false} mode="sync">
        <motion.span key={copied ? 'check' : 'copy'} className="absolute inset-0 flex items-center justify-center" {...m}>
          {copied ? <Check size={size} strokeWidth={2.4} /> : <Copy size={size} strokeWidth={2} />}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
