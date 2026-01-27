import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { MapContainer, TileLayer, CircleMarker, Polyline, Circle, useMap, Polygon, useMapEvents } from 'react-leaflet';
import * as L from 'leaflet';
import { 
  ChevronLeft,
  Navigation2,
  Layers,
  Target,
  Trash2,
  Ruler,
  Zap,
  BookOpen,
  Info,
  MapPin,
  RotateCcw,
  Download,
  Upload,
  HelpCircle,
  X,
  AlertCircle,
  Cpu,
  Eye,
  Diameter,
  Plus,
  Minus,
  CaseSensitive,
  Gauge,
  ChevronUp,
  ChevronDown,
  Circle as CircleIcon,
  CircleOff,
  CircleDot,
  Crosshair
} from 'lucide-react';

/** --- TYPES --- **/
type AppView = 'landing' | 'track' | 'green' | 'manual' | 'stimp';
type UnitSystem = 'Yards' | 'Metres';
type FontSize = 'small' | 'medium' | 'large';
type RatingGender = 'Men' | 'Women'; // New type for gender selection
type TrackProfileView = 'Rater\'s Walk' | 'Scratch' | 'Bogey'; // New type for track record viewing
type OvalMode = 'off' | 'scratch' | 'bogey';

interface GeoPoint {
  lat: number;
  lng: number;
  alt: number | null;
  accuracy: number;
  altAccuracy: number | null;
  timestamp: number;
  type?: 'green' | 'bunker';
}

// New interface for pivot records with type information
interface PivotRecord {
  point: GeoPoint;
  type: 'common' | 'scratch_cut' | 'bogoy_round';
}

interface SavedRecord {
  id: string;
  type: 'Track' | 'Green';
  date: number;
  primaryValue: string; // For Track: "S: 380yd / B: 405yd", for Green: "Area"
  secondaryValue?: string; // For Track: "Elev: S: 10ft / B: 12ft", for Green: "Bunker %"
  egdValue?: string; // Only for Green type
  points: GeoPoint[]; // For Green: green perimeter points, For Track: Rater's physical path
  pivots?: GeoPoint[]; // Deprecated for Track, use pivotPoints
  holeNumber?: number;

  // Track-specific fields (new for multi-profile)
  raterPathPoints?: GeoPoint[]; // The full physical GPS trace of the rater (replaces `points` for 'Track' type)
  pivotPoints?: PivotRecord[]; // Explicitly typed pivots for 'Track' type
  genderRated?: RatingGender; // The selected gender for the rating
  effectivePaths?: { // The calculated effective paths for each profile
    scratch: GeoPoint[];
    bogey: GeoPoint[];
  };
  effectiveDistances?: { // The final calculated total distances
    scratch: number;
    bogey: number;
  };
  effectiveElevations?: { // The final calculated total elevations
    scratch: number; // Changed to number
    bogey: number; // Changed to number
  };
}

/** --- ACCURACY TABLES (Yards) --- **/
const ACCURACY_DATA = {
  Men: [
    { dist: 90, sw: 11, sd: 14, bw: 16, bd: 19 },
    { dist: 110, sw: 12, sd: 15, bw: 17, bd: 21 },
    { dist: 130, sw: 13, sd: 15, bw: 18, bd: 23 },
    { dist: 150, sw: 15, sd: 16, bw: 20, bd: 25 },
    { dist: 170, sw: 18, sd: 17, bw: 24, bd: 28 },
    { dist: 190, sw: 23, sd: 18, bw: 29, bd: 34 },
    { dist: 210, sw: 29, sd: 19, bw: null, bd: null },
    { dist: 230, sw: 35, sd: 20, bw: null, bd: null },
    { dist: 250, sw: 41, sd: 21, bw: null, bd: null },
  ],
  Women: [
    { dist: 90, sw: 12, sd: 15, bw: 17, bd: 22 },
    { dist: 110, sw: 14, sd: 16, bw: 19, bd: 24 },
    { dist: 130, sw: 17, sd: 17, bw: 21, bd: 27 },
    { dist: 150, sw: 20, sd: 18, bw: 24, bd: 30 },
    { dist: 170, sw: 26, sd: 20, bw: null, bd: null },
    { dist: 190, sw: 30, sd: 24, bw: null, bd: null },
    { dist: 210, sw: 34, sd: 28, bw: null, bd: null },
  ]
};

const interpolateSpread = (distYards: number, gender: RatingGender) => {
  const table = ACCURACY_DATA[gender];
  if (distYards < table[0].dist) return null;

  let sw: number | null = null, sd: number | null = null;
  let bw: number | null = null, bd: number | null = null;

  // Scratch logic
  const lastS = table[table.length - 1];
  if (distYards <= lastS.dist) {
    for (let i = 0; i < table.length - 1; i++) {
      const s = table[i], e = table[i + 1];
      if (distYards >= s.dist && distYards <= e.dist) {
        const t = (distYards - s.dist) / (e.dist - s.dist);
        sw = s.sw + (e.sw - s.sw) * t;
        sd = s.sd + (e.sd - s.sd) * t;
        break;
      }
    }
  } else {
    sw = lastS.sw; sd = lastS.sd;
  }

  // Bogey logic
  const bogeyRows = table.filter(r => r.bw !== null);
  const lastB = bogeyRows[bogeyRows.length - 1];
  if (distYards <= lastB.dist) {
    for (let i = 0; i < bogeyRows.length - 1; i++) {
      const s = bogeyRows[i], e = bogeyRows[i + 1];
      if (distYards >= s.dist && distYards <= e.dist) {
        const t = (distYards - s.dist) / (e.dist - s.dist);
        bw = s.bw! + (e.bw! - s.bw!) * t;
        bd = s.bd! + (e.bd! - s.bd!) * t;
        break;
      }
    }
  }

  return { sw, sd, bw, bd };
};

/** --- DOCUMENTATION CONTENT --- **/
const USER_MANUAL = [
  {
    title: "Introduction",
    color: "text-white",
    icon: <BookOpen className="text-white" />,
    content: (
      <>
        Scottish Golf <span className="text-blue-500 font-black">Course Rating Toolkit</span> is designed to provide an alternative to roadwheels and barometers when rating a course. Ensure 'High Accuracy' location is enabled on your device. For best results, keep the app active and in-hand while walking. The App is web-based, so an internet connection is required to launch. A trick is to open the app where you have Internet, open the 'Distance Tracker' section and zoom out so you see the whole of the course you are working on. This should cache the images or maps locally, so you can still see them when Internet is lost. But if you lose connection the App will still work, though you may not see the background mapping.
      </>
    )
  },
   
  {
    title: "Location services",
    color: "text-rose-500",
    icon: <MapPin className="text-rose-500" />,
    content: (
      <>
        If your location isn't showing when you're trying to track a distance or map a green, try the following help sources 1) <a href="https://support.google.com/nexus/topic/6143651" target="_blank" rel="noopener noreferrer" className="text-yellow-400 underline">Android devices</a>  2) <a href="https://support.apple.com/en-gb/102647" target="_blank" rel="noopener noreferrer" className="text-emerald-500 underline">iOS (Apple) devices</a>
      </>
    )
  },
  
  {
    title: "Distance Tracker",
    color: "text-blue-400",
    icon: <Navigation2 className="text-blue-400" />,
    content: (
      <>
<p>This menu calculates distances and altitude change from tee to each landing zone for Scratch and Bogey players (the players). In addition, it displays the effective playing length of dogleg holes.</p>

<p>On the home screen you can select whether you will be rating for Men or Women. This selection has no impact on the results, but will mark the generated hole track files for archiving and re-loading.</p>

<p>Stand on the tee you are using to measure from and Tap 'Start Track' when you are ready to start tracking the distance.</p>

<p>Horizontal and vertical distances are displayed in real-time. If you made a mistake and began at the wrong place, select “Stop Track” to start over.</p>

<p>Two distances are shown S: for scratch and B: for bogey. The two will only differ if the line that each takes on a hole are different. On dogleg holes, a scratch golfer may be able to cut the corner, so their pivot point will be different to the bogey player.</p>

<p>When you reach the first pivot, select ‘pivot’ and choose which (or both) players it refers to. If it does not apply to both, then from this point you will see two track lines and distances – one through the pivot and the other in a straight line from the tee. As you progress down the hole you can select pivots for each player.</p>

<p>Both players’ tracks will end at the front of the green when you hit “Stop Track” and you can note down the two distances and the level difference between tee and green.</p>

<p>As soon as you press “Stop Track” no more lines will be drawn, the location pin will continue to follow you and the track record for that hole will appear at the bottom of the Home screen for export or review.</p>

<p>Notes: You can create a maximum of 3 pivots for each player on each hole. Total distance and elevation change are calculated from the start through all pivots to your current position. GNSS (GPS) is really only accurate to 2m at best, so keep an eye on the Horiz. value and the indicative coloured circle around the current location. It shows you the absolute positioning accuracy of the GPS, however, don't confuse this with the accuracy of distance measurements. They will always be better than this as they are relative to each other.</p>

<p>If your device does not have a barometer sensor (see the elevation method displayed below the elevation value), then you may still need to use a barometer. Refer to section on “Sensor Diagnostics”, below for details.</p>
      </>
    ) 
  },
 
  {
    title: "Accuracy Pattern",
    color: "text-orange-400",
    icon: <Crosshair className="text-orange-400" />,
    content: (
      <>
The App is able to display the 'Accuracy Pattern' in realtime for Scratch and Bogey players. This display is toggled with the button to the left of the units button and cycles between 'Off' (default), <span className="text-emerald-500 font-black">Scratch</span> or <span className="text-yellow-500 font-black">Bogey.</span> This function allows the Rater to see on the background satellite imagery the proximity of obstacles around the target. To use this facility properly, mark every shot as a pivot, so that the next shot length is used.
      
      </>
    )
    
      },
 
  {
    title: "Green Mapper",
    color: "text-emerald-400",
    icon: <Target className="text-emerald-400" />,
    content: "Start at any point on the edge of the green. Walk the perimeter. The app automatically 'Closes' the loop when you return to within 1m of your start point, or you can force it to close by hitting the button. Results show total Area and Perimeter length."
  },
  {
    title: "Recording Bunkers",
    color: "text-orange-400",
    icon: <AlertCircle className="text-orange-400" />,
    content: "While walking the green edge, hold the 'Bunker' button when passing a bunker segment and release when you get to the end. This marks those points as sand. The panel will show what percentage of the green's perimeter is guarded by sand."
  },
  {
    title: "Effective Green Diameter",
    color: "text-emerald-400",
    icon: <Diameter className="text-emerald-400" />,
    content: "Effective Green Diameter (EGD) is required when measuring a green. When a green is mapped and closed the EGD will automatically be displayed, together with the raw data and dashed lines showing the dimensions used. Oddly-shaped greens are more tricky, but by using a \"concave hull check\" it should at least recognise an L-shaped green. In these circumstances, EGD should show the raw dimension data to allow the rater to make their weighting adjustments - as per Course Rating System Manual (Jan 2024 Section 13D [two portions]). In those cases when a green cannot be automatically identified by the App, it will draw a curved line right up the centre of the green with perpendicular widths at 0.25, 0.50 and 0.75 of the green depth. The raw data will be shown for manual analysis."
  },
   {
    title: "Stimping sloped greens",
    color: "text-lime-400",
    icon: <Gauge className="text-lime-400" />,
    content: "While the best procedure is to find a level area on the green on which to stimp, when it is not possible to find a flat area to measure, refer to 'Course Rating Manual 9.Green Surface'. Find the most uniform area. Roll balls down and then up. Enter the averaged values into the App and it will calculate the corrected speed and contour category based on those values. Refer to the 'Green Surface Rating Table' to determine the rating."
  },
  {
    title: "Sensor Diagnostics",
    color: "text-rose-700",
    icon: <Cpu className="text-rose-700" />,
    content: (
      <>
        GPS alone isn't accurate enough for determining altitude changes, but if your mobile device contains a barometer sensor this App should use it by default. If it does exist it will indicate its use as follows... <span className="text-blue-500 font-black">Blue Light</span> (Barometric): Highest precision elevation using your phone's pressure sensor (if it has one). <span className="text-emerald-500 font-black">Emerald Light</span> (GNSS 3D): Standard GPS altitude. <span className="text-amber-500 font-black">Amber Light</span>: Searching for vertical lock.
      </>
    )
  },
  {
    title: "Data import/export",
    color: "text-yellow-400",
    icon: <BookOpen className="text-yellow-400" />,
    content: "Whenever you save a track or green area, the data appears at the bottom of the homescreen. Select a result and it will show you the results again. Hitting the bin icon will delete an individual record. You can also save all results to a KML file, which will be stored in your downloads folder. The filename will be the current date and time. KML files can be opened in GIS packages, such as Google Earth or Google Maps for analysis and archiving purposes. If you already have a KML file from a previous rating, or have digitised greens in Google Earth and wish to import them for EGD processing, you can do this using 'Import KML'"
  },
  {
    title: "Help and suggestions",
    color: "text-red-400",
    icon: <Eye className="text-red-400" />,
    content: "This App is under development. If you require assistance or have any suggestions, please email me at nigel.lorriman@gmail.com  Version - Jan 2026"
  }
];

