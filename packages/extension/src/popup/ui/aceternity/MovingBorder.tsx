// Aceternity UI — Moving Border (https://ui.aceternity.com/components/moving-border).
// Điều chỉnh: dạng nút đầy đủ chiều ngang (h-11) giống Button của ví, hỗ trợ disabled/loading, màu tím.
import { useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { motion, useAnimationFrame, useMotionTemplate, useMotionValue, useTransform } from 'framer-motion';
import { cn } from './utils';

export function MovingBorderButton({
  children,
  className,
  containerClassName,
  duration = 3000,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; containerClassName?: string; duration?: number }) {
  return (
    <button
      {...rest}
      className={cn('relative h-11 w-full overflow-hidden rounded-xl bg-transparent p-[1.5px] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45', containerClassName)}
    >
      {!rest.disabled && (
        <div className="absolute inset-0 rounded-xl">
          <MovingBorder duration={duration} rx="12" ry="12">
            <div className="h-16 w-16 bg-[radial-gradient(rgb(var(--brand-hi))_40%,transparent_60%)] opacity-90" />
          </MovingBorder>
        </div>
      )}
      <div
        className={cn(
          'relative flex h-full w-full items-center justify-center gap-2 rounded-[10.5px] bg-gradient-to-b from-brand-mid to-brand-deep text-[13px] font-semibold text-on-accent shadow-glow antialiased',
          className,
        )}
      >
        {children}
      </div>
    </button>
  );
}

export function MovingBorder({ children, duration = 3000, rx, ry }: { children: ReactNode; duration?: number; rx?: string; ry?: string }) {
  const pathRef = useRef<SVGRectElement>(null);
  const progress = useMotionValue(0);
  useAnimationFrame((time) => {
    const length = pathRef.current?.getTotalLength();
    if (length) progress.set((time * (length / duration)) % length);
  });
  const x = useTransform(progress, (v) => pathRef.current?.getPointAtLength(v).x ?? 0);
  const y = useTransform(progress, (v) => pathRef.current?.getPointAtLength(v).y ?? 0);
  const transform = useMotionTemplate`translateX(${x}px) translateY(${y}px) translateX(-50%) translateY(-50%)`;
  return (
    <>
      <svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" className="absolute h-full w-full" width="100%" height="100%" aria-hidden>
        <rect fill="none" width="100%" height="100%" rx={rx} ry={ry} ref={pathRef} />
      </svg>
      <motion.div style={{ position: 'absolute', top: 0, left: 0, display: 'inline-block', transform }}>{children}</motion.div>
    </>
  );
}
