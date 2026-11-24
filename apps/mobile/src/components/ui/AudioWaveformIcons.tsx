import type { Icon, IconProps } from "@tabler/icons-react-native/types";
import { forwardRef } from "react";
import { Circle, Path, Rect, Svg } from "react-native-svg";

/** Five-bar vertical audio waveform matching Apple/Doubao voice icons and Tabler 2px stroke weight. */
export const IconAudioWaveform: Icon = forwardRef<Svg, IconProps>(function IconAudioWaveform(
  { size = 24, color = "currentColor", strokeWidth = 2, style, accessibilityLabel, testID },
  ref,
) {
  return (
    <Svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={style}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <Path
        d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
});

/** Lightweight outlined stop-circle icon matching thin linear AppBar controls. */
export const IconStopCircle: Icon = forwardRef<Svg, IconProps>(function IconStopCircle(
  { size = 24, color = "currentColor", strokeWidth = 2, style, accessibilityLabel, testID },
  ref,
) {
  return (
    <Svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={style}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={strokeWidth} />
      <Rect x={9} y={9} width={6} height={6} rx={1.3} fill={color} />
    </Svg>
  );
});
