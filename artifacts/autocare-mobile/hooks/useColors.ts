import { useColorScheme } from "react-native";

import colors from "@/constants/colors";

/**
 * Returns the design tokens for the current color scheme. Picks dark
 * palette when the device is in dark mode and a `dark` key exists in
 * constants/colors.ts.
 */
export function useColors() {
  const scheme = useColorScheme();
  const { radius, light, ...rest } = colors as typeof colors & {
    dark?: typeof colors.light;
  };
  const dark = (rest as { dark?: typeof colors.light }).dark;
  const palette = scheme === "dark" && dark ? dark : light;
  return { ...palette, radius };
}
