import { BottomNav } from '@/components/BottomNav';
import { TopNav } from '@/components/TopNav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen pb-16">
      <TopNav />
      <div className="pt-2">{children}</div>
      <BottomNav />
    </div>
  );
}
