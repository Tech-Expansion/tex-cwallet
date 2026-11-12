// Cult UI — Texture Button (https://www.cult-ui.com/docs/components/texture-button).
// Điều chỉnh: bỏ phụ thuộc cva/radix (map class thường), màu accent tím của ví, thêm biến thể danger/ghost và cỡ h-11.
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../aceternity/utils';

export type TextureVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const outer: Record<TextureVariant, string> = {
  primary: 'border border-black/10 bg-gradient-to-b from-brand-hi to-brand-deep p-px shadow-glow dark:border-night-950 dark:from-brand-hi/80 dark:to-brand-deep',
  secondary: 'border border-black/15 bg-white/60 p-px dark:border-night-950 dark:bg-night-600/50',
  danger: 'border border-black/10 bg-gradient-to-b from-rose-300/90 to-rose-500 p-px dark:border-night-950 dark:from-rose-300/70 dark:to-rose-600',
  ghost: 'border border-transparent p-px',
};
const inner: Record<TextureVariant, string> = {
  primary:
    'bg-gradient-to-b from-brand-mid to-brand-deep text-on-accent hover:from-brand-hi hover:to-brand-mid active:from-brand-deep active:to-brand-deep',
  secondary:
    'bg-gradient-to-b from-white to-night-850 text-moon hover:from-night-850 hover:to-night-800 dark:from-night-800 dark:to-night-850 dark:hover:from-night-700 dark:hover:to-night-800',
  danger: 'bg-gradient-to-b from-rose-400/80 to-rose-600/80 text-white hover:from-rose-400 hover:to-rose-600',
  ghost: 'text-moon-soft hover:bg-night-800 hover:text-moon',
};

export const TextureButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: TextureVariant }>(
  ({ variant = 'secondary', className, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'group/texture-button inline-flex h-11 rounded-[12px] transition duration-300 ease-in-out active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45',
        outer[variant],
        className,
      )}
      {...props}
    >
      <span className={cn('flex h-full w-full items-center justify-center gap-2 rounded-[10.5px] px-4 text-[13px] font-semibold transition duration-300', inner[variant])}>
        {children}
      </span>
    </button>
  ),
);
TextureButton.displayName = 'TextureButton';
