"use client";

// Arcanus's world map (MapLibre). Two layers of world: a country outline shipped with the app (public/geo/, Natural
// Earth), which draws with no network, and OpenStreetMap's tiles over it when online. Tiles you have looked at are
// kept by the service worker, so those streets still show offline. The dot is this device: you, and Arcanus with you.
import "maplibre-gl/dist/maplibre-gl.css";
import { getVersion, Map as MapLibre, Marker, NavigationControl, setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { useOnline } from "@/modules/offline";
import { usePlace } from "@/shared/pane";
import { useStore } from "@/shared/store";
import { PaneControls } from "@/shared/ui/pane-controls";
import { ago, coordinates, placeName, type Near } from "./geo";
import { askLocation, gps, nearPlace } from "./index";

// Served from public/maplibre/ (scripts/copy-maplibre.mjs): the bundler can't resolve MapLibre's own worker path.
setWorkerUrl(`/maplibre/${getVersion()}/maplibre-gl-worker.mjs`);

const STYLE: StyleSpecification = {
  version: 8,
  projection: { type: "globe" },
  sources: {
    world: { type: "geojson", data: "/geo/countries.json", attribution: "Natural Earth" },
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    { id: "sea", type: "background", paint: { "background-color": "#04121c" } },
    { id: "land", type: "fill", source: "world", paint: { "fill-color": "#0c2533" } },
    // Toned down to sit with the rest of Arcanus: dark, low colour.
    { id: "streets", type: "raster", source: "osm", paint: { "raster-brightness-max": 0.62, "raster-saturation": -0.55, "raster-contrast": 0.1 } },
    { id: "borders", type: "line", source: "world", paint: { "line-color": "#6fe0ff", "line-opacity": 0.35, "line-width": 0.7 } },
  ],
};

export default function WorldMap() {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const me = useRef<Marker | null>(null);
  const follow = useRef(true); // keep the dot centred until you pan away
  const [following, setFollowing] = useState(true);
  const [near, setNear] = useState<Near | null>(null);
  const fix = useStore(gps, (s) => s.fix);
  const status = useStore(gps, (s) => s.status);
  const error = useStore(gps, (s) => s.error);
  const prompting = useStore(gps, (s) => s.prompting);
  const online = useOnline();
  const { at, wide } = usePlace("map");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // The map asks for the location as it opens: the browser's permission prompt first, then the live dot.
    void askLocation();
    const el = document.createElement("div");
    el.className = "map-me";
    const m = new MapLibre({ container: box.current!, style: STYLE, center: [0, 15], zoom: 1.4, attributionControl: { compact: true } });
    m.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    // Panning yourself stops following; "Center on me" starts it again.
    m.on("dragstart", () => {
      follow.current = false;
      setFollowing(false);
    });
    me.current = new Marker({ element: el });
    map.current = m;
    const tick = window.setInterval(() => setNow(Date.now()), 15_000); // "last known, N minutes ago" stays true
    return () => {
      window.clearInterval(tick);
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!fix || !m || !me.current) return;
    const first = !me.current.getElement().isConnected;
    // A reading that kept the position (geo steady) only refreshes its time: the dot and the view stay as they are.
    const at = !first && me.current.getLngLat();
    if (at && at.lng === fix.lon && at.lat === fix.lat) return;
    me.current.setLngLat([fix.lon, fix.lat]).addTo(m);
    if (first) m.jumpTo({ center: [fix.lon, fix.lat], zoom: 14 });
    else if (follow.current) m.easeTo({ center: [fix.lon, fix.lat], duration: 600 });
    void nearPlace(fix).then(setNear);
  }, [fix]);

  function centre() {
    follow.current = true;
    setFollowing(true);
    void askLocation();
    if (fix) map.current?.easeTo({ center: [fix.lon, fix.lat], zoom: Math.max(map.current.getZoom(), 14), duration: 800 });
  }

  const live = status === "live" && !!fix; // the watch is running: a device that stays put gets no new readings
  const state =
    status === "denied"
      ? "Location blocked · allow it in the browser's site settings"
      : prompting
        ? "Allow location access in your browser's prompt to show where you are"
        : status === "asking" && !fix
        ? "Finding this device…"
        : !fix
          ? status === "unavailable"
            ? `No position${error ? ` · ${error}` : ""}`
            : "Location not shared yet"
          : live
            ? "Live · from this device's location"
            : `Last known · ${ago(now - fix.at)}`;

  return (
    <section className="side-pane map-pane" aria-label="World map" data-at={at ?? undefined} data-wide={wide || undefined} hidden={!at}>
      <header className="pane-head">
        <MapPin size={16} aria-hidden />
        <h2>World map</h2>
        <PaneControls page="map" title="the world map" />
      </header>
      <div className="map-shell">
      <div ref={box} className="map-view" />
      <section className="map-card" aria-live="polite">
        <h3>You and Arcanus</h3>
        <p className="map-state" data-live={live || undefined}>
          {state}
        </p>
        {fix ? (
          <>
            <p className="map-place">{placeName(near)}</p>
            <p className="map-coords">
              {coordinates(fix)} · ±{Math.round(fix.accuracy)} m
            </p>
          </>
        ) : null}
        {online ? null : <p className="map-note">Offline · the world outline and any streets you viewed before still show</p>}
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={centre} disabled={following && !!fix && status === "live"}>
            {fix ? "Center on me" : "Use my location"}
          </button>
        </div>
      </section>
      </div>
    </section>
  );
}
