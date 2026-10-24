import type { CSSProperties, HTMLAttributes } from "react";

export interface GradientASCIIProps extends HTMLAttributes<HTMLDivElement> {
  colors?: string[];
  shape?: "horizon" | "pinch" | "rise" | "eclipse";
  characters?: string;
  cellSize?: number;
  density?: number;
  glyphOpacity?: number;
  gradientOpacity?: number;
  glow?: number;
  depthOfField?: number;
  flicker?: number;
  softness?: number;
  scale?: number;
  flow?: number;
  speed?: number;
  grain?: number;
  variation?: number;
  mouseInteraction?: boolean;
  scrambleRadius?: number;
  clickEffect?: "wave" | "burst" | "none";
  intro?: boolean;
  lightMode?: boolean;
  fontFamily?: string;
  dpr?: number;
  style?: CSSProperties;
}

/** React Bits component supplied for the StockBack homepage. */
export default function GradientASCII(props: GradientASCIIProps): React.JSX.Element;
