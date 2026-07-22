import { useState, useEffect, useRef } from 'react';

interface MobileMenuProps {
  /** Navigation items to render in the menu drawer */
  children: React.ReactNode;
  /** Callback when menu is opened or closed */
  onToggle?: (isOpen: boolean) => void;
}

/** Mobile menu component that displays a hamburger menu on small screens and a drawer on interaction. */
export function MobileMenu({ children, onToggle }: MobileMenuProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuDrawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onToggle?.(isOpen);
  }, [isOpen, onToggle]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuDrawerRef.current &&
        menuButtonRef.current &&
        !menuDrawerRef.current.contains(e.target as Node) &&
        !menuButtonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isOpen]);

  const handleMenuItemClick = () => {
    setIsOpen(false);
  };

  return (
    <>
      {/* Hamburger button — visible on mobile only */}
      <button
        ref={menuButtonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="md:hidden fixed top-4 left-4 z-40 flex flex-col gap-1.5 bg-transparent border-0 cursor-pointer p-2"
        aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={isOpen}
      >
        <span
          className={`w-6 h-0.5 bg-prova-text transition-all duration-300 ${
            isOpen ? 'rotate-45 translate-y-2' : ''
          }`}
        />
        <span className={`w-6 h-0.5 bg-prova-text transition-opacity duration-300 ${isOpen ? 'opacity-0' : ''}`} />
        <span
          className={`w-6 h-0.5 bg-prova-text transition-all duration-300 ${
            isOpen ? '-rotate-45 -translate-y-2' : ''
          }`}
        />
      </button>

      {/* Backdrop — visible when menu is open on mobile */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/30"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Menu drawer — slides in on mobile when open */}
      <div
        ref={menuDrawerRef}
        className={`md:hidden fixed top-0 left-0 h-screen w-64 bg-prova-sidebar text-prova-sidebar-text p-7 flex flex-col gap-10.5 z-40 transform transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div onClick={handleMenuItemClick}>{children}</div>
      </div>
    </>
  );
}
