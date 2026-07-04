import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, font, radius, spacing } from '../theme';

/** Dark full-screen scroll container with safe-area padding. */
export function Screen({
  children,
  scroll = true,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
}): React.ReactElement {
  const inner = <View style={[styles.screenContent, contentStyle]}>{children}</View>;
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

export function Heading({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text style={styles.heading}>{children}</Text>;
}

export function Title({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text style={styles.title}>{children}</Text>;
}

export function Body({
  children,
  dim,
  style,
}: {
  children: React.ReactNode;
  dim?: boolean;
  style?: TextStyle;
}): React.ReactElement {
  return <Text style={[styles.body, dim && styles.bodyDim, style]}>{children}</Text>;
}

export function Card({ children }: { children: React.ReactNode }): React.ReactElement {
  return <View style={styles.card}>{children}</View>;
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Card>{children}</Card>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}): React.ReactElement {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        variant === 'secondary' && styles.btnSecondary,
        variant === 'ghost' && styles.btnGhost,
        variant === 'danger' && styles.btnDanger,
        pressed && !isDisabled && styles.btnPressed,
        isDisabled && styles.btnDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text
          style={[
            styles.btnLabel,
            variant === 'ghost' && { color: colors.violet },
            variant === 'secondary' && { color: colors.text },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  ...inputProps
}: { label: string; hint?: string } & TextInputProps): React.ReactElement {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput placeholderTextColor={colors.textFaint} style={styles.input} {...inputProps} />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

/** Single-choice segmented picker. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}): React.ReactElement {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View style={styles.choiceRow}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(opt.value)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={styles.toggleRow}
    >
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
        <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { flexGrow: 1 },
  screenContent: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  title: { color: colors.text, fontSize: font.title, fontWeight: '700' },
  heading: { color: colors.text, fontSize: font.heading, fontWeight: '700' },
  body: { color: colors.text, fontSize: font.body, lineHeight: 23 },
  bodyDim: { color: colors.textDim },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  section: { gap: spacing.sm },
  sectionTitle: {
    color: colors.textDim,
    fontSize: font.small,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  btn: {
    minHeight: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  btnPrimary: { backgroundColor: colors.violet },
  btnSecondary: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  btnGhost: { backgroundColor: 'transparent' },
  btnDanger: { backgroundColor: colors.danger },
  btnPressed: { opacity: 0.8 },
  btnDisabled: { opacity: 0.45 },
  btnLabel: { color: colors.white, fontSize: font.body, fontWeight: '700' },
  field: { gap: spacing.xs },
  fieldLabel: { color: colors.textDim, fontSize: font.small, fontWeight: '600' },
  fieldHint: { color: colors.textFaint, fontSize: font.tiny },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.text,
    fontSize: font.body,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipActive: { backgroundColor: colors.violet, borderColor: colors.violet },
  chipLabel: { color: colors.textDim, fontSize: font.small, fontWeight: '600' },
  chipLabelActive: { color: colors.white },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleTrack: {
    width: 48,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 2,
    justifyContent: 'center',
  },
  toggleTrackOn: { backgroundColor: colors.violet, borderColor: colors.violet },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    alignSelf: 'flex-start',
  },
  toggleThumbOn: { alignSelf: 'flex-end' },
});
