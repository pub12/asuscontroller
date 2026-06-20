import { BottomNav } from '@/components/BottomNav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen pb-16">
      {children}
      <BottomNav />
    </div>
  );
}
