import { UserCtx } from '~/ctx';
export default function Root({ children }: { children: React.ReactNode }) {
  return <UserCtx.Provider value="u">{children}</UserCtx.Provider>;
}
