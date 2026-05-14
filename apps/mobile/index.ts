/**
 * Metro and some native/Xcode setups resolve the JavaScript entry as `index.ts`.
 * The real root (JSX + SafeAreaProvider + registerRootComponent) lives in `index.tsx`.
 */
import "react-native-gesture-handler";
import "./index.tsx";