/** --- UTILITIES --- **/
const calculateDistance = (p1: {lat: number, lng: number}, p2: {lat: number, lng: number}): number => {
  const R = 6371e3;
  const lat1 = p1.lat * Math.PI / 180;
  const lat2 = p2.lat * Math.PI / 180;
  const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
  const Δλ = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const calculatePathDistanceAndElevation = (path: GeoPoint[], distMult: number, elevMult: number) => {
  let distance = 0;
  let netElevation = 0;

  if (path.length > 1) {
    for (let k = 0; k < path.length - 1; k++) {
      const p1 = path[k];
      const p2 = path[k+1];
      distance += calculateDistance(p1, p2);
    }
    const startAlt = path[0]?.alt || 0;
    const endAlt = path[path.length - 1]?.alt || 0;
    netElevation = (endAlt - startAlt); // Raw elevation difference
  }
  return {
    distance: distance * distMult,
    elevation: netElevation * elevMult,
  };
};

const calculateArea = (points: GeoPoint[]): number => {
  if (points.length < 3) return 0;
  const R = 6371e3;
  const lat0 = points[0].lat * Math.PI / 180;
  const coords = points.map(p => ({
    x: p.lng * Math.PI / 180 * R * Math.cos(lat0),
    y: p.lat * Math.PI / 180 * R
  }));
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    area += coords[i].x * coords[j].y - coords[j].x * coords[i].y;
  }
  return Math.abs(area) / 2;
};

