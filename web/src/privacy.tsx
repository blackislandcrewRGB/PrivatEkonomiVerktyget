import { createContext, useContext } from "react";

/**
 * 'Visa privata' in the header: private rows show as a grey 'Privat' line
 * unless this is on. Session only: every page load starts with it off.
 */
export const PrivacyContext = createContext<{ showPrivate: boolean; setShowPrivate: (v: boolean) => void }>({
  showPrivate: false,
  setShowPrivate: () => {},
});

export function useShowPrivate(): boolean {
  return useContext(PrivacyContext).showPrivate;
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}
