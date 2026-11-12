// Aceternity UI — Background Gradient (https://ui.aceternity.com/components/background-gradient).
// Điều chỉnh: gradient theo tông tím/xanh của Midnight; quầng sáng nhẹ hơn để hợp popup nhỏ.
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from './utils';

const GRADIENT =
  'bg-[radial-gradient(circle_farthest-side_at_0_100%,rgb(var(--brand-alt)),transparent),radial-gradient(circle_farthest-side_at_100%_0,rgb(var(--brand-mid)),transparent),radial-gradient(circle_farthest-side_at_100%_100%,rgb(var(--brand-hi)),transparent),radial-gradient(circle_farthest-side_at_0_0,rgb(var(--brand-deep)),rgb(var(--night-900)))]';

export function BackgroundGradient({ children, className, containerClassName }: { children?: ReactNode; className?: string; containerClassName?: string }) {
  const layer = (extra: string) => (
    <motion.div
      initial={{ backgroundPosition: '0 50%' }}
      animate={{ backgroundPosition: ['0 50%', '100% 50%', '0 50%'] }}
      transition={{ duration: 5, repeat: Infinity, repeatType: 'reverse' }}
      style={{ backgroundSize: '400% 400%' }}
      className={cn('absolute inset-0 z-[1] rounded-[26px] will-change-transform', GRADIENT, extra)}
    />
  );
  return (
    <div className={cn('group relative p-[2px]', containerClassName)}>
      {layer('opacity-50 blur-lg transition duration-500 group-hover:opacity-80')}
      {layer('')}
      <div className={cn('relative z-10', className)}>{children}</div>
    </div>
  );
}
