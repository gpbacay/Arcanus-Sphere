"use client";

import dynamic from "next/dynamic";
import { pane } from "@/shared/pane";
import { useStore } from "@/shared/store";

// MapLibre is its own chunk, fetched the first time the map opens.
const WorldMap = dynamic(() => import("./WorldMap"), { ssr: false });

/** The world map, on the right of the studio while it is open (the nav's map button). */
export function MapPane() {
  return useStore(pane, (s) => s.map) ? <WorldMap /> : null;
}
