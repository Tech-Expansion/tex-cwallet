// Cult UI — Texture Card (https://www.cult-ui.com/docs/components/texture-card).
// Điều chỉnh: các lớp viền dùng màu night-* của ví (đổi theo sáng/tối), bo góc 20px, không cần biến --radius của shadcn.
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../aceternity/utils';

export const TextureCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLElement> & { children?: ReactNode; innerClassName?: string }>(
  ({ className, innerClassName, children, ...props }, ref) => (
    <section ref={ref} className={cn('rounded-[20px] border border-white/60 shadow-card dark:border-night-950/60', className)} {...props}>
      <div className="rounded-[19px] border border-black/10 dark:border-black/40">
        <div className="rounded-[18px] border border-white/50 dark:border-night-950">
          <div className="rounded-[17px] border border-night-950/10 dark:border-night-800/70">
            <div
              className={cn(
                'w-full rounded-[16px] border border-white/60 bg-gradient-to-b from-night-900 to-night-850/80 dark:border-night-700/40',
                innerClassName,
              )}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </section>
  ),
);
TextureCard.displayName = 'TextureCard';

/** Đường phân cách "khắc" của Texture Card. */
export const TextureSeparator = () => (
  <div className="border border-x-transparent border-b-white/70 border-t-night-800/70 dark:border-b-night-700/50 dark:border-t-night-950" />
);
