interface ResponsiveGridProps {
  /** Number of columns on mobile devices (sm breakpoint, default: 1) */
  mobileColumns?: number;
  /** Number of columns on tablet devices (md breakpoint, default: 2) */
  tabletColumns?: number;
  /** Number of columns on desktop devices (lg breakpoint, default: 3) */
  desktopColumns?: number;
  /** Gap between grid items (Tailwind gap class, default: "4.5") */
  gap?: string;
  /** Child elements to render in the grid */
  children: React.ReactNode;
  /** Additional CSS class names */
  className?: string;
}

/** Responsive grid layout component that adapts column count to viewport size. */
export function ResponsiveGrid({
  mobileColumns = 1,
  tabletColumns = 2,
  desktopColumns = 3,
  gap = '4.5',
  children,
  className = '',
}: ResponsiveGridProps): React.JSX.Element {
  const gridColsMap: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    6: 'grid-cols-6',
  };

  const mobileClass = gridColsMap[mobileColumns] || 'grid-cols-1';
  const tabletClass = gridColsMap[tabletColumns] || 'grid-cols-2';
  const desktopClass = gridColsMap[desktopColumns] || 'grid-cols-3';
  const gapClass = `gap-${gap}`;

  const responsiveClasses = `${mobileClass} md:${tabletClass} lg:${desktopClass} ${gapClass}`;

  return (
    <div className={`grid ${responsiveClasses} ${className}`}>
      {children}
    </div>
  );
}
