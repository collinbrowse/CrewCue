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
          color: theme.color.text,
          borderColor: theme.color.border,
          backgroundColor: theme.color.summaryCard
        },
        props.style
      ]}
      placeholderTextColor={theme.color.muted}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10
  }
});

