import { Text as RNText, TextProps } from 'react-native';

import { A11y, Colors, Typography, TypographyVariant } from '@/constants/theme';

type ColorKey = 'text' | 'secondary' | 'muted' | 'inverse' | 'inverseMuted' | 'primary' | 'primaryDark';

const COLOR: Record<ColorKey, string> = {
  text: Colors.text,
  secondary: Colors.textSecondary,
  muted: Colors.textMuted,
  inverse: Colors.textInverse,
  inverseMuted: Colors.textOnDarkMuted,
  primary: Colors.primary,
  primaryDark: Colors.primaryDark,
};

type Props = TextProps & {
  variant?: TypographyVariant;
  /** A theme text colour, or any colour from constants/theme.ts. */
  color?: ColorKey | (string & {});
  align?: 'left' | 'center' | 'right';
};

const HEADINGS: TypographyVariant[] = ['display', 'title', 'stat'];

/**
 * The only Text used by screens: Poppins through a type-scale variant, so no
 * string falls back to the system font. Headings are capped at a large OS
 * font scale so they cannot push a screen apart; body text scales freely.
 */
export function Text({ variant = 'body', color = 'text', align, style, maxFontSizeMultiplier, ...rest }: Props) {
  const resolved = color in COLOR ? COLOR[color as ColorKey] : color;
  return (
    <RNText
      maxFontSizeMultiplier={
        maxFontSizeMultiplier ?? (HEADINGS.includes(variant) ? A11y.headingFontScale : undefined)
      }
      style={[Typography[variant], { color: resolved }, align ? { textAlign: align } : null, style]}
      {...rest}
    />
  );
}
