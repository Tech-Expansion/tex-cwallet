// Aceternity UI — Card Hover Effect (https://ui.aceternity.com/components/card-hover-effect).
// Điều chỉnh: tách phần "nền nổi bật trượt theo chuột" (layoutId) thành provider dùng cho mọi danh sách của ví.
import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from './utils';

const Ctx = createContext<{ group: string; hovered: string | null; setHovered: (k: string | null) => void } | null>(null);

/** Bọc một danh sách: nền nổi bật trượt mượt giữa các dòng khi rê chuột. */
export function HoverList({ children, className }: { children: ReactNode; className?: string }) {
  const group = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <Ctx.Provider value={{ group, hovered, setHovered }}>
      <div className={className} onMouseLeave={() => setHovered(null)}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

/** Nền nổi bật của một dòng; đặt làm con đầu tiên của phần tử `relative`, gọi `bind(key)` trên phần tử đó. */
export function useHoverItem(key: string) {
  const ctx = useContext(Ctx);
  const highlight = (
    <AnimatePresence>
      {ctx?.hovered === key && (
        <motion.span
          layoutId={`hover-${ctx.group}`}
          className={cn('absolute inset-0 -z-0 block rounded-xl bg-night-800/80')}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.15 } }}
          exit={{ opacity: 0, transition: { duration: 0.15, delay: 0.15 } }}
        />
      )}
    </AnimatePresence>
  );
  return { highlight, onMouseEnter: () => ctx?.setHovered(key) };
}
