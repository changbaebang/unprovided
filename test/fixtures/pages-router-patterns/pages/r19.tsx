import { R19Provider, useR19 } from '../src/ctx';
const Inner = () => { useR19(); return null; };
export default function Page() { return <R19Provider><Inner /></R19Provider>; }
