import { ModalProvider } from '@/modal';
export default function ModalLayout({ children }: { children: React.ReactNode }) { return <ModalProvider>{children}</ModalProvider>; }
