import { Component, createContext, use, useContext } from 'react';
export const AuthContext = createContext<string | undefined>(undefined);
export const R19Context = createContext<string | undefined>(undefined);
export const ClassContext = createContext<string | undefined>(undefined);
export const useAuth = () => useContext(AuthContext);
export const useR19 = () => use(R19Context);
export const AuthLayout = ({ children }: { children: React.ReactNode }) => (
  <AuthContext.Provider value="a">{children}</AuthContext.Provider>
);
export const R19Provider = ({ children }: { children: React.ReactNode }) => (
  <R19Context value="x">{children}</R19Context>
);
export class StaticField extends Component {
  static contextType = ClassContext;
  render() { return <div>{String(this.context)}</div>; }
}
export class Assigned extends Component {
  render() { return <div>{String(this.context)}</div>; }
}
Assigned.contextType = ClassContext;
export class RenderProp extends Component {
  render() { return <ClassContext.Consumer>{(v) => <div>{v}</div>}</ClassContext.Consumer>; }
}
