// Card in the CKBolt style: square, white, one 10% ink hairline, no shadow.
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../aceternity/utils';

export const TextureCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLElement> & { children?: ReactNode; innerClassName?: string }>(
  ({ className, innerClassName, children, ...props }, ref) => (
    <section ref={ref} className={cn('border border-hair bg-night-900', className, innerClassName)} {...props}>
      {children}
    </section>
  ),
);
TextureCard.displayName = 'TextureCard';

export const TextureSeparator = () => <div className="border-t border-hair" />;
