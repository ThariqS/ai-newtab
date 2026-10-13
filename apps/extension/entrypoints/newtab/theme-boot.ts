/**
 * Runs before React mounts (imported first by main.tsx): apply the mirrored
 * theme preference so the page never flashes the wrong scheme. MV3 forbids
 * inline scripts in extension pages, hence a module rather than a <script>.
 */
import { applyTheme, mirroredTheme } from "@/lib/theme";

applyTheme(mirroredTheme());
