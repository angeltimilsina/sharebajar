"use client";
import { useSyncExternalStore } from "react";

/**
 * Left wallet sidebar: collapsed/expanded on desktop (remembered, applied
 * before first paint via SIDEBAR_SCRIPT), an off-canvas drawer on phones.
 */
import { SIDEBAR_KEY as KEY } from "./sidebarScript";
const subs = new Set<() => void>();
let state = { drawer: false, collapsed: false };
const emit = () => subs.forEach((f) => f());

if (typeof window !== "undefined") {
  try { state.collapsed = localStorage.getItem(KEY) === "collapsed"; } catch { /* ignore */ }
}


export const sidebar = {
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  get: () => state,
  /** Header button: drawer on phones/tablets, collapse on desktop. */
  toggle() {
    if (window.matchMedia("(min-width: 1024px)").matches) sidebar.setCollapsed(!state.collapsed);
    else sidebar.setDrawer(!state.drawer);
  },
  setDrawer(open: boolean) { state = { ...state, drawer: open }; emit(); },
  setCollapsed(c: boolean) {
    state = { ...state, collapsed: c };
    document.documentElement.dataset.sb = c ? "collapsed" : "expanded";
    try { localStorage.setItem(KEY, c ? "collapsed" : "expanded"); } catch { /* ignore */ }
    emit();
  },
};

const SERVER = { drawer: false, collapsed: false };
export function useSidebar() { return useSyncExternalStore(sidebar.subscribe, sidebar.get, () => SERVER); }
