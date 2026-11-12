// Aceternity UI — Meteors (https://ui.aceternity.com/components/meteors). Điều chỉnh: vị trí/độ trễ tất định
// (không đổi mỗi lần render), màu theo bảng màu ví, trải đều theo bề ngang thẻ 360px.
import { motion } from 'framer-motion';
import { cn } from './utils';

export const Meteors = ({ number = 8, className }: { number?: number; className?: string }) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} aria-hidden>
    {Array.from({ length: number }, (_, idx) => (
      <span
        key={idx}
        className={cn(
          'absolute h-0.5 w-0.5 rotate-[215deg] animate-meteor-effect rounded-full bg-white/80 shadow-[0_0_0_1px_#ffffff10]',
          "before:absolute before:top-1/2 before:h-px before:w-[50px] before:-translate-y-1/2 before:bg-gradient-to-r before:from-white/70 before:to-transparent before:content-['']",
          className,
        )}
        style={{
          top: '-40px',
          left: `${idx * (480 / number) - 60}px`,
          animationDelay: `${(idx * 1.7) % 5}s`,
          animationDuration: `${5 + ((idx * 3) % 5)}s`,
        }}
      />
    ))}
  </motion.div>
);
