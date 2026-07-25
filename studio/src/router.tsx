import { createContext, useContext, useEffect, useMemo, useState } from 'react';

interface RouterValue {
  pathname: string;
  navigate: (to: string, replace?: boolean) => void;
}

const RouterContext = createContext<RouterValue | undefined>(undefined);

interface RouterProviderProps {
  children: React.ReactNode;
  initialPath?: string;
}

/** Minimal same-origin router for Studio's four static application routes. */
export function RouterProvider({ children, initialPath }: RouterProviderProps): React.JSX.Element {
  const [pathname, setPathname] = useState(initialPath ?? window.location.pathname);

  useEffect(() => {
    if (initialPath !== undefined) return undefined;
    const onPopState = (): void => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [initialPath]);

  const value = useMemo<RouterValue>(
    () => ({
      pathname,
      navigate: (to, replace = false) => {
        if (!to.startsWith('/') || to.startsWith('//')) {
          throw new Error('Studio navigation only accepts same-origin absolute paths.');
        }
        if (initialPath === undefined) {
          window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
        }
        setPathname(to);
      }
    }),
    [initialPath, pathname]
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

/** Returns the current internal pathname and navigation function. */
export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('RouterProvider is required.');
  return value;
}

interface LinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
}

/** Same-origin navigation link that retains standard anchor behavior. */
export function Link({ to, onClick, ...props }: LinkProps): React.JSX.Element {
  const { navigate } = useRouter();
  return (
    <a
      {...props}
      href={to}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        navigate(to);
      }}
    />
  );
}

interface NavLinkProps extends Omit<LinkProps, 'className'> {
  className?: string | ((state: { isActive: boolean }) => string);
}

/** Navigation link with active-route class support. */
export function NavLink({ className, to, ...props }: NavLinkProps): React.JSX.Element {
  const { pathname } = useRouter();
  const resolvedClassName = typeof className === 'function'
    ? className({ isActive: pathname === to })
    : className;
  return <Link {...props} to={to} className={resolvedClassName} />;
}
