import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** `cn` theo quy ước của Aceternity UI / shadcn: ghép class và gộp class Tailwind trùng. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
