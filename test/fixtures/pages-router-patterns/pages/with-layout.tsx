import { AuthLayout, useAuth } from '../src/ctx';
export default function Page() { useAuth(); return <div />; }
Page.getLayout = (page: React.ReactNode) => <AuthLayout>{page}</AuthLayout>;
