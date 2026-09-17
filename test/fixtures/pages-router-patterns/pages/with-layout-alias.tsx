import { AuthLayout, useAuth } from '../src/ctx';
function Page() { useAuth(); return <div />; }
Page.getLayout = (page: React.ReactNode) => <AuthLayout>{page}</AuthLayout>;
export default Page;
