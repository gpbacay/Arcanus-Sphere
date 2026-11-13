"use client";

import dynamic from "next/dynamic";
import { usePlace } from "@/shared/pane";

// MapLibre is its own chunk, fetched the first time the map opens.
const WorldMap = dynamic(() => import("./WorldMap"), { ssr: false });

/** The world map, in whichever section it was put while it is open (the nav's map button). */
export function MapPane() {
  return usePlace("map").home ? <WorldMap /> : null;
}
