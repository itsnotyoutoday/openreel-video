import { createContext, createElement, useContext, type ReactNode } from "react"

/**
 * The element menus, popovers, dropdowns, selects and dialogs portal into.
 * `null` (the default) means `document.body`, as in the standalone app. An
 * embedded editor provides its root element so portalled content stays inside
 * the scope that defines the theme tokens (CSS variables) it paints with.
 */
const PortalContainerContext = createContext<HTMLElement | null>(null)

export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null
  children?: ReactNode
}) {
  return createElement(PortalContainerContext.Provider, { value: container }, children)
}

/** The portal target, or `undefined` for the Radix default (`document.body`). */
export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext) ?? undefined
}
