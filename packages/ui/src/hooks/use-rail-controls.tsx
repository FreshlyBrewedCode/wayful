import { createContext, useContext } from "react";

export interface RailControls {
  /**
   * The maps rail is collapsed on a desktop-width viewport. A route can use
   * this to offer its own control to restore it, in a spot that will not
   * collide with the route's own header.
   */
  collapsed: boolean;
  show: () => void;
}

const RailControlsContext = createContext<RailControls>({ collapsed: false, show: () => {} });

export const RailControlsProvider = RailControlsContext.Provider;

export function useRailControls() {
  return useContext(RailControlsContext);
}
