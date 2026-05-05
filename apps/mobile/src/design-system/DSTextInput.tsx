import type { ReactElement } from "react";
import { StyleSheet, TextInput, type TextInputProps } from "react-native";
import { useDSTheme } from "./theme";

export function DSTextInput(props: TextInputProps): ReactElement {
  const theme = useDSTheme();
  return (
    <TextInput
      {...props}
      style={[
        styles.base,
        {
          color: theme.color.authHeading,
          borderColor: theme.color.divider,
          backgroundColor: theme.color.card,
          borderRadius: theme.radius.lg
        },
        props.style
      ]}
      placeholderTextColor={theme.color.authBody}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16
  }
});

