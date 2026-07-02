import { registerSurface, type SurfaceComponent } from "../app-shell/registry";
import { ChartsOverview } from "./ChartsOverview";
import { ComparePrices } from "./ComparePrices";
import { ElevationProfile } from "./ElevationProfile";
import { HeightmapSelection } from "./HeightmapSelection";
import { HierarchyTree } from "./HierarchyTree";
import { MarkersOverview } from "./MarkersOverview";
import { MarketDeals } from "./MarketDeals";
import { MarketOverview } from "./MarketOverview";
import { MilitaryOverview } from "./MilitaryOverview";
import { Minimap } from "./Minimap";
import { ProductionChains } from "./ProductionChains";
import { ProductionOverview } from "./ProductionOverview";
import { RegimentsOverview } from "./RegimentsOverview";
import { RiversOverview } from "./RiversOverview";
import { RoutesOverview } from "./RoutesOverview";
import { TradeDetails } from "./TradeDetails";

/**
 * Surface registration — the one place that binds each `SurfaceId` to its React
 * component. Importing this module (App does, for its side effect) registers them
 * all; adding a surface is a single `registerSurface` line here plus its id in the
 * `SurfaceId` union. Components are widened to `SurfaceComponent` because their
 * opened-with props arrive at runtime from `openSurface` and cannot be tied to the
 * id statically (the id is the compile-checked part).
 */
registerSurface("compare-prices", ComparePrices as SurfaceComponent);
registerSurface("market-overview", MarketOverview as unknown as SurfaceComponent);
registerSurface("market-deals", MarketDeals as unknown as SurfaceComponent);
registerSurface("trade-details", TradeDetails as unknown as SurfaceComponent);
registerSurface("production-overview", ProductionOverview as unknown as SurfaceComponent);
registerSurface("minimap", Minimap as SurfaceComponent);
registerSurface("routes-overview", RoutesOverview as SurfaceComponent);
registerSurface("rivers-overview", RiversOverview as SurfaceComponent);
registerSurface("markers-overview", MarkersOverview as SurfaceComponent);
registerSurface("regiments-overview", RegimentsOverview as unknown as SurfaceComponent);
registerSurface("military-overview", MilitaryOverview as SurfaceComponent);
registerSurface("heightmap-selection", HeightmapSelection as SurfaceComponent);
registerSurface("elevation-profile", ElevationProfile as unknown as SurfaceComponent);
registerSurface("hierarchy-tree", HierarchyTree as unknown as SurfaceComponent);
registerSurface("production-chains", ProductionChains as SurfaceComponent);
registerSurface("charts-overview", ChartsOverview as SurfaceComponent);
