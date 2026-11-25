// Button in the CKBolt style: fully round pill. Primary = ink with paper text; secondary = outline with a 20% ink hairline.
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../aceternity/utils';

export type TextureVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<TextureVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'border border-hair-strong bg-night-900 text-ink hover:bg-night-850',
  danger: 'border border-bad/40 bg-night-900 text-bad hover:bg-bad/5',
  ghost: 'text-moon-soft hover:bg-night-850 hover:text-ink',
};

export const TextureButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: TextureVariant }>(
  ({ variant = 'secondary', className, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-[14px] font-medium transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40',
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
);
TextureButton.displayName = 'TextureButton';
