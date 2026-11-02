"use client";

import { Component, type ReactNode } from "react";

/** Keeps a crash inside one part of the page: that part shows `fallback`, the rest of Arcanus keeps running. */
export class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
