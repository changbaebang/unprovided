import { useOther, useUser } from '~/ctx';
export default function Index() { useUser(); useOther(); return null; }
