import { Component, type ReactNode } from "react";

interface ResetBoundaryProps {
  fallback: ReactNode;
  /** A change of any of them renders the children again after a failure. */
  resetKeys: readonly unknown[];
  children: ReactNode;
}

/**
 * Shows `fallback` instead of children that threw while rendering, until
 * one of `resetKeys` changes.
 */
export class ResetBoundary extends Component<
  ResetBoundaryProps,
  { failed: boolean; resetKeys: readonly unknown[] }
> {
  override state = { failed: false, resetKeys: this.props.resetKeys };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  static getDerivedStateFromProps(
    props: ResetBoundaryProps,
    state: { resetKeys: readonly unknown[] },
  ): { failed: boolean; resetKeys: readonly unknown[] } | null {
    const same =
      props.resetKeys.length === state.resetKeys.length &&
      props.resetKeys.every((key, i) => Object.is(key, state.resetKeys[i]));
    return same ? null : { failed: false, resetKeys: props.resetKeys };
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
