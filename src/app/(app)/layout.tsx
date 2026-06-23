import { BottomNav } from '@/components/BottomNav';
import { TopNav } from '@/components/TopNav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // h-dvh (dynamic viewport height) sizes the shell to the actual visible area on
  // iOS Safari, where 100vh includes the browser chrome. The content div is the
  // only thing that scrolls; TopNav and BottomNav are regular flex items that
  // stay put without relying on position:fixed (which misbehaves on iOS when any
  // ancestor has backdrop-filter, transform, or other compositing properties).
  return (
    <div className="flex flex-col h-dvh">
      <TopNav />
      <div className="flex-1 overflow-y-auto min-h-0">{children}</div>
      <BottomNav />
    </div>
  );
}