const getConvexHull = (points: GeoPoint[]): GeoPoint[] => {
  if (points.length < 3) return points;
  const pts = [...points].sort((a, b) => a.lng !== b.lng ? a.lng - b.lng : a.lat - b.lat);
  const cp = (a: GeoPoint, b: GeoPoint, c: GeoPoint) => (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cp(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cp(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
};

const getWidthAtAxisPoint = (midX: number, midY: number, nx: number, ny: number, polyPoints: any[], toX: any, toY: any) => {
  const intersections: number[] = [];
  for (let i = 0; i < polyPoints.length - 1; i++) {
    const x1 = toX(polyPoints[i]), y1 = toY(polyPoints[i]);
    const x2 = toX(polyPoints[i+1]), y2 = toY(polyPoints[i+1]);
    const sx = x2 - x1, sy = y2 - y1;
    const det = -sx * ny + sy * nx;
    if (Math.abs(det) < 1e-10) continue; 
    const u = (-(midX - x1) * ny + (midY - y1) * nx) / det;
    const t = (sx * (midY - y1) - sy * (midX - x1)) / det;
    if (u >= 0 && u <= 1) intersections.push(t);
  }
  if (intersections.length < 2) return null;
  return { minT: Math.min(...intersections), maxT: Math.max(...intersections) };
};

const isPointInPolygon = (p: {x: number, y: number}, polygon: {x: number, y: number}[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

const getAccuracyColor = (accuracy: number): string => {
  if (accuracy < 2) return 'rgba(34, 197, 94, 0.4)'; // Green
  if (accuracy <= 5) return 'rgba(234, 179, 8, 0.4)'; // Yellow
  return 'rgba(239, 68, 68, 0.4)'; // Red
};

const getAccuracyTextColor = (accuracy: number): string => {
  if (accuracy < 2) return 'text-emerald-500';
  if (accuracy <= 5) return 'text-amber-500';
  return 'text-rose-500';
};

// This function is now used to get the method string, not the color class for the value
const getVerticalMethod = (accuracy: number | null, alt: number | null): string => {
  if (accuracy !== null) { // altAccuracy is available, implies higher precision
    return 'Barometric'; // As per manual: Blue Light (Barometric): Highest precision elevation
  } else if (alt !== null) { // alt is available, but altAccuracy is null, implies standard 3D GNSS
    return 'GNSS 3D'; // As per manual: Emerald Light (GNSS 3D): Standard GPS altitude
  }
  return 'Vertical (Searching)'; // No lock
};

const getBunkerPercentageColor = (bunkerPct: number | undefined): string => {
  if (bunkerPct === undefined) return 'text-white/40'; // Neutral for undefined
  if (bunkerPct <= 25) return 'text-emerald-400'; // 0% to 25%
  if (bunkerPct > 25 && bunkerPct <= 50) return 'text-yellow-400'; // 25.01% to 50%
  if (bunkerPct > 50 && bunkerPct <= 75) return 'text-orange-400'; // 50.01% to 75%
  return 'text-white'; // > 75%
};

const getEGDAnalysis = (points: GeoPoint[], forceSimpleAverage: boolean = false) => {
  if (points.length < 3) return null;
  const R = 6371e3;
  let maxD = 0;
  let pA = points[0], pB = points[0];
  
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = calculateDistance(points[i], points[j]);
      if (d > maxD) { maxD = d; pA = points[i]; pB = points[j]; }
    }
  }

  const latRef = pA.lat * Math.PI / 180;
  const toX = (p: {lat: number, lng: number}) => p.lng * Math.PI / 180 * R * Math.cos(latRef);
  const toY = (p: {lat: number, lng: number}) => p.lat * Math.PI / 180 * R;
  const fromXY = (x: number, y: number): GeoPoint => ({
    lat: (y / R) * (180 / Math.PI),
    lng: (x / (R * Math.cos(latRef))) * (180 / Math.PI),
    alt: null, accuracy: 0, altAccuracy: 0, timestamp: 0
  });

  const xA = toX(pA), yA = toY(pA);
  const xB = toX(pB), yB = toY(pB);
  const dx = xB - xA, dy = yB - yA;
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag === 0) return null;

  const nx = -dy / mag;
  const ny = dx / mag;
  const polyPoints = [...points, points[0]];

  // Standard Midpoint Width
  const midX = (xA + xB) / 2;
  const midY = (yA + yB) / 2;
  const midW = getWidthAtAxisPoint(midX, midY, nx, ny, polyPoints, toX, toY);
  const widthMeters = midW ? (midW.maxT - midW.minT) : 0;

  // Multi-Width Check (25% and 75% along the axis)
  const q1X = xA + (xB - xA) * 0.25;
  const q1Y = yA + (yB - yA) * 0.25;
  const q3X = xA + (xB - xA) * 0.75;
  const q3Y = yA + (yB - yA) * 0.75;
  const w1 = getWidthAtAxisPoint(q1X, q1Y, nx, ny, polyPoints, toX, toY);
  const w3 = getWidthAtAxisPoint(q3X, q3Y, nx, ny, polyPoints, toX, toY);

  const L_yds = maxD * 1.09361;
  const W_yds = widthMeters * 1.09361;
  const ratio = W_yds === 0 ? 0 : L_yds / W_yds;

  // Determine Method
  let egd_yds = 0;
  let method = "Average (L+W)/2";
  let isInconsistent = false;
  let w1_yds = 0, w3_yds = 0;
  let pC1, pD1, pC3, pD3;

  if (forceSimpleAverage) {
    egd_yds = (L_yds + W_yds) / 2;
    method = "Average (L+W)/2";
  } else {
    if (w1 && w3) {
      w1_yds = (w1.maxT - w1.minT) * 1.09361;
      w3_yds = (w3.maxT - w3.minT) * 1.09361;
      if (Math.abs(w1_yds - w3_yds) / Math.max(w1_yds, w3_yds) > 0.25) {
        isInconsistent = true;
        method = "One dimension not consistent";
        const avgShort = (w1_yds + w3_yds) / 2;
        egd_yds = (L_yds + avgShort) / 2;
        pC1 = fromXY(q1X + nx * w1.maxT, q1Y + ny * w1.maxT);
        pD1 = fromXY(q1X + nx * w1.minT, q1Y + ny * w1.minT);
        pC3 = fromXY(q3X + nx * w3.maxT, q3Y + ny * w3.maxT);
        pD3 = fromXY(q3X + nx * w3.minT, q3Y + ny * w3.minT);
      }
    }

    if (!isInconsistent) {
      if (ratio >= 3) {
        egd_yds = (3 * W_yds + L_yds) / 4;
        method = "One dimension three times the other";
      } else if (ratio >= 2) {
        egd_yds = (2 * W_yds + L_yds) / 3;
        method = "One dimension twice the other";
      } else {
        egd_yds = (L_yds + W_yds) / 2;
      }
    }
  }
  
  const pC = fromXY(midX + nx * (midW?.maxT || 0), midY + ny * (midW?.maxT || 0));
  const pD = fromXY(midX + nx * (midW?.minT || 0), midY + ny * (midW?.minT || 0));

  return { 
    egd: Math.round(egd_yds * 10) / 10, 
    L: L_yds, 
    W: W_yds, 
    ratio, pA, pB, pC, pD, method,
    isInconsistent, w1_yds, w3_yds, pC1, pD1, pC3, pD3
  };
};

/** --- NEW ANOMALOUS GREEN ANALYSIS CODE --- **/
const performAnomalousAnalysis = (points: GeoPoint[], pA: GeoPoint, pB: GeoPoint) => {
  const R = 6371e3;
  const latRef = pA.lat * Math.PI / 180;
  const toX = (p: {lat: number, lng: number}) => p.lng * Math.PI / 180 * R * Math.cos(latRef);
  const toY = (p: {lat: number, lng: number}) => p.lat * Math.PI / 180 * R;
  const fromXY = (x: number, y: number): GeoPoint => ({
    lat: (y / R) * (180 / Math.PI),
    lng: (x / (R * Math.cos(latRef))) * (180 / Math.PI),
    alt: null, accuracy: 0, altAccuracy: 0, timestamp: 0
  });

  const xA = toX(pA), yA = toY(pA);
  const xB = toX(pB), yB = toY(pB);
  const dx = xB - xA, dy = yB - yA;
  const straightDist = Math.sqrt(dx * dx + dy * dy);
  const mag = straightDist;
  
  if (mag === 0) return null;

  const nx = -dy / mag;
  const ny = dx / mag;
  const polyPoints = [...points, points[0]];

  // 1. Skeleton Generation (The Curved Spine / Medial Axis)
  const steps = 15;
  const spinePoints: GeoPoint[] = [];
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const curX = xA + dx * t;
    const curY = yA + dy * t;
    
    // Find cross-section intersections at this interval
    const res = getWidthAtAxisPoint(curX, curY, nx, ny, polyPoints, toX, toY);
    if (res) {
      // Find the center point between the nearest left and right perimeters (equidistant)
      const midT = (res.minT + res.maxT) / 2;
      spinePoints.push(fromXY(curX + nx * midT, curY + ny * midT));
    }
  }

  // Calculate curved spine length
  let curvedLen = 0;
  for (let i = 0; i < spinePoints.length - 1; i++) {
    curvedLen += calculateDistance(spinePoints[i], spinePoints[i + 1]);
  }

  // 2. Perpendicular Sampling at milestones: 1/4, 1/2, 3/4
  const milestones = [0.25, 0.5, 0.75];
  const milestoneColors = ["#fb923c", "#facc15", "#f472b6"];
  const sampledWidths: { w: number, p1: GeoPoint, p2: GeoPoint, label: string, color: string }[] = [];
  
  milestones.forEach((m, idx) => {
    const t = m;
    const curX = xA + dx * t;
    const curY = yA + dy * t;
    const res = getWidthAtAxisPoint(curX, curY, nx, ny, polyPoints, toX, toY);
    if (res) {
      sampledWidths.push({
        w: (res.maxT - res.minT) * 1.09361,
        p1: fromXY(curX + nx * res.maxT, curY + ny * res.maxT),
        p2: fromXY(curX + nx * res.minT, curY + ny * res.minT),
        label: `W${idx + 1}`,
        color: milestoneColors[idx]
      });
    }
  });

  const curvedLenYds = curvedLen * 1.09361;
  const straightLenYds = mag * 1.09361;

  // Manual Req Trigger Logic based on curvature ratio
  const isSignificantlyCurved = curvedLenYds > straightLenYds * 1.15;

  return {
    method: "Anomalous Green Detected",
    isAnomalous: true,
    isManualReq: isSignificantlyCurved,
    curvedLength: curvedLenYds,
    straightLength: straightLenYds,
    spine: spinePoints,
    widths: sampledWidths
  };
};

const analyzeGreenShape = (points: GeoPoint[], concavityThreshold: number = 0.82) => {
  if (points.length < 3) return null;
  const basic = getEGDAnalysis(points);
  if (!basic) return null;

  const polyArea = calculateArea(points);
  const hullArea = calculateArea(getConvexHull(points));
  const concavity = hullArea > 0 ? polyArea / hullArea : 1;
  
  const R = 6371e3;
  const latRef = points[0].lat * Math.PI / 180;
  const toX = (p: {lat: number, lng: number}) => p.lng * Math.PI / 180 * R * Math.cos(latRef);
  const toY = (p: {lat: number, lng: number}) => p.lat * Math.PI / 180 * R;
  const polyCoords = points.map(p => ({ x: toX(p), y: toY(p) }));
  
  const midX = (toX(basic.pA) + toX(basic.pB)) / 2;
  const midY = (toY(basic.pA) + toY(basic.pB)) / 2;
  const midpointIsOutside = !isPointInPolygon({ x: midX, y: midY }, polyCoords);

  const isLShape = midpointIsOutside || concavity < concavityThreshold || basic.ratio > 3.6;

  if (isLShape) {
    let elbowIdx = 0;
    let maxElbowDist = -1;
    const xA = toX(basic.pA), yA = toY(basic.pA);
    const xB = toX(basic.pB), yB = toY(basic.pB);
    const dx = xB - xA, dy = yB - yA;
    const mag = Math.sqrt(dx * dx + dy * dy);

    points.forEach((p, idx) => {
      const px = toX(p), py = toY(p);
      const dist = Math.abs((xB - xA) * (yA - py) - (xA - px) * (yB - yA)) / mag;
      if (dist > maxElbowDist) {
        maxElbowDist = dist;
        elbowIdx = idx;
      }
    });

    const s1 = getEGDAnalysis(points.slice(0, elbowIdx + 1), true);
    const s2 = getEGDAnalysis(points.slice(elbowIdx), true);

    let hasAnomaly = false;
    if (s1 && s1.pA && s1.pB) {
      const s1MidX = (toX(s1.pA) + toX(s1.pB)) / 2;
      const s1MidY = (toY(s1.pA) + toY(s1.pB)) / 2;
      if (!isPointInPolygon({ x: s1MidX, y: s1MidY }, polyCoords)) hasAnomaly = true;
    }
    if (!hasAnomaly && s2 && s2.pA && s2.pB) {
      const s2MidX = (toX(s2.pA) + toX(s2.pB)) / 2;
      const s2MidY = (toY(s2.pA) + toY(s2.pB)) / 2;
      if (!isPointInPolygon({ x: s2MidX, y: s2MidY }, polyCoords)) hasAnomaly = true;
    }

    // --- TRIGGER ANOMALOUS GREEN ANALYSIS IF ANOMALY DETECTED ---
    let anomalousResult = null;
    if (hasAnomaly) {
      anomalousResult = performAnomalousAnalysis(points, basic.pA, basic.pB);
    }

    return { 
      ...basic, 
      isLShape: true, 
      method: anomalousResult ? anomalousResult.method : "Two portions",
      hasAnomaly,
      anomalousResult,
      s1, 
      s2 
    };
  }

  return { ...basic, isLShape: false, hasAnomaly: false, s1: null, s2: null };
};


// --- NEW UTILITY: Generate interpolated line points ---
const getInterpolatedLine = (p1: GeoPoint, p2: GeoPoint, numSegments: number = 5): GeoPoint[] => {
  const points: GeoPoint[] = [p1];
  if (p1.timestamp === p2.timestamp) return points; // Handle same point

  for (let i = 1; i < numSegments; i++) {
    const t = i / numSegments;
    points.push({
      lat: p1.lat + (p2.lat - p1.lat) * t,
      lng: p1.lng + (p2.lng - p1.lng) * t,
      alt: p1.alt !== null && p2.alt !== null ? p1.alt + (p2.alt - p1.alt) * t : null,
      accuracy: (p1.accuracy + p2.accuracy) / 2, // Simple average
      altAccuracy: p1.altAccuracy !== null && p2.altAccuracy !== null ? (p1.altAccuracy + p2.altAccuracy) / 2 : null,
      timestamp: p1.timestamp + (p2.timestamp - p1.timestamp) * t // Interpolate timestamp too
    });
  }
  points.push(p2);
  return points;
};


// --- NEW UTILITY: Calculate Effective Paths and Metrics ---
const calculateEffectivePathsAndMetrics = (
  raterPathPoints: GeoPoint[],
  pivotRecords: PivotRecord[],
  distMult: number,
  elevMult: number
) => {
  if (raterPathPoints.length < 2) {
    return {
      effectivePaths: { scratch: [], bogey: [] },
      effectiveDistances: { scratch: 0, bogey: 0 },
      effectiveElevations: { scratch: 0, bogey: 0 },
    };
  }

  const sortedPivots = [...pivotRecords].sort((a, b) => a.point.timestamp - b.point.timestamp);
  const startPoint = raterPathPoints[0];
  const endPoint = raterPathPoints[raterPathPoints.length - 1];

  // --- 1. Determine effective anchors for each path ---
  const getAnchors = (forScratch: boolean): GeoPoint[] => {
    let anchors: GeoPoint[] = [startPoint];
    for (const pivot of sortedPivots) {
      if (forScratch) {
        if (pivot.type === 'common' || pivot.type === 'scratch_cut') {
          anchors.push(pivot.point);
        }
      } else { // for Bogey
        if (pivot.type === 'common' || pivot.type === 'bogoy_round') {
          anchors.push(pivot.point);
        }
      }
    }
    if (anchors[anchors.length - 1].timestamp !== endPoint.timestamp) {
      anchors.push(endPoint);
    }
    return Array.from(new Map(anchors.map(p => [p.timestamp, p])).values()).sort((a, b) => a.timestamp - b.timestamp);
  };

  const scratchAnchors = getAnchors(true);
  const bogeyAnchors = getAnchors(false);

  // --- 2. Build the full path for each profile based on anchors ---
  const buildFinalPath = (anchors: GeoPoint[], isScratchPath: boolean): GeoPoint[] => {
    const path: GeoPoint[] = [];
    if (anchors.length === 0) return [];
    path.push(anchors[0]);

    for (let i = 0; i < anchors.length - 1; i++) {
      const p1 = anchors[i];
      const p2 = anchors[i+1];
      let shouldBeStraight = false;
      const p1IndexInRaterPath = raterPathPoints.findIndex(rp => rp.timestamp === p1.timestamp);
      const p2IndexInRaterPath = raterPathPoints.findIndex(rp => rp.timestamp === p2.timestamp);

      if (p1IndexInRaterPath === -1 || p2IndexInRaterPath === -1 || p1IndexInRaterPath >= p2IndexInRaterPath) {
        shouldBeStraight = true;
      } else {
        const segmentInRaterPath = raterPathPoints.slice(p1IndexInRaterPath + 1, p2IndexInRaterPath); 
        if (isScratchPath) {
          const p2IsScratchCutPivot = sortedPivots.some(p => p.point.timestamp === p2.timestamp && p.type === 'scratch_cut');
          const skippedBogoyRoundPivots = sortedPivots.filter(p => p.type === 'bogoy_round' && segmentInRaterPath.some(rp => rp.timestamp === p.point.timestamp));
          if (p2IsScratchCutPivot || skippedBogoyRoundPivots.length > 0) shouldBeStraight = true;
        } else { // Bogey path
          const skippedScratchCutPivots = sortedPivots.filter(p => p.type === 'scratch_cut' && segmentInRaterPath.some(rp => rp.timestamp === p.point.timestamp));
          if (skippedScratchCutPivots.length > 0) shouldBeStraight = true;
        }
      }
      
      if (shouldBeStraight) {
        path.push(...getInterpolatedLine(p1, p2, 10).slice(1));
      } else {
        if (p1IndexInRaterPath !== -1 && p2IndexInRaterPath !== -1 && p1IndexInRaterPath < p2IndexInRaterPath) {
          path.push(...raterPathPoints.slice(p1IndexInRaterPath + 1, p2IndexInRaterPath + 1));
        } else {
          path.push(...getInterpolatedLine(p1, p2, 10).slice(1));
        }
      }
    }
    return path;
  };

  const finalScratchPath = buildFinalPath(scratchAnchors, true);
  const finalBogeyPath = buildFinalPath(bogeyAnchors, false);
  const scratchMetrics = calculatePathDistanceAndElevation(finalScratchPath, distMult, elevMult);
  const bogeyMetrics = calculatePathDistanceAndElevation(finalBogeyPath, distMult, elevMult);

  return {
    effectivePaths: {
      scratch: finalScratchPath,
      bogey: finalBogeyPath,
    },
    effectiveDistances: {
      scratch: scratchMetrics.distance,
      bogey: bogeyMetrics.distance,
    },
    effectiveElevations: {
      scratch: scratchMetrics.elevation,
      bogey: bogeyMetrics.elevation,
    },
  };
};

/** --- ACCURACY OVAL COMPONENT --- **/
const AccuracyOvals: React.FC<{ pos: GeoPoint | null, anchor: GeoPoint | null, gender: RatingGender, active: boolean, mode: OvalMode }> = ({ pos, anchor, gender, active, mode }) => {
  if (!active || !pos || !anchor || mode === 'off') return null;
  const distM = calculateDistance(anchor, pos);
  const distY = distM * 1.09361;
  const spread = interpolateSpread(distY, gender);
  if (!spread) return null;

  const latM = 111320;
  const cosLat = Math.cos(pos.lat * Math.PI / 180);
  const lngM = 111320 * cosLat;
  const dLat = (pos.lat - anchor.lat) * latM;
  const dLng = (pos.lng - anchor.lng) * lngM;
  const mag = Math.sqrt(dLat * dLat + dLng * dLng);
  if (mag < 0.5) return null;

  const ux = dLng / mag, uy = dLat / mag;
  const vx = -uy, vy = ux;

  const gen = (wY: number | null, dY: number | null) => {
    if (wY === null || dY === null) return null;
    const wM = (wY * 0.9144) / 2, dM = (dY * 0.9144) / 2;
    const pts: [number, number][] = [];
    for (let i = 0; i <= 32; i++) {
      const t = (i / 32) * 2 * Math.PI;
      const px = dM * Math.cos(t), py = wM * Math.sin(t);
      pts.push([pos.lat + (px * uy + py * vy) / latM, pos.lng + (px * ux + py * vx) / lngM]);
    }
    return pts;
  };

  const scratchPts = (mode === 'scratch') ? gen(spread.sw, spread.sd) : null;
  const bogeyPts = (mode === 'bogey') ? gen(spread.bw, spread.bd) : null;

  return (
    <>
      {scratchPts && <Polyline positions={scratchPts} color="#10b981" weight={2} dashArray="5, 5" />}
      {bogeyPts && <Polyline positions={bogeyPts} color="#facc15" weight={2} dashArray="5, 5" />}
    </>
  );
};

const MapController: React.FC<{ 
  pos: GeoPoint | null, active: boolean, mapPoints: GeoPoint[], completed: boolean, viewingRecord: SavedRecord | null, mode: AppView
}> = ({ pos, active, mapPoints, completed, viewingRecord, mode }) => {
  const map = useMap();
  const isUserInteracting = useRef(false);
  const lastViewId = useRef<string | null>(null);
  const hasInitialLock = useRef(false);

  useMapEvents({
    movestart: () => { isUserInteracting.current = true; },
    zoomstart: () => { isUserInteracting.current = true; }
  });

  useEffect(() => {
    const currentId = viewingRecord ? viewingRecord.id : (active ? 'active' : 'idle');
    if (lastViewId.current !== currentId) {
      isUserInteracting.current = false;
      lastViewId.current = currentId;
    }
  }, [viewingRecord, active]);

  useEffect(() => {
    if (isUserInteracting.current) return;
    if (viewingRecord) {
      const pts = viewingRecord.type === 'Green' ? viewingRecord.points : viewingRecord.raterPathPoints;
      if (pts && pts.length > 0) {
        const bounds = L.latLngBounds(pts.map(p => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [40, 40], paddingBottomRight: [40, 240], animate: true });
      }
    } else if (completed && mapPoints.length > 2) {
      const bounds = L.latLngBounds(mapPoints.map(p => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [40, 40], paddingBottomRight: [40, 240], animate: true });
    } else if (pos) {
      if (!hasInitialLock.current) {
        map.setView([pos.lat, pos.lng], 19, { animate: true });
        hasInitialLock.current = true;
      } else if (active) {
        map.setView([pos.lat, pos.lng], 19, { animate: true });
      }
    }
  }, [pos, active, map, completed, mapPoints, viewingRecord]);

  return null;
};

const UserManual: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [fontSize, setFontSize] = useState<FontSize>('medium');
  const cycleFontSize = () => {
    if (fontSize === 'small') setFontSize('medium');
    else if (fontSize === 'medium') setFontSize('large');
    else setFontSize('small');
  };
  const textClasses = useMemo(() => {
    switch (fontSize) {
      case 'small': return 'text-[11px] leading-relaxed';
      case 'large': return 'text-lg leading-relaxed';
      default: return 'text-sm leading-relaxed';
    }
  }, [fontSize]);
  return (
    <div className="fixed inset-0 z-[2000] bg-[#020617] flex flex-col p-6 overflow-y-auto no-scrollbar">
      <div className="flex justify-between items-center mb-8 mt-4">
        <h2 className="text-3xl font-black text-blue-500 uppercase tracking-tighter">User Manual</h2>
        <div className="flex gap-2">
          <button onClick={cycleFontSize} className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center text-blue-400 active:scale-90 transition-all border border-white/10 shadow-lg" title="Cycle Font Size">
            <CaseSensitive size={24} strokeWidth={2.5} />
          </button>
          <button onClick={onClose} className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center text-white active:scale-90 transition-all border border-white/10 shadow-lg">
            <X size={24} />
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-8 pb-20">
        {USER_MANUAL.map((section, idx) => (
          <div key={idx} className="bg-slate-900/50 border border-white/5 rounded-[2rem] p-6 shadow-xl">
             <div className="flex items-center gap-3 mb-3">
               <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center shadow-lg">
                 {section.icon}
               </div>
               <h3 className={`text-xl font-black uppercase tracking-tight ${section.color}`}>{section.title}</h3>
             </div>
             <div className={`text-slate-400 font-semibold ${textClasses}`}>{section.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const StimpCalculator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [sDownFt, setSDownFt] = useState(0);
  const [sDownIn, setSDownIn] = useState(0);
  const [sUpFt, setSUpFt] = useState(0);
  const [sUpIn, setSUpIn] = useState(0);
  const [result, setResult] = useState<number | null>(null);
  const [slopeCat, setSlopeCat] = useState<string | null>(null);
  const [slopeSub, setSlopeSub] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const calculate = () => {
    const sDownTotal = sDownFt + sDownIn / 12;
    const sUpTotal = sUpFt + sUpIn / 12;
    if (sDownTotal + sUpTotal === 0) return;
    const corrected = (2 * sDownTotal * sUpTotal) / (sDownTotal + sUpTotal);
    setResult(corrected);
    if (sUpTotal > 0) {
      const ratioValue = sDownTotal / sUpTotal;
      if (ratioValue < 2) { setSlopeCat("<2'"); setSlopeSub("RF/GS"); }
      else if (ratioValue <= 3) { setSlopeCat("2'-3'"); setSlopeSub("MC/MS"); }
      else { setSlopeCat(">3'"); setSlopeSub("HC/SS"); }
    }
    setTimeout(() => { resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, 100);
  };
  const adjustValue = (val: number, set: (v: number) => void, inc: number, min: number, max: number) => {
    const next = val + inc;
    if (next >= min && next <= max) set(next);
  };
  const formatResult = (val: number) => {
    const ft = Math.floor(val);
    const inches = Math.round((val - ft) * 12);
    if (inches === 12) return `${ft + 1}' 0"`;
    return `${ft}' ${inches}"`;
  };
  return (
    <div className="fixed inset-0 z-[2000] bg-[#020617] flex flex-col p-4 overflow-y-auto no-scrollbar">
      <div className="flex justify-between items-center mb-4 mt-2">
        <button onClick={onClose} className="bg-slate-800 border border-white/20 px-5 py-3 rounded-full flex items-center gap-2 shadow-2xl active:scale-95 transition-all">
          <ChevronLeft size={18} className="text-emerald-400" />
          <span className="text-[11px] uppercase tracking-widest font-semibold text-blue-500">Home</span>
        </button>
        <h1 className="text-3xl tracking-tighter font-semibold text-blue-500">Sloping Greens</h1>
      </div>
      <div className="flex flex-col items-center mb-6">
        <p className="text-slate-500 text-[9px] font-black uppercase tracking-widest text-center">Speed correction for sloping greens</p>
      </div>
      <div className="flex flex-col gap-4">
        <div className="bg-slate-900/50 border border-white/5 rounded-[1.8rem] p-4">
          <h3 className="text-lg font-black text-orange-400 uppercase tracking-tight mb-4">s(down) Distance</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col items-center gap-2">
              <span className="text-[9px] font-black text-slate-500 uppercase">Feet</span>
              <div className="flex items-stretch bg-slate-800/80 rounded-[1.2rem] overflow-hidden border border-white/5 w-full h-[120px]">
                <div className="flex-1 flex items-center justify-center bg-slate-900/40"><span className="text-3xl font-black tabular-nums">{sDownFt}</span></div>
                <div className="w-16 flex flex-col border-l border-white/5">
                  <button onClick={() => adjustValue(sDownFt, setSDownFt, 1, 0, 50)} className="flex-1 flex items-center justify-center text-blue-400 active:bg-blue-500/10 transition-colors"><ChevronUp size={28} /></button>
                  <button onClick={() => adjustValue(sDownFt, setSDownFt, -1, 0, 50)} className="flex-1 flex items-center justify-center text-blue-400 active:bg-blue-500/10 transition-colors"><ChevronDown size={28} /></button>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <span className="text-[9px] font-black text-slate-500 uppercase">Inches</span>
              <div className="flex items-stretch bg-slate-800/80 rounded-[1.2rem] overflow-hidden border border-white/5 w-full h-[120px]">
                <div className="flex-1 flex items-center justify-center bg-slate-900/40"><span className="text-3xl font-black tabular-nums">{sDownIn}</span></div>
                <div className="w-16 flex flex-col border-l border-white/5">
                  <button onClick={() => adjustValue(sDownIn, setSDownIn, 3, 0, 9)} className="flex-1 flex items-center justify-center text-blue-400 active:bg-blue-500/10 transition-colors"><ChevronUp size={28} /></button>
                  <button onClick={() => adjustValue(sDownIn, setSDownIn, -3, 0, 9)} className="flex-1 flex items-center justify-center text-blue-400 active:bg-blue-500/10 transition-colors"><ChevronDown size={28} /></button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-slate-900/50 border border-white/5 rounded-[1.8rem] p-4">
          <h3 className="text-lg font-black text-emerald-400 uppercase tracking-tight mb-4">s(up) Distance</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col items-center gap-2">
              <span className="text-[9px] font-black text-slate-500 uppercase">Feet</span>
              <div className="flex items-stretch bg-slate-800/80 rounded-[1.2rem] overflow-hidden border border-white/5 w-full h-[120px]">
                <div className="flex-1 flex items-center justify-center bg-slate-900/40"><span className="text-3xl font-black tabular-nums">{sUpFt}</span></div>
                <div className="w-16 flex flex-col border-l border-white/5">
                  <button onClick={() => adjustValue(sUpFt, setSUpFt, 1, 0, 50)} className="flex-1 flex items-center justify-center text-blue-400 active:bg-blue-500/10 transition-colors"><ChevronUp size={28} /></button>
                  <button onClick={() => adjustValue(sUpFt, setSUpFt, -1, 0, 50)} className="flex-1 flex items-center justify-center text-blue-400 active:bg-blue-500/10 transition-colors"><ChevronDown size={28} /></button>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <span className="text-[9px] font-black text-slate-500 uppercase">Inches</span>
              <div className="flex items-stretch bg-slate-800/80 rounded-[1.2rem] overflow-hidden border border-white/5 w-full h-[120px]">
                <div className="flex-1 flex items-center justify-center bg-slate-900/40"><span className="text-3xl font-black tabular-nums">{sUpIn}</span></div>
                <div className="w-16 flex flex-col border-l border-white/5">
                  <button onClick={() => adjustValue(sUpIn, setSUpIn, 3, 0, 9)} className="flex-1 flex items-center justify-center text-blue-400 active:bg-blue-500/10 transition-colors"><ChevronUp size={28} /></button>
                  <button onClick={() => adjustValue(sUpIn, setSUpIn, -3, 0, 9)} className="flex-1 flex items-center justify-center text-blue-400 active:bg-blue-500/10 transition-colors"><ChevronDown size={28} /></button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-4 mt-2 mb-12">
          <button onClick={calculate} disabled={(sDownFt === 0 && sDownIn === 0) || (sUpFt === 0 && sUpIn === 0)} className="w-full bg-blue-600 border-2 border-blue-500 rounded-full py-4 font-bold text-xs tracking-[0.2em] uppercase text-white shadow-xl active:scale-95 disabled:opacity-30 transition-all">Calculate Speed</button>
          {result !== null && (
            <div ref={resultRef} className="bg-white/[0.04] border border-blue-500/30 rounded-[1.8rem] p-6 flex flex-col items-start animate-in zoom-in-95 duration-300">
              <span className="text-[9px] font-bold text-blue-400 uppercase tracking-[0.3em] mb-2 w-full text-left">Corrected Green Speed</span>
              <div className="text-5xl font-bold text-white tabular-nums leading-none mb-1 flex items-center justify-between w-full">
                <span className="text-left">{formatResult(result)}</span>
                {slopeCat && (
                  <div className="flex flex-col items-center">
                    <span className="text-2xl text-yellow-400 bg-yellow-400/10 px-3 py-1 rounded-xl border border-yellow-400/20 tabular-nums">({slopeCat})</span>
                    {slopeSub && <span className="text-[14px] font-bold text-yellow-500 uppercase mt-1 tracking-widest">{slopeSub}</span>}
                  </div>
                )}
              </div>
              <div className="mt-6 pt-6 border-t border-white/10 w-full flex justify-center">
                <p className="text-[14px] font-light text-white leading-relaxed tracking-tight text-center">(2x<span className="text-orange-400 font-semibold">s(down)</span> x <span className="text-emerald-400 font-semibold">s(up)</span>)÷(<span className="text-orange-400 font-semibold">s(down)</span>+<span className="text-emerald-400 font-semibold">s(up)</span>)</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [view, setView] = useState<AppView>('landing');
  const [units, setUnits] = useState<UnitSystem>('Yards');
  const [mapStyle, setMapStyle] = useState<'Street' | 'Satellite'>('Satellite');
  const [pos, setPos] = useState<GeoPoint | null>(null);
  const [history, setHistory] = useState<SavedRecord[]>([]);
  const [viewingRecord, setViewingRecord] = useState<SavedRecord | null>(null);
  const [viewingTrackProfile, setViewingTrackProfile] = useState<TrackProfileView>('Rater\'s Walk');
  const [trkActive, setTrkActive] = useState(false);
  const [trkPoints, setTrkPoints] = useState<GeoPoint[]>([]);
  const [currentPivots, setCurrentPivots] = useState<PivotRecord[]>([]);
  const [holeNum, setHoleNum] = useState(1);
  const [ratingGender, setRatingGender] = useState<RatingGender>('Men');
  const [showPivotMenu, setShowPivotMenu] = useState(false);
  const [pendingPivotType, setPendingPivotType] = useState<PivotRecord['type'] | null>(null);
  const [mapActive, setMapActive] = useState(false);
  const [mapCompleted, setMapCompleted] = useState(false);
  const [mapPoints, setMapPoints] = useState<GeoPoint[]>([]);
  const [isBunker, setIsBunker] = useState(false);
  const [ovalMode, setOvalMode] = useState<OvalMode>('off');
  const CONCAVITY_FIXED = 0.82;

  useEffect(() => {
    const saved = localStorage.getItem('scottish_golf_rating_toolkit_final');
    if (saved) { try { setHistory(JSON.parse(saved)); } catch (e) { console.error(e); } }
    const watch = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, alt: p.coords.altitude, accuracy: p.coords.accuracy, altAccuracy: p.coords.altitudeAccuracy, timestamp: Date.now() }),
      (err) => console.error(err), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  const saveRecord = useCallback((record: Omit<SavedRecord, 'id' | 'date'>) => {
    const newRecord: SavedRecord = { ...record, id: Math.random().toString(36).substr(2, 9), date: Date.now() };
    const updated = [newRecord, ...history];
    setHistory(updated);
    localStorage.setItem('scottish_golf_rating_toolkit_final', JSON.stringify(updated));
  }, [history]);

  const analysis = useMemo(() => {
    const pts = viewingRecord?.type === 'Green' ? viewingRecord.points : mapPoints;
    if (!pts || pts.length < 2) return null;
    let perimeter = 0, bunkerLength = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = calculateDistance(pts[i], pts[i+1]);
      perimeter += d; if (pts[i+1].type === 'bunker') bunkerLength += d;
    }
    if (mapCompleted || (viewingRecord && viewingRecord.type === 'Green')) perimeter += calculateDistance(pts[pts.length-1], pts[0]);
    const shape = (pts.length >= 3 && (mapCompleted || viewingRecord)) ? analyzeGreenShape(pts, CONCAVITY_FIXED) : null;
    return { area: calculateArea(pts), perimeter, bunkerPct: perimeter > 0 ? Math.round((bunkerLength / perimeter) * 100) : 0, shape };
  }, [mapPoints, mapCompleted, viewingRecord]);

  const handleFinalizeGreen = useCallback(() => {
    if (mapPoints.length < 3) return;
    const shape = analyzeGreenShape(mapPoints, CONCAVITY_FIXED);
    const areaVal = Math.round(calculateArea(mapPoints) * (units === 'Yards' ? 1.196 : 1));
    let egdStr = "--";
    const s = shape as any;
    if (s) {
      if (s.anomalousResult && s.anomalousResult.isManualReq) egdStr = "MANUAL REQ";
      else if (s.isLShape) egdStr = `${s.s1?.egd} / ${s.s2?.egd} yd`;
      else egdStr = `${s.egd} yd`;
    }
    saveRecord({ type: 'Green', primaryValue: `${areaVal}${units === 'Yards' ? 'yd²' : 'm²'}`, secondaryValue: `Bunker: ${analysis?.bunkerPct}%`, egdValue: egdStr, points: mapPoints, holeNumber: holeNum });
    setMapActive(false); setMapCompleted(true);
  }, [mapPoints, units, analysis, saveRecord, holeNum]);

  useEffect(() => {
    if (mapActive && pos) {
      setMapPoints(prev => {
        const last = prev[prev.length - 1];
        if (!last || calculateDistance(last, pos) >= 0.4) return [...prev, { ...pos, type: isBunker ? 'bunker' : 'green' }];
        return prev;
      });
      if (mapPoints.length > 20 && calculateDistance(pos, mapPoints[0]) < 0.9) handleFinalizeGreen();
    }
  }, [pos, mapActive, isBunker, mapPoints.length, handleFinalizeGreen]);

  const distMult = units === 'Yards' ? 1.09361 : 1.0;
  const elevMult = units === 'Yards' ? 3.28084 : 1.0;

  const effectiveMetrics = useMemo(() => {
    if (viewingRecord && viewingRecord.type === 'Track' && viewingRecord.effectiveDistances) {
      const raterPathMetrics = calculatePathDistanceAndElevation(viewingRecord.raterPathPoints || [], distMult, elevMult);
      return { distRater: raterPathMetrics.distance, elevRater: raterPathMetrics.elevation, distScratch: viewingRecord.effectiveDistances.scratch, elevScratch: viewingRecord.effectiveElevations.scratch, distBogey: viewingRecord.effectiveDistances.bogey, elevBogey: viewingRecord.effectiveElevations.bogey, effectivePaths: viewingRecord.effectivePaths };
    }
    const currentRaterPath = [...trkPoints, ...(trkActive && pos ? [pos] : [])].filter(Boolean) as GeoPoint[];
    if (currentRaterPath.length < 2) return { distRater: 0, elevRater: 0, distScratch: 0, elevScratch: 0, distBogey: 0, elevBogey: 0, effectivePaths: { scratch: [], bogey: [] } };
    const calculated = calculateEffectivePathsAndMetrics(currentRaterPath, currentPivots, distMult, elevMult);
    const raterPathMetrics = calculatePathDistanceAndElevation(currentRaterPath, distMult, elevMult);
    return { distRater: raterPathMetrics.distance, elevRater: raterPathMetrics.elevation, distScratch: calculated.effectiveDistances.scratch, elevScratch: calculated.effectiveElevations.scratch, distBogey: calculated.effectiveDistances.bogey, elevBogey: calculated.effectiveElevations.bogey, effectivePaths: calculated.effectivePaths };
  }, [trkPoints, currentPivots, trkActive, pos, viewingRecord, distMult, elevMult]);

  const handleOpenRecord = (record: SavedRecord) => {
    setViewingRecord(record); if (record.holeNumber) setHoleNum(record.holeNumber);
    if (record.type === 'Track') { setView('track'); setTrkActive(false); setTrkPoints([]); setCurrentPivots([]); setViewingTrackProfile('Rater\'s Walk'); if (record.genderRated) setRatingGender(record.genderRated); }
    else { setView('green'); setMapActive(false); setMapCompleted(true); }
  };

  const handleConfirmPivot = useCallback(() => {
    if (pos && pendingPivotType) { setCurrentPivots(prev => [...prev, { point: pos, type: pendingPivotType }]); setTrkPoints(prev => [...prev, pos]); setPendingPivotType(null); setShowPivotMenu(false); }
  }, [pos, pendingPivotType]);

  const currentAnchor = useMemo(() => { if (viewingRecord) return null; if (currentPivots.length > 0) return currentPivots[currentPivots.length - 1].point; if (trkPoints.length > 0) return trkPoints[0]; return null; }, [currentPivots, trkPoints, viewingRecord]);

  const exportKML = () => {
    let kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Scottish Golf Export</name>`;
    history.forEach(item => {
      const coords = (item.type === 'Track' && item.raterPathPoints ? item.raterPathPoints : item.points).map(p => `${p.lng},${p.lat},${p.alt || 0}`).join(' ');
      kml += `<Placemark><name>${item.type} - Hole ${item.holeNumber || '?'}</name><description>Hole:${item.holeNumber || '?'}</description>${item.type === 'Green' ? `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords} ${item.points[0].lng},${item.points[0].lat},${item.points[0].alt || 0}</coordinates></LinearRing></outerBoundaryIs></Polygon>` : `<LineString><coordinates>${coords}</LineString></LineString>`}</Placemark>`;
    });
    kml += `</Document></kml>`;
    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'Export.kml'; a.click(); URL.revokeObjectURL(url);
  };

  const importKML = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");
      const placemarks = xmlDoc.getElementsByTagName("Placemark");
      const newItems: SavedRecord[] = [];
      for (let i = 0; i < placemarks.length; i++) {
        const p = placemarks[i];
        const coordsStr = p.getElementsByTagName("coordinates")[0]?.textContent || "";
        const descStr = p.getElementsByTagName("description")[0]?.textContent || "";
        let extractedHole = parseInt(descStr.match(/Hole:(\d+)/)?.[1] || "0");
        const points = coordsStr.trim().split(/\s+/).map(c => { const parts = c.split(',').map(Number); return { lat: parts[1], lng: parts[0], alt: parts[2] || 0, accuracy: 0, altAccuracy: 0, timestamp: Date.now() }; });
        if (points.length < 2) continue;
        const isActuallyGreen = !!p.getElementsByTagName("Polygon")[0];
        const record: SavedRecord = { id: Math.random().toString(36).substr(2, 9), date: Date.now(), type: isActuallyGreen ? 'Green' : 'Track', points, holeNumber: extractedHole || undefined, primaryValue: 'Imported', secondaryValue: 'KML Data' };
        if (isActuallyGreen) { record.primaryValue = `${Math.round(calculateArea(points) * (units === 'Yards' ? 1.196 : 1))}${units === 'Yards' ? 'yd²' : 'm²'}`; }
        newItems.push(record);
      }
      setHistory(prev => [...newItems, ...prev]);
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#020617] text-white overflow-hidden absolute inset-0 select-none font-sans">
      <div className="h-[env(safe-area-inset-top)] bg-[#0f172a] shrink-0"></div>
      {view === 'landing' ? (
        <div className="flex-1 flex flex-col p-6 overflow-y-auto no-scrollbar animate-in fade-in duration-700">
          <header className="mb-12 mt-8 flex flex-col items-center text-center">
            <h1 className="text-5xl tracking-tighter font-bold text-blue-500">Scottish Golf</h1>
            <p className="text-white text-[11px] font-bold tracking-[0.4em] uppercase mt-2 opacity-80"><span className="text-yellow-400">ENHANCED</span> Course Rating Toolkit (ALPHA)</p>
          </header>
          <div className="flex flex-col gap-6">
            <button onClick={() => { setViewingRecord(null); setTrkPoints([]); setCurrentPivots([]); setView('track'); }} className="bg-slate-900 border border-white/5 rounded-[2.5rem] p-10 flex flex-col items-center justify-center shadow-2xl active:scale-95 transition-all">
              <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mb-6 shadow-xl shadow-blue-600/40"><Navigation2 size={28} /></div>
              <h2 className="text-2xl font-bold mb-2 uppercase text-blue-500">Distance tracker</h2>
              <p className="text-slate-400 text-[11px] font-medium text-center max-w-[220px]">Real-time distance measurement and elevation change</p>
            </button>
            <div className="bg-slate-900/50 border border-white/5 rounded-[1.8rem] py-4 px-6 flex justify-around items-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Rating For:</span>
                <div className="flex bg-slate-800 rounded-full p-1 border border-white/10">
                    <button onClick={() => setRatingGender('Men')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${ratingGender === 'Men' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Men</button>
                    <button onClick={() => setRatingGender('Women')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${ratingGender === 'Women' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Women</button>
                </div>
            </div>
            <button onClick={() => { setViewingRecord(null); setMapPoints([]); setMapCompleted(false); setView('green'); }} className="bg-slate-900 border border-white/5 rounded-[2.5rem] p-10 flex flex-col items-center justify-center shadow-2xl active:scale-95 transition-all">
              <div className="w-16 h-16 bg-emerald-600 rounded-full flex items-center justify-center mb-6 shadow-xl shadow-emerald-600/40"><Target size={28} /></div>
              <h2 className="text-2xl font-bold mb-2 uppercase text-emerald-500">Green Mapper</h2>
              <p className="text-slate-400 text-[11px] font-medium text-center max-w-[220px]">Green mapping and Effective Green Diameter</p>
            </button>
            <button onClick={() => { setViewingRecord(null); setView('stimp'); }} className="bg-slate-900 border border-white/5 rounded-[2.5rem] p-10 flex flex-col items-center justify-center shadow-2xl active:scale-95 transition-all">
              <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mb-6 shadow-xl border border-blue-500/20"><Gauge size={28} className="text-lime-500" /></div>
              <h2 className="text-2xl font-bold mb-2 uppercase text-lime-400">Stimp Slopes</h2>
              <p className="text-slate-400 text-[11px] font-medium text-center max-w-[220px]">Speed correction for sloping greens</p>
            </button>
            <button onClick={() => setView('manual')} className="mt-2 bg-slate-800/50 border border-white/10 rounded-[1.8rem] py-6 flex items-center justify-center gap-4 active:bg-slate-700 transition-colors">
              <BookOpen size={20} className="text-blue-400" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-white">User Manual</span>
            </button>
            <div className="flex gap-4 mt-2">
               <button onClick={exportKML} className="flex-1 bg-slate-800/50 border border-blue-500/20 rounded-[1.8rem] py-6 flex items-center justify-center gap-3 active:bg-slate-700 transition-colors shadow-lg"><Download size={18} className="text-blue-500" /><span className="text-[10px] font-bold uppercase tracking-widest text-white">Export</span></button>
               <label className="flex-1 bg-slate-800/50 border border-emerald-500/20 rounded-[1.8rem] py-6 flex items-center justify-center gap-3 active:bg-slate-700 transition-colors shadow-lg cursor-pointer"><Upload size={18} className="text-emerald-500" /><span className="text-[10px] font-bold uppercase tracking-widest text-white">Import</span><input type="file" accept=".kml" onChange={importKML} className="hidden" /></label>
            </div>
          </div>
          <footer className="mt-auto pb-6 pt-12">
            {history.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-2 px-2 mb-4"><Info size={12} className="text-blue-400" /><span className="text-[10px] font-bold tracking-[0.2em] text-slate-500 uppercase">Assessment History</span></div>
                <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
                  {history.map(item => (
                    <div key={item.id} className="relative shrink-0">
                      <button onClick={() => handleOpenRecord(item)} className="bg-slate-900 border border-white/10 px-6 py-5 rounded-[2rem] flex flex-col min-w-[170px] text-left shadow-lg active:scale-95 transition-transform">
                        <div className="flex justify-between items-start mb-1"><span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">{item.type} {item.holeNumber && ` - Hole ${item.holeNumber}`}</span>{item.type === 'Green' ? <Target size={12} className="text-emerald-500/60" /> : <Navigation2 size={12} className="text-blue-500/60" />}</div>
                        <span className="text-xl font-bold text-white">{item.primaryValue}</span>
                        <span className="text-[11px] font-bold text-slate-400 mt-1">{item.egdValue || item.secondaryValue}</span>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setHistory(h => h.filter(x => x.id !== item.id)); }} className="absolute -top-2 -right-2 w-8 h-8 bg-red-600 rounded-full flex items-center justify-center border-2 border-[#020617] text-white shadow-xl active:scale-90"><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </footer>
        </div>
      ) : view === 'manual' ? (
        <UserManual onClose={() => setView('landing')} />
      ) : view === 'stimp' ? (
        <StimpCalculator onClose={() => setView('landing')} />
      ) : (
        <div className="flex-1 flex flex-col relative animate-in slide-in-from-right duration-300">
          <div className="absolute top-0 left-0 right-0 z-[1000] p-4 flex justify-between pointer-events-none">
            <button onClick={() => { setView('landing'); setTrkActive(false); setMapActive(false); setViewingRecord(null); setShowPivotMenu(false); }} className="pointer-events-auto bg-slate-800 border border-white/20 px-5 py-3 rounded-full flex items-center gap-2 shadow-2xl active:scale-95 transition-all">
              <ChevronLeft size={18} className="text-emerald-400" /><span className="text-[11px] uppercase tracking-widest font-semibold text-blue-500">Home</span>
            </button>
            <div className="flex gap-2 pointer-events-auto">
              {((view === 'track' && trkActive) || (view === 'green' && mapActive) || viewingRecord) && (
                <div className="bg-slate-800 border border-white/20 w-[46px] h-[46px] rounded-full flex items-center justify-center shadow-2xl"><span className="text-xl font-bold text-blue-400 tabular-nums">{holeNum}</span></div>
              )}
              {view === 'track' && (
                <button onClick={() => setOvalMode(m => m === 'off' ? 'scratch' : m === 'scratch' ? 'bogey' : 'off')} className="bg-slate-800 border border-white/20 rounded-full shadow-2xl active:scale-90 flex items-center justify-center w-[46px] h-[46px]">
                  {ovalMode === 'off' && <CircleOff size={20} className="text-slate-400" />}
                  {ovalMode === 'scratch' && <span className="text-emerald-400 font-bold text-2xl flex items-center justify-center leading-none">S</span>}
                  {ovalMode === 'bogey' && <span className="text-yellow-400 font-bold text-2xl flex items-center justify-center leading-none">B</span>}
                </button>
              )}
              <button onClick={() => setUnits(u => u === 'Yards' ? 'Metres' : 'Yards')} className="bg-slate-800 border border-white/20 p-3.5 rounded-full text-emerald-400 shadow-2xl active:scale-90"><Ruler size={20} /></button>
              <button onClick={() => setMapStyle(s => s === 'Street' ? 'Satellite' : 'Street')} className="bg-slate-800 border border-white/20 p-3.5 rounded-full text-blue-400 shadow-2xl active:scale-90"><Layers size={20} /></button>
            </div>
          </div>
          <main className="flex-1">
            {(pos || viewingRecord) ? (
              <MapContainer center={[0, 0]} zoom={2} className="h-full w-full" zoomControl={false} attributionControl={false} style={{ backgroundColor: '#020617' }}>
                <TileLayer url={mapStyle === 'Street' ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"} maxZoom={22} maxNativeZoom={19} />
                <MapController pos={pos} active={trkActive || mapActive} mapPoints={mapPoints} completed={mapCompleted} viewingRecord={viewingRecord} mode={view} />
                <AccuracyOvals pos={pos} anchor={currentAnchor} gender={ratingGender} active={view === 'track' && trkActive} mode={ovalMode} />
                {pos && !viewingRecord && (<><Circle center={[pos.lat, pos.lng]} radius={pos.accuracy} pathOptions={{ color: 'transparent', fillColor: getAccuracyColor(pos.accuracy), fillOpacity: 1, weight: 0 }} /><CircleMarker center={[pos.lat, pos.lng]} radius={7} pathOptions={{ color: '#fff', fillColor: '#10b981', fillOpacity: 1, weight: 2.5 }} /></>)}
                {view === 'track' && (trkActive || viewingRecord) && (
                    <Polyline positions={(viewingTrackProfile === 'Scratch' && effectiveMetrics.effectivePaths.scratch.length > 0) ? effectiveMetrics.effectivePaths.scratch.map(p => [p.lat, p.lng]) : (viewingTrackProfile === 'Bogey' && effectiveMetrics.effectivePaths.bogey.length > 0) ? effectiveMetrics.effectivePaths.bogey.map(p => [p.lat, p.lng]) : (trkActive ? [...trkPoints, ...(pos?[pos]:[])] : (viewingRecord?.raterPathPoints || [])).map(p => [p.lat, p.lng])} color="#3b82f6" weight={5} />
                )}
                {view === 'green' && (viewingRecord?.points || mapPoints).length > 1 && (
                  <Polygon positions={(viewingRecord?.points || mapPoints).map(p => [p.lat, p.lng])} fillColor="#10b981" fillOpacity={0.1} color="#10b981" weight={4} />
                )}
              </MapContainer>
            ) : <div className="flex items-center justify-center h-full w-full text-white/50 animate-pulse">Waiting for GPS signal...</div>}
          </main>
          <div className="absolute inset-x-0 bottom-0 z-[1000] p-4 pointer-events-none flex flex-col gap-2 items-center pb-12">
            <div className="flex flex-col gap-2 w-full max-w-[340px]">
              <div className="pointer-events-auto bg-slate-900/95 border border-white/20 rounded-[2.8rem] px-6 py-3 w-full shadow-2xl backdrop-blur-md">
                {view === 'track' ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center flex flex-col items-center">
                        <span className="text-[10px] font-bold text-white/40 uppercase block mb-2 leading-none">DISTANCE</span>
                        <div className="flex flex-col gap-1">
                            <div className="text-4xl font-bold text-emerald-400 tabular-nums leading-none">S: {effectiveMetrics.distScratch.toFixed(1)}<span className="text-[10px] ml-1 opacity-40 uppercase">{units === 'Yards' ? 'YD' : 'M'}</span></div>
                            <div className="text-4xl font-bold text-yellow-400 tabular-nums leading-none">B: {effectiveMetrics.distBogey.toFixed(1)}<span className="text-[10px] ml-1 opacity-40 uppercase">{units === 'Yards' ? 'YD' : 'M'}</span></div>
                        </div>
                      </div>
                      <div className="text-center border-l border-white/10 flex flex-col items-center justify-center">
                        <span className="text-[10px] font-bold text-white/40 uppercase block mb-2 leading-none">ELEVATION</span>
                        <div className="text-4xl font-bold text-yellow-400 tabular-nums leading-none tracking-tighter">{`${effectiveMetrics.elevRater > 0 ? '+' : ''}${effectiveMetrics.elevRater.toFixed(1)}`}<span className="text-[10px] ml-0.5 opacity-40 uppercase">{units === 'Yards' ? 'FT' : 'M'}</span></div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-3 gap-2 mb-2 text-center">
                    <div><span className="text-white/40 text-[8px] font-bold uppercase block tracking-widest">Sq. Area</span><div className="text-2xl font-bold text-emerald-400 tabular-nums">{Math.round((analysis?.area || 0) * (units === 'Yards' ? 1.196 : 1))}</div></div>
                    <div><span className="text-white/40 text-[8px] font-bold uppercase block tracking-widest">Perimeter</span><div className="text-2xl font-bold text-blue-400 tabular-nums">{((analysis?.perimeter || 0) * distMult).toFixed(1)}</div></div>
                    <div><span className="text-white/40 text-[8px] font-bold uppercase block tracking-widest">Bunker%</span><div className={`text-2xl font-bold ${getBunkerPercentageColor(analysis?.bunkerPct)} tabular-nums`}>{analysis?.bunkerPct || 0}%</div></div>
                  </div>
                )}
              </div>
              <div className="pointer-events-auto flex flex-col gap-2 w-full">
                {viewingRecord ? <button onClick={() => { setViewingRecord(null); setView('landing'); }} className="h-14 bg-slate-800 border-2 border-white/10 rounded-full font-bold text-xs tracking-[0.2em] uppercase text-white shadow-xl active:scale-95 transition-all">Close Viewer</button> : (
                  <>
                    {view === 'track' ? (
                        <div className="flex gap-2 w-full">
                          {!trkActive && (
                            <div className="flex-1 flex items-center justify-between bg-slate-900 border-2 border-white/10 rounded-full px-4 h-14 shadow-xl">
                              <button onClick={() => setHoleNum(h => Math.max(1, h - 1))} className="w-9 h-9 bg-slate-800 rounded-full flex items-center justify-center border border-white/10 active:bg-blue-600 transition-colors"><Minus size={14} /></button>
                              <div className="flex flex-col items-center"><span className="text-[7px] font-bold uppercase tracking-widest text-white/40">HOLE</span><span className="text-xl font-bold tabular-nums text-blue-400 leading-none">{holeNum}</span></div>
                              <button onClick={() => setHoleNum(h => Math.min(18, h + 1))} className="w-9 h-9 bg-slate-800 rounded-full flex items-center justify-center border border-white/10 active:bg-blue-600 transition-colors"><Plus size={14} /></button>
                            </div>
                          )}
                          <button onClick={() => { 
                            if(!trkActive) { setTrkActive(true); setTrkPoints(pos ? [pos] : []); setCurrentPivots([]); } 
                            else { 
                              const finalPath = [...trkPoints, pos].filter(Boolean) as GeoPoint[]; 
                              setTrkPoints(finalPath); 
                              const calculated = calculateEffectivePathsAndMetrics(finalPath, currentPivots, distMult, elevMult); 
                              // Fix: Satisfy the SavedRecord interface requirement by adding the missing 'points' property
                              saveRecord({ 
                                type: 'Track', 
                                primaryValue: `S: ${calculated.effectiveDistances.scratch.toFixed(1)} / B: ${calculated.effectiveDistances.bogey.toFixed(1)}`, 
                                points: finalPath,
                                raterPathPoints: finalPath, 
                                pivotPoints: currentPivots, 
                                genderRated: ratingGender, 
                                effectiveDistances: calculated.effectiveDistances, 
                                effectiveElevations: calculated.effectiveElevations, 
                                effectivePaths: calculated.effectivePaths, 
                                holeNumber: holeNum 
                              }); 
                              setTrkActive(false); 
                            } 
                          }} className={`flex-1 h-14 rounded-full font-bold text-xs tracking-[0.2em] uppercase border-2 shadow-xl active:scale-95 ${trkActive ? 'bg-red-600 border-red-500' : 'bg-blue-600 border-blue-500'}`}>{trkActive ? 'STOP TRACK' : 'START TRACK'}</button>
                          {trkActive && <button onClick={() => setShowPivotMenu(true)} className="flex-1 h-14 rounded-full font-bold text-xs tracking-[0.1em] uppercase border-2 bg-slate-800 border-blue-500 text-blue-100 shadow-xl active:scale-95">PIVOT ({currentPivots.length})</button>}
                        </div>
                    ) : (
                      <div className="flex gap-2 w-full">
                        {!mapActive && (
                            <div className="flex-1 flex items-center justify-between bg-slate-900 border-2 border-white/10 rounded-full px-4 h-14 shadow-xl">
                              <button onClick={() => setHoleNum(h => Math.max(1, h - 1))} className="w-9 h-9 bg-slate-800 rounded-full flex items-center justify-center border border-white/10 active:bg-blue-600 transition-colors"><Minus size={14} /></button>
                              <div className="flex flex-col items-center"><span className="text-[7px] font-bold uppercase tracking-widest text-white/40">HOLE</span><span className="text-xl font-bold tabular-nums text-emerald-400 leading-none">{holeNum}</span></div>
                              <button onClick={() => setHoleNum(h => Math.min(18, h + 1))} className="w-9 h-9 bg-slate-800 rounded-full flex items-center justify-center border border-white/10 active:bg-blue-600 transition-colors"><Plus size={14} /></button>
                            </div>
                          )}
                        <button onClick={() => { if(mapActive) handleFinalizeGreen(); else { setMapPoints(pos?[pos]:[]); setMapActive(true); setMapCompleted(false); } }} className={`flex-1 h-14 rounded-full font-bold text-xs tracking-[0.2em] uppercase border-2 shadow-xl active:scale-95 ${mapActive ? 'bg-blue-600 border-blue-500' : 'bg-emerald-600 border-emerald-500'}`}>{mapActive ? 'CLOSE' : 'START GREEN'}</button>
                        {mapActive && <button onPointerDown={() => setIsBunker(true)} onPointerUp={() => setIsBunker(false)} onPointerLeave={() => setIsBunker(false)} className={`flex-1 h-14 rounded-full font-bold text-xs tracking-[0.1em] uppercase border-2 transition-all shadow-xl ${isBunker ? 'bg-orange-600 border-orange-500 scale-105' : 'bg-slate-800 border-orange-500/50 text-orange-400'}`}>BUNKER (HOLD)</button>}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            {showPivotMenu && (
              <div className="absolute inset-x-0 bottom-[160px] z-[1010] p-4 flex flex-col gap-3 items-center animate-in slide-in-from-bottom duration-200 pointer-events-none">
                <div className="pointer-events-auto bg-slate-900/95 border border-white/20 rounded-[2.8rem] p-5 w-full max-w-[300px] shadow-2xl backdrop-blur-md flex flex-col items-center">
                  <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-3">Set Pivot Type:</span>
                  <div className="flex gap-2 mb-4 w-full">
                    <button onClick={() => setPendingPivotType('common')} className={`flex-1 h-12 rounded-full font-bold text-xs uppercase border-2 transition-all ${pendingPivotType === 'common' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-white/10 text-slate-400'}`}>Both</button>
                    <button onClick={() => setPendingPivotType('scratch_cut')} className={`flex-1 h-12 rounded-full font-bold text-xs uppercase border-2 transition-all ${pendingPivotType === 'scratch_cut' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-white/10 text-slate-400'}`}>Scratch</button>
                    <button onClick={() => setPendingPivotType('bogoy_round')} className={`flex-1 h-12 rounded-full font-bold text-xs uppercase border-2 transition-all ${pendingPivotType === 'bogoy_round' ? 'bg-yellow-600 border-yellow-500 text-white' : 'bg-slate-800 border-white/10 text-slate-400'}`}>Bogey</button>
                  </div>
                  <div className="flex gap-2 w-full">
                    <button onClick={handleConfirmPivot} disabled={!pendingPivotType} className="flex-1 h-12 rounded-full font-bold text-xs uppercase border-2 bg-blue-600 border-blue-500 text-white shadow-xl active:scale-95 disabled:opacity-30 transition-all">Confirm</button>
                    <button onClick={() => setShowPivotMenu(false)} className="flex-1 h-12 rounded-full font-bold text-xs uppercase border-2 bg-slate-800 border-slate-700/50 text-slate-400 shadow-xl active:scale-95">Cancel</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <style>{`.leaflet-tile-pane { filter: brightness(0.8) contrast(1.1) saturate(0.85); }.no-scrollbar::-webkit-scrollbar { display: none; }.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }`}</style>
    </div>
  );
};
const container = document.getElementById('root');
if (container) { createRoot(container).render(<App />); }